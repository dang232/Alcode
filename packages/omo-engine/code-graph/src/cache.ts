/**
 * Worktree-scoped freshness cache for code graphs.
 *
 * What this module owns: building a baseline graph from HEAD-tree files,
 * holding one baseline per (project, worktree), serving reads only when
 * fresh, layering dirty worktree edits as a non-persisting overlay, and
 * detecting a malformed stored index with rebuild-or-fallback recovery.
 *
 * Binding: `.omo/ulw/waves/s53-phase-a/schema-draft.md` sections 2-5.
 * Precedent: `memory-core` project-knowledge (`record.ts` fingerprint
 * grammar and drop-and-count loading, `validator.ts` freshness gates and
 * invalidation priority, `retrieve.ts` filter order). The read path below
 * mirrors that order: scope freshness (HEAD-MOVE, EVID-STALE) gates before
 * anything is served; per-entity invalidation runs delete, then rename,
 * then edit — the same priority `evaluateInvalidation` uses.
 *
 * Invariants:
 * - The baseline is built from HEAD-tree files only. Working-tree content
 *   reaches reads through the dirty overlay and never writes back.
 * - A miss is empty (undefined / `miss`), never an error and never stale data.
 * - Stale data is never served: staleness resolves to `stale`/`rebuilt`,
 *   and recovery rebuilds from HEAD files with zero invented edges.
 * - A stored index is one atomic snapshot: any malformed entry corrupts the
 *   whole snapshot (fail-closed), while HEAD files are independent
 *   observations that drop-and-count individually. Rebuilding from HEAD
 *   files is always available, so recovery never needs to guess.
 * - Unresolved dynamics are never proven: a CALLS_UNRESOLVED candidate
 *   above 0.50 is dropped, never stored.
 */

import {
  STALE_AFTER_MS,
  computeEntityId,
  computeFingerprint,
  computeScopeFingerprint,
  hasExternalTarget,
  isConfidence,
  isEdgeConfidence,
  isEdgeKind,
  isEntityKind,
  isFingerprint,
  isGraphEdge,
  isGraphEntity,
  isGraphScopeKey,
  isProjectId,
  isRevision,
  isWorktreeId,
  scopeKeyEquals,
  storageKey,
  type GraphEdge,
  type GraphEntity,
  type GraphInvalidationCase,
  type GraphInvalidationCause,
  type GraphScopeKey,
} from "./schema";

export type BaselineStaleReason = Extract<GraphInvalidationCase, "HEAD-MOVE" | "EVID-STALE">;

export type OverlayDropReason = Extract<GraphInvalidationCause, "SRC-EDIT" | "SRC-DELETE" | "SYM-RENAME">;

/** One HEAD-tree file: repo-relative path plus its blob sha at the revision. */
export interface HeadFile {
  readonly path: string;
  readonly blobSha256: string;
  readonly symbols?: readonly string[];
}

/** One uncommitted working-tree edit layered over a baseline, never stored. */
export interface DirtyEdit {
  readonly filePath: string;
  /** Null when the file is deleted in the worktree. */
  readonly blobSha256: string | null;
  /** `rg <symbol>` hit count in the worktree file while it exists. */
  readonly symbolHits: number;
  /** A rename-candidate probe resolved the symbol elsewhere. */
  readonly renameResolved: boolean;
}

export interface StoredBaseline {
  readonly scope: GraphScopeKey;
  readonly entities: readonly GraphEntity[];
  readonly edges: readonly GraphEdge[];
  readonly observedAtMs: number;
}

export interface BaselineDrop {
  readonly path: string;
  readonly reason: string;
}

export type BuildResult =
  | { readonly kind: "built"; readonly baseline: StoredBaseline; readonly dropped: readonly BaselineDrop[] }
  | { readonly kind: "refused"; readonly reason: string };

export type BaselineRead =
  | { readonly status: "hit"; readonly baseline: StoredBaseline }
  | { readonly status: "miss" }
  | { readonly status: "stale"; readonly reason: BaselineStaleReason; readonly scope: GraphScopeKey };

