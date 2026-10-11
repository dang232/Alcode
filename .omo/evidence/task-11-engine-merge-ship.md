# Task 11 — Ship /ulw command + #ulw snippet alias

Branch: `engine-merge-alias` (lane worktree `I:/migration/Alwork-wt/engine-merge-alias`)
HEAD start: `7b3a0cedfdffe3f1b5a4d547bcf035ca86cffaa9` (verified before work)
HEAD end: `2fa7455724b5d4ef9a40f35b2b323eb79a4da7b7` (`2fa7455`)
Commit: `feat(engine): ulw slash command plus snippet alias` — 2 files, 26 insertions, tree clean after.

## Files (only these two; `git status` before commit showed exactly them)

1. `.opencode/commands/ulw.md` — slash command, `description:` frontmatter + prompt body routing to the engine
   ulw workflows (native run, loop-status, worker, driver, skills catalog, DAG pane, tab stats), as-fixes.md pattern.
2. `.opencode/snippet/ulw-engine.md` — frontmatter `aliases: [ulw]`, so `#ulw` expands via the alias registry
   (canonical name `ulw-engine`; alias proves the frontmatter-alias path rather than duplicating the name).

## Verification

Full-server boot from the lane worktree (`bun server/index.js --port 3211`, repo `dev:server` pattern) reached
`OpenChamber server listening on 127.0.0.1:3211` then exited loud on the fixed desktop-Google callback port:

```
error: Desktop Google callback port 57123 is occupied (127.0.0.1). Close the other app using it, then start OpenChamber again.
```

`127.0.0.1:57123` is held by PID 21208 (foreign live process — not touched). The callback port is a fixed constant
(`DESKTOP_PORT = 57123`, "no fallback", occupied → loud startup failure), so the full server cannot boot in this
environment. Verification therefore booted the real route module (`registerConfigEntityRoutes` from
`config-entity-routes.js`) wired to the REAL `commands.js`/`snippets.js` implementations over HTTP on 127.0.0.1:3217
(same code path the full server uses for these endpoints; harness file deleted afterwards). Quoted responses:

`GET /api/config/commands/ulw` → **200**
```json
{"name":"ulw","sources":{"md":{"exists":true,"path":"I:\\migration\\Alwork-wt\\engine-merge-alias\\.opencode\\commands\\ulw.md","scope":"project","legacy":false,"fields":["template","description"]},"json":{"exists":false,"path":"I:\\migration\\Alwork-wt\\engine-merge-alias\\.opencode\\opencode.json","scope":null,"sectionKey":null,"legacy":false,"fields":[]},"projectMd":{"exists":true,"path":"I:\\migration\\Alwork-wt\\engine-merge-alias\\.opencode\\commands\\ulw.md"},"userMd":{"exists":false,"path":"C:\\Users\\dangq\\.config\\opencode\\commands\\ulw.md"}},"scope":"project","isBuiltIn":false}
```

`GET /api/config/commands/ulw/config` → **200** (body = command template)
```json
{"source":"md","scope":"project","path":"I:\\migration\\Alwork-wt\\engine-merge-alias\\.opencode\\commands\\ulw.md","legacy":false,"config":{"template":"You are working in the OpenChamber repository.\n\nGoal: carry out the maintainer's engine request end to end using the OmO engine workflows on this merge line, not the wrapper fallbacks.\n\nFocus, if any: $ARGUMENTS\n\nRoute the request to the workflow it belongs to, then run that workflow's own checks:\n\n- **Native run** — `packages/web/server/lib/opencode/omo-bridge-runtime.js` runs native by gate decision. ...
```

Unknown command probe `GET /api/config/commands/does-not-exist-xyz` → **200, no crash** (route has no 404 path):
```json
{"name":"does-not-exist-xyz","sources":{"md":{"exists":false,"path":null,"scope":null,"legacy":false,"fields":[]},"json":{"exists":false,"path":"I:\\migration\\Alwork-wt\\engine-merge-alias\\.opencode\\opencode.json","scope":null,"sectionKey":null,"legacy":false,"fields":[]},"projectMd":{"exists":false,"path":"I:\\migration\\Alwork-wt\\engine-merge-alias\\.opencode\\commands\\does-not-exist-xyz.md"},"userMd":{"exists":false,"path":"C:\\Users\\dangq\\.config\\opencode\\commands\\does-not-exist-xyz.md"}},"scope":null,"isBuiltIn":true}
```
(Unknown resolves as `isBuiltIn:true, scope:null` — absence signal, never an error.)

