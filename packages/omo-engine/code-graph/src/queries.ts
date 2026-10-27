/**
 * Read-only graph queries over an extracted snapshot.
 *
 * Binding: `.omo/ulw/waves/s53-phase-a/schema-draft.md` sections 1-4.
 * Precedent: `extract.ts` (compiler-resolved facts, closed edge set,
 * never-guessed dynamics) and `cache.ts` (scope binding, freshness gates,
 * drop-and-count loading). This module owns query shaping only: it imports
 * extraction and cache types, calls `invalidateEdges` for change detection,
 * and never reimplements extraction, resolution, or cache storage.
 *
 * Envelope contract (every query returns it): repository and worktree
 * identity (`projectId`, `worktreeId`), the pinned `revision` plus its
 * content `fingerprint`, bounded result `items` with source locations,
 * per-item `evidence` with confidence, `freshness` plus `coverage` status,
 * linked knowledge ids, and `unresolved` / `unsupported` notes. Results are
 * always bounded by `limit` (default 20, max 50): no query returns the
 * whole graph.
 *
 * Confidence posture (schema-draft section 3): items surface only static
 * (1.00) facts — definitions, resolved calls, resolved imports, test links,
 * system invalidation facts. Dynamics stay out of `items` and appear only
 * as `unresolved` manual-review notes, never proven.
 *
 * Coverage vocabulary:
 * - `indexed` — the subject was analyzed; the items (possibly empty) are
 *   the complete answer for the analyzed scope.
 * - `partial` — the answer was cut by `limit`; `truncated` is true and the
 *   note names what was cut.
 * - `unindexed` — the subject was never analyzed: an unsupported file type
 *   or a symbol/file absent from the snapshot. Unsupported inputs are
 *   reported, never analyzed.
 */

import { invalidateEdges, isTestPath } from "./extract";
import type { GraphEdge, GraphNode, GraphSnapshot } from "./extract";
import type { StoredBaseline } from "./cache";
import type { InvalidationCause } from "./extract";

/** Repository identity (`<safe-slug>-<sha256-8>`) plus worktree binding. */
export interface QueryScope {
  readonly projectId: string;
  readonly worktreeId: string;
  /** 40-hex pinned revision. Validation owns to `cache.ts`; carried here. */
  readonly revision: string;
  /** 64-hex content binding. Validation owns to `cache.ts`; carried here. */
  readonly fingerprint: string;
}

export type FreshnessStatus = "fresh" | "stale";

export type CoverageStatus = "indexed" | "partial" | "unindexed";

/** One supporting record for an item: which edge, where, how sure. */
export interface QueryEvidence {
  /** Graph edge kind, or `indexed` for node-presence evidence. */
  readonly edge: string;
  /** `file:line` source ref of the site that produced the evidence. */
  readonly ref: string;
  /** Number in [0,1]; always 1 for surfaced static facts. */
  readonly confidence: number;
}

/** Why a search hit matched, from strongest to weakest. */
export type SearchMatchReason =
  | "exact-name"
  | "exact-qualified"
  | "prefix"
  | "token"
  | "substring"
  | "fuzzy";

/** Numeric tier for a {@link SearchMatchReason}: lower wins. */
const SEARCH_RANK = {
  "exact-name": 0,
  "exact-qualified": 1,
  prefix: 2,
  token: 3,
  substring: 4,
  fuzzy: 5,
} satisfies Record<SearchMatchReason, number>;

/** Verdict on a row's evidence: `confirmed` for compiler-resolved edge
 *  kinds, `inferred` for everything else (presence, dynamics, invalidation). */
export type QueryVerdict = "confirmed" | "inferred";

/** Which recon mode the client should render/select for this answer. */
export type SuggestedMode = "explore" | "trace" | "impact";

/** Displayed-vs-walked counts for one named row list. */
export interface ShownCounts {
  readonly shown: number;
  readonly total: number;
}

/**
 * Per-list displayed-vs-walked counts; only the lists the query actually
 * returns are present. Mirrors the query's `totals` for the same rows.
 */
export interface ShownOf {
  readonly callers?: ShownCounts;
  readonly callees?: ShownCounts;
  readonly impacted?: ShownCounts;
  readonly candidates?: ShownCounts;
}

/** One bounded result row: identity, source location, evidence, links. */
export interface QueryItem {
  readonly id: string;
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  readonly name?: string;
  readonly evidence: readonly QueryEvidence[];
  readonly confidence: number;
  /** `pk-` record ids linked from this node via LINKS_KNOWLEDGE. */
  readonly knowledgeIds: readonly string[];
  /** `confirmed` when the primary evidence edge is compiler-resolved, else `inferred`. */
  readonly verdict?: QueryVerdict;
  /** True when the row's file is a test path by the engine's own `isTestPath`. */
  readonly isTest?: boolean;
  /** Search only: which tier produced this hit. Always set by `search`. */
  readonly reason?: SearchMatchReason;
  /** Search only: numeric tier (`SEARCH_RANK[reason]`); lower wins. Always set by `search`. */
  readonly rank?: number;
}

/** Honest size of the answer, independent of how many rows were returned. */
export interface QueryTotals {
  /** Rows returned in `items` (or in the query's primary list). */
  readonly displayed: number;
  /** Rows that exist in the analysed graph, before the display limit — null when the
   *  query cannot establish a complete count (e.g. a search over a truncated index). */
  readonly known: number | null;
  /** Matched rows beyond `displayed`, when `known` is set. */
  readonly hidden: number | null;
  /** Counts per traversal depth, when the query walks (neighbourhood, impact). */
  readonly byDepth?: readonly { readonly depth: number; readonly count: number }[];
  /** Counts per relationship kind actually used by the returned rows. */
  readonly byKind?: readonly { readonly kind: string; readonly count: number }[];
}

export type CompletenessStatus = "complete" | "partial" | "truncated";

export type CompletenessReason =
  | "index-truncated"
  | "index-excluded"
  | "depth-budget"
  | "edge-budget"
  | "time-budget"
  | "result-limit"
  | "unresolved-edges"
  | "unsupported-files";

/** Shared envelope every query returns; per-query extras extend it. */
export interface QueryEnvelope {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly revision: string;
  readonly fingerprint: string;
  readonly freshness: FreshnessStatus;
  readonly coverage: CoverageStatus;
  /** True when `limit` cut the answer; the note names what was cut. */
  readonly truncated: boolean;
  readonly knowledgeIds: readonly string[];
  /** Rows collapsed by id de-duplication; emitted only when greater than 0. */
  readonly duplicatesDropped?: number;
  /** Which recon mode the client should render/select for this answer. */
  readonly suggestedMode?: SuggestedMode;
  /** True when two or more returned rows share a display name but differ in id. */
  readonly ambiguousNames?: boolean;
  /** Per-list displayed-vs-walked counts for the rows this query returns. */
  readonly shownOf?: ShownOf;
  /** Search only: the executed search text, echoed so the panel never re-derives it. */
  readonly query?: string;
  /** Search only: test-file rows suppressed by the caller's own `excludeTests` filter. */
  readonly hiddenTestCount?: number;
  /** Manual-review points (CALLS_UNRESOLVED sites, missing paths). Never facts. */
  readonly unresolved: readonly string[];
  /** Unsupported file types: reported as unindexed, never analyzed. */
  readonly unsupported: readonly string[];
  readonly items: readonly QueryItem[];
  /** Honest row counts; `known` is null when no complete count is knowable. */
  readonly totals?: QueryTotals;
  /** Whether THIS answer is whole: `coverage` still describes the graph. */
  readonly completeness?: CompletenessStatus;
  /** Why the answer is not `complete`; absent exactly when it is. */
  readonly completenessReason?: CompletenessReason;
}

/** "What's connected?" Structured numbers; the client renders the sentence. */
export interface NeighborhoodSummary {
  readonly subjectId: string | null;
  readonly depth: number;
  readonly incoming: number;
  readonly outgoing: number;
  readonly tests: number;
  readonly modulesTouched: readonly string[];
}

/** "How does A reach B?" Structured numbers; the client renders the sentence. */
export interface TraceSummary {
  readonly found: boolean;
  readonly hops: number | null;
  /** Always null: alternative paths are not computed within budget. */
  readonly alternativePaths: number | null;
  readonly reason?:
    | "no-path-in-graph"
    | "blocked-by-unresolved"
    | "budget-exhausted"
    | "start-unresolved"
    | "destination-unresolved"
    | "same-node";
}

/** "What breaks?" Structured numbers; the client renders the sentence. */
export interface ImpactSummary {
  readonly subjectIds: readonly string[];
  readonly dependentFiles: number;
  readonly dependentSymbols: number;
  readonly modules: readonly { readonly module: string; readonly count: number }[];
  readonly testsFound: number;
  readonly callersWithoutTestPath: number;
  readonly unresolvedEdges: number;
  readonly completeness: CompletenessStatus;
}

