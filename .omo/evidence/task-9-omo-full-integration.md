# Task 9 evidence — native default with wrapper rollback (breaking)

Plan: `omo-full-integration`, checkbox T9 (Wave 3, final feature checkbox).
Code home: `I:/migration/Alwork` repo. Worktree
`I:/migration/Alwork-wt/t9-native-flip`, branch `ulw/t9-native-flip`,
based at `50786f9` (== `I:/migration/Alwork-wt/wave1` HEAD at lane start;
confirmed before branching). Shared branches (`ui-alcore-readiness`,
`main`) never touched; no push of any base. Commit
`feat(engine)!: native default with wrapper rollback`.

## 1. Reconcile (first design step, recorded per lane brief)

Compared the T1 gate slice
(`I:/migration-wt/omo-full-integration-wave1/.../omo-bridge-runtime.js`,
commit `3c766d2`) against the real bridge on the Alwork line
(`I:/migration/Alwork-wt/wave1/.../omo-bridge-runtime.js`, `50786f9`).

- The live bridge has the T2/T4 evolution the slice predates (live
  Slice-E predicate sources, `omo-invoker-worker.ts` with `--self-test` /
  `--loop-status` / `--barrel-path`, zod) but **none** of the T1 gate:
  no `OMO_NATIVE_OK`, no `resolveBunCommand`, no `checkNativeParity`, no
  runtime `checkNativeParity` method, and `resolveEngineRoot` without the
  `bridgeDir` passthrough. Opt-in is still `OMO_NATIVE_RUN=1`-only.
- **Merge decision: port the gate forward, never re-derive.** The gate
  block (`OMO_NATIVE_OK` + `resolveBunCommand` + `checkNativeParity`) is
  byte-identical to the T1 slice (verified: 4651-char block diff,
  identical; `bun` block identical; `node --check` clean). The five exact
  degraded messages are carried forward verbatim (asserted with `toBe`).
- One deliberate extension beyond the slice: `resolveNativeRunner` gains
  an optional `bridgeDir` param (passes through to `resolveEngineRoot`).
  The slice never called that path with `bridgeDir`, so the slice's tests
  could not catch the missing binding — the first T9 suite run caught it
  as `ReferenceError: bridgeDir is not defined`, fixed, suites green.
  Default stays module-relative, so production behavior is unchanged.

## 2. Flip design (the deep-high decision)

`invoke` path selection, evaluated after the Slice-E model gate and argv
build (both run before any spawn, unchanged):

1. Per-call `native: false` → wrapper. Wins over everything (opt-out).
2. Per-call `native: true` (or explicit `nativeRunner` dep, or
   `OMO_NATIVE_RUN=1`) → `resolveNativeRunner` or throw
   `OMO_NATIVE_UNAVAILABLE`. The pinned never-downgrade test
   (`opt-in flag with unresolvable setup fails fast naming native, never
   downgrades`) covers `=1`; two new tests cover per-call `true`.
3. `OMO_NATIVE_RUN=0` → wrapper (env rollback, kept until deletion).
4. Unset/blank → **the flip**: `checkNativeParity()` with the runtime's
   own deps; pass → native; fail → throw `OMO_NATIVE_UNAVAILABLE` with
   the gate's exact message, zero spawns. No silent downgrade.
5. Any other non-blank value → fail-closed `OMO_NATIVE_UNAVAILABLE`
   naming the value (`Nothing was started.`), zero spawns.
6. `nativeFromEnv: false` keeps the legacy wrapper default (per-call
   `native` still applies).

Rejected alternative: falling back to the wrapper on a failing gate.
That is the auto-fallback T1 proved would violate the pinned
never-downgrade test, and it contradicts the acceptance line
("bun-less machine yields the exact degraded message"). The gate's
`path: 'wrapper'` + "The wrapper path is kept" wording is therefore
data about machine capability; on the flipped default the wrapper is
reached only through the documented rollback (`OMO_NATIVE_RUN=0` /
`native: false`), which is what DOCUMENTATION.md now says.

`probe()` is untouched (still the wrapper `--version` + `run --help`
handshake — it must stay while the wrapper exists). Both production
callers (`packages/web/bin/lib/commands-dag.js`,
`packages/web/server/lib/opencode/core-routes.js:752`) construct the
runtime with defaults, so the flip lands inside `invoke` with **no
caller changes**. Cancel semantics are path-independent (shared
`launchHandle`); a cancel-on-native test pins it.

Runtime surfaces (ui-api-decoupling surface list): web server, desktop
(in-process server), VS Code/managed paths that reach this module, and
the tunnel CLI share one behavior — gate decides, rollback restores the
wrapper. A bun-less server machine gets the exact degraded message on
the default path and a working wrapper through rollback until deletion
(see §6). No renderer-facing capability changes; spawn options
(`windowsHide`, stdio) identical on both paths.

## 3. Changed files (worktree only)