`GET /api/config/snippets/ulw` (alias) → **200**
```json
{"name":"ulw-engine","content":"Drive the OmO engine workflows via /ulw: native run through omo-bridge-runtime (OMO_NATIVE_RUN=0 rolls back to the wrapper), read-only loop-status, worker jobs in omo-invoker-worker, loop session driver resume/stop with ownership enforced, skills catalog list/install, bundled desktop-only DAG pane, and tab stats that never render blank. Fixture-only, zero keyed spend.","aliases":["ulw"],"description":"Drive the OmO engine workflows (native run, loop status, worker, driver, skills, DAG pane, tab stats)","filePath":"I:\\migration\\Alwork-wt\\engine-merge-alias\\.opencode\\snippet\\ulw-engine.md","source":"project"}
```

Unknown snippet probe `GET /api/config/snippets/does-not-exist-xyz` → **404, no crash**:
```json
{"error":"Snippet \"does-not-exist-xyz\" not found"}
```

`POST /api/config/snippets/expand` `{"text":"run #ulw now"}` → **200**:
```json
{"text":"run Drive the OmO engine workflows via /ulw: native run through omo-bridge-runtime (OMO_NATIVE_RUN=0 rolls back to the wrapper), read-only loop-status, worker jobs in omo-invoker-worker, loop session driver resume/stop with ownership enforced, skills catalog list/install, bundled desktop-only DAG pane, and tab stats that never render blank. Fixture-only, zero keyed spend. now"}
```

Direct module check agreed: command `source=md scope=project legacy=false`, snippet `name=ulw-engine aliases=["ulw"] source=project`.

## Slash-menu registration (code path, quoted)

`packages/web/server/lib/opencode/commands.js`:
```js
const PROJECT_COMMAND_DIR_NAMES = ['commands', 'command'];
```
`getProjectCommandPath` walks every `.opencode` dir from the working directory up and returns
`<base>/.opencode/commands/ulw.md` — the new file sits exactly there, so `getCommandSources` reports
`scope: project` (proven by the 200 above) and `CommandAutocomplete.tsx → useCommandsStore → server config
routes` lists `/ulw` in the slash menu. `#ulw` menu path: `SnippetAutocomplete.tsx` over `listSnippets`, whose
`getProjectSnippetDirs` registers `.opencode/snippet` — the new snippet's dir (proven by alias 200 above).

## Negatives

- Bare `ulw` behavior unchanged: no interceptor/router/prompt file created — commit touches only the 2 files above.
- Shared branches untouched, nothing pushed. `bun install` in the lane worktree added gitignored deps only
  (2 unrelated link failures: capacitor barcode-scanning, babel safari plugin — mobile/build-only, not server path).
- Cleanup: harness + check scripts deleted, server processes exited, port 3217 connection-refused receipt,
  `git status` empty.

Verdict: PASS (API 200 + registration path proven).

## Landing receipt — engine-merge-alias onto engine-merge-train-t3-group (2026-10-11)

- Pre-merge train HEAD confirmed `0789351fbd3317383bb51449466f0995271adba8` on
  `engine-merge-train-t3-group`; lane `engine-merge-alias` @
  `2fa7455724b5d4ef9a40f35b2b323eb79a4da7b7`.
- `git merge --no-ff engine-merge-alias -m "Merge lane engine-merge-alias: ulw command plus snippet alias"`:
  clean, ort strategy, 2 files (`.opencode/commands/ulw.md`, `.opencode/snippet/ulw-engine.md`).
- Merge commit `37e19e456f0212f3eb6ef2134d92f3ef984ea787`,
  parents `0789351fbd3317383bb51449466f0995271adba8` +
  `2fa7455724b5d4ef9a40f35b2b323eb79a4da7b7`. `git status` clean after.
- Smoke (route-module harness: `registerConfigEntityRoutes` + real `commands.js`/`snippets.js`
  over HTTP on 127.0.0.1:3217 from the train worktree; full server not booted — fixed
  callback port path unchanged from lane evidence):
  - `GET /api/config/commands/ulw` → **200**, `scope: project`,
    path `I:\migration\Alwork-wt\engine-merge-train\.opencode\commands\ulw.md`.
  - `GET /api/config/snippets/does-not-exist-xyz` → **404**
    `{"error":"Snippet \"does-not-exist-xyz\" not found"}`.
- Cleanup: harness server stopped (port 3217 connection-refused receipt), harness file deleted,
  no tags, nothing pushed.
