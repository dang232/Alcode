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

### Why the walk is unbounded and never follows symlinks

`indexFiles` runs the TypeScript compiler over every entry, so an
entry cap would silently drop real sources from the graph. The walk uses
`lstat` and never follows symlinks, contains every real path to the scope
root, tracks visited inodes and real paths, and measures
`dirsVisited`, `filesDiscovered`, and `maxDepthSeen` as metrics instead
of enforcing them as cuts. Numeric completeness caps (entry count,
directory, file, depth, and size cuts) are removed: legacy knobs are
accepted and ignored, `entryCap` is always null, and every entry candidate
indexes. The only remaining walk bound is the hang backstop
(`DEFAULT_TRAVERSAL_TIME_BUDGET_MS`, clamped 1s to 300s). A truncated
walk reports `truncated` with `truncationReason` and metrics instead of
showing a partial graph as complete, and truncation now comes only from
unreadable entries, skipped-scan walk errors, or the time budget, never
from a numeric cut. A policy exclusion is NOT truncation: the walk reached
every directory and decided each file on purpose, so `excludedCount`,
`excludedSample` and `truncationReason` (`gitignore` for the ignore layer,
`project-config` for a `codegraph.json` rule) stay reported while the
build stays complete, persists, and serves fresh. A truncated in-memory
entry is never persisted as a generation and never served as fresh.

### Why the skipped census floors instead of truncating

A tripped skipped-census bound (tens of thousands of skipped files under
one directory) stays visible as `coverage.excludedTruncated` but never
truncates the walk by itself: `truncated` is decided only by a
non-policy `truncationReason` (a walk error or the time budget), so a
complete entry set still builds, persists, and restores. Capping the census display must not
destroy the generation it counts.

### Why the served build has work budgets and the experiment has memory budgets

The served single-session build is bounded by work, never by bytes:
the walk time budget, engine node/edge/time budgets where the caller
opts in, stall reporting instead of timeouts, cancellation at phase
boundaries, and failure memory with cooldown. A byte cap on this path
would turn large legitimate scopes into truncated generations, which
the mission forbids: no arbitrary limit may cause an incomplete graph.
Machine-scaled memory guards (parallelism and per-shard floors from
measured cores and free memory, per-shard RSS reporting) live on the
flagged sharded path, where the caller explicitly sizes the job. The
sharded-equivalence suite pins both the budgets and the refusal to
guess when no count is given.

### Why sharded builds stay behind an explicit flag

`buildShardedSnapshot` fans project entry groups out to forked child
processes (one engine session each) and merges the snapshots by id.
Processes, not threads, is structural: parallel sessions in one process
can collide on the millisecond-stamped server pipe name and hang instead
of throwing, while distinct pids cannot share a name. Sessions
multiply memory with the shard count, and project assignment depends on
each session's open set, so the method requires explicit `{ shards }` (or
the `ALCODE_CODE_GRAPH_SHARDED_BUILD` count) and refuses to build
otherwise; `ensureIndex` never calls it. Equivalence with the
single-session build is pinned by the sharded-equivalence suite, not by
reasoning about the merge.

Cancellation is cooperative and the failure mode is closed: an aborted
signal or a true `shouldCancel` rejects `CANCELLED` at every async
boundary, an in-flight abort kills every spawned child, one shard
failing kills its siblings instead of merging a partial graph, and a
silent child exit counts as failure. Progress rides `shard-started`
(the deterministic abort point: spawn guaranteed, results pending) and
`shard-done` with wall, memory, and counts per shard.

