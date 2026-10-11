# Task 6 evidence — engine merge: loop session driver (T5 port)

Plan `I:/migration/.omo/plans/engine-merge-ship.md`, todo 6. No spend, no push,
no shared-branch touch, no engine import into the web process.

## Lane setup

- Lane worktree+branch created per goal:
  `git -C I:/migration/Alwork worktree add I:/migration/Alwork-wt/engine-merge-t5 -b engine-merge-t5 7b3a0ce`
- HEAD verified `7b3a0cedfdffe3f1b5a4d547bcf035ca86cffaa9` before editing and
  after QA (unchanged until the merge commit below). `git status --short`
  clean before port.
- ALL file work inside `I:/migration/Alwork-wt/engine-merge-t5`. No other
  branch or worktree touched; nothing pushed.

## Source (read-only, other repo)

- Lane: `I:/migration-wt/omo-t5-driver`, branch
  `ulw/omo-full-integration-t5-driver` @ `37509818`.
- Files: `packages/web/server/lib/opencode/omo-loop-driver.ts` +
  `omo-loop-driver.test.ts`.
- Contract (from `.../omo-t5-driver/.omo/evidence/task-5-omo-full-integration.md`):
  ownership `sessionId` + `parentSessionId` + `hostPid` enforced on every
  mutation; `--loop-status` reads byte-untouched; fail-closed
  `{ ok:false, code, message }` with no writes on refusal.

## Baseline

- Lane `ls packages/web/server/lib/opencode/omo-loop-driver.*` before port:
  absent (no collision; both files new).
- Worker sha256 before port:
  `6DAD224760F5FD88F64265D059BE8DBF2926F77ED7DD9DCAA2FD134A91318F59`
  (`packages/web/server/lib/opencode/omo-invoker-worker.ts`).

## Port method

- Byte-exact copy via `fs.copyFileSync` (no edits, no renames):
  - `omo-loop-driver.ts` → `packages/web/server/lib/opencode/omo-loop-driver.ts`
  - `omo-loop-driver.test.ts` → `packages/web/server/lib/opencode/omo-loop-driver.test.ts`
- Post-copy sha256 (source == dest, both files):
  - driver `5E9232FB9BA137E1149B796942E051F096C2F0ECC214953A3DFD650EF1F00C2F`
  - test `4BB8B8EB8F10B86C11A42DCFBCAABA1DD914280D018528880393AE219032BA37`
- Worker sha256 after port:
  `6DAD224760F5FD88F64265D059BE8DBF2926F77ED7DD9DCAA2FD134A91318F59`
  — MATCHES before: `--loop-status` reads byte-untouched. PROVED.

## Automated verification (lane worktree cwd, exact command)

- `bun test packages/web/server/lib/opencode/omo-loop-driver.test.ts`
  - Run 1: 10 pass / 0 fail, 70 expects, exit 0.
  - Run 2: 10 pass / 0 fail, 70 expects, exit 0. 2x MATCH (no flake).
- Full tails recorded in run transcript (exit codes observed, not log text).

## Manual QA (fixture CLI class, script `omo-t6-manualqa.ts` in %TEMP%, removed after)

Drove the driver API on a fresh `mkdtemp` dir with the real `process.pid`
(15016) as `hostPid`. Quoted invocations + outputs:

- `FIXTURE=C:\Users\dangq\AppData\Local\Temp\omo-loop-driver-K7rOaX`, `HOSTPID=15016`
- `a) start ok=true plan={"title":"ship two steps","status":"running","goal":"ship two steps","totalSteps":2,"completedSteps":0}` — PASS (admission)
- `b) stop ok=true stopped=true` — PASS (hook arms)
- `c) halt ok=true halted=true events=started,halted` — PASS (mid-iteration halt)
- `d) resume1 ok=true done=false plan={...,"completedSteps":1} events=started,halted,resumed,advanced` — PASS (resume from ledger)
- `e) resume2 ok=true done=true plan={...,"completedSteps":2,"status":"complete"} events=started,halted,resumed,advanced,completed` — PASS (2-resume completion)
- `f) foreign ok=false code=OMO_LOOP_DRIVER_FOREIGN_SESSION ledgerIdentical=true` — PASS (foreign refused fail-closed)
- `g) status ok=true plan={...,"status":"complete",...}` — PASS (reads completed plan)
- `LEDGER=1:started 2:halted 3:resumed 4:advanced 5:completed`, `OVERALL=PASS`,
  `FIXTURE_REMOVED=true`, script exit 0.
- PASS criteria met: resume completes from ledger; foreign refused.

## Adversarial

- malformed_input (6-way, each fresh fixture, readdir-equal + empty-ledger):
  `blank-goal→OMO_LOOP_DRIVER_GOAL_REQUIRED`,
  `../evil→OMO_LOOP_DRIVER_SESSION_INVALID`,
  `bad-parent→OMO_LOOP_DRIVER_PARENT_INVALID`,
  `bad-pid→OMO_LOOP_DRIVER_HOST_PID_INVALID`,
  `steps-0→OMO_LOOP_DRIVER_STEPS_INVALID`,
  `steps-101→OMO_LOOP_DRIVER_STEPS_INVALID` — all untouched=true, `MALFORMED_6WAY=PASS`.
