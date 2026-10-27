# code-graph - Site Code-Graph Index

## Ownership

`packages/web/server/lib/code-graph` owns serving the repository code graph
over HTTP. The engine (`@oh-my-opencode/code-graph`) owns extraction and
query shaping; this module owns directory scoping, freshness caching, and
the route contract — and nothing else. It never resolves symbols itself and
never invents edges.

- `engine.js` — build source only; re-exports the engine calls the runtime
  needs. Never imported at runtime (see below).
- `code-graph.bundle.js` — committed `Bun.build` output of `engine.js`
  (regen with `bun ./code-graph.regen.js`). The packaged server runs plain
  Node with no transpile step, so only this bundle may appear in a runtime
  import chain.
- `runtime.js` — `createCodeGraphRuntime({ fsPromises, path })`: directory
  validation and scope derivation, bounded entry walk, per-directory
  snapshot cache, freshness, and the `file` projection over real snapshot
  edges. Loads the bundle lazily so a broken engine is a per-request
  backend failure, not a startup crash.
- `host.js` + `ipc-worker.js` — the process boundary. The runtime that builds
  and holds the graph lives in a forked worker process; `createCodeGraphHost()`
  is what the server assembles, and it mirrors the runtime's methods over IPC.
  A large monorepo measured 257 s and ~1.3 GB per build, so the graph must not
  live in the app's process: the app side measured 77–78 MB while the worker
  built. The host keeps the last progress state per directory, because a status
  request sent to a worker inside a synchronous build would wait for that build
  to end.
- `snapshot-storage.js` — `createSnapshotStorage({ fsPromises, path, engine, storeDir })`:
  the persisted generation per graph scope (`<storeDir>/<project>--<worktree>/`
  with `manifest.json` + one shard per file). The manifest is the only publish
  point and is written with a rename, so a crash leaves the previous generation
  intact; a torn or version-mismatched store reads as a miss, never a graph
  missing files. The codec itself lives with the model
  (`omo-engine/code-graph/src/snapshot-store.ts`) because the engine's
  `StoredBaseline` cannot represent a served snapshot (no line numbers, a
  different id space, no content index).
- `routes.js` — `registerCodeGraphRoutes(app, { codeGraphRuntime })`:
  `GET /api/code-graph/index`, `GET /api/code-graph/query`,
  `GET /api/code-graph/status` and `POST /api/code-graph/cancel`, registered
  before the generic OpenCode proxy in `feature-routes-runtime.js`.

## Invariants

- An index is a job, never a blocking side effect of a read. `readIndex`
  answers immediately: `ready: true` with the served facts, or `ready: false`
  with the machine state. Callers that must have a graph ask `awaitIndex`
  (test/CLI seam, `blockOnRead`), never the product path.
- One job per directory. Concurrent reads join the running job instead of
  starting another build; the state machine is
  `queued → discovering → analyzing → persisting → ready`, with `failed` and
  `cancelled` terminal. Progress counts real work (entry files, projects done
  of total) and never invents a percentage.
- A failed build never erases the last published generation: reads serve it
  labelled `stale` while the new one builds.
- Retention is bounded (`MAX_RETAINED_SNAPSHOTS`): a session that touches many
  projects cannot hold every graph at once.
- A warm open never builds: when a persisted generation matches the repository's
  current scope (revision plus dirty fingerprint), the runtime restores it. Any
  scope difference is a miss, and an explicit `refresh` always rebuilds.
- The scope is always an explicit directory. A request without one fails
  400; the server never falls back to its own cwd, which would mix
  projects in one panel.
- Cache keys are normalized directories: one directory's snapshot never
  serves another (project isolation), and session switches inside a
  directory share the same binding.
- The git revision folds the working tree into HEAD: HEAD plus a fingerprint
  of the dirty set (modified, staged, renamed, deleted, and untracked files
  that are entry candidates, each stamped `size:mtimeMs` with a `deleted`
  sentinel). An uncommitted edit moves the revision exactly like a HEAD move;
  dirty files outside the entry set do not, because they cannot change the
  indexed graph. A failed status probe keeps the HEAD-only revision and
  labels the served index `dirty: 'unknown'` with the reason, so a blind
  spot reads as unknown, never as clean.
- Freshness mirrors the engine's `cache.ts` gates: serve cached only while
  the revision matches and the age stays within `STALE_AFTER_MS`. A failed
  rebuild with a snapshot in hand serves it flagged `stale` with
  `staleReason` and `refreshError`; with nothing cached the request throws
  and the route answers 5xx. Stale is always labeled, never silent.
- Failures never resolve to an empty index. An empty `items` list means the
  engine analyzed the scope and found nothing (`coverage: indexed`), never
  that the backend failed.
- The `file` projection returns only edges present in the engine snapshot,
  with the engine's evidence shape. It shapes; it does not resolve.
- `kind=unreferenced` lists files and export contracts with no inbound
  IMPORTS or CALLS edges, ranked with the full count kept in `totals`,
  while entry-like files (entry basenames, tests, shell) are counted in
  `summary.excludedEntryLike`, never listed. Every candidate is
  potentially unreferenced, never dead code: entry points, framework
  conventions, registries, schedulers, build config, and non-TypeScript
  files can reach a file outside the analysed edge set.

### Why the revision falls back to a content hash and not an error

Outside a git checkout there is no HEAD to pin. Refusing the directory
would make the panel unusable there; inventing a fixed revision would say
`fresh` forever. The content hash (40-hex, changes when the listing
changes) keeps the freshness binding honest: edits rebuild, exactly like
a HEAD move.

### Why a status TTL and not a HEAD-only revision

A HEAD-only revision misses every uncommitted edit, so the panel kept
serving the old graph until commit. A `git status` probe on every query
would restore freshness at the spawn-per-query cost Phase 1 removed. The
runtime caches one status answer per directory for `GIT_STATUS_TTL_MS`
(1500 ms): within the TTL a passive query may serve a snapshot that is at
most TTL-old, while an explicit Refresh bypasses the cache and always
rebuilds. A failed probe falls back to the HEAD-only revision and labels the
served index `dirty: 'unknown'` with the reason, so a blind spot reads as
unknown, never as clean.

### Why the snapshot cache is in memory and not on disk

The engine's stored-index path (`parseStoredIndex` / `serializeIndex`)
persists a baseline across restarts, but the site route is a read view over
files the user can edit at any moment: revision-gated rebuilds already
cover staleness, and a disk cache would add invalidation, migration, and
downgrade behavior for no freshness the memory cache does not provide.
Restarting the server simply re-indexes on the next request.

### Why the walk is bounded at 500 files and skips build outputs

`indexFiles` runs the TypeScript compiler over every entry; an unbounded
walk of a monorepo checkout would stall the request and grow the snapshot
past what the bounded panel can show. The walk skips `node_modules`,
`.git`, and build outputs, caps entries, and reports `truncated`, so the
panel says what was cut instead of showing a partial graph as complete.
