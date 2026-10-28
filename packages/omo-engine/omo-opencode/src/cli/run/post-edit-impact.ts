/**
 * post-edit-impact.ts - post-edit impact analysis over the run directory.
 *
 * After the agent edits files, the run path needs to know what the change
 * may have broken. This module derives the change set (git status, unless
 * the caller already holds one), runs the engine's own `impact` query over
 * the changed files plus `findTests` over the same set, and shapes both
 * into one agent-context envelope. Totals always come from the engine
 * query totals, never from the displayed rows.
 *
 * Freshness is revision-compared, never assumed: when the current worktree
 * revision differs from the revision the graph was built at, the envelope
 * is marked stale and the result is flagged invalidated, so a stale
 * snapshot is never presented as current.
 */

import { execFile } from "node:child_process"
import path from "node:path"

import {
  buildAgentContext,
  computeScopeFingerprint,
  findTests,
  impact,
  indexFiles,
  type FindTestsResult,
  type GraphContextEnvelope,
  type ImpactResult,
  type QueryEnvelope,
  type QueryItem,
  type QueryOptions,
  type QueryScope,
  type QueryTotals,
} from "../../../../code-graph/src/index.ts"
import { resolveProjectIdentity } from "../../../../memory-core/src/project-knowledge/identity.ts"
import {
  collectSourceFiles,
  PLAN_EVIDENCE_MAX_FILES,
  readWorktreeRevision,
} from "./plan-evidence.ts"

export interface ChangedFile {
  readonly path: string
  readonly status: string
}

export type PostEditRefresh = "reused" | "refreshed" | "unavailable"

export interface PostEditImpact {
  readonly changed: readonly ChangedFile[]
  readonly envelope: GraphContextEnvelope
  readonly unrelatedExpansion: readonly string[]
  readonly invalidated: boolean
  readonly refresh: PostEditRefresh
}

export interface AnalyzePostEditInput {
  readonly directory: string
  readonly graphRevision?: string
  readonly graphGeneration?: string
  readonly files?: readonly ChangedFile[]
}

/** Injectable git runner for tests: receives the argv, returns stdout. */
export type ChangedFilesRunner = (cmd: readonly string[]) => Promise<{ stdout: string }>

/** Bounded re-index cap, shared with the planner evidence path. */
export const POST_EDIT_MAX_FILES = PLAN_EVIDENCE_MAX_FILES
/** Cap on symbol subjects per changed file: the impact walk is bounded per subject. */
export const POST_EDIT_SUBJECTS_PER_FILE = 4
/** Cap on symbol subjects across all changed files. */
export const POST_EDIT_MAX_SUBJECTS = 8

function defaultRunner(directory: string): ChangedFilesRunner {
  return (cmd) =>
    new Promise<{ stdout: string }>((resolve, reject) => {
      execFile("git", [...cmd], { cwd: directory }, (error, stdout) => {
        if (error !== null) {
          reject(error)
          return
        }
        resolve({ stdout: String(stdout) })
      })
    })
}

function parsePorcelain(stdout: string): ChangedFile[] {
  const changed: ChangedFile[] = []
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0 || line.length < 4) continue
    const code = line.slice(0, 2)
    let file = line.slice(3)
    // Renames print as "old -> new": the new path is the changed file.
    const arrow = file.indexOf(" -> ")
    if (arrow >= 0) file = file.slice(arrow + 4)
    file = file.trim().replace(/^"|"$/g, "")
    if (file.length === 0) continue
    changed.push({ path: file, status: code.trim() })
  }
  return changed
}

/**
 * The working-tree change set from `git status --porcelain`. Never throws:
 * outside a repository (or when git fails) the tree counts as clean, and a
 * caller holding its own change set passes it via `analyzePostEdit` instead.
 */
export async function collectChangedFiles(
  directory: string,
  run?: (cmd: readonly string[]) => Promise<{ stdout: string }>,
): Promise<readonly ChangedFile[]> {
  const exec = run ?? defaultRunner(directory)
  let stdout: string
  try {
    stdout = (await exec(["status", "--porcelain"])).stdout
  } catch {
    return []
  }
  return parsePorcelain(stdout)
}

/** POSIX path of a changed file relative to the snapshot root. */
function snapshotRel(snapshotRoot: string, directory: string, changedPath: string): string {
  const absolute = path.resolve(directory, changedPath)
  const rel = path.relative(snapshotRoot, absolute)
  return rel.split(path.sep).join("/")
}

function unionStrings(lists: readonly (readonly string[])[]): string[] {
  const out: string[] = []
  for (const list of lists) {
    for (const value of list) {
      if (!out.includes(value)) out.push(value)
    }
  }
  return out
}

type Coverage = QueryEnvelope["coverage"]