export interface QueryOptions {
  readonly scope: QueryScope;
  /** Search only: drop test-path rows before the limit; the count surfaces as `hiddenTestCount`. */
  readonly excludeTests?: boolean;
  /** Override when the caller already holds a fresh baseline. */
  readonly baseline?: StoredBaseline;
  /** Caller-observed freshness; defaults to `fresh`. */
  readonly freshness?: FreshnessStatus;
  /** Result cap; clamped to [1, MAX_RESULT_LIMIT]. Defaults to 20. */
  readonly limit?: number;
  /** BFS depth cap for reachability queries; clamped to [1, 10]. Defaults to 5. */
  readonly maxDepth?: number;
  /**
   * Reverse-call edges the impact walk may explore before it stops. A depth cap
   * bounds the levels, not the fan-out inside one level: a symbol called from a
   * thousand places keeps walking for as long as the caller waits. Clamped to
   * [1, MAX_EXPLORED_EDGES].
   */
  readonly maxExploredEdges?: number;
  /**
   * Wall-clock budget for one query's walk, in milliseconds. A depth and an edge
   * cap still allow a wide graph to run for a long time; this stops it and says
   * so. `0` is allowed and means "already expired", which makes the stop
   * testable without timing luck.
   */
  readonly maxQueryMs?: number;
}

export interface SymbolContextResult extends QueryEnvelope {
  readonly definition?: QueryItem;
  readonly callers: readonly QueryItem[];
  readonly callees: readonly QueryItem[];
  readonly summary: NeighborhoodSummary;
}

export interface ImpactResult extends QueryEnvelope {
  readonly subject?: QueryItem;
  readonly impacted: readonly QueryItem[];
  readonly summary: ImpactSummary;
}

export interface TraceStep {
  readonly from: string;
  readonly to: string;
  readonly ref: string;
  readonly confidence: number;
}

export interface TraceResult extends QueryEnvelope {
  readonly path: readonly TraceStep[];
  readonly summary: TraceSummary;
}

export interface FindTestsResult extends QueryEnvelope {
  readonly subjectFile?: string;
  readonly candidates: readonly QueryItem[];
}

export interface QueryChange {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly cause: InvalidationCause;
  readonly ref: string;
  readonly confidence: number;
}

export interface DetectChangesResult extends QueryEnvelope {
  readonly changes: readonly QueryChange[];
}

export const DEFAULT_RESULT_LIMIT = 20;
export const MAX_RESULT_LIMIT = 50;
/** Reverse-call edges one impact walk may explore before it stops and says so. */
export const MAX_EXPLORED_EDGES = 20_000;
/** Wall-clock budget one reachability walk may spend before it stops and says so. */
export const DEFAULT_QUERY_BUDGET_MS = 2_000;
export const MAX_QUERY_BUDGET_MS = 60_000;
const DEFAULT_MAX_DEPTH = 5;
const MAX_DEPTH_LIMIT = 10;
const KNOWLEDGE_PREFIX = "knowledge:";
const SUPPORTED_FILE = /\.[cm]?[tj]sx?$/;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RESULT_LIMIT;
  return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.floor(limit)));
}

function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return DEFAULT_MAX_DEPTH;
  return Math.min(MAX_DEPTH_LIMIT, Math.max(1, Math.floor(depth)));
}

function clampExploredEdges(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_EXPLORED_EDGES;
  return Math.min(MAX_EXPLORED_EDGES, Math.max(1, Math.floor(value)));
}

function clampQueryBudgetMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_QUERY_BUDGET_MS;
  return Math.min(MAX_QUERY_BUDGET_MS, Math.max(0, Math.floor(value)));
}

/**
 * Deterministic server-side ranking for context/impact rows: distance from
 * the subject asc, then confidence desc, then relationship kind priority
 * (TESTS > IMPORTS > CALLS_STATIC > CALLS_UNRESOLVED), then id asc. The
 * same input always produces the same order; the client never re-sorts.
 */
/** Owner contract for the relationship-kind priority map `kindRank` reads. */
interface EdgeKindPriority {
  readonly TESTS: number;
  readonly IMPORTS: number;
  readonly CALLS_STATIC: number;
  readonly CALLS_UNRESOLVED: number;
  readonly [kind: string]: number;
}

const KIND_PRIORITY: EdgeKindPriority = {
  TESTS: 0,
  IMPORTS: 1,
  CALLS_STATIC: 2,
  CALLS_UNRESOLVED: 3,
};

function kindRank(edge: string): number {
  return KIND_PRIORITY[edge] ?? 4;
}

/**
 * Edge kinds backed by compiler-resolved facts. Everything else a row can
 * carry (`indexed` presence, `INVALIDATED_BY`, `LINKS_KNOWLEDGE`,
 * `CALLS_UNRESOLVED`) is not proven, so the row is `inferred`.
 */
const CONFIRMED_EVIDENCE_KINDS: ReadonlySet<string> = new Set([
  "DEFINES",
  "EXPORTS",
  "IMPORTS",
  "CALLS_STATIC",
  "TESTS",
]);

/**
 * Client contract mapping (recon-client-modes section 5): the verdict for
 * a row's primary evidence edge kind. Exported so the panel never invents
 * the mapping itself.
 */
export function verdictForEvidenceKind(edge: string): QueryVerdict {
  return CONFIRMED_EVIDENCE_KINDS.has(edge) ? "confirmed" : "inferred";
}

/** Collapse rows sharing an id (first wins); the envelope reports the count. */
/** Kept rows plus how many id duplicates collapsed. */
interface DedupedItems {
  readonly items: readonly QueryItem[];
  readonly dropped: number;
}

function dedupeById(items: readonly QueryItem[]): DedupedItems {
  const seen = new Set<string>();
  const kept: QueryItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    kept.push(item);
  }
  return { items: kept, dropped: items.length - kept.length };
}

/** `duplicatesDropped`, emitted only when rows were actually collapsed. */
function duplicatesExtra(dropped: number): { readonly duplicatesDropped?: number } {
  return dropped > 0 ? { duplicatesDropped: dropped } : {};
}

/**
 * `ambiguousNames`, emitted only when two returned rows share a display
 * name but differ in id. Nameless rows carry no display name and never count.
 */
/** Present only when two returned rows share a display name but differ in id. */
interface AmbiguousNamesExtra {
  readonly ambiguousNames: true;
}

function ambiguousExtra(items: readonly QueryItem[]): AmbiguousNamesExtra | undefined {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (item.name === undefined || item.name === "") continue;
    const first = seen.get(item.name);
    if (first === undefined) {
      seen.set(item.name, item.id);
    } else if (first !== item.id) {
      return { ambiguousNames: true as const };
    }
  }
  return undefined;
}

function primaryKind(item: QueryItem): string {
  return item.evidence[0]?.edge ?? "indexed";
}

function compareRows(depthA: number, a: QueryItem, depthB: number, b: QueryItem): number {
  if (depthA !== depthB) return depthA - depthB;
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  const kindDelta = kindRank(primaryKind(a)) - kindRank(primaryKind(b));
  if (kindDelta !== 0) return kindDelta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Counts per relationship kind actually used by the returned rows. */
function byKindFor(items: readonly QueryItem[]): QueryTotals["byKind"] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const kind = primaryKind(item);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => kindRank(left[0]) - kindRank(right[0]) || (left[0] < right[0] ? -1 : 1))
    .map(([kind, count]) => ({ kind, count }));
}

/**
 * The graph's own evidence that the extraction index is partial: files the
 * extractor refused (`dropped`, outside the index root) or skipped from
 * the content index (binary, too large), or per-file token caps that cut
 * the token map. A partial index cannot support an honest total, so
 * counting queries answer `known: null` with `index-truncated` instead of
 * a floor dressed as a count. Absent on legacy snapshots: no evidence of
 * truncation means the index counts as whole.
 */
function indexTruncationNote(snapshot: GraphSnapshot): string | undefined {
  const dropped = snapshot.dropped ?? [];
  if (dropped.length > 0) {
    const named = dropped
      .slice(0, 3)
      .map((entry) => entry.file)
      .join(", ");
    const rest = dropped.length > 3 ? ` and ${dropped.length - 3} more` : "";
    return `index truncated: ${dropped.length} file(s) excluded from the snapshot (${named}${rest})`;
  }
  const content = snapshot.content;
  if (content === undefined) return undefined;
  if (content.skipped.length > 0) {
    return `index truncated: ${content.skipped.length} file(s) skipped from the content index (binary or too large to index)`;
  }
  const capped = Object.values(content.files).filter((entry) => entry.tokenTruncated).length;
  if (capped > 0) {
    return `index truncated: ${capped} file(s) hit the per-file token cap (${content.tokenCap})`;
  }
  return undefined;
}

/**
 * `coverage` describes the INDEX an answer was read from, never the answer's own cut.
 *
 * A row limit or a depth budget makes an answer incomplete, and `completeness` with
 * `completenessReason` already says so (`result-limit`, `depth-budget`). Reporting that
 * through `coverage` as well claimed the index itself was partial and hid the difference
 * between "this project is only partly analysed" and "you asked for the first 20 of 47" -
 * the same conflation Phase 1 fixed for the walk flag.
 */
function indexCoverage(snapshot: GraphSnapshot): CoverageStatus {
  return indexTruncationNote(snapshot) === undefined ? "indexed" : "partial";
}

/** Which rows the answer may claim; the reason stays absent exactly when complete. */
interface CompletenessDecision {
  readonly completeness: CompletenessStatus;
  readonly completenessReason?: CompletenessReason;
}

