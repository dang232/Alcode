/**
 * code-graph.ts — the `code_graph` native tool.
 *
 * Exposes the repository code graph over one op surface: `status` reports
 * whether a persisted snapshot exists (cheap — it never indexes),
 * `context`/`search`/`trace`/`impact`/`tests` run the engine directly over
 * a bounded file walk (capped at 2000 files, same approach as the CLI run
 * path's plan evidence) and wrap the engine QueryEnvelope through
 * `buildAgentContext`. The tool returns one JSON string carrying both the
 * rendered text and the structured envelope.
 *
 * Every caller-fixable problem is refused with the shared `refuseArgs`
 * usage error; engine failures (no sources, index failure) answer as an
 * honest unavailable envelope, never a raw throw.
 */

import { promises as fs, type Dirent } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { refuseArgs } from "../ulw/args.ts"
import {
  AGENT_CONTEXT_DEFAULT_MAX_BYTES,
  buildAgentContext,
  renderAgentContext,
  type GraphContextEnvelope,
  type GraphContextOp,
  type GraphContextSubject,
} from "../../../../code-graph/src/index.ts"
import {
  computeScopeFingerprint,
  findTests,
  impact,
  indexFiles,
  parseSnapshotManifest,
  search,
  symbolContext,
  trace,
  type QueryEnvelope,
  type QueryOptions,
  type QueryScope,
  type SnapshotManifest,
} from "../../../../code-graph/src/index.ts"
import { resolveProjectIdentity } from "../../../../memory-core/src/project-knowledge/identity.ts"
import { CodeGraphArgsSchema, type CodeGraphArgs } from "./args.ts"

export const CODE_GRAPH_NAME = "code_graph"

export const CODE_GRAPH_DESCRIPTION =
  "Query the repository code graph: status, symbol context, search, call trace, blast-radius impact, or owning tests."

export type CodeGraphToolDeps = {
  /** Working directory override (tests); defaults to the tool context directory. */
  readonly directory?: string
}

/** Bounded walk cap shared with the CLI run path's plan evidence. */
const CODE_GRAPH_MAX_FILES = 2000

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
])

/** Manifest locations the cheap `status` op reads; nothing else is touched. */
const STATUS_MANIFEST_CANDIDATES = [
  ".omo/code-graph/manifest.json",
  ".omo/code-graph/snapshot-manifest.json",
]

const FALLBACK_REVISION = "0".repeat(40)

function resolveDirectory(deps: CodeGraphToolDeps, context: OmoToolContext | undefined): string {
  if (context?.directory !== undefined && context.directory.length > 0) return context.directory
  if (context?.worktree !== undefined && context.worktree.length > 0) return context.worktree
  if (deps.directory !== undefined && deps.directory.length > 0) return deps.directory
  return process.cwd()
}

async function collectSourceFiles(directory: string, maxFiles = CODE_GRAPH_MAX_FILES): Promise<string[]> {
  const collected: string[] = []
  const walk = async (current: string): Promise<void> => {
    if (collected.length >= maxFiles) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (collected.length >= maxFiles) return
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue
        await walk(path.join(current, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
      collected.push(path.join(current, entry.name))
    }
  }
  await walk(directory)
  collected.sort()
  return collected
}

async function collectChangedPaths(directory: string): Promise<string[]> {
  const run = promisify(execFile)
  let stdout: string
  try {
    ({ stdout } = await run("git", ["status", "--porcelain"], { cwd: directory, maxBuffer: 1 << 20 }))
  } catch {
    return []
  }
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 3)
    .map((line) => line.slice(2).trim().replace(/^"|"$/g, ""))
    .flatMap((entry) => (entry.includes(" -> ") ? entry.split(" -> ") : [entry]))
    .filter((entry) => SOURCE_EXTENSIONS.has(path.extname(entry)))
    .sort()
}

function looksLikeNodeId(subject: string): boolean {
  return subject.includes(":") || subject.includes("@") || subject.includes("/") || subject.includes("\\")
}