- `packages/web/server/lib/opencode/omo-bridge-runtime.js` (+gate
  block, `bridgeDir` on `resolveEngineRoot`/`resolveNativeRunner`,
  `native` per-call option, gate-default selection, `checkGate` +
  runtime `checkNativeParity` export, header/seam comments).
- `packages/web/server/lib/opencode/omo-bridge-runtime.test.js`
  (imports; 4 wrapper-path invokes pinned with `native: false`; model
  helper pinned with `OMO_NATIVE_RUN=0`; `flag off` test rewritten as
  env-rollback; scripted-cancel asserts `native === true`; new
  `native parity gate` describe with 10 ported T1 tests; new
  `native default (T9 flip)` describe with 8 tests).
- `packages/web/server/lib/opencode/omo-bridge-live-predicates.test.js`
  (T4 helper pinned with `OMO_NATIVE_RUN=0`; T4 asserts Slice-E argv on
  the wrapper contract — 1 line, no T4 semantics changed).
- `packages/web/server/lib/opencode/DOCUMENTATION.md` (bridge bullet:
  native default behind the gate, rollback, bun-less behavior).
- `.omo/evidence/task-9-omo-full-integration.md` (this file).

Not changed: the worker, `probe`, Slice-E logic, callers, wrapper.

## 4. Flip matrix (unit, all stub-spawn deterministic)

| invoke selection | gate/setup | result |
|---|---|---|
| default, capable (`OMO_BUN_PATH` + everything resolvable) | ok | native, job on stdin, `native:true`, exit 0 + result |
| default, `env:{}` (no PATH) | fail | throws exact bun-absent message, 0 spawns |
| default, unresolvable `OMO_BUN_PATH` | fail | throws exact names-the-path message, 0 spawns |
| `OMO_NATIVE_RUN=0` | n/a | wrapper argv, `native:false` |
| `OMO_NATIVE_RUN=1`, unresolvable | n/a | throws, 0 spawns (pinned legacy) |
| `OMO_NATIVE_RUN=banana` | n/a | fail-closed throw naming value, 0 spawns |
| per-call `native:false`, gate passes | ok | wrapper argv, `native:false` |
| per-call `native:true`, unresolvable | n/a | throws, 0 spawns |
| `nativeFromEnv:false`, default | n/a | legacy wrapper default |

## 5. Automated verification (exact commands, worktree cwd
`packages/web/server/lib/opencode` unless noted)

- `bun test omo-bridge-runtime.test.js
  omo-bridge-live-predicates.test.js` → **80 pass / 0 fail**
  (68 bridge incl. 10 ported gate + 8 new flip tests; 12 predicates),
  exit 0. Intermediate runs: baseline 62/0 pre-edit; first post-flip run
  73 pass / 7 fail (the `bridgeDir` ReferenceError + wrapper-argv tests
  taking the native path) — both causes fixed in code/tests, never by
  weakening an assert.