Shard count is machine-derived, not requested blindly: the effective
count is clamped to the smaller of CPU parallelism
(`availableParallelism`, container-aware) and free memory over a
per-shard floor (`ALCODE_CODE_GRAPH_SHARD_MEM_FLOOR_MB`, default 2048
MiB, clamped 512 to 65536). The clamp binds loudly (`limitedBy:
'machine'`, with the machine figures in the result); each child reports
its peak RSS and the parent keeps the max, so a benchmark row carries
the memory cost beside the wall time.

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
not two indexers. The agent tool drives the same runtime module, and both
resolve each scope to the same store root, so their queries resolve
against the same persisted generations: repeated queries reuse the
generation, concurrent callers share in-flight jobs per process, and
coverage, staleness, and generation identity mean the same thing on
both surfaces.

### Where generations live

Each scope inside a real git checkout keeps its generations in a
gitignored `.algraph/` folder at the repo root, falling back to the
user-root `code-graph-store` for bare directories, unwritable roots,
or when `ALCODE_CODE_GRAPH_NO_ALGRAPH=1` is set. The folder
carries its own self-ignoring `.gitignore`, and the repo ignore file
gains one `/.algraph/` line, so the store never shows up in status and
is never committed. An existing user-root generation for the scope
moves over on first use (a rename, never a copy, never over an existing
repo-local generation); if the move fails the scope keeps serving from
the user root. One scope is never served from two homes.

### Why the managed ignore line does not move the revision

The root `.gitignore` joins the revision digest, so our own `/.algraph/`
bookkeeping line would otherwise invalidate every persisted generation
on adoption and force exactly the rebuild migration exists to avoid.
The digest drops exactly those lines (and reads a file holding only
them as absent) because they change no walked entry: the store
self-ignores, and its JSON shards are not entry candidates. Any other
ignore edit still rebuilds exactly like a HEAD move.

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

A policy exclusion is not truncation, so a build that drops ignored or
config-excluded entry files is complete and does persist. Withholding it
was what made a scope with a single ignored file rebuild on every open and
never serve fresh. Truncation in this section means a walk that stopped
early: a walk error or the time budget.

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

## State parity (index-state contract)

Every `indexState.state` the server can serve has exactly one labelled,
non-spinner panel render. A new state value must gain a row here and a
render there; an unmapped state must never collapse to a bare spinner.
The engine progress `phase` values ride `indexState.progress` but never
become `state`, so a new engine phase needs no panel change.

| Served `indexState.state` | Served via | Panel render (`CodeGraphPanel.tsx`) |
|---|---|---|
| `queued` | `readIndex` while the job is registered but the walk has not started; panel default when `ready === false` with no state | `code-graph-index-building` box, "Queued" label, Cancel button; poll continues |
| `discovering` | `readIndex` during the entry walk and revision read | Building box, "Discovering" label, Cancel button; poll continues |
| `analyzing` | `readIndex` per finished engine project, with `progress.files/projectsDone/projectsTotal` | Building box, "Analyzing" label plus measured counts, Cancel button; poll continues |
| `persisting` | `readIndex` while the finished graph publishes | Building box, "Persisting" label, Cancel button; poll continues |
| `ready` | `readIndex` on a published generation; sync `indexState` reader on a retained snapshot | Full workspace, never a spinner; `fresh` chip, or the stale/truncated banner below when the binding moved |
| `failed` | `readIndex` under terminal-failure memory (`FAILURE_RETRY_COOLDOWN_MS`); explicit refresh retries immediately | `code-graph-index-failed` box, "Failed" label plus `indexState.error`, Retry button; no poll |
| `cancelled` | `readIndex` after a consumed cancel intent (records nothing; next plain read rebuilds) | Failed box, "Cancelled" label, Retry button; no poll |
| `truncated` | `readIndex` on a retained partial build (never persisted, never overwrites the previous complete generation) | Building box, "Truncated" label plus `truncation:` line, Cancel button; poll stops — an unchanged scope settles instead of rebuilding forever |
| `superseded` | Progress stream only, when a refresh replaces the running build (the job is deleted; the next read observes the replacement) | No dedicated render: readers see the replacement job's states above |
| `not-indexed` | Sync `indexState` reader only (no job, no published generation); `readIndex` with nothing published answers `ready: false` + `freshness: unindexed` + zero counts instead | Building box via the `ready === false` default; never a fake empty graph |
| `idle` | `POST /api/code-graph/cancel` only, when no job exists | No render: the cancel button fires and the next read shows `cancelled` or a fresh job |

