# Task 8 evidence — Merge T6 DAG pane graduation (engine-merge-ship)

Branch: `engine-merge-t6` @ `5669843c4690b9ca5c87d29fd3af1593aa40f465`
Worktree: `I:/migration/Alwork-wt/engine-merge-t6` (only location touched; orchestrator lands it)
Lane: `ulw/t6-dag-graduation` @ `489eaec0d2b8a2790ba38a7d37d8df522627655d` (untouched, still at 489eaec0)
Base: `7b3a0ce` (HEAD verified equal before merge; both base and lane are ancestors of the merge)

## Merge record

- `git merge --no-ff ulw/t6-dag-graduation -m 'feat(engine): merged dag-pane graduation'`
- Result: clean, zero conflicts, zero manual resolutions (train added bridge/worker/loop files
  only — disjoint from T6's extensions/registry/surfaces set). Merge commit auto-created and kept:
  `5669843` with parents `7b3a0ce` + `489eaec0`.
- File set in merge == lane file set (20 files: dag-pane move, registry.json allowlist entry,
  builtin bundle sources, desktop-only gate on the new id, service grants intact). No web/VSCode/
  mobile files, no old-folder migration, no shared-branch history rewritten, nothing pushed.

## Covering tests (behavior of record)

- Baseline on unchanged `7b3a0ce`:
  `bun test packages/dag-pane/panel/dag-view.test.ts packages/dag-pane/service/handlers.test.js
  packages/ui/src/lib/surfaces/registry.test.ts` → **36 pass, 0 fail** (17 + 9 + 10).
- Post-merge (moved paths):
  `bun test packages/extensions/dag-pane/panel/dag-view.test.ts
  packages/extensions/dag-pane/service/handlers.test.js packages/ui/src/lib/surfaces/registry.test.ts`
  → **36 pass, 0 fail**, 137 expect() calls — identical to baseline.
- `bun test scripts/build-builtin-extensions.test.mjs` → **4 pass, 1 skip, 0 fail**
  (same win32-only skip as lane evidence).
- Deps note: fresh worktree had no node_modules; `bun install --ignore-scripts` exits 0 with the
  same 2 pre-existing link failures the lane recorded (`@capacitor-mlkit/barcode-scanning`,
  `@babel/plugin-bugfix-safari-id-destructuring-collision-in-function-expression`).
  First full `bun install` stalled under box contention and was killed before touching tracked
  files (worktree verified clean before merge).

## Verification (exact, quoted)

Build (scratch rebuild, `rm -rf packages/web/server/built-in-extensions` first):

```
$ bun scripts/build-builtin-extensions.mjs
Built 1 built-in extension(s).
```

Fixture QA script (scratch, run as `bun t8-qa.mjs` from the worktree, removed after) — **21/21 PASS**,
every assert on bytes/listings, never log text:

```
PASS bundle file panel/index.html — 2282b
PASS bundle file panel/main.js — 71159b
PASS bundle file icon.svg — 417b
PASS bundle file service/main.js — 36499b
PASS bundle file package.json — 674b
PASS panel bundle contains dag-graph
PASS panel bundle carries new id
PASS panel bundle has no old id
PASS service bundle inlines bridge event
PASS manifest id matches registry — openchamber-builtin-dag-pane
PASS no test files shipped
PASS fresh root lists 1 guest — got 1
PASS guest id is builtin — openchamber-builtin-dag-pane
PASS guest source bundled — bundled
PASS guest enabled by default — true
PASS grants exactly [service] — ["service"]
PASS no old-id row
PASS invalid id rejected loudly — [{ "origin": "string", "code": "invalid_format",
  "format": "regex", "pattern": "/^openchamber-builtin-[a-z][a-z0-9-]*$/", ...
PASS service /health ok — {"ok":true,"service":"openchamber-builtin-dag-pane"}
PASS service no-token 401 — 401
PASS service /status fail-closed — {...,"code":"OMO_ENGINE_ABSENT",... "sessions":[] ...}
21/21 PASS
```

Notes:
- `service/main.js` is 36499b here vs 31880b in the lane run: expected — the merged train's
  bridge runtime (T4/T1/T9 group) is inlined into the service bundle at build time. Content
  assertions (`omo.dag.updated` present, /health + /status behavior) hold.
- `registry.json` in the bundle directory + `packages/electron` asarUnpack layout unchanged
  from lane evidence (config + bundle-layout assertion class, same as the lane).

MANUAL-QA CHANNEL verdict: **PASS** — `Built 1 built-in` AND pane listed enabled on fresh root.

## Adversarial ledger

- malformed_input: temp sourceRoot with id `omo-dag-pane` → loud zod `invalid_format`
  `/^openchamber-builtin-...$/` rejection (quoted above). Done.
- stale_state: HEAD start `7b3a0ce` / end `5669843` recorded; bundle rebuilt from scratch
  (`rm -rf` first); fixture persist roots fresh mkdtemp per run. Done.
- dirty_worktree: post-work `git status --short` empty; merge file set == lane file set only
  (20 T6 files); lane branch still at 489eaec0; no shared branches touched, no pushes. Done.
- misleading_success_output: bundle sizes/hashes + `listInstalledGuests` row asserted from disk/
  catalog bytes; rebuild hashes compared (`REBUILD-IDENTICAL`), not log text. Done.
- flaky_tests: scratch rebuild run 3x total, last two hash-compared byte-identical
  (`REBUILD-IDENTICAL`); covering suites green pre- and post-merge with identical counts. Done.
- hung_commands: build/QA/install bounded (120–600s); one stalled full `bun install` killed,
  recorded above, no hang left behind. Done.
- prompt_injection / cancel_resume: N/A — static packaging merge, no prompts, no resumable flow.
- repeated_interrupts: N/A — single merge commit, no interrupted runs resumed.

## Cleanup receipts

- `packages/web/server/built-in-extensions/` removed after evidence (gitignored; regenerates via
  `bun run extensions:build`).
- QA script + hash scratch files removed (`t8-qa.mjs`, `t8-h2.txt`, `t8-h3.txt`); first-run temp
  fixture dirs (`t8-install-*`, `t8-badreg-*`, `t8-badout-*`) removed from system temp.
- QA service child SIGKILLed by the script; stalled install session killed; no servers running.
- One leftover: `/tmp/t8-qa.mjs` exists only in the tool-write namespace (never on shell disk,
  superseded fixed copy was used and removed); no repo or disk footprint.

## Landing receipt — train engine-merge-train-t3-group

- Pre-merge train HEAD verified == `bca06f4170b545096f87bcdab52945dbcb82a325` (not moved; proceeded).
- `git merge --no-ff engine-merge-t6 -m "Merge lane engine-merge-t6: dag-pane graduation"` — clean, ort strategy, zero conflicts.
- Merge commit: `0789351fbd3317383bb51449466f0995271adba8`; parents `bca06f4` + `5669843`.
- Post-merge `git status --porcelain` clean; `git log --oneline -3`: 0789351 (merge) / bca06f4 (T5) / 5669843 (T6).
- Smoke (no bun install needed; node_modules present):
  `bun test packages/extensions/dag-pane/panel/dag-view.test.ts packages/extensions/dag-pane/service/handlers.test.js packages/ui/src/lib/surfaces/registry.test.ts packages/web/server/lib/opencode/omo-loop-driver.test.ts`
  → **46 pass, 0 fail** across 4 files, exit 0.
- No tags created. No cleanup needed.
