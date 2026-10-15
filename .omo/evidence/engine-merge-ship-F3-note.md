# F3 note — engine-merge-ship final manual QA surface pass (APPROVE)

- Gate: F3. Task: st_01a12ad5. Date: 2026-10-11.
- FINAL DIST: `I:/migration/Alwork-wt/engine-merge-train/packages/electron/dist/win-unpacked`
- TRAIN: `I:/migration/Alwork-wt/engine-merge-train` @ `b4bbda8` (`git log --oneline -3` =
  `b4bbda8 / 7a3ba91 / 84e1a51`; `git status --short` empty before and after).
- Stale-state pin: exe 239,636,480 B sha256
  `c0bce68ddeafcc22f53242976c39ebc1702f1aa54228dfe521c1cc5b5146edb7`
  (= task-14 post-rebuild value, differs from task-12/13 `8c1e79b4…abbd` → fresh dist).
  `resources/omo-engine` present; shipped dist `skill-matcher.ts:1` =
  `import { sortByScopePriority } from "./scope-priority.ts"`.
- Asar hash-pin (dep-free reader, this turn): bridge `840b1458…c2` MATCH,
  worker `6dad2247…f59` MATCH, driver `5e9232fb…c2f` MATCH (train == packaged asar;
  CLI probes ran on train bytes proven identical to shipped bytes).
- Harness: fixture `~/.omo-tmp/f3-proj` (`.opencode/commands/ulw.md` 1923 B +
  `.opencode/snippet/ulw-engine.md`, copied from train); loopback cookie
  `oc_ui_session_57123` minted HS256 `{type:'ui-session'}` 12 h from
  `~/.config/openchamber/jwt-secret` (COOKIE-MINTED len=155); dir headers
  `x-opencode-directory: encodeURIComponent(fixture)` + `...-encoding: uri`;
  fixed loopback port 57123; every launch bounded (170 s script deadline) and reaped.
- Environment: only `C:/Program Files/Git/bin/git.exe` used for git. Zero keyed spend,
  fixtures only. Probe scripts lived in `~/.omo-tmp/f3/`, removed after.
- GUI not observable from this session (services/Disc context); every row uses machine
  markers against the REAL packaged bits (same limitation as todos 12/13, gate-accepted).

## Rows (one each, full outputs quoted)

(a) launch — PASS
- Invocation: spawn `OpenChamber.exe` cwd=fixture, poll `GET /health` 2 s × 45.
- Observable: `APP-PID=31940`, `HEALTH status=200 bytes=1364`, `READY=true`;
  SIGTERM → `tasklist OpenChamber.exe` = `No tasks are running` (0 orphans; second
  launch `APP-PID=38864` likewise reaped, 0 orphans).

(b) native run default receipt — PASS
- Invocation: bun `f3-cli.mjs`: `checkNativeParity({env:{PATH,OMO_ENGINE_ROOT:<native fixture>}})`
  then `createOmoBridgeRuntime({resolveEngineEntry:()=>bun.exe, env, spawn:counting})`
  → `invoke({message:'f3 native qa', sessionId:'ses_f3_b'})` → `wait()`.
- Observable: `GATE={"ok":true,"code":"OMO_NATIVE_OK","path":"native","message":null,
  "details":{"bunPath":"C:\\Users\\dangq\\.bun\\bin\\bun.exe","bunSource":"path","bunFound":true,
  "workerEntry":"…/omo-invoker-worker.ts","workerFound":true,…"barrelFound":true}}`;
  `NATIVE native=true spawns=1 spawnArgv0=["…/omo-invoker-worker.ts","--engine-root","…/native"]`
  `receipt={"exitCode":0,"signal":null,"result":null,"sessionId":"ses_f3_b","streamError":null}`.

(c) loop-status read — PASS
- Invocation: `bun …/omo-invoker-worker.ts --engine-root <F> --barrel-path <stub>
  --loop-status --loop-src <readers> --session f3-1 --limit 50` → exit 0;
  same with `--session ../evil` → exit 0.
- Observable: `LOOP-HAPPY exit=0 body={"ok":true,"sessionId":"f3-1",
  "plan":{"title":"f3 loop","status":"running","goal":"prove cli reads","totalSteps":5,"completedSteps":2},
  "ledgerTail":[{"seq":10,"event":"started"},{"seq":11,"event":"advanced"},{"seq":12,"event":"waiting"}]}`;
  `LOOP-EVIL exit=0 body={"ok":true,"sessionId":null,"plan":null,"ledgerTail":[]}`.

(d) worker + driver spot-check — PASS
- Invocations: worker bare → exit 2; worker stdin `{"message":"f3 worker job","sessionId":"ses_w1"}`
  via file redirect → exit 0; driver `startLoopGoal → requestLoopStop → advanceLoop →
  resumeLoop ×2 → foreign resume → getLoopDriverStatus` on fresh dir, `hostPid=process.pid`.
- Observable: `WORKER-BARE exit=2 stderr="[omo-invoker-worker] missing --engine-root <dir>"`;
  `WORKER-JOB exit=0 stdout="" stderr=""`;
  `DRIVER-START={"ok":true,"started":true,"plan":{"title":"f3 driver spot check","status":"running",…,"completedSteps":0}}`;
  `DRIVER-STOP={"ok":true,"stopped":true}`;
  `DRIVER-ADVANCE={"ok":true,"halted":true,"events":["started","halted"]}`;
  `DRIVER-RESUME1={"ok":true,"done":false,…"completedSteps":1,"events":["started","halted","resumed","advanced"]}`;
  `DRIVER-RESUME2={"ok":true,"done":true,…"status":"complete",…,"completedSteps":2}`;
  `DRIVER-FOREIGN={"ok":false,"code":"OMO_LOOP_DRIVER_FOREIGN_SESSION",
  "message":"Session \"someone-else\" does not own this loop (owned by \"f3-drv\"): refused."}`;
  `DRIVER-FILES=["driver.json","ledger.jsonl","plan.json"]`.

(e) pane listed enabled — PASS
- Invocations (live packaged server, authed): `GET /api/guests`; `GET
  /api/guests/openchamber-builtin-dag-pane/panel/index.html`.
- Observable: `GUESTS status=200 bytes=335 body={"guests":[{"id":"openchamber-builtin-dag-pane",
  "name":"DAG runs","icon":"icon.svg","source":"bundled","path":null,"enabled":true,
  "entry":"panel/index.html","version":"2.1.1","capabilities":{"requested":["service"],"granted":["service"]},
  "storageId":"20b3d5da-…","service":{"runtime":"host","granted":true}}]}`;
  `PANEL status=200 bytes=4681 head="<!DOCTYPE html><meta name=\"color-scheme\" content=\"light dark\">\n<html lang=\"en\">\n"`.

(f) skill install 200 + SKILL.md + listed (row-7 re-proof on final dist, DEFAULT mode) — PASS
- Invocation: authed `POST /api/config/skills/install-engine
  {"skillName":"git-master","scope":"project"}`; disk check; `GET /api/config/skills`;
  `GET /api/config/skills/git-master`; negative `no-such-skill-xyz`, `../evil`.
- Observable: `CATALOG status=200 bytes=15420 hasEngine=true`;
  `INSTALL status=200 bytes=262 body={"ok":true,"installed":[{"skillName":"git-master","scope":"project",
  "source":"engine","path":"C:\\Users\\dangq\\.omo-tmp\\f3-proj\\.opencode\\skills\\git-master\\SKILL.md"}],
  "skipped":[],"success":true,"message":"Engine skill git-master installed successfully."}`;
  `SKILLMD-EXISTS=true bytes=28779 head="---\\nname: git-master\\ndescription: \"MUST USE for ANY git operations. Atomic commits, rebase/squash,\\n "`
  (byte count + head match task-14 exactly);
  `SKILLS status=200 bytes=331338 containsGitMaster=true`;
  `SKILL-ONE status=200 bytes=31137` (`md.exists:true`, same fixture path, `scope:project`);
  `UNKNOWN status=400 bytes=142 body={"ok":false,"error":{"kind":"missing_skill",
  "message":"Engine skill \"no-such-skill-xyz\" not found in the engine catalog.","suggestions":[]}}`;
  `EVIL status=400 bytes=148 body={"ok":false,"error":{"kind":"invalid_skill_name",
  "message":"Invalid engine skill name \"../evil\". Use 1-64 lowercase alphanumerics with hyphens."}}`.

(g) tab states spot-check — PASS
- Invocation: `node ../../scripts/run-isolated-tests.mjs src/lib/engine src/components/sections/engine`
  (cwd `packages/ui`) → `4/4 test files passed`; shipped-bundle marker count.
- Observable: runner `4/4 test files passed`; `SettingsView-DB5PIGBj.js` 942,891 B
  contains `data-sessions` + `data-prompts` (family matches: 6); populated-state test
  asserts `data-sessions="2"`, `data-prompts="5"` (in the green 4/4 run).

(h) rollback OMO_NATIVE_RUN=0 + scrubbed-PATH exact message — PASS
- Invocations: bridge probe `env={OMO_NATIVE_RUN:'0'}` wrapper entry real bun.exe, tap spawn;
  scrubbed `env={OMO_ENGINE_ROOT}` only (no PATH/Path/OMO_BUN_PATH).
- Observable: `ROLLBACK native=false argv=["run","f3 wrapper rollback","--session-id","ses_f3_h","--json"]
  spawns=1 receipt={"exitCode":1,"signal":null}`;
  `SCRUBBED-PATH code=OMO_NATIVE_UNAVAILABLE message="Native runner unavailable: bun was not found
  on PATH and OMO_BUN_PATH is unset. The wrapper path is kept; install bun or set OMO_BUN_PATH
  to run natively." spawns=0` (byte-exact vs task-13 row 4).

(i) alias /ulw 200 + #ulw expand — PASS
- Invocations: `GET /api/config/commands/ulw`; `GET /api/config/snippets/ulw`;
  `POST /api/config/snippets/expand {"text":"run #ulw now"}`.
- Observable: `ALIAS-COMMAND status=200 bytes=570 body={"name":"ulw","sources":{"md":{"exists":true,
  "path":"C:\\Users\\dangq\\.omo-tmp\\f3-proj\\.opencode\\commands\\ulw.md","scope":"project",
  "legacy":false,"fields":["template","description"]},…},"scope":"project","isBuiltIn":false}`;
  `ALIAS-SNIPPET status=200 bytes=643 body={"name":"ulw-engine","content":"Drive the OmO engine
  workflows via /ulw: …`;
  `ALIAS-EXPAND status=200 bytes=389 EXPANDED body={"text":"run Drive the OmO engine workflows via /ulw: …`
  (389 bytes, expanded not echoed — matches task-13 row 10 shape).

## Regression (train tree, one run each)

- Bridge: `bun test …/omo-bridge-runtime.test.js …/omo-bridge-live-predicates.test.js` →
  `80 pass / 0 fail, 279 expect() calls` (exit 0).
- Worker: `bun test …/omo-invoker-worker.test.ts` → `27 pass / 0 fail, 121 expect() calls` (exit 0).

## Gaps / notes (pre-disclosed limitations only, no new FAIL)

- GUI window not observable from this non-interactive session (same as todos 12/13);
  backend-observable proof substituted per the accepted cookbook.
- HEALTH 1364 B (vs task-14's 1882 B) and CATALOG 15420 B (vs 15418 B) / INSTALL 262 B
  (vs 264 B): dynamic/fixture-path-length variance, statuses and bodies otherwise match;
  SKILL.md bytes/head, UNKNOWN/EVIL bodies, GUESTS/PANEL bytes match exactly.
- `GET /api/config/skills/list` is not a route (404-class); the correct list surface is
  `GET /api/config/skills` (200, contains git-master) — first probe used the wrong path,
  re-probed correctly on a second bounded launch.

## Cleanup

- `tasklist OpenChamber.exe` → none; opencode.exe → none (after each launch).
- Fixtures removed: `~/.omo-tmp/f3/`, `~/.omo-tmp/f3-proj/` (incl. installed SKILL.md).
- `dist/` kept. Train worktree clean, no commits, nothing pushed.