export interface OverlayDrop {
  readonly entityId: string;
  readonly reason: OverlayDropReason;
}

export interface OverlayView {
  readonly scope: GraphScopeKey;
  readonly entities: readonly GraphEntity[];
  /** Edges that lose a graph-internal endpoint are withheld, never rewritten. */
  readonly edges: readonly GraphEdge[];
  readonly dropped: readonly OverlayDrop[];
}

export type ParseStoredIndexResult =
  | { readonly kind: "index"; readonly baseline: StoredBaseline }
  | { readonly kind: "corrupt"; readonly reason: string };

export interface LoadInput {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly storedText: string | undefined;
  readonly headFiles: readonly HeadFile[];
  readonly headRevision: string;
  readonly nowMs: number;
}

export type LoadResult =
  | { readonly status: "hit"; readonly baseline: StoredBaseline }
  | {
      readonly status: "rebuilt";
      readonly baseline: StoredBaseline;
      readonly reason: string;
      readonly dropped: readonly BaselineDrop[];
    }
  | { readonly status: "refused"; readonly reason: string };

/**
 * Builds a baseline from HEAD-tree files. One file entity per valid file,
 * one symbol entity per valid declared symbol; candidate edges survive only
 * when their kind is in the closed set, their confidence passes the
 * per-edge rule, and their endpoints resolve per the kind (external-target
 * kinds exempt the `to` side). Anything else is dropped and counted —
 * edges are never invented, and unresolved dynamics are never proven.
 */
export function buildBaselineFromHeadFiles(
  scope: GraphScopeKey,
  files: readonly HeadFile[],
  candidates: readonly GraphEdge[],
  nowMs: number,
): BuildResult {
  if (!isGraphScopeKey(scope)) return { kind: "refused", reason: "invalid-scope" };
  if (scope.fingerprint !== computeScopeFingerprint(scope.projectId, scope.worktreeId, scope.revision)) {
    return { kind: "refused", reason: "fingerprint-mismatch" };
  }
  if (!Number.isFinite(nowMs)) return { kind: "refused", reason: "invalid-clock" };
  const entities: GraphEntity[] = [];
  const seen = new Set<string>();
  const dropped: BaselineDrop[] = [];
  for (const file of files) {
    if (!isFingerprint(file.blobSha256)) {
      dropped.push({ path: file.path, reason: "invalid-blob" });
      continue;
    }
    const fileEntity: GraphEntity = {
      id: computeEntityId(scope.projectId, file.path, "file"),
      projectId: scope.projectId,
      filePath: file.path,
      symbol: "file",
      kind: "file",
      revision: scope.revision,
      fingerprint: computeFingerprint(scope.revision, file.blobSha256),
      confidence: 1,
    };
    if (seen.has(fileEntity.id) || !isGraphEntity(fileEntity)) {
      dropped.push({ path: file.path, reason: seen.has(fileEntity.id) ? "duplicate-entry" : "invalid-file" });
      continue;
    }
    seen.add(fileEntity.id);
    entities.push(fileEntity);
    const symbols = file.symbols ?? [];
    if (!Array.isArray(symbols)) {
      dropped.push({ path: file.path, reason: "invalid-symbols" });
      continue;
    }
    for (const symbol of symbols) {
      const symbolEntity: GraphEntity = {
        ...fileEntity,
        id: computeEntityId(scope.projectId, file.path, symbol),
        symbol,
        kind: "symbol",
      };
      if (seen.has(symbolEntity.id) || !isGraphEntity(symbolEntity)) {
        dropped.push({
          path: file.path,
          reason: seen.has(symbolEntity.id) ? "duplicate-entry" : "invalid-symbol",
        });
        continue;
      }
      seen.add(symbolEntity.id);
      entities.push(symbolEntity);
    }
  }
  const known = new Set(entities.map((entity) => entity.id));
  const edges: GraphEdge[] = [];
  candidates.forEach((candidate, index) => {
    const path = `edge[${index}]`;
    if (!isEdgeKind(candidate.kind)) {
      dropped.push({ path, reason: "unknown-edge-kind" });
      return;
    }
    if (!isEdgeConfidence(candidate.kind, candidate.confidence)) {
      dropped.push({ path, reason: "invalid-confidence" });
      return;
    }
    if (!isGraphEdge(candidate, known)) {
      dropped.push({ path, reason: "dangling-edge" });
      return;
    }
    edges.push({ from: candidate.from, to: candidate.to, kind: candidate.kind, confidence: candidate.confidence });
  });
  return { kind: "built", baseline: { scope, entities, edges, observedAtMs: nowMs }, dropped };
}

