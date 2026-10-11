# Gate review — task 13 engine-merge-ship QA FAIL claim (independent reproduction)

- Task: st_01a12ac1 (omo-native-gate-reviewer). No ulw-loop plan exists
  (`agentToolkit.status()` → `ULW_LOOP_PLAN_MISSING`), so this report uses the
  fallback path `.omo/evidence/<goal>-gate-review.md`.
- Role: final gate reviewer. No fixes implemented; no commits made; train tree
  untouched. Only write in this turn: this file (probe scripts lived in
  `~/.omo-tmp/` and were deleted after the runs; 0 app orphans at end).

## recommendation

**REJECT** — todo 13's acceptance criterion (9/9 surfaces PASS on the packaged
build, proving IS-1) is genuinely unmet: row 7 (skill install) fails on the
shipped bits in both documented modes. AdversarialVerify verdict: **confirmed**.

## blockers

1. `violatedCriterion`: todo-13 acceptance "9/9 surfaces PASS" (plan success
   criterion IS-1: "every engine surface works when invoked … skills list and
   install").
   Observation: default packaged behavior POST
   `/api/config/skills/install-engine` `{skillName:git-master, scope:project}`
   returns 500 `engine_unavailable` (no vendored engine beside the packaged
   checkout); SKILL.md never lands on disk.
   `evidencePointer`: live probe `INSTALL-AUTHED status=500 bytes=166`
   (body quoted verbatim in §Repro A below, byte-identical to the QA claim);
   `SKILLMD-EXISTS=false`; `resolveEngineRoot()` in
   `packages/web/server/lib/skills-catalog/engine-skills.js` (only non-override
   candidate is `…/packages/omo-engine`, absent from
   `packages/electron/dist/win-unpacked/resources/` which holds only
   `app.asar`, `app.asar.unpacked`, `web-dist`, `opencode-cli`, `icons`).
2. `violatedCriterion`: same todo-13 9/9 criterion (the documented
   `OMO_ENGINE_ROOT` override path also fails, so no install path succeeds on
   this build).
   Observation: with `OMO_ENGINE_ROOT=<train>/packages/omo-engine` the catalog
   resolves (200, 15822 bytes, engine section present) but install returns 500
   `engine_unavailable` "Engine skill matcher unavailable: Cannot find module
   '…/scope-priority' imported from '…/skill-matcher.ts'"; SKILL.md absent.
   `evidencePointer`: live probe `INSTALL status=500 bytes=377` (verbatim
   §Repro B); `skill-matcher.ts:1`
   `import { sortByScopePriority } from "./scope-priority"` (extensionless);
   `scope-priority.ts` EXISTS on disk; plain-node micro-repro
   `node -e "import('…/skill-matcher.ts')"` → `ERR_MODULE_NOT_FOUND: Cannot
   find module '…/scope-priority' imported from …/skill-matcher.ts`; the same
   file loads fine under bun (`matchSkillByName=function`); grep over
   `packages/web/server` for
   `transpil|stripType|allowImportingTs|pirates|esmLoader|addHook|resolveExtension|extensionAlias`
   → zero matches, and the only `.tsx` hit in `packages/electron` is a static
   MIME map (`main.mjs:4210`), not a module loader. The packaged loader is
   plain `import()` of a `file://…skill-matcher.ts` URL
   (`loadLoaderMatcher`, `engine-skills.js`), so extensionless TS imports can
   never resolve there. Fix pointers (not applied): exact file + line above;
   note a minimal extension fix may still fail — the module header comment
   records bun-only text imports and a never-vendored `shared-skills`
   dependency, so the robust fix is making the engine TS consumable by the
   node runtime (compile/bundle at package time, todo-12 gap) or shipping a
   TS-capable loader, owned by lane T7.

## originalIntent

Plan `engine-merge-ship.md` todo 13: click-through QA of all 9 engine surfaces
(+ alias) on the unsigned unpacked build; 9/9 PASS proves IS-1 (one packaged
build where every engine surface works when invoked).

## desiredOutcome

A runnable build in which native run, loop-status, worker job, predicate
fail-closed, driver resume, pane install, skill install, tab states, and
native flip/rollback each observably work, plus `/ulw` + `#ulw` alias
resolution — recorded as one PASS/FAIL row per surface with exact invocations.

## userOutcomeReview

From the user's perspective the shipped artifact does NOT satisfy the outcome:
8/9 surfaces + alias work (re-verified live: alias command 200 +
projectMd.exists, alias expand 200 with real expansion, loop-status worker
reads exit 0 with exact shapes), but engine skill install — the surface that
puts a SKILL.md on disk — fails in every configuration. A user clicking
"install git-master" gets a 500 and no file. The QA claim of 8/9 + alias PASS
with row 7 FAIL is accurate; the wave is correctly BLOCKED, not shippable
as 9/9.

## Repro (independent, run this turn — full outputs quoted)

Setup (mine, reconstructed — the QA evidence file's §3 is truncated, see
Evidence gaps): fixture project `~/.omo-tmp/gv-proj` holding
`.opencode/commands/ulw.md` + `.opencode/snippet/ulw-engine.md`; session
cookie `oc_ui_session_57123` minted locally as HS256 `{type:'ui-session'}`
(JWT, 12 h exp) keyed by `TextEncoder(jwt-secret.trim())` per
`ui-auth.js:617-642,871-876` + per-port name per `session-cookie.js`; app
`OpenChamber.exe` launched with cwd=fixture, `GET /health` polled to 200
inside the ~60–90 s headless window, processes reaped after (0 orphans).

Repro A — default (no vendored engine):

```text
COOKIE-MINTED len=155
APP-PID=34188
HEALTH status=200 bytes=1368
READY=true
INSTALL-AUTHED status=500 bytes=166 body={"ok":false,"error":{"kind":"engine_unavailable","message":"Engine skills are unavailable: no vendored OmO engine (packages/omo-engine) found beside this checkout."}}
INSTALL-NOCOOKIE status=401 bytes=23 body=Authentication required
INSTALL-BADSCOPE status=400 bytes=111 body={"ok":false,"error":{"kind":"invalid_scope","message":"Invalid scope \"bogus\". Use \"user\" or \"project\"."}}
ALIAS-COMMAND status=200 bytes=569 body={"name":"ulw","sources":{"md":{"exists":true,"path":"C:\\Users\\dangq\\.omo-tmp\\gv-proj\\.opencode\\commands\\ulw.md","scope":"project","legacy":true,"fields":["template","description"]},"json":{"exists":false,...},"projectMd":{"exists":true,"path":"C:\\Users\\dangq\\.omo-tmp\\gv-proj\\.opencode\\commands\\ulw.md"},...},"scope":"project","isBuiltIn":false}
ALIAS-EXPAND status=200 bytes=43 body={"text":"run ENGINE-WORKFLOWS-CONTENT now"}
CATALOG status=200 bytes=1092 bodyHead={"ok":true,"sources":[{"id":"anthropic","label":"Anthropic",... (5 remote sources)}
SKILLMD-EXISTS=false
ORPHAN-CHECK hasOpenChamber=false
```

Repro B — `OMO_ENGINE_ROOT=I:/migration/Alwork-wt/engine-merge-train/packages/omo-engine`:

```text
APP-PID=32184 OMO_ENGINE_ROOT=I:/migration/Alwork-wt/engine-merge-train/packages/omo-engine
HEALTH status=200
READY=true
CATALOG status=200 bytes=15822 hasEngineId=true
INSTALL status=500 bytes=377 body={"ok":false,"error":{"kind":"engine_unavailable","message":"Engine skill matcher unavailable: Cannot find module 'I:\\migration\\Alwork-wt\\engine-merge-train\\packages\\omo-engine\\skills-loader-core\\src\\tools\\skill\\scope-priority' imported from I:\\migration\\Alwork-wt\\engine-merge-train\\packages\\omo-engine\\skills-loader-core\\src\\tools\\skill\\skill-matcher.ts"}}
SKILLMD-EXISTS=false
ORPHAN-OpenChamber=false ORPHAN-opencode=false
```

Harness-error exclusion (argued from bodies, not counts): the 401 without the
cookie proves the minted cookie is correct and required (auth layer works, so
the 500 is not a bad-cookie artifact); the 400 `invalid_scope` for
`scope:bogus` proves scope validation is a distinct earlier layer (a wrong
scope cannot explain the 500); `git-master` is a registered variant
(`ENGINE_SKILL_REGISTRY`, `engine-skills.js`) and the name rule accepts it
(no 400/404-name class), so the 500 is genuinely the engine-availability
layer. Byte counts match the QA claim exactly (166 / 377 / 1092 / 15822).

Loop-status spot-check (second PASS row, packaged-identical worker bytes):

```text
{"ok":true,"sessionId":"qa-1","plan":null,"ledgerTail":[]} EXIT=0
{"ok":true,"sessionId":null,"plan":null,"ledgerTail":[]} EXIT=0
```

## Checked artifact paths

- `I:/migration/.omo/evidence/task-13-engine-merge-ship.md` (154 lines; tail
  truncated — see gaps)
- `I:/migration/.omo/evidence/task-12-engine-merge-ship.md` (hash section:
  exe `8c1e79b4…abbd`, asar `b4b0208c…062f14`, opencode `07966ec5…f316c8a9`,
  index.html `e233ecf5…94abbad9`)
- `I:/migration/Alwork-wt/engine-merge-train/packages/web/server/lib/skills-catalog/engine-skills.js`
  (`resolveEngineRoot`, `loadLoaderMatcher`, registry, install flow)
- `I:/migration/Alwork-wt/engine-merge-train/packages/omo-engine/skills-loader-core/src/tools/skill/skill-matcher.ts:1`,
  `scope-priority.ts` (exists), `index.ts:1`
- `I:/migration/Alwork-wt/engine-merge-train/packages/web/server/lib/opencode/skill-routes.js:616,325`
  (routes exist as claimed)
- `…/lib/ui-auth/ui-auth.js:617-876`, `…/lib/ui-auth/session-cookie.js`
  (cookie mint/verify reconstruction)
- `I:/migration/Alwork-wt/engine-merge-train/packages/web/server/lib/opencode/omo-invoker-worker.ts`
  (loop-status contract)
- `I:/migration/Alwork-wt/engine-merge-train/packages/electron/dist/win-unpacked/`
  (exe + `resources/` layout; `resources/web-dist/index.html` re-hashed by me:
  26810 B, sha256 `e233ecf5ddf774972a32d2ce8d5e72916fd9ff1b9b137d072bc56cb994abbad9`
  = task-12 value, MATCH → no stale state)
- `git -C <train> status --short` → empty (clean → no dirty worktree)

## Evidence gaps (exact)

1. The QA evidence file ends abruptly: line 154 `| app3 (cookie, unsc` followed
   by a literal `...[truncated 3992 chars]` marker — launch-receipt rows,
   cookie-mint script, fixture paths, and the referenced §8 train-status proof
   are missing. Compensated: fresh `git status` (clean), fresh single-file
   hash re-check (match), independently reconstructed cookie per server source,
   full bodies quoted from my own runs.
2. No code-review report exists for this verify task (nothing was fixed, no
   diff under review) — the skill-perspective check below is my direct check,
   not a confirmation of a report.
3. In mode (a) I asserted catalog = 200/1092 bytes with remote-source head but
   did not assert `"id":"engine"` absence explicitly; mitigated by the exact
   byte-count match to the claim plus mode (b)'s contrast (15822 bytes,
   `hasEngineId=true`), which proves the override is what introduces the
   engine section.

## remove-ai-slops / programming skill pass (direct; skills unavailable this turn)

- No production diff exists (nothing fixed, no commits, worktree clean), so
  there is no shipped test or production code to judge for overfit/slop. My
  probes were throwaway repro scripts (deleted, not committed), not tests.
- False-confidence mechanism recorded for the owning lane: the T7 skill suites
  (57/57) run under **bun**, which resolves extensionless TS imports, so they
  cannot catch a plain-node-ESM resolution defect in the packaged server. Any
  green-suite claim for this surface needs a packaged-runtime (or plain-node)
  import probe, not just bun tests.
- No maintenance burden, scope drift, or unnecessary extraction introduced by
  this turn. NOTE (not a blocker): `remove-ai-slops` / `programming` skill
  files were not present in this session; criteria applied from the prompt
  directly as instructed.
