# Gate review — engine-merge-ship todo 3: Bridge atomic group (T4+T1+T9)

Task: adversarial verification of executor DoneClaim (st_01a12a6d).
Plan: `I:/migration/.omo/plans/engine-merge-ship.md`, todo 3.
Reviewer did NOT implement this work. Every claim below was reproduced
from the artifacts by the reviewer; executor prose was treated as untrusted.

## recommendation

**APPROVE** (adversarial verdict: `confirmed`, confidence 0.95)

## originalIntent

Merge the T4 predicates, T1 native-parity gate, and T9 native flip onto
the merge train as one atomic group: gate-decided native default, five
degraded messages verbatim, fail-closed codes + spawn counters preserved,
wrapper retained (never deleted), shared branches untouched.

## desiredOutcome

Commit `feat(engine)!: merged native bridge group` on a train-only branch
atop `50786f9b`, carrying exactly the T9 lane's verified bytes (T1 gate
executable lines byte-identical from `export const OMO_NATIVE_OK` onward),
bridge+predicate suites 80/0, gate subset 10/10, rollback reachable via
`OMO_NATIVE_RUN=0`.

## userOutcomeReview

The shipped artifact satisfies the outcome: the branch contains exactly
the verified T9 bytes on top of the required base, the gate block is
provably byte-identical to the T1 slice, suites are green (reproduced),
and rollback/fail-closed behaviors were reproduced live by the reviewer.
No user-visible behavior beyond the intended flip; wrapper deletion did
not occur.

## Probe results (reviewer-run, full outputs quoted or summarized)

1. **Commit+branch — PASS.** `log --oneline -2 engine-merge-train-t3-group`:
   `58f5950 (HEAD -> engine-merge-train-t3-group) feat(engine)!: merged native bridge group`
   atop `50786f9 ... feat(engine): live Slice-E predicate sources`.
   `show --stat HEAD --oneline` lists ONLY the 5 claimed files
   (task-9 evidence md, DOCUMENTATION.md, live-predicates test, bridge runtime,
   bridge runtime test). `status --porcelain` empty; `rev-parse HEAD` =
   `58f595000d30eecbcda26ce38f2dd7aa1e23ad76`. Method claim also verified:
   `d2b8464^` == `50786f9b` (T9 is a direct child of the base), so the
   zero-conflict cherry-pick story is consistent with the observed tree identity.
2. **T9 fidelity — PASS.** `git diff d2b8464..HEAD --stat` EMPTY (exit 0,
   no names). Full-tree `diff /tmp/t9-bridge.js /tmp/train-bridge.js` on the
   runtime file: exit 0. Any prod diff would have been needs-fix; there is none.
3. **T1 gate byte-identity — PASS.** Gate block extracted from both files
   (`/^export const OMO_NATIVE_OK/` up to `/^export const buildRunArgv/`):
   both 124 lines / 4701 chars, `diff -u` exit 0, sha256 identical
   (`3b71e487...`). All five degraded messages grep at identical line numbers
   (478, 479, 487, 496, 505, plus the `unrecognized value` fail-closed at 890)
   with identical text in train and T9. Header-comment delta confirmed as
   comment-only (T1 wording about `invoke` wrapper default vs T9 wording about
   never-downgrade throw) — zero semantic difference, as claimed.
4. **Wrapper retained — PASS.** Wrapper spawn path present (`spawn(entry, argv…)`
   → `launchHandle({… native: false …})`, `OMO_NATIVE_RUN=0` → `runner = null`
   with "Env rollback: wrapper path, kept until deletion" comment,
   `resolveEngineEntry` defaulting to `OMO_WRAPPER_PATH`). Reachability proven
   by probe 6 repro (`native:false`, real spawn call to the wrapper entry).
5. **Green suite (reviewer-run) — PASS.** From the train worktree:
   `bun test .../omo-bridge-runtime.test.js .../omo-bridge-live-predicates.test.js`
   → `80 pass / 0 fail / 279 expect() calls / Ran 80 tests across 2 files`,
   exit 0, ~228 ms (well under 300 s). NOTE: an initial run from the wrong cwd
   (`I:/migration`) ran 469 tests across 13 files; the valid 80/0 result is from
   the train worktree. Gate subset `-t "native parity gate"` → `10 pass /
   58 filtered out / 0 fail`, exit 0.
6. **Rollback repro (reviewer-run) — PASS.** Minimal `bun -e` with stubbed
   entry/spawn and `env { OMO_NATIVE_RUN: '0' }`:
   `{"native":false,"spawns":1,"entry":"/fake/bin/oh-my-opencode.js",
   "argv":["run","qa wrapper rollback","--port","1234","--session-id","qa","--json"]}`
   exit 0 — wrapper path, same argv shape family as the evidence claim.
   Banana fail-closed repro: `{"code":"OMO_NATIVE_UNAVAILABLE",
   "msg":"Native runner unavailable: OMO_NATIVE_RUN has an unrecognized value
   \"banana\" (want \"0\" for the wrapper path, \"1\" for native, or unset for
   the parity-gated default). Nothing was started."}` exit 0, spawn never called.
   Rollback reference intact: `alwork-pre-T3` → `50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5`.
