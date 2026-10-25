/**
 * Code-graph schema: entities, closed edge set, confidence, and scope key.
 *
 * Binding: `.omo/ulw/waves/s53-phase-a/schema-draft.md` sections 1-4.
 * Precedent: `memory-core/src/project-knowledge/record.ts` (fingerprint
 * grammar, project-id grammar, revision grammar, confidence grammar,
 * `RECORD_ID` shape, `InvalidationCase` vocabulary) and `validator.ts`
 * (freshness gates, promotion confidence gate). The grammars are
 * re-declared here so this module stays dependency-free; the text shapes
 * match on purpose.
 *
 * - Fingerprint: sha256(`${revision}:${blobSha256}`), 64 lowercase hex.
 * - Scope fingerprint: sha256(`${projectId}\n${worktreeId}\n${revision}`).
 * - Project id: `<safe-slug>-<sha256-8>`.
 * - Revision: 40 lowercase hex (a pinned commit sha, never a branch name).
 * - Confidence: number in [0, 1] with at most 2 decimals.
 */

import { createHash } from "node:crypto";

/** A graph record older than this is stale (same 7-day gate as validator.ts). */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type GraphEntityKind = "file" | "symbol";

export const GRAPH_ENTITY_KINDS: readonly GraphEntityKind[] = ["file", "symbol"];

/**
 * Closed edge set (schema-draft section 2). No other edge kinds may be
 * added without a schema revision. Unknown kinds are rejected at the
 * boundary, never stored or inferred.
 */
export type GraphEdgeKind =
  | "DEFINES"
  | "IMPORTS"
  | "CALLS_STATIC"
  | "CALLS_UNRESOLVED"
  | "EXPORTS"
  | "TESTS"
  | "LINKS_KNOWLEDGE"
  | "INVALIDATED_BY";

export const GRAPH_EDGE_KINDS: readonly GraphEdgeKind[] = [
  "DEFINES",
  "IMPORTS",
  "CALLS_STATIC",
  "CALLS_UNRESOLVED",
  "EXPORTS",
  "TESTS",
  "LINKS_KNOWLEDGE",
  "INVALIDATED_BY",
];

/** Number in [0, 1] with at most 2 decimals. Validated at every boundary. */
export type GraphConfidence = number;

/**
 * Cause vocabulary for INVALIDATED_BY `to` targets, reused unchanged from
 * the memory service `InvalidationCase` (schema-draft section 2).
 */
export type GraphInvalidationCause =
  | "SRC-EDIT"
  | "SRC-DELETE"
  | "SYM-RENAME"
  | "HEAD-MOVE"
  | "EVID-STALE"
  | "SUPERSEDE-CHAIN"
  | "SCOPE-NARROW"
  | "SECRET-FOUND"
  | "PROV-BREAK"
  | "ENV-CHANGE";

/** Subset of the cause vocabulary that applies to cached-graph freshness. */
export type GraphInvalidationCase = Extract<
  GraphInvalidationCause,
  "HEAD-MOVE" | "EVID-STALE" | "SRC-EDIT" | "SRC-DELETE" | "SYM-RENAME"
>;

/**
 * Scope key: which project, which worktree, at which revision, bound to
 * which content. The cache keys storage on (projectId, worktreeId) and
 * treats (revision, fingerprint) as the freshness binding.
 */
export interface GraphScopeKey {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly revision: string;
  readonly fingerprint: string;
}

export interface GraphEntity {
  readonly id: string;
  readonly projectId: string;
  readonly filePath: string;
  readonly symbol: string;
  readonly kind: GraphEntityKind;
  readonly revision: string;
  readonly fingerprint: string;
  readonly confidence: GraphConfidence;
}