function decideCompleteness(flags: {
  readonly unsupported: boolean;
  readonly excluded: boolean;
  readonly indexPartial: boolean;
  /** Optional so the call sites that cannot hit the edge budget stay untouched. */
  readonly edgeBudget?: boolean;
  /** Optional for the same reason: only the walks can run out of wall time. */
  readonly timeBudget?: boolean;
  readonly depthBudget: boolean;
  readonly unresolvedEdges: boolean;
  readonly cut: boolean;
}): CompletenessDecision {
  if (flags.unsupported) return { completeness: "partial", completenessReason: "unsupported-files" };
  if (flags.excluded) return { completeness: "partial", completenessReason: "index-excluded" };
  if (flags.indexPartial) return { completeness: "partial", completenessReason: "index-truncated" };
  // The edge budget outranks the depth budget: a walk stopped mid-level explored
  // fewer relationships than the depth alone would have allowed.
  // The wall-clock budget outranks the edge budget: a walk stopped by time
  // explored fewer relationships than its edge allowance would have permitted.
  if (flags.timeBudget === true) return { completeness: "truncated", completenessReason: "time-budget" };
  if (flags.edgeBudget === true) return { completeness: "truncated", completenessReason: "edge-budget" };
  if (flags.depthBudget) return { completeness: "truncated", completenessReason: "depth-budget" };
  if (flags.unresolvedEdges) return { completeness: "partial", completenessReason: "unresolved-edges" };
  if (flags.cut) return { completeness: "truncated", completenessReason: "result-limit" };
  return { completeness: "complete" };
}

/** First path segment of a file, `(root)` when the file sits at the top level. */
function moduleFor(file: string): string {
  const slash = file.indexOf("/");
  return slash < 0 ? "(root)" : file.slice(0, slash);
}

/** Per-module dependent counts, sorted by count desc then module asc. */
function moduleCounts(items: readonly { readonly file: string }[]): ImpactSummary["modules"] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const module = moduleFor(item.file);
    counts.set(module, (counts.get(module) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([module, count]) => ({ module, count }));
}

/**
 * A dependent has a test path when it IS a test file or a TESTS edge
 * targets it or its file. Directory proximity is never evidence: a test
 * file merely sitting in the same directory proves nothing.
 */
function hasTestPath(snapshot: GraphSnapshot, item: QueryItem): boolean {
  if (isTestPath(item.file)) return true;
  const index = indexFor(snapshot);
  const direct = index.edgesByTo.get(item.id) ?? [];
  if (direct.some((edge) => edge.kind === "TESTS")) return true;
  const fileEdges = index.edgesByTo.get(`file:${item.file}`) ?? [];
  return fileEdges.some((edge) => edge.kind === "TESTS");
}

/** Zeroed impact summary for answers with no walked dependents. */
function emptyImpactSummary(subjectIds: readonly string[], completeness: CompletenessStatus): ImpactSummary {
  return {
    subjectIds,
    dependentFiles: 0,
    dependentSymbols: 0,
    modules: [],
    testsFound: 0,
    callersWithoutTestPath: 0,
    unresolvedEdges: 0,
    completeness,
  };
}

/** CALLS_UNRESOLVED edges out of one node: dynamics to review, never facts. */
function unresolvedEdgesFrom(snapshot: GraphSnapshot, nodeId: string): GraphEdge[] {
  return (indexFor(snapshot).edgesByFrom.get(nodeId) ?? []).filter(
    (edge) => edge.kind === "CALLS_UNRESOLVED",
  );
}

/** Scope prefers an already-held baseline; the explicit scope is the fallback. */
export function scopeFromBaseline(baseline: StoredBaseline): QueryScope {
  return {
    projectId: baseline.scope.projectId,
    worktreeId: baseline.scope.worktreeId,
    revision: baseline.scope.revision,
    fingerprint: baseline.scope.fingerprint,
  };
}

function resolveScope(options: QueryOptions): QueryScope {
  if (options.baseline !== undefined) return scopeFromBaseline(options.baseline);
  return options.scope;
}

/** Identity plus freshness every query envelope carries; per-query extras extend it. */
interface BaseEnvelope {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly revision: string;
  readonly fingerprint: string;
  readonly freshness: FreshnessStatus;
}

function baseEnvelope(scope: QueryScope, freshness: FreshnessStatus): BaseEnvelope {
  return {
    projectId: scope.projectId,
    worktreeId: scope.worktreeId,
    revision: scope.revision,
    fingerprint: scope.fingerprint,
    freshness,
  };
}

function isSupportedPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  if (!base.includes(".")) return false;
  return SUPPORTED_FILE.test(base);
}

function unsupportedNote(path: string): string {
  return `unsupported file type: ${path} is unindexed (never analyzed)`;
}

/** File part of a `name@file` symbol id, or undefined for file ids. */
function symbolFilePart(symbolId: string): string | undefined {
  const at = symbolId.lastIndexOf("@");
  if (at < 0) return undefined;
  return symbolId.slice(at + 1);
}

function indexedEvidence(node: GraphNode): QueryEvidence {
  return { edge: "indexed", ref: `${node.file}:${node.line}`, confidence: 1 };
}

/** `pk-` record ids linked from any of the given node ids. */
function knowledgeIdsFor(snapshot: GraphSnapshot, nodeIds: ReadonlySet<string>): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  const knowledgeTargets = new Map<string, string>();
  for (const node of snapshot.nodes) {
    if (node.kind === "knowledge-link" && node.target !== undefined) {
      knowledgeTargets.set(node.id, node.target);
    }
  }
  for (const edge of snapshot.edges) {
    if (edge.kind !== "LINKS_KNOWLEDGE") continue;
    if (!nodeIds.has(edge.from)) continue;
    const recordId = knowledgeTargets.get(edge.to);
    if (recordId === undefined) continue;
    const list = byNode.get(edge.from);
    if (list) {
      if (!list.includes(recordId)) list.push(recordId);
    } else {
      byNode.set(edge.from, [recordId]);
    }
  }
  return byNode;
}

function unionKnowledge(linked: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const ids of linked.values()) {
    for (const id of ids) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

function toItem(
  node: GraphNode,
  evidence: readonly QueryEvidence[],
  knowledge: readonly string[],
): QueryItem {
  const item: QueryItem = {
    id: node.id,
    file: node.file,
    line: node.line,
    evidence,
    confidence: 1,
    knowledgeIds: knowledge,
    verdict: verdictForEvidenceKind(evidence[0]?.edge ?? "indexed"),
    isTest: isTestPath(node.file),
  };
  return node.name === undefined ? item : { ...item, name: node.name };
}

function nodeItem(
  snapshot: GraphSnapshot,
  node: GraphNode,
  evidence: readonly QueryEvidence[],
): QueryItem {
  const linked = knowledgeIdsFor(snapshot, new Set([node.id, `file:${node.file}`]));
  const own = [...(linked.get(node.id) ?? []), ...(linked.get(`file:${node.file}`) ?? [])].filter(
    (id, index, all) => all.indexOf(id) === index,
  );
  return toItem(node, evidence.length > 0 ? evidence : [indexedEvidence(node)], own);
}

function unresolvedFor(snapshot: GraphSnapshot, symbolId: string): string[] {
  return snapshot.edges
    .filter((edge) => edge.kind === "CALLS_UNRESOLVED" && edge.from === symbolId)
    .map((edge) => `${edge.ref} calls an unknown callee (manual review, never proven)`)
    .sort();
}

/**
 * Tiered search over file and symbol nodes: exact-name and
 * exact-qualified outrank prefix, token/camelCase and substring matches,
 * with a fuzzy near-miss tier last so typos still find their symbol.
 * Every item carries its `reason` plus numeric `rank` (lower wins); ties
 * break by reason priority (exact-name first), then the shorter file path,
 * then the stable id. A path-shaped query with an unsupported extension
 * reports unindexed instead of searching: non-program files are never
 * analyzed.
 */
export function search(
  snapshot: GraphSnapshot,
  query: string,
  options: QueryOptions,
): QueryEnvelope {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const needle = query.toLowerCase();
  if (needle.trim().length === 0) {
    // An empty needle matches every node as a prefix tier, which would answer the
    // whole graph behind a limit. Say so instead of returning an arbitrary slice.
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "explore",
      query,
      coverage: "indexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: ["empty query: name or path fragment required"],
      unsupported: [],
      items: [],
      totals: { displayed: 0, known: 0, hidden: 0 },
      completeness: "complete" as const,
    };
  }
  if ((query.includes("/") || query.includes("\\")) && !isSupportedPath(query)) {
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "explore",
      query,
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(query)],
      items: [],
      totals: { displayed: 0, known: null, hidden: null },
      completeness: "partial" as const,
      completenessReason: "unsupported-files" as const,
    };
  }
  const queryTokens = tokenizeIdentifier(query);
  const ranked: { node: GraphNode; reason: SearchMatchReason; rank: number; distance?: number }[] = [];
  for (const node of snapshot.nodes) {
    if (node.kind !== "file" && node.kind !== "symbol") continue;
    const match = matchSearchTier(node, needle, queryTokens);
    if (match !== undefined) ranked.push({ node, ...match });
  }
  ranked.sort((left, right) => rankCompare(left, right));
  // The caller's own test filter applies before the limit so test rows never
  // steal display slots; the suppressed count travels as `hiddenTestCount`.
  // The surviving rows keep their server-side rank order: the panel never re-sorts.
  const eligible = options.excludeTests === true ? ranked.filter(({ node }) => !isTestPath(node.file)) : ranked;
  const hiddenTests = ranked.length - eligible.length;
  const truncated = eligible.length > limit;
  const deduped = dedupeById(
    eligible.slice(0, limit).map(({ node, reason, rank }) => ({
      ...nodeItem(snapshot, node, definesEvidence(snapshot, node)),
      reason,
      rank,
    })),
  );
  const items = deduped.items;
  // A bounded search never claims a total: over a truncated index the
  // walked count is a floor, so `known` stays null instead of dressing it
  // as a count. Over a whole index every match is counted before the cut.
  const indexNote = indexTruncationNote(snapshot);
  const notes = truncated ? [`truncated to ${limit} of ${eligible.length} matches`] : [];
  if (indexNote !== undefined) notes.push(indexNote);
  const decided = decideCompleteness({
    unsupported: false,
    excluded: false,
    indexPartial: indexNote !== undefined,
    depthBudget: false,
    unresolvedEdges: false,
    cut: truncated,
  });
  const envelope: QueryEnvelope = {
    ...baseEnvelope(scope, freshness),
    suggestedMode: "explore",
    query,
    ...duplicatesExtra(deduped.dropped),
    ...ambiguousExtra(items),
    shownOf: { candidates: { shown: items.length, total: eligible.length } },
    coverage: indexCoverage(snapshot),
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved: notes,
    unsupported: [],
    items,
    totals:
      indexNote !== undefined
        ? { displayed: items.length, known: null, hidden: null, byKind: byKindFor(items) }
        : { displayed: items.length, known: eligible.length, hidden: eligible.length - items.length, byKind: byKindFor(items) },
    ...decided,
  };
  return hiddenTests > 0 ? { ...envelope, hiddenTestCount: hiddenTests } : envelope;
}