Stale labelling rides alongside: a published generation served while a
rebuild is pending or failed reads `freshness: stale` with `staleReason`
(`rebuild-pending`, `rebuild-failed`, `index-truncated`) plus
`refreshError`, rendered in the `code-graph-index-stale` banner or the
`code-graph-index-truncated` banner with `truncationReason` and the
`excluded` count. Query answers on an incomplete index downgrade
`coverage: indexed` to `partial` and name the exclusion count once in
`unresolved` (`index incomplete: N files excluded by the entry cap`), so
the panel states the gap instead of drawing a partial graph as complete.

Toolbar truncation surfacing reads the same server fields the banner
uses — `truncationReason`, `excludedCount`, `excludedSample` (ten-path
cap), and per-module `analyzedFiles`/`unanalyzedFiles`/`excludedFiles`
on the explore `modules` — through `deriveTruncationView` (answer wins,
index is the fallback) into the toolbar's `code-graph-index-truncation`
and `code-graph-truncation-modules` lines, copy-covered by
`toolbar-copy.json` (`truncationExcluded`, `truncationModules`). Null on a
fully indexed scope, when the toolbar stays quiet instead of stating a
zero-exclusion fact.

### Diagnostics

Server progress events carry `elapsedMs` (and `generation` when the engine
reports it) from the first `discovering` emit onward. Client route calls log
one line at start and one at finish under `console.debug('[code-graph] …')`
when `localStorage.alcode.codeGraph.debug` is `'1'`, each carrying a
correlation id, the directory, the kind, the duration, the outcome, and — when
the server sent one — the generation, scope root, phase, and stall flag. Logs
are bounded (one line per request and per phase transition, never per file)
and never include source contents, secrets, tokens, or environment values.

### Project config (`codegraph.json`) + `.gitignore` + size-cap override

An optional `codegraph.json` at the scope root tunes which files the walk
indexes, layered over the skip defaults (`SKIPPED_DIRS`,
`ENTRY_FILE=/\.[cm]?[tj]sx?$/`). Absent file is today's defaults;
malformed files fail open with a stated `configError` on the walk result
and change nothing. Rollback is deleting the file.

```json
{
  "exclude": ["generated/**", "*.g.ts", "!generated/keep.ts"],
  "include": ["vendor/keep.ts"],
  "deprioritize": ["legacy/**"],
  "extensions": { ".mdx": "markdown", ".js": false },
  "maxFileSizeBytes": 2097152
}
```

- `exclude` drops entry candidates into the excluded bucket; `!` negates
  within this list only (re-includes). `include` rescues anything the
  skip defaults, `.gitignore`, or `exclude` dropped — including files
  under a default-skipped directory (the walk then descends instead of
  pruning); `!` re-excludes within this list only. Neither layer
  overrides the nested-repo boundary, symlinks, outside-root escapes, or
  `.git` internals, and neither promotes a non-entry file into the index.
- `deprioritize` only reorders: deprioritized candidates index last, so
  the entry cap sheds them before the traversal tail. With headroom they
  still index; reasons and exact counts match the immediate cuts.
- `extensions` maps extra lowercase extensions to entries
  (`".mdx": "markdown"`); a `false`/`null` value removes even a
  default entry extension. Unmapped non-entries stay in the unanalyzed
  bucket by extension, never silent.
- `maxFileSizeBytes` overrides the 1 MB cap up to the existing 32 MiB
  clamp (`PROJECT_CONFIG_MAX_FILE_SIZE_BYTES`); explicit per-call
  `maxFileSizeBytes` still wins for that call. Size drops keep the
  `file-size` reason; config drops use `project-config`.
