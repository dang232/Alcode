# Gate review — Task 8 engine-merge-ship (Merge T6 DAG pane graduation)

- Plan: `I:/migration/.omo/plans/engine-merge-ship.md`, todo 8
- Executor claim: st_01a12a82 — branch `engine-merge-t6` @ `5669843c4690b9ca5c87d29fd3af1593aa40f465`
  in `I:/migration/Alwork-wt/engine-merge-t6`, parents `7b3a0ce` + `489eaec0`, zero conflicts;
  covering suites 36/0 pre+post; `extensions:build` prints `Built 1 built-in`;
  scratch QA 21/21; lane branch unmoved; nothing pushed.
- Evidence file reviewed in full: `I:/migration/.omo/evidence/task-8-engine-merge-ship.md`
- Reviewer verdict: **APPROVE (confirmed)** — every executor claim reproduced independently.
- Skill check: `remove-ai-slops` / `programming` skill files are not installed in this
  session (only unrelated skills are present), so the overfit/slop pass below applies
  their documented criteria directly. No separate code-review report artifact was supplied
  with the claim; this report records the reviewer's own direct check instead
  (coverage gap noted, not a blocker — there is no criterion requiring a review artifact).

## recommendation

**APPROVE** — no blockers. All eight probes reproduced green from the artifacts.

## blockers

None. (Each entry would name `violatedCriterion` + `evidencePointer`; there are no entries.)

## originalIntent

Merge lane branch `ulw/t6-dag-graduation` (489eaec0) onto the engine merge train so the
graduated DAG side pane (registry allowlist entry, builtin bundle, desktop-only gate on
the new id, service grants intact) lands in the single runnable tree — with no extension
of scope to web/VSCode/mobile and no old-folder migration.

## desiredOutcome

Per plan todo 8 acceptance: `extensions:build` prints `Built 1 built-in`; a fresh fixture
root lists the bundled enabled pane; an invalid registry id fails loudly.

## userOutcomeReview

From the user's perspective the shipped artifact delivers exactly the asked outcome: one
merge commit on an otherwise untouched train, containing only the lane's 20 T6 files,
building the builtin bundle and listing the enabled pane with `[service]` grants on a
fresh root, while the old id is rejected loudly. No scope drift, no suite regression,
no shared-branch movement, no pushes.

## Checked artifact paths and probe results (all run by the reviewer, full outputs quoted)

1. Branch / parents / stat / status (clean):
   - `git log --oneline -2 engine-merge-t6` → `5669843 (HEAD -> engine-merge-t6)
     feat(engine): merged dag-pane graduation` on top of `7b3a0ce
     (engine-merge-train-t3-group, engine-merge-t7) feat(engine): merged loop-status caller`.
   - `git log --format='%H %P %s' -1` → `5669843c4690b9ca5c87d29fd3af1593aa40f465
     7b3a0cedfdffe3f1b5a4d547bcf035ca86cffaa9 489eaec0d2b8a2790ba38a7d37d8df522627655d
     feat(engine): merged dag-pane graduation` — parents exactly as claimed.
   - `git show --stat HEAD` → 20 files, 456 insertions, 275 deletions: lane evidence md,
     `bun.lock` (6-line deletion, part of the lane commit itself), `packages/dag-pane/*`
     → `packages/extensions/dag-pane/*` moves, `packages/extensions/registry.json`,
     `packages/ui/src/lib/surfaces/registry(.test).ts`, `packages/extensions/README.md`.
     T6 files only.
   - `git status --short` empty; `git status -sb` → `## engine-merge-t6` (clean).
2. Lane fidelity / scope drift:
   - `git diff 489eaec0 HEAD --stat -- packages/extensions packages/dag-pane
     packages/ui/src/lib/surfaces` → **empty** (T6 files byte-identical lane-tip vs merge).
   - `git diff 7b3a0ce HEAD --stat` == `git diff 489eaec0^ 489eaec0 --stat` (same 20 files).
     The non-empty `git diff 489eaec0 HEAD --stat` is the train side only (bridge/worker/
     loop files: `omo-bridge-runtime.js`, `omo-invoker-worker.ts`, `EngineLoopStatus.*`,
     `omo-bridge-live-predicates.test.js`) — expected merge-context, not T6 drift.
   - Name-only diff greps for `vscode|mobile|packages/web|apps/|android|ios` → NONE-FOUND;
     for `migrat|old-folder|legacy` → NONE-FOUND.
3. Registry / gating / grants:
   - `packages/extensions/registry.json` contains exactly one allowlist entry:
     `{ "id": "openchamber-builtin-dag-pane", "directory": "dag-pane", ... }`.
   - `packages/ui/src/lib/surfaces/registry.ts:57`:
     `DESKTOP_ONLY_PLUGIN_SURFACE_IDS = ['plugin:openchamber-builtin-dag-pane']`
     with a comment stating the pane's engine bridge is desktop-local, so web/VS Code/
     mobile must not offer it. Old id `omo-dag-pane` absent from both files
     (OLD-ID-ABSENT-FROM-THESE-FILES); it survives only as the npm `name` in
     `packages/extensions/dag-pane/package.json`, byte-identical to the lane tip
     (`git show 489eaec0:...` compared) — lane-faithful, not drift.
   - Service grants: manifest `openchamber.contributes.service = { entry: service/main.js,
     runtime: host }` intact (lane-identical).
