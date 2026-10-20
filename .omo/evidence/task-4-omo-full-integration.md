# Task 4 evidence — Slice-E live-predicate sources (omo-full-integration, GAP-5)

Branch: `ui-alcore-readiness` @ worktree `I:/migration/Alwork-wt/wave1`.
Commit: `feat(engine): live Slice-E predicate sources`.
No keyed spend, no OpenCode phone call from the bridge, no merge/push.

## Worktree note (deviation, recorded honestly)

The lane brief mandates `I:/migration-wt/omo-full-integration-wave1`, but that
worktree is the `migration` orchestrator repo and contains no
`packages/web/server/...` tree — the scope files exist only in the Alwork
nested repo. Code + tests therefore landed in `I:/migration/Alwork-wt/wave1`
(a worktree, not main; `I:/migration/Alwork` main checkout untouched), and a
copy of this evidence was placed at
`I:/migration-wt/omo-full-integration-wave1/.omo/evidence/task-4-omo-full-integration.md`
for the orchestrator. Pre-existing untracked files in the wave1 worktree
(task-41/42/48/49 evidence, `packages/package.json`) were left alone.

## Concrete live sources named (code comments + here)

- `modelCatalog` ← the engine codex catalog file
  `packages/omo-engine/omo-codex/plugin/model-catalog.json`
  (`{ current: { model }, roles: { [role]: { model } }, ... }`, the same file
  `readCodexModelCatalog(codexPackageRoot)` reads from `<root>/plugin/`).
  Verified on disk: `current.model` + `roles.default/verifier/worker`.
  A run caller may instead pass its own role choice in the same bridge shape.
- `isProviderReady` ← the provider-card snapshot: OpenCode
  `GET /api/integration` read once by the async caller (ui:
  `loadIntegrationCatalog()` in
  `packages/ui/src/lib/opencode/integration-catalog.ts`; server:
  `readOpenCodeCredentials()` in `auth.js`), interpreted per provider by the
  card rule (`getProviderCardStatus` in
  `packages/ui/src/components/sections/providers/providerAuth.ts`):
  `connected`/`accounts`/`environment` = ready, `signInNeeded`/`reauthNeeded`
  (`status.status === 'needs_auth'`, i.e. revoked) = not ready, unknown
  provider (no integration, e.g. custom opencode.json providers keyed inline)
  = no card = gate skipped (legacy unknown-proceeds preserved).

## What changed (bridge only, additive, sync-only)

- `packages/web/server/lib/opencode/omo-bridge-runtime.js`
  - `readModelCatalogFileSync(path)`: reads one catalog file into the bridge
    shape; throws `OMO_MODEL_CATALOG_UNREADABLE` (missing/unreadable) or
    `OMO_MODEL_CATALOG_MALFORMED` (bad JSON, wrong top-level shape, no usable
    model) — never a silent empty catalog. Re-reads every call (no cache).
  - `isProviderReadyFromCardSnapshot(snapshot)`: builds the sync
    `(provider) => boolean` predicate from card data; null snapshot returns
    null (gate unwired, legacy skip); malformed snapshot throws
    `OMO_PROVIDER_SNAPSHOT_MALFORMED` before any invoke runs.
  - `invoke`/probe/argv paths untouched: legacy behavior byte-identical.
- `packages/web/server/lib/opencode/omo-bridge-live-predicates.test.js`: 12
  cases (signed pass; unsigned + revoked fail-closed with spawn counter 0;
  codex-shaped file; no-cache rewrite; missing/corrupt catalog; corrupt
  snapshot; null-snapshot legacy; unknown-provider proceeds; env/inline-key
  ready; opencode-go sign-in mapping).
- `DOCUMENTATION.md`: bridge bullet names the live sources + adapters.
- Production callers (`dag-pane/service/handlers.js`, `core-routes.js`
  `/api/engine/status`) deliberately NOT rewired: the gate is sync-only, so
  the live fetch stays in the async route/service layer — a later todo wires
  the snapshot through once a fetch owner exists. The status route keeps its
  static binding defaults.

## Proof (all run in the worktree, cwd `I:/migration/Alwork-wt/wave1`)

- Baseline first: `bun test .../omo-bridge-runtime.test.js` → 50 pass, 0 fail.
- After: `bun test omo-bridge-live-predicates.test.js
  omo-bridge-runtime.test.js` → **62 pass, 0 fail** (209 expects).
- Flake check: new file rerun 3× → exit 0 each time.
- `bunx oxlint` on both touched files → exit 0 (renamed two test helpers
  per `anti-slop/no-shape-in-symbol-names`, split a `typeof` branch per
  `no-runtime-typeof`).
- `bun run type-check` in `packages/web` (`tsc --noEmit`) → exit 0, zero
  lines mention omo-bridge.
- `bun run dead-code` → exit 0 (new exports listed, no blocking finding).

## Manual QA (CLI/config-dump class, script `/tmp/qa-slice-e-t4.mjs`, since removed)

```
PASS signed model passes gate — spawns=1 argv=["run","qa signed","--model","alcore/al-1-2","--json"] err=none
PASS revoked model fails closed — code=OMO_PROVIDER_NOT_SIGNED_IN spawns=0
PASS unsigned model fails closed — code=OMO_PROVIDER_NOT_SIGNED_IN spawns=0
fixture cleanup: .../omo-t4-qa-Hkt4mR removed
OVERALL PASS
```

Binary PASS/FAIL on decision + spawn count, not logs. Fixture catalog +
snapshot built fresh in os tmpdir each run and removed (receipt above).

## Adversarial rundown

- Malformed input: missing file → `OMO_MODEL_CATALOG_UNREADABLE`; corrupt
  JSON / model-less catalog → `MALFORMED`; non-record snapshot →
  `OMO_PROVIDER_SNAPSHOT_MALFORMED`. All throw before invoke: zero spawns.
- Stale state: fresh tmpdir fixtures per test; loader re-reads every call
  (rewrite test proves no cache); UI snapshot rule cited (failed reads throw
  upstream, never arrive as `[]`).
- Dirty worktree: `git status` shows only the two edited files + two new
  files (test + this evidence); pre-existing untracked files untouched.
- Hung commands: everything sync + bounded; suite runs in ~0.6 s.
- Flaky: 3× rerun green; no sleeps/polling in new tests (setImmediate stub).
- Misleading success: asserts check error code + `details` + spawn counter,
  not log text.
- Repeated interruptions: suite re-runnable from scratch, no state.
- Prompt-injection N/A (catalog treated as data): catalog strings pass trim
  + non-empty + no-whitespace validation (`buildRunArgv` rejects
  whitespace), flow only into the spawn argv array (no shell interpolation,
  never eval/import) — a hostile catalog can at most name a model, which the
  readiness gate still vets.
- Cancel/resume N/A (synchronous gate): the gate runs inline in `invoke`
  before spawn; there is nothing to cancel or resume.

## Cleanup receipts

- Fixture dirs: per-test tmpdirs removed in `afterEach`; rewrite-test dir
  removed; QA dir removed (see QA output).
- QA script `/tmp/qa-slice-e-t4.mjs` removed after green.
- No engine installed, no credentials touched, no network calls made.
