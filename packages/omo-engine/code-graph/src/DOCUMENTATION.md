# code-graph - Repository Code-Graph Index

## Ownership

`@oh-my-opencode/code-graph` owns the repository code graph: symbol
definitions, symbol references, and reachability queries over source files.
The public API is the barrel at `src/index.ts`.

- Symbol extraction, reference resolution, and graph queries belong here.
- Harness adapters consume the graph through this barrel; they never import
  graph internals or reimplement symbol resolution.
- Neighbouring owners: `memory-core` owns agent memory and transcript state,
  `model-core` owns model resolution, `utils` owns shared pure helpers.
  None of them owns code structure; that boundary is this package's.

## Invariants

- Every query answer carries `totals { displayed, known, hidden }`. `known` is the size of the
  result the walk established before any display limit; it is `null` when the index cannot support
  an honest count (a truncated walk). A caller renders `displayed` and `known` separately, never a
  slice dressed as a set.
- `completeness` (`complete | partial | truncated`) with `completenessReason` describes **this
  answer**; `coverage` (`indexed | partial | unindexed`) describes **the index it was read from**.
  A row limit or a depth budget is never reported through `coverage` - doing that once made every
  truncated answer claim the project itself was only partly analysed.
- `depth` is traversal, not rows: `impact`/`symbolContext` walk the whole reachable set up to
  `maxDepth`, count it, then cut the returned rows to `limit`.
- Ranking is deterministic and lives here, not in a UI: distance from subject, then confidence
descending, then kind priority `TESTS > IMPORTS > CALLS_STATIC > CALLS_UNRESOLVED`, then id.
- `findUnreferenced` reports **potentially** unreferenced files and exports. It never says dead
  code: entry-like files are counted into `excludedEntryLike` rather than listed, and the summary
  carries `unanalyzedNote` because non-TypeScript files and framework conventions are outside the
  analysed edge set.

## Invariants (package shape)

- Stay harness-neutral. Production code and package dependencies must not
  import Senpi, Pi, OpenCode adapters, or other harness-specific packages.
- The barrel is the only public surface. Consumers import
  `@oh-my-opencode/code-graph`, never deep paths into `src/`.
- `sideEffects` stays `false` so bundlers can tree-shake the graph builders
  a consumer does not use.
- `package.json` carries no runtime dependencies beyond what the lockfile
  already vendors; adding one requires a lockfile update and the
  workspace-wide validation in the change-discipline skill.

### Why `typescript` is pinned exact (`7.0.2`) and not `^7.0.2` like the root

The root manifest ranges `^7.0.2`, so a fresh resolve can drift the compiler
under a frozen lockfile's nose. The exact pin keeps every workspace on the
already-vendored `7.0.2` in `bun.lock`, so no lockfile change is needed and
the skeleton type-checks with the same compiler everywhere.

### Why `exports` and `types` point at TypeScript source, not `dist`

Sibling engine packages (`model-core`, `delegate-core`, `utils`) resolve
`./src/index.ts` directly, so type-checks and Bun consumers never depend on
a stale build output. A `dist` entrypoint would add a build step and a drift
risk for a package whose consumers all resolve source; it is rejected until
a published runtime boundary needs it.

### Why `lib` is `ESNext` without `DOM`

The graph runs under Bun/Node over repository files; it touches no DOM APIs.
`team-core` adds `DOM` because it drives tmux UI layout, but for this
package `DOM` would only widen the ambient surface for autocompletion and
accidental use. It follows the `utils`/`model-core` precedent instead.

### Why there is no Dockerfile `deps`-stage line for this package

The `deps` stage copies only top-level `packages/*/package.json` manifests
by name. Nested `packages/omo-engine/*` packages ship inside the single
`packages/omo-engine` unit, and no sibling engine package has its own `COPY`
line. Adding one would break the established pattern, not follow it.

### Project config grammar (`codegraph.json`)

`schema.ts` owns the canonical project-config grammar
(`CODEGRAPH_CONFIG_BASENAME`, `ProjectConfig`, `ProjectConfigInput`,
`normalizeProjectConfig` plus the size/list bounds). The site runtime
re-declares it in JS so it stays dependency-free; the shapes match on
purpose, the way the fingerprint grammars already do.

- Lists (`exclude`/`include`/`deprioritize`) are strings, capped at
  `PROJECT_CONFIG_MAX_PATTERNS` (256) entries of 512 chars; `!`
  negates within its own list. Unknown fields are ignored, invalid
  entries dropped, never thrown.
- `extensions` maps a lowercase dotted extension to presence (`true`,
  from a language name) or removal (`false`/`null`, even for a default
  entry extension); capped at `PROJECT_CONFIG_MAX_EXTENSIONS` (64) keys.
