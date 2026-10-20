# Task 6 evidence — DAG pane graduation to builtin (omo-full-integration, T6)

Code home (live line): `I:/migration/Alwork-wt/wave1`, branch `ui-alcore-readiness` @ `50786f9`
(`packages/dag-pane/` exists only there; `I:/migration/Alwork` main checkout has no `dag-pane/`,
`I:/migration` base has no `packages/` at all).
Task worktree + branch (ALL work done here, nothing committed, nothing pushed):
`I:/migration/Alwork-wt/t6-dag-graduation`, branch `ulw/t6-dag-graduation` (off `50786f9`).

Scope kept: desktop-only gating preserved, web/VSCode/mobile untouched, scheduler/bridge
internals untouched (bridge file not modified; service only repoints its relative import
after the move and inlines the bridge at build time).

## Guest-id decision (recorded)

- Renamed guest id `omo-dag-pane` -> `openchamber-builtin-dag-pane`. Keeping the old id was
  impossible: `builtInExtensionSchema` requires `/^openchamber-builtin-[a-z][a-z0-9-]*$/` and the
  build throws `inspected.guest.id !== entry.id` on mismatch, so the manifest `panel.id` must
  carry the reserved prefix. This also keeps the reserved-namespace guarantee (user installs
  can never claim/steal the id — `catalog.js` skips reserved ids in user paths).
- Kept directory `dag-pane` (registry maps id -> directory, same pattern as the build-test
  fixture `openchamber-builtin-fixture` -> `fixture`). Minimal move, stable docs/paths.
- Kept private npm `name: omo-dag-pane` (only remaining `omo-dag-pane` string in tracked files;
  not authority-bearing, not user-visible; renaming it would churn nothing of value).
- `DAG_SERVICE_NAME`, service log lines, panel offline note, and doc/comment headers follow the
  new id. Old folder installs under `omo-dag-pane` keep working side-by-side (different id,
  not reserved, not shadowed — asserted in QA: catalog contains only the builtin id).

## What changed (worktree `ulw/t6-dag-graduation`, uncommitted)

