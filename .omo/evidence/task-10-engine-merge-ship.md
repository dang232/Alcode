# Task 10 evidence — Merge T3 tests + full canary run (engine-merge-ship todo 10)

Plan: `I:/migration/.omo/plans/engine-merge-ship.md`, todo 10 (Wave 3 canary).
Work ONLY in `I:/migration/Alwork-wt/engine-merge-train` on branch
`engine-merge-train-t3-group`. No second train branch created. Shared branches
untouched, nothing pushed. Environment: bare `git` hangs on this host — every
git command below ran via `C:/Program Files/Git/bin/git.exe`, one per shell cell.

## 1. Stale-state receipts

- Start: `rev-parse HEAD` = `84e1a51453d57fd4859e918976fcd5caa2cc785a` ==
  required `84e1a51`; `branch --show-current` = `engine-merge-train-t3-group`;
  `status --porcelain` empty → proceeded (STOP condition not triggered).
- T3 source verified before work: `I:/migration-wt/omo-full-integration-wave1/Alwork`,
  branch `ulw/omo-full-integration-wave1-t3` @ `b119cfdd3245a263138e9dee5e42076829f0842e`
  == required `b119cfd`.
- End: `7a3ba9138d9f3e34abaf5ce67df7dadcddd0308c` on the SAME branch
  `engine-merge-train-t3-group`, message `test(engine): merged worker canary over
  resolved tree`. Linear follow-up: `log --oneline -4` =
  `7a3ba91 / 84e1a51 / d74a9d5 / 37e19e4`.

## 2. Covering tests read first (behavior of record)

`packages/web/server/lib/opencode/omo-invoker-worker.test.ts` (already on the
train tree from todo 4): drives the REAL worker binary (`bun omo-invoker-worker.ts`)
over real process stdio against per-test `mkdtemp` fixture dirs only (stub run
barrel + stub loop-state readers); `afterEach` SIGKILL-sweeps live children and
asserts fixture dirs removed. No engine checkout, no session, no keyed spend.
27 cases in 4 describes: job mode stdin-parse (8: minimal/optional/blank-line
skip, exit-code passthrough, rejection exit 1, missing-message/blank/port
fail-closed exit 2, missing --engine-root exit 2), `--self-test` (3: sorted
export list, default engine-layout barrel, missing barrel exit 2 naming
native-unavailable), `--loop-status` T2 contract (10: default full tail, limit 5
newest-5, oversized clamp, zero/non-numeric fallback-to-default, session echo +
reader scope, invalid-session degrade, absent-layout degrade + --loop-src
override, broken-reader degrade, retired-flags fail, missing-values exit 2),
malformed input (6: empty/whitespace/non-JSON/truncated stdin exit 2, missing
barrel before stdin parse, barrel-without-run exit 2).

## 3. Merge decision + proofs (cross-repo port, no second branch)

T3 HEAD `b119cfd` touches 3 files (commits `bcb9cf4` + `b119cfd`):
`omo-invoker-worker.ts`, `omo-invoker-worker.test.ts`, `DOCUMENTATION.md`.
Blob sha256 comparison (`git show <sha>:<path>`, T3 `b119cfd` vs train `84e1a51`):

- `omo-invoker-worker.ts`: T3 len 9206
  `6dad224760f5fd88f64265d059be8dbf2926f77ed7dd9dcaa2fd134a91318f59` ==
  train len 9206 same hash → IDENTICAL (automerge-equivalent, no-op with proof).
- `omo-invoker-worker.test.ts`: T3 len 19189
  `6ddc6753ebea3beba1f5406385aa9bad8ea377bce432fb0e804ce6da62683309` ==
  train len 19189 same hash → IDENTICAL (automerge-equivalent, no-op with proof).
- `DOCUMENTATION.md`: T3 len 88806
  `f9e97a27a986878db9920636fdf635a02ac4ebc045614f66ddc1b01e7f2c9a4e` vs
  train len 90070 `79c2cfa0cf30da4514ed48c79a98a49fb62686ac7a257c5aa4192da3b98c3c73`
  → differ. Diff: train is a SUPERSET (T9 native-default rewrite + T7 engine-skills
  bullet); the ONE genuinely missing T3 line is the worker-test clause T3 appends
  to the bridge-bullet tests sentence —
  "``, omo-invoker-worker.test.ts`` (worker binary over fixture dirs: job parse,
  self-test, loop-status flags, barrel/malformed exit codes)" — which the T9
  rewrite dropped.

Port: appended exactly that clause to the train's current tests sentence (T9 + T7
wording kept verbatim, zero other DOC bytes changed). Committed on
`engine-merge-train-t3-group` ONLY because a real delta existed:
`7a3ba91 test(engine): merged worker canary over resolved tree`, `show --stat` =
1 file (`DOCUMENTATION.md`, 1 insertion, 1 deletion — one line). No test file
touched, no prod file touched, no empty commit.

## 4. Full battery on the merged tree (ONE recorded run, bun 1.4.2, exit 0 each)

Train worktree root unless noted. `node_modules` present (root + `packages/web`);
no install needed.