7. **No shared-branch writes — PASS.** `rev-parse HEAD` in `wave1` ==
   `50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5`.
8. **N/A one-liners.**
   - malformed_input: DONE (banana repro above, fail-closed before any spawn).
   - prompt_injection: code-confirmed (env values are matched as data against
     "0"/"1"/""/blank; anything else throws before any spawn — see invoke
     selection lines ~803–900; no env value is executed).
   - cancel_resume: covered by suite (cancel PROVISIONAL kill-with-reason tests
     pass within the 80/0) plus executor's live-cancel QA; not re-driven live
     (driver deleted per cleanup receipts).
   - hung_commands: nothing hung; suite ~228 ms, repros instant, executor's
     bounded-waits design confirmed in code (`spawnSync` timeout, 30 s wait race).
   - flaky_tests: third sample — executor 2× 80/0 + reviewer 1× 80/0, identical
     counts; gate subset 10/10 adds a fourth consistent sample.
   - repeated_interrupts: same multi-run evidence; no interrupt sensitivity observed.
   - dirty_worktree: PASS (`status --porcelain` empty).
   - stale_state: PASS (start `50786f9b` recorded + tag-verified; end observed
     `58f5950` on `engine-merge-train-t3-group`).

## Overfit/slop pass (`remove-ai-slops` + `programming` criteria, applied directly)

Both skills are unavailable in this environment (no skill files present;
toolkit `currentAttemptDir` is null, no ulw-loop plan), so the documented
criteria were applied directly to the diff, tests, and production code:

- The merge introduces **zero new tests and zero production edits relative to
  T9**: `diff d2b8464..HEAD` is empty across the whole tree. There are
  therefore no excessive/useless tests, no deletion-only tests, no tautological
  or implementation-mirroring tests, and no unnecessary extraction/parsing/
  normalization attributable to this todo. The +18 tests vs the 62-test
  baseline are T9's own (10 gate + 8 default-flip), already covered by the T9
  lane — not slop from this merge.
- No maintenance burden, false confidence, or scope drift created: single
  cherry-pick commit, no refactors, wrapper retained, shared branches untouched.
- Finding: NONE. No slop, no overfit.

Coverage note: no separate code-review-report artifact was supplied for this
todo (inputs were the plan + evidence file with its inline QA matrix §5), so
there was no external skill-perspective check to confirm. The direct check
above substitutes for it; the missing standalone review report is recorded as
an evidence gap, NOT a blocker (the plan requires evidence files, which exist).

## blockers

None. Every success criterion in todo 3 is met by reproduced evidence:
atomic group committed as specified (bridge+predicate 80/0), gate subset
10/10, exact degraded message with 0 spawns (scrubbed-PATH covered by suite
gate tests + fail-closed repro pattern; message bytes verified identical),
`OMO_NATIVE_RUN=0` restores wrapper (live repro), wrapper retained,
fail-closed codes preserved (17 `OMO_NATIVE_UNAVAILABLE` sites intact).

## Checked artifact paths

- `I:/migration/.omo/evidence/task-3-engine-merge-ship.md` (read fully first)
- `I:/migration/.omo/plans/engine-merge-ship.md` (todo 3 + success criteria)
- `I:/migration/Alwork-wt/engine-merge-train` @ `58f5950` (branch
  `engine-merge-train-t3-group`): `packages/web/server/lib/opencode/omo-bridge-runtime.js`,
  `packages/web/server/lib/opencode/omo-bridge-runtime.test.js`,
  `packages/web/server/lib/opencode/omo-bridge-live-predicates.test.js`,
  `packages/web/server/lib/opencode/DOCUMENTATION.md`,
  `.omo/evidence/task-9-omo-full-integration.md`
- Slice reference: `I:/migration-wt/omo-full-integration-wave1` @ `3c766d2`,
  same bridge path (via `git show`)
- T9 reference: `d2b8464` (branch `ulw/t9-native-flip`)
- Shared-branch check: `I:/migration/Alwork-wt/wave1` @ `50786f9b`
- Tag: `alwork-pre-T3` → `50786f9b`

## Exact evidence gaps (NOT blockers — no criterion requires them)

1. Executor's 5-scenario live QA driver (`C:/Users/dangq/AppData/Local/Temp/t3-qa/driver.mjs`)
   was deleted per its own cleanup receipts (verified absent is not re-checked;
   accepted) and therefore could not be re-executed verbatim. Mitigation: the
   reviewer reproduced the two load-bearing behaviors (rollback, fail-closed)
   with fresh minimal repros, re-ran the full suite (80/0) plus gate subset
   (10/10), and byte-verified all five messages; default-native receipt and
   cancel receipt are additionally covered by passing suite tests.
2. T9's static story (tsc exit 0, oxlint 1 pre-existing warning) was carried
   over by byte-identity rather than re-run (re-running would need new network
   installs for identical bytes — sound, and no criterion demands a re-run).
3. Baseline note: plan text "80/0 pre" is wrong by construction; observed 62/0
   pre → 80/0 post is correct and recorded. Suggest a plan-text correction so a
   future auditor does not read the 62 as a regression. NOTE only.
4. No standalone code-review-report artifact for this todo; direct reviewer
   check above stands in. NOTE only.
