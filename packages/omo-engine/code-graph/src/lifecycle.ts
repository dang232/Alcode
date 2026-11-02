// Code-graph indexing lifecycle: bounded, cancellable, generation-safe orchestration.
//
// The extractor (extract.ts indexFiles) stays synchronous and harness-neutral;
// this wrapper adds what a server/worker needs to stay alive:
// cooperative cancellation (AbortSignal at project boundaries), bounded budgets
// (files/nodes/edges/time/bytes, fail-closed, never silent), progress observability
// (phases actually finished, with sizes and elapsedMs), generation safety (monotonic
// per-scope generation, stale results discarded), concurrency safety (single-flight
// per scope, previous run aborted), incremental invalidation (shard reuse for
// unchanged files), freshness binding (revision/fingerprint/observedAt), cross-repo
// isolation (root validation, dropped-path redaction for logs), structured failure
// reporting (status plus reason plus generation, never a bare throw).
//
// Off-UI-thread note: indexFiles is CPU-bound and synchronous. This module yields
// to the event loop before the sync call (await yieldToEventLoop) and checks
// cancellation at every project boundary, so a caller keeps its own loop free
// between runs. For true parallelism run this coordinator inside a Worker
// (node:worker_threads / Bun Worker): this module is worker-safe (no DOM, no
// global mutable state beyond per-coordinator maps, all inputs serializable).
//
// Precedent: extract.ts (IndexOptions signal/budgets/generation, IndexProgressEvent
// with nodes/edges/elapsedMs, BUDGET and CANCELLED codes), snapshot-store.ts (shard
// split/join for incremental reuse), cache.ts (freshness gates HEAD-MOVE/EVID-STALE),
// schema.ts (scope fingerprint, closed edge set).

import { indexFiles } from './extract';
import type { DroppedFile, GraphEdge, GraphNode, GraphSnapshot, IndexBuildBudgets, IndexOptions, IndexProgressEvent } from './extract';
import { computeScopeFingerprint } from './schema';
import type { GraphScopeKey } from './schema';
import { fileOfNodeId, splitSnapshotIntoShards } from './snapshot-store';
import type { SnapshotShard } from './snapshot-store';

// Lifecycle budgets: index bounds plus total source bytes. Depth/time for queries live in QueryOptions.
export interface LifecycleBudgets extends IndexBuildBudgets {
  // Max total source bytes across entry files (post-index content sum). Exceeding truncates.
  readonly maxBytes?: number;
}

// One observed lifecycle step: extractor phases plus sizes, never extrapolated.
export interface LifecycleProgress {
  readonly phase: IndexProgressEvent['phase'];
  readonly files: number;
  readonly projectsDone: number;
  readonly projectsTotal: number;
  readonly nodes?: number;
  readonly edges?: number;
  readonly elapsedMs?: number;
  readonly generation: number;
}

export type LifecycleStatus =
  | 'complete'
  | 'truncated'
  | 'partial'
  | 'stale'
  | 'failed'
  | 'cancelled'
  | 'superseded';

export interface LifecycleStats {
  readonly files: number;
  readonly nodes: number;
  readonly edges: number;
  readonly bytes: number;
  readonly elapsedMs: number;
  readonly projectsTotal: number;
}

export interface LifecycleScope {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly revision: string;
  readonly generation: number;
}

export interface LifecycleResult {
  readonly status: LifecycleStatus;
  // Machine-readable reason (budget code, CANCELLED, SUPERSEDED, STALE, error message). Absent on complete.
  readonly reason?: string;
  readonly scope: LifecycleScope;
  readonly fingerprint: string;
  // Present on complete/truncated/partial; absent on failed/cancelled/stale/superseded.
  readonly snapshot?: GraphSnapshot;
  readonly stats?: LifecycleStats;
  // Redacted dropped entries for serving (basenames, never absolute paths in logs).
  readonly droppedRedacted?: readonly { readonly file: string; readonly reason: string }[];
}

export interface LifecycleRequest {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly revision: string;
  readonly entryFiles: readonly string[];
  readonly rootDir?: string;
  readonly budgets?: LifecycleBudgets;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LifecycleProgress) => void;
  readonly onPartialSnapshot?: (
    snapshot: GraphSnapshot,
    progress: { readonly projectsDone: number; readonly projectsTotal: number },
  ) => void;
  // Optional upfront file sizes (bytes) for maxBytes pre-check without extra IO.
  readonly fileSizes?: Readonly<Record<string, number>>;
}

