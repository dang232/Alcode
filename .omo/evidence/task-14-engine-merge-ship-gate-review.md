# Gate review — task 14 engine-merge-ship row-7 fix (adversarial verification)

- Task: st_01a12acf (omo-native-gate-reviewer). No ulw-loop plan exists in this
  session, so this report uses the fallback path
  `.omo/evidence/task-14-engine-merge-ship-gate-review.md` (same convention as
  the task-13 gate review).
- Role: final gate reviewer. No fixes implemented; no commits made; train tree
  untouched except bounded live-probe side effects outside the repo (fixture
  SKILL.md install, since removed). Only repo write this turn: none (this file
  lives in `I:/migration/.omo/evidence/`, not the train repo).
- Executor claim under test: commit `b4bbda8` on `engine-merge-train-t3-group`
  in `I:/migration/Alwork-wt/engine-merge-train` (8 files, +122/-14) fixing two
  stacked defects behind row-7 (packaged skill install): (1) extensionless TS
  imports unresolvable under plain-node ESM, (2) engine not vendored into the
  Electron package.

## recommendation

**APPROVE** — every claimed artifact was independently reproduced from a clean
read of the tree, and the live row-7 proof on the current dist matches the
executor's bodies byte-for-byte, including the exact byte counts.
AdversarialVerify verdict: **confirmed**.

## blockers

None. No violated criterion found.

## originalIntent

Todo 14 exists because todo 13's gate review REJECTED the wave: row 7 (engine
skill install on the packaged build) failed in both default mode (500
`engine_unavailable`, no vendored engine) and `OMO_ENGINE_ROOT` override mode
(500 `Cannot find module '…/scope-priority'`). The plan (todo 14) demands:
explicit import extensions + engine vendoring + rebuild + live row-7 re-proof
on a fresh dist, with no weakened tests, no loader redesign, no signing.

## desiredOutcome

`git-master` installs from the packaged app in default mode (no env override):
catalog 200 with engine section, install 200, real SKILL.md on disk and
listed, unknown/traversal names refused with 400; suites green; dist rebuilt
with the engine vendored beside the app.

## userOutcomeReview

Satisfied. From the user's perspective the shipped artifact now does what row
7 promises: on the current `dist/win-unpacked` build, installing `git-master`
returns 200 and writes a 28779-byte SKILL.md into the project, which then
appears in the skills list; bogus and traversal names are refused (400). This
was re-proved live by me (full bodies quoted in §Repro), not taken from the
executor's prose.

## Repro (independent, run this turn — full outputs quoted)

Setup (mine): fixture `~/.omo-tmp/gv14-proj` (fresh dir); session cookie
`oc_ui_session_57123` minted locally as HS256 `{type:'ui-session'}` (12 h exp)
keyed by `TextEncoder(jwt-secret.trim())` per `ui-auth.js` + per-port name per
`session-cookie.js`; app `OpenChamber.exe` launched with cwd=fixture (fixed
loopback port 57123 per `main.mjs:225`); `GET /health` polled to 200 within
~4 s; directory headers `x-opencode-directory: encodeURIComponent(fixture)` +
`x-opencode-directory-encoding: uri` per `project-directory-runtime.js:74-75`;
processes reaped after (0 orphans).

```text
COOKIE-MINTED len=159
HEALTH status=200 bytes=1882
CATALOG status=200 bytes=15418 hasEngine=true
INSTALL status=200 bytes=264 body={"ok":true,"installed":[{"skillName":"git-master","scope":"project","source":"engine","path":"C:\\Users\\dangq\\.omo-tmp\\gv14-proj\\.opencode\\skills\\git-master\\SKILL.md"}],"skipped":[],"success":true,"message":"Engine skill git-master installed successfully."}
SKILLMD-EXISTS=true bytes=28779 head=---\nname: git-master\ndescription: "MUST USE for ANY git operations. Atomic commits, rebase/squash,\n  history search (bla
LIST status=200 bytes=330070 containsGitMaster=true
UNKNOWN status=400 bytes=142 body={"ok":false,"error":{"kind":"missing_skill","message":"Engine skill \"no-such-skill-xyz\" not found in the engine catalog.","suggestions":[]}}
EVIL status=400 bytes=148 body={"ok":false,"error":{"kind":"invalid_skill_name","message":"Invalid engine skill name \"../evil\". Use 1-64 lowercase alphanumerics with hyphens."}}
```

