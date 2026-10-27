/**
 * Code-graph engine bundle — BUILD SOURCE ONLY.
 *
 * Never import this file at runtime. It imports engine `.ts` directly, which
 * plain Node cannot resolve in the packaged app (same constraint as
 * `agents/omo-native-catalog.js`: extensionless relative imports plus
 * `typescript/unstable/*` subpaths). Runtime entries import the committed
 * `code-graph.bundle.js` instead (regen with `bun ./code-graph.regen.js` in
 * this directory); only that bundle may appear in a runtime import chain.
 *
 * The bundle inlines the engine (`extract`, `queries`, `cache`, `schema`
 * plus the compiler API they drive); only `node:*` builtins stay external.
 * `indexFiles` locates its `tsserver` binary relative to the vendored
 * `typescript@7.0.2` install at runtime, so a checkout without it fails
 * explicitly instead of serving an empty graph.
 *
 * Only the calls the site route needs are re-exported: snapshot building,
 * the read-only queries, and the scope/freshness binding. Cache storage
 * itself lives in `runtime.js`, which owns directory scoping and freshness.
 */

export { indexFiles } from '../../../../omo-engine/code-graph/src/extract.ts';
export {
  findTests,
  findUnreferenced,
  impact,
  search,
  symbolContext,
  trace,
} from '../../../../omo-engine/code-graph/src/queries.ts';
export {
  MAX_CONTENT_TOKENS_PER_FILE,
  STALE_AFTER_MS,
  computeScopeFingerprint,
  searchContent,
} from '../../../../omo-engine/code-graph/src/schema.ts';
export {
  SNAPSHOT_STORE_VERSION,
  createSnapshotManifest,
  joinSnapshotShards,
  parseSnapshotManifest,
  parseSnapshotShard,
  serializeSnapshotManifest,
  serializeSnapshotShard,
  splitSnapshotIntoShards,
} from '../../../../omo-engine/code-graph/src/snapshot-store.ts';