- T3 worker tests (`omo-invoker-worker.loop-status.test.ts`): **15/15
  green in the wave1 worktree** (T3's target worker, sha `58238381`).
  In this worktree the copied test fails at import —
  `Export named 'getLoopStatus' not found` — because this line's worker
  (sha `81ee5cc9`) was refactored post-T3 (zod schemas, inlined loop
  readers; `--loop-status` CLI surface retained, verified by grep:
  `--self-test` / `--engine-root` / `--barrel-path` / `--loop-status`
  all present). No worker test for the current worker shape exists on
  this line. The worker itself is untouched by this lane. Copy removed
  after the run.
- `bunx --package typescript@5.9.2 tsc --noEmit --skipLibCheck
  --allowJs --checkJs false --target es2022 --module nodenext
  omo-bridge-runtime.js omo-bridge-runtime.test.js
  omo-bridge-live-predicates.test.js` → exit 0, no errors.
- `bunx --package oxlint@1.86.0 oxlint -c <temp-empty-json> <same 3
  files>` → 1 pre-existing warning only
  (`omo-bridge-live-predicates.test.js:173` unused `spawn`, outside this
  lane's diff — left alone per backlog rule). No findings in authored
  code. Note: the repo-config run (`bunx oxlint`, `oxlint.config.ts`)
  is blocked in this fresh worktree — the config imports the `oxlint`
  package and there is no `node_modules` until §7's install; adding
  dependencies to fix the harness would violate scope, so the
  default-rules run above plus tsc plus the suites are the static
  story, recorded exactly.
- Every external command ran bounded (60–600 s timeouts); no sleeps or
  network in tests (two pre-existing real-process tests excepted).

## 6. Manual QA (binary PASS/FAIL, `bun C:/Users/dangq/AppData/Local/Temp/t9-qa/driver.mjs`, 16/16)

Real spawns only: real bun + the REAL `omo-invoker-worker.ts` against a
stub engine barrel (exports `run()`; sleeps on `slow` messages), and
real `bun.exe` as the wrapper entry for the wrapper path. Driver exits
1 on any assert miss; every `wait()` bounded at 30 s.

- (a) default invoke on capable fixture → gate `OMO_NATIVE_OK`,
  `handle.native === true`, bun spawned with the real worker,
  `wait()` settled `{exitCode: 0, result.success: true,
  sessionId: 'ses_qa_a'}` — PASS (4/4).
- (b) `OMO_NATIVE_RUN=0` → `native:false`, wrapper argv
  `['run','qa wrapper rollback','--json']`, child ran, settled
  non-zero with null result — PASS (2/2).
- (c) scrubbed `PATH` → throws `OMO_NATIVE_UNAVAILABLE`, message
  byte-exact (`toBe` against the T1 text), zero spawns — PASS (3/3).
- (d) bun-less simulation → exact degraded message on default; wrapper
  still runs under rollback (settled, non-zero) — PASS (2/2).
  Post-deletion fallback (recorded, not executed — wrapper retained):
  default on a capable machine is unaffected; bun-less default fails
  clean with `OMO_NATIVE_UNAVAILABLE`; there is no wrapper to roll back
  to, so bun-less machines need a bun story before deletion (§8 R2).
- Adversarial: `OMO_NATIVE_RUN=banana` → fail-closed throw + 0 spawns;
  cancel mid-native-run (20 s stub barrel) → receipt
  `{provisional:true, alreadyExited:false, escalated:false,
  reason:'qa stop', signal:'SIGTERM'}` and post-kill `wait()` settles
  `{exitCode:null, signal:'SIGTERM'}` — PASS (5/5).
- Prompt-injection N/A with reason: invoke args are structured data
  (message/model/agent/sessionId validated by shape; env values never
  executed — unknown values throw before any spawn).

## 7. Deletion readiness: NOT deleted — NOT READY, remaining gate below

The wrapper path is fully retained. Deletion was considered and
refused; the exact remaining gate:

1. Full Wave 1–3 green on ONE line. This lane's named suites are green
   (bridge 68/68, predicates 12/12, T1 gate 10/10 ported, T3 15/15 on
   its home turf), but sibling lanes live on other branches/worktrees
   (T4 unwired production callers per its own follow-up, T6 pane on
   `ulw/t6-dag-graduation`, wave1 slice ports) — not verifiable from
   here, and the plan demands all of Wave 1–3, not the named subset.
2. A worker test for the CURRENT worker shape. T3's test targets a
   superseded worker (see §5); deleting the only fallback while the
   native worker's own suite doesn't run on this line would be blind.
3. `probe()` + engine-absent contract migration. `probe()` still
   handshakes the wrapper and the degraded message names
   `OMO_WRAPPER_PATH`; deleting invoke's wrapper path while probe
   depends on it splits the contract.
4. Bun-less fallback story. Until bun ships with the install or the
   wrapper is otherwise replaced, `OMO_NATIVE_RUN=0` is the only path
   that works on bun-less machines — deletion must wait for that story.
5. One-release bake per the phase-7 criteria (native default live with
   rollback unused-before-deletion), matching
   `.omo/evidence/phase-7-blocked.md`'s original demand.

## 8. Cleanup receipts

- `C:/Users/dangq/AppData/Local/Temp/t9-qa/` (driver +
  fixture-worker + stub engine root) — removed post-QA; `dir` confirms
  absent.
- `t9-tmp-loop-status.test.ts` (T3 test copy in the opencode dir) —
  removed after the drift run; `git status` confirms absent.
- `C:/Users/dangq/AppData/Local/Temp/t9-oxlint-empty.json` — removed.
- `node_modules/` (frozen-lockfile install for the real-worker QA;
  1671 packages, 2 unrelated link failures in mobile/babel trees,
  tracked files untouched per `git status`) — removed post-verify to
  leave the tree as-found; bridge/predicate suites need no deps.
- `%TEMP%` checked for `omo-t9-qa-*` / `omo-gate-*` leftovers: none.
- No servers started (no pids, no ports). All QA children exited or
  were SIGKILLed defensively in `finally`.

## 9. Risks / follow-ups

- R1 (cross-lane drift): the T1 slice will keep drifting from the real
  bridge; future ports must diff, not assume. The `bridgeDir` gap
  (slice never wired it through `resolveNativeRunner`) is one instance.
- R2 (T3 test rot): `omo-invoker-worker.loop-status.test.ts` cannot run
  against the current worker — whoever owns the worker next should
  re-target or replace it before wrapper deletion (gate item 2).
- R3 (message wording): the five pinned messages say "The wrapper path
  is kept". On the flipped default that now means "reachable through
  rollback", documented here and in DOCUMENTATION.md — not reworded,
  because `toBe` pins the bytes.
- R4 (shared base movement): this branch sits on `50786f9`; if
  `ui-alcore-readiness` moves, rebase is trivial (4–5 files, disjoint
  from lane traffic) but must re-run the suites.