Every status, byte count, and body matches the executor evidence §6 exactly
(HEALTH 1882, CATALOG 15418, INSTALL 264, SKILL.md 28779 + same head, LIST
330070, UNKNOWN 142, EVIL 148). Harness-error exclusion: the 400s for unknown
and traversal names prove name validation is a distinct layer (a bad name
cannot explain the 200); the cookie-minted authed calls returning 200 (not
401) prove auth works, so the install 200 is genuinely the engine layer.

## Checked artifact paths (all independently read / executed)

- `git log --oneline -3` → `b4bbda8` atop `7a3ba91` (then `84e1a51`); `git show
  --stat HEAD` → exactly the 8 claimed files, +122/-14; `git status --short`
  → empty (clean).
- `git diff 7a3ba91 HEAD --stat` → ONLY the 8 files (scope PASS).
- Import fix (quoted from my own diff read): `skill-matcher.ts:1`
  `"./scope-priority"` → `"./scope-priority.ts"`; `index.ts:1-2` both barrel
  re-exports → `.ts`; `git-master.ts:6-11` six value imports → `.ts`
  (`import type` line untouched); `commit-workflow.ts:1-3` three sub-section
  imports → `.ts`. `skill-matcher.ts` diff is the import line and nothing else
  (no loader redesign PASS).
- Guard test `node-esm-resolution.test.ts` exists (83 lines, new file); `bun
  test` on it by me: **2 pass / 0 fail, 16 expects**.
- `bun test src/tools/skill/` by me: **9 pass / 0 fail, 31 expects** (7
  matcher + 2 guard). Vitest T7 set by me (`skill-routes`, `skills`,
  `skills-catalog`, 7 files): **58 pass / 0 fail**.
- Vendoring (quoted from my own diff read): `packages/electron/package.json`
  `build.extraResources` += `{ "from": "../omo-engine", "to": "omo-engine" }`
  (no cert/pfx/tsp lines anywhere in the package.json diff — no signing PASS);
  `resolveEngineRoot` gains `path.join(process.resourcesPath, 'omo-engine')`
  candidate guarded by `typeof process?.resourcesPath === 'string'`, placed
  after the checkout-relative candidate (override still wins; dev resolution
  byte-identical — read the full function, PASS).
- Dist (current, not rebuilt by me): `resources/omo-engine` present;
  shipped `skill-matcher.ts:1` reads `from "./scope-priority.ts"`;
  marker `resources/omo-engine/skills-loader-core/package.json` present; exe
  sha256 `c0bce68ddeafcc22f53242976c39ebc1702f1aa54228dfe521c1cc5b5146edb7` =
  executor's claimed post-rebuild value, DIFFERENT from task-12/13
  `8c1e79b4…abbd` (rebuild actually shipped — stale_state PASS).
- Shared branches: `engine-merge-t5 d1fc47c`, `t6 5669843`, `t7 e258962`,
  `t8 a5fcbaa`, `t7-skills-catalog ecf60fe` (own tips, none is `b4bbda8`);
  wave1 commit `50786f9` present; `git status -sb` shows no upstream and no
  ahead/behind; no remote branch contains `b4bbda8` (nothing pushed PASS).
- Orphan sweep after live probe: `OpenChamber.exe` 0, `opencode.exe` 0,
  server DOWN on 57123 (0 orphans PASS).

## Adversarial classes

- dirty_worktree PASS (status empty before and after; my probe files lived in
  `~/.omo-tmp/`, never in the repo).
- stale_state PASS (HEAD pinned start/end, dist exe hash changed as a rebuild
  requires and equals the claimed fresh value, vendored fixed line present in
  dist).
- misleading_success_output PASS (every body + byte count quoted verbatim from
  my own runs; all equal the claim).
