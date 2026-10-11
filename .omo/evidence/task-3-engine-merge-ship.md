# Task 3 evidence — bridge atomic group: T4+T1+T9 with gate intact

Plan: `engine-merge-ship`, todo 3 (Wave 1 foundation). Tier HEAVY.
Code home: `I:/migration/Alwork-wt/engine-merge-train` ONLY (shares
`I:/migration/Alwork/.git` with the T9 worktree; every write below
happened in the train worktree). Shared branches never touched, nothing
pushed, wrapper retained (S7 NOT-READY gate honored — no deletion).

## 1. Stale-state receipts (adversarial class b)

- Start: `git rev-parse HEAD` in train = `50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5`
  (matches required `50786f9b`; `git status --porcelain` empty; detached, no branch).
- End: `58f595000d30eecbcda26ce38f2dd7aa1e23ad76` on new branch
  `engine-merge-train-t3-group`, message `feat(engine)!: merged native bridge group`.
- Train tree at start == `50786f9` for all four group files
  (`git diff 50786f9 -- <file>` empty for each before the port).

## 2. Baseline on the unchanged train tree (T4 base, step 1)

`bun test packages/web/server/lib/opencode/omo-bridge-runtime.test.js
packages/web/server/lib/opencode/omo-bridge-live-predicates.test.js`
→ **62 pass / 0 fail** (209 expect calls), exit 0.

FINDING (recorded, never edited green): the plan text says "expect
80/0" for the baseline, but the unchanged T4 tree holds 62 tests —
the +18 (10 `native parity gate` + 8 `native default (T9 flip)`) only
exist after the group lands. 62/0 pre, 80/0 post. No red anywhere.

## 3. Port method (per-file)

Base identity made a git-native port exact: the T9 commit `d2b8464`
sits directly on `50786f9`, and the train tree equaled `50786f9` on
every group file — so `git checkout -b engine-merge-train-t3-group`
+ `git cherry-pick d2b8464` + `git commit --amend` to the required
message applied the full T4+T1+T9 group with zero hunks to resolve.
Proof the port carries both halves:

- **T1-byte-identical proof (gate block vs slice `3c766d2`)**: extracted
  the region `// Native parity gate` … `export const buildRunArgv`
  from slice blob `3c766d2:packages/web/server/lib/opencode/omo-bridge-runtime.js`
  (5593 chars) and from the merged train file (5574 chars) and
  line-diffed. Result: **every executable line identical** —
  `export const OMO_NATIVE_OK`, `resolveBunCommand`, `checkNativeParity`
  (signature, fixed check order bun→worker→engine→barrel, `details`
  shape, all five degraded-message literals) match line-for-line.
  The ONLY delta is the header comment (9 comment lines reworded:
  T1's "`invoke` keeps its wrapper default … the fallback flip belongs
  to T9" → T9's "the T9 default keeps its never-downgrade contract by
  throwing that message instead of silently taking the wrapper").
  Comment-only; zero semantic difference. The five messages are carried
  VERBATIM (each `toBe`-pinned in the suite).
- **T9 semantics list** (present in the merged tree, from the T9 lane
  §2 — `invoke` selection after the Slice-E model gate + argv build):
  per-call `native: false` wins over everything; per-call
  `native: true`/explicit runner/`OMO_NATIVE_RUN=1` → resolve-or-throw;
  `OMO_NATIVE_RUN=0` → wrapper (rollback); unset/blank → gate decides
  (pass → native, fail → throw exact message, zero spawns); any other
  non-blank value → fail-closed throw naming the value; `nativeFromEnv:
  false` keeps the legacy wrapper default. Plus: `bridgeDir`
  passthrough on `resolveEngineRoot`/`resolveNativeRunner`, runtime
  `checkNativeParity` (`checkGate`) export, header/seam comments,
  DOCUMENTATION.md bridge bullet (1-line flip note).
- **Default-path diff vs pre-group shows gate-decided native only**:
  `git diff 50786f9 HEAD -- omo-bridge-runtime.js` = gate block
  insertion + `bridgeDir` threading + `invoke` selection flip +
  comments; `probe`, Slice-E logic, worker, callers untouched.
- **Tree identity**: `git diff d2b8464 HEAD` is EMPTY for all five
  committed files — the merged bytes are exactly the T9 lane's
  verified bytes, so its static story (tsc exit 0, oxlint 1
  pre-existing warning outside the diff) carries over; re-running them
  here would only re-prove identical bytes with new network installs.

Committed files (5, `git show --stat HEAD`): `.omo/evidence/task-9-omo-full-integration.md`
(T9 lane provenance, kept as evidence), `DOCUMENTATION.md` (2 +-1),
`omo-bridge-live-predicates.test.js` (+4), `omo-bridge-runtime.js`
(+218 −23 hunk context), `omo-bridge-runtime.test.js` (+350). T1/T2
slices stay as evidence only — nothing copied from them but the
verified gate bytes above.

## 4. Automated verification (exact commands, train cwd)

- Run 1: `bun test packages/web/server/lib/opencode/omo-bridge-runtime.test.js
  packages/web/server/lib/opencode/omo-bridge-live-predicates.test.js`
  → **80 pass / 0 fail** (279 expect calls), exit 0.
- Run 2 (same command): **80 pass / 0 fail** (279 expect calls), exit 0.
  Counts match — not flaky.
- Gate subset, filter `-t "native parity gate"` (direct argv, no shell):
  **10 pass / 70 filtered out / 0 fail**, exit 0.

## 5. Manual QA (bun CLI repro, `bun C:/Users/dangq/AppData/Local/Temp/t3-qa/driver.mjs`, exit 0, ALL PASS)

Real spawns only: real `bun.exe` + the REAL train
`omo-invoker-worker.ts` against a stub engine barrel (`run()` prints
the result line, returns 0; sleeps 20 s on `slow` messages); spawn
calls counted through a delegating wrapper. Driver deleted after the run.

- (a) default native receipt — gate `{ok:true, code:'OMO_NATIVE_OK',
  path:'native'}`; `handle.native === true`; `wait()` settled
  `{exitCode:0, result:{sessionId:'ses_qa_a', success:true},
  sessionId:'ses_qa_a'}` with 1 spawn — PASS (3/3).
- (b) forced failure, scrubbed `PATH` (`env={PATH:'',Path:''}`) — threw
  `OMO_NATIVE_UNAVAILABLE`, message byte-exact:
  `Native runner unavailable: bun was not found on PATH and
  OMO_BUN_PATH is unset. The wrapper path is kept; install bun or set
  OMO_BUN_PATH to run natively.` — with 0 spawns — PASS (3/3).
- (c) rollback `OMO_NATIVE_RUN=0` — `native:false`, wrapper argv
  `['run','qa wrapper rollback','--json']`, child actually ran and
  settled `{exitCode:1, signal:null}` — PASS (3/3).
- Adversarial (a) malformed input `OMO_NATIVE_RUN=banana` — fail-closed
  `OMO_NATIVE_UNAVAILABLE` naming the value
  (`…has an unrecognized value "banana" (want "0" for the wrapper path,
  "1" for native, or unset for the parity-gated default). Nothing was
  started.`), 0 spawns — PASS (3/3).
- Adversarial (f) cancel/resume — cancel mid-native-run (20 s stub
  barrel, cancel issued synchronously after invoke, no sleep) →
  receipt `{provisional:true, alreadyExited:false, escalated:false,
  reason:'qa stop', exitCode:null, signal:'SIGTERM'}` and post-kill
  `wait()` settled `{exitCode:null, signal:'SIGTERM'}` — PASS (2/2).
- Ruled out with reasons: prompt_injection (invoke args are structured
  data; env values never executed — unknown values throw before any
  spawn), hung_commands (every `wait()` under a 30 s race; bun runs
  bounded at 180 s; nothing exceeded), repeated_interrupts (suites run
  2x + 1 filtered run, identical counts).

## 6. Dirty-worktree receipts (adversarial class c)

- `git status --porcelain` (train, end): empty.
- `git show --stat HEAD`: ONLY the 5 bridge+evidence files above.
- Shared branches untouched: `I:/migration/Alwork-wt/wave1` HEAD still
  `50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5`; the T9 worktree was only
  ever read (`git show`/`git diff`); no push from anywhere.

## 7. Cleanup receipts

- `C:/Users/dangq/AppData/Local/Temp/t3-qa/` (driver) — removed, verified absent.
- `C:/Users/dangq/AppData/Local/Temp/t3-qa-probe/` (registry probe + zod source) — removed, verified absent.
- `I:/migration/Alwork-wt/engine-merge-train/node_modules/` (staged zod copy for the
  real-worker repro; tracked files never touched) — removed, verified absent.
- `%TEMP%` checked for `t3-qa*`/`t9-qa*`/`omo-gate-*`/`omo-t9-qa-*`: none.
- No servers started; all QA children exited or were SIGTERM/SIGKILL-settled in-driver.
- Train worktree left clean on `engine-merge-train-t3-group` at `58f5950`.

## 8. Risks / notes for the merge line

- R1: the header-comment delta (T1→T9 wording) is intentional — anyone
  re-diffing gate-vs-slice should compare from `export const OMO_NATIVE_OK`.
- R2: baseline expectation in the plan (80/0 pre) is unachievable by
  construction; 62/0 pre → 80/0 post is the correct reading.
- R3: T9's R2 (T3 worker-test rot) and deletion-gate items stand; this
  todo changes nothing there.
