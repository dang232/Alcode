# Task 1 evidence — engine-merge-ship merge-prep (dry-runs, tags, wave0 disposition)

Plan: `engine-merge-ship`, todo 1. Goal per brief: dry-run every lane, tag
per-step bases, prove B3 wave0 disposition, create the merge-train worktree.
NEVER merged anything; NEVER touched product files (git inspection + tags +
this evidence file only).

Code-home note (stored fact, re-proven): `I:/migration` base has no
`packages/` tree; live code is the Alwork line
`I:/migration/Alwork-wt/wave1` on branch `ui-alcore-readiness`. Alwork paths
are authoritative for engine files.

## 1. Per-lane dry-run table (git merge-tree, no working-tree contact)

Method per lane (exact invocation pattern, run in the owning repo):

    git merge-tree <merge-base> <target-HEAD> <lane-HEAD>

`git merge-tree` performs the three-way merge in memory and prints the
result; exit code + `<<<<<<<` marker scan is the clean/conflicting verdict.
No `git merge --no-commit` was needed, so no `git merge --abort` was needed
either — and §6 proves no merge is in progress anywhere. Product files
untouched.

Target for Alwork lanes T3,T6,T7,T8,T9: `ui-alcore-readiness`
`50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5`.
Target for migration lanes B1,B2: `main` at run start
`92accf0ad0718e0fca30bf9760e565f820bfd70f` (see §5: sibling todo 5
fast-forwarded `main` to `37509818` mid-run; dry-runs below are against the
documented pre-fast-forward base, which is the correct "pre" reference).

| Lane | Target | Lane HEAD | Merge-base | Diff stat (target...lane) | merge-tree verdict (exit + marker scan) |
| --- | --- | --- | --- | --- | --- |
| T6 dag-graduation (`ulw/t6-dag-graduation`) | 50786f9b | 489eaec0d2b8a2790ba38a7d37d8df522627655d | 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5 | 20 files, +456/-275 | `exit=0`, no `<<<<<<<` markers — CLEAN |
| T7 skills-catalog (`t7-skills-catalog`) | 50786f9b | ecf60fe52127dd2fa9bfbc189ffca63b56a1525c | 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5 | 8 files, +1381/-4 | `exit=0`, no markers — CLEAN |
| T8 engine-tab-stats (`t8-engine-tab-stats`) | 50786f9b | eba76080cfdececc205d345d577cfe0298421453 | 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5 | 6 files, +621/-0 | `exit=0`, no markers — CLEAN |
| T9 native-flip (`ulw/t9-native-flip`) | 50786f9b | d2b84647108ef7bdcdf6511ec8cd55748972389f | 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5 | 5 files, +790/-23 | `exit=0`, no markers — CLEAN |
| T3 worker-tests (`ulw/omo-full-integration-wave1-t3`) | 50786f9b | 65bbb0aaafa535438e324bd3c03abe70bd1ab10f (via 93dc0ecfd8b0f32a3b5b681ca15ae30a25d026b5) | b8ad614f7a367907fcb3d6f7546fd2191cd9a4d0 (one commit behind target — the known GAP-2 drift) | 3 files, +556/-35 | `exit=0`, **1 `<<<<<<<` block — CONFLICTING** in `packages/web/server/lib/opencode/DOCUMENTATION.md` (both sides edited the bridge-runtime doc line; `omo-invoker-worker.ts` merged cleanly — only the lane side changed it vs base — and `omo-invoker-worker.test.ts` is lane-added) |
| B1 wave1 (`ulw/omo-full-integration-wave1`) | 92accf0a | 37f604f39969d17f837f2c4539947f499cf4b2e9 | 92accf0ad0718e0fca30bf9760e565f820bfd70f (= target: pure fast-forward) | 14 files, +3295/-0 | `exit=0`, no markers — CLEAN |
| B2 t5-driver (`ulw/omo-full-integration-t5-driver`) | 92accf0a | 375098185cf318e8e987095339807d455aa1ca31 | 92accf0ad0718e0fca30bf9760e565f820bfd70f (= target: pure fast-forward) | 17 files, +4163/-0 | `exit=0`, no markers — CLEAN |