// Yield one macrotask so the event loop breathes before CPU-bound indexing.
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const g = globalThis as unknown as { readonly setImmediate?: (fn: () => void) => void };
    if (typeof g.setImmediate === 'function') g.setImmediate(() => resolve());
    else setTimeout(() => resolve(), 0);
  });
}

function scopeKeyOf(projectId: string, worktreeId: string): string {
  return projectId + '\0' + worktreeId;
}

function fingerprintOf(projectId: string, worktreeId: string, revision: string): string {
  return computeScopeFingerprint(projectId, worktreeId, revision);
}

// Total source bytes from snapshot content (sum of stored line lengths).
export function snapshotBytes(snapshot: GraphSnapshot): number {
  const files = snapshot.content?.files ?? {};
  let total = 0;
  for (const entry of Object.values(files)) {
    for (const line of entry.lines) total += line.length + 1;
  }
  return total;
}

// Redact absolute dropped paths for logs/telemetry: basename plus reason, never a filesystem layout.
export function redactDropped(dropped: readonly DroppedFile[] | undefined): readonly { readonly file: string; readonly reason: string }[] {
  if (!dropped) return [];
  return dropped.map((entry) => {
    const fwd = entry.file.split('/').pop() ?? entry.file;
    const clean = fwd.split('\\').pop() ?? fwd;
    return { file: clean, reason: entry.reason };
  });
}