/**
 * Per-project per-worktree keyed storage. The key is (project, worktree);
 * the revision inside the stored scope is the freshness binding, checked on
 * every read. Entries are immutable copies, so holders can never mutate the
 * cache and the dirty overlay can never write back through them.
 */
export class WorktreeGraphCache {
  private readonly baselines: Map<string, StoredBaseline> = new Map();

  store(baseline: StoredBaseline): void {
    this.baselines.set(storageKey(baseline.scope.projectId, baseline.scope.worktreeId), {
      scope: { ...baseline.scope },
      entities: baseline.entities.map((entity) => ({ ...entity })),
      edges: baseline.edges.map((edge) => ({ ...edge })),
      observedAtMs: baseline.observedAtMs,
    });
  }

  /** A miss is empty (undefined): unknown project/worktree pairs hold nothing. */
  get(projectId: string, worktreeId: string): StoredBaseline | undefined {
    if (!isProjectId(projectId) || !isWorktreeId(worktreeId)) return undefined;
    return this.baselines.get(storageKey(projectId, worktreeId));
  }

  /**
   * Freshness gates run before anything is served: a moved HEAD or evidence
   * older than 7 days resolves to `stale` with no baseline attached, so
   * stale data can never be served. A malformed clock or revision fails
   * closed to stale for the same reason.
   */
  read(projectId: string, worktreeId: string, headRevision: string, nowMs: number): BaselineRead {
    const baseline = this.get(projectId, worktreeId);
    if (baseline === undefined) return { status: "miss" };
    if (baseline.scope.revision !== headRevision) {
      return { status: "stale", reason: "HEAD-MOVE", scope: baseline.scope };
    }
    if (!(nowMs >= baseline.observedAtMs) || nowMs - baseline.observedAtMs > STALE_AFTER_MS) {
      return { status: "stale", reason: "EVID-STALE", scope: baseline.scope };
    }
    return { status: "hit", baseline };
  }
}

/**
 * Layers uncommitted edits over a fresh baseline. Pure: the baseline is only
 * read, the view carries the drops with their case. Per-entity order is
 * delete, then rename, then edit; edges lose nothing but graph-internal
 * endpoints that were dropped. Callers pass a baseline that already passed
 * `read` — scope staleness (HEAD-MOVE, EVID-STALE) is handled there, never
 * here.
 */
export function applyDirtyOverlay(
  baseline: StoredBaseline,
  edits: readonly DirtyEdit[],
): OverlayView {
  const byPath = new Map<string, DirtyEdit>();
  for (const edit of edits) byPath.set(edit.filePath, edit);
  const kept: GraphEntity[] = [];
  const dropped: OverlayDrop[] = [];
  for (const entity of baseline.entities) {
    const edit = byPath.get(entity.filePath);
    if (edit === undefined) {
      kept.push(entity);
      continue;
    }
    if (edit.blobSha256 === null) {
      dropped.push({ entityId: entity.id, reason: "SRC-DELETE" });
      continue;
    }
    if (entity.kind === "symbol" && !(edit.symbolHits > 0) && !edit.renameResolved) {
      dropped.push({ entityId: entity.id, reason: "SYM-RENAME" });
      continue;
    }
    if (!isFingerprint(edit.blobSha256) || computeFingerprint(entity.revision, edit.blobSha256) !== entity.fingerprint) {
      dropped.push({ entityId: entity.id, reason: "SRC-EDIT" });
      continue;
    }
    kept.push(entity);
  }
  const alive = new Set(kept.map((entity) => entity.id));
  const edges = baseline.edges.filter(
    (edge) => alive.has(edge.from) && (hasExternalTarget(edge.kind) || alive.has(edge.to)),
  );
  return { scope: baseline.scope, entities: kept, edges, dropped };
}

