# F1 Plan Compliance Audit — engine-merge-ship

- Gate: F1. Verdict: **APPROVE**. Confidence: 0.93.
- Auditor role: independent; did not implement this work. Every claim below was checked against the plan file, the ledger (`I:/migration/.omo/ulw-execute/ledger.jsonl`, 63 lines, all events read), all 14 evidence files plus 13 gate reviews, and live `git` state in both repos.
- Train HEAD audited: `b4bbda8` on `engine-merge-train-t3-group`. Migration HEAD: `37509818`.

## 1. GAP/IS coverage (Success criteria table 1:1)

| IS | Delivering todos (all [x]) | Proving QA | Result |
|----|---------------------------|------------|--------|
| IS-1 | 3, 6, 7, 8, 12, 13 (+14 row-7 fix) | packaged click-through 9/9 | PASS — rows 1–6, 8–10 PASS on 7a3ba91 dist; row 7 re-proven 200 + 28779B SKILL.md on b4bbda8 dist; other rows' code paths byte-identical between dists (diff = 8 skill/packaging files only), verifier-confirmed |
| IS-2 | 11 | /ulw 200 project-scoped + menu; #ulw snippet alias 200 + expand 200 | PASS — both files in tree at b4bbda8 |
| IS-3 | 2, 3, 10 | rebase clean (27/27 x3, byte-identical) + atomic group 80/0 x3 + full canary battery green | PASS |
| IS-4 | 3 | wrapper fallback path retained, OMO_NATIVE_RUN=0 rollback repro live | PASS — no deletion commit anywhere in 50786f9..b4bbda8 |
| IS-5 | 1, 5 | 9 alwork-pre-T* tags at 50786f9b + 2 migration-pre-B* tags verified; shared branches untouched; wave0 excluded | PASS |

GAP mapping: GAP-1 ← 1,3,4,5,6,7,8,9,10; GAP-2 ← 2,3; GAP-3 ← 12,13,14; GAP-4 ← 11; GAP-5 ← 1,5. All delivering todos checked.

## 2. Guardrails

- No engine behavior change beyond conflict resolution: PASS. T3 group `diff d2b8464..HEAD` empty; gate block sha256-identical (124 lines); T2 port blobs byte-identical (sha256 match b119cfd); T5 port byte-exact; T6/T7/T8 diffs EMPTY on lane paths; row-7 fix minimal (8 files +122/−14, explicit `.ts` extensions + vendoring + guard test, no logic change).
- Wrapper retained: PASS. No deletion commit; rollback repro live (task-3 evidence + gate review).
- No signed installer / cert spend: PASS. Unsigned unpacked build only; `dist/` gitignored; electron `package.json` delta is `extraResources` vendoring, not signing.
- No bare-ulw interceptor / model-prompt rule: PASS. Diff 50786f9..b4bbda8 touches no `commands.js`, `snippets.js`, or prompt files; alias is two data files only.
- No auth/credential surfaces: PASS. `git log --grep=auth -i` over train range empty; no auth files in diff.
- No B3 content merged: PASS. `git rev-list HEAD..020849ca --count` = 0 (0-ahead proven); B3 branch unmoved; diff file set is engine-lane-scoped only (52 files).
- No prose-grep/wording-pin QA: PASS. Machine markers / exit codes / byte counts asserted throughout; task-9 gate review explicitly notes zero prose pins.

## 3. Commit strategy

