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

### Why the walk is bounded by discovery budgets and never follows symlinks

`indexFiles` runs the TypeScript compiler over every entry; an unbounded
walk of a monorepo checkout would stall the request and grow the snapshot
past what the bounded panel can show. The walk uses `lstat` and never
follows symlinks, contains every real path to the scope root, tracks
visited inodes and real paths, and enforces independent budgets for
directories visited, files discovered, depth, file size, and wall-clock
time. It reports `truncated` with `truncationReason` and metrics instead of
showing a partial graph as complete. A truncated in-memory entry is never
persisted as a generation and never served as fresh.

### Why nested repositories are boundaries and not merged graphs

A parent directory holding sibling checkouts has no single revision,
so indexing it as one graph would mix unrelated projects. The walk stops
at nested `.git` boundaries and names them in `nestedRepoRoots`. Index one
repository at a time; the parent stays a directory scope with only its own
top-level files.

### Why cancellation is honoured at discovery and phase boundaries

The engine build is synchronous, so a worker cannot answer IPC while it
runs. The walk yields to the event loop and checks cancellation, the build
checks before parsing and persisting, and refresh supersedes a running job
instead of duplicating work. Terminal states are `completed`, `cancelled`,
`failed`, `truncated`, and `superseded`; only `completed` persists.

### Why per-file records ride the manifest instead of a second store

Incremental reuse needs fingerprints, not a new cache: the manifest gains an
optional `fileRecords` pointer to a content-addressed records document, and
pruning keeps it by reference like shards. A rebuild fingerprints the walked
entries, reanalyzes changed, added, and transitively dependent files
(importers and callers, never dependencies) through a subset program, and
merges over the previous snapshot dropping every edge that touches a
reanalyzed file. When the closure covers every entry the build falls back
to a full rebuild instead of merging a subset that equals the whole scope. Unchanged files keep byte-identical nodes
(fingerprints pin content, and node ids embed lines). A corrupt records file
disables reuse but never the snapshot already joined.

### Why dependent reanalysis follows export surfaces, not edges alone

Two-phase analysis compiles changed files first, then compares each
changed file's export surface (export-contract identities plus export
edge identities, derived from shards, never parsed) against the previous
generation. Only differing files pull their direct importers and callers
into phase B; a transitive fixed point would reanalyze chains that
deterministically re-emit identical output. Deletions always expand.
Unreachable or wildcard-resolved edges still pull their owners, because
the expansion follows actual emitted edges rather than lexical imports.

### Who shares the canonical generations

The panel and the `code_graph` agent tool are consumers of one service,
not two indexers. The agent tool drives the same runtime module and the
same store directory (`code-graph-store` under the user root), so its
queries resolve against the same persisted generations the panel serves:
repeated queries reuse the generation, concurrent callers share in-flight
jobs per process, and coverage, staleness, and generation identity mean
the same thing on both surfaces.

### Why export surfaces are not persisted to skip phase A

Phase A compiles exactly the changed and added files; their new surfaces
are unknown until compiled, so no persisted metadata can supply them.
Unchanged files already skip compilation through stat-validated records
with zero content hashes. The residual cost is compiler setup per project
in the subset program, and reusing compiler state across builds (a pooled
`tsserver` session) was measured unsafe and reverted: document bytes pin
at first open with no synchronous reload path. Persisted surfaces would
save nothing phase A does not already skip, so they stay unimplemented.

### Why unreadable files degrade instead of failing the build

A file the walk lists but whose bytes cannot be read (denied permissions,
transient locks) is excluded from every compiler input: an unreadable entry
aborts the whole program with no project covering it. Files with no
reusable record ride the coverage as `unreadableFiles` (capped sample plus
exact count) and force the entry truncated, so a partial generation can
never overwrite a previous complete one; files with a prior record read as
deleted, so dependents still re-resolve safely. Queries downgrade to
partial and name the files. If every listed file is unreadable the build
fails closed with `NO_READABLE_ENTRIES` instead of publishing an empty
graph. Restoring access and rebuilding reanalyzes the file (it was never
recorded), which is the retry path.

### Why terminal failures are remembered

