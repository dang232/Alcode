# Task 2 evidence — engine-merge-ship: rebase T3 worker-tests onto 50786f9b

- Worktree: `I:/migration-wt/omo-full-integration-wave1/Alwork`, branch `ulw/omo-full-integration-wave1-t3`
- Rebase target base: `50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5` (live Slice-E predicate sources)
- T2 contract reference read before editing: `I:/migration-wt/omo-full-integration-wave1/packages/web/server/lib/opencode/omo-invoker-worker.ts` (commit `69809e1`, loop-status `--session`/`--limit`/`--loop-src` flag semantics)
- Worker test file: `packages/web/server/lib/opencode/omo-invoker-worker.test.ts` (27 `it` blocks)

## 1. Baseline on UNCHANGED branch (HEAD `65bbb0aa`, base `b8ad614f`)

Command: `bun test packages/web/server/lib/opencode/omo-invoker-worker.test.ts` (cwd = worktree above)

- Exit code: 0, time 4.16s, bun v1.4.2
- `27 pass, 0 fail, 121 expect() calls, Ran 27 tests across 1 file`
- Verdict: green baseline, no FINDINGS, no test edits needed or made.

## 2. Rebase method

`git rebase --onto 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5 b8ad614f7a367907fcb3d6f7546fd2191cd9a4d0`
(replay of the 2 T3 commits onto the target base; `--continue` steps run with `GIT_EDITOR=true`, no interactive editor.)

Result:

- `bcb9cf4` test(engine): invoker worker unit coverage (ex-`93dc0ecf`)
- `b119cfd` test(engine): align worker flags to T2 loop-status contract (ex-`65bbb0aa`)
- `git merge-base --is-ancestor 50786f9b HEAD` → YES; `git merge-base HEAD 50786f9b` = `50786f9b`
- `git diff 65bbb0aa..HEAD --stat` = exactly the `50786f9b` payload (evidence doc, `DOCUMENTATION.md` 1 line, `omo-bridge-live-predicates.test.js`, `omo-bridge-runtime.js`); worker `.ts` + `.test.ts` byte-identical to original T3 (empty diff). No trunk touched, no merge commit created.

## 3. Per-hunk resolution list

`50786f9b` does not touch the worker files, so both worker hunks automerged at both replay steps — no manual resolution, T2 semantics (commit `65bbb0aa`) preserved verbatim:

- Step 1 (`93dc0ecf` replay): `omo-invoker-worker.test.ts` (new file, automerge) + `omo-invoker-worker.ts` (automerge) — winning side: T3, why: target base has no competing change to these files.
- Step 1 conflict: `DOCUMENTATION.md` line 12 (over-long `omo-bridge-runtime.js` bullet) — both sides appended different sentences to the same line (507: Live Slice-E T4 sentence; 93: worker `--loop-status` sentence with pre-T2 flag names). Resolution: kept 507's full line, inserted 93's worker clause + worker-test-list extension at its original anchor — winning side: both (mechanical union), why: the two additions describe disjoint features; dropping either would lose true documentation.
- Step 2 (`65bbb0aa` replay): worker files automerged again — winning side: T3/T2-contract, why: no competing change on target.
- Step 2 conflict: same `DOCUMENTATION.md` line — 65's hunk renames the worker clause flags to the T2 contract. Resolution: replaced only the old-flag clause `(bounded --ledger-limit, optional --session-id, …)` with 65's `(T2 contract: --session/--limit/--loop-src, limit clamped 1..500 default 50, … exit 0)`, keeping 507's Slice-E sentence and the combined test list — winning side: T2-contract (65), why: task directive that T2 flag semantics win on drift. Final line verified: each of `Live Slice-E sources`, `T2 contract`, both test filenames appears exactly once; joints read as continuous prose.

No assertions weakened (test file untouched by resolution), no prod code hand-edited (all prod state comes from replayed commits).

## 4. Verification runs on REBASED tree (HEAD `b119cfd`)

Command (both runs): `bun test packages/web/server/lib/opencode/omo-invoker-worker.test.ts`

- Run 1: exit 0 — `27 pass, 0 fail, 121 expect() calls, Ran 27 tests across 1 file. [3.65s]`
- Run 2: exit 0 — `27 pass, 0 fail, 121 expect() calls, Ran 27 tests across 1 file. [3.73s]`
- Counts match across runs (flaky-test probe: pass). No reds → no prod-drift findings, no prod fixes, no new tests (existing suite already covers the behavior; a regression would fail loudly).

Full per-test tail quoted in the task transcript (all 27 `(pass)` lines, both runs); tail summary lines above are the recorded counts + exit codes.

## 5. Manual-QA repro (bun CLI, single named test, rebased tree)

Invocation: `bun test packages/web/server/lib/opencode/omo-invoker-worker.test.ts --test-name-pattern "reports plan plus the full default tail"`

Output:

```text
packages\web\server\lib\opencode\omo-invoker-worker.test.ts:
(pass) worker --loop-status (T2 contract: --session/--limit, clamp-default-50, degrade exit 0) > reports plan plus the full default tail with null session [111.40ms]

 1 pass
 26 filtered out
 0 fail
 10 expect() calls
Ran 1 test across 1 file. [147.00ms]
```

PASS = exit 0 with the named assertion passing.

## 6. Adversarial-class receipts

- (a) stale_state — `git rev-parse 50786f9b` at start: `50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5`; at end: identical. Match.
- (b) dirty_worktree — final `git status --short --branch`: `## ulw/omo-full-integration-wave1-t3` with zero modified/untracked entries; no stash; no rebase state dirs (`.git/worktrees/Alwork/rebase-merge` and `rebase-apply` absent).
- (c) misleading_success_output — full tails quoted above for baseline, run 1, run 2, and QA repro (counts + exit codes, not summaries alone).
- (d) flaky_tests — two full runs, `27 pass / 0 fail / 121 expects` both times.
- Ruled out with reasons: malformed_input (inputs are repo commits/flags, all `rev-parse` verified valid objects); prompt_injection (no external/untrusted input consumed — only git objects and test output); cancel_resume (single continuous session, rebase completed, branch updated); hung_commands (every `bun test` finished in <5s, far under the 300s kill threshold — no kill needed).

## 7. Cleanup

- No temp dirs: OS temp dir contains zero `omo-worker-*` leftovers (suite `afterEach` removes fixture dirs and asserts removal; 27/27 passing proves it).
- No PIDs/servers: no servers were ever started (suite spawns only short-lived worker processes, reaped by `afterEach` SIGKILL sweep); no background sessions created for this task.
- No trunk merges, no other branches touched.