function resolveSymbolId(
  snapshot: ReturnType<typeof indexFiles>,
  subject: string,
  options: QueryOptions,
): string {
  const normalized = subject.replace(/\\/g, "/").replace(/^\.\//, "")
  const directFileId = `file:${normalized}`
  if (snapshot.nodes.some((node) => node.id === directFileId)) return directFileId
  if (looksLikeNodeId(subject)) {
    if (snapshot.nodes.some((node) => node.id === subject)) return subject
    const base = normalized.split("/").pop() ?? normalized
    const byName = search(snapshot, base, options)
    const fileHit = byName.items.find((item) => item.id.startsWith("file:"))
    return fileHit === undefined ? subject : fileHit.id
  }
  const found = search(snapshot, subject, options)
  const exact = found.items.find((item) => item.name === subject) ?? found.items[0]
  return exact === undefined ? subject : exact.id
}

function symbolsDefinedIn(snapshot: ReturnType<typeof indexFiles>, fileId: string): string[] {
  return snapshot.edges
    .filter((edge) => edge.kind === "DEFINES" && edge.from === fileId)
    .map((edge) => edge.to)
    .sort()
}

function unresolvedEdgesFor(snapshot: ReturnType<typeof indexFiles>, fileId: string): string[] {
  const fragment = fileId.replace(/^file:/, "")
  const involvesFile = (id: string): boolean => id === fileId || id.includes(fragment)
  return snapshot.edges
    .filter((edge) => edge.kind === "CALLS_UNRESOLVED" && involvesFile(edge.from))
    .map((edge) => `${edge.from} -> ${edge.to} (unresolved, manual review)`)
}

function mergedImpactEnvelope(
  snapshot: ReturnType<typeof indexFiles>,
  scope: QueryScope,
  paths: readonly string[],
  options: QueryOptions,
): QueryEnvelope {
  const seen = new Set<string>()
  const items: (QueryEnvelope["items"][number])[] = []
  const unresolved: string[] = []
  const knownParts: number[] = []
  let deduped = 0
  let everyPartComplete = true
  let partsRun = 0
  for (const file of paths) {
    const fileId = resolveSymbolId(snapshot, file, options)
    // impact() walks symbol subjects; a file contributes every symbol it defines.
    const subjects = symbolsDefinedIn(snapshot, fileId)
    unresolved.push(...unresolvedEdgesFor(snapshot, fileId))
    for (const subject of subjects.length > 0 ? subjects : [fileId]) {
      const part = impact(snapshot, subject, options)
      partsRun += 1
      if (part.completeness !== undefined && part.completeness !== "complete") everyPartComplete = false
      if (typeof part.totals?.known === "number") knownParts.push(part.totals.known)
      for (const item of part.items) {
        if (seen.has(item.id)) {
          deduped += 1
          continue
        }
        seen.add(item.id)
        items.push(item)
      }
      unresolved.push(...part.unresolved)
    }
  }
  const uniqueUnresolved = [...new Set(unresolved)]
  const complete = paths.length === 0 || (everyPartComplete && deduped === 0 && knownParts.length > 0)
  // A single part's engine total is exact; across parts a node reachable from
  // two of them is counted twice by the engine but once in `items`, so the
  // union is reported as unknown instead of summed.
  const known = paths.length === 0
    ? 0
    : partsRun === 1 && knownParts.length === 1 ? knownParts[0] : null
  return {
    projectId: scope.projectId,
    worktreeId: scope.worktreeId,
    revision: scope.revision,
    fingerprint: scope.fingerprint,
    freshness: "fresh",
    coverage: paths.length === 0 ? "indexed" : "partial",
    truncated: false,
    knowledgeIds: [],
    unresolved: paths.length === 0 ? ["no-changes"] : uniqueUnresolved,
    unsupported: [],
    items,
    totals: { displayed: items.length, known, hidden: known === null ? null : Math.max(known - items.length, 0) },
    completeness: complete ? "complete" : "partial",
    ...(complete ? {} : { completenessReason: "result-limit" as const }),
  }
}

async function resolveGitDir(directory: string): Promise<string | undefined> {
  const dotGit = path.join(directory, ".git")
  try {
    const stat = await fs.stat(dotGit)
    if (stat.isDirectory()) return dotGit
    const content = (await fs.readFile(dotGit, "utf8")).trim()
    if (!content.startsWith("gitdir:")) return undefined
    const target = content.slice("gitdir:".length).trim()
    if (target.length === 0) return undefined
    return path.isAbsolute(target) ? target : path.resolve(directory, target)
  } catch {
    return undefined
  }
}

async function refRoots(gitDir: string): Promise<string[]> {
  const roots = [gitDir]
  try {
    const common = (await fs.readFile(path.join(gitDir, "commondir"), "utf8")).trim()
    if (common.length > 0) {
      roots.push(path.isAbsolute(common) ? common : path.resolve(gitDir, common))
    }
  } catch {
    return roots
  }
  return roots
}

async function readRefValue(gitDir: string, ref: string): Promise<string | undefined> {
  for (const root of await refRoots(gitDir)) {
    try {
      const value = (await fs.readFile(path.join(root, ref), "utf8")).trim()
      if (/^[0-9a-f]{7,64}$/.test(value)) return value
    } catch {
      // loose ref absent; packed-refs below may still carry it
    }
    try {
      const packed = await fs.readFile(path.join(root, "packed-refs"), "utf8")
      for (const line of packed.split("\n")) {
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("^")) continue
        const [sha, name] = trimmed.split(" ")
        if (name === ref && sha !== undefined && /^[0-9a-f]{7,64}$/.test(sha)) return sha
      }
    } catch {
      // no packed refs in this root
    }
  }
  return undefined
}