- `.gitignore` files (root + nested, one per visited directory) are
  honored with last-match-wins across the stack and `!` negation inside
  the layer (simplification vs git: a re-include is allowed even under an
  excluded parent dir). Tracked (committed) files are immune to
  `.gitignore` — a committed path needs an explicit config `exclude` to
  leave the index — resolved by one `git ls-files` per walk at most, only
  when an ignore file carries patterns and only when the scope root owns
  git metadata; any failure binds the empty set so the ignores apply
  normally instead of blocking the walk.
- Freshness: the config and root `.gitignore` contents plus the effective
  size cap join the revision, so editing either rebuilds exactly like a
  HEAD move. Known nested ignore files ride the walk's `ignoreStamps`
  census (re-derived on check; edits and deletions rebuild). A brand-new
  nested `.gitignore` is invisible to the census and needs a refresh; so
  does a restore from a persisted generation after a nested-ignore edit
  (the store format is unchanged and carries no census).
- Overrides only move files between the visible buckets
  (`coverage.byModule` analyzed/unanalyzed/excluded, `excludedCount`,
  `excludedSample`, `appliedConfig` marker); truncation semantics are
  unchanged and every count stays exact.

### Watcher + connect-time catch-up (S3/S4)

The revision gate stays the source of truth. Two later steps only feed it
fresher evidence, and both degrade to today's manual-refresh path when they
cannot run.

The native watcher (S4) is opt-in and off by default. It starts when
`watcherEnabled: true` is passed or `ALCODE_CODE_GRAPH_WATCHER=1`
(`CODEGRAPH_WATCHER_ENABLED` also works) is set. `CODEGRAPH_NO_WATCHER=1`
forces the disabled path even when enabled, and the sync-disabled flags do
the same. A scope that cannot be watched stays on the revision gate.
Nothing throws, and nothing retries in a storm.

One watcher lives per scope key, bounded like snapshot retention so dead
scopes keep no handles. Each scope also holds one debounce timer, 2000 ms
by default (`DEFAULT_WATCHER_DEBOUNCE_MS`), tunable through
`watcherDebounceMs` or `ALCODE_CODE_GRAPH_WATCH_DEBOUNCE_MS`
(`CODEGRAPH_WATCH_DEBOUNCE_MS` works too) and clamped to 100 ms through
60 s by `resolveWatcherDebounceMs`. A burst of saves coalesces into one
sync: when the timer fires it calls the existing
`ensureIndex(scopeRoot, {})`, so the single-flight `jobs` registry joins a
running build instead of starting a second one.

Watcher events never rebuild anything directly. They only invalidate that
scope's `gitStatusCache` entry and its catch-up memo, then the normal serve
path decides. All rebuild, persist, and fallback rules are unchanged.

Cancellation wins over the watcher. `cancelIndex` clears the scope's
pending debounce timer on both paths, and a debounced fire that lands while
a cancel intent stands only invalidates. It never starts the refused job,
and the intent stays for the next read to settle as cancelled. Killing the
worker drops the in-worker watcher with the build, so no handle or timer
is orphaned. Lifecycle and tests use `closeWatchers()` and
`watcherState()`. Timers are `unref`d, so a pending sync never holds the
process open on its own. The host carries the watcher flags into the worker
environment, and the worker's `shutdown` op awaits `closeWatchers()` before
replying.

In the panel, the watcher changes nothing about the contract. Manual
Refresh always rebuilds, and it's the escape hatch in both modes. Focus
revalidate stays the fallback when the watcher is off.