Exact dry-run invocations (all in owning repo, all `exit=0`):

    git -C I:/migration/Alwork merge-tree 50786f9b 50786f9b 489eaec0  # T6 clean
    git -C I:/migration/Alwork merge-tree 50786f9b 50786f9b ecf60fe5  # T7 clean
    git -C I:/migration/Alwork merge-tree 50786f9b 50786f9b eba76080  # T8 clean
    git -C I:/migration/Alwork merge-tree 50786f9b 50786f9b d2b84647  # T9 clean
    git -C I:/migration/Alwork merge-tree b8ad614f 50786f9b 65bbb0aa  # T3: 1 conflict block, DOCUMENTATION.md
    git -C I:/migration merge-tree 92accf0a 92accf0a 37f604f3         # B1 clean
    git -C I:/migration merge-tree 92accf0a 92accf0a 37509818         # B2 clean

(full hashes in the table above; short hashes here are unambiguous prefixes
of them.)

T3 conflict detail (only conflicting lane): merge-tree file headers were

    changed in both :: packages/web/server/lib/opencode/DOCUMENTATION.md
    added in remote :: packages/web/server/lib/opencode/omo-invoker-worker.test.ts

with exactly 1 `<<<<<<< .our` block (marker count = 1). Both sides added a
`omo-bridge-runtime.js` doc line (ours: Slice-E gate wording from 50786f9;
theirs: worker-test-era wording). Small doc hunk; the real prod file
`omo-invoker-worker.ts` auto-merges. Flagged for the todo-3 atomic group —
expected, not a blocker for tagging.

## 2. Per-step tags (lightweight, never force-moved)

Pre-check (both empty before creation — recorded):

    git -C I:/migration/Alwork tag --list "alwork-pre-*"   # (no output)
    git -C I:/migration tag --list "migration-pre-*"       # (no output)

Created (exact invocations; one per tag, all silent success, no output =
created):

    git -C I:/migration/Alwork tag alwork-pre-T1 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork tag alwork-pre-T2 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork tag alwork-pre-T3 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork tag alwork-pre-T4 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork tag alwork-pre-T5 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork tag alwork-pre-T6 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork tag alwork-pre-T7 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork tag alwork-pre-T8 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork tag alwork-pre-T9 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration tag migration-pre-B1 92accf0ad0718e0fca30bf9760e565f820bfd70f
    git -C I:/migration tag migration-pre-B2 92accf0ad0718e0fca30bf9760e565f820bfd70f

Tag targets verified (`rev-parse` returns the base hash for each sampled
tag):

    git -C I:/migration/Alwork rev-parse alwork-pre-T1 alwork-pre-T9
    -> 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5 (x2)
    git -C I:/migration rev-parse migration-pre-B1 migration-pre-B2
    -> 92accf0ad0718e0fca30bf9760e565f820bfd70f (x2)

Mapping rationale: `alwork-pre-T1..T9` all mark the single shared pre-merge
base of the Alwork merge train (`ui-alcore-readiness` 50786f9b);
`migration-pre-B1/B2` mark the pre-fast-forward `main` (92accf0a) per the
plan. No tag name existed before; nothing was force-moved. `main` has since
moved to 37509818 via sibling todo 5 (§5) — tags stay at the pre base by
design; any re-based dry-run need is recorded in §5, not re-tagged.

## 3. B3 wave0 disposition — EXCLUDED, 0 ahead (proof)

B3 = branch `ulw/unified-auth-core-wave0` =
`020849ca40c88d72475f7766116eeda924c908f5` (worktree
`I:/migration-wt/unified-auth-core-wave0`, HEAD identical). B3 content is
NEVER merged (plan guardrail).

Exact commands + verbatim output (run late in the session, against current
`main` = 37509818 post sibling fast-forward):

    $ git -C I:/migration rev-list --count main..ulw/unified-auth-core-wave0
    0
    $ git -C I:/migration rev-list --count ulw/unified-auth-core-wave0..main
    6
    $ git -C I:/migration merge-base main ulw/unified-auth-core-wave0
    020849ca40c88d72475f7766116eeda924c908f5
    $ git -C I:/migration rev-list --left-right --count main...ulw/unified-auth-core-wave0
    6	0
    $ git -C I:/migration log --oneline ulw/unified-auth-core-wave0..main
    3750981 feat(engine): loop session driver
    37f604f docs(engine): T3 invoker worker test evidence
    3c766d2 feat(engine): parity gate with wrapper fallback
    36df59e feat(engine): live Slice-E predicate sources
    69809e1 feat(engine): loop-status caller with empty-state UI
    92accf0 feat(migration): batched cutover + rollback

