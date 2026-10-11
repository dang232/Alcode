# Task 9 evidence — Merge T8 tab stats source (engine-merge-ship todo 9)

## Work location (mandated)

- Train worktree: `I:/migration/Alwork-wt/engine-merge-t8`, fresh branch
  `engine-merge-t8` created at `7b3a0ce` via
  `git -C I:/migration/Alwork worktree add I:/migration/Alwork-wt/engine-merge-t8 -b engine-merge-t8 7b3a0ce`.
- HEAD check before work: `7b3a0cedfdffe3f1b5a4d547bcf035ca86cffaa9` == `7b3a0ce` → proceed.
- Lane branch (same repo): `t8-engine-tab-stats` @ `eba76080cfdececc205d345d577cfe0298421453`.
  Merge-base with train: `50786f9` (lane branched before the bridge group + loop-status).
- Stale-state guard: HEAD start `7b3a0ce`, HEAD end `a5fcbaa2b529ef7edc3ce3e8bc5e83c4048af834`;
  merge parents `7b3a0ce + eba7608` (both first-parent chain intact).
- Shared branches untouched: `ui-alcore-readiness` still `50786f9`
  (`feat(engine): live Slice-E predicate sources`). Nothing pushed, no shared-branch commits.

## Step 1 — covering tests read + baseline on unchanged tree

- Read first (behavior of record): `engineSessionStats.ts` (projection of six numbers,
  unreachable/malformed taxonomy, 7-day default window), `EngineUsageSection.tsx`
  (view states via `data-state`/`data-error`/`data-*` markers, container loading→populated),
  `engineSessionStats.test.ts` (4 boundary tests, status fields only),
  `EngineUsageSection.test.tsx` (5 render tests, machine markers only, fresh fixtures per test).
- Baseline on unchanged tree (`7b3a0ce`, T8 files absent):
  `node ../../scripts/run-isolated-tests.mjs src/lib/engine src/components/sections/engine`
  (cwd `packages/ui`) → **2/2 test files passed, exit 0**.
- Baseline note: fresh worktree had no `node_modules` (first run failed on missing `zod`,
  environmental, not code). `bun install` → 1671 packages with the same 2 unrelated link
  warnings the lane recorded (babel safari plugin copyfile, capacitor barcode copyfile;
  postinstall electron ensure best-effort). Baseline re-run after install: 2/2 green.

## Step 2 — merge

