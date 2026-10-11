# Task 5 evidence — engine-merge-ship (B1+B2 fast-forward onto main)

Date: 2026-10-11. Repo: I:/migration. History ops only. No rebase, no force-push, no B3 content, Alwork branches untouched.

## 1. Pre-state (before any merge)

```
$ git -C I:/migration log --oneline -8
92accf0 feat(migration): batched cutover + rollback
020849c chore(plan): record alcore-auth-browser-handoff completion
86ef001 docs(auth): record implemented handoff and supersession
5731a22 Initial commit
$ git -C I:/migration rev-parse HEAD
92accf0ad0718e0fca30bf9760e565f820bfd70f
```

Pre-state worktree was ALREADY DIRTY (pre-existing, not caused by this task):
tracked: `M .omo/boulder.json`, `M .omo/notepads/alcore-unified-auth-libre-tokenpanel/decisions.md`,
`M .omo/research/task15/{dashboard-b,legacy-c,provision-b,provision-c}.json`,
`M .omo/research/task18/mapping-snapshot-task18-preserve-proof{,-pre}.json`,
`M .omo/research/task28/mapping-snapshot-task28-rollback-proof-{pre,restore-pre,restored}.json`,
`M .omo/research/task28/scenario-b-bad-link-repair.log`,
`D .omo/run-continuation/ses_f01292b7dffe9QwUjG4uOfV3SI.json`,
`M .omo/run-continuation/ses_f01dfadc8ffeuRucqpfdqXsbej.json`, `M .omo/ulw-execute/ledger.jsonl`,
plus extensive pre-existing untracked files (`?? .omo/evidence/` collapsed, `?? Alwork/`, logs, etc.).
Worktrees (one shared object store): main=92accf0, ulw/omo-full-integration-wave1=37f604f,
ulw/omo-full-integration-t5-driver=3750981, ulw/unified-auth-core-wave0=020849c.

## 2. Fast-forward eligibility table (all checked BEFORE merging)

| head | rev-list --count main..head | merge-base --is-ancestor main head |
|---|---|---|
| 69809e1c (B1 w1) | 1 | exit 0 (eligible) |
| 36df59ea (B1 w2) | 2 | exit 0 (eligible) |
| 3c766d23 (B1 w3) | 3 | exit 0 (eligible) |
| 37f604f3 (B1 w4) | 4 | exit 0 (eligible) |
| 37509818 (B2 T5) | 5 | exit 0 (eligible) |

Chain: `git log --oneline 92accf0a..37509818` = 3750981, 37f604f, 3c766d2, 36df59e, 69809e1 (in order).
All heads are descendants of main — no rebase needed, nothing BLOCKED.
Merge/file overlap check: `git diff --name-only 92accf0a..37509818` touches only
`.omo/evidence/task-{1,2,3,4,5}-omo-full-integration.md` (+1 transcript json) and new
`packages/...` files — zero overlap with the dirty tracked paths, and no filename
collision with the untracked `.omo/evidence/` siblings. Safe to --ff-only over dirty tree.

## 3. Merge output (full stdout, in order)

```
$ git merge --ff-only 69809e1c
Updating 92accf0..69809e1
Fast-forward
 .omo/evidence/task-2-omo-full-integration.md       | 105 ++++++++++++
 .../plugin/components/ulw-loop/src/ledger.ts       |  64 +++++++
 .../plugin/components/ulw-loop/src/plan-io.ts      |  74 +++++++++
 .../components/sections/engine/EnginePage.test.ts  |  41 +++++
 .../src/components/sections/engine/EnginePage.tsx  |  70 ++++++++
 .../omo-invoker-worker.loop-status.test.ts         | 183 +++++++++++++++++++++
 .../web/server/lib/opencode/omo-invoker-worker.ts  | 144 ++++++++++++++++
 7 files changed, 681 insertions(+)

$ git merge --ff-only 36df59ea
Updating 69809e1..36df59e
Fast-forward
 .omo/evidence/task-4-omo-full-integration.md | 117 +++++++++++++++++++++++++++
 1 file changed, 117 insertions(+)

$ git merge --ff-only 3c766d23
Updating 36df59e..3c766d2
Fast-forward
 .omo/evidence/task-1-omo-full-integration.md       |  190 ++++
 .../server/lib/opencode/omo-bridge-fixture.json    |   98 ++
 .../web/server/lib/opencode/omo-bridge-runtime.js  | 1084 ++++++++++++++++++++
 .../server/lib/opencode/omo-bridge-runtime.test.js |  961 +++++++++++++++++
 4 files changed, 2333 insertions(+)

$ git merge --ff-only 37f604f3
Updating 3c766d2..37f604f
Fast-forward
 .omo/evidence/task-3-manualqa-transcript.json |  58 ++++++++++++++
 .omo/evidence/task-3-omo-full-integration.md  | 106 ++++++++++++++++++++++++++
 2 files changed, 164 insertions(+)

$ git merge --ff-only 37509818
Updating 37f604f..3750981
Fast-forward
 .omo/evidence/task-5-omo-full-integration.md       | 183 +++++++++
 .../server/lib/opencode/omo-loop-driver.test.ts    | 230 +++++++++++
 .../web/server/lib/opencode/omo-loop-driver.ts     | 455 +++++++++++++++++++++
 3 files changed, 868 insertions(+)
```

