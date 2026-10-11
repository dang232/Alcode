# Gate review — engine-merge-ship todo 9 (Merge T8 tab stats source)

- Plan: `I:/migration/.omo/plans/engine-merge-ship.md`, todo 9
- Executor claim: st_01a12a83, branch `engine-merge-t8` @ `a5fcbaa2b529ef7edc3ce3e8bc5e83c4048af834`
- Worktree: `I:/migration/Alwork-wt/engine-merge-t8` (repo `I:/migration/Alwork`)
- Reviewer session: 01a12a88-e562-76b3-b841-0dfead549d9e (no ulw-loop attempt dir; fallback path used)
- Verdict: **APPROVE** (AdversarialVerify: `confirmed`, confidence 0.95)

## recommendation

APPROVE. Every executor claim reproduced independently from the artifacts:
parents, 6-file stat, +2-line EnginePage mount, empty todo-4 diff, no-duplication
greps, isolated runner 4/4 exit 0 (third sample), tsc exit 0, populated render dump
(3193 chars, all 5 machine markers), shared-branch SHAs, clean worktree.

## blockers

None. No violated criterion.

## originalIntent

Merge lane branch `t8-engine-tab-stats` (eba7608) onto the train as one merge commit:
stats source (`engineSessionStats.ts`) + four render states (`EngineUsageSection.tsx`),
mounted once in `EnginePage.tsx`, with no session-panel duplication, no unrelated
settings edits, and no prose pins in tests.

## desiredOutcome

Per plan todo 9 acceptance: isolated UI runner 3/3 green; tsc clean; degraded states
non-blank. (Runner shows 4/4 because the merged tree also contains todo-4's
`EngineLoopStatus.test.ts` — explained, not a scope change.)

## userOutcomeReview

From the user's perspective the shipped artifact is exactly the lane's verified
behavior layered onto the train: the Engine settings tab gains a compact 7-day
session summary with loading/degraded/populated states; unreachable/malformed
backends render a degraded retry branch, never a blank tab or a zeroed report.
No other surface changes (6 files, 621 insertions, 0 deletions).

## Checked artifact paths (all read or executed)

- `I:/migration/.omo/evidence/task-9-engine-merge-ship.md` — read fully first.
- `I:/migration/.omo/plans/engine-merge-ship.md` (todo 9) — acceptance criteria source.
- `git log --oneline -2 engine-merge-t8` → `a5fcbaa (engine-merge-t8)`, `7b3a0ce`.
- `git log --pretty=%P -n 1 engine-merge-t8` → `7b3a0ce… eba7608…` (both parents quoted).
- `git show --stat engine-merge-t8` / `git diff 7b3a0ce..engine-merge-t8 --stat` → 6 claimed files only.
- `git diff 7b3a0ce engine-merge-t8 -- …/EnginePage.tsx` → ONLY:
  `+import { EngineUsageSection } from './EngineUsageSection';` and
  `+      <EngineUsageSection />`. Surrounding lines read: mount sits between
  `<StatusSection … />` and `<RoutingSection />`; todo-4 content undisturbed.
- `git diff 7b3a0ce engine-merge-t8 -- EngineLoopStatus.ts EngineLoopStatus.test.ts
  omo-bridge-runtime.js omo-invoker-worker.ts` → EMPTY (quoted empty output).
- `grep EngineLoopStatus|renderEngineLoopStatus` over the 4 T8 files → no matches (exit 1).
- `grep EngineUsageSection` over `packages/ui/src` (excluding own files) → import + single mount only.
- `git diff … --name-only | grep -i settings|skill|registry|surface` → `NO-SETTINGS-SURFACES`.
- Isolated runner `node ../../scripts/run-isolated-tests.mjs src/lib/engine
  src/components/sections/engine` (cwd `packages/ui`) → `4/4 test files passed`,
  `RUNNER-EXIT:0` (third sample; executor's 2× + mine). 4 files confirmed on disk:
  `engineStatus.test.ts`, `engineSessionStats.test.ts`, `EngineUsageSection.test.tsx`,
  `EngineLoopStatus.test.ts`.
- `bun run type-check` (`tsc --noEmit`, `packages/ui`) → `TSC-EXIT:0` (`node_modules` present).
- Own render QA (`renderToStaticMarkup`, populated, script deleted after):
  `CHARS=3193` with `HIT data-state="populated"`, `HIT data-sessions="2"`,
  `HIT data-prompts="5"`, `HIT data-tokens="20"`, `HIT data-cost="1.25"` —
  char count and markers match the evidence file exactly.
- Other three states verified via suite assertions read verbatim from
  `EngineUsageSection.test.tsx` (loading marker; unreachable degraded+button;
  malformed degraded) — machine markers only, zero prose pins.
- `git rev-parse ui-alcore-readiness` → `50786f9bfc…`; `t8-engine-tab-stats` → `eba7608…`.
- `git status --porcelain` (worktree) → empty after QA-script deletion; HEAD `a5fcbaa`.
- Executor QA script `qa-engine-usage-t9.tsx` confirmed absent (cleanup held).

## Overfit / slop pass (remove-ai-slops + programming criteria, applied directly)

- No prose pins: tests assert `data-state`/`data-error`/`data-*` attributes and exit
  codes only — confirmed by reading both test files in full.
- No deletion-only or removal-verifying tests; no tautologies; no
  implementation-mirroring beyond the machine-marker contract the plan requires.
- Production code is minimal and scoped: one zod-guarded projection module + one
  view/container pair; no unnecessary extraction, parsing, or normalization layers.
- No maintenance burden or scope drift: 0 deletions, no settings/skill/registry edits,
  bridge/worker/loop-status byte-untouched.
- NOTE (not a blocker): the code-review report referenced in the task preamble was not
  present in the inputs; the reviewer performed the skill-perspective check directly
  above instead. No criterion requires that report as an artifact.

## Evidence gaps

None material. `stale_state` start (`7b3a0ce`) is proven via the merge commit's first
parent rather than a separate start-log; end state `a5fcbaa` confirmed. Push-state
verified by branch containment (`+ engine-merge-t8` only) and unchanged shared SHAs;
remote refs not polled (no network claim made).