// Validate a snapshot before serving it to a scope: root must be set when rootDir
// was requested, no node id may escape (absolute, drive prefix, .. segment), and
// every node file must be repo-relative POSIX. Returns a reason when the snapshot
// must not be served (cross-repo or torn), else undefined.
export function validateSnapshotForScope(snapshot: GraphSnapshot, expectedRoot: string | undefined): string | undefined {
  if (expectedRoot !== undefined && snapshot.root === undefined) {
    return 'snapshot has no root but rootDir was requested (cross-repo risk)';
  }
  for (const node of snapshot.nodes) {
    if (node.file.indexOf('\\') >= 0) return 'node file contains backslash: ' + node.id;
    if (/^[a-zA-Z]:\//.test(node.file)) return 'node file is absolute: ' + node.id;
    if (node.file.charAt(0) === '/') return 'node file is absolute: ' + node.id;
    if (node.file.split('/').indexOf('..') >= 0) return 'node file escapes root: ' + node.id;
    if (node.id.indexOf('\\') >= 0) return 'node id contains backslash: ' + node.id;
  }
  for (const edge of snapshot.edges) {
    if (edge.ref.indexOf('\\') >= 0) return 'edge ref contains backslash: ' + edge.id;
    if (/^[a-zA-Z]:\//.test(edge.ref)) return 'edge ref is absolute: ' + edge.id;
  }
  return undefined;
}

// Map a thrown extractor error (with .code) to a lifecycle status plus reason.
function mapBuildError(error: unknown): { status: LifecycleStatus; reason: string } {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  const reason = typeof code === 'string' ? '[' + code + '] ' + message : message;
  if (code === 'CANCELLED' || (error instanceof Error && error.name === 'AbortError')) {
    return { status: 'cancelled', reason };
  }
  if (code === 'BUDGET_FILES' || code === 'BUDGET_NODES' || code === 'BUDGET_EDGES' || code === 'BUDGET_TIME') {
    return { status: 'truncated', reason };
  }
  return { status: 'failed', reason };
}

// One bounded, cancellable indexing run. Yields before the sync build, forwards
// progress with generation, enforces maxBytes post-index, validates cross-repo
// scope, and never throws (all failures become LifecycleResult).
export async function runLifecycleIndex(request: LifecycleRequest, generation: number): Promise<LifecycleResult> {
  const projectId = request.projectId;
  const worktreeId = request.worktreeId;
  const revision = request.revision;
  const entryFiles = request.entryFiles;
  const rootDir = request.rootDir;
  const budgets = request.budgets;
  const signal = request.signal;
  const fingerprint = fingerprintOf(projectId, worktreeId, revision);
  const scope: LifecycleScope = { projectId, worktreeId, revision, generation };
  if (signal?.aborted === true) {
    return { status: 'cancelled', reason: 'code-graph: indexing cancelled (signal already aborted)', scope, fingerprint };
  }
  if (budgets?.maxBytes !== undefined && request.fileSizes !== undefined) {
    let total = 0;
    for (const file of entryFiles) total += request.fileSizes[file] ?? 0;
    if (total > (budgets.maxBytes ?? Number.POSITIVE_INFINITY)) {
      return {
        status: 'truncated',
        reason: 'code-graph: byte budget exceeded (' + total + ' bytes > maxBytes ' + budgets.maxBytes + ')',
        scope,
        fingerprint,
      };
    }
  }
  const startMs = Date.now();
  const indexOptions: IndexOptions = {
    rootDir,
    budgets: budgets === undefined ? undefined : { maxFiles: budgets.maxFiles, maxNodes: budgets.maxNodes, maxEdges: budgets.maxEdges, maxMs: budgets.maxMs },
    signal,
    generation,
    onProgress: (event) => {
      request.onProgress?.({
        phase: event.phase,
        files: event.files,
        projectsDone: event.projectsDone,
        projectsTotal: event.projectsTotal,
        nodes: event.nodes,
        edges: event.edges,
        elapsedMs: event.elapsedMs ?? Date.now() - startMs,
        generation,
      });
    },
    onPartialSnapshot: request.onPartialSnapshot,
  };
  await yieldToEventLoop();
  if (signal?.aborted === true) {
    return { status: 'cancelled', reason: 'code-graph: indexing cancelled (aborted while yielding)', scope, fingerprint };
  }
  let snapshot: GraphSnapshot;
  try {
    snapshot = indexFiles(entryFiles, indexOptions);
  } catch (error) {
    const mapped = mapBuildError(error);
    return { status: mapped.status, reason: mapped.reason, scope, fingerprint };
  }
  const elapsedMs = Date.now() - startMs;
  const bytes = snapshotBytes(snapshot);
  if (budgets?.maxBytes !== undefined && bytes > budgets.maxBytes) {
    return {
      status: 'truncated',
      reason: 'code-graph: byte budget exceeded (' + bytes + ' bytes > maxBytes ' + budgets.maxBytes + ')',
      scope,
      fingerprint,
      snapshot,
      stats: { files: entryFiles.length, nodes: snapshot.nodes.length, edges: snapshot.edges.length, bytes, elapsedMs, projectsTotal: 0 },
      droppedRedacted: redactDropped(snapshot.dropped),
    };
  }
  const scopeError = validateSnapshotForScope(snapshot, rootDir);
  if (scopeError !== undefined) {
    return { status: 'failed', reason: scopeError, scope, fingerprint };
  }
  const partial = (snapshot.dropped !== undefined && snapshot.dropped.length > 0) || (snapshot.content?.skipped.length ?? 0) > 0;
  const stats: LifecycleStats = {
    files: entryFiles.length,
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
    bytes,
    elapsedMs,
    projectsTotal: 0,
  };
  if (partial) {
    return { status: 'partial', reason: 'index truncated: dropped or skipped files present', scope, fingerprint, snapshot, stats, droppedRedacted: redactDropped(snapshot.dropped) };
  }
  return { status: 'complete', scope, fingerprint, snapshot, stats, droppedRedacted: redactDropped(snapshot.dropped) };
}

// Single-flight coordinator: one in-flight run per (project, worktree). A new
// request aborts the previous run (cancellable worker) and bumps the generation;
// a run whose generation is no longer current resolves as superseded (generation
// safety) instead of overwriting the fresh answer.
export class IndexCoordinator {
  private readonly generations = new Map<string, number>();
  private readonly inflight = new Map<string, { readonly generation: number; readonly controller: AbortController }>();

  // Current generation for a scope (0 when never requested).
  generationOf(projectId: string, worktreeId: string): number {
    return this.generations.get(scopeKeyOf(projectId, worktreeId)) ?? 0;
  }

  // Abort the in-flight run for a scope, if any.
  cancel(projectId: string, worktreeId: string): boolean {
    const key = scopeKeyOf(projectId, worktreeId);
    const current = this.inflight.get(key);
    if (!current) return false;
    try {
      current.controller.abort();
    } catch {
      // AbortController.abort never throws; guard for exotic shims.
    }
    return true;
  }

  // Request an indexing run. Aborts any in-flight run for the same scope, assigns
  // generation = previous + 1, and runs bounded plus cancellable. If a newer request
  // started while this one ran, the result is superseded (stale generation discarded).
  async request(request: LifecycleRequest): Promise<LifecycleResult> {
    const key = scopeKeyOf(request.projectId, request.worktreeId);
    const previous = this.inflight.get(key);
    if (previous) {
      try {
        previous.controller.abort();
      } catch {
        // ignore
      }
    }
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    const controller = new AbortController();
    this.inflight.set(key, { generation, controller });
    const combined = linkSignals(request.signal, controller.signal);
    try {
      const result = await runLifecycleIndex({ ...request, signal: combined.signal }, generation);
      const current = this.generations.get(key) ?? 0;
      if (generation !== current) {
        return {
          status: 'superseded',
          reason: 'code-graph: generation ' + generation + ' superseded by ' + current,
          scope: { projectId: request.projectId, worktreeId: request.worktreeId, revision: request.revision, generation },
          fingerprint: fingerprintOf(request.projectId, request.worktreeId, request.revision),
        };
      }
      if (combined.abortedByCaller && (result.status === 'complete' || result.status === 'partial' || result.status === 'truncated')) {
        return {
          status: 'cancelled',
          reason: 'code-graph: indexing cancelled (caller signal aborted)',
          scope: { projectId: request.projectId, worktreeId: request.worktreeId, revision: request.revision, generation },
          fingerprint: fingerprintOf(request.projectId, request.worktreeId, request.revision),
        };
      }
      return result;
    } finally {
      combined.dispose();
      const entry = this.inflight.get(key);
      if (entry?.generation === generation) this.inflight.delete(key);
    }
  }
}

// Link a caller signal to an internal controller signal; reports which side aborted.
function linkSignals(caller: AbortSignal | undefined, internal: AbortSignal): { readonly signal: AbortSignal; readonly abortedByCaller: boolean; dispose(): void } {
  let abortedByCaller = false;
  const linked = new AbortController();
  const onCallerAbort = (): void => {
    abortedByCaller = true;
    linked.abort();
  };
  const onInternalAbort = (): void => {
    linked.abort();
  };
  if (caller?.aborted === true) {
    abortedByCaller = true;
    linked.abort();
    return { signal: linked.signal, abortedByCaller, dispose: () => undefined };
  }
  if (internal.aborted === true) {
    linked.abort();
    return { signal: linked.signal, abortedByCaller, dispose: () => undefined };
  }
  caller?.addEventListener('abort', onCallerAbort, { once: true });
  internal.addEventListener('abort', onInternalAbort, { once: true });
  if (caller?.aborted === true) {
    abortedByCaller = true;
    linked.abort();
  } else if (internal.aborted === true) {
    linked.abort();
  }
  return {
    signal: linked.signal,
    get abortedByCaller(): boolean {
      return abortedByCaller || ((caller?.aborted === true) && !internal.aborted);
    },
    dispose: () => {
      caller?.removeEventListener('abort', onCallerAbort);
      internal.removeEventListener('abort', onInternalAbort);
    },
  };
}

// Incremental rebuild: keep shards whose file is untouched, merge with a freshly
// indexed snapshot for changed files. No edges invented: an edge that loses a
// graph-internal endpoint after the merge is withheld (like the dirty overlay) and
// reported as invalidated. Provenance preserved: kept nodes/edges keep ids,
// confidence, and refs byte-identical.
export function rebuildIncremental(
  previous: GraphSnapshot,
  changedFiles: ReadonlySet<string>,
  freshChanged: GraphSnapshot,
): { readonly snapshot: GraphSnapshot; readonly reusedFiles: number; readonly invalidatedEdges: number } {
  const previousShards = splitSnapshotIntoShards(previous);
  const keptShards: SnapshotShard[] = [];
  for (const shard of previousShards) {
    if (!changedFiles.has(shard.file)) keptShards.push(shard);
  }
  const freshShards = splitSnapshotIntoShards(freshChanged);
  const changedFreshShards: SnapshotShard[] = [];
  for (const shard of freshShards) {
    if (changedFiles.has(shard.file)) changedFreshShards.push(shard);
  }
  // Nodes merge by id with fresh winning: a subset program can re-emit a
  // file node for an unchanged file it resolved through (e.g. an import
  // target), and the merged set must hold each id exactly once.
  const nodeById = new Map<string, GraphNode>();
  for (const shard of keptShards) {
    for (const node of shard.nodes) {
      if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    }
  }
  for (const shard of changedFreshShards) {
    for (const node of shard.nodes) nodeById.set(node.id, node);
  }
  const fileOfId = (id: string): string | null => {
    if (id === 'unknown') return null;
    const known = nodeById.get(id);
    if (known !== undefined && typeof known.file === 'string' && known.file.length > 0) return known.file;
    // Shared attribution with sharding: call-site ids carry their file,
    // everything else parses the same grammar as splitSnapshotIntoShards.
    return fileOfNodeId(id);
  };
  // A kept edge survives when its source file was not reanalyzed and both
  // endpoints are alive. Refs point into the source file, which is
  // byte-identical when kept, so they cannot go stale; a surviving target
  // endpoint keeps the relationship true. Edges from reanalyzed files are
  // recomputed, never carried.
  let invalidatedEdges = 0;
  const keptEdges: GraphEdge[] = [];
  for (const shard of keptShards) {
    for (const edge of shard.edges) {
      const fromFile = fileOfId(edge.from);
      const toFile = fileOfId(edge.to);
      const fromAlive = nodeById.has(edge.from);
      const toAlive = edge.to === 'unknown' || nodeById.has(edge.to);
      if (!fromAlive || !toAlive) {
        invalidatedEdges += 1;
        continue;
      }
      if (fromFile === null && toFile === null) {
        invalidatedEdges += 1;
        continue;
      }
      if (fromFile !== null && changedFiles.has(fromFile)) {
        invalidatedEdges += 1;
        continue;
      }
      keptEdges.push(edge);
    }
  }
  const seenEdgeIds = new Set(keptEdges.map((edge) => edge.id));
  const freshEdges: GraphEdge[] = [];
  for (const shard of changedFreshShards) {
    for (const edge of shard.edges) {
      if (seenEdgeIds.has(edge.id)) continue;
      seenEdgeIds.add(edge.id);
      freshEdges.push(edge);
    }
  }
  const nodes = [...nodeById.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const edges = [...keptEdges, ...freshEdges].sort((a, b) => (a.id < b.id ? -1 : 1));
  const byFile: Record<string, NonNullable<NonNullable<GraphSnapshot['content']>['files'][string]>> = {};
  const skippedMap = new Map<string, { readonly file: string; readonly reason: 'binary' | 'too-large'; readonly language: string; readonly isTest: boolean }>();
  for (const entry of previous.content?.skipped ?? []) {
    const fileOf = (entry as { file: string }).file;
    if (!changedFiles.has(fileOf)) skippedMap.set(fileOf, entry as { readonly file: string; readonly reason: 'binary' | 'too-large'; readonly language: string; readonly isTest: boolean });
  }
  for (const entry of freshChanged.content?.skipped ?? []) {
    skippedMap.set((entry as { file: string }).file, entry as { readonly file: string; readonly reason: 'binary' | 'too-large'; readonly language: string; readonly isTest: boolean });
  }
  const prevFiles = previous.content?.files ?? {};
  for (const entry of Object.entries(prevFiles)) {
    const file = entry[0];
    const record = entry[1] as NonNullable<NonNullable<GraphSnapshot['content']>['files'][string]>;
    if (!changedFiles.has(file)) byFile[file] = record;
  }
  const freshFiles = freshChanged.content?.files ?? {};
  for (const entry of Object.entries(freshFiles)) {
    const file = entry[0];
    const record = entry[1] as NonNullable<NonNullable<GraphSnapshot['content']>['files'][string]>;
    if (changedFiles.has(file)) byFile[file] = record;
  }
  const mergedDroppedMap = new Map<string, DroppedFile>();
  for (const drop of previous.dropped ?? []) mergedDroppedMap.set(drop.file, drop);
  for (const drop of freshChanged.dropped ?? []) mergedDroppedMap.set(drop.file, drop);
  for (const file of Object.keys(byFile)) {
    for (const key of [...mergedDroppedMap.keys()]) {
      if (key.endsWith('/' + file) || key === file) mergedDroppedMap.delete(key);
    }
  }
  const mergedDropped = [...mergedDroppedMap.values()].sort((a, b) => (a.file < b.file ? -1 : 1));
  const tokenCap = previous.content?.tokenCap ?? freshChanged.content?.tokenCap ?? 5000;
  const snapshot: GraphSnapshot = {
    nodes,
    edges,
    content: {
      tokenCap,
      files: byFile,
      skipped: [...skippedMap.values()].sort((a, b) => (a.file < b.file ? -1 : 1)),
    },
    ...(previous.root !== undefined || freshChanged.root !== undefined ? { root: freshChanged.root ?? previous.root } : {}),
    ...(mergedDropped.length > 0 ? { dropped: mergedDropped } : {}),
  };
  return { snapshot, reusedFiles: keptShards.length, invalidatedEdges };
}

// Build a GraphScopeKey for cache/freshness binding (revision plus fingerprint).
export function lifecycleScopeKey(projectId: string, worktreeId: string, revision: string): GraphScopeKey {
  return { projectId, worktreeId, revision, fingerprint: fingerprintOf(projectId, worktreeId, revision) };
}
