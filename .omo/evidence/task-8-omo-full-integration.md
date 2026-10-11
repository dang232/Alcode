# Task 8 evidence — Engine tab session-stats source + tab-state render test (omo-full-integration, checkbox T8)

## Code home + worktree/branch (recorded as mandated)

- Base has no `packages/` (proven again: live lines only). Live line used:
  `I:/migration/Alwork-wt/wave1`, branch `ui-alcore-readiness` @ `50786f9`
  (`feat(engine): live Slice-E predicate sources`).
- Task-owned worktree: `I:/migration/Alwork-wt/t8-engine-tab-stats`, fresh
  branch `t8-engine-tab-stats` @ `50786f9` (`git worktree add ../t8-engine-tab-stats -b t8-engine-tab-stats`).
  ALL work below happened there. No commits on shared branches, no pushes of
  bases, no changes outside the worktree (shared `wave1` status untouched;
  pre-existing untracked evidence/png files there left alone).
- T2 precedent reused: `I:/migration-wt/omo-full-integration-wave1`
  `EnginePage.tsx` slice (`renderEngineLoopStatusHtml`) + `EnginePage.test.ts`
  (commit `69809e1`): state-marker hooks (`engine-*-state` classes counted,
  never prose) and escape-as-data rule copied in React form (`data-state` /
  `data-error` / `data-*` value markers).

## Mount decision (recorded as mandated): real-shell mount, NOT slice extension

T2's file says "mount it in the real app shell when one exists (T8 owns tab
states)". The shell exists here (React `EnginePage` + happy-dom `bun:test`
precedent, e.g. `OpenCodeCompatibilityGate.test.tsx`), so the stats section
mounts in the real `EnginePage` between `StatusSection` and `RoutingSection`.
The framework-free slice in the orchestrator repo is untouched.

## What changed (worktree only, 1 edit + 4 new files)

- NEW `packages/ui/src/lib/engine/engineSessionStats.ts` — Engine-tab
  session source. Wraps the existing `fetchUsageStats`
  (`session.stats`, `tools:"none"`) and projects only the six numbers the tab
  renders (`sessions/prompts/steps/tokens.total/cost`), so the tab can never
  drift into a second session panel (models/tools/activity stay on the usage
  page). Failure taxonomy mirrors `engineStatus`: transport/server failure →
  `unreachable` (`OpencodeApiError`), off-shape payload → `malformed` (zod
  guard on the consumed contract); never a zeroed report. Default window is
  local-midnight-6-days-ago → now in the viewer zone (same 7-day rule as the
  usage page's `rangeStart('7d',…)`, owned here so the view is not imported
  across layers).
- NEW `packages/ui/src/lib/engine/engineSessionStats.test.ts` — 4 boundary
  tests (valid projection + query params; unreachable ×2; malformed ×2;
  default-window rule). `spyOn(globalThis,'fetch')` precedent, no module
  mocking; asserts status fields, never wording.
