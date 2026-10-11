# Task 7 evidence — merge T7 engine skills catalog (engine-merge-ship, todo 7)

Branch: `engine-merge-t7` @ worktree `I:/migration/Alwork-wt/engine-merge-t7`.
Merge: `7b3a0ce` (train) + `t7-skills-catalog` @ `ecf60fe5` (lane, in-repo, same Alwork repo).
Result: `e2589625a212fbf06ec6bf953194f8145ac41d83` — commit message `Merge branch 't7-skills-catalog' into engine-merge-t7` (merge message preserved, `--no-ff`).
Shared branches untouched; nothing pushed; bridge/pane resolution untouched (no re-resolve).

Lane scope source: `.omo/evidence/task-7-omo-full-integration.md` (lane worktree
`I:/migration/Alwork-wt/t7-skills-catalog`): `skill-routes.js`, `skills-catalog/` dir,
57/57 suites, unknown/ambiguous/traversal diagnostics.

## Setup

- `git -C I:/migration/Alwork worktree add I:/migration/Alwork-wt/engine-merge-t7 -b engine-merge-t7 7b3a0ce`
  → `HEAD is now at 7b3a0ce feat(engine): merged loop-status caller`.
- HEAD verified `7b3a0cedfdffe3f1b5a4d547bcf035ca86cffaa9` before merging (STOP condition not triggered).
- Work only in `I:/migration/Alwork-wt/engine-merge-t7`; commit only on `engine-merge-t7`.
- Scaffolding (git-ignored, not committed): full `bun install` in the merge worktree
  (1 irrelevant failure: `@capacitor-mlkit/barcode-scanning@8.1.0` copyfile ENOENT, mobile-only).
  `ln -s`/`mklink` scaffolding was NOT usable on this host (both hung; killed, no residue).

## Covering tests (read first) + baseline

- Read lane `skill-routes.test.js` engine block (`describe('skill-routes engine catalog')`, 7 cases:
  catalog inline engine items, `engineSkillsUnavailable` flag, source endpoint installed flags,
  real-catalog install asserting SKILL.md on disk + list visibility, refusal→status mapping,
  unwired `engine_unavailable`) and `skills-catalog/engine-skills.test.js`
  (registry/invoke-status, hostile-template inertness probe). Behavior of record:
  exact-wins/unique-short-resolves/ambiguous-refuses (`matchSkillByName` contract);
  400 missing/ambiguous/invalid, 409 already_installed, 500 engine_unavailable/unknown.
- Baseline on unchanged tree (`7b3a0ce`):
  `bunx vitest run server/lib/opencode/skill-routes.test.js server/lib/opencode/skills.test.js server/lib/skills-catalog`
  → **30 pass, 0 fail (6 files)**, matching the lane's wave1 baseline.

## Merge

- `git merge --no-ff t7-skills-catalog` → RC=0, automatic, **zero conflicts**.
  Only auto-merge note: `packages/web/server/lib/opencode/DOCUMENTATION.md`.
  Conflict resolutions with lane winning: none required (nothing to list).
- Merge-base was `50786f9`; train side (`50786f9..7b3a0ce`) touched only
  bridge/invoker/loop-status/DOCUMENTATION — no overlap with catalog files.
- `git show --stat HEAD` file list == lane commit file list (8 files, 1381+/4-):
  `.omo/evidence/task-7-omo-full-integration.md`, `opencode/DOCUMENTATION.md`,
  `feature-routes-runtime.js`, `skill-routes.js`, `skill-routes.test.js`,
  `skills-catalog/DOCUMENTATION.md`, `engine-skills.js` (new), `engine-skills.test.js` (new).
- OpenCode-config proof: `git show --stat HEAD | grep -iE 'opencode-config|OpenCode-config|bridge|pane'`
  → no match (RC=1). Bridge and pane files untouched; no skills re-resolved in either.

## Verification (vitest, merged tree)

`bunx vitest run server/lib/opencode/skill-routes.test.js server/lib/opencode/skills.test.js server/lib/skills-catalog`
- Run 1: **Test Files 7 passed (7), Tests 57 passed (57)** (~2.2 s).
- Run 2: **Test Files 7 passed (7), Tests 57 passed (57)** (~2.4 s).
- Expectation per plan 57/57 → met exactly, twice (flaky check; suites are quick so 2x, no note needed).

## Manual QA (live HTTP probe, merged tree, real loader under bun)

Probe script (lane `startSkillsApp` harness replicated, REAL `createEngineSkillCatalog({ userSkillDir })`,
fresh mkdtemp project+user roots; server on loopback ephemeral port; script removed after green):