4. Build (reviewer-run, once, from `I:/migration/Alwork-wt/engine-merge-t6`):
   - First attempt from `/i/migration` failed `Module not found
     "scripts/build-builtin-extensions.mjs"` (reviewer cwd error, not a repo defect).
   - `bun scripts/build-builtin-extensions.mjs` in the worktree → `Built 1 built-in
     extension(s).` (exit 0, well under the 600s kill budget).
5. Fixture listing + invalid-id (reviewer script, `/tmp`, removed after; bundle dir
   rebuilt by probe 4, removed after):
   - Fresh mkdtemp persist root against the real built bundle:
     `[{ "id": "openchamber-builtin-dag-pane", "source": "bundled",
        "enabled": true, "granted": ["service"] }]` — 1 guest, bundled, enabled,
     grants exactly `[service]`.
   - Temp sourceRoot with id `omo-dag-pane` → loud zod rejection:
     `[{ "origin": "string", "code": "invalid_format", "format": "regex",
        "pattern": "/^openchamber-builtin-[a-z][a-z0-9-]*$/", "path": ["extensions", 0, "id"],
        "message": "Invalid string: must match pattern ..." }]`.
6. Suites (reviewer-run, once):
   - `bun test packages/extensions/dag-pane/panel/dag-view.test.ts
     packages/extensions/dag-pane/service/handlers.test.js
     packages/ui/src/lib/surfaces/registry.test.ts` → `36 pass, 0 fail,
     137 expect() calls / Ran 36 tests across 3 files` — identical counts to the
     claimed 36/0 baseline and post-merge runs, including the passing gate test
     `keeps the DAG side pane on the Electron desktop shell only`.
7. Shared branches / pushes:
   - `ulw/t6-dag-graduation` → `489eaec0d2b8a2790ba38a7d37d8df522627655d` (unmoved);
     lane worktree `I:/migration/Alwork-wt/t6-dag-graduation` status `## ulw/t6-dag-graduation`
     (clean); wave1 worktree HEAD `50786f9bfc5023a0c44b318ebd6fc1e6d1347cd5` (matches
     claimed 50786f9b); merge worktree has no upstream tracking output beyond
     `## engine-merge-t6` (nothing pushed).
8. Adversarial ledger:
   - dirty_worktree: `git status --short` empty before probes and again after probe
     cleanup (bundle dir + /tmp probe script removed; `git stash list` empty).
   - stale_state: HEAD start `7b3a0ce` / end `5669843` confirmed from the log; bundle
     was built fresh by the reviewer run; fixture persist roots were fresh mkdtemp.
   - misleading_success_output: listing asserted from `listInstalledGuests` catalog
     bytes (not log text); invalid-id rejection asserts the zod issue object.
   - prompt_injection / cancel_resume / repeated_interrupts: N/A — static packaging
     merge, no prompts, no resumable flow (single merge commit).
   - hung_commands: none — build/test/probe each completed inside small timeouts.
   - flaky_tests: single independent run matches claimed counts exactly (36/0, 137
     expects); no rebuild-identity re-check run (executor's REBUILD-IDENTICAL claim
     across 3 scratch rebuilds is noted as executor-asserted, not reviewer-reproduced —
     see evidence gaps).
   - malformed_input: covered by the invalid-id probe (probe 5).

## Overfit / slop pass (remove-ai-slops + programming criteria, applied directly)

- No merge-added tests: the merge commit introduces zero new test files; the only test
  delta (`registry.test.ts`, 10 lines) belongs to the lane commit itself. No excessive,
  deletion-only, tautological, or implementation-mirroring tests at the merge level.
- No unnecessary production extraction/parsing/normalization: the merge adds no prod
  code beyond the lane's file set (verbatim move + allowlist + gate); no scope drift
  into helpers or abstractions.
- No maintenance burden or false confidence introduced: suite counts are identical
  pre/post (36/0, 137 expects), and the reviewer reproduced them rather than trusting
  the prose.
- No separate code-review report artifact was supplied with the claim; the direct
  reviewer check above substitutes. Recorded as a coverage note, not a blocker.

## Exact evidence gaps

1. Scratch QA 21/21 and 3x REBUILD-IDENTICAL bundle hashes were not re-executed file by
   file (the QA script was removed per the executor's cleanup receipts); the acceptance
   substance behind them — build output line, fresh-root listing row, invalid-id
   rejection, and covering suites — was independently reproduced (probes 4–6).
2. `bun install` dep-link failures and the killed stalled install are executor-reported
   only; the reviewer needed no install (worktree already had dependencies) and did not
   reproduce them. They touch no tracked files and are not success criteria.
3. No code-review report artifact accompanied the claim, so cross-checking "the code
   review report shows the same skill-perspective check" was impossible; the reviewer
   performed the slop pass directly instead.