export function serializeIndex(baseline: StoredBaseline): string {
  return JSON.stringify({
    scope: baseline.scope,
    entities: baseline.entities,
    edges: baseline.edges,
    observedAtMs: baseline.observedAtMs,
  });
}

interface RawScope {
  readonly projectId?: string;
  readonly worktreeId?: string;
  readonly revision?: string;
  readonly fingerprint?: string;
}

interface RawEntity {
  readonly id?: string;
  readonly projectId?: string;
  readonly filePath?: string;
  readonly symbol?: string;
  readonly kind?: string;
  readonly revision?: string;
  readonly fingerprint?: string;
  readonly confidence?: number;
}

interface RawEdge {
  readonly from?: string;
  readonly to?: string;
  readonly kind?: string;
  readonly confidence?: number;
}

interface RawStoredIndex {
  readonly scope?: RawScope;
  readonly entities?: RawEntity[];
  readonly edges?: RawEdge[];
  readonly observedAtMs?: number;
}

/**
 * Parses one stored index snapshot. Any malformed entry corrupts the whole
 * snapshot (fail-closed): entity ids are recomputed like record.ts field 1,
 * entities must belong to the snapshot scope, and edges must use the closed
 * kind set with the per-edge confidence rule and resolvable endpoints.
 * Recovery rebuilds from HEAD files.
 */
export function parseStoredIndex(text: string): ParseStoredIndexResult {
  let raw: RawStoredIndex;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "corrupt", reason: "unparseable" };
  }
  if (raw === null || raw === undefined) return { kind: "corrupt", reason: "missing-field" };
  const scope = raw.scope;
  if (scope === undefined) return { kind: "corrupt", reason: "missing-field" };
  const scopeKey: GraphScopeKey = {
    projectId: scope.projectId ?? "",
    worktreeId: scope.worktreeId ?? "",
    revision: scope.revision ?? "",
    fingerprint: scope.fingerprint ?? "",
  };
  if (!isGraphScopeKey(scopeKey)) return { kind: "corrupt", reason: "malformed-scope" };
  if (scopeKey.fingerprint !== computeScopeFingerprint(scopeKey.projectId, scopeKey.worktreeId, scopeKey.revision)) {
    return { kind: "corrupt", reason: "scope-mismatch" };
  }
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.edges) || raw.observedAtMs === undefined) {
    return { kind: "corrupt", reason: "missing-field" };
  }
  if (!Number.isFinite(raw.observedAtMs) || raw.observedAtMs < 0) {
    return { kind: "corrupt", reason: "malformed-observed-at" };
  }
  const entities: GraphEntity[] = [];
  for (const entry of raw.entities) {
    if (
      entry.id === undefined ||
      entry.projectId === undefined ||
      entry.filePath === undefined ||
      entry.symbol === undefined ||
      entry.kind === undefined ||
      entry.revision === undefined ||
      entry.fingerprint === undefined ||
      entry.confidence === undefined
    ) {
      return { kind: "corrupt", reason: "missing-field" };
    }
    if (!isEntityKind(entry.kind) || !isConfidence(entry.confidence)) {
      return { kind: "corrupt", reason: "malformed-entity" };
    }
    const entity: GraphEntity = {
      id: entry.id,
      projectId: entry.projectId,
      filePath: entry.filePath,
      symbol: entry.symbol,
      kind: entry.kind,
      revision: entry.revision,
      fingerprint: entry.fingerprint,
      confidence: entry.confidence,
    };
    if (entity.id !== computeEntityId(entity.projectId, entity.filePath, entity.symbol)) {
      return { kind: "corrupt", reason: "id-mismatch" };
    }
    if (!isGraphEntity(entity)) return { kind: "corrupt", reason: "malformed-entity" };
    if (entity.projectId !== scopeKey.projectId || entity.revision !== scopeKey.revision) {
      return { kind: "corrupt", reason: "scope-drift" };
    }
    entities.push(entity);
  }
  const known = new Set(entities.map((entity) => entity.id));
  const edges: GraphEdge[] = [];
  for (const entry of raw.edges) {
    if (entry.from === undefined || entry.to === undefined || entry.kind === undefined || entry.confidence === undefined) {
      return { kind: "corrupt", reason: "missing-field" };
    }
    if (!isEdgeKind(entry.kind)) return { kind: "corrupt", reason: "unknown-edge-kind" };
    if (!isEdgeConfidence(entry.kind, entry.confidence)) {
      return { kind: "corrupt", reason: "invalid-confidence" };
    }
    const edge: GraphEdge = { from: entry.from, to: entry.to, kind: entry.kind, confidence: entry.confidence };
    if (!isGraphEdge(edge, known)) return { kind: "corrupt", reason: "dangling-edge" };
    edges.push(edge);
  }
  return {
    kind: "index",
    baseline: { scope: scopeKey, entities, edges, observedAtMs: raw.observedAtMs },
  };
}

