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

import { invalidateEdges } from "./extract";
import type { GraphNode, GraphSnapshot } from "./extract";
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
}

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
  /** Manual-review points (CALLS_UNRESOLVED sites, missing paths). Never facts. */
  readonly unresolved: readonly string[];
  /** Unsupported file types: reported as unindexed, never analyzed. */
  readonly unsupported: readonly string[];
  readonly items: readonly QueryItem[];
}

export interface QueryOptions {
  readonly scope: QueryScope;
  /** Override when the caller already holds a fresh baseline. */
  readonly baseline?: StoredBaseline;
  /** Caller-observed freshness; defaults to `fresh`. */
  readonly freshness?: FreshnessStatus;
  /** Result cap; clamped to [1, MAX_RESULT_LIMIT]. Defaults to 20. */
  readonly limit?: number;
  /** BFS depth cap for reachability queries; clamped to [1, 10]. Defaults to 5. */
  readonly maxDepth?: number;
}

export interface SymbolContextResult extends QueryEnvelope {
  readonly definition?: QueryItem;
  readonly callers: readonly QueryItem[];
  readonly callees: readonly QueryItem[];
}

export interface ImpactResult extends QueryEnvelope {
  readonly subject?: QueryItem;
  readonly impacted: readonly QueryItem[];
}

export interface TraceStep {
  readonly from: string;
  readonly to: string;
  readonly ref: string;
  readonly confidence: number;
}

export interface TraceResult extends QueryEnvelope {
  readonly path: readonly TraceStep[];
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

function baseEnvelope(scope: QueryScope, freshness: FreshnessStatus): {
  projectId: string;
  worktreeId: string;
  revision: string;
  fingerprint: string;
  freshness: FreshnessStatus;
} {
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
 * Substring search over file and symbol nodes, ranked exact-first.
 * A path-shaped query with an unsupported extension reports unindexed
 * instead of searching: non-program files are never analyzed.
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
  if ((query.includes("/") || query.includes("\\")) && !isSupportedPath(query)) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(query)],
      items: [],
    };
  }
  const ranked: { node: GraphNode; rank: number }[] = [];
  for (const node of snapshot.nodes) {
    if (node.kind !== "file" && node.kind !== "symbol") continue;
    const id = node.id.toLowerCase();
    const name = (node.name ?? "").toLowerCase();
    const file = node.file.toLowerCase();
    let rank = -1;
    if (id === needle || name === needle) rank = 0;
    else if (name.startsWith(needle)) rank = 1;
    else if (name.includes(needle)) rank = 2;
    else if (file.includes(needle)) rank = 3;
    else if (id.includes(needle)) rank = 4;
    if (rank >= 0) ranked.push({ node, rank });
  }
  ranked.sort((left, right) => rankCompare(left, right));
  const truncated = ranked.length > limit;
  const items = ranked.slice(0, limit).map(({ node }) => nodeItem(snapshot, node, definesEvidence(snapshot, node)));
  const notes = truncated ? [`truncated to ${limit} of ${ranked.length} matches`] : [];
  return {
    ...baseEnvelope(scope, freshness),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved: notes,
    unsupported: [],
    items,
  };
}

function rankCompare(
  left: { node: GraphNode; rank: number },
  right: { node: GraphNode; rank: number },
): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  return left.node.id < right.node.id ? -1 : 1;
}

function definesEvidence(snapshot: GraphSnapshot, node: GraphNode): QueryEvidence[] {
  if (node.kind === "file") return [indexedEvidence(node)];
  const evidence = snapshot.edges
    .filter((edge) => edge.kind === "DEFINES" && edge.to === node.id)
    .map((edge) => ({ edge: edge.kind, ref: edge.ref, confidence: edge.confidence }));
  return evidence.length > 0 ? evidence : [indexedEvidence(node)];
}

function findNode(snapshot: GraphSnapshot, id: string): GraphNode | undefined {
  return snapshot.nodes.find((node) => node.id === id);
}