| # | Suite | Exact command | Result |
|---|-------|---------------|--------|
| 1 | Bridge run 1 | `bun test packages/web/server/lib/opencode/omo-bridge-runtime.test.js packages/web/server/lib/opencode/omo-bridge-live-predicates.test.js` | 80 pass / 0 fail, 279 expects, exit 0 |
| 2 | Bridge run 2 (flaky probe) | same | 80 pass / 0 fail, 279 expects, exit 0 — MATCH |
| 3 | Worker run 1 (covers loop-status T2 contract: `omo-invoker-worker.test.ts`) | `bun test packages/web/server/lib/opencode/omo-invoker-worker.test.ts` | 27 pass / 0 fail, 121 expects, exit 0 |
| 4 | Worker run 2 (flaky probe) | same | 27 pass / 0 fail, 121 expects, exit 0 — MATCH |
| 5 | Loop-status UI + driver | `bun test packages/ui/src/components/sections/engine/EngineLoopStatus.test.ts packages/web/server/lib/opencode/omo-loop-driver.test.ts` | 13 pass / 0 fail (3 + 10), 81 expects, exit 0 |
| 6 | Skills (vitest, cwd `packages/web`) | `bunx vitest run server/lib/opencode/skill-routes.test.js server/lib/opencode/skills.test.js server/lib/skills-catalog` | 7 files, 57 passed / 57, exit 0 |
| 7 | UI isolated runner (cwd `packages/ui`) | `node ../../scripts/run-isolated-tests.mjs src/lib/engine src/components/sections/engine` | 4/4 test files passed, exit 0 |
| 8 | Pane + handlers + registry | `bun test packages/extensions/dag-pane/panel/dag-view.test.ts packages/extensions/dag-pane/service/handlers.test.js packages/ui/src/lib/surfaces/registry.test.ts` | 36 pass / 0 fail, 137 expects, exit 0 |

No red anywhere → no prod fix needed, no test edited, no weakening. Worker/bridge
ran 2x per the flaky-probe rule (identical counts); all others 1x + this note.

## 5. Manual-QA channel (end-to-end loop-status read, fresh fixtures)

Real merged worker, fresh `mkdtemp` fixture root
`C:\Users\dangq\AppData\Local\Temp\t10-loopqa-eaw5E9\` (stub barrel `run→0`;
`loopsrc-happy` serves plan "Canary loop" + seq 10/11/12; `loopsrc-corrupt`
readers throw). Quoted invocations + outputs:

- Happy: `bun .../omo-invoker-worker.ts --engine-root <F> --barrel-path <F>/stub-barrel.ts --loop-status --session canary-1 --limit 50 --loop-src <F>/loopsrc-happy`
  → exit 0,
  `{"ok":true,"sessionId":"canary-1","plan":{"title":"Canary loop","status":"running","goal":"Prove merged read","totalSteps":5,"completedSteps":2},"ledgerTail":[{"seq":10,"event":"started"},{"seq":11,"event":"advanced"},{"seq":12,"event":"waiting"}]}`
  — `{ok,sessionId,plan,ledgerTail}` correct — PASS.
- Corrupt (malformed_input probe): same with `--loop-src <F>/loopsrc-corrupt`
  → exit 0, `{"ok":true,"sessionId":"canary-1","plan":null,"ledgerTail":[]}` — PASS
  (degrade, never crash).
- PASS = battery all-green (§4) + read correct — PASS.

## 6. Adversarial rundown

- stale_state: HEAD start/end recorded in §1; fixtures fresh `mkdtemp` per QA run.
- dirty_worktree: `status --porcelain` empty at start AND end; `show --stat HEAD` =
  only the DOC line (§3).
- misleading_success_output: every verdict from exit codes + parsed JSON/counts;
  full tails quoted in §4/§5.
- flaky_tests: worker + bridge 2x identical; no sleeps/polling in any suite.
- malformed_input: corrupt-ledger probe degrades exit 0 (§5, second bullet).
- N/A: prompt_injection (loop content flows readers→JSON only; renderer escapes —
  pinned by todo 4's `<script>` test), cancel_resume (reads-only path), hung_commands
  (every suite <5 s; QA spawns synchronous local reads; 300 s kill bound never hit),
  repeated_interrupts (single DOC commit, no fix cycles).

## 7. Cleanup receipts

- QA fixture root `...\t10-loopqa-eaw5E9\` removed, verified absent (`existsSync` false).
- Scratch DOC-compare dir `C:/Temp/merge-t3/` removed, verified absent.
- No servers started at any point (suites spawn only short-lived worker processes
  reaped by `afterEach` SIGKILL; QA spawns synchronous; all exited 0).
- No temp scripts left in repo; tree clean (§6 dirty_worktree).
- Shared branches untouched: T3 branch still `b119cfd`; no push from anywhere
  (no remotes touched).

## 8. Risks / notes

- R1: DOC-only delta — zero behavioral risk; the battery re-proves the finished tree.
- R2: Plan's todo-10 text cites older counts (loop-status 15/0, UI 3/3); actual on
  the finished tree is worker-file 27/0 (covers loop-status) + isolated UI runner
  4/4 (todo 4's `EngineLoopStatus.test.ts` joins the lane's 3). Counts quoted above
  are the observed ones, not the plan's.
