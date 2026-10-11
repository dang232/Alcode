# Task 13 evidence — engine-merge-ship: click-through QA of all 9 surfaces (+alias) on the packaged build

Verdict: **BLOCKED — 8/9 surfaces PASS, 1 FAIL (row 7 skill install).**
First FAIL halts the wave per plan: lane + repro recorded below, nothing fixed, no commits.

- Train (read-only): `I:/migration/Alwork-wt/engine-merge-train` (no writes made; status proof in §8).
- Packaged build: `I:/migration/Alwork-wt/engine-merge-train/packages/electron/dist/win-unpacked`
- Session context: non-interactive (`qwinsta`: own context `services/Disc`; interactive desktop
  `console/dangq` unreachable). No GUI observation possible from here — every row below uses machine
  markers (exit codes, bytes, JSON fields, HTTP statuses) against the REAL packaged bits:
  live `OpenChamber.exe` HTTP API on `127.0.0.1:57123`, and asar-extracted modules hash-pinned
  identical to the verified train bytes. Zero keyed spend (fixtures only, stub barrels, no model calls).
- Auth for live probes: loopback-only session cookie minted from the machine-local
  `~/.config/openchamber/jwt-secret` (`oc_ui_session_57123`, HS256 `{type:'ui-session'}`); 401s without it quoted where met.

## 1. Stale-state re-check (adversarial): dist hashes match task-12 exactly

`Get-FileHash -Algorithm SHA256` on 2026-10-11 (this task) vs task-12 §Hashes:

| File | This task | Task-12 | Match |
|---|---|---|---|
| `OpenChamber.exe` (239,636,480 B) | `8C1E79B4…ABBD` full `8c1e79b480cfcb1a8f3c624c01c200ac320411c3e38265083d3b3f8f2091abbd` | `8c1e79b4…9b1abbd` (same full) | MATCH |
| `resources/app.asar` | `b4b0208c74074a9d5b3af9afe7b443292bfb291bad6b058e6f4ace8feb062f14` | identical | MATCH |
| `resources/opencode-cli/opencode.exe` | `07966ec56592564cf89c52c25f8f1d5cdc600ae4a07af30dfdc5a588f316c8a9` | identical | MATCH |
| `resources/web-dist/index.html` | `e233ecf5ddf774972a32d2ce8d5e72916fd9ff1b9b137d072bc56cb994abbad9` | identical | MATCH |

Asar module hash-pin (extracted with a read-only dep-free inspector at
`C:/Users/dangq/.omo-tmp/task13/asar-inspect.js`, since removed):

| Module | Train sha256 | Asar-extracted sha256 | Match |
|---|---|---|---|
| `server/lib/opencode/omo-bridge-runtime.js` (46,728 B) | `840b14584953ad57…` | identical | MATCH |
| `server/lib/opencode/omo-invoker-worker.ts` (9,206 B) | `6dad224760f5fd88…` (== task-6 worker hash `6DAD2247…18F59`) | identical | MATCH |
| `server/lib/opencode/omo-loop-driver.ts` (16,724 B) | `5e9232fb9ba137e1…` (== task-6 driver hash `5E9232FB…00C2F`) | identical | MATCH |

