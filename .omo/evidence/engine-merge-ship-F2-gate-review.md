# F2 Code Quality Review — engine-merge-ship (train `engine-merge-train-t3-group` @ `b4bbda8`)

Gate: F2. Verdict: **APPROVE**. Confidence: **high**.

Reviewer did not implement the work. Compared train HEAD `b4bbda8` against base `50786f9b`
(lane merges), `7a3ba91` (row-7 fix delta base), lane commits `3c766d2` (T1 gate),
`69809e1` (T2), `b119cfd` (T2/T3 flag alignment), `d2b8464` (T9), `37509818` (T5).
Ran: bridge suite 68/68, predicates+engine-skills+loop-status+session-stats 40/40,
driver+worker 37/37 — all exit 0 on the merged tree.

## Row-by-row checks

| # | Check | Result |
|---|-------|--------|
| 1 | No scope drift: every production change maps to a lane verdict or the row-7 fix | PASS |
| 2 | No test mirroring / prose pins | PASS (one noted exception, pre-existing, out of merge scope) |
| 3 | Error contracts preserved | PASS |
| 4 | T1/T9 reconciliation, T2/T3 flag alignment, row-7 minimality | PASS |
| 5 | Hygiene: spend, secrets, TODO/FIXME, dead code | PASS |
| 6 | Evidence docs-only; no prod code smuggled in test files | PASS |

## Evidence per check

**1. Scope drift — PASS.** `50786f9b..HEAD` name-status maps cleanly:
- T6: `packages/dag-pane` → `packages/extensions/dag-pane` renames, `registry.json`
  allowlist entry, desktop-only id `plugin:openchamber-builtin-dag-pane`,
  `bun.lock` workspace-entry rename fallout (6 lines removed, mechanical).
- T7: `engine-skills.js` + wiring in `feature-routes-runtime.js`
  (additive `engineSkillCatalog`, OpenCode-config path untouched).
- T5: `omo-loop-driver.ts` (+ test). T2: worker `.ts` + loop-status caller.
  T8: `engineSessionStats.ts`, `EngineUsageSection.tsx`, `EnginePage.tsx`
  one-line mount. Todo 11: `.opencode/commands/ulw.md`,
  `.opencode/snippet/ulw-engine.md` (match `PROJECT_COMMAND_DIR_NAMES` /
  `frontmatter.aliases` registration patterns). Docs-only:
  `DOCUMENTATION.md` updates, 4 lane-evidence `.md` adds.
- One merge-time relocation: T2's `renderEngineLoopStatusHtml` moved from
  `EnginePage.tsx` (lane `69809e1`) to new `EngineLoopStatus.ts` because T8
  mounts `EngineUsageSection` in the same page. Renderer function bodies are
  character-identical to the lane; only the `EngineLoopPlanView` interface
  moved with it plus an explanatory header. Faithful, necessitated, not drift.
- `omo-bridge-live-predicates.test.js` +4 lines pins `OMO_NATIVE_RUN=0` so
  Slice-E argv assertions stay on the wrapper contract — correct under the
  T9 default flip.

**2. Test mirroring / prose pins — PASS.** Zero `toHaveBeenCalled` /
`mock.calls` / `vi.fn` / `jest.fn` in any merge-scope test file. Added-line
scan of all lane test diffs: assertions target machine values (codes,
`ok`/`path` fields, `details` objects, argv flags, hook counts, entry
counts, escaped bytes, status codes). `EngineLoopStatus.test.ts` asserts
CSS hooks + counts + escaping only. `node-esm-resolution.test.ts` asserts
extension regex + plain-node import exit status. One merge-added
`toContain('Nothing was started')` (bridge test :867) pairs with
`toContain('"2"')`: it asserts the fail-closed no-spawn guarantee names the
offending value — contract, not wording. Pre-existing `'stays empty'` /
`'nothing is fetched automatically'` pins are lane-base content, untouched
by the merge (not in any `+` line) — out of F2 scope, noted only.

**3. Error contracts — PASS.**
- Five degraded messages: `resolveBunCommand` + `checkNativeParity` bodies
  are byte-identical to T1 slice `3c766d2` (verified by extraction diff);
  all four gate message templates plus the `resolveEngineRoot` throw match
  `3c766d2` line-for-line. Tests assert them with `toBe` (:713, :728,
  :745, :848). The one extra message (unrecognized `OMO_NATIVE_RUN`
  value, bridge :890) is the T9 fail-closed addition — reviewed, correct.
- Fail-closed codes: `OMO_PROVIDER_NOT_SIGNED_IN` names model+provider in
  message and `details`, `calls` empty (zero spawns); alcore pins
  `--model alcore/<id>`.
- Ownership: `checkOwner` enforces `sessionId` AND (`parentSessionId`,
  `hostPid`) on every mutation; foreign/mismatched refused with no writes
  (tests green).
- Traversal: `../evil`, `..`, `a/b`, `''`, case-violations → `invalid_skill_name`
  before any filesystem touch; hostile template stored inert + byte-identical.
- 400-class diagnostics intact in `skill-routes.js`
  (400/401/404/409/500 distribution preserved).

**4. Reconciliation — PASS.**
- T1/T9: `resolveBunCommand` identical `true`, `checkNativeParity`
  identical `true` vs `3c766d2`; header comment reword only (documents T9
  default + rollback). `OMO_NATIVE_OK` passthrough preserved.
- T2/T3: `omo-invoker-worker.test.ts` byte-identical to `b119cfd`
  (19189 = 19189 bytes); prod `omo-invoker-worker.ts` absent from the
  `b119cfd..HEAD` stat — zero drift, `--session`/`--limit` semantics intact.
- Row-7: `7a3ba91..b4bbda8` = explicit `.ts` extensions on value imports
  (`skill-matcher.ts`, `index.ts`, `commit-workflow.ts`, `git-master.ts`;
  matcher logic unchanged), `process.resourcesPath` fallback in
  `resolveEngineRoot` (dev/test resolution unchanged),
  `extraResources ../omo-engine → omo-engine` in `electron/package.json`,
  plus a targeted `node-esm-resolution.test.ts` guard and one resources-path
  test. `import type` lines untouched. Slightly wider than "import lines +
  vendoring only" in file count, but every hunk is that fix — minimal.

**5. Hygiene — PASS.** No keyed spend (no api-key/billing patterns in the
diff; driver header documents spend-nothing). No secrets in merge-lane
evidence (`task-*-engine-merge-ship.md` grep clean; other hits are
pre-existing `project-ide` files). No TODO/FIXME/XXX/HACK in the diff
(only pre-existing "project-ide todo 6" task-number comments). No dead
code: `omo-loop-driver` standalone matches its lane `37509818` (file-based
contract by design, web-process import explicitly forbidden);
`EngineLoopStatus` tested + lane-mapped; `helperAlpha/helperZeta` exports
in the worker test are lane (`b119cfd`) fixture helpers, not merge-added.
Wrapper retained: `OMO_NATIVE_RUN=0` / `native:false` rollback paths present
and tested.

**6. Process artifacts — PASS.** `.omo/` delta = 4 lane-evidence `.md` adds,
docs only. No `^export` / `module.exports` in any merge-scope test file
(the two worker-test helper exports are byte-identical lane content).

## Gaps

None. No scope drift, no weakened contract, no secret.