/** Split an identifier or path into lowercase tokens on separators, camel humps, and letter/digit edges. */
function tokenizeIdentifier(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(/[^A-Za-z0-9]+/)) {
    if (part.length === 0) continue;
    for (const hump of part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      for (const piece of hump.split(/(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/)) {
        if (piece.length > 0) out.push(piece.toLowerCase());
      }
    }
  }
  return out;
}

/** True when `a` and `b` are within `maxDist` edits (early-exit Levenshtein). */
function withinEditDistance(a: string, b: string, maxDist: number): boolean {
  if (Math.abs(a.length - b.length) > maxDist) return false;
  if (a === b) return true;
  let prev: number[] = [];
  for (let j = 0; j <= b.length; j += 1) prev.push(j);
  for (let i = 1; i <= a.length; i += 1) {
    const curr: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const cell = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(cell);
      if (cell < rowMin) rowMin = cell;
    }
    if (rowMin > maxDist) return false;
    prev = curr;
  }
  return prev[b.length] <= maxDist;
}

/** First tier that matches, strongest first; undefined when nothing matches. */
function matchSearchTier(
  node: GraphNode,
  needle: string,
  queryTokens: readonly string[],
): { reason: SearchMatchReason; rank: number; distance?: number } | undefined {
  const nameLower = (node.name ?? "").toLowerCase();
  const idLower = node.id.toLowerCase();
  const fileLower = node.file.toLowerCase();
  const baseLower = fileLower.split("/").pop() ?? fileLower;
  if (needle.length === 0) return { reason: "prefix", rank: SEARCH_RANK.prefix };
  if (nameLower === needle) return { reason: "exact-name", rank: SEARCH_RANK["exact-name"] };
  if (baseLower === needle) return { reason: "exact-name", rank: SEARCH_RANK["exact-name"] };
  if (idLower === needle || `${nameLower}@${fileLower}` === needle) {
    return { reason: "exact-qualified", rank: SEARCH_RANK["exact-qualified"] };
  }
  if (nameLower.startsWith(needle)) return { reason: "prefix", rank: SEARCH_RANK.prefix };
  if (baseLower.startsWith(needle)) return { reason: "prefix", rank: SEARCH_RANK.prefix };
  if (tokenMatches(node, queryTokens)) return { reason: "token", rank: SEARCH_RANK.token };
  if (nameLower.includes(needle) || fileLower.includes(needle) || idLower.includes(needle)) {
    return { reason: "substring", rank: SEARCH_RANK.substring };
  }
  const distance = fuzzyDistance(nameLower, needle);
  if (distance !== null) return { reason: "fuzzy", rank: SEARCH_RANK.fuzzy, distance };
  return undefined;
}

/** A query token (length 2+) is an exact or prefix hit on a name/file token. */
function tokenMatches(node: GraphNode, queryTokens: readonly string[]): boolean {
  const useful = queryTokens.filter((token) => token.length >= 2);
  if (useful.length === 0) return false;
  const targets = [...tokenizeIdentifier(node.name ?? ""), ...tokenizeIdentifier(node.file)];
  if (targets.length === 0) return false;
  // One direction only: the indexed token starts with the query token.
  // The reverse (query starts with token) would promote typos such as
  // "slugfy" (starts with the "slug" token) into the token tier and
  // starve the fuzzy tier below it.
  const hits = (query: string): boolean => targets.some((target) => target === query || target.startsWith(query));
  // Every query token must hit: a multi-token query is a conjunction, never a
  // disjunction. "operations.ts" once matched every TypeScript file through its
  // "ts" token, which buried the file the user named under unrelated symbols.
  return useful.every(hits);
}

/** Near-miss typo: same first letter, edit distance 1 (short) or 2 (longer). */
/** Smallest edit distance to a name or one of its tokens, or null when nothing is close enough. */
function fuzzyDistance(nameLower: string, needle: string): number | null {
  if (needle.length < 3 || nameLower.length === 0) return null;
  if (nameLower[0] !== needle[0]) return null;
  const maxDist = needle.length <= 4 ? 1 : 2;
  let best: number | null = null;
  const consider = (candidate: string): void => {
    if (candidate.length === 0 || candidate[0] !== needle[0]) return;
    for (let distance = 1; distance <= maxDist; distance += 1) {
      if (best !== null && distance >= best) return;
      if (withinEditDistance(needle, candidate, distance)) {
        best = distance;
        return;
      }
    }
  };
  consider(nameLower);
  for (const token of tokenizeIdentifier(nameLower)) consider(token);
  return best;
}

function rankCompare(
  left: { node: GraphNode; reason: SearchMatchReason; rank: number; distance?: number },
  right: { node: GraphNode; reason: SearchMatchReason; rank: number; distance?: number },
): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  const reasonDelta = SEARCH_RANK[left.reason] - SEARCH_RANK[right.reason];
  if (reasonDelta !== 0) return reasonDelta;
  // Within the fuzzy tier the closer typo wins: a distance-1 candidate must not
  // lose to a distance-2 one merely because its path is shorter.
  const leftDistance = left.distance ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.distance ?? Number.POSITIVE_INFINITY;
  if (leftDistance !== rightDistance) return leftDistance - rightDistance;
  // A file node outranks symbols defined in it: a basename query names the file.
  if (left.node.kind !== right.node.kind) return left.node.kind === "file" ? -1 : 1;
  if (left.node.file.length !== right.node.file.length) return left.node.file.length - right.node.file.length;
  if (left.node.file !== right.node.file) return left.node.file < right.node.file ? -1 : 1;
  return left.node.id < right.node.id ? -1 : left.node.id > right.node.id ? 1 : 0;
}

function definesEvidence(snapshot: GraphSnapshot, node: GraphNode): QueryEvidence[] {
  if (node.kind === "file") return [indexedEvidence(node)];
  const evidence = (indexFor(snapshot).edgesByTo.get(node.id) ?? [])
    .filter((edge) => edge.kind === "DEFINES")
    .map((edge) => ({ edge: edge.kind, ref: edge.ref, confidence: edge.confidence }));
  return evidence.length > 0 ? evidence : [indexedEvidence(node)];
}

/**
 * Per-snapshot lookup index, built once and reused for every query against that
 * snapshot. Without it, callersOf/calleesOf ran a linear node scan inside the
 * edge loop: on a 421k-node, 427k-edge repository that made one `context` call
 * cost 11 s. Weak so a rebuilt snapshot is collected with its index.
 */
type SnapshotIndex = {
  nodeById: Map<string, GraphNode>;
  edgesByFrom: Map<string, GraphEdge[]>;
  edgesByTo: Map<string, GraphEdge[]>;
};

const snapshotIndexes = new WeakMap<GraphSnapshot, SnapshotIndex>();

function indexFor(snapshot: GraphSnapshot): SnapshotIndex {
  const cached = snapshotIndexes.get(snapshot);
  if (cached !== undefined) return cached;
  const nodeById = new Map<string, GraphNode>();
  for (const node of snapshot.nodes) nodeById.set(node.id, node);
  const edgesByFrom = new Map<string, GraphEdge[]>();
  const edgesByTo = new Map<string, GraphEdge[]>();
  for (const edge of snapshot.edges) {
    const from = edgesByFrom.get(edge.from);
    if (from === undefined) edgesByFrom.set(edge.from, [edge]);
    else from.push(edge);
    const to = edgesByTo.get(edge.to);
    if (to === undefined) edgesByTo.set(edge.to, [edge]);
    else to.push(edge);
  }
  const built = { nodeById, edgesByFrom, edgesByTo };
  snapshotIndexes.set(snapshot, built);
  return built;
}

function findNode(snapshot: GraphSnapshot, id: string): GraphNode | undefined {
  return indexFor(snapshot).nodeById.get(id);
}

function callersOf(snapshot: GraphSnapshot, symbolId: string): { caller: GraphNode; ref: string }[] {
  const out: { caller: GraphNode; ref: string }[] = [];
  const index = indexFor(snapshot);
  for (const edge of index.edgesByTo.get(symbolId) ?? []) {
    if (edge.kind !== "CALLS_STATIC") continue;
    const caller = index.nodeById.get(edge.from);
    if (caller !== undefined) out.push({ caller, ref: edge.ref });
  }
  out.sort((left, right) => (left.caller.id < right.caller.id ? -1 : 1));
  return out;
}