CLI probes ran against the train-tree files (resolvable imports) whose bytes are proven identical
to the packaged asar bytes above. Asar total: 10,465 files. Alias files (`.opencode/`) are NOT in
the asar (correct — they resolve from the user's project dir, proven live in row 10).

## 2. PASS/FAIL table (each row: invocation + expected observable + actual)

### Row 1 — native run (default gate-decided native receipt): PASS
- Invocation: `bun C:/Users/dangq/.omo-tmp/task13/cli/bridge-probe.mjs` (since removed; logic:
  `createOmoBridgeRuntime({resolveEngineEntry: stub, env: {OMO_ENGINE_ROOT: <fixture engine with stub barrel>, OMO_NATIVE_RUN unset}, spawn: counting wrapper})`
  → `checkNativeParity()` then default-path `invoke({message:'t13 native qa', sessionId:'ses_t13_1'})` → `wait()`).
  Real `bun` + real packaged-identical worker + stub barrel (`run()` prints, returns 0, no spend).
- Expected: gate `{ok:true, code:'OMO_NATIVE_OK'}`; `handle.native===true`; 1 spawn; `wait()` `{exitCode:0}`.
- Actual: gate `{"ok":true,"code":"OMO_NATIVE_OK","path":"native","message":null,
  "details":{"bunPath":"C:\\Users\\dangq\\.bun\\bin\\bun.exe","bunSource":"path","bunFound":true,
  "workerEntry":"…/engine-merge-train/packages/web/server/lib/opencode/omo-invoker-worker.ts","workerFound":true,
  "engineRoot":"C:/Users/dangq/.omo-tmp/task13/native","vendored":false,"engineFound":true,
  "barrelPath":"…/native/packages/omo-opencode/src/cli/run/index.ts","barrelFound":true}}`;
  `native=true spawns=1`; receipt `{"exitCode":0,"signal":null,"sessionId":"ses_t13_1"}`. PASS.

### Row 2 — loop-status view (bounded tail renders): PASS
- Invocations (cwd=train root, `bun <worker> --engine-root <F> --barrel-path <stub> --loop-status … --loop-src <readers>`):
  - happy `--session qa-1 --limit 50` → exit 0,
    `{"ok":true,"sessionId":"qa-1","plan":{"title":"t13 loop","status":"running","goal":"prove cli reads","totalSteps":5,"completedSteps":2},"ledgerTail":[{"seq":10,"event":"started"},{"seq":11,"event":"advanced"},{"seq":12,"event":"waiting"}]}` (tail length 3).
  - bound `--limit 1` → exit 0, tail `[{"seq":12,"event":"waiting"}]` (newest only).
  - corrupt readers → exit 0, `{"ok":true,"sessionId":"qa-1","plan":null,"ledgerTail":[]}`.
  - `--session ../evil` → exit 0, `{"ok":true,"sessionId":null,"plan":null,"ledgerTail":[]}`.
- View half: `bun test packages/ui/.../EngineLoopStatus.test.ts` → **3 pass / 0 fail, 11 expects, exit 0**
  (empty/populated/escape states with machine markers).
- PASS (4/4 CLI cases exit 0 with exact JSON shapes + renderer suite green).

### Row 3 — worker job (stdin parse / flags): PASS
- Invocations:
  - `bun …/omo-invoker-worker.ts` (bare) → **exit 2**, stderr `[omo-invoker-worker] missing --engine-root <dir>`.
  - `bun …/worker --engine-root <F> --barrel-path <stub> < job.json` (`{"message":"t13 worker job"}` via `<` redirect)
    → **exit 0**, stdout `STUB_RUN message=t13 worker job sessionId=undefined`.
- Note: piping the JSON through PowerShell (`'…' | bun …`) yields exit 2 `job on stdin is not valid JSON`
  (shell transcoding, not a worker defect); `cmd /S /C` + file redirect gives the PASS above. PASS.

### Row 4 — predicate fail-closed (unsigned model fast fail, 0 spawns): PASS
- Invocation: same bridge probe, `env={PATH:'',Path:'',OMO_BUN_PATH unset}` → `invoke({message:'t13 must not run'})`.
- Expected: throw `OMO_NATIVE_UNAVAILABLE` with byte-exact message, 0 spawns.
- Actual: `{"code":"OMO_NATIVE_UNAVAILABLE",
  "message":"Native runner unavailable: bun was not found on PATH and OMO_BUN_PATH is unset. The wrapper path is kept; install bun or set OMO_BUN_PATH to run natively."}`, `spawns=0`. PASS.

### Row 5 — driver resume (resume completes from ledger; foreign refused): PASS
- Invocation: `bun …/cli/driver-probe.ts` (imports packaged-identical driver; fresh fixture dir; `hostPid=process.pid`).
- Actual chain: start `{ok:true,status:running,steps:0}` → stop `{ok:true,stopped:true}` →
  advance `{ok:true,halted:true,events:[started,halted]}` →
  resume1 `{ok:true,done:false,steps:1,events:[started,halted,resumed,advanced]}` →
  resume2 `{ok:true,done:true,status:complete,steps:2,events:[started,halted,resumed,advanced,completed]}` →
  foreign-session resume `{ok:false,code:OMO_LOOP_DRIVER_FOREIGN_SESSION}`; files `[driver.json,ledger.jsonl,plan.json]`. PASS.

### Row 6 — pane install render (bundled pane listed enabled; rail icon path): PASS
- Invocations (live packaged server, authed, app still alive at batch end `Appexit=null`):
  - `GET /api/guests` → **200, 335 bytes**:
    `{"guests":[{"id":"openchamber-builtin-dag-pane","name":"DAG runs","icon":"icon.svg","source":"bundled","path":null,"enabled":true,"entry":"panel/index.html","version":"2.1.1","capabilities":{"requested":["service"],"granted":["service"]},"storageId":"20b3d5da-…","service":{"runtime":"host","granted":true}}]}`.
  - `GET /api/guests/openchamber-builtin-dag-pane/panel/index.html` → **200, 4681 bytes** (`<title>DAG runs</title>`).
- On-disk (dist, untouched): `registry.json` allowlists `openchamber-builtin-dag-pane → dag-pane`;
  bundle `panel/{index.html 2282, main.js 71159}` + `service/main.js 36462` + `icon.svg 417 B` + `package.json 674 B`
  (sizes match task-12). Web-dist corroboration: id string present in built assets. PASS.

### Row 7 — skill install (SKILL.md lands on disk + listed): FAIL (first FAIL — wave halted here)
- Invocation A (default packaged behavior): launch `OpenChamber.exe` (cwd=fixture project), authed
  `POST /api/config/skills/install-engine {"skillName":"git-master","scope":"project"}` + `x-opencode-directory: <fixture>`.
- Actual A: **500, 166 bytes**:
  `{"ok":false,"error":{"kind":"engine_unavailable","message":"Engine skills are unavailable: no vendored OmO engine (packages/omo-engine) found beside this checkout."}}`.
  Catalog `GET /api/config/skills/catalog` → 200, 1092 bytes, 5 remote sources, **no engine section**;
  skills list contains no `git-master`. SKILL.md on disk: **absent**.
- Invocation B (documented `OMO_ENGINE_ROOT` override, same route): launch with
  `OMO_ENGINE_ROOT=I:/migration/Alwork-wt/engine-merge-train/packages/omo-engine`.
  Catalog grows to **200, 15822 bytes** (engine section resolves) but install →
  **500, 377 bytes**:
  `{"ok":false,"error":{"kind":"engine_unavailable","message":"Engine skill matcher unavailable: Cannot find module '…/packages/omo-engine/skills-loader-core/src/tools/skill/scope-priority' imported from …/skills-loader-core/src/tools/skill/skill-matcher.ts"}}`.
  SKILL.md on disk: **absent** (`exists=false`).
- Root cause (not fixed): `scope-priority.ts` EXISTS on disk; the import is extensionless
  (`import { sortByScopePriority } from "./scope-priority"` in `skill-matcher.ts:1`), which bun
  resolves but the packaged Electron server's plain-node ESM loader does not. The engine skill
  sources are TypeScript and are not packaged/compiled for the node runtime, so no install path can
  succeed on this build. Expected per surface: SKILL.md bytes on disk + listed. Actual: never written.
- Lane + repro: owning lane **T7 engine skills catalog** (`engine-merge-t7`, packaged by **todo 12**
  without engine TS consumable by the node runtime). Repro = invocations A/B above (launch exe,
  mint loopback session cookie from `~/.config/openchamber/jwt-secret`, POST install-engine).
- Traversal probe under the same condition → same 500 `engine_unavailable` (catalog unwired; refusal
  mapping unobservable on this build — recorded, not hidden).

### Row 8 — tab states (4 render states non-blank): PASS
- Invocation: `node ../../scripts/run-isolated-tests.mjs src/lib/engine src/components/sections/engine`
  (cwd `packages/ui`, packaged-source tree) → **4/4 test files passed, exit 0**
  (covers `EngineUsageSection` loading/unreachable/malformed/populated render markers + stats boundaries).
- Shipped-bundle proof: `resources/web-dist/assets/SettingsView-DB5PIGBj.js` (942,891 B) contains
  `data-sessions`/`data-prompts` marker literals (105 matches of the `data-state|data-error|data-sessions|…` family).
  Task-9's 4-state render dumps (458/1557/1555/3193 chars, all non-blank) were recorded on identical source. PASS.

### Row 9 — native flip + rollback (default native; OMO_NATIVE_RUN=0 wrapper; scrubbed-PATH exact message): PASS
- Invocations (bridge probe): `env={OMO_NATIVE_RUN:'0'}`, wrapper entry = real `bun.exe`, tap `spawn` →
  `invoke({message:'qa wrapper rollback'})` → `wait()`.
- Actual: `native=false`, wrapper argv `["run","qa wrapper rollback","--session-id","ses_t13_9","--json"]`,
  `spawns=1`, receipt `{"exitCode":1,"signal":null}` (child really ran and settled).
  Default-native half proven by row 1; scrubbed-PATH exact message proven byte-for-byte in row 4. PASS.

### Row 10 — alias surface (/ulw resolves + #ulw expands): PASS
- Invocations (live packaged server, authed, `x-opencode-directory: <fixture project holding .opencode/commands/ulw.md + .opencode/snippet/ulw-engine.md>`):
  - `GET /api/config/commands/ulw` → **200, 585 bytes**, `projectMd.exists:true`,
    path `C:\Users\dangq\.omo-tmp\task13\proj\.opencode\commands\ulw.md`, scope project.
    (Without the directory header the server resolves its restored profile project and answers
    `scope:null isBuiltIn:true` — recorded; scoping is the documented mechanism.)
  - `GET /api/config/snippets/ulw` → **200, 648 bytes**, `name:ulw-engine`, `aliases:["ulw"]`.
    (Unscoped: 404 `Snippet "ulw" not found` — recorded.)
  - `POST /api/config/snippets/expand {"text":"run #ulw now"}` → **200, 389 bytes**,
    text expanded to the full engine-workflows content. (Unscoped: echo unchanged — recorded.)
- PASS (all three resolve through the packaged commands stack).

## 3. Launch/orphan receipts (all launches bounded, all reaped)

| Launch | PID | Observed | End |
|---|---|---|---|
| app (15s check) | 44244 | alive, then served (log `app starting 2.1.1 packaged:true`, `listening on 127.0.0.1:57123`, managed `opencode.exe serve --port 61938`) | exit 1 (~90s, no window station; no shutdown line — same as task-12) |
| app2 (fast-poll) | 32504 | `ready=true`, `/health` 200 (1882 B), config routes 401 pre-cookie | exit 1 |
| app3 (cookie, unsc
...[truncated 3992 chars]