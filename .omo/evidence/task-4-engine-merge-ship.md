# Task 4 evidence — engine-merge-ship: merge T2 loop-status onto the resolved bridge

Plan: `engine-merge-ship`, todo 4 (Wave 1 foundation). Work ONLY in
`I:/migration/Alwork-wt/engine-merge-train` on branch
`engine-merge-train-t3-group`. Shared branches never touched, nothing pushed.

## 1. Stale-state receipts (adversarial class b)

- Start: `git rev-parse HEAD` = `58f595000d30eecbcda26ce38f2dd7aa1e23ad76`
  (matches required `58f5950`); `git status --porcelain` empty; branch
  `engine-merge-train-t3-group`.
- End: `7b3a0cedfdffe3f1b5a4d547bcf035ca86cffaa9` on the SAME branch
  `engine-merge-train-t3-group`, message `feat(engine): merged loop-status caller`.
  Linear follow-up: `git log --oneline -3` =
  `7b3a0ce / 58f5950 / 50786f9`. No second branch created.
- `git diff d2b8464` check inherited from todo 3 stands (bridge bytes untouched
  by this todo — bridge files absent from `git show --stat HEAD`).

## 2. Baseline on the UNCHANGED train tree (step 1, HEAD 58f5950)

- `bun test packages/web/server/lib/opencode/omo-bridge-runtime.test.js
  packages/web/server/lib/opencode/omo-bridge-live-predicates.test.js`
  → **80 pass / 0 fail** (279 expect calls), exit 0. Bridge intact as required.
- Loop-status tests absent pre-merge (recorded exactly):
  `git ls-files` for `omo-invoker-worker.test.ts`,
  `omo-invoker-worker.loop-status.test.ts` → empty (only
  `omo-invoker-worker.ts` present); engine UI dir holds only `EnginePage.tsx`.
- Worker smoke pre-merge (zod staged, see §6): bare
  `bun packages/web/server/lib/opencode/omo-invoker-worker.ts` → exit 2,
  stderr `[omo-invoker-worker] missing --engine-root <dir>` (fail-closed intact).

## 3. Port method (per-file)

`69809e1` (T2 slice) is NOT an object in this repo
(`git cat-file -t 69809e1` → `fatal: Not a valid object name` — the
migration repo has no `packages/` tree), so the port is cross-repo by
construction, same as todo 3's "slices stay as evidence only" rule:

- **Caller (worker flags).** The train worker (old flags: positional
  repoRoot, `--session-id`/`--ledger-limit`) and the T2 slice worker
  (standalone, `--session`/`--limit`/`--loop-src`-as-state-dir) are
  different lineages — overwriting either way is a regression. Per the
  task directive (T2-contract side wins on flag semantics, aligned with
  rebased T3 at `b119cfd`), the port lands the T2 contract on the Alwork
  worker via git-native cherry-pick: `git cherry-pick -n bcb9cf4 b119cfd`
  (T3 branch base `50786f9` is an ancestor of train HEAD; merge-base
  `50786f9b`; worker/test files untouched since → automerge, zero hand
  edits). Byte-identity proof (staged blobs vs `b119cfd` blobs):
  worker `b2a66d97cda65ac0d77fc7b20e4d64b440db3cca` == `b119cfd:...worker.ts`,
  test `62bbfc0350c5b15dd404c475a6eaeef571477d8d` == `b119cfd:...test.ts`.
  Gate-status contract on the merged tree: prints
  `{ok, sessionId, plan, ledgerTail}`; limit clamped 1..500, default 50;
  bad session / unreadable readers degrade to plan null + empty tail,
  exit 0; unknown flags / missing values fail closed, exit 2.
- **DOCUMENTATION.md conflicts (both picks, same single line).**
  Resolved with the TRAIN side winning on prose (kept the bridge-group
  T9-default wording verbatim — `b119cfd`'s `(opt-in OMO_NATIVE_RUN=1)`
  clause is stale post-flip), then appended one T2-contract sentence to
  the worker clause (`--session`/`--limit`/`--loop-src`, clamp
  1..500 default 50, degrade exit 0; malformed stdin exits 2). No other
  docs bytes changed.
- **Empty-state UI.** T2's `EnginePage.tsx` is a framework-free renderer;
  the train's `EnginePage.tsx` is the full React settings page (and T8
  later appends `EngineUsageSection` to it) — overwriting is a regression
  and importing the React tree needs an installed toolchain this worktree
  does not have. Ported as new zero-import module
  `packages/ui/src/components/sections/engine/EngineLoopStatus.ts`
  (renderer logic identical to the T2 slice; only a provenance header
  added) + `EngineLoopStatus.test.ts` (T2's 3 tests byte-identical except
  the import path `./EnginePage.tsx` → `./EngineLoopStatus.ts` — a
  mechanical port adaptation, zero assertions changed).
- **NOT ported (stays as evidence only):** T2 slice `plan-io.ts` /
  `ledger.ts` (`readUlwLoopPlanSync`/`summarizeUlwLoopPlan`/`readLedger`/
  `clampLedgerLimit` over `plan.json`+`ledger.jsonl`). The train's
  vendored `ulw-loop/src/plan-io.ts` + `ledger.ts` are the authoritative
  Alwork readers with different (scoped, revision-aware) APIs; the merged
  worker reads through them. No execution/session/spend added to the
  reads path (worker diff is flag parsing + degrade paths only).
- Sequencer note: `cherry-pick -n` of the second commit refused
  `--continue` while the first pick's changes were staged ("local changes
  would be overwritten"); worked around with a local-only `wip` commit +
  `--quit`, then `git reset --soft 58f5950` and ONE commit with the
  required message. The `wip` commit (`b9cfbd1`) is now dangling and
  unreachable; no shared ref ever pointed at it.

Committed files (5, `git show --stat HEAD` on `7b3a0ce`):
`EngineLoopStatus.test.ts` (+43), `EngineLoopStatus.ts` (+71),
`DOCUMENTATION.md` (1-line clause), `omo-invoker-worker.test.ts` (+455),
`omo-invoker-worker.ts` (+134 −35ish). Full stat: 670 insertions,
35 deletions.

## 4. Automated verification (exact commands, train cwd, bun 1.4.2)

- `bun test packages/web/server/lib/opencode/omo-invoker-worker.test.ts`
  run 1 → **27 pass / 0 fail** (121 expects), exit 0, 3.92 s.
- Same command run 2 → **27 pass / 0 fail** (121 expects), exit 0, 3.32 s.
  Counts match — not flaky. (Matches the T3-verified counts from
  task-2 evidence; bytes are identical so the story carries over.)
- `bun test packages/ui/src/components/sections/engine/EngineLoopStatus.test.ts`
  run 1 and run 2 → **3 pass / 0 fail** (11 expects) both, exit 0.
- Bridge on the merged tree:
  `bun test .../omo-bridge-runtime.test.js .../omo-bridge-live-predicates.test.js`
  → **80 pass / 0 fail** (279 expects), exit 0. Intact.
- Post-commit combined (all 4 files, committed tree):
  → **110 pass / 0 fail** (411 expects), exit 0.
- Static checks: repo-configured `bunx oxlint` is environmentally blocked —
  `oxlint.config.ts` imports the `oxlint` package, which is not installed
  (worktree has no `node_modules`; `ERR_MODULE_NOT_FOUND`). Same class as
  T2's tsc-environmental note. Not chased: worker+test are byte-identical
  to verified upstream bytes and the UI files are logic-identical to
  T2 bytes that passed oxlint in their home repo. `tsc` likewise not run
  (no `@types/node`/`bun-types` resolvable here).

## 5. Manual QA (fixture CLI repro, fresh mkdtemp state dir)

