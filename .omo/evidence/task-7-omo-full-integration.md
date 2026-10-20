# Task 7 evidence — engine skills catalog (omo-full-integration, T7)

Branch: `t7-skills-catalog` @ worktree `I:/migration/Alwork-wt/t7-skills-catalog`.
Base: `ui-alcore-readiness` @ `50786f9`. No commits on shared branches; no pushes.

## Code home note (deviation, recorded honestly)

The lane brief names the `I:/migration/Alwork` line (`alwork-ide-map`) for
`skill-routes.js`/`skills.js`, but that checkout has **no**
`packages/omo-engine` at all (verified: `git ls-tree HEAD
packages/omo-engine` empty; `git grep matchSkillByName` zero hits). The
skills-loader (`skills-loader-core`, `matchSkillByName` ambiguous-refuses)
exists only on the wave1 line. Code home is therefore
`I:/migration/Alwork-wt/wave1`, and the task-owned worktree above was cut
from its `ui-alcore-readiness` tip. `I:/migration` base still lacks
`packages/` (re-proven at discovery).

Scaffolding (not committed, not part of the diff): two directory junctions
inside the task worktree reuse the wave1 installs —
`node_modules` and `packages/web/node_modules`. Both are git-ignored;
`git status` shows only the 7 T7 files.

## What changed (additive only)

- `packages/web/server/lib/skills-catalog/engine-skills.js` (new): loader
  wire. Registry mirrors `createBuiltinSkills()` (13 entries, verified
  against `skills.ts` source). Per-module isolated dynamic imports: an
  unloadable skill lists as `installable: false` with its reason, never
  dropped. `listEngineSkills` / `resolveEngineSkillForInstall` (through the
  real loader `matchSkillByName`: exact wins, unique short name resolves,
  ambiguous refuses) / `installEngineSkill` (SKILL.md under managed root,
  verbatim template bytes, frontmatter name/description/license/
  compatibility/metadata) / `createEngineSkillCatalog` route seam.
- `packages/web/server/lib/opencode/skill-routes.js`: engine source in
  `GET .../skills/catalog` (`itemsBySource.engine` + `engineSkillsUnavailable`
  flag on failed reads, mirroring `openCodeSkillsUnavailable`), engine branch
  in `GET .../skills/catalog/source?sourceId=engine` with installed flags,
  new `POST .../skills/install-engine` (400 missing/ambiguous/invalid,
  409 already_installed, 500 engine_unavailable/unknown). Registered before
  `/:name` routes. OpenCode-config discovery and bridge/pane resolution
  untouched.
- `packages/web/server/lib/opencode/feature-routes-runtime.js`: passes
  `engineSkillCatalog: createEngineSkillCatalog({ userSkillDir: SKILL_DIR,
  writeSkillFile: writeMdFile })`.
- Tests: `skills-catalog/engine-skills.test.js` (new, 20 cases incl. real
  loader-matcher contract tests + hostile-template inertness probe),
  `skill-routes.test.js` (+7 engine cases incl. one real-catalog install
  that asserts SKILL.md on disk and list visibility).
- Docs: `skills-catalog/DOCUMENTATION.md` (engine section + invoke table),
  `opencode/DOCUMENTATION.md` (routes/source/endpoint/refusal kinds).

## Invoke-at-run-time (loader contract, recorded)

Per `createBuiltinSkills` / `resolveActiveBuiltinSkills`
(`skills-loader-core/.../builtin-skills/skills.ts`), recorded per item as
`invokeAtRuntime` + `invokeReason`:

| Status | Meaning |
|---|---|
| `in` / `active-in-loader` | Loader includes the skill at run time under these options. |
| `out` / `conditional: team_mode disabled` | `team-mode` without `team_mode.enabled` (loader default). |
| `out` / `browser-variant-not-selected (active: X)` | Non-selected browser variant (default provider `playwright`). |
| `out` / `disabled-by-config` | Name in the caller's `disabledSkills`. |
| `out` / `engine-source-missing: ...` | Module unloadable here: non-vendored `shared-skills` root (6 skills), bun-only text import under vitest (`security-*`), no TS runtime under plain node. |

Catalog extension (documented in code + docs): the loader factory never sees
duplicate names, but the catalog lists both `playwright` variants (MCP + CLI
share the loader name). Install with that name and no `variant` refuses
`ambiguous_skill` with candidates instead of guessing; `variant` selects.

## Proof (all run in the task worktree)

- Baseline first (wave1, same commit): web skill suites 30/30 green;
  loader `skill-matcher.test.ts` 7/7 green; `loader-skill-lookup.test.ts`
  3 fail — PRE-EXISTING (missing vendored `shared-skills`, same root cause
  as the catalog degradation; untouched by this change).
