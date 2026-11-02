/**
 * code-graph.ts — the `code_graph` native tool.
 *
 * Exposes the repository code graph over one op surface: `status` reports
 * the canonical index state (cheap — it never blocks on a build),
 * `context`/`search`/`trace`/`impact`/`tests` query the one canonical
 * Code Graph service (the same runtime, store directory, and persisted
 * generations the panel serves) and wrap the canonical answer through
 * `buildAgentContext`. The tool returns one JSON string carrying both the
 * rendered text and the structured envelope. Repeated queries against an
 * unchanged repository reuse its generation instead of rebuilding.
 *
 * Every caller-fixable problem is refused with the shared `refuseArgs`
 * usage error; service failures (no sources, index failure) answer as an
 * honest unavailable envelope, never a raw throw.
 */

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
  type QueryEnvelope,
} from "../../../../code-graph/src/index.ts"
import { CodeGraphArgsSchema, type CodeGraphArgs } from "./args.ts"
import {
  getCanonicalRuntime,
  type CanonicalAnswer,
  type CanonicalRuntime,
  type CanonicalSummary,
} from "./canonical-runtime.ts"

export const CODE_GRAPH_NAME = "code_graph"

export const CODE_GRAPH_DESCRIPTION =
  "Query the repository code graph: status, symbol context, search, call trace, blast-radius impact, or owning tests."

export type CodeGraphToolDeps = {
  /** Working directory override (tests); defaults to the tool context directory. */
  readonly directory?: string
  /** Canonical store directory override (tests); defaults to the shared panel store. */
  readonly storeDir?: string
  /** Canonical runtime override (tests); defaults to the shared singleton. */
  readonly runtime?: CanonicalRuntime
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])

const FALLBACK_REVISION = "0".repeat(40)