- malformed_input PROBED (unknown → 400 `missing_skill`, `../evil` → 400
  `invalid_skill_name`, bodies quoted).
- prompt_injection N/A with cover: installed SKILL.md is inert template data
  copied verbatim, never executed (frontmatter head quoted); hostile-template
  inertness covered by existing T7 tests per evidence.
- flaky_tests: skill dir run once by me (9/9) after executor's claimed 2x;
  vitest T7 set once by me (58/58). No flakes observed.
- hung_commands: every long command bounded (health poll 45x2 s, probe
  timeouts ≤180 s); one launch attempt short-circuited on a cygwin `rm`
  failure and was relaunched cleanly — environmental, not an artifact defect.
- cancel_resume, repeated_interrupts: N/A.

## remove-ai-slops / programming skill pass (direct; skills unavailable this turn)

- Neither skill is installed in this session; criteria applied directly from
  the prompt. No separate code-review report exists for this task, so this
  direct check stands in for the report-confirmation step (recorded as a gap,
  not a blocker — the check itself was performed, see below).
- Overfit/slop pass over the diff, tests, and production code:
  - `node-esm-resolution.test.ts` is NOT excessive, deletion-only,
    tautological, or implementation-mirroring: the static guard pins explicit
    extensions on exactly the 13 packaged-consumed files, and the dynamic
    guard imports the matcher + git-master under real plain `node` — the
    runtime the bun suites cannot simulate (the exact false-confidence gap
    the task-13 gate review flagged). It fails without the fix by construction
    (value-import specifier scan over the pre-fix sources).
  - `engine-skills.test.js` addition is in-style, single-case, restores
    `process.resourcesPath` in `finally`. Fine.
  - No weakened tests: `skill-matcher.test.ts` untouched; suite grew 57→58.
  - Production delta is minimal: extension specifiers + one resolver candidate
    + one extraResources entry. No unnecessary extraction, parsing, or
    normalization. Whole-directory vendoring (vs an allowlist) is a packaging
    entry with a recorded rationale (closure rot), not code bloat.
- Programming criteria: no maintenance burden beyond the standard guard-file
  list (fails loudly, not silently); no false confidence (the dynamic guard
  closes the bun-vs-node gap); no scope drift (import specifiers only, one
  resolver candidate, unsigned `--dir` build; other skills deliberately stay
  listed-unavailable-with-reason, matching the "no loader redesign" plan
  constraint).
- NOTE (not a blocker): extensionless value imports remain in
  `skills/index.ts` (barrel), `playwright.ts`, `security-review.ts`, and
  `skill-file-loader` consumers (`debugging`, `frontend`, `init-deep`,
  `remove-ai-slops`, `review-work`, `visual-qa`), plus `import type` lines
  everywhere and test files. None is on the packaged install path:
  `engine-skills.js` imports each skill module individually by file URL
  (registry `module:` field → `toModuleUrl`), never the barrel — verified by
  reading the loader code. `import type` is erased pre-resolution. Row 7 needs
  only git-master, whose full closure is fixed and guard-covered.
- No findings that create maintenance burden, false confidence, or scope
  drift. No blockers.

## Evidence gaps (exact)

1. The executor's pre-fix proof (prod files stashed, guard test 0/2 with
   `ERR_MODULE_NOT_FOUND …/skill/scope-priority`) was NOT re-run by me: doing
   so would require stashing committed prod files in the train tree. Accepted
   as executor-attested, corroborated by (a) the task-13 gate reviewer's
   independent plain-node repro of the identical error on the identical line,
   and (b) the post-fix dynamic guard passing under real `node` in my run.
   Post-fix state — the only shippable state — is fully verified.
2. No code-review report artifact exists for this task, so the "confirm the
   report shows the same skill-perspective check" step was performed directly
   above instead of by confirmation. Nothing in the diff escapes that direct
   check.
3. Residue: one empty scratch dir `~/.omo-tmp/gv14-proj` could not be removed
   (Windows holds it via my own background launch session's cwd; app processes
   themselves are dead, 0 orphans). It is outside the repo, empty, and
   harmless; the probe script is deleted.