function callersOf(snapshot: GraphSnapshot, symbolId: string): { caller: GraphNode; ref: string }[] {
  const out: { caller: GraphNode; ref: string }[] = [];
  for (const edge of snapshot.edges) {
    if (edge.kind !== "CALLS_STATIC" || edge.to !== symbolId) continue;
    const caller = findNode(snapshot, edge.from);
    if (caller !== undefined) out.push({ caller, ref: edge.ref });
  }
  out.sort((left, right) => (left.caller.id < right.caller.id ? -1 : 1));
  return out;
}

function calleesOf(snapshot: GraphSnapshot, symbolId: string): { callee: GraphNode; ref: string }[] {
  const out: { callee: GraphNode; ref: string }[] = [];
  for (const edge of snapshot.edges) {
    if (edge.kind !== "CALLS_STATIC" || edge.from !== symbolId) continue;
    const callee = findNode(snapshot, edge.to);
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
  return {
    ...baseEnvelope(scope, freshness),
    coverage: "unindexed",
    truncated: false,
    knowledgeIds: [],
    unresolved: [`no definition for ${symbolId} in this snapshot`],
    unsupported,
    items: [],
    definition: undefined,
    callers: [],
    callees: [],
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
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(filePart)],
      items: [],
      definition: undefined,
      callers: [],
      callees: [],
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
  const combined = [definition, ...callerItems, ...calleeItems];
  const truncated = combined.length > limit;
  const items = combined.slice(0, limit);
  return {
    ...baseEnvelope(scope, freshness),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved: [
      ...unresolvedFor(snapshot, symbolId),
      ...(truncated ? [`truncated to ${limit} of ${combined.length} rows`] : []),
    ],
    unsupported: [],
    items,
    definition,
    callers: callerItems.slice(0, limit),
    callees: calleeItems.slice(0, limit),
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
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(filePart)],
      items: [],
      subject: undefined,
      impacted: [],
    };
  }
  const subjectNode = findNode(snapshot, symbolId);
  if (subjectNode === undefined) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`no definition for ${symbolId} in this snapshot`],
      unsupported: [],
      items: [],
      subject: undefined,
      impacted: [],
    };
  }
  const subject = nodeItem(snapshot, subjectNode, definesEvidence(snapshot, subjectNode));
  const impacted: QueryItem[] = [];
  const seen = new Set<string>([symbolId]);
  let frontier = [symbolId];
  let truncated = false;
  for (let depth = 0; depth < maxDepth && frontier.length > 0 && !truncated; depth += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const { caller, ref } of callersOf(snapshot, current)) {
        if (seen.has(caller.id)) continue;
        seen.add(caller.id);
        if (impacted.length >= limit) {
          truncated = true;
          break;
        }
        impacted.push(nodeItem(snapshot, caller, [{ edge: "CALLS_STATIC", ref, confidence: 1 }]));
        if (caller.kind === "symbol") next.push(caller.id);
      }
      if (truncated) break;
    }
    frontier = next;
  }
  const unresolved = [
    ...unresolvedFor(snapshot, symbolId),
    ...(truncated ? [`truncated to ${limit} impacted rows`] : []),
  ];
  return {
    ...baseEnvelope(scope, freshness),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(impacted.map((item) => item.id)))),
    unresolved,
    unsupported: [],
    items: impacted,
    subject,
    impacted,
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
        coverage: "unindexed",
        truncated: false,
        knowledgeIds: [],
        unresolved: [],
        unsupported: [unsupportedNote(filePart)],
        items: [],
        path: [],
      };
    }
  }
  const fromNode = findNode(snapshot, fromId);
  const toNode = findNode(snapshot, toId);
  if (fromNode === undefined || toNode === undefined) {
    const missing = fromNode === undefined ? fromId : toId;
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`no definition for ${missing} in this snapshot`],
      unsupported: [],
      items: [],
      path: [],
    };
  }
  if (fromId === toId) {
    const self = nodeItem(snapshot, fromNode, [indexedEvidence(fromNode)]);
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "indexed",
      truncated: false,
      knowledgeIds: [...self.knowledgeIds],
      unresolved: [],
      unsupported: [],
      items: [self],
      path: [],
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
  if (abandoned && !found) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "partial",
      truncated: true,
      knowledgeIds: [],
      unresolved: [`trace abandoned: call frontier exceeded ${visitCap} nodes (bounded, never the whole graph)`],
      unsupported: [],
      items: [],
      path: [],
    };
  }
  if (!found) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "indexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`no static call path from ${fromId} to ${toId} (never guessed)`],
      unsupported: [],
      items: [],
      path: [],
    };
  }
  const chain: string[] = [toId];
  while (chain[0] !== fromId) {
    const head = chain[0] as string;
    const parent = parents.get(head);
    if (parent === undefined) break;
    chain.unshift(parent.via);
  }
  const path: TraceStep[] = [];
  for (let index = 0; index < chain.length - 1; index += 1) {
    const child = chain[index + 1] as string;
    const parent = parents.get(child);
    path.push({ from: chain[index] as string, to: child, ref: parent?.ref ?? "", confidence: 1 });
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
  return {
    ...baseEnvelope(scope, freshness),
    coverage: "indexed",
    truncated: false,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved: unresolvedFor(snapshot, fromId),
    unsupported: [],
    items,
    path,
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
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: subjectFile === undefined ? [`no definition for ${target} in this snapshot`] : [],
      unsupported: subjectFile === undefined ? [] : [unsupportedNote(subjectFile)],
      items: [],
      subjectFile: undefined,
      candidates: [],
    };
  }
  const subjectId = `file:${subjectFile}`;
  if (findNode(snapshot, subjectId) === undefined) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`${subjectFile} is not in this snapshot`],
      unsupported: [],
      items: [],
      subjectFile: undefined,
      candidates: [],
    };
  }
  const candidates: QueryItem[] = [];
  const seen = new Set<string>([subjectId]);
  const visitCap = limit * 20;
  let frontier: { id: string; via: QueryEvidence[] }[] = [{ id: subjectId, via: [] }];
  let truncated = false;
  for (let depth = 0; depth < maxDepth && frontier.length > 0 && !truncated; depth += 1) {
    const next: { id: string; via: QueryEvidence[] }[] = [];
    for (const current of frontier) {
      for (const edge of snapshot.edges) {
        if (edge.to !== current.id) continue;
        if (edge.kind !== "IMPORTS" && edge.kind !== "TESTS") continue;
        const importer = findNode(snapshot, edge.from);
        if (importer === undefined || seen.has(importer.id)) continue;
        seen.add(importer.id);
        if (seen.size > visitCap) {
          truncated = true;
          break;
        }
        const hop: QueryEvidence = { edge: edge.kind, ref: edge.ref, confidence: edge.confidence };
        const evidence = [...current.via, hop];
        if (importer.kind === "file" && importer.isTest === true) {
          if (candidates.length >= limit) {
            truncated = true;
            break;
          }
          candidates.push(nodeItem(snapshot, importer, evidence));
        } else if (importer.kind === "file") {
          next.push({ id: importer.id, via: evidence });
        }
      }
      if (truncated) break;
    }
    frontier = next;
  }
  candidates.sort((left, right) => (left.id < right.id ? -1 : 1));
  return {
    ...baseEnvelope(scope, freshness),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(candidates.map((item) => item.id)))),
    unresolved: truncated ? [`truncated to ${limit} candidate tests`] : [],
    unsupported: [],
    items: candidates,
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
  const items: QueryItem[] = kept.map((change) => ({
    id: change.id,
    file: change.file,
    line: change.line,
    evidence: [{ edge: "INVALIDATED_BY", ref: change.ref, confidence: change.confidence }],
    confidence: change.confidence,
    knowledgeIds: [],
  }));
  return {
    ...baseEnvelope(scope, options.freshness ?? (changes.length > 0 ? "stale" : "fresh")),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: [],
    unresolved: truncated ? [`truncated to ${limit} of ${changes.length} changes`] : [],
    unsupported: [],
    items,
    changes: kept,
  };
}

export type { GraphNode, GraphSnapshot, InvalidationCause, StoredBaseline };
export { KNOWLEDGE_PREFIX };
