# Task 14 evidence — engine-merge-ship row-7 fix: packaged skill install

Train: `I:/migration/Alwork-wt/engine-merge-train`, branch `engine-merge-train-t3-group`.
Commit: `b4bbda8` `fix(engine): packaged skill install resolution` (8 files, +122/−14).
Start HEAD verified `7a3ba91`, worktree clean; end HEAD `b4bbda8`, worktree clean.
Shared branches untouched; nothing pushed; unsigned build only; `dist/` gitignored and retained.

Diagnosis sources (read first, no re-derivation):
`I:/migration/.omo/evidence/task-13-engine-merge-ship.md` (row 7 FAIL, invocations A/B)
+ `I:/migration/.omo/evidence/task-13-engine-merge-ship-gate-review.md` (REJECT, two stacked defects).
Required skills loaded before editing: `openchamber-change-discipline`, `desktop-shell`.

## 1. Baseline repro on the unchanged tree (plain node, system node v24.15.0)

Probe: `node probe.mjs <file>` → `await import(pathToFileURL(target).href)`:

- `skill-matcher.ts` → exit 33
  `MATCHER-FAIL code=ERR_MODULE_NOT_FOUND :: Cannot find module '…/tools/skill/scope-priority' imported from …/tools/skill/skill-matcher.ts`
- `skills/git-master.ts` → exit 33
  `GITMASTER-FAIL code=ERR_MODULE_NOT_FOUND :: Cannot find module '…/skills/git-master-skill-metadata' imported from …/skills/git-master.ts`
- Same matcher file under bun → `BUN-LOADED matchSkillByName=function` (contrast: bun/vite resolve
  extensionless imports; packaged Electron plain-node ESM does not).

## 2. Fix — defect 1: explicit extensions on the row-7 install path

Convention check: cross-package engine imports already name files explicitly
(`../../../utils/src/index.ts`); the dag-pane panel uses `./dag-view.ts`. Only the
`sibling` imports in the touched area were extensionless. Fix matches that convention.
`import type` lines untouched (erased before resolution; repo convention there is extensionless).

| File | Change | Why |
|---|---|---|
| `skills-loader-core/src/tools/skill/skill-matcher.ts:1` | `./scope-priority` → `./scope-priority.ts` | diagnosed line; matcher is imported by the install route via `loadLoaderMatcher` |
| `skills-loader-core/src/tools/skill/index.ts:1-2` | both barrel re-exports → `.ts` | same defect class one line away; barrel is the package `./skill` export |
| `builtin-skills/skills/git-master.ts:6-11` | 6 value imports (metadata + 5 sections) → `.ts` | install path imports this module directly; every hop failed under node |
| `builtin-skills/skills/git-master-sections/commit-workflow.ts:1-3` | 3 sub-section imports → `.ts` | transitive closure of git-master (leaf sections have no imports — verified by rg) |

Deliberately NOT widened: other catalog skills stay listed-as-unavailable-with-reason by design
(`remove-ai-slops`/`visual-qa` need never-vendored `shared-skills`; `security-research` needs a
bun-only `with { type: "text" }` import). Row 7 needs only git-master; no loader redesign.

Post-fix plain-node probe: matcher `LOADED keys=findPartialMatches,matchCommandByName,matchSkillByName`,
barrel LOADED, git-master `LOADED keys=gitMasterSkill` — all exit 0.

New regression test `tools/skill/node-esm-resolution.test.ts` (bun:test, colocated precedent):
(a) static guard — every value import in the 13 packaged-consumed files names an explicit file;
(b) dynamic guard — imports matcher + git-master under real plain `node` (probe file in os.tmpdir,
skipped only when no `node` binary exists).
Pre-fix proof (prod files stashed, test kept): **0 pass / 2 fail** with `ERR_MODULE_NOT_FOUND`
`…/skill/scope-priority`. Post-fix: passes. Existing `skill-matcher.test.ts` untouched (7/7).

## 3. Fix — defect 2: vendor the engine into the Electron package (minimal)

- `packages/electron/package.json` `build.extraResources` += `{ "from": "../omo-engine", "to": "omo-engine" }`.
  Whole directory (2880 src files, ~17.8 MB, no node_modules, no build output) — a file allowlist
  would rot against future skill closures; extraResources ships unpacked so `file://` TS imports work.
