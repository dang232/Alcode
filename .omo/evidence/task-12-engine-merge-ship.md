# Task 12 evidence — engine-merge-ship: full package chain + unsigned unpacked build

- Train: `I:/migration/Alwork-wt/engine-merge-train`, branch `engine-merge-train-t3-group`
- HEAD start: `7a3ba9138d9f3e34abaf5ce67df7dadcddd0308c` — HEAD end: identical (verified post-build; `git status --porcelain` empty)
- Toolchain preflight: `node v24.15.0`, `bun 1.4.2` (both exit 0)
- No repo fix was required. Zero commits. `bun.lock` hash unchanged (`87f75c8…`). All repairs were environment-local (gitignored `node_modules`, machine tool caches, `%TEMP%`-style scratch). `packages/electron/dist/` is gitignored (`packages/electron/.gitignore:5:dist/`).

## Canonical chain (README order), all on merged tree

| # | Step (cwd `packages/electron`) | Exit | Runtime | Tail line |
|---|---|---|---|---|
| 1 | `node ./scripts/build-web-assets.mjs` | 0 | 109s | `[electron] web assets ready: …\packages\electron\resources\web-dist` (vite `✓ built in 1m 46s`, PWA `sw.js 1.16 kB`) |
| 2 | `node ./scripts/prepare-opencode-cli.mjs` | 0 | 5s | `[electron] prepared OpenCode CLI 2.0.23: …\resources\opencode-cli\opencode.exe` |
| 3 | `bun ./scripts/bundle-main.mjs` | 0 | ~0s | `[electron] main process bundled -> dist-bundle/{entry,main,early-startup}.mjs (updater E2E=false)` |
| 4 | `node ./scripts/rebuild-native.mjs` | 0 | 23s | `[electron] native modules rebuilt successfully` (Electron 43.7.0, modules `node-pty`, `bun-pty`) |
| 5 | `node ./scripts/package.mjs --dir` | 0 | 20s | `packaging platform=win32 arch=x64 electron=43.7.0 appOutDir=dist\win-unpacked` … signing skipped, rcedit stamping + asar integrity applied |

Note on step 5 flags: `--dir` forwards through `package.mjs` to electron-builder (unsigned path, `CSC_IDENTITY_AUTO_DISCOVERY=false` logged by the script). `--dir` was required because NSIS (`makensis`) is not installed on this machine, and the installer is explicitly not the verify target. No other flags.

## Environment repairs (NOT repo changes — nothing committed)

1. **Corrupt bun store entry (blocked step 1).** `bun run build` (vite PWA stage) failed: `Cannot find module '@babel/plugin-bugfix-safari-id-destructuring-collision-in-function-expression'` required from `@babel/preset-env/.../available-plugins.js` under Node. Root cause: store dir `node_modules/.bun/@babel+plugin-bugfix-safari-id-destructuring-collision-in-function-expression@7.27.1+b097dd6c05d04ee2/...` contained only `lib/` (no `package.json`). `bun install` (×2, incl. after full `bun pm cache rm`) deterministically failed to link it: `ENOENT … failed to link package (copyfile)` — same for `@capacitor-mlkit/barcode-scanning@8.1.0` (mobile-only dep, irrelevant to this chain; left as-is). Repair: downloaded the exact-version tarball from registry.npmjs.org and extracted it into the canonical store path (5 files: `package.json`, `README.md`, `LICENSE`, `lib/`). Node probe `require(available-plugins.js)` → `PROBE OK`. Full store scan (1676 entries) confirmed these were the only corrupt entries (the capacitor one + this one). `bun.lock` untouched.
2. **Missing Spectre-mitigated VC++ libs (blocked step 4).** `rebuild-native.mjs` failed in `node-pty` with `error MSB8040: Spectre-mitigated libraries are required` (VS18 BuildTools present, `lib/*/spectre` absent; non-admin session so VS Installer modify/UAC path unavailable). Upstream `node-pty@1.2.0-beta.15/binding.gyp` hardcodes `'SpectreMitigation': 'Spectre'`. Repair: flipped to `'false'` in the **gitignored** store copy only. `/guard:cf`, `/sdl` etc. retained. Unsigned local QA build only. Re-ran step 4 → exit 0.
3. **No symlink privilege (blocked step 5).** electron-builder's `app-builder.exe rcedit` natively downloads `winCodeSign-2.6.0.7z` and extracts with 7za; the archive contains two darwin symlinks (`libcrypto.dylib`, `libssl.dylib`) and this non-admin, non-Developer-Mode session cannot create symlinks (`whoami /priv` shows no `SeCreateSymbolicLinkPrivilege`). Pre-seeding impossible (fresh random cache dir per attempt). Repair: `7za.exe` (gitignored 7zip-bin copy) renamed to `7za-real.exe`; new `7za.exe` is a `bun build --compile` passthrough shim that maps exit 2 → 0 **only** when stderr shows solely symlink-privilege errors (CRC/data/open errors still fail). Shim test on the real archive: exit 0, all files incl. `rcedit-x64.exe` extracted. rcedit then genuinely stamped the exe (proof below). `ELECTRON_BUILDER_RCEDIT_PATH` was also staged but is **not** what unblocked the build (native `app-builder rcedit` path ignores it) — recorded to avoid confusion.
4. Missing-toolchain quote (adversarial probe): `ERROR: Cannot create symbolic link : A required privilege is not held by the client. : …\winCodeSign\<hash>\darwin\10.12\lib\{libcrypto,libssl}.dylib` → `⨯ cannot execute cause=exit status 2`.