async function readWorktreeRevision(directory: string): Promise<string | undefined> {
  const gitDir = await resolveGitDir(directory)
  if (gitDir === undefined) return undefined
  let head: string
  try {
    head = (await fs.readFile(path.join(gitDir, "HEAD"), "utf8")).trim()
  } catch {
    return undefined
  }
  if (!head.startsWith("ref:")) return /^[0-9a-f]{7,64}$/.test(head) ? head : undefined
  const ref = head.slice(4).trim()
  return await readRefValue(gitDir, ref)
}

function resolveProjectId(directory: string): string {
  try {
    return resolveProjectIdentity(directory).projectId
  } catch {
    return "project-00000000"
  }
}

async function buildScope(directory: string): Promise<QueryScope> {
  const projectId = resolveProjectId(directory)
  const worktreeId = path.resolve(directory)
  const revision = (await readWorktreeRevision(directory)) ?? FALLBACK_REVISION
  return { projectId, worktreeId, revision, fingerprint: computeScopeFingerprint(projectId, worktreeId, revision) }
}

/** Cheap manifest read for `status`: no indexing, no graph build. */
async function readStatusManifest(directory: string): Promise<SnapshotManifest | undefined> {
  for (const relative of STATUS_MANIFEST_CANDIDATES) {
    let text: string
    try {
      text = await fs.readFile(path.join(directory, relative), "utf8")
    } catch {
      continue
    }
    const parsed = parseSnapshotManifest(text)
    if (parsed.kind === "manifest") return parsed.manifest
  }
  return undefined
}

function inferSubjectKind(subject: string): CodeGraphArgs["subjectKind"] {
  if (subject.includes("@") || subject.startsWith("fn:") || subject.startsWith("file:")) return "symbol"
  if (subject.includes("/") || subject.includes("\\") || subject.includes(".")) return "file"
  return "query"
}

function toSubjects(op: GraphContextOp, args: CodeGraphArgs): readonly GraphContextSubject[] {
  if (op === "status") return []
  const subject = args.subject
  if (subject === undefined) {
    return args.subjectKind === "changes" ? [{ kind: "changes", id: "working-tree", reason: "git-status" }] : []
  }
  const kind = args.subjectKind ?? inferSubjectKind(subject)
  const subjects: GraphContextSubject[] = [{ kind, id: subject }]
  if (op === "trace" && args.to !== undefined) {
    subjects.push({ kind: args.subjectKind ?? inferSubjectKind(args.to), id: args.to })
  }
  return subjects
}

function queryOptions(scope: QueryScope, args: CodeGraphArgs): QueryOptions {
  return {
    scope,
    limit: args.limit,
    maxDepth: args.depth,
  }
}