```text
PASS catalog-lists-engine — status=200 sources=engine engineItems=13
PASS catalog-git-master-invoke — invoke=in/active-in-loader
PASS install-named-skill — status=200 onDisk=true path=<tmp-proj>/.opencode/skills/git-master/SKILL.md
PASS install-content-shape — head=---\nname: git-master\ndescription: "MUST USE for ANY git oper
PASS install-listed — skills=<24 names incl. git-master>
PASS install-unknown — status=400 kind=missing_skill
PASS install-ambiguous — status=400 kind=ambiguous_skill candidates=[{"skillName":"playwright","variant":"playwright",...}]
PASS install-traversal — status=400 kind=invalid_skill_name escaped=false
PASS install-conflict — status=409 kind=already_installed
fixture cleanup: projectRoot removed=true userSkillDir removed=true
OVERALL PASS (9/9)
```

Requests quoted (method + path + body → status + kind):
- `POST /api/config/skills/install-engine {"skillName":"git-master","scope":"project"}` → 200, SKILL.md bytes on disk + discovery-listed.
- `POST ... {"skillName":"no-such-skill-xyz","scope":"project"}` → 400 `missing_skill`.
- `POST ... {"skillName":"playwright","scope":"project"}` → 400 `ambiguous_skill` (+ candidates, no guess).
- `POST ... {"skillName":"../evil","scope":"project"}` → 400 `invalid_skill_name`, `escaped=false` (parent dir clean).
- `POST ... {"skillName":"git-master","scope":"project"}` (repeat) → 409 `already_installed` (no overwrite).
- PASS = SKILL.md on disk AND listed; traversal refused → **PASS**.

## Adversarial rundown

- malformed_input: unknown/ambiguous/traversal diagnostics preserved and probed live (see QA above).
- prompt_injection: hostile SKILL.md (`$(...)`, backticks, `${...}`, stray `---`) stored byte-identical,
  canary never created — covered by lane unit probe inside the 57/57 suites (no eval/import of content).
- stale_state: HEAD start `7b3a0ce` / end `e2589625a212fbf06ec6bf953194f8145ac41d83`; fresh fixture roots per probe run; loader re-read per call.
- dirty_worktree: `git status --short` clean before and after; merge diff is exactly the 8 lane files.
- misleading_success_output: file-on-disk bytes + discovery-list presence asserted, not log text.
- flaky_tests: suites rerun 2x green (57/57, 57/57).
- N/A: cancel_resume (single request/response endpoints, no background work),
  hung_commands (suites ~2–4 s, probe ~seconds; nothing over 300 s to kill),
  repeated_interrupts (all steps rerunnable from scratch).

## Cleanup receipts

- Probe server closed in `finally` (script ran to OVERALL, foreground `bun` exited; ephemeral port released).
- Probe files removed: `packages/web/qa-t7-merge-probe.tmp.mjs` + `%TEMP%/qa-t7-merge-probe.mjs` (both verified gone).
- Fixture dirs removed: `qa-t7m-proj-*` + `qa-t7m-user-*` absent (`removed=true`, `ls` confirms).
- No stray PIDs (probe + suites ran foreground and exited); worktree `git status` clean.
- `bun install` residue is git-ignored scaffolding only.

## Risks / notes for the orchestrator

- 6 of 13 engine skills list as `installable: false` until `shared-skills` is vendored (lane-known limit, preserved).
- `engine-merge-t7` is unpushed; landing onto the train is the orchestrator's step.

## Landing receipt — train `engine-merge-train-t3-group` (LAST consumer landing, 9 lanes + alias complete)

- Train checkout: `I:/migration/Alwork-wt/engine-merge-train`, branch
  `engine-merge-train-t3-group`, pre-merge HEAD `d74a9d54099b7671a5900838a9140a52330afc6f` (matched plan, proceeded).
- Lane `engine-merge-t7` confirmed `e2589625a212fbf06ec6bf953194f8145ac41d83` before merge.
- `git merge --no-ff engine-merge-t7 -m "Merge lane engine-merge-t7: engine skills catalog"` → RC=0,
  clean, zero conflicts (8 files, 1381+/4-, same file set as lane merge).
- Merge commit: `84e1a51453d57fd4859e918976fcd5caa2cc785a`
  parents `d74a9d54099b7671a5900838a9140a52330afc6f` + `e2589625a212fbf06ec6bf953194f8145ac41d83`.
- Post-merge: `git status --short` clean; `git log --oneline -3` =
  `84e1a51 Merge lane engine-merge-t7: engine skills catalog` /
  `d74a9d5 Merge lane engine-merge-t8: tab stats source` /
  `37e19e4 Merge lane engine-merge-alias: ulw command plus snippet alias`.
- Smoke 1 (from `packages/web`):
  `bunx vitest run server/lib/opencode/skill-routes.test.js server/lib/opencode/skills.test.js server/lib/skills-catalog`
  → **Test Files 7 passed (7), Tests 57 passed (57)**, exit 0 (~2.7 s). No `bun install` needed
  (`node_modules` present at repo root and `packages/web`).
- Smoke 2 (from worktree root):
  `bun test packages/web/server/lib/opencode/omo-loop-driver.test.ts`
  → **10 pass, 0 fail** (70 expect() calls), exit 0.
- No tags created. No other file edits (this receipt section only).