function combineCoverage(results: readonly { readonly coverage: Coverage }[]): Coverage {
  if (results.length === 0) return "unindexed"
  if (results.every((result) => result.coverage === "unindexed")) return "unindexed"
  if (results.some((result) => result.coverage === "partial")) return "partial"
  return "indexed"
}

function combineCompleteness(
  results: readonly Pick<QueryEnvelope, "completeness" | "completenessReason">[],
): Pick<QueryEnvelope, "completeness" | "completenessReason"> {
  let truncatedReason: QueryEnvelope["completenessReason"]
  let partialReason: QueryEnvelope["completenessReason"]
  for (const result of results) {
    if (result.completeness === "truncated" && truncatedReason === undefined) {
      truncatedReason = result.completenessReason
    } else if (result.completeness === "partial" && partialReason === undefined) {
      partialReason = result.completenessReason
    }
  }
  if (truncatedReason !== undefined || results.some((result) => result.completeness === "truncated")) {
    const decided: Pick<QueryEnvelope, "completeness" | "completenessReason"> =
      truncatedReason === undefined
        ? { completeness: "truncated" }
        : { completeness: "truncated", completenessReason: truncatedReason }
    return decided
  }
  if (partialReason !== undefined || results.some((result) => result.completeness === "partial")) {
    const decided: Pick<QueryEnvelope, "completeness" | "completenessReason"> =
      partialReason === undefined
        ? { completeness: "partial" }
        : { completeness: "partial", completenessReason: partialReason }
    return decided
  }
  return { completeness: "complete" }
}

/**
 * Engine totals across the per-subject answers. `known` is only meaningful for a
 * single subject: summing it across subjects counts a node reachable from two
 * of them twice while `displayed` counts it once, so a multi-subject merge
 * reports `known: null` (unknown union) instead of an inflated number.
 */
function combineTotals(
  results: readonly { readonly totals?: QueryTotals }[],
  displayed: number,
): QueryTotals {
  let known: number | null = results.length === 1 ? 0 : null
  const byDepth = new Map<number, number>()
  const byKind = new Map<string, number>()
  for (const result of results) {
    const totals = result.totals
    if (totals?.known === null || totals?.known === undefined) {
      known = null
    } else if (known !== null) {
      known += totals.known
    }
    for (const entry of totals?.byDepth ?? []) {
      byDepth.set(entry.depth, (byDepth.get(entry.depth) ?? 0) + entry.count)
    }
    for (const entry of totals?.byKind ?? []) {
      byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + entry.count)
    }
  }
  const totals: QueryTotals = {
    displayed,
    known,
    hidden: known === null ? null : Math.max(0, known - displayed),
  }
  if (byDepth.size > 0) {
    return {
      ...totals,
      byDepth: [...byDepth.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([depth, count]) => ({ depth, count })),
      byKind: [...byKind.entries()]
        .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
        .map(([kind, count]) => ({ kind, count })),
    }
  }
  if (byKind.size > 0) {
    return {
      ...totals,
      byKind: [...byKind.entries()]
        .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
        .map(([kind, count]) => ({ kind, count })),
    }
  }
  return totals
}

function cleanEnvelope(
  directory: string,
  projectId: string,
  changed: readonly ChangedFile[],
  currentRevision: string | undefined,
  graphGeneration: string | undefined,
  stale: boolean,
): GraphContextEnvelope {
  return buildAgentContext({
    op: "impact",
    level: 1,
    subjects: changed.map((file) => ({ kind: "file" as const, id: file.path })),
    correlation: {
      projectId,
      worktreeId: directory,
      revision: currentRevision,
      generation: graphGeneration,
    },
    status: {
      freshness: stale ? "stale" : "fresh",
      queryServable: false,
      reasons: [currentRevision === undefined ? "no-revision" : "clean-tree"],
    },
    reasonCodes: ["POST_EDIT_CLEAN"],
  })
}

/**
 * Impact of the working-tree change set. Never throws: every exit that
 * cannot produce a trustworthy answer returns `queryServable: false` with
 * the reason, mirroring the planner evidence posture.
 *
 * Refresh vocabulary: "reused" when the graph baseline is still current
 * (no revision drift) and backs the answer; "refreshed" when the revision
 * drifted and a bounded re-index actually ran, so the answer is re-based
 * rather than reused; "unavailable" when no query ran or no re-index could.
 */