- Command: `git merge --no-ff t8-engine-tab-stats -m "feat(engine): merged tab stats source"`.
- Result: clean auto-merge by `ort`, **zero conflicts, zero manual resolutions**
  (train never touched `EnginePage.tsx` — `git diff 50786f9..7b3a0ce -- EnginePage.tsx` is empty —
  so the lane's 2-line mount applied onto identical context; the 4 new files are lane-only).
- Merge diffstat (`7b3a0ce..HEAD`, 6 files, 621 insertions, 0 deletions):
  `EnginePage.tsx` +2, `EngineUsageSection.tsx` +137, `EngineUsageSection.test.tsx` +141,
  `engineSessionStats.ts` +85, `engineSessionStats.test.ts` +109,
  `.omo/evidence/task-8-omo-full-integration.md` +147.
- No session-panel duplication (file-scan receipts on merged tree):
  `EngineUsageSection` referenced only by `EnginePage.tsx` (import + single `<EngineUsageSection />`
  mount) and its own test; `EngineLoopStatus|renderEngineLoopStatus` absent from both T8 files;
  `models|tools|activity` occur in `EngineUsageSection.tsx` only in the doc comment stating they
  stay on the usage page. `tools` in `engineSessionStats.ts` is the read query param only.
- Todo 4 file untouched: `git diff 7b3a0ce..HEAD -- EngineLoopStatus.ts EngineLoopStatus.test.ts
  omo-bridge-runtime.js omo-invoker-worker.ts` → empty. `EngineLoopStatus.ts` intact (2755 bytes).

## Step 3 — commit

- Merge commit preserved: `a5fcbaa2b529ef7edc3ce3e8bc5e83c4048af834`
  `feat(engine): merged tab stats source` on `engine-merge-t8` only. Orchestrator lands it.

## Verification (exact, recorded)

- Isolated UI runner ONLY (documented order-fragility; single-process `bun test` never run):
  `node ../../scripts/run-isolated-tests.mjs src/lib/engine src/components/sections/engine`
  → **run1: 4/4 passed exit 0; run2: 4/4 passed exit 0**.
  Actual is 4/4, not the plan's 3/3: the merged tree adds `EngineLoopStatus.test.ts`
  (todo 4) to the lane's 3 files. No test edits, no weakening.
- `bun run type-check` (`tsc --noEmit`, `packages/ui`) on merged tree → **exit 0**.
- Dirty-worktree check: `git status --porcelain` after merge + QA cleanup → empty
  (only the 6 merged files in the commit; QA script deleted, see below).

## Manual-QA channel (render dumps, `renderToStaticMarkup` per state)

Temp script `packages/ui/qa-engine-usage-t9.tsx` (deleted after green), machine markers asserted:

- PASS loading chars=458 markers=[data-state="loading"]
- PASS unreachable chars=1557 markers=[data-state="degraded" data-error="unreachable" <button]
- PASS malformed chars=1555 markers=[data-state="degraded" data-error="malformed" <button]
- PASS populated chars=3193 markers=[data-state="populated" data-sessions="2" data-prompts="5" data-tokens="20" data-cost="1.25"]
- OVERALL PASS, exit 0. Degraded states render the error branch with retry, never blank
  (all markups non-empty; populated shows live values on machine markers).

## Adversarial rundown

- malformed_input: off-shape wire bodies (`sessions: "two"`, `tokens: null`) map to `malformed`
  via the boundary tests (4/4 suite), and the malformed state dump renders degraded non-blank
  (1555 chars, `data-error="malformed"` + button). No crash, no zeroed report.
- stale_state: HEAD start/end recorded above; tests use per-test fresh fixtures
  (`summaryFixture()`/`wireFixture()` called per case) plus a per-test deferred fetch in the
  container case — nothing shared between runs.
- dirty_worktree: `git status --porcelain` empty post-merge; commit holds only the 6 T8 files.
- misleading_success_output: every verdict from `data-*` markers / status fields / exit codes;
  zero prose pins in tests or QA assertions.
- flaky_tests: isolated runner 2× green on the merged tree (4/4, 4/4); no sleeps/polling in tests.
- N/A: prompt_injection (stats flow into `Intl` formatters and `data-*` attributes only, never
  markup/queries/eval); cancel_resume (one-shot read with manual retry, no resumable flow);
  hung_commands (all suites < few seconds; install/type-check run with explicit kill deadlines);
  repeated_interrupts (single clean merge, no fix cycles).

## Cleanup receipts

- QA script `packages/ui/qa-engine-usage-t9.tsx` removed after green (`git status` confirms absent).
- No servers, fixtures, or tmpdirs created (all fixtures in-memory).
- `node_modules` from `bun install` is gitignored (status clean).
- Worktree `I:/migration/Alwork-wt/engine-merge-t8` left at the merge commit for landing.

## Out of scope (not touched)

Unrelated settings surfaces, OpenCode-config skills, bridge/worker/loop-status sources,
changelog, shared branches, pushes.

## Landing receipt — lane engine-merge-t8 onto train engine-merge-train-t3-group

- Pre-merge: train worktree `I:/migration/Alwork-wt/engine-merge-train` on branch
  `engine-merge-train-t3-group` @ `37e19e456f0212f3eb6ef2134d92f3ef984ea787` (confirmed, matches plan).
- Command: `git merge --no-ff engine-merge-t8 -m "Merge lane engine-merge-t8: tab stats source"`.
- Result: clean auto-merge by `ort`, zero conflicts (EnginePage union not needed —
  resolution: clean). Diffstat: 6 files, 621 insertions, 0 deletions
  (`EnginePage.tsx` +2, `EngineUsageSection.tsx` +137, `EngineUsageSection.test.tsx` +141,
  `engineSessionStats.ts` +85, `engineSessionStats.test.ts` +109,
  `.omo/evidence/task-8-omo-full-integration.md` +147).
- Merge commit: `d74a9d54099b7671a5900838a9140a52330afc6f` with parents
  `37e19e456f0212f3eb6ef2134d92f3ef984ea787 + a5fcbaa2b529ef7edc3ce3e8bc5e83c4048af834`.
- Post-merge `git status --porcelain` → empty; `git log --oneline -3`:
  `d74a9d5 Merge lane engine-merge-t8: tab stats source` /
  `37e19e4 Merge lane engine-merge-alias: ulw command plus snippet alias` /
  `0789351 Merge lane engine-merge-t6: dag-pane graduation`.
- Smoke (cwd `packages/ui` in train worktree):
  `node ../../scripts/run-isolated-tests.mjs src/lib/engine src/components/sections/engine`
  → **4/4 test files passed, exit 0** (single run). No `bun install` needed
  (`node_modules` present; `bun.lock` untouched, status clean).
- No tags. No temp files, servers, or other processes started.
