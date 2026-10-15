# F4 Gate Review — engine-merge-ship: Ideal-state fidelity

- Gate: F4. Reviewer task: st_01a12ad6. Date: 2026-10-11.
- Method: read-only. Re-read plan Scope (IS-1..IS-5) + Success table + task evidence
  1,2,3,5,6,7,10,11,12,13,14 + gate reviews for tasks 2,3,4,5,6,8,9,10,11,12,13,14;
  ran bounded git/file probes from the final train tree (no writes, no builds,
  no launches — live packaged proofs are taken from the task-13/14 evidence and
  their independent gate-review reproductions, not re-run here).
- Final tree under test: `I:/migration/Alwork-wt/engine-merge-train`,
  branch `engine-merge-train-t3-group`, HEAD `b4bbda8`
  (`fix(engine): packaged skill install resolution`) atop `7a3ba91`, clean status.

## Verdict: APPROVE (confidence 0.9)

Every IS row has a delivering todo AND a proving QA with recorded green evidence;
the one historical FAIL (row 7) was fixed by todo 14 and independently re-proved
live byte-for-byte (gate-review APPROVE). The 0.1 deduction is the F3 dependency
(see Gaps): no F1–F4 final-gate artifacts exist yet, so real-manual-QA (F3) is
flagged UNKNOWN per the brief — F4 does not duplicate it.

## Row findings

### IS-1 — One packaged build, every surface works — PASS
- Delivering: todos 3, 6, 7, 8, 12, 13 + row-7 fix 14. Proving: task-13
  click-through QA + task-14 live re-proof + task-14 gate-review APPROVE (confirmed).
- Rows 1–6, 8–10 PASS on the `7a3ba91` dist (task-13 evidence; task-13 gate review
  independently reproduced the 8/9 + row-7-FAIL claim, byte counts 166/377/1092/15822
  matching). Row 7 then FIXED: on the fresh `b4bbda8` dist, default mode (no env
  override), `POST install-engine git-master` → 200/264B, SKILL.md 28779 B on disk,
  listed (LIST 330070 B containsGitMaster), unknown → 400 `missing_skill`, `../evil` →
  400 `invalid_skill_name` — executor bodies reproduced byte-for-byte by the gate
  reviewer (HEALTH 1882, CATALOG 15418, INSTALL 264, UNKNOWN 142, EVIL 148).
- Carry-over argument verified by me (not taken on prose): `git diff 7a3ba91..b4bbda8
  --stat` = exactly the 8 fix files (electron package.json, 4 engine skill TS files,
  1 new guard test, engine-skills.js + test). No bridge/worker/driver/pane/tab/alias
  file changed, so rows 1–6, 8–10 proofs carry to the shippable dist; the dist exe hash
  changed (`8c1e79b4…` → `c0bce68d…`) proving the rebuild actually shipped, with
  `resources/omo-engine` vendored and the fixed import line present in dist.
- F3 note: packaged click-through above is agent-executed per plan; human manual QA
  (F3) has no artifact yet — flagged UNKNOWN, not a shortfall.

### IS-2 — /ulw and #ulw resolve to engine workflows — PASS
- Delivering: todo 11 (2-file commit `2fa7455`, clean merge `37e19e4`). Proving:
  task-11 API proofs + task-11 gate-review APPROVE + task-13 row 10 live on packaged build.
- `GET /api/config/commands/ulw` → 200 project scope; `GET /api/config/snippets/ulw`
  → 200 alias `["ulw"]`; `POST expand "run #ulw now"` → 200 with real expansion.
  Bare `ulw` unchanged: commit touches only the 2 alias files, no interceptor/router/
  prompt file (plan will-NOT-do honored).

### IS-3 — Every lane's verified behavior preserved — PASS
- Delivering: todos 2, 3, 10. Proving: rebase + atomic-group + full-canary evidence,
  gate reviews T2/T3/T10 (all APPROVE).
- Rebase: both worker hunks automerged (base untouched those files), T2-contract side
  won the one DOC hunk, worker 27/27 twice on rebased tree; no assertion weakened.
- Atomic group: bridge+predicate 80/0 twice, gate subset 10/10, forced-failure exact
  message with 0 spawns, rollback `OMO_NATIVE_RUN=0` to wrapper. Byte-identity: every
  executable gate line identical vs slice `3c766d2` (comment-only delta); the five
  degraded templates verified present in the FINAL tree file by me
  (5 `Native runner unavailable` templates, `OMO_NATIVE_UNAVAILABLE` ×17).
- Canary: full battery green on merged tree (bridge 80/0, worker 27/0 ×2, loop/driver
  13, skills 57/57 → 58/58 after fix, UI 4/4, pane/handlers/registry 36/0). No red, no
  weakened test (pre-existing unrelated MCP-suite failures in skills-loader-core full
  run documented as out-of-scope, untouched areas).

### IS-4 — Wrapper retained until readiness gate clears — PASS
- Delivering: todo 3. Proving: task-3 wrapper/rollback QA + task-13 row 9 on packaged build.
- Train log `50786f9b..HEAD` contains no deletion commit; rollback path textually present
  in final `omo-bridge-runtime.js` (`OMO_NATIVE_RUN` + wrapper branch, verified by me);
  row 9 live PASS (wrapper argv, real child run, receipt) + row 4 exact-message fail-closed
  with 0 spawns. T9 S7 NOT-READY carried as committed evidence, never deleted.

### IS-5 — Nothing outside lanes regressed — PASS
- Delivering: todos 1, 5. Proving: task-1 + task-5 evidence, gate reviews T1/T5 APPROVE.
- Re-verified by me: 9/9 `alwork-pre-T*` tags present; shared branches at plan SHAs
  (`ui-alcore-readiness` 50786f9b, T9 d2b8464, T7 ecf60fe5, T6 489eaec0, T8 eba7608);
  migration `main` linear (`92accf0a..37509818`, exactly the 5 FF commits);
  B3 wave0 `0 ahead`, tip `020849c` unmoved, strict ancestor of main — excluded, never
  merged. Overall diff `50786f9b..HEAD` = 52 files; the only non-obvious paths
  (`bun.lock`, `packages/dag-pane/*`, `packages/extensions/README.md`) all attribute to
  the in-range T6 lane commit `489eaec` — no unrelated file touched.

## Disclosed limitations — plan-consistent, NOT shortfalls
- Wrapper retained → required by must-NOT-have (deletion is a gated follow-up). ✓
- Non-git-master engine skills listed-as-unavailable-with-reason (never-vendored
  `shared-skills`, bun-only text import) → required by todo-14 must-NOT-do (no loader
  redesign); row 7 needs only git-master. ✓
- Unsigned unpacked build, no installer → plan decision (user answer), no cert spend. ✓
- No bare prefix-less `ulw` → plan will-NOT-do (model-owned). ✓

## Shortfalls
None.

## Gaps (observations, not blockers)
1. F3 (Real manual QA) status UNKNOWN: no `engine-merge-ship-F*.md` final-gate artifacts
   exist in `.omo/evidence/` at review time. F4 does not duplicate F3; IS-1 approval rests
   on the agent-executed packaged click-through + independent gate reproductions.
2. Task 7 has executor evidence with green smokes (vitest 57/57, driver 10/0) but no
   standalone gate-review file; coverage is subsumed by the T10 canary and the T14 gate
   reviewer's independent vitest 58/58 run — recorded, not a finding.