- One commit per todo on merge line, `--no-ff`, one per lane, never squashed: PASS. First-parent chain: 58f5950 (T4+T1+T9 atomic) → 7b3a0ce (T2) → bca06f4 (T5) → 0789351 (T6) → 37e19e4 (alias) → d74a9d5 (T8) → 84e1a51 (T7) → 7a3ba91 (T3 canary) → b4bbda8 (row-7 fix). Every merge has 2 parents, 0 conflicts recorded.
- Per-step tags present: PASS. `alwork-pre-T1..T9` all at 50786f9b (spot-checked T3/T9); `migration-pre-B1/B2` present.
- Evidence committed alongside: **WARN (non-blocking)** — new `task-N-engine-merge-ship.md` evidence lives untracked under `I:/migration/.omo/evidence/` (never committed; `git log -- <evidence path>` empty). No recorded reason. Mitigating: all 14 files present at plan-canonical paths, complete, and reviewable; nothing lost; committing Alwork-merge evidence into either repo was never assigned to a todo. Downgraded, not blocking: no MUST-have is unchecked and no B3 byte merged.
- No changelog edits: PASS (no CHANGELOG path in 52-file diff).
- Nothing pushed: PASS. `git branch -r --contains` empty for b4bbda8, 7a3ba91, 37509818; `ls-remote` heads predate all train/migration work (Alwork `ui-alcore-readiness` 807b629f unmoved; migration `origin/main` 5731a22 behind local, unpushed per plan).

## 4. Tiers / order / alias / build

- Tiers: PASS. LIGHT default everywhere; single HEAVY (todo 3, declared in evidence, justified by triple-overlap contract).
- T3 canary last: PASS (7a3ba91 after all consumers; todo-14 fix correctly appended after, plan amended).
- Alias both forms: PASS (` .opencode/commands/ulw.md` + `.opencode/snippet/ulw-engine.md` with `aliases: [ulw]`).
- Unsigned build: PASS (chain 5/5 exit 0, tree clean, zero commits for todo 12).

## 5. DoneClaim → AdversarialVerify (all 14)

| Todo | Executor | Verifier verdict / confidence |
|------|----------|-------------------------------|
| 1 | st_01a12a67 | confirmed / 0.98 (st_01a12a6b) |
| 2 | st_01a12a68 | confirmed / 1.0 (st_01a12a6c) |
| 3 | st_01a12a6d | confirmed / 0.95 (st_01a12a74) |
| 4 | st_01a12a76 | confirmed / 0.95 (st_01a12a7e) |
| 5 | st_01a12a69 | confirmed / 0.98 (st_01a12a6a) |
| 6 | st_01a12a80 | confirmed / 1.0 (st_01a12a85); landed bca06f4 + smoke 37/0 |
| 7 | st_01a12a81 | confirmed / 0.95 (st_01a12a8e); landed 84e1a51 + smoke 57/57 |
| 8 | st_01a12a82 | confirmed / 0.95 (st_01a12a87); landed 0789351 + smoke 46/0 |
| 9 | st_01a12a83 | confirmed / 0.95 (st_01a12a89); landed d74a9d5 + smoke 4/4 |
| 10 | st_01a12a9c | confirmed / 0.95 (st_01a12a9f) |
| 11 | st_01a12a84 | confirmed / 0.95 (st_01a12a88); landed 37e19e4 + live smoke |
| 12 | st_01a12aa1 | confirmed / 0.95 (st_01a12ab1, hash-matched + live launch) |
| 13 | st_01a12ab4 → fix chain | confirmed / 0.95 (st_01a12acf row-7 re-proof; initial BLOCKED correctly halted the wave, fix owned by todo 14) |
| 14 | st_01a12ac7 | confirmed / 0.95 (st_01a12acf) |

Every landing recorded with parents + smoke. Gate reviews exist for all todos (todo 7's under `task-7-gate-review.md`; todo 13's REJECT review correctly rejected the FAIL claim's acceptance, not the halt).

## 6. Plan-text errors (all correctly non-blocking)

- 80/0-pre (todo 3): 62/0 pre correct by construction (+18 land with the group); recorded in evidence, verifier concurs. Non-blocking.
- Unknown-command 404 (todo 11): 200-null-scope is base behavior, no regression; recorded. Non-blocking.
- 3/3 vs 4/4 (todo 9): 4/4 actual (todo-4 test joins the tree); no weakening. Non-blocking.
- Loop-status 15/0 (todo 10): older count; actual worker 27/0 + isolated 4/4 quoted. Non-blocking.

## Gaps (blocking): none.
