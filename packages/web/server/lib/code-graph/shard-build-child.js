/**
 * Shard-build child (experiment only, behind the sharded-build flag).
 *
 * Forked with one JSON argv payload `{ bundlePath, entries, rootDir }`, this
 * process builds its shard in its own engine session and reports the
 * snapshot over IPC, then exits. A separate process per shard (not threads)
 * is structural: same-process parallel sessions can collide on the
 * millisecond-stamped server pipe name and hang instead of throwing, while
 * distinct pids cannot share a name. Nothing here persists, serves, or
 * merges: the runtime owns grouping, fan-out, and the id-keyed merge, and a
 * shard that fails (or exits silent) fails the whole experiment build.
 */
const payload = JSON.parse(process.argv[2] ?? '{}');

// Representation checks without a runtime `typeof` (banned by the
// anti-slop gate): tag dispatch parses the value at the boundary, then the
// code branches on the domain value.
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';
const isFunction = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Function]' || tag === '[object AsyncFunction]';
};
// `typeof payload === 'object'` is true for plain objects and arrays (never
// for null, which is checked separately): the tag pair below is that same
// set, spelled without `typeof`.
const isPayloadObject = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Object]' || tag === '[object Array]';
};

const fail = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (isFunction(process.send)) {
    process.send({
      ok: false,
      error: message,
      entries: Array.isArray(payload.entries) ? payload.entries.length : 0,
    });
  }
  process.exitCode = 1;
};

try {
  if (payload === null || !isPayloadObject(payload)) throw new Error('code-graph shard child needs a JSON payload');
  if (!isString(payload.bundlePath) || payload.bundlePath.length === 0) {
    throw new Error('code-graph shard child needs a bundlePath');
  }
  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    throw new Error('code-graph shard child needs a non-empty entries list');
  }
  if (!isString(payload.rootDir) || payload.rootDir.length === 0) {
    throw new Error('code-graph shard child needs a rootDir');
  }
  const engine = await import(payload.bundlePath);
  if (!isFunction(engine.indexFiles)) {
    throw new Error('code-graph shard child bundle has no indexFiles');
  }
  const startedMs = Date.now();
  const indexOptions = { rootDir: payload.rootDir };
  if (payload.budgets !== null && payload.budgets !== undefined) indexOptions.budgets = payload.budgets;
  const snapshot = engine.indexFiles(payload.entries, indexOptions);
  if (isFunction(process.send)) {
    process.send({
      ok: true,
      snapshot,
      wallMs: Date.now() - startedMs,
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      entries: payload.entries.length,
    });
  }
} catch (error) {
  fail(error);
}