Connect-time catch-up (S3) absorbs off-session edits before the first query
of a generation is served. Uncommitted working-tree changes are all the
S2 dirt set sees, so a committed off-session edit (a git pull, another
editor) stays invisible to it until the status TTL turns over. The
catch-up closes that gap. It diffs the served entry's own reuse ledger
(`fileRecords`, the same fingerprints the incremental build trusts) against
the tree. A bounded stat prefilter (`size+mtimeMs`, no walk, no spawn)
runs first, then only the remainder is content-hashed with
`engine.fingerprintBytes`. The diff yields every 200 entries and the memo
holds at most 200 scopes (`MAX_CATCHUP_SCOPES`). Deletions are flagged with
`ageMs: null`. Added files the ledger never recorded ride the rebuild's
own validation. The catch-up covers tracked files only, and scopes without
a ledger (older seeded generations) behave exactly as before. Any
unexpected shape degrades to empty, and the revision gate stays
authoritative.

Results are memoized per scope, generation, and status-probe object. The
diff re-runs exactly when new tree evidence arrives (a fresh `git status`
answer after the TTL) and reuses inside a TTL window, so one probe never
pays for the ledger walk twice. Keying on the probe object matters: a
measurement from before an off-session edit must not shadow the first query
after it. Scopes with no cached probe (non-git trees) measure on every call
and store nothing.

Caught-up rels join the S2 pending-sync set. They ride `pendingSync`,
`pendingSet`, `ageByRel`, and `staleFiles` through `withCatchUp`, and no
new served field exists. Index-level `staleFiles` gains them with stat ages,
and query narrowing banners exactly the referenced ones. A disabled sync
stays empty by contract. In `ensureIndex`, a non-empty catch-up result
precedes the TTL serve and falls through to the incremental rebuild, which
reanalyzes exactly the caught-up files and never the whole scope.

### Explore answers: which `explore` is which (S5)

Two different things share the name, so read carefully. The runtime query
kind `explore` (`exploreModules` in `runtime.js`) is the modules overview
the panel's Explore mode renders. Composed explore answers are engine and
tool work: `explore()` in the engine's `queries.ts` plus the `explore` op
of the `code_graph` agent tool. Its contract lives with the engine
(`packages/omo-engine/code-graph/src/DOCUMENTATION.md`). One call returns
verbatim line-numbered bodies grouped by file, static-only call paths
between hits, and the blast-radius summary. Dynamics are disclosed in
`unresolved` and never traversed.

## Benchmark discipline (S11)

Every future index/query perf claim ships with the harness at
`packages/web/server/lib/code-graph/bench/` (`run.mjs` entry,
`corpus.mini.mjs` mini-corpus, `lib.mjs` medians/gates/table). No
product code ships in this step; the harness measures the walk path in
`runtime.js` and the extraction it serves.

- Fixed corpus: `mini-v1` freezes exactly 2 repos with one architecture
  question per repo. The harness exits 2 when that shape drifts; a new
  corpus ships as a new id, never an edit.
- Both-arms CLI block: every arm/repo/run attempts the `codegraph` CLI
  against an unresolvable PATH, in WITH and WITHOUT alike, so neither arm
  can reach the graph out of band.
- N runs/arm medians: full discipline reports medians of 4 runs per arm
  per repo; the dry run uses `--runs 2`.
- Contamination gate: the table reports blocked-attempt counts plus CLI
  output bytes, and the run exits non-zero unless output bytes are zero.
  Blocked attempts are reported; zero output is the proof.
- Metric definitions: cost is run `total_cost_usd`; tokens are total tokens
  processed summed per assistant turn (input incl. cache reads + creation +
  output); time is wall-clock; tool calls count every invocation incl.
  sub-agent-spawned calls.
- Residual-occupancy row: the table carries tokens resident after N turns
  beside the throughput medians, because a throughput win does not imply a
  resident win (the dense front-loaded payload stays resident while small
  read results are discarded).
- Regimes quoted separately: never mix single-turn rows with multi-turn
  rows (model + turn count move the numbers, not a regression). Each table
  names its regime; the dry run labels `dry-run-synthetic/1-turn`.

Dry run (exit 0, full table with throughput + residual + blocked counts):

```
bun ./packages/web/server/lib/code-graph/bench/run.mjs --mini
```