function calleesOf(snapshot: GraphSnapshot, symbolId: string): { callee: GraphNode; ref: string }[] {
  const out: { callee: GraphNode; ref: string }[] = [];
  const index = indexFor(snapshot);
  for (const edge of index.edgesByFrom.get(symbolId) ?? []) {
    if (edge.kind !== "CALLS_STATIC") continue;
    const callee = index.nodeById.get(edge.to);
    if (callee !== undefined) out.push({ callee, ref: edge.ref });
  }
  out.sort((left, right) => (left.callee.id < right.callee.id ? -1 : 1));
  return out;
}

function unindexedSymbol(
  scope: QueryScope,
  freshness: FreshnessStatus,
  symbolId: string,
): SymbolContextResult {
  const filePart = symbolFilePart(symbolId);
  const unsupported =
    filePart !== undefined && !isSupportedPath(filePart) ? [unsupportedNote(filePart)] : [];
  const decided = decideCompleteness({
    unsupported: unsupported.length > 0,
    excluded: unsupported.length === 0,
    indexPartial: false,
    depthBudget: false,
    unresolvedEdges: false,
    cut: false,
  });
  return {
    ...baseEnvelope(scope, freshness),
    suggestedMode: "explore",
    coverage: "unindexed",
    truncated: false,
    knowledgeIds: [],
    unresolved: [`no definition for ${symbolId} in this snapshot`],
    unsupported,
    items: [],
    totals: { displayed: 0, known: null, hidden: null },
    ...decided,
    definition: undefined,
    callers: [],
    callees: [],
    summary: {
      subjectId: null,
      depth: 1,
      incoming: 0,
      outgoing: 0,
      tests: 0,
      modulesTouched: [],
    },
  };
}

/**
 * Definition plus direct static callers and callees for one symbol id.
 * Unknown symbols report unindexed; unsupported file parts report
 * unindexed with an unsupported note. Unresolved call sites appear only
 * as notes, never as caller items.
 */
export function symbolContext(
  snapshot: GraphSnapshot,
  symbolId: string,
  options: QueryOptions,
): SymbolContextResult {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const filePart = symbolFilePart(symbolId);
  if (filePart !== undefined && !isSupportedPath(filePart)) {
    const empty: SymbolContextResult = {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "explore",
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(filePart)],
      items: [],
      totals: { displayed: 0, known: null, hidden: null },
      completeness: "partial",
      completenessReason: "unsupported-files",
      definition: undefined,
      callers: [],
      callees: [],
      summary: {
        subjectId: null,
        depth: 1,
        incoming: 0,
        outgoing: 0,
        tests: 0,
        modulesTouched: [],
      },
    };
    return empty;
  }
  const node = findNode(snapshot, symbolId);
  if (node === undefined || node.kind !== "symbol") {
    return unindexedSymbol(scope, freshness, symbolId);
  }
  const definition = nodeItem(snapshot, node, definesEvidence(snapshot, node));
  const callerItems = callersOf(snapshot, symbolId).map(({ caller, ref }) =>
    nodeItem(snapshot, caller, [{ edge: "CALLS_STATIC", ref, confidence: 1 }]),
  );
  const calleeItems = calleesOf(snapshot, symbolId).map(({ callee, ref }) =>
    nodeItem(snapshot, callee, [{ edge: "CALLS_STATIC", ref, confidence: 1 }]),
  );
  // Ranked once, server-side: definition (distance 0) first, then the
  // depth-1 neighbourhood by confidence, kind priority, and id. `limit`
  // only decides how many ranked rows are returned; `known` counts all.
  const ranked = [
    { item: definition, depth: 0 },
    ...callerItems.map((item) => ({ item, depth: 1 })),
    ...calleeItems.map((item) => ({ item, depth: 1 })),
  ].sort((left, right) => compareRows(left.depth, left.item, right.depth, right.item));
  const seenIds = new Set<string>();
  const uniqueRanked = ranked.filter((entry) => {
    if (seenIds.has(entry.item.id)) return false;
    seenIds.add(entry.item.id);
    return true;
  });
  const dropped = ranked.length - uniqueRanked.length;
  const truncated = uniqueRanked.length > limit;
  const items = uniqueRanked.slice(0, limit).map((entry) => entry.item);
  const indexNote = indexTruncationNote(snapshot);
  const subjectUnresolved = unresolvedFor(snapshot, symbolId);
  const unresolved = [
    ...subjectUnresolved,
    ...(indexNote === undefined ? [] : [indexNote]),
    ...(truncated ? [`truncated to ${limit} of ${uniqueRanked.length} rows`] : []),
  ];
  const decided = decideCompleteness({
    unsupported: false,
    excluded: false,
    indexPartial: indexNote !== undefined,
    depthBudget: false,
    unresolvedEdges: subjectUnresolved.length > 0,
    cut: truncated,
  });
  const neighbourhood = [definition, ...callerItems, ...calleeItems];
  const testFiles = new Set<string>();
  for (const row of neighbourhood) {
    if (isTestPath(row.file)) testFiles.add(row.file);
  }
  const modulesTouched = [...new Set(neighbourhood.map((row) => moduleFor(row.file)))].sort();
  const depthCounts = new Map<number, number>();
  for (const entry of uniqueRanked) depthCounts.set(entry.depth, (depthCounts.get(entry.depth) ?? 0) + 1);
  const byDepth = [...depthCounts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([depth, count]) => ({ depth, count }));
  const callers = callerItems.slice(0, limit);
  const callees = calleeItems.slice(0, limit);
  return {
    ...baseEnvelope(scope, freshness),
    suggestedMode: "explore",
    ...duplicatesExtra(dropped),
    ...ambiguousExtra(items),
    shownOf: {
      callers: { shown: callers.length, total: callerItems.length },
      callees: { shown: callees.length, total: calleeItems.length },
    },
    coverage: indexCoverage(snapshot),
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved,
    unsupported: [],
    items,
    totals:
      indexNote !== undefined
        ? { displayed: items.length, known: null, hidden: null, byDepth, byKind: byKindFor(items) }
        : { displayed: items.length, known: uniqueRanked.length, hidden: uniqueRanked.length - items.length, byDepth, byKind: byKindFor(items) },
    ...decided,
    definition,
    callers,
    callees,
    summary: {
      subjectId: symbolId,
      depth: 1,
      incoming: callerItems.length,
      outgoing: calleeItems.length,
      tests: testFiles.size,
      modulesTouched,
    },
  };
}

/**
 * Reverse reachability over CALLS_STATIC: every symbol (and top-level
 * file site) that would run when the subject changes, transitively.
 * Bounded by maxDepth and limit; the cut names itself in unresolved.
 */