- After: `bunx vitest run server/lib/opencode/skill-routes.test.js
  server/lib/opencode/skills.test.js server/lib/skills-catalog` →
  **57 pass, 0 fail (7 files)**; focused rerun 33/33 green.
- `bunx oxlint` on authored files
  (`engine-skills.js`, `engine-skills.test.js`, `skill-routes.test.js`) →
  exit 0. Full-file runs still flag pre-existing backlog lines in
  `skill-routes.js`/`feature-routes-runtime.js` (left alone per repo rule;
  authored lines clean, `typeof` guards rewritten in the repo
  `value?.trim?.()` idiom).
- `bun run type-check` (packages/web `tsc --noEmit`): **zero errors in
  server files**; the failing output is pre-existing `../ui` missing-devDep
  noise (`happy-dom`, `@capacitor/*`, etc.) unrelated to this change.
- `bun run dead-code` (repo root): exit 0; new-module exports inspected,
  purely-internal consts unexported, `ENGINE_CATALOG_SOURCE_ID` shared with
  the route file (no blocking finding).

## Manual QA (HTTP class, real loader under bun; script removed after green)

```
PASS catalog-lists-engine — sources=anthropic,openai,cursor,mattpocock,engine engineItems=13 gitMaster=in/active-in-loader
PASS invoke-team-mode-out — team-mode=out/conditional: team_mode disabled
PASS invoke-unavailable-out — frontend installable=false reason=engine-source-missing: Cannot find module '../../../../shared-skills/index.mjs' ...
PASS source-engine-items — items=13
PASS install-named-skill — status=200 onDisk=true listed=true path=<tmp-proj>/.opencode/skills/git-master/SKILL.md
PASS install-content-shape — head="---\nname: git-master\ndescription: \"MUST USE for ANY git oper"
PASS install-unknown — status=400 kind=missing_skill
PASS install-ambiguous — status=400 kind=ambiguous_skill candidates=playwright,playwright-cli
PASS install-variant — status=200 onDisk=true (playwright-cli twin, user scope)
PASS install-traversal — status=400 kind=invalid_skill_name escaped=false
PASS install-conflict — status=409 kind=already_installed
fixture cleanup: projectRoot removed=true userSkillDir removed=true
OVERALL PASS (11/11)
```

Rerun after green: identical 11/11 (fresh tmp roots each run). Binary
PASS/FAIL on status codes + file-on-disk + list output, not logs.

## Adversarial rundown

- Malformed input: unknown → `missing_skill` (+ suggestions); ambiguous →
  `ambiguous_skill` (+ candidates); `../evil` → `invalid_skill_name` before
  any fs touch, nothing written outside roots (asserted); project scope
  without directory → `invalid_scope`; reinstall → `already_installed`
  (no overwrite).
- Stale state: fresh mkdtemp project + user roots per test and per QA run;
  loader re-read per call (no cache); failed engine reads set
  `engineSkillsUnavailable`, never an empty section.
- Dirty worktree: `git status` shows only the 7 T7 files (5 M + 2 new);
  probe/QA scripts lived in os tmpdir, removed (receipt below).
- Hung commands: local-fs imports only, no network in engine paths; suites
  run in ~2–4 s; QA loopback-only.
- Flaky: focused suites rerun green (33/33), QA rerun 11/11; no
  sleeps/polling in new tests.
- Misleading success: install asserts assert resolvable file bytes +
  discovery-list presence, not log text.
- Repeated interruptions: everything rerunnable from scratch (proven by
  reruns); no persistent state.
- Prompt-injection: SKILL.md templates are data — unit probe installs a
  template containing `$(...)`, backticks, `${...}` and a stray `---`,
  asserts byte-identical storage and a canary file never created; install
  path has no eval/import of content.
- Cancel/resume N/A: endpoints are single request/response with no
  background work; there is nothing to cancel or resume.

## Cleanup receipts

- Fixture dirs: per-test tmpdirs removed in `finally`; QA project/user
  roots removed (`removed=true` × 2 runs).
- `/tmp/qa-t7.mjs` and engine-import probe script removed (`removed=true`).
- Probe test `t7-probe.test.js` removed from the worktree before final runs.
- No engine installed, no credentials touched, no network calls made.

## Risks / known limits

- 6 of 13 builtins uninstallable until `shared-skills` is vendored
  (listed, refused with reason — not silent).
- `security-research`/`security-review` need a TS runtime with text imports
  (bun ✓, vitest ✗, plain-node serve degrades to `engine_unavailable`).
- UI catalog panel shows the engine source with zero UI changes; its
  repo-shaped install dialog cannot install engine rows (server answers
  `invalidSource`). Engine install is HTTP-level (`install-engine`) until a
  UI lane wires it.