- NEW `packages/ui/src/components/sections/engine/EngineUsageSection.tsx` —
  container + pure `EngineUsageSectionView`. Built only from shared settings
  primitives (`SettingsSection`, `SettingsFieldRow`, stack/helper classes,
  shared `Button`), theme tokens only (no hardcoded colors), `tabular-nums`
  values. Copy reuses existing `usageStats.*` keys only — **zero new i18n
  keys** (no 13-locale translation run needed; parity suite unaffected).
  Search registry untouched: dynamic stats rows are not indexed per
  `settings-ui-patterns/references/search.md` ("Do not generate items for
  dynamic entities such as … sessions") — classification recorded here.
- NEW `packages/ui/src/components/sections/engine/EngineUsageSection.test.tsx`
  — 5 render tests over the four tab states via `data-state`/`data-error`/
  `data-*` markers (loading, unreachable-degraded, malformed-degraded,
  populated live values) + container loading→populated transition on a
  deferred fetch. Fresh fixtures per test; no sleeps/polling.
- EDIT `EnginePage.tsx` — 2-line mount (`import` + `<EngineUsageSection />`).
  `StatusSection`/`RoutingSection` byte-identical; no other settings surface
  touched; no session-panel duplication.

## Surface list (ui-api-decoupling: one line per runtime)

Same transport as the usage page (`opencodeClient.session.stats`); no new
transport, no new capability: web, Electron desktop, VS Code, hosted mobile,
and Capacitor mobile all read through the active runtime exactly where the
usage page already does. No runtime gets a new behavior or a silent fallback.

## Automated verification (exact commands, worktree cwd)

- Baseline first (in `wave1`, pre-edit): `bun test
  src/lib/engine/engineStatus.test.ts` → 3 pass; `bun test
  src/lib/opencode/session-stats.test.ts` → 4 pass.
- After: `node ../../scripts/run-isolated-tests.mjs src/lib/engine
  src/components/sections/engine` (repo's isolated UI runner, each file its
  own process) → **3/3 files passed, exit 0**, three consecutive runs
  (run1 + rerun2 + rerun3; final re-run after last edit also 3/3).
  Direct `bun test` of all three files in ONE process fails the container
  case (`degraded` instead of `loading`) — the documented singleton
  load-order interference the isolated runner exists for; recorded, not
  hidden.
- `bun run type-check` (`tsc --noEmit`, `packages/ui`) → exit 0.
- `bunx oxlint` on all 5 touched files → exit 0 (one finding fixed:
  `anti-slop/no-runtime-typeof` on a `typeof` check in the new test,
  replaced with a length assertion; no rules silenced).
- `bun run dead-code` (repo root) → exit 0; the interim `EngineUsageLoad`
  unused-export note was resolved by using the type in the test.
- Install receipt: fresh worktree had no `node_modules`; `bun install` →
  1671 packages (2 unrelated link warnings: babel safari plugin copyfile,
  capacitor barcode copyfile; postinstall electron ensure ran best-effort).

## Manual QA (render class; no visual runner in repo → DOM dumps, binary PASS/FAIL)

Script `packages/ui/qa-engine-usage-t8.tsx` (temporary, deleted after green)
rendered `EngineUsageSectionView` per state via `renderToStaticMarkup` and
asserted markers + non-blank output:

- PASS loading (`data-state="loading"`, 458 chars, no value markers)
- PASS unreachable-backend (`data-state="degraded" data-error="unreachable"` + retry button, 1557 chars)
- PASS malformed-payload (`data-state="degraded" data-error="malformed"` + retry button, 1555 chars)
- PASS populated (`data-state="populated"`, `data-sessions="2"`,
  `data-prompts="5"`, `data-tokens="20"`, `data-cost="1.25"`; dump shows real
  `SettingsSection` chrome with title `Stats` and locale formatters)
- OVERALL PASS, exit 0. Degraded states render the error branch, never a
  blank tab (all markups non-empty).

## Adversarial rundown

- Malformed input: wrong-type `sessions`, null `tokens` → `malformed`, no
  crash, no zeroed report (boundary tests).
- Stale state: fresh fixtures per test (`summaryFixture()`/`wireFixture()`
  called per case); container test uses a per-test deferred fetch.
- Dirty worktree: final `git status --porcelain` shows ONLY the 5 intended
  files (1 modified `EnginePage.tsx` + 4 new); QA script deleted (receipt
  above); `node_modules` gitignored.
- Hung commands: all suites bounded (<1 s each); installs/type-checks run
  with explicit kill deadlines.
- Flaky: isolated runner 4× green total; no timing constructs in new tests.
- Misleading success: every verdict from `data-*` markers / status fields /
  exit codes, never copy text.
- Repeated interruptions: suites re-ran green after each fix cycle
  (button-query fix, typeof fix, import-home fix).
- Prompt-injection N/A (stats treated as data — one-line reason): numbers
  flow into `Intl` formatters and `data-*` attributes only, never into
  markup/queries/eval; no strings from the payload are rendered.
- Cancel/resume N/A (render states, no resumable flow — one-line reason):
  the section is a one-shot read with a manual retry button; nothing to
  cancel or resume.

## Cleanup receipts

- QA script `packages/ui/qa-engine-usage-t8.tsx` removed after green
  (`git status` confirms absent).
- No servers, fixtures, or tmpdirs created (all fixtures in-memory).
- Worktree `I:/migration/Alwork-wt/t8-engine-tab-stats` left in place with
  uncommitted changes for lane review; shared branches untouched, nothing
  pushed.

## Risks / follow-ups

- R1: Populated section shows 7-day totals only (no range picker) — a range
  control would duplicate the usage page; deliberate.
- R2: `StatusSection` still collapses unreachable+malformed into one failed
  branch — left byte-identical as out of scope; the new section surfaces the
  distinction where T8 owns it.
- R3: Combined single-process `bun test` across engine files is order-fragile
  (pre-existing singleton pattern); always use the isolated runner here.