export function impact(
  snapshot: GraphSnapshot,
  symbolId: string,
  options: QueryOptions,
): ImpactResult {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const maxDepth = clampDepth(options.maxDepth);
  const filePart = symbolFilePart(symbolId);
  if (filePart !== undefined && !isSupportedPath(filePart)) {
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "impact",
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(filePart)],
      items: [],
      totals: { displayed: 0, known: null, hidden: null },
      completeness: "partial",
      completenessReason: "unsupported-files",
      subject: undefined,
      impacted: [],
      summary: emptyImpactSummary([symbolId], "partial"),
    };
  }
  const subjectNode = findNode(snapshot, symbolId);
  if (subjectNode === undefined) {
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "impact",
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`no definition for ${symbolId} in this snapshot`],
      unsupported: [],
      items: [],
      totals: { displayed: 0, known: null, hidden: null },
      completeness: "partial",
      completenessReason: "index-excluded",
      subject: undefined,
      impacted: [],
      summary: emptyImpactSummary([symbolId], "partial"),
    };
  }
  const subject = nodeItem(snapshot, subjectNode, definesEvidence(snapshot, subjectNode));
  // Walk the WHOLE reachable reverse-call set up to `maxDepth` and count
  // it; `limit` only decides how many ranked rows are returned. `known`
  // is the walked count, `hidden` is walked minus returned.
  const walked: { readonly item: QueryItem; readonly depth: number }[] = [];
  const seen = new Set<string>([symbolId]);
  const exploredCap = clampExploredEdges(options.maxExploredEdges);
  const deadlineMs = Date.now() + clampQueryBudgetMs(options.maxQueryMs);
  let explored = 0;
  let edgeBudgetHit = false;
  let timeBudgetHit = false;
  let frontier = [symbolId];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    if (Date.now() >= deadlineMs) {
      timeBudgetHit = true;
      break;
    }
    const next: string[] = [];
    for (const current of frontier) {
      for (const { caller, ref } of callersOf(snapshot, current)) {
        explored += 1;
        if (explored > exploredCap) {
          edgeBudgetHit = true;
          break;
        }
        if (seen.has(caller.id)) continue;
        seen.add(caller.id);
        walked.push({
          item: nodeItem(snapshot, caller, [{ edge: "CALLS_STATIC", ref, confidence: 1 }]),
          depth,
        });
        if (caller.kind === "symbol") next.push(caller.id);
      }
      if (edgeBudgetHit) break;
    }
    if (edgeBudgetHit) break;
    frontier = next;
  }
  // The depth budget stopped the walk early when a frontier node still has
  // callers the walk never visited: the walked count is honest only to the
  // budget, never to the graph.
  const depthBudgetHit = frontier.some((id) =>
    callersOf(snapshot, id).some(({ caller }) => !seen.has(caller.id)),
  );
  walked.sort((left, right) => compareRows(left.depth, left.item, right.depth, right.item));
  const truncated = walked.length > limit;
  const returned = walked.slice(0, limit);
  const impacted = returned.map((entry) => entry.item);
  const depthCounts = new Map<number, number>();
  for (const entry of walked) depthCounts.set(entry.depth, (depthCounts.get(entry.depth) ?? 0) + 1);
  const byDepth = [...depthCounts.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([depth, count]) => ({ depth, count }));
  // Unresolved edges met anywhere on the walked set stay visible as
  // disclosure: they are dynamics to review. They never decide this
  // answer, because the walk follows the CALLER direction and an unresolved
  // call inside a dependent cannot hide another caller. `trace` keeps
  // `blocked-by-unresolved` because there an unresolved edge really does
  // block the forward search.
  const visitedIds = [symbolId, ...walked.map((entry) => entry.item.id)];
  const unresolvedNotes: string[] = [];
  let unresolvedEdges = 0;
  for (const id of visitedIds) {
    const edges = unresolvedEdgesFrom(snapshot, id);
    unresolvedEdges += edges.length;
    for (const edge of edges) {
      unresolvedNotes.push(`${edge.ref} calls an unknown callee (manual review, never proven)`);
    }
  }
  unresolvedNotes.sort();
  const indexNote = indexTruncationNote(snapshot);
  const unresolved = [
    ...unresolvedNotes,
    ...(indexNote === undefined ? [] : [indexNote]),
    ...(edgeBudgetHit
      ? [`edge budget ${exploredCap} stopped the walk after ${explored - 1} caller edges; more dependents may exist`]
      : []),
    ...(timeBudgetHit ? [`time budget ${clampQueryBudgetMs(options.maxQueryMs)} ms stopped the walk; more dependents may exist`] : []),
    ...(depthBudgetHit ? [`depth budget ${maxDepth} stopped the walk with callers still unexplored`] : []),
    ...(truncated ? [`truncated to ${limit} of ${walked.length} impacted rows`] : []),
  ];
  const decided = decideCompleteness({
    unsupported: false,
    excluded: false,
    indexPartial: indexNote !== undefined,
    edgeBudget: edgeBudgetHit,
    timeBudget: timeBudgetHit,
    depthBudget: depthBudgetHit,
    unresolvedEdges: false,
    cut: truncated,
  });
  const allDependents = walked.map((entry) => entry.item);
  const dependentFiles = new Set(allDependents.map((item) => item.file));
  const testFiles = new Set<string>();
  let callersWithoutTestPath = 0;
  for (const item of allDependents) {
    if (isTestPath(item.file)) testFiles.add(item.file);
    if (!hasTestPath(snapshot, item)) callersWithoutTestPath += 1;
  }
  const dedupedImpacted = dedupeById(impacted);
  const uniqueImpacted = [...dedupedImpacted.items];
  return {
    ...baseEnvelope(scope, freshness),
    suggestedMode: "impact",
    ...duplicatesExtra(dedupedImpacted.dropped),
    ...ambiguousExtra(uniqueImpacted),
    shownOf: { impacted: { shown: uniqueImpacted.length, total: walked.length } },
    coverage: indexCoverage(snapshot),
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(uniqueImpacted.map((item) => item.id)))),
    unresolved,
    unsupported: [],
    items: uniqueImpacted,
    totals:
      indexNote !== undefined
        ? { displayed: uniqueImpacted.length, known: null, hidden: null, byDepth, byKind: byKindFor(uniqueImpacted) }
        : { displayed: uniqueImpacted.length, known: walked.length, hidden: walked.length - uniqueImpacted.length, byDepth, byKind: byKindFor(uniqueImpacted) },
    ...decided,
    subject,
    impacted: uniqueImpacted,
    summary: {
      subjectIds: [symbolId],
      dependentFiles: dependentFiles.size,
      dependentSymbols: allDependents.filter((item) => !item.id.startsWith("file:")).length,
      modules: moduleCounts(allDependents),
      testsFound: testFiles.size,
      callersWithoutTestPath,
      unresolvedEdges,
      completeness: decided.completeness,
    },
  };
}

/**
 * One static call path from `fromId` to `toId` over CALLS_STATIC (BFS).
 * No path reports indexed with an unresolved note rather than a guess.
 */
export function trace(
  snapshot: GraphSnapshot,
  fromId: string,
  toId: string,
  options: QueryOptions,
): TraceResult {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const maxDepth = clampDepth(options.maxDepth);
  for (const id of [fromId, toId]) {
    const filePart = symbolFilePart(id);
    if (filePart !== undefined && !isSupportedPath(filePart)) {
      return {
        ...baseEnvelope(scope, freshness),
        suggestedMode: "trace",
        coverage: "unindexed",
        truncated: false,
        knowledgeIds: [],
        unresolved: [],
        unsupported: [unsupportedNote(filePart)],
        items: [],
        totals: { displayed: 0, known: 0, hidden: 0 },
        completeness: "partial",
        completenessReason: "unsupported-files",
        path: [],
        summary: {
          found: false,
          hops: null,
          alternativePaths: null,
          reason: id === fromId ? "start-unresolved" : "destination-unresolved",
        },
      };
    }
  }
  const fromNode = findNode(snapshot, fromId);
  const toNode = findNode(snapshot, toId);
  if (fromNode === undefined || toNode === undefined) {
    const missing = fromNode === undefined ? fromId : toId;
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "trace",
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`no definition for ${missing} in this snapshot`],
      unsupported: [],
      items: [],
      totals: { displayed: 0, known: 0, hidden: 0 },
      completeness: "partial",
      completenessReason: "index-excluded",
      path: [],
      summary: {
        found: false,
        hops: null,
        alternativePaths: null,
        reason: fromNode === undefined ? "start-unresolved" : "destination-unresolved",
      },
    };
  }
  if (fromId === toId) {
    const self = nodeItem(snapshot, fromNode, [indexedEvidence(fromNode)]);
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "trace",
      ...ambiguousExtra([self]),
      coverage: "indexed",
      truncated: false,
      knowledgeIds: [...self.knowledgeIds],
      unresolved: [],
      unsupported: [],
      items: [self],
      totals: { displayed: 1, known: 1, hidden: 0, byKind: byKindFor([self]) },
      completeness: "complete",
      path: [],
      summary: { found: true, hops: 0, alternativePaths: null, reason: "same-node" },
    };
  }
  const parents = new Map<string, { via: string; ref: string }>();
  const seen = new Set<string>([fromId]);
  const visitCap = limit * 20;
  let frontier = [fromId];
  let found = false;
  let abandoned = false;
  for (let depth = 0; depth < maxDepth && frontier.length > 0 && !found && !abandoned; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const { callee, ref } of calleesOf(snapshot, current)) {
        if (seen.has(callee.id)) continue;
        seen.add(callee.id);
        parents.set(callee.id, { via: current, ref });
        if (callee.id === toId) {
          found = true;
          break;
        }
        next.push(callee.id);
        if (seen.size > visitCap) {
          abandoned = true;
          break;
        }
      }
      if (found || abandoned) break;
    }
    frontier = next;
  }
  const indexNote = indexTruncationNote(snapshot);
  if (abandoned && !found) {
    const decided = decideCompleteness({
      unsupported: false,
      excluded: false,
      indexPartial: indexNote !== undefined,
      depthBudget: false,
      unresolvedEdges: false,
      cut: true,
    });
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "trace",
      coverage: "partial",
      truncated: true,
      knowledgeIds: [],
      unresolved: [
        `trace abandoned: call frontier exceeded ${visitCap} nodes (bounded, never the whole graph)`,
        ...(indexNote === undefined ? [] : [indexNote]),
      ],
      unsupported: [],
      items: [],
      totals: { displayed: 0, known: null, hidden: null },
      ...decided,
      path: [],
      summary: { found: false, hops: null, alternativePaths: null, reason: "budget-exhausted" },
    };
  }
  if (!found) {
    // A frontier holding an unresolved edge could still complete the path
    // through dynamics: report blocked, never a proven absence.
    let blockedEdge: GraphEdge | undefined;
    for (const id of seen) {
      blockedEdge = unresolvedEdgesFrom(snapshot, id)[0];
      if (blockedEdge !== undefined) break;
    }
    const depthBudgetHit = frontier.length > 0;
    const reason =
      blockedEdge !== undefined
        ? ("blocked-by-unresolved" as const)
        : depthBudgetHit
          ? ("budget-exhausted" as const)
          : ("no-path-in-graph" as const);
    const decided = decideCompleteness({
      unsupported: false,
      excluded: false,
      indexPartial: indexNote !== undefined,
      depthBudget: depthBudgetHit && blockedEdge === undefined,
      unresolvedEdges: blockedEdge !== undefined,
      cut: false,
    });
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "trace",
      coverage: indexCoverage(snapshot),
      truncated: depthBudgetHit,
      knowledgeIds: [],
      unresolved: [
        blockedEdge === undefined && !depthBudgetHit
          ? `no static call path from ${fromId} to ${toId} (never guessed)`
          : `no static call path from ${fromId} to ${toId} within budget (never guessed)`,
        ...(blockedEdge === undefined
          ? []
          : [`${blockedEdge.ref} calls an unknown callee (manual review, never proven)`]),
        ...(indexNote === undefined ? [] : [indexNote]),
        ...(depthBudgetHit ? [`depth budget ${maxDepth} stopped the walk with callees still unexplored`] : []),
      ],
      unsupported: [],
      items: [],
      totals: { displayed: 0, known: 0, hidden: 0 },
      ...decided,
      path: [],
      summary: { found: false, hops: null, alternativePaths: null, reason },
    };
  }
  const chain: string[] = [toId];
  while (chain[0] !== fromId) {
    const head = chain[0];
    const parent = parents.get(head);
    if (parent === undefined) break;
    chain.unshift(parent.via);
  }
  const path: TraceStep[] = [];
  for (let index = 0; index < chain.length - 1; index += 1) {
    const child = chain[index + 1];
    const parent = parents.get(child);
    path.push({ from: chain[index], to: child, ref: parent?.ref ?? "", confidence: 1 });
  }
  const items = chain
    .map((id) => findNode(snapshot, id))
    .filter((node): node is GraphNode => node !== undefined)
    .map((node) => {
      const step = path.find((entry) => entry.from === node.id || entry.to === node.id);
      return nodeItem(
        snapshot,
        node,
        step ? [{ edge: "CALLS_STATIC", ref: step.ref, confidence: 1 }] : [indexedEvidence(node)],
      );
    });
  const foundNotes = unresolvedFor(snapshot, fromId);
  const foundDecided = decideCompleteness({
    unsupported: false,
    excluded: false,
    indexPartial: indexNote !== undefined,
    depthBudget: false,
    unresolvedEdges: false,
    cut: false,
  });
  const dedupedFound = dedupeById(items);
  const uniqueFound = [...dedupedFound.items];
  return {
    ...baseEnvelope(scope, freshness),
    suggestedMode: "trace",
    ...duplicatesExtra(dedupedFound.dropped),
    ...ambiguousExtra(uniqueFound),
    coverage: "indexed",
    truncated: false,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(uniqueFound.map((item) => item.id)))),
    unresolved: [...foundNotes, ...(indexNote === undefined ? [] : [indexNote])],
    unsupported: [],
    items: uniqueFound,
    totals: {
      displayed: uniqueFound.length,
      known: indexNote === undefined ? uniqueFound.length : null,
      hidden: indexNote === undefined ? 0 : null,
      byKind: byKindFor(uniqueFound),
    },
    ...foundDecided,
    path,
    summary: { found: true, hops: path.length, alternativePaths: null },
  };
}