A failed build stays failed for plain reads until an explicit refresh or a
60-second cooldown permits a new attempt: without the memory, every status
poll relaunches the doomed build and only ever observes `discovering`.
The previous complete generation still serves as stale underneath the failed
state, and success clears the memory at publish. Cancelled builds record
nothing: a cancel is consumed intent and the next plain read must rebuild.

### Why generated declaration caches are excluded from discovery

The walk skips `.tsbuild` (TypeScript build-mode declaration caches) the
same way it skips `dist` and `build`: those generated `.d.ts` files would
otherwise index as duplicate sources beside the real files they mirror.
Caps are unchanged; exclusion is by generated-directory name, never by
file extension, so real `.d.ts` sources still index.

### Why truncated generations are not persisted

Only complete builds reach the store: a partial manifest overwriting the
complete one would destroy the good generation on disk (pruning drops
unreferenced shards), and stacking generations is a larger change. A
restart therefore rebuilds a partial scope instead of restoring it; the
previous complete generation, when one exists, still serves as stale.

A safe partial-persistence design would additionally require, at minimum:
atomic publication of the partial generation beside (never over) the
complete one; a generation identity that stays unique across processes
and restarts so dependents cannot mix rows; a recovery path that
re-analyzes excluded files without a full rebuild when they become
readable; and a served-coverage contract proving the partial never
answers as complete. None of this is implemented; the rule above stands.

### Why fingerprints prefer stat matches and hash the rest

Hashing every file on every build re-reads the whole tree. A record also
keeps size and mtimeMs: when both still match, reuse skips hashing (the
same trust model as git's racy-clean detection). Any stat difference
hashes raw bytes, so an mtime-only bump still reuses on equal content and
no byte change ever slips through. Records without stats hash always, so
older generations stay valid.

### Why one walk serves restore and build

The restore listing and the build walk used to traverse the tree twice
with identical inputs. The restore hands its listing to the job when the
build would walk identically (default budgets); custom budgets walk
separately. A readdir-count test pins one traversal per build.

### Why compiler sessions were rejected

Nine probes proved the embedded tsserver pins document bytes at first
open: change announcements, closes, reopens, cache clears, project resets,
and waiting all serve stale content. Only unseen keys read fresh. Reusing
a session across content edits would serve stale graphs, so each build
spawns its own process. Session-shaped code must not return without a
synchronous reload primitive from the compiler.

### Why config edits force full reanalysis

Compiler options change what every file means, so a moved tsconfig
fingerprint disables reuse even when no entry changed. The dirty
fingerprint covers tsconfig files for the same reason. The rebuild runs
the full entry set under the new options; records from the old options
never validate.

Precise cancellation limits: `host.cancelIndex` kills the worker process when its app-side state shows a build in flight, so cancellation is effective even while the synchronous engine holds the worker loop. A cancel that lands before any job exists is recorded as an intent: the next `ensureIndex` for the scope settles cancelled instead of starting the refused build, and an explicit refresh consumes the intent and starts anew. A bare runtime without the host only observes cancellation at discovery yields and engine progress boundaries; a single huge synchronous project segment cannot be preempted mid-segment. Do not describe runtime-level cancellation as fully interruptible.

### Why a stall flag and not a timeout that fails the build

The engine's `program` phase (TypeScript program creation) runs synchronously
with no per-project progress: a 5000-file scope reports `files: 5000` with
`projectsDone: 0, projectsTotal: 0` for minutes while it works. Failing the
job there would discard real progress and restart the same minutes on retry.
The host therefore reports silence past `DEFAULT_STALLED_AFTER_MS` (120 s) as
`indexState.stalled: true` with `elapsedMs` and `lastProgressAtMs`, keeping the
phase name and the underlying state. A stall is reported, never failed,
killed, or restarted; Cancel stays available and the poll loop continues.

### Diagnostics

Server progress events carry `elapsedMs` (and `generation` when the engine
reports it) from the first `discovering` emit onward. Client route calls log
one line at start and one at finish under `console.debug('[code-graph] …')`
when `localStorage.alcode.codeGraph.debug` is `'1'`, each carrying a
correlation id, the directory, the kind, the duration, the outcome, and — when
the server sent one — the generation, scope root, phase, and stall flag. Logs
are bounded (one line per request and per phase transition, never per file)
and never include source contents, secrets, tokens, or environment values.
