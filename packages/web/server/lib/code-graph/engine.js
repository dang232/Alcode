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

export { indexFiles, groupEntriesByProject } from '../../../../omo-engine/code-graph/src/extract.ts';
export {
  explore,
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
  fileOfNodeId,
  createSnapshotManifest,
  joinSnapshotShards,
  parseSnapshotManifest,
  parseSnapshotShard,
  serializeSnapshotManifest,
  serializeSnapshotShard,
  splitSnapshotIntoShards,
} from '../../../../omo-engine/code-graph/src/snapshot-store.ts';
export {
  FILE_RECORDS_VERSION,
  PARSER_RECORD_VERSION,
  exportSurfaceKey,
  fingerprintBytes,
  fingerprintContent,
  parseFileRecordsDoc,
  serializeFileRecordsDoc,
  validateFileRecords,
} from '../../../../omo-engine/code-graph/src/file-records.ts';
export { rebuildIncremental } from '../../../../omo-engine/code-graph/src/lifecycle.ts';

/**
 * S2 per-file staleness shaping (Alwork-native contract, no upstream parity claim).
 *
 * The runtime attaches `staleFiles[]` (`{ file, ageMs }`), `pendingSync[]`,
 * and `syncStatus` (`ok|disabled|recovering`) to every served answer; the
 * panel and the `code_graph` tool render the same notes from those fields.
 * This helper is the pure shaping core so the next `code-graph.bundle.js`
 * regen keeps the bundle and the runtime identical: split the pending-sync
 * set into answer-referenced vs unreferenced and render the explicit notes,
 * never a silent stale-body/fresh-line mix. `ageMsOf` fills edit ages when
 * the caller measured them (the runtime does from its dirty stamps); the
 * engine itself never stats the tree here.
 */
export const staleFileNotes = (envelope = {}, pendingSync = [], ageMsOf = null) => {
  const pending = Array.isArray(pendingSync)
    ? pendingSync.filter((file) => Object.prototype.toString.call(file) === '[object String]' && file.length > 0)
    : [];
  const pendingSet = new Set(pending);
  const seen = new Set();
  const referenced = [];
  const collect = (item) => {
    if (item === null || item === undefined) return;
    const file = item.file;
    if (Object.prototype.toString.call(file) !== '[object String]' || file.length === 0) return;
    const rel = file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (seen.has(rel) || !pendingSet.has(rel)) return;
    seen.add(rel);
    const age = ageMsOf !== null && ageMsOf !== undefined ? ageMsOf(rel) : null;
    referenced.push({ file: rel, ageMs: Number.isFinite(age) ? age : null });
  };
  for (const item of Array.isArray(envelope?.items) ? envelope.items : []) collect(item);
  for (const key of ['callers', 'callees', 'impacted', 'candidates', 'contentItems']) {
    for (const item of Array.isArray(envelope?.[key]) ? envelope[key] : []) collect(item);
  }
  const unreferenced = pending.filter((file) => !seen.has(file));
  const notes = referenced.map((entry) => `stale: ${entry.file} edited since index \u2014 Read directly for current source`);
  return { staleFiles: referenced, pendingSync: pending, unreferenced, notes };
};