function subjectFileFor(snapshot: GraphSnapshot, target: string): string | undefined {
  if (!target.includes("@") && !target.startsWith("fn:") && !target.startsWith("class:") && !target.startsWith("const:")) {
    return target;
  }
  const node = findNode(snapshot, target);
  if (node !== undefined) return node.file;
  const filePart = symbolFilePart(target);
  return filePart;
}

/**
 * Candidate tests for a file path or symbol id: test files whose static
 * imports reach the subject, directly (TESTS evidence) or transitively
 * (IMPORTS chain evidence). Heuristic subject guesses are forbidden —
 * only compiler-resolved edges count, so candidates always carry evidence.
 */
export function findTests(
  snapshot: GraphSnapshot,
  target: string,
  options: QueryOptions,
): FindTestsResult {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const maxDepth = clampDepth(options.maxDepth);
  const subjectFile = subjectFileFor(snapshot, target);
  if (subjectFile === undefined || !isSupportedPath(subjectFile)) {
    const unsupportedInput = subjectFile !== undefined;
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "explore",
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: subjectFile === undefined ? [`no definition for ${target} in this snapshot`] : [],
      unsupported: subjectFile === undefined ? [] : [unsupportedNote(subjectFile)],
      items: [],
      totals: { displayed: 0, known: null, hidden: null },
      completeness: "partial",
      completenessReason: unsupportedInput ? "unsupported-files" : "index-excluded",
      subjectFile: undefined,
      candidates: [],
    };
  }
  const subjectId = `file:${subjectFile}`;
  if (findNode(snapshot, subjectId) === undefined) {
    return {
      ...baseEnvelope(scope, freshness),
      suggestedMode: "explore",
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`${subjectFile} is not in this snapshot`],
      unsupported: [],
      items: [],
      totals: { displayed: 0, known: null, hidden: null },
      completeness: "partial",
      completenessReason: "index-excluded",
      subjectFile: undefined,
      candidates: [],
    };
  }
  // Walk every import chain up to `maxDepth` and count all candidates;
  // `limit` only decides how many ranked rows are returned.
  const walked: { readonly item: QueryItem; readonly depth: number }[] = [];
  const seen = new Set<string>([subjectId]);
  const deadlineMs = Date.now() + clampQueryBudgetMs(options.maxQueryMs);
  let timeBudgetHit = false;
  let frontier: { readonly id: string; readonly via: readonly QueryEvidence[] }[] = [{ id: subjectId, via: [] }];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    if (Date.now() >= deadlineMs) {
      timeBudgetHit = true;
      break;
    }
    const next: { readonly id: string; readonly via: readonly QueryEvidence[] }[] = [];
    for (const current of frontier) {
      for (const edge of indexFor(snapshot).edgesByTo.get(current.id) ?? []) {
        if (edge.kind !== "IMPORTS" && edge.kind !== "TESTS") continue;
        const importer = indexFor(snapshot).nodeById.get(edge.from);
        if (importer === undefined || seen.has(importer.id)) continue;
        seen.add(importer.id);
        const hop: QueryEvidence = { edge: edge.kind, ref: edge.ref, confidence: edge.confidence };
        const evidence = [...current.via, hop];
        if (importer.kind === "file" && importer.isTest === true) {
          walked.push({ item: nodeItem(snapshot, importer, evidence), depth });
        } else if (importer.kind === "file") {
          next.push({ id: importer.id, via: evidence });
        }
      }
    }
    frontier = next;
  }
  const depthBudgetHit = frontier.some((entry) =>
    (indexFor(snapshot).edgesByTo.get(entry.id) ?? []).some(
      (edge) => (edge.kind === "IMPORTS" || edge.kind === "TESTS") && !seen.has(edge.from),
    ),
  );
  walked.sort((left, right) => compareRows(left.depth, left.item, right.depth, right.item));
  const truncated = walked.length > limit;
  const dedupedCandidates = dedupeById(walked.slice(0, limit).map((entry) => entry.item));
  const candidates = [...dedupedCandidates.items];
  const indexNote = indexTruncationNote(snapshot);
  const decided = decideCompleteness({
    unsupported: false,
    excluded: false,
    indexPartial: indexNote !== undefined,
    timeBudget: timeBudgetHit,
    depthBudget: depthBudgetHit,
    unresolvedEdges: false,
    cut: truncated,
  });
  return {
    ...baseEnvelope(scope, freshness),
    suggestedMode: "explore",
    ...duplicatesExtra(dedupedCandidates.dropped),
    ...ambiguousExtra(candidates),
    shownOf: { candidates: { shown: candidates.length, total: walked.length } },
    coverage: indexCoverage(snapshot),
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(candidates.map((item) => item.id)))),
    unresolved: [
      ...(indexNote === undefined ? [] : [indexNote]),
      ...(timeBudgetHit ? [`time budget ${clampQueryBudgetMs(options.maxQueryMs)} ms stopped the walk; more candidates may exist`] : []),
      ...(depthBudgetHit ? [`depth budget ${maxDepth} stopped the walk with importers still unexplored`] : []),
      ...(truncated ? [`truncated to ${limit} of ${walked.length} candidate tests`] : []),
    ],
    unsupported: [],
    items: candidates,
    totals:
      indexNote !== undefined
        ? { displayed: candidates.length, known: null, hidden: null, byKind: byKindFor(candidates) }
        : { displayed: candidates.length, known: walked.length, hidden: walked.length - candidates.length, byKind: byKindFor(candidates) },
    ...decided,
    subjectFile,
    candidates,
  };
}

function changeLine(ref: string): number {
  const line = Number(ref.split(":").pop() ?? "1");
  return Number.isFinite(line) && line >= 1 ? Math.floor(line) : 1;
}

function changeFile(ref: string, fallback: string): string {
  const file = ref
    .split(":")
    .slice(0, -1)
    .join(":");
  return file === "" ? fallback : file;
}

/**
 * Shapes `invalidateEdges` output into the query envelope: one bounded
 * change row per stale node or edge with its cause, source location, and
 * system-fact confidence. Any change flips freshness to stale; a clean
 * diff reports fresh. Never invents edges — the diff is the whole answer.
 */