Disposition: **0 ahead / 6 behind** — satisfies the required `0 ahead /
behind >= 1`. Merge-base equals the B3 tip, i.e. B3 is a strict ancestor of
`main`; there is nothing in B3 that `main` lacks. EXCLUDED from all merges.

## 4. Merge-train worktree (for later file-merge lanes)

Absolute path: `I:/migration/Alwork-wt/engine-merge-train`

Exact invocation (path did not exist; fresh add):

    git -C I:/migration/Alwork worktree add I:/migration/Alwork-wt/engine-merge-train 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    -> "HEAD is now at 50786f9 feat(engine): live Slice-E predicate sources"

Verified:

    git -C I:/migration/Alwork-wt/engine-merge-train rev-parse HEAD
    -> 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    git -C I:/migration/Alwork-wt/engine-merge-train status --porcelain
    -> (empty: clean)

Detached HEAD at the train base by design (later lanes check out branches
onto it). Registered in `worktree list --porcelain` (see §7 QA2).

## 5. Stale-state check (adversarial class a) — base moved mid-run, recorded

End-of-run re-`rev-parse` of the two key bases:

    git -C I:/migration/Alwork rev-parse ui-alcore-readiness
    -> 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5 (UNCHANGED from run start)
    git -C I:/migration rev-parse main
    run start -> 92accf0ad0718e0fca30bf9760e565f820bfd70f
    run end   -> 375098185cf318e8e987095339807d455aa1ca31 (MOVED)

The `main` move is the expected sibling todo-5 fast-forward (B1+B2 = exactly
`92accf0a..37509818`, 6 commits, matching the B3-behind list in §3; sibling
evidence `.omo/evidence/task-5-engine-merge-ship.md` present in the main
checkout). Consequences handled without re-tagging (tags are pre-markers by
design):

- B1/B2 dry-runs in §1 were computed against the documented pre base
  92accf0a — still the correct "pre" reference; post-fast-forward they are
  already-contained (merge-base == old main, and new main == B2 tip), so no
  re-based dry-run is needed. Recorded here instead of re-run per the brief.
- B3 proof in §3 was taken against the NEW main (0 ahead / 6 behind) — the
  stronger, current claim.
- Alwork train base never moved; all Alwork dry-runs, tags, and the worktree
  stand as computed.

Ruled out with reason: malformed_input (no external inputs taken — all refs
are literal hashes/branch names from the plan, reverified by rev-parse),
prompt_injection (same — no untrusted text consulted), cancel_resume (no
resumable flows; single pass), hung_commands (every git command wrapped with
a 120s kill deadline; none hit it), flaky_tests (no tests in this todo),
repeated_interrupts (none).

## 6. Cleanup receipts — every dry-run aborted / no merge in progress

All lane verdicts came from `git merge-tree` (in-memory; nothing to abort).
`git rev-parse MERGE_HEAD` was run in all 11 repos/worktrees; every one
failed with exit 1 and `fatal: ambiguous argument 'MERGE_HEAD': unknown
revision or path not in the working tree` (i.e. NO merge in progress):

- I:/migration/Alwork — exit 1, no MERGE_HEAD
- I:/migration/Alwork-wt/wave1 — exit 1, no MERGE_HEAD
- I:/migration/Alwork-wt/t6-dag-graduation — exit 1, no MERGE_HEAD
- I:/migration/Alwork-wt/t7-skills-catalog — exit 1, no MERGE_HEAD
- I:/migration/Alwork-wt/t8-engine-tab-stats — exit 1, no MERGE_HEAD
- I:/migration/Alwork-wt/t9-native-flip — exit 1, no MERGE_HEAD
- I:/migration/Alwork-wt/engine-merge-train — exit 1, no MERGE_HEAD
- I:/migration — exit 1, no MERGE_HEAD
- I:/migration-wt/omo-full-integration-wave1 — exit 1, no MERGE_HEAD
- I:/migration-wt/omo-t5-driver — exit 1, no MERGE_HEAD
- I:/migration-wt/unified-auth-core-wave0 — exit 1, no MERGE_HEAD