## Verification — unpacked run directory (the deliverable)

`packages/electron/dist/win-unpacked/` — top: `OpenChamber.exe`, `resources/`, Electron runtime DLLs/paks, `locales/`.
- `resources/`: `app.asar` (137,163,476 B), `app.asar.unpacked/`, `web-dist/` (24 entries, `index.html` 26,810 B present), `opencode-cli/opencode.exe` (206,234,504 B), `icons/`.
- `app.asar.unpacked/node_modules/@openchamber/web/server/built-in-extensions/`: `dag-pane/` (`package.json`, `icon.svg`, `panel/index.html` + `panel/main.js` 71,159 B, `service/main.js` 36,462 B) + `registry.json`.
- Exe version stamp (rcedit proof): `ProductName=OpenChamber FileVersion=2.1.1 LegalCopyright=Copyright © 2026 OpenChamber`.
- `resources/opencode-cli/opencode.exe --version` → `opencode v2.0.23`, exit 0.

Hashes (sha256):
- `OpenChamber.exe` (239,636,480 B): `8c1e79b4…9b1abbd` → full: `8c1e79b480cfcb1a8f3c624c01c200ac320411c3e38265083d3b3f8f2091abbd`
- `resources/app.asar`: `b4b0208c74074a9d5b3af9afe7b443292bfb291bad6b058e6f4ace8feb062f14`
- `resources/opencode-cli/opencode.exe`: `07966ec56592564cf89c52c25f8f1d5cdc600ae4a07af30dfdc5a588f316c8a9`
- `resources/web-dist/index.html`: `e233ecf5ddf774972a32d2ce8d5e72916fd9ff1b9b137d072bc56cb994abbad9`

## Manual-QA channel (launch proof)

- Launched `dist\win-unpacked\OpenChamber.exe` (pid 45176): process **alive 75s+**, backend fully initialized per `%AppData%\Roaming\OpenChamber\logs\main.log` (`app starting`, `OpenChamber server listening on 127.0.0.1:57123`, managed `opencode.exe serve … --port 59731` from unpacked resources, update check ran). No crash lines in this run.
- Splash/window **not observable**: `MainWindowHandle=0`, empty title across 12×5s polls. Cause: this session is non-interactive (`qwinsta`: own context = `services`, `Disc`; interactive desktop is `console/dangq` session 1, unreachable from here). GUI observation is impossible headless-from-session-0.
- Next-best proof delivered instead: exe exists + stamped version info (above) + `opencode --version` (above) + live-server log lines. The app later exited on its own (~75–100s, no shutdown/crash line — reason undetermined, possibly window-station related).
- Verifier (todo 13, interactive session): run `packages\electron\dist\win-unpacked\OpenChamber.exe` from the logged-in desktop and observe the splash → main window. Expect first-paint within ~30s (server boot took ~1s here once running).

## Cleanup receipts

- Launched app processes: none remain (`Get-Process OpenChamber,opencode` empty; no listener on 59731). The app reaped its managed opencode server on exit. Nothing had to be force-killed.
- `dist/` left in place — it IS the todo-13 deliverable: `I:/migration/Alwork-wt/engine-merge-train/packages/electron/dist/win-unpacked`.
- Scratch removed: `C:/Users/dangq/.omo-tmp/task12/{tarballs,shim-test}`. Kept (outside repo, documented): 7za shim in gitignored node_modules (`7za-real.exe` preserved; reversible), staged rcedit dir, step logs under `.omo-tmp/task12/`.
- No git operations beyond reads; no pushes; no signing/notarization (no certs on machine).

## Risks / notes for later todos

- The 7za shim + node-pty spectre flip + babel store repair live in gitignored `node_modules`: any fresh `bun install` (or worktree re-provision) will wipe them and the chain will fail the same way until the machine gains Developer Mode/symlink privilege + Spectre libs + NSIS. Recommend machine-level fixes before release packaging.
- `@capacitor-mlkit/barcode-scanning@8.1.0` still fails `bun install` linking (same ENOENT class) — mobile-only, irrelevant here, but `bun install` exits 1 on this worktree.
- N/A one-liners: malformed_input (well-formed plan input), prompt_injection (none observed), cancel_resume (no interrupts; single continuous run), flaky_tests (single build; runtimes quoted per step), repeated_interrupts (none).