function resolveDirectory(deps: CodeGraphToolDeps, context: OmoToolContext | undefined): string {
  if (context?.directory !== undefined && context.directory.length > 0) return context.directory
  if (context?.worktree !== undefined && context.worktree.length > 0) return context.worktree
  if (deps.directory !== undefined && deps.directory.length > 0) return deps.directory
  return process.cwd()
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

const normalizeRel = (subject: string): string => subject.replace(/\\/g, "/").replace(/^\.\//, "")

/**
 * Resolve a subject against the canonical generation: file-like subjects
 * probe the file view (falling back to a basename search, as the old
 * snapshot-membership check did), bare names search once, and symbol ids
 * pass through — the engine answers an honest empty result when unknown.
 */
async function resolveSubjectId(
  runtime: CanonicalRuntime,
  track: (answer: CanonicalAnswer) => CanonicalAnswer,
  directory: string,
  subject: string,
  limit: number,
): Promise<string> {
  const normalized = normalizeRel(subject)
  const fileLike =
    subject.startsWith("file:") || normalized.includes("/") || subject.includes("\\") || /\.[a-z0-9]+$/i.test(normalized)
  if (fileLike) {
    const probe = track(await runtime.query(directory, { kind: "file", file: normalized, limit: 1 }))
    const hit = probe.envelope.items[0]
    if (hit !== undefined && hit.id.startsWith("file:")) return hit.id
    if (!looksLikeNodeId(subject)) {
      const found = track(await runtime.query(directory, { kind: "search", query: subject, limit }))
      const exact = found.envelope.items.find((item) => item.name === subject) ?? found.envelope.items[0]
      return exact?.id ?? subject
    }
    const base = normalized.split("/").pop() ?? normalized
    const byName = track(await runtime.query(directory, { kind: "search", query: base, limit }))
    return byName.envelope.items.find((item) => item.id.startsWith("file:"))?.id ?? subject
  }
  if (!looksLikeNodeId(subject)) {
    const found = track(await runtime.query(directory, { kind: "search", query: subject, limit }))
    const exact = found.envelope.items.find((item) => item.name === subject) ?? found.envelope.items[0]
    return exact?.id ?? subject
  }
  return subject
}

function mergedImpactEnvelope(
  summary: CanonicalSummary,
  directory: string,
  paths: readonly string[],
  parts: readonly CanonicalAnswer[],
): QueryEnvelope {
  const seen = new Set<string>()
  const items: QueryEnvelope["items"][number][] = []
  const unresolved: string[] = []
  const knownParts: number[] = []
  let deduped = 0
  let everyPartComplete = true
  let partsRun = 0
  for (const part of parts) {
    partsRun += 1
    if (part.envelope.completeness !== undefined && part.envelope.completeness !== "complete") everyPartComplete = false
    if (typeof part.envelope.totals?.known === "number") knownParts.push(part.envelope.totals.known)
    for (const item of part.envelope.items) {
      if (seen.has(item.id)) {
        deduped += 1
        continue
      }
      seen.add(item.id)
      items.push(item)
    }
    unresolved.push(...part.envelope.unresolved)
  }
  const uniqueUnresolved = [...new Set(unresolved)]
  const coverRank = (coverage: string): number =>
    coverage === "indexed" ? 0 : coverage === "partial" ? 1 : 2
  const coverage =
    paths.length === 0
      ? "indexed"
      : (parts.map((part) => part.envelope.coverage).sort((a, b) => coverRank(b) - coverRank(a))[0] ?? "partial")
  const complete = paths.length === 0 || (everyPartComplete && deduped === 0 && knownParts.length > 0)
  const known = paths.length === 0
    ? 0
    : partsRun === 1 && knownParts.length === 1 ? knownParts[0] : null
  return {
    projectId: summary.projectId ?? "project-00000000",
    worktreeId: summary.worktreeId ?? directory,
    revision: summary.revision ?? FALLBACK_REVISION,
    fingerprint: summary.fingerprint ?? "",
    freshness: "fresh",
    coverage,
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

function correlationOf(summary: CanonicalSummary, directory: string): {
  projectId: string
  worktreeId: string
  revision: string
  generation?: number
} {
  return {
    projectId: summary.projectId ?? "project-00000000",
    worktreeId: summary.worktreeId ?? directory,
    revision: summary.revision ?? FALLBACK_REVISION,
    ...(summary.generation === null ? {} : { generation: summary.generation }),
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
      const runtime = getCanonicalRuntime(deps)

      if (op === "status") {
        let summary: CanonicalSummary
        try {
          summary = await runtime.readIndex(directory)
        } catch {
          return stringifyEnvelope(
            buildAgentContext({
              op,
              level: 0,
              subjects: [],
              correlation: correlationOf(
                {
                  ready: false, generation: null, projectId: null, worktreeId: null, revision: null,
                  fingerprint: null, freshness: "unindexed", indexTruncated: false, nodeCount: 0,
                  edgeCount: 0, entryCount: 0, entryCap: 0, indexState: null,
                },
                directory,
              ),
              status: { freshness: "unindexed", coverage: "unindexed", queryServable: false, reasons: ["index-failed"] },
              maxBytes,
            }),
          )
        }
        const servable = summary.ready === true
        const coverage = !servable
          ? (summary.generation !== null ? "partial" : "unindexed")
          : summary.indexTruncated ? "partial" : "indexed"
        const reasons = [
          `generation:${summary.generation ?? "none"}`,
          `freshness:${summary.freshness}`,
          ...(summary.indexState !== null ? [`index-state:${summary.indexState}`] : []),
          ...(servable ? [`nodes:${summary.nodeCount}`, `edges:${summary.edgeCount}`] : []),
          ...(summary.indexTruncated ? ["index-truncated"] : []),
        ]
        const envelope = buildAgentContext({
          op,
          level: 0,
          subjects: [],
          correlation: correlationOf(summary, directory),
          status: {
            freshness: summary.freshness,
            coverage,
            ...(summary.generation === null ? {} : { generation: summary.generation }),
            ...(summary.revision === null ? {} : { revision: summary.revision }),
            queryServable: servable,
            reasons,
          },
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

      const unavailable = (reasons: readonly string[]): string =>
        stringifyEnvelope(
          buildAgentContext({
            op,
            level: (args.depth ?? 2) as 1 | 2 | 3,
            subjects: toSubjects(op, args),
            correlation: correlationOf(
              {
                ready: false, generation: null, projectId: null, worktreeId: null, revision: null,
                fingerprint: null, freshness: "unindexed", indexTruncated: false, nodeCount: 0,
                edgeCount: 0, entryCount: 0, entryCap: 0, indexState: null,
              },
              directory,
            ),
            status: { freshness: "unindexed", coverage: "unindexed", queryServable: false, reasons: [...reasons] },
            maxBytes,
          }),
        )

      let summary: CanonicalSummary
      try {
        summary = await runtime.readIndex(directory, { block: true })
      } catch {
        return unavailable(["index-failed"])
      }
      if (!summary.ready) {
        return stringifyEnvelope(
          buildAgentContext({
            op,
            level: (args.depth ?? 2) as 1 | 2 | 3,
            subjects: toSubjects(op, args),
            correlation: correlationOf(summary, directory),
            status: {
              freshness: summary.freshness,
              coverage: summary.generation !== null ? "partial" : "unindexed",
              ...(summary.generation === null ? {} : { generation: summary.generation }),
              ...(summary.revision === null ? {} : { revision: summary.revision }),
              queryServable: false,
              reasons: [
                `generation:${summary.generation ?? "none"}`,
                ...(summary.indexState !== null ? [`index-state:${summary.indexState}`] : []),
              ],
            },
            maxBytes,
          }),
        )
      }
      if (summary.entryCount === 0) {
        return stringifyEnvelope(
          buildAgentContext({
            op,
            level: (args.depth ?? 2) as 1 | 2 | 3,
            subjects: toSubjects(op, args),
            correlation: correlationOf(summary, directory),
            status: {
              freshness: summary.freshness,
              coverage: "unindexed",
              ...(summary.generation === null ? {} : { generation: summary.generation }),
              ...(summary.revision === null ? {} : { revision: summary.revision }),
              queryServable: false,
              reasons: ["no-source-files"],
            },
            maxBytes,
          }),
        )
      }

      const generations: (number | null)[] = []
      const track = (answer: CanonicalAnswer): CanonicalAnswer => {
        generations.push(answer.generation)
        return answer
      }
      const limit = args.limit
      const depth = args.depth

      const runOp = async (): Promise<{
        envelope: QueryEnvelope
        extraUnresolved: string[]
      }> => {
        if (op === "search") {
          const answer = track(await runtime.query(directory, { kind: "search", query: subject as string, limit }))
          return { envelope: answer.envelope, extraUnresolved: [] }
        }
        if (op === "context") {
          const kind = args.subjectKind ?? inferSubjectKind(subject as string)
          if (kind === "file" || kind === "changes" || kind === "query") {
            const answer = track(await runtime.query(directory, { kind: "search", query: subject as string, limit }))
            return { envelope: answer.envelope, extraUnresolved: [] }
          }
          const resolved = await resolveSubjectId(runtime, track, directory, subject as string, limit ?? 20)
          const answer = track(
            await runtime.query(directory, { kind: "context", symbol: resolved, limit, depth }),
          )
          return {
            envelope: answer.envelope,
            extraUnresolved: resolved === subject ? [] : [`resolved-from-name:${resolved}`],
          }
        }
        if (op === "trace") {
          const from = await resolveSubjectId(runtime, track, directory, subject as string, limit ?? 20)
          const to = await resolveSubjectId(runtime, track, directory, args.to as string, limit ?? 20)
          const answer = track(await runtime.query(directory, { kind: "trace", from, to, limit, depth }))
          return { envelope: answer.envelope, extraUnresolved: [] }
        }
        if (op === "impact") {
          // Files expand to the symbols they define before impact runs: the
          // engine walks from symbol subjects, and a bare file id answers
          // empty. The file view names those symbols over the same
          // generation, so the expansion never mixes generations.
          const impactSubjectsForFile = async (rel: string): Promise<CanonicalAnswer[]> => {
            const view = track(await runtime.query(directory, { kind: "file", file: rel, limit }))
            const symbols = view.envelope.items.map((item) => item.id).filter((id) => !id.startsWith("file:"))
            const subjects = symbols.length > 0 ? symbols : [`file:${rel}`]
            const parts: CanonicalAnswer[] = []
            for (const symbol of subjects) {
              parts.push(track(await runtime.query(directory, { kind: "impact", symbol, limit, depth })))
            }
            return parts
          }
          if (changesMode) {
            const changed = await collectChangedPaths(directory)
            const parts: CanonicalAnswer[] = []
            for (const file of changed) {
              parts.push(...(await impactSubjectsForFile(normalizeRel(file))))
            }
            return { envelope: mergedImpactEnvelope(summary, directory, changed, parts), extraUnresolved: [] }
          }
          const kind = args.subjectKind ?? inferSubjectKind(subject as string)
          if (kind === "file" || kind === "changes") {
            const rel = normalizeRel(subject as string)
            const parts = await impactSubjectsForFile(rel)
            return { envelope: mergedImpactEnvelope(summary, directory, [subject as string], parts), extraUnresolved: [] }
          }
          const resolved = await resolveSubjectId(runtime, track, directory, subject as string, limit ?? 20)
          const answer = track(await runtime.query(directory, { kind: "impact", symbol: resolved, limit, depth }))
          return { envelope: answer.envelope, extraUnresolved: [] }
        }
        const resolved = await resolveSubjectId(runtime, track, directory, subject as string, limit ?? 20)
        const answer = track(await runtime.query(directory, { kind: "tests", target: resolved, limit }))
        return { envelope: answer.envelope, extraUnresolved: [] }
      }

      let pin = summary.generation
      let built = await runOp().catch((): null => null)
      if (built === null) return unavailable(["index-failed"])
      let restarted = false
      if (pin !== null && generations.some((generation) => generation !== null && generation !== pin)) {
        restarted = true
        generations.length = 0
        try {
          summary = await runtime.readIndex(directory, { block: true })
        } catch {
          return unavailable(["index-failed"])
        }
        pin = summary.generation
        built = await runOp().catch((): null => null)
        if (built === null) return unavailable(["index-failed"])
      }

      const envelope = buildAgentContext({
        op,
        level: (args.depth ?? 2) as 1 | 2 | 3,
        envelope: built.envelope,
        subjects: toSubjects(op, args),
        correlation: correlationOf(summary, directory),
        status: {
          ...(pin === null ? {} : { generation: pin }),
          reasons: [
            `generation:${pin ?? "none"}`,
            ...(restarted ? ["generation-changed-restarted"] : []),
            ...(summary.indexTruncated ? ["index-truncated"] : []),
          ],
        },
        unresolved: built.extraUnresolved.map((reason) => ({ kind: "unresolved" as const, id: reason, reason })),
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