/**
 * Loads the cached baseline or rebuilds it from HEAD files. Memory first,
 * then the stored snapshot, then a rebuild; the first problem found sets
 * the rebuild reason, with stored-index corruption taking reporting
 * priority because it signals damaged data. A rebuild derives entities
 * from HEAD files only and carries no edges unless none were dropped —
 * recovery never invents edges and never proves unresolved dynamics.
 * Invalid scope input is refused with no baseline attached.
 */
export function loadOrRebuild(cache: WorktreeGraphCache, input: LoadInput): LoadResult {
  if (
    !isProjectId(input.projectId) ||
    !isWorktreeId(input.worktreeId) ||
    !isRevision(input.headRevision) ||
    !Number.isFinite(input.nowMs)
  ) {
    return { status: "refused", reason: "invalid-scope" };
  }
  const memory = cache.read(input.projectId, input.worktreeId, input.headRevision, input.nowMs);
  if (memory.status === "hit") return { status: "hit", baseline: memory.baseline };
  let reason = memory.status === "stale" ? memory.reason : "miss";
  if (input.storedText !== undefined) {
    const parsed = parseStoredIndex(input.storedText);
    if (parsed.kind === "index") {
      const stored = parsed.baseline;
      if (stored.scope.projectId !== input.projectId || stored.scope.worktreeId !== input.worktreeId) {
        reason = "scope-mismatch";
      } else if (stored.scope.revision !== input.headRevision) {
        reason = "HEAD-MOVE";
      } else if (!(input.nowMs >= stored.observedAtMs) || input.nowMs - stored.observedAtMs > STALE_AFTER_MS) {
        reason = "EVID-STALE";
      } else if (
        !scopeKeyEquals(stored.scope, {
          projectId: input.projectId,
          worktreeId: input.worktreeId,
          revision: input.headRevision,
          fingerprint: computeScopeFingerprint(input.projectId, input.worktreeId, input.headRevision),
        })
      ) {
        reason = "scope-mismatch";
      } else {
        cache.store(stored);
        return { status: "hit", baseline: stored };
      }
    } else {
      reason = `corrupt-${parsed.reason}`;
    }
  }
  const scope: GraphScopeKey = {
    projectId: input.projectId,
    worktreeId: input.worktreeId,
    revision: input.headRevision,
    fingerprint: computeScopeFingerprint(input.projectId, input.worktreeId, input.headRevision),
  };
  const built = buildBaselineFromHeadFiles(scope, input.headFiles, [], input.nowMs);
  if (built.kind === "refused") return { status: "refused", reason: built.reason };
  cache.store(built.baseline);
  return { status: "rebuilt", baseline: built.baseline, reason, dropped: built.dropped };
}