- cancel_resume: stop→halt→resume on 3-step goal:
  `halted=true resumed1done=false events=started,halted,resumed,advanced` — PASS.
- stale_state: HEAD start `7b3a0ce` == HEAD end `7b3a0ce...` (pre-commit);
  fresh `mkdtemp` fixtures per test and per QA run; `seq` recomputed from
  ledger content on every append. PASS.
- dirty_worktree: `git status --short` shows ONLY the 2 driver files
  (untracked); `git diff --stat` empty (no tracked-file modification).
- misleading_success_output: verdicts from exit codes + parsed plan fields +
  ledger event sequences (full tails quoted above). PASS.
- flaky_tests: 2 runs identical (10/0, 70 expects, exit 0). PASS.
- prompt_injection: N/A one-liner — goal stored inert: control-char goal
  (`--session-id x` + embedded JSON) stored verbatim, ledger `started` only. Verified.
- hung_commands: N/A — sync fs only, no spawn/network/sleep; every command
  under kill timer, none exceeded. Verified.
- repeated_interrupts: covered by stop→halt→resume→stop→halt→resume path in
  ported test 6 (two resumes complete exactly once).

## Commit

- `git add` the 2 driver files + commit on `engine-merge-t5`:
  message `feat(engine): merged loop session driver`.
- Branch: `engine-merge-t5` @ `d1fc47c910152fbca14a63516bb761e990504d12`.

## Cleanup receipts

- QA scripts `omo-t6-manualqa.ts`, `omo-t6-adv.ts`: removed, verified absent.
- QA/per-test fixture dirs: removed (`FIXTURE_REMOVED=true`; `TEMP` holds no
  `omo-loop-driver-*` leftovers).
- No servers started (no pids/ports); driver spawns nothing by construction.
- Lane tree: only the 2 driver files changed (status + diff receipts above).

## Hashes

- worker before/after: `6DAD22...18F59` / `6DAD22...18F59` MATCH.
- driver src==dst: `5E9232...00C2F`. test src==dst: `4BB8B8...2BA37`.

## Risks / follow-ups

- R1 (inherited from T5): driver steps the slice state shape
  (`plan.json` completedSteps), not the full engine `goals.json` + criteria
  machine. Wire ownership/iteration/hook shape around real `ulw-loop` CLI
  spawns at production time.
- R2 (inherited): `tsc --noEmit` needs `@types/node` in the consuming repo;
  bun runtime is the operative check here.
- Landing onto the train branch is the ORCHESTRATOR's job; this lane commits
  only on `engine-merge-t5`.

## Landing receipt (train engine-merge-train-t3-group, child st_01a12a86)

- Pre-merge: `git checkout engine-merge-train-t3-group`, HEAD
  `7b3a0cedfdffe3f1b5a4d547bcf035ca86cffaa9` MATCHED expected `7b3a0ce`
  (no other landing got here first). `git status --porcelain` clean.
- Merge: `git merge --no-ff engine-merge-t5 -m "Merge lane
  engine-merge-t5: loop session driver"` — clean, ort strategy, no conflicts.
  2 files changed, 685 insertions (driver + test, both new).
- Merge commit `bca06f4170b545096f87bcdab52945dbcb82a325`, parents
  `7b3a0ce` + `d1fc47c910152fbca14a63516bb761e990504d12`.
  `git log --oneline -3`: `bca06f4` / `d1fc47c` / `7b3a0ce`.
- Post-merge `git status --porcelain` clean; `git diff --stat` empty
  (bun.lock untouched). No tags created (frozen per plan).
- Landing smoke (train worktree cwd, exact command):
  `bun test packages/web/server/lib/opencode/omo-loop-driver.test.ts
  packages/web/server/lib/opencode/omo-invoker-worker.test.ts`
  → 37 pass / 0 fail, 191 expect() calls, exit 0. PASS.
- Smoke note: first run in the train worktree gave 10 pass / 27 fail
  (exit 1, `Cannot find package 'zod'`) because the worktree had no
  `node_modules`; the lane worktree @ `d1fc47c` failed identically, proving
  it pre-existing/environmental, not merge-caused. Ran
  `bun install --frozen-lockfile` (node_modules is gitignored; 1671
  packages; 2 unrelated link failures: capacitor barcode-scanning, one babel
  plugin; postinstall electron repair best-effort) then re-ran smoke →
  37/0 exit 0. Tail: `37 pass, 0 fail, 191 expect() calls, Ran 37 tests
  across 2 files. [3.03s]`.
- Cleanup: none beyond the merge (no temp files created; node_modules only,
  gitignored). No file edits except this receipt section.