- `packages/web/server/lib/skills-catalog/engine-skills.js` `resolveEngineRoot()` gains one candidate
  after the checkout-relative one: `path.join(process.resourcesPath, 'omo-engine')`, guarded by
  `typeof process?.resourcesPath === 'string'`. Override still wins; plain-node dev/vitest runs have
  no `resourcesPath`, so their resolution is byte-identical to before.
- Rejected alternative (recorded): setting `OMO_ENGINE_ROOT` in `main.mjs` at startup — env coupling,
  weaker than a self-contained resolver candidate that keeps the documented "vendored beside the app"
  semantics.
- New test in `engine-skills.test.js` (`resolveEngineRoot` block, in-style): packaged-resources copy
  with the loader marker resolves without an override; restores `process.resourcesPath` in `finally`.

## 4. Suite runs

- `bun test src/tools/skill/` (skills-loader-core): **9 pass / 0 fail, 31 expects — twice** (flaky check).
- T7 set `bunx vitest run server/lib/opencode/skill-routes.test.js server/lib/opencode/skills.test.js
  server/lib/skills-catalog` (cwd `packages/web`): **7 files, 58 pass / 0 fail** (57 prior + 1 new).
- Full `bun test` (skills-loader-core): 102 pass / 45 fail / 14 errors — failures pre-existing and
  unrelated: old-tree baseline 100 pass / 47 fail (the delta is exactly my 2 new tests failing pre-fix).
  All 11 failing suites are MCP-parsing/discovery/extraction areas; none touch `tools/skill` or
  `builtin-skills/skills/`. Noted, not fixed (out of scope), no test weakened.
- `bunx oxlint` on touched engine files: clean (two `as` assertions removed on first flag).
- `node --check engine-skills.js`: clean.

## 5. Rebuild (packaging changed → FULL chain, README order, per-step exits)

Pre-rebuild dist hashes matched task-12/13 exactly (exe `8C1E79B4…ABBD`, asar `B4B0208C…062F14`) — no stale state.

| Step | Command (cwd `packages/electron`) | Exit |
|---|---|---|
| 1 | `bun run build:web-assets` | 0 |
| 2 | `bun run prepare:opencode-cli` (already prepared 2.0.23) | 0 |
| 3 | `bun run bundle:main` | 0 |
| 4 | `bun run rebuild:native` (Electron 43.7.0) | 0 |
| 5 | `node ./scripts/package.mjs --dir` (unsigned unpacked) | 0 |

Post-rebuild: exe `C0BCE68DDEAFCC22F53242976C39EBC1702F1AA54228DFE521C1CC5B5146EDB7`,
asar `9BCD44D93C328BD34828F456250A212C257FF8AB577CC8E16240DE51856C857F` (changed, expected).
`resources/` now holds `omo-engine` (3215 files, 17,777,210 B); shipped
`skill-matcher.ts:1` reads `from "./scope-priority.ts"`; marker
`resources/omo-engine/skills-loader-core/package.json` present.

## 6. Live row-7 proof on the FRESH dist (DEFAULT mode, no OMO_ENGINE_ROOT)

Driver `~/.omo-tmp/row7-live.mjs` (removed after run; output in §Receipts): fixture
`~/.omo-tmp/row7-proj`, app `OpenChamber.exe` cwd=fixture, `/health` poll, loopback session cookie
minted from `~/.config/openchamber/jwt-secret` (HS256 `{type:'ui-session'}`, name
`oc_ui_session_57123`). Header lesson recorded: `x-opencode-directory` must be
`encodeURIComponent` + `x-opencode-directory-encoding: uri`, else the literal `%3A` path 400s
with `invalidSource` (first attempt hit exactly that; harness behavior, not a product defect).

- `HEALTH status=200 bytes=1882` (~2 s)
- `CATALOG status=200 bytes=15418 hasEngine=true` (default mode — defect 2 fixed)
- `INSTALL status=200 bytes=264 body={"ok":true,"installed":[{"skillName":"git-master","scope":"project","source":"engine","path":"C:\\Users\\dangq\\.omo-tmp\\row7-proj\\.opencode\\skills\\git-master\\SKILL.md"}],"skipped":[],"success":true,"message":"Engine skill git-master installed successfully."}`
- `SKILLMD-EXISTS=true bytes=28779 head=---\nname: git-master\ndescription: "MUST USE for ANY git operations. Atomic commits, rebase/squash,\n  history search (bla`
- `LIST status=200 bytes=330070 containsGitMaster=true`
- `UNKNOWN status=400 bytes=142 body={"ok":false,"error":{"kind":"missing_skill","message":"Engine skill \"no-such-skill-xyz\" not found in the engine catalog.","suggestions":[]}}`
- `EVIL status=400 bytes=148 body={"ok":false,"error":{"kind":"invalid_skill_name","message":"Invalid engine skill name \"../evil\". Use 1-64 lowercase alphanumerics with hyphens."}}`
- No crash; app reaped; orphan sweep `ORPHANS=0` (second sweep after re-run likewise 0).

## 7. Commit + receipts

- `git show --stat HEAD` (`b4bbda8`): exactly the 8 fix files (7 modified + 1 new test), +122/−14.
- Adversarial ledger: stale_state — HEAD start `7a3ba91`/end `b4bbda8`, fresh fixture per run,
  dist hashes before/after recorded above; dirty_worktree — pre-commit `status` showed fix files only,
  post-commit clean; misleading_success_output — bodies + bytes quoted verbatim (§6); hung_commands —
  every long command bounded (eval timeouts ≤1200 s, health poll 90×2 s, zero retries needed);
  malformed_input — unknown/traversal refusals re-run live (400s above); flaky_tests — skill dir 2×
  green, T7 set green; prompt_injection — installed SKILL.md is inert template data, copied verbatim,
  never executed (frontmatter head quoted; hostile-template inertness covered by existing T7 test).
- Cleanup: app processes reaped (`ORPHANS=0`); scratch removed
  (`row7-proj/`, `row7-baseline-probe.mjs`, `row7-live.mjs`, `row7-live.log`, node probe tempfile);
  `dist/` retained gitignored. No orphans, no residue.

## 8. Hygiene commit receipt (evidence committed alongside, train branch)

- Branch: `engine-merge-train-t3-group` (base `b4bbda8` verified before commit).
- Commit message: `docs(engine): engine-merge-ship evidence and gate reviews`.
- Source: all 31 files copied from `I:/migration/.omo/evidence/` (the train carried none);
  nothing committed in the migration repo (different repo, main line).
- Files committed under `.omo/evidence/` (31):
  - `engine-merge-ship-F1-gate-review.md`, `engine-merge-ship-F2-gate-review.md`,
    `engine-merge-ship-F3-note.md`, `engine-merge-ship-F4-gate-review.md`
  - `task-1-engine-merge-ship.md`, `task-1-engine-merge-ship-gate-review.md`
  - `task-2-engine-merge-ship.md`, `task-2-engine-merge-ship-gate-review.md`
  - `task-3-engine-merge-ship.md`, `task-3-engine-merge-ship-gate-review.md`
  - `task-4-engine-merge-ship.md`, `task-4-engine-merge-ship-gate-review.md`
  - `task-5-engine-merge-ship.md`, `task-5-engine-merge-ship-gate-review.md`
  - `task-6-engine-merge-ship.md`, `task-6-engine-merge-ship-gate-review.md`
  - `task-7-engine-merge-ship.md` (no gate review — task 7 has none)
  - `task-8-engine-merge-ship.md`, `task-8-engine-merge-ship-gate-review.md`
  - `task-9-engine-merge-ship.md`, `task-9-engine-merge-ship-gate-review.md`
  - `task-10-engine-merge-ship.md`, `task-10-engine-merge-ship-gate-review.md`
  - `task-11-engine-merge-ship.md`, `task-11-engine-merge-ship-gate-review.md`
  - `task-12-engine-merge-ship.md`, `task-12-engine-merge-ship-gate-review.md`
  - `task-13-engine-merge-ship.md`, `task-13-engine-merge-ship-gate-review.md`
  - `task-14-engine-merge-ship.md` (this file, receipt included),
    `task-14-engine-merge-ship-gate-review.md`
- Commit hash: recorded in the hygiene-task return JSON (`commit_hash`); verify with
  `git log --oneline -1` on this branch. (Hash is unknowable before the commit exists,
  so this section carries the file list; the hash is reported alongside.)
- Scope: evidence/docs ONLY — no prod/test files staged or touched.