export function detectChanges(
  previous: GraphSnapshot,
  current: GraphSnapshot,
  options: QueryOptions,
): DetectChangesResult {
  const scope = resolveScope(options);
  const limit = clampLimit(options.limit);
  const invalidated = invalidateEdges(previous, current);
  const changes: QueryChange[] = invalidated.map((edge) => ({
    id: edge.from,
    file: changeFile(edge.ref, edge.from),
    line: changeLine(edge.ref),
    cause: edge.cause ?? "SRC-EDIT",
    ref: edge.ref,
    confidence: edge.confidence,
  }));
  const truncated = changes.length > limit;
  const kept = changes.slice(0, limit);
  const dedupedChanges = dedupeById(
    kept.map((change) => ({
      id: change.id,
      file: change.file,
      line: change.line,
      evidence: [{ edge: "INVALIDATED_BY", ref: change.ref, confidence: change.confidence }],
      confidence: change.confidence,
      knowledgeIds: [],
      verdict: verdictForEvidenceKind("INVALIDATED_BY"),
      isTest: isTestPath(change.file),
    })),
  );
  const items = [...dedupedChanges.items];
  return {
    ...baseEnvelope(scope, options.freshness ?? (changes.length > 0 ? "stale" : "fresh")),
    suggestedMode: "explore",
    ...duplicatesExtra(dedupedChanges.dropped),
    ...ambiguousExtra(items),
    coverage: indexCoverage(current),
    truncated,
    knowledgeIds: [],
    unresolved: truncated ? [`truncated to ${limit} of ${changes.length} changes`] : [],
    unsupported: [],
    items,
    totals: { displayed: items.length, known: changes.length, hidden: changes.length - items.length },
    ...(truncated
      ? { completeness: "truncated" as const, completenessReason: "result-limit" as const }
      : { completeness: "complete" as const }),
    changes: kept,
  };
}

/**
 * A file or exported name with no static referrer in the analysed graph.
 * Potentially unreferenced, never proven unused: TESTS and LINKS_KNOWLEDGE
 * inbound edges are reported as evidence but never disqualify, and anything
 * reachable outside the analysed edge set (entry points, framework
 * conventions, registries, schedulers, build config, non-TypeScript files)
 * is invisible here by construction.
 */
export interface UnreferencedCandidate {
  readonly id: string;
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  readonly name?: string;
  readonly kind: "file" | "symbol";
  readonly inboundImports: number;
  readonly inboundCalls: number;
  readonly inboundTests: number;
  readonly inboundKnowledge: number;
  readonly reason: "no-inbound-edges" | "only-exported";
}

export interface UnreferencedResult extends QueryEnvelope {
  readonly candidates: readonly UnreferencedCandidate[];
  readonly summary: {
    readonly analyzedFiles: number;
    readonly unanalyzedNote: string;
    readonly candidatesTotal: number;
    readonly excludedEntryLike: number;
  };
}

/**
 * Basenames that behave as entry points: reached by runtimes and tooling
 * outside the analysed edge set, so they are never suspicious candidates.
 */
function entryBasename(file: string): boolean {
  const base = file.split("/").pop() ?? file;
  const stem = (base.split(".")[0] ?? base).toLowerCase();
  return stem === "main" || stem === "index" || stem === "cli";
}

/**
 * Files reachable outside the analysed edge set: entry basenames, test
 * files, and shell scripts. Non-TypeScript files are never analysed at all;
 * the rest can be pulled in by entry points, framework conventions, CLI
 * registries, schedulers, or build config. Excluded from candidates and
 * counted, never hidden.
 */
function isEntryLikeFile(file: string): boolean {
  if (isTestPath(file)) return true;
  if (file.endsWith(".sh")) return true;
  return entryBasename(file);
}

const UNANALYZED_NOTE =
  "non-TypeScript files are not analysed; entry points, framework conventions, " +
  "CLI registries, schedulers and build config can reach a file outside the analysed " +
  "edge set, so every candidate is only potentially unreferenced, never proven unused.";

/**
 * Files and export contracts nobody statically reaches: zero inbound edges
 * of kind IMPORTS, CALLS_STATIC or CALLS_UNRESOLVED from any other analysed
 * node. TESTS and LINKS_KNOWLEDGE inbound edges count as evidence only.
 * Entry-like files stay out of the list and are counted instead. Ranked by
 * inbound evidence total asc then file path asc, so two runs agree. Bounded
 * by limit (default 20, max 50) with the full count kept in totals.
 */
export function findUnreferenced(snapshot: GraphSnapshot, options: QueryOptions): UnreferencedResult {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const index = indexFor(snapshot);
  const analysedIds = new Set(snapshot.nodes.map((node) => node.id));
  const excludedFiles = new Set<string>();
  let analyzedFiles = 0;
  const all: UnreferencedCandidate[] = [];
  for (const node of snapshot.nodes) {
    if (node.kind === "file") analyzedFiles += 1;
    if (node.kind !== "file" && node.kind !== "export-contract") continue;
    if (isEntryLikeFile(node.file)) {
      excludedFiles.add(node.file);
      continue;
    }
    // An export contract splits one symbol's references across two ids: calls
    // resolve to the symbol id (`fn:name@file`, the same id `symbolContext`
    // answers through) while the contract id carries only the EXPORTS edge,
    // and imports land on the file node. Measuring the contract id alone
    // therefore reports every called export as `only-exported`. Union the
    // contract and symbol inbound sets so any IMPORTS/CALLS_STATIC/
    // CALLS_UNRESOLVED edge to either id disqualifies the candidate. A file
    // IMPORTS deliberately does NOT count: an imported file's uncalled
    // exports are exactly what this query exists to surface, while a called
    // export is still cleared by its own call edge.
    const inboundIds =
      node.kind === "export-contract" && node.target !== undefined && node.target !== "unknown"
        ? [node.id, node.target]
        : [node.id];
    const inbound = inboundIds
      .flatMap((id) => index.edgesByTo.get(id) ?? [])
      .filter((edge) => !inboundIds.includes(edge.from) && analysedIds.has(edge.from));
    const inboundImports = inbound.filter((edge) => edge.kind === "IMPORTS").length;
    const inboundCalls = inbound.filter(
      (edge) => edge.kind === "CALLS_STATIC" || edge.kind === "CALLS_UNRESOLVED",
    ).length;
    if (inboundImports > 0 || inboundCalls > 0) continue;
    const inboundTests = inbound.filter((edge) => edge.kind === "TESTS").length;
    const inboundKnowledge = inbound.filter((edge) => edge.kind === "LINKS_KNOWLEDGE").length;
    const exported = inbound.some((edge) => edge.kind === "EXPORTS");
    const candidate: UnreferencedCandidate = {
      id: node.id,
      file: node.file,
      line: node.line,
      kind: node.kind === "file" ? "file" : "symbol",
      inboundImports,
      inboundCalls,
      inboundTests,
      inboundKnowledge,
      reason: exported ? "only-exported" : "no-inbound-edges",
    };
    all.push(node.name === undefined ? candidate : { ...candidate, name: node.name });
  }
  all.sort((left, right) => {
    const leftTotal = left.inboundImports + left.inboundCalls + left.inboundTests + left.inboundKnowledge;
    const rightTotal = right.inboundImports + right.inboundCalls + right.inboundTests + right.inboundKnowledge;
    if (leftTotal !== rightTotal) return leftTotal - rightTotal;
    if (left.file !== right.file) return left.file < right.file ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  const kept = all.slice(0, limit);
  const truncated = all.length > limit;
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node] as const));
  const items: QueryItem[] = kept.map((candidate) => {
    const node = byId.get(candidate.id);
    if (node === undefined) {
      return {
        id: candidate.id,
        file: candidate.file,
        line: candidate.line,
        evidence: [{ edge: "indexed", ref: `${candidate.file}:${candidate.line}`, confidence: 1 }],
        confidence: 1,
        knowledgeIds: [],
        verdict: verdictForEvidenceKind("indexed"),
        isTest: isTestPath(candidate.file),
      };
    }
    const exportEvidence = (index.edgesByTo.get(node.id) ?? [])
      .filter((edge) => edge.kind === "EXPORTS" && edge.from !== node.id && analysedIds.has(edge.from))
      .map((edge) => ({ edge: edge.kind, ref: edge.ref, confidence: edge.confidence }));
    const evidence = exportEvidence.length > 0 ? exportEvidence : [indexedEvidence(node)];
    const linked = knowledgeIdsFor(snapshot, new Set([node.id, `file:${node.file}`]));
    const own = [...(linked.get(node.id) ?? []), ...(linked.get(`file:${node.file}`) ?? [])].filter(
      (id, at, seen) => seen.indexOf(id) === at,
    );
    const entry: QueryItem = {
      id: node.id,
      file: node.file,
      line: node.line,
      evidence,
      confidence: 1,
      knowledgeIds: own,
      verdict: verdictForEvidenceKind(evidence[0]?.edge ?? "indexed"),
      isTest: isTestPath(node.file),
    };
    return node.name === undefined ? entry : { ...entry, name: node.name };
  });
  const indexNote = indexTruncationNote(snapshot);
  const decided = decideCompleteness({
    unsupported: false,
    excluded: false,
    indexPartial: indexNote !== undefined,
    depthBudget: false,
    unresolvedEdges: false,
    cut: truncated,
  });
  return {
    ...baseEnvelope(scope, freshness),
    suggestedMode: "explore",
    ...ambiguousExtra(items),
    shownOf: { candidates: { shown: items.length, total: all.length } },
    coverage: indexCoverage(snapshot),
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved: [
      ...(indexNote === undefined
        ? []
        : [indexNote, "unanalyzed content cannot be judged: references may arrive from outside the analysed edge set"]),
      ...(truncated ? [`truncated to ${limit} of ${all.length} candidates`] : []),
    ],
    unsupported: [],
    items,
    totals: { displayed: items.length, known: all.length, hidden: all.length - items.length },
    ...decided,
    candidates: kept,
    summary: {
      analyzedFiles,
      unanalyzedNote: UNANALYZED_NOTE,
      candidatesTotal: all.length,
      excludedEntryLike: excludedFiles.size,
    },
  };
}

export type { GraphNode, GraphSnapshot, InvalidationCause, StoredBaseline };
export { KNOWLEDGE_PREFIX };