export interface GraphEdge {
  readonly from: string;
  /** Graph-internal kinds target an entity id; see hasExternalTarget. */
  readonly to: string;
  readonly kind: GraphEdgeKind;
  readonly confidence: GraphConfidence;
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ENTITY_ID = /^cg-[0-9a-f]{12}$/;
const KNOWLEDGE_RECORD_ID = /^pk-[0-9a-f]{12}$/;
const PROJECT_ID = /^[^\s/]+-[0-9a-f]{8}$/;
const WORKTREE_ID = /^[^\s/\\]{1,128}$/;
/** `file` or a namespaced symbol (same shape as record.ts). */
const SYMBOL = /^(?:file|fn:[^\s:]+|class:[^\s:]+|const:[^\s:]+)$/;
/** Confidence text: number in [0,1] with at most 2 decimals. */
const CONFIDENCE_TEXT = /^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/;

/** Cap for unresolved dynamics: never proven (schema-draft section 3). */
const UNRESOLVED_CONFIDENCE_CAP = 0.5;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Content binding of the pinned revision to the observed blob. */
export function computeFingerprint(revision: string, blobSha256: string): string {
  return sha256Hex(`${revision}:${blobSha256}`);
}

/** Content binding of a scope key to its (project, worktree, revision). */
export function computeScopeFingerprint(
  projectId: string,
  worktreeId: string,
  revision: string,
): string {
  return sha256Hex(`${projectId}\n${worktreeId}\n${revision}`);
}

/** Stable content-derived entity identity. Recomputed, never user-supplied. */
export function computeEntityId(projectId: string, filePath: string, symbol: string): string {
  return `cg-${sha256Hex(`${projectId}\n${filePath}\n${symbol}`).slice(0, 12)}`;
}

function isRepoRelativePath(value: string): boolean {
  if (value.length === 0 || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return false;
  }
  return true;
}

export function isProjectId(value: string): value is string {
  return PROJECT_ID.test(value);
}

export function isWorktreeId(value: string): value is string {
  return WORKTREE_ID.test(value);
}

export function isRevision(value: string): value is string {
  return HEX40.test(value);
}

export function isFingerprint(value: string): value is string {
  return HEX64.test(value);
}

export function isEntityKind(value: string): value is GraphEntityKind {
  return value === "file" || value === "symbol";
}

export function isEdgeKind(value: string): value is GraphEdgeKind {
  return (
    value === "DEFINES" ||
    value === "IMPORTS" ||
    value === "CALLS_STATIC" ||
    value === "CALLS_UNRESOLVED" ||
    value === "EXPORTS" ||
    value === "TESTS" ||
    value === "LINKS_KNOWLEDGE" ||
    value === "INVALIDATED_BY"
  );
}

export function isConfidence(value: number): value is GraphConfidence {
  return Number.isFinite(value) && value >= 0 && value <= 1 && CONFIDENCE_TEXT.test(String(value));
}

/** Highest confidence an edge kind may carry (schema-draft section 3). */
export function maxEdgeConfidence(kind: GraphEdgeKind): GraphConfidence {
  return kind === "CALLS_UNRESOLVED" ? UNRESOLVED_CONFIDENCE_CAP : 1;
}

/**
 * Per-edge confidence rule (schema-draft section 3): resolved kinds are
 * 1.00 or the edge is not emitted; CALLS_UNRESOLVED is capped at 0.50 and
 * never proven; LINKS_KNOWLEDGE inherits the linked record's confidence
 * unchanged, so any valid confidence holds.
 */
export function isEdgeConfidence(kind: GraphEdgeKind, confidence: number): boolean {
  if (!isConfidence(confidence)) return false;
  if (kind === "LINKS_KNOWLEDGE") return true;
  return confidence <= maxEdgeConfidence(kind) && (kind === "CALLS_UNRESOLVED" || confidence === 1);
}

export function isInvalidationCause(value: string): value is GraphInvalidationCause {
  return (
    value === "SRC-EDIT" ||
    value === "SRC-DELETE" ||
    value === "SYM-RENAME" ||
    value === "HEAD-MOVE" ||
    value === "EVID-STALE" ||
    value === "SUPERSEDE-CHAIN" ||
    value === "SCOPE-NARROW" ||
    value === "SECRET-FOUND" ||
    value === "PROV-BREAK" ||
    value === "ENV-CHANGE"
  );
}

export function isKnowledgeRecordId(value: string): value is string {
  return KNOWLEDGE_RECORD_ID.test(value);
}

/**
 * Edge kinds whose `to` target lives outside the graph node set and is
 * therefore exempt from endpoint-existence checks: CALLS_UNRESOLVED points
 * at an unknown callee (well-formed marker, never a guessed symbol),
 * LINKS_KNOWLEDGE at a `pk-` record id (memory side authoritative),
 * INVALIDATED_BY at an invalidation cause. All other kinds target graph
 * entities that must exist.
 */
export function hasExternalTarget(kind: GraphEdgeKind): boolean {
  return kind === "CALLS_UNRESOLVED" || kind === "LINKS_KNOWLEDGE" || kind === "INVALIDATED_BY";
}

/** Storage key: per-project per-worktree. Revision binds freshness, not identity. */
export function storageKey(projectId: string, worktreeId: string): string {
  return `${projectId}\0${worktreeId}`;
}

export function scopeKeyEquals(left: GraphScopeKey, right: GraphScopeKey): boolean {
  return (
    left.projectId === right.projectId &&
    left.worktreeId === right.worktreeId &&
    left.revision === right.revision &&
    left.fingerprint === right.fingerprint
  );
}

export function isGraphScopeKey(scope: GraphScopeKey): boolean {
  return (
    isProjectId(scope.projectId) &&
    isWorktreeId(scope.worktreeId) &&
    isRevision(scope.revision) &&
    isFingerprint(scope.fingerprint)
  );
}

export function isGraphEntity(entity: GraphEntity): boolean {
  return (
    ENTITY_ID.test(entity.id) &&
    entity.id === computeEntityId(entity.projectId, entity.filePath, entity.symbol) &&
    isProjectId(entity.projectId) &&
    isRepoRelativePath(entity.filePath) &&
    SYMBOL.test(entity.symbol) &&
    isEntityKind(entity.kind) &&
    (entity.kind === "file" ? entity.symbol === "file" : entity.symbol !== "file") &&
    isRevision(entity.revision) &&
    isFingerprint(entity.fingerprint) &&
    isConfidence(entity.confidence)
  );
}

export function isGraphEdge(edge: GraphEdge, knownIds: ReadonlySet<string>): boolean {
  if (!isEdgeKind(edge.kind)) return false;
  if (!ENTITY_ID.test(edge.from) || !knownIds.has(edge.from)) return false;
  if (!isEdgeConfidence(edge.kind, edge.confidence)) return false;
  if (edge.kind === "CALLS_UNRESOLVED") return ENTITY_ID.test(edge.to);
  if (edge.kind === "LINKS_KNOWLEDGE") return isKnowledgeRecordId(edge.to);
  if (edge.kind === "INVALIDATED_BY") return isInvalidationCause(edge.to);
  return ENTITY_ID.test(edge.to) && knownIds.has(edge.to);
}
