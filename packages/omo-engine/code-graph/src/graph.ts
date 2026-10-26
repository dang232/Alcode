/**
 * Code-graph public barrel: thin re-export of the package API.
 *
 * Owning modules hold all logic; this file only names what is public.
 * `GraphEdge` is the extraction snapshot edge (`extract.ts`, with `id`
 * and `ref`); the cache storage edge (`schema.ts`) is aliased as
 * `SchemaGraphEdge` so both stay reachable without a name clash.
 * Query re-exports (`GraphNode`, `GraphSnapshot`, `InvalidationCause`,
 * `StoredBaseline`) resolve to their owning modules and are not repeated.
 */

export type {
  EdgeKind,
  NodeKind,
  InvalidationCause,
  GraphNode,
  GraphEdge,
  GraphSnapshot,
  KnowledgeLinkInput,
  IndexOptions,
} from "./extract";
export { indexFiles, invalidateEdges, isTestPath } from "./extract";

export type {
  GraphEntityKind,
  GraphEdgeKind,
  GraphConfidence,
  GraphInvalidationCause,
  GraphInvalidationCase,
  GraphScopeKey,
  GraphEntity,
  GraphEdge as SchemaGraphEdge,
} from "./schema";
export {
  STALE_AFTER_MS,
  GRAPH_ENTITY_KINDS,
  GRAPH_EDGE_KINDS,
  computeFingerprint,
  computeScopeFingerprint,
  computeEntityId,
  isProjectId,
  isWorktreeId,
  isRevision,
  isFingerprint,
  isEntityKind,
  isEdgeKind,
  isConfidence,
  maxEdgeConfidence,
  isEdgeConfidence,
  isInvalidationCause,
  isKnowledgeRecordId,
  hasExternalTarget,
  storageKey,
  scopeKeyEquals,
  isGraphScopeKey,
  isGraphEntity,
  isGraphEdge,
} from "./schema";

export type {
  BaselineStaleReason,
  OverlayDropReason,
  HeadFile,
  DirtyEdit,
  StoredBaseline,
  BaselineDrop,
  BuildResult,
  BaselineRead,
  OverlayDrop,
  OverlayView,
  ParseStoredIndexResult,
  LoadInput,
  LoadResult,
} from "./cache";
export {
  WorktreeGraphCache,
  applyDirtyOverlay,
  buildBaselineFromHeadFiles,
  loadOrRebuild,
  parseStoredIndex,
  serializeIndex,
} from "./cache";

export type {
  QueryScope,
  FreshnessStatus,
  CoverageStatus,
  QueryEvidence,
  QueryItem,
  QueryEnvelope,
  QueryOptions,
  SymbolContextResult,
  ImpactResult,
  TraceStep,
  TraceResult,
  FindTestsResult,
  QueryChange,
  DetectChangesResult,
} from "./queries";
export {
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  KNOWLEDGE_PREFIX,
  scopeFromBaseline,
  search,
  symbolContext,
  impact,
  trace,
  findTests,
  detectChanges,
} from "./queries";