- `packages/dag-pane/` -> `packages/extensions/dag-pane/` (`git mv`, history preserved).
  The builtin build only accepts directories inside `packages/extensions/`; the old top-level
  path was also a `packages/*` Bun workspace, the new path correctly is not (extensions dir
  is not a workspace; SDK imports resolve via the build's public-SDK plugin).
- `packages/extensions/dag-pane/package.json`: `panel.id` -> `openchamber-builtin-dag-pane`,
  description -> builtin (no folder install).
- `packages/extensions/dag-pane/service/handlers.js`: bridge import `../../web/...` ->
  `../../../web/...` (move depth), `DAG_SERVICE_NAME` renamed. No logic change.
- `packages/extensions/dag-pane/service/main.js`: log strings renamed. No logic change.
- `packages/extensions/dag-pane/service/handlers.test.js`: health expectation renamed;
  bridge import depth fixed.
- `packages/extensions/dag-pane/panel/{main.ts,note string,dag-view.ts,strings.ts}`: id/comment
  updates only. `panel/main.js` (checked-in IIFE) regenerated from the builtin build output
  (byte-identical to what ships).
- `packages/extensions/dag-pane/panel/dag-view.test.ts`: fixture import depth fixed.
- `packages/extensions/registry.json`: allowlist entry `{id: openchamber-builtin-dag-pane,
  directory: dag-pane, files: [panel/index.html, icon.svg], build: [panel/main.ts->panel/main.js
  (browser IIFE), service/main.js->service/main.js (node ESM)]}`.
- `packages/ui/src/lib/surfaces/registry.ts`: `DESKTOP_ONLY_PLUGIN_SURFACE_IDS` ->
  `['plugin:openchamber-builtin-dag-pane']` (desktop-only gating preserved across the rename).
- `packages/ui/src/lib/surfaces/registry.test.ts`: DAG test uses the new plugin id.
- `packages/extensions/README.md`: registry no longer empty (lists the pane).
- `packages/extensions/dag-pane/DOCUMENTATION.md`: rewritten third-party framing -> builtin
  (registry entry, build outputs, no manual install, grants, desktop-only).
- `bun.lock`: workspace removal only (`packages/dag-pane` + `omo-dag-pane@workspace` lines,
  6 deletions; `git diff bun.lock` verified).

## Service-grant audit

- Manifest declares `{panel, service:{runtime host, entry}, attach:false}` — no `capabilities`,
  `integration`, `filesystem`, `origins`, or `actions`.
- `requestedGuestCapabilities` therefore yields exactly `['service']` (service presence adds it).
- Bundled path (`catalog.js listInstalledGuestsUncached`): `capabilityGrants = requested`
  (automatic, no approval dialog, nothing persisted), `enabled` by default, `path: null`,
  service permissions empty (exec/sockets scope empty). Disable stops the service while
  retaining data/credentials (generic builtin mechanism, covered by existing
  `builtins.test.js` service test). QA asserts grants `== ["service"]` on a fresh fixture root.
- No credential, network, filesystem, or model capability is requested or granted.

## Automated verification (commands run in the task worktree)

- `bun test packages/extensions/dag-pane/panel/dag-view.test.ts` — 17 pass, 0 fail.
- `bun test packages/extensions/dag-pane/service/handlers.test.js` — 9 pass, 0 fail.
- `bun test packages/ui/src/lib/surfaces/registry.test.ts` — 10 pass, 0 fail.
- `bun test scripts/build-builtin-extensions.test.mjs` — 4 pass, 1 skip (win32-only skip,
  pre-existing platform guard).
- `bun test packages/web/server/lib/guests/builtins.test.js` — 6 pass, 1 fail, where the
  failure is `rejects invalid registries...` EPERM on `fs.symlink` (Windows privilege).
  Proven pre-existing: identical 6/1 result on the untouched base line
  `I:/migration/Alwork-wt/wave1` in the same session. Catalog code untouched by this task.
- `bun scripts/build-builtin-extensions.mjs` — `Built 1 built-in extension(s).` (run 4x total:
  initial, postinstall-triggered, QA scratch rebuild, 2x stability rebuilds).
- `bun run --cwd packages/ui type-check` (`tsc --noEmit`) — clean.
- `bunx oxlint` on all changed TS/JS — clean.
- `node --check` on source + bundled service entries — `SYNTAX-OK`.
- `bun run --cwd packages/ui lint` — 3 errors / 10 warnings, byte-identical set on the base
  line (`DESKTOP_AUTH_TIMEOUT_MS` unused, react-refresh export rules in unrelated files);
  zero hits in touched files. Pre-existing, left alone per minimal-change rule.

## Manual-QA channel (install class): PASS 24/24

Script `/tmp/t6-qa.mjs` (since removed, see cleanup), run as `bun /tmp/t6-qa.mjs` from the
worktree. Clean fixture root per run (`mkdtemp`), bundle rebuilt from scratch
(`rm -rf packages/web/server/built-in-extensions` first). Binary result: **PASS 24/24**.
Paths + excerpts:

- Bundle contents asserted on disk under
  `packages/web/server/built-in-extensions/dag-pane/` (the subtree Electron unpacks to
  `app.asar.unpacked/node_modules/@openchamber/web/server/built-in-extensions/`):
  `panel/index.html` (2282b), `panel/main.js` (71159b, contains `dag-graph` + the string
  `openchamber-builtin-dag-pane loads only`, no old-id string), `icon.svg` (417b),
  `service/main.js` (31880b ESM, bridge event `omo.dag.updated` inlined), `package.json`
  (id matches registry, version stamped `2.1.1` == app version), no `.test.` files shipped.
- Electron `packages/electron/package.json` `build.asarUnpack[0]` ==
  `node_modules/@openchamber/web/server/built-in-extensions/**/*` (excerpts in QA log).
- Fresh-install fixture (`registerBuiltInGuests` on a clean tmp persist root + built bundle,
  `listInstalledGuests`): 1 guest, id `openchamber-builtin-dag-pane`, `source: 'bundled'`,
  `enabled: true`, `capabilityGrants: ["service"]`, `resolveGuestAssetPath` resolves icon,
  panel entry, and service entry inside the bundle; no `omo-dag-pane` row.
- Adversarial invalid entry (temp sourceRoot, id `omo-dag-pane`): build rejects loudly with
  zod `invalid_format ... /^openchamber-builtin-[a-z][a-z0-9-]*$/` at `extensions.0.id`
  (never silently missing).
- Flaky guard: build + reinstall run 2x, registry + file listing byte-identical.
- Shipped service boot probe: `node .../service/main.js` with test port/token answers
  `GET /health` → `{"ok":true,"service":"openchamber-builtin-dag-pane"}`, no-token → 401,
  `GET /status` → probe `OMO_ENGINE_ABSENT`, `sessions: []` (fail-closed, no engine here).

## Adversarial ledger

- malformed input: invalid registry id -> loud zod rejection (above). Done.
- stale_state: fixture roots are fresh `mkdtemp` dirs per run; bundle rebuilt from scratch
  after `rm -rf`. Done.
- dirty_worktree: `git status` shows only T6 files (move R/D pairs + M registry/surfaces/docs/
  lockfile + untracked `.omo/evidence/task-6-*`); shared branches untouched, no commits, no
  pushes. Done.
- hung commands: build/QA/install run under explicit timeouts (120–280s); nothing hung. Done.
- flaky: rebuild + reinstall 2x stable; pane/service/surface suites re-run green after every
  edit round. Done.
- misleading_success: every QA assert reads bundle/catalog bytes, never log text. Done.
- repeated interruptions: postinstall re-ran `extensions:build` mid-task (`Built 1...`)
  and the tree stayed green; QA scratch-rebuild repeats the proof. Done.
- prompt-injection/cancel-resume: N/A — static packaging change, no prompts, no resumable
  user flow, no secrets handled (service bearer is runtime env, never logged).

## Risks / non-goals

- Full Electron packaging/signing not run on this box (out of scope for an install-class
  lane); ASAR coverage is proven via config + bundle-layout assertions, not a packaged app.
- `bun install` in this Windows worktree reports 2 pre-existing link failures
  (`@capacitor-mlkit/barcode-scanning`, `@babel/plugin-bugfix-safari-...`) and the
  postinstall electron-binary ensure step fails; identical on the base line, unrelated to T6.
- VS Code/mobile/web surfaces intentionally unchanged; old `omo-dag-pane` folder installs
  remain valid third-party guests and are NOT migrated (no stored-data conversion needed —
  builtin storage/disabled keys live under the new id).

## Cleanup receipts

- Fixture roots removed by the QA script itself:
  `C:\Users\dangq\AppData\Local\Temp\t6-install-vPiqML`,
  `C:\Users\dangq\AppData\Local\Temp\t6-badreg-9NHZSJ` (both `rm -rf`, script-logged).
- `/tmp/t6-qa.mjs` removed after the green run.
- Generated bundle output `packages/web/server/built-in-extensions/` removed after evidence
  recorded (gitignored; regenerates via `bun run extensions:build` / postinstall).