export async function analyzePostEdit(input: AnalyzePostEditInput): Promise<PostEditImpact> {
  const directory = path.resolve(input.directory)
  const changed: readonly ChangedFile[] =
    input.files === undefined ? await collectChangedFiles(directory) : [...input.files]
  const currentRevision = await readWorktreeRevision(directory)
  const projectId = resolveProjectIdentity(directory).projectId
  const stale =
    input.graphRevision !== undefined &&
    currentRevision !== undefined &&
    currentRevision !== input.graphRevision

  if (changed.length === 0) {
    return {
      changed,
      envelope: cleanEnvelope(directory, projectId, changed, currentRevision, input.graphGeneration, stale),
      unrelatedExpansion: [],
      invalidated: stale,
      refresh: "unavailable",
    }
  }

  let snapshot: ReturnType<typeof indexFiles>
  try {
    const files = await collectSourceFiles(directory, POST_EDIT_MAX_FILES)
    if (files.length === 0) throw new Error("no-source-files")
    snapshot = indexFiles(files)
  } catch {
    return {
      changed,
      envelope: buildAgentContext({
        op: "impact",
        level: 1,
        subjects: changed.map((file) => ({ kind: "file" as const, id: file.path })),
        correlation: {
          projectId,
          worktreeId: directory,
          revision: currentRevision,
          generation: input.graphGeneration,
        },
        status: {
          freshness: stale ? "stale" : "fresh",
          queryServable: false,
          reasons: ["reindex-failed"],
        },
        reasonCodes: ["POST_EDIT_REINDEX_FAILED"],
      }),
      unrelatedExpansion: changed.map((file) => file.path),
      invalidated: stale,
      refresh: "unavailable",
    }
  }

  const scopeRevision = currentRevision ?? input.graphRevision ?? "0".repeat(40)
  const scope: QueryScope = {
    projectId,
    worktreeId: directory,
    revision: scopeRevision,
    fingerprint: computeScopeFingerprint(projectId, directory, scopeRevision),
  }
  const options: QueryOptions = { scope, freshness: stale ? "stale" : "fresh" }
  const snapshotRoot = snapshot.root ?? directory

  const rels = changed.map((file) => ({
    file,
    rel: snapshotRel(snapshotRoot, directory, file.path),
  }))

  const symbolSubjects: string[] = []
  for (const { rel } of rels) {
    if (symbolSubjects.length >= POST_EDIT_MAX_SUBJECTS) break
    let perFile = 0
    for (const node of snapshot.nodes) {
      if (symbolSubjects.length >= POST_EDIT_MAX_SUBJECTS || perFile >= POST_EDIT_SUBJECTS_PER_FILE) break
      if (node.kind !== "symbol" || node.file !== rel) continue
      if (symbolSubjects.includes(node.id)) continue
      symbolSubjects.push(node.id)
      perFile += 1
    }
  }

  const impactResults: ImpactResult[] = symbolSubjects.map((subject) => impact(snapshot, subject, options))
  const testsResults: FindTestsResult[] = rels.map(({ rel }) => findTests(snapshot, rel, options))
  const results: readonly QueryEnvelope[] = [...impactResults, ...testsResults]

  const items: QueryItem[] = []
  const seen = new Set<string>()
  for (const result of results) {
    for (const item of result.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }

  const coverage = combineCoverage(results)
  const completeness = combineCompleteness(results)
  const merged: QueryEnvelope = {
    projectId: scope.projectId,
    worktreeId: scope.worktreeId,
    revision: scope.revision,
    fingerprint: scope.fingerprint,
    freshness: stale ? "stale" : "fresh",
    coverage,
    truncated: results.some((result) => result.truncated),
    knowledgeIds: unionStrings(results.map((result) => result.knowledgeIds)),
    unresolved: results.flatMap((result) => result.unresolved),
    unsupported: unionStrings(results.map((result) => result.unsupported)),
    items,
    // An empty envelope contributes no rows and no count, so it must not force
    // the union to "unknown"; a real merge across kinds still does.
    totals: combineTotals(results.filter((result) => result.items.length > 0), items.length),
    ...completeness,
  }

  const envelope = buildAgentContext({
    op: "impact",
    level: 2,
    envelope: merged,
    subjects: changed.map((file) => ({ kind: "file" as const, id: file.path })),
    correlation: {
      projectId,
      worktreeId: directory,
      revision: currentRevision,
      generation: input.graphGeneration,
    },
    status: {
      freshness: stale ? "stale" : "fresh",
      coverage,
      revision: currentRevision,
      generation: input.graphGeneration,
      queryServable: true,
      reasons: stale ? ["revision-mismatch"] : [],
    },
    reasonCodes: stale ? ["POST_EDIT_IMPACT", "POST_EDIT_STALE"] : ["POST_EDIT_IMPACT"],
  })

  // Strictly the impact answer: files none of the impact rows mention.
  // findTests candidates are test coverage, not impact mention, so a
  // changed file covered only by tests still expands the review scope.
  const mentioned = new Set<string>()
  for (const result of impactResults) {
    for (const item of result.items) mentioned.add(item.file)
  }
  const unrelatedExpansion = rels
    .filter(({ rel }) => !mentioned.has(rel))
    .map(({ file }) => file.path)

  return {
    changed,
    envelope,
    unrelatedExpansion,
    invalidated: stale,
    refresh: stale ? "refreshed" : "reused",
  }
}