- `maxFileSizeBytes` clamps to
  [`PROJECT_CONFIG_MIN_FILE_SIZE_BYTES`,
  `PROJECT_CONFIG_MAX_FILE_SIZE_BYTES`] (1 to 32 MiB); absent binds the
  1 MB default (`PROJECT_CONFIG_DEFAULT_FILE_SIZE_BYTES`).
- Overrides only move files between the visible coverage buckets; the
  extractor's truncation reasons and exact counts are unchanged.

### Composed explore answer (`explore`, S5)

`explore(snapshot, subject, options)` in `queries.ts` answers one question
in one call: what this subject is, how its definitions connect, and what
depends on them. `ExploreResult extends QueryEnvelope` and carries
`subject`, `definitions`, `bodies` (one `ExploreBodyGroup` per file),
`paths`, `impacted`, and `blastRadius` (the `ImpactSummary` shape).

Resolution favors recall. An exact symbol id answers with that symbol. A
file id or path answers with every symbol in the file, in definition-line
order. Bare names answer with every same-named symbol, so an ambiguous
subject returns each definition's body. Anything else answers
`coverage: unindexed` with an honest `totals { displayed: 0, known: null }`
and the reason in `unresolved`.

Bodies are verbatim windows from the extraction-time content index: the
definition line plus 59 more (`EXPLORE_BODY_MAX_LINES` 60). A trailing file
newline never sets the truncation flag. Missing content is an `unresolved`
note. Nothing is synthesized.

Paths use static calls only. Every ordered pair of shown definitions gets a
bounded multi-hop BFS over `CALLS_STATIC` (`EXPLORE_MAX_PATH_PAIRS` 20),
and each definition also contributes its direct caller and callee one-hop
paths, so a single hit still answers with its immediate call paths.
`CALLS_UNRESOLVED` is never traversed and never emitted as a hop. It sets
`blockedByDynamic` with a manual-review note instead. No hop ever targets
`unknown`.

Blast radius is a multi-source reverse reachability walk that reuses the
`impact` helpers. The envelope keeps the shared contract: `items`
(definitions then dependents, ranked, cut to `limit`), `totals`,
`coverage` and `completeness` from the shared decider, and
`suggestedMode: "explore"`.

Its tool-side twin, the `code_graph` agent-tool op `explore`, composes search, file, context,
trace, and impact over one generation. It never calls the runtime
`explore` modules-overview kind. Its bodies are read from disk under the
same 60-line cap, stale body files keep a Read-directly note, and the tool
description carries the marker-fenced `EXPLORE_PLAYBOOK` docs section.
Answers carry the `composed-explore` status reason, an appended `EXPLORE`
text section, and a top-level `explore` payload. The panel renders this
answer in its Explore view (bodies grouped by file with line numbers,
static paths with refs, blast-radius counts with impact actions).

### Why per-file emission happens once per build, not once per project

`addEntries` used to re-emit every accumulated file on every project.
That is harmless for id-keyed facts but mints a fresh ordinal call-site
id per pass, duplicating the whole call graph once per project (26x on
the full scope: 6.46M call-sites for ~250K unique calls). Emitting each
file exactly once, with its first-seen project and checker, keeps every
unique fact and drops only the copies. Route and navigation emission
still runs per pass: linking needs the accumulated record set, and its
records are id-guarded. Proven equivalent modulo ordinals on a real
3-project scope plus a no-duplicate-ids regression test.

### Why project grouping is a public seam and sharding is not

`groupEntriesByProject` partitions entries by owning TypeScript project in
one session, so a flag-gated experiment can build each group in its own
session with the same assignment the whole-scope build would use. The
serving path never calls it: project assignment depends on the session's
open set, so a sharded merge that merely looks right is not proven right.
Equivalence with the single-session build is pinned by test on every use,
never assumed from the merge shape.

## Benchmark discipline (S11)

Every future index/query perf claim against this engine follows the
discipline the serving-side harness enforces at
`packages/web/server/lib/code-graph/bench/` (`run.mjs --mini` dry run,
`corpus.mini.mjs` fixed corpus, `lib.mjs` medians/gates/table). The
harness covers this package's `extract.ts` path through the graphs the
site runtime serves; no engine code ships in this step.

- Fixed corpus: `mini-v1` freezes exactly 2 repos with one architecture
  question per repo; corpus drift fails the run (exit 2) instead of
  silently re-baselining.
- Both-arms CLI block in WITH and WITHOUT, 4 runs/arm medians (dry run
  `--runs 2`), and a contamination gate of blocked-attempt counts plus a
  zero-output-bytes proof (any CLI output byte fails the run).
- Cost/tokens/time/tool-calls carry the canonical definitions in
  `bench/lib.mjs`; a row that redefines one is a new regime, not a
  revision.
- Every table carries a residual-occupancy row (tokens resident after N
  turns) beside the throughput medians.
- Regimes quoted separately: never mix single-turn and multi-turn rows.
  Model + turn count move the numbers; that is not a regression.