No conflicts, no prompts, no force. Each merge completed in one shot (no git command exceeded its deadline; nothing killed).

## 4. Post-state

```
$ git -C I:/migration rev-parse HEAD
375098185cf318e8e987095339807d455aa1ca31
$ git -C I:/migration log --oneline -8
3750981 feat(engine): loop session driver
37f604f docs(engine): T3 invoker worker test evidence
3c766d2 feat(engine): parity gate with wrapper fallback
36df59e feat(engine): live Slice-E predicate sources
69809e1 feat(engine): loop-status caller with empty-state UI
92accf0 feat(migration): batched cutover + rollback
020849c chore(plan): record alcore-auth-browser-handoff completion
86ef001 docs(auth): record implemented handoff and supersession
$ git -C I:/migration merge-base --is-ancestor 92accf0a HEAD  -> exit 0 (LINEAR)
```

## 5. B3 exclusion proof (wave0 untouched)

- `git rev-list --count main..020849ca` = 0 (B3 head contributes nothing new).
- `git rev-list --count 020849ca..main` = 1 (only 92accf0 sits atop it; post-merge: 6).
- `git merge-base --is-ancestor 020849ca main` = exit 0 (B3 already an ancestor via the base).
- `git log --oneline -3 ulw/unified-auth-core-wave0` still = 020849c / 86ef001 / 5731a22 — branch unmoved.
- No `git` command in this task referenced the wave0 worktree except read-only log/rev-list. Nothing merged from B3.

## 6. QA channel stdout

Exact: `git -C I:/migration log --oneline -8 && git -C I:/migration status --porcelain && git -C I:/migration merge-base --is-ancestor 92accf0a HEAD && echo LINEAR-OK`
Result: 5 commits in order atop 92accf0a: YES. LINEAR-OK printed: YES.
Status empty: NO — pre-existing dirt unchanged by this task (same 15 tracked mod/del entries
before and after; untracked set identical modulo display collapse of `.omo/evidence/` now
containing tracked files). The merge added only the 17 committed files listed above.
DEVIATION recorded: strict "empty status" PASS criterion cannot hold because the worktree was
dirty before this task started; the history operation itself is clean and linear.

## 7. HEAD before/after (stale-state guard)

- Before: 92accf0ad0718e0fca30bf9760e565f820bfd70f
- After: 375098185cf318e8e987095339807d455aa1ca31
- Delta: exactly the 5 commits (rev-list 92accf0a..HEAD = 5: 69809e1, 36df59e, 3c766d2, 37f604f, 3750981).

## 8. Cleanup receipts

- `git rev-parse MERGE_HEAD` fails (exit 128, "unknown revision") — no leftover merge locks.
- No temp files created (no stash, no patch files, no remote additions, no fetch).
- Artifact written: this file (untracked, inside already-untracked `.omo/evidence/`; adds no new porcelain line).

## 9. Adversarial classes ruled out

- stale_state: HEAD captured before AND after; delta exactly 5 commits.
- dirty_worktree: pre-existing dirt documented; merge paths proven disjoint; tracked dirt byte-identical before/after.
- misleading_success_output: full merge stdout quoted in section 3 (5 Updating/Fast-forward blocks).
- N/A with reasons: malformed_input (SHAs resolved via cat-file + worktree list), prompt_injection (no external input acted on),
  cancel_resume (single uninterrupted session), hung_commands (all git CLIs returned well under deadline),
  flaky_tests (no tests involved — history-only task), repeated_interrupts (none).