Status receipts (`git status --porcelain` per repo; NOT mine unless noted):

- t6/t7/t8/t9/engine-merge-train worktrees: empty (clean) ✓
- I:/migration-wt/omo-t5-driver: empty (clean) ✓
- I:/migration/Alwork-wt/wave1: 12 pre-existing untracked entries
  (`?? .omo/evidence/task-41/42/48/49…`, `?? packages/package.json`) —
  present identically in the FIRST status read before any write by this task;
  untouched.
- I:/migration/Alwork: `?? config/` (pre-existing untracked; untouched).
- I:/migration-wt/omo-full-integration-wave1: `M .omo/evidence/task-3-…`
  (2 tracked), `??` gate-review files + `?? Alwork/` — pre-existing / other
  agents' activity (incl. sibling todo-2 rebase lane); untouched by this
  task.
- I:/migration-wt/unified-auth-core-wave0: 3 pre-existing untracked entries
  (`?? .omo/drafts/unified-auth-core.md`, `?? .omo/evidence/`,
  `?? .omo/plans/unified-auth-core.md`); untouched.
- I:/migration: many tracked modifications + untracked files — pre-existing
  working-tree state plus sibling todo-5's evidence file and fast-forward;
  untouched by this task (this task's only write in this repo is THIS
  evidence file, the sanctioned artifact).

No product file was modified by this task in any repo (only 11 lightweight
tags + 1 worktree registration + this file).

## 7. Manual-QA channel (git CLI, full stdout)

PASS = all expected tags listed + engine-merge-train entry present. Both
hold.

### QA1: `git -C I:/migration/Alwork-wt/wave1 tag --list "alwork-pre-*"`

Full stdout:

    alwork-pre-T1
    alwork-pre-T2
    alwork-pre-T3
    alwork-pre-T4
    alwork-pre-T5
    alwork-pre-T6
    alwork-pre-T7
    alwork-pre-T8
    alwork-pre-T9

9/9 present — PASS.

### QA2: `git -C I:/migration/Alwork worktree list --porcelain`

Full stdout:

    worktree I:/migration/Alwork
    HEAD e06417ab3ee18f9f28360143d61721aba3025cab
    branch refs/heads/alwork-ide-map

    worktree I:/migration/Alwork-wt/engine-merge-train
    HEAD 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    detached

    worktree I:/migration/Alwork-wt/t6-dag-graduation
    HEAD 489eaec0d2b8a2790ba38a7d37d8df522627655d
    branch refs/heads/ulw/t6-dag-graduation

    worktree I:/migration/Alwork-wt/t7-skills-catalog
    HEAD ecf60fe52127dd2fa9bfbc189ffca63b56a1525c
    branch refs/heads/t7-skills-catalog

    worktree I:/migration/Alwork-wt/t8-engine-tab-stats
    HEAD eba76080cfdececc205d345d577cfe0298421453
    branch refs/heads/t8-engine-tab-stats

    worktree I:/migration/Alwork-wt/t9-native-flip
    HEAD d2b84647108ef7bdcdf6511ec8cd55748972389f
    branch refs/heads/ulw/t9-native-flip

    worktree I:/migration/Alwork-wt/wave1
    HEAD 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    branch refs/heads/ui-alcore-readiness

    worktree I:/migration-wt/omo-full-integration-wave1/Alwork
    HEAD 50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5
    detached

`engine-merge-train` entry present at 50786f9b — PASS.

## Risks / notes for downstream todos

1. T3 has 1 real (doc-only) conflict hunk vs the train base
   (`DOCUMENTATION.md` bridge-runtime line); todo 2's rebase must resolve it
   with the T2-contract side winning per plan. Prod files merge clean.
2. Sibling todo 5 already fast-forwarded migration `main` to 37509818 during
   this run; downstream todos should treat 37509818 as `main`, with
   `migration-pre-B1/B2` = 92accf0a as the pre marker.
3. T9 vs T1-slice bridge overlap is NOT visible in these pairwise dry-runs
   (each lane is clean against the base alone); the triple overlap resolves
   in todo 3's atomic group on the train — no conclusion drawn here beyond
   "clean vs base".
