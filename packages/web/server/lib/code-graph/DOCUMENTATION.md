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
- `routes.js` — `registerCodeGraphRoutes(app, { codeGraphRuntime })`:
  `GET /api/code-graph/index` and `GET /api/code-graph/query`, registered
  before the generic OpenCode proxy in `feature-routes-runtime.js`.

## Invariants

- The scope is always an explicit directory. A request without one fails
  400; the server never falls back to its own cwd, which would mix
  projects in one panel.
- Cache keys are normalized directories: one directory's snapshot never
  serves another (project isolation), and session switches inside a
  directory share the same binding.
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

### Why the revision falls back to a content hash and not an error

Outside a git checkout there is no HEAD to pin. Refusing the directory
would make the panel unusable there; inventing a fixed revision would say
`fresh` forever. The content hash (40-hex, changes when the listing
changes) keeps the freshness binding honest: edits rebuild, exactly like
a HEAD move.

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