export function createCodeGraphTool(deps: CodeGraphToolDeps = {}): OmoToolDefinition {
  return {
    description: CODE_GRAPH_DESCRIPTION,
    args: {
      properties: {
        op: {
          type: "string",
          description: "Graph operation: status, context, search, trace, impact, or tests.",
          allowedValues: ["status", "context", "search", "trace", "impact", "tests"],
        },
        subject: { type: "string", description: "Symbol id, file path, or search text; required except for status." },
        subjectKind: {
          type: "string",
          description: "How to read subject; inferred when omitted.",
          allowedValues: ["file", "symbol", "changes", "query"],
        },
        to: { type: "string", description: "Destination symbol id for trace." },
        depth: { type: "number", description: "Traversal depth, 1-3; defaults to 2." },
        limit: { type: "number", description: "Result cap, 1-50; defaults to 20." },
        maxBytes: { type: "number", description: "Rendered budget, 512-16384; defaults to 8192." },
      },
      required: ["op"],
    },
    execute: async (toolArgs: OmoJsonObject, context?: OmoToolContext) => {
      const directory = resolveDirectory(deps, context)
      const parsed = CodeGraphArgsSchema.safeParse(toolArgs)
      if (!parsed.success) {
        refuseArgs("", "code_graph needs op status|context|search|trace|impact|tests, optional subject/subjectKind/to, depth 1-3, limit 1-50, maxBytes 512-16384.")
      }
      const args = parsed.data
      const op: GraphContextOp = args.op
      const maxBytes = args.maxBytes ?? AGENT_CONTEXT_DEFAULT_MAX_BYTES
      const scope = await buildScope(directory)
      const correlation = {
        projectId: scope.projectId,
        worktreeId: scope.worktreeId,
        revision: scope.revision,
      }

      if (op === "status") {
        const manifest = await readStatusManifest(directory)
        const coverage = manifest !== undefined && manifest.nodeCount > 0 ? "partial" : "unindexed"
        const reasons =
          manifest === undefined
            ? ["no-snapshot"]
            : [`snapshot-metadata-only nodes=${manifest.nodeCount} edges=${manifest.edgeCount}`]
        const envelope = buildAgentContext({
          op,
          level: 0,
          subjects: [],
          correlation,
          status: { freshness: "fresh", coverage, queryServable: false, reasons },
          maxBytes,
        })
        return stringifyEnvelope(envelope)
      }

      const subject = args.subject
      const changesMode = op === "impact" && (args.subjectKind === "changes" || inferSubjectKind(subject ?? "") === "changes")
      if (subject === undefined && !changesMode) {
        refuseArgs("", `code_graph op '${op}' needs a subject string.`)
      }
      if (op === "trace" && args.to === undefined) {
        refuseArgs("", "code_graph op 'trace' needs both subject and to symbol ids.")
      }

      const files = await collectSourceFiles(directory)
      if (files.length === 0) {
        const envelope = buildAgentContext({
          op,
          level: (args.depth ?? 2) as 1 | 2 | 3,
          subjects: toSubjects(op, args),
          correlation,
          status: { freshness: "fresh", coverage: "unindexed", queryServable: false, reasons: ["no-source-files"] },
          maxBytes,
        })
        return stringifyEnvelope(envelope)
      }

      let snapshot: ReturnType<typeof indexFiles>
      try {
        snapshot = indexFiles(files)
      } catch {
        const envelope = buildAgentContext({
          op,
          level: (args.depth ?? 2) as 1 | 2 | 3,
          subjects: toSubjects(op, args),
          correlation,
          status: { freshness: "fresh", coverage: "unindexed", queryServable: false, reasons: ["index-failed"] },
          maxBytes,
        })
        return stringifyEnvelope(envelope)
      }

      const options = queryOptions(scope, args)
      let queryEnvelope: QueryEnvelope
      if (op === "search") {
        queryEnvelope = search(snapshot, subject as string, options)
      } else if (op === "context") {
        const kind = args.subjectKind ?? inferSubjectKind(subject as string)
        const resolved = resolveSymbolId(snapshot, subject as string, options)
        const resolvedBy = resolved === subject ? undefined : resolved
        queryEnvelope =
          kind === "file" || kind === "changes"
            ? search(snapshot, subject as string, options)
            : kind === "query"
              ? search(snapshot, subject as string, options)
              : symbolContext(snapshot, resolved, options)
        if (resolvedBy !== undefined) {
          queryEnvelope = { ...queryEnvelope, unresolved: [...queryEnvelope.unresolved, `resolved-from-name:${resolvedBy}`] }
        }
      } else if (op === "trace") {
        queryEnvelope = trace(
          snapshot,
          resolveSymbolId(snapshot, subject as string, options),
          resolveSymbolId(snapshot, args.to as string, options),
          options,
        )
      } else if (op === "impact") {
        queryEnvelope = changesMode && subject === undefined
          ? mergedImpactEnvelope(snapshot, scope, await collectChangedPaths(directory), options)
          : mergedImpactEnvelope(snapshot, scope, [subject as string], options)
      } else {
        queryEnvelope = findTests(snapshot, resolveSymbolId(snapshot, subject as string, options), options)
      }

      const envelope = buildAgentContext({
        op,
        level: (args.depth ?? 2) as 1 | 2 | 3,
        envelope: queryEnvelope,
        subjects: toSubjects(op, args),
        correlation,
        maxBytes,
      })
      return stringifyEnvelope(envelope)
    },
  }
}

function stringifyEnvelope(envelope: GraphContextEnvelope): string {
  const rendered = renderAgentContext(envelope)
  return JSON.stringify({ text: rendered.text, omittedItems: rendered.omittedItems, ...envelope })
}