Fixture base `C:\Users\dangq\AppData\Local\Temp\t4-loopqa-51a32309\`
(fresh GUID-suffixed dir): `stub-barrel.ts` (`run()` → 0),
`loopsrc-happy/{plan-io,plan-crud,ledger}.ts` (plan "Manual QA loop" +
3 entries seq 10/11/12), `loopsrc-corrupt/` (plan readers throw,
`ledger.ts` is a syntax-broken module → reader import fails).
Worker = the REAL merged train `omo-invoker-worker.ts`; `--engine-root`
= fixture root. All exits 0.

- (a) happy:
  `bun .../omo-invoker-worker.ts --engine-root <F> --barrel-path <F>/stub-barrel.ts --loop-status --session manual-qa-1 --limit 50 --loop-src <F>/loopsrc-happy`
  → exit 0,
  `{"ok":true,"sessionId":"manual-qa-1","plan":{"title":"Manual QA loop","status":"running","goal":"Prove CLI reads","totalSteps":5,"completedSteps":2},"ledgerTail":[{"seq":10,"event":"started"},{"seq":11,"event":"advanced"},{"seq":12,"event":"waiting"}]}`
  (tail length 3) — PASS.
- (a2) bound: same with `--limit 1`
  → exit 0, `ledgerTail":[{"seq":12,"event":"waiting"}]` (newest only) — PASS.
- (b) failure (corrupt-ledger readers):
  `--loop-src <F>/loopsrc-corrupt`
  → exit 0, `{"ok":true,"sessionId":"manual-qa-1","plan":null,"ledgerTail":[]}` — PASS.
  Semantic mapping (recorded, not hidden): on this line `--loop-src`
  selects the READER MODULES, so a corrupt ledger degrades at reader
  level — unreadable readers → plan null + empty tail, exit 0 — while a
  valid session id is still echoed. The T2 slice's file-level rule (any
  malformed `ledger.jsonl` line nulls the whole read) lives in the slice
  readers, which stay as evidence only (§3).
- Adversarial (a) malformed input: `--session ../evil` (happy readers)
  → exit 0, `{"ok":true,"sessionId":null,"plan":null,"ledgerTail":[]}` — PASS.
- Ruled out with reasons: prompt_injection (ledger/plan content flows
  through readers into JSON output only; the UI renderer HTML-escapes
  every dynamic string — pinned by the `<script>` test), cancel_resume
  (reads-only path, no resumable flow), hung_commands (worker suite kills
  each spawn past 30 s; every `bun test` finished in <5 s; QA spawns are
  synchronous local reads — no kill needed, nothing exceeded 300 s),
  repeated_interrupts (suites run 2x + 1 combined run, identical counts).

## 6. Dirty-worktree receipts (adversarial class c)

- Train end: `git status --porcelain` empty; `git show --stat HEAD` = ONLY
  the 5 files in §3.
- zod was staged WITHOUT touching manifests: `bun add zod@^4.3.6`
  (resolved 4.6.5) in `%TEMP%\t4-zodpkgs`, copied to train
  `node_modules/zod` (gitignored — `git check-ignore` confirms;
  `git status` stayed clean). Removed at cleanup (§7).
- Shared branches untouched: `I:/migration/Alwork-wt/wave1` HEAD at end
  still `50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5`; T3 branch still
  `b119cfd`; no push from anywhere (no remotes touched).

## 7. Cleanup receipts

- `C:\Users\dangq\AppData\Local\Temp\t4-loopqa-51a32309\` (QA fixtures) —
  removed, verified absent (`Test-Path` False).
- `C:\Users\dangq\AppData\Local\Temp\t4-zodpkgs\` — removed, verified absent.
- `I:/migration/Alwork-wt/engine-merge-train/node_modules\` (staged zod) —
  removed, verified absent.
- No servers started at any point (suites spawn only short-lived worker
  processes, reaped by `afterEach` SIGKILL sweep; every suite exited 0).
- Train tree left clean on `engine-merge-train-t3-group` at `7b3a0ce`.

## 8. Risks / notes for the merge line

- R1 (todo-10 interaction): this commit lands the T3 branch's worker
  bytes (`b119cfd`) on the train NOW for the T2 contract. Todo 10's later
  merge of `ulw/omo-full-integration-wave1-t3` will find identical worker
  changes on both sides of merge-base `50786f9` → automerge, no conflict —
  but todo 10 must still run the FULL battery (todos 6–9 first); this todo
  does NOT complete it.
- R2: `EngineLoopStatus.ts` is intentionally NOT wired into `EnginePage.tsx`
  (that composition belongs to a consumer todo with the real app shell;
  T8 owns tab states). The renderer + tests stand alone and green.
- R3: repo-configured oxlint/tsc remain unrunnable until the consuming
  worktree has installed deps; recorded as environmental, not waived.
