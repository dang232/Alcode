# openchamber-builtin-dag-pane — DAG side pane guest

Built-in SDK guest (project-ide todo 13, graduated to app-owned). Panel id
`openchamber-builtin-dag-pane` under `packages/extensions/dag-pane`
(registry id carries the reserved prefix; the directory keeps the short
`dag-pane` name, the same id-to-directory mapping the build tests use for
fixtures). Never the Herdr dashboard. The guest renders OmO run graphs
with node details and steers/cancels the live session. Hosted by the
Electron desktop shell's webview only: the rail hides its surface
everywhere else (see `packages/ui/src/lib/surfaces/registry.ts`,
`DESKTOP_ONLY_PLUGIN_SURFACE_IDS`). No web, VS Code, or mobile pane host
exists for this guest.

## Layout

- `package.json` — the builtin manifest (package envelope: `openchamber`
  block; the build stamps `version` with the app version).
  `panel.entry` is `panel/index.html`; `service.entry` is
  `service/main.js` (`runtime: "host"`, no permissions declared).
  `attach: false`, so the guest never appears on composer + menus; the
  rail icon is the manual entry point, and a sent ulw/ultrawork prompt
  reveals the pane once (`revealDagPaneForUlvStart` in
  `packages/ui/src/lib/dagAutoOpen.ts`, called from the composer send
  path — never on render).
- `panel/index.html` — iframe entry. Loads the checked-in classic IIFE
  `panel/main.js` (the sandbox cannot load ESM). Page CSS uses only
  `var(--oc-*)` host tokens; spacing follows the 8px scale.
- `panel/main.ts` — guest source. `connectHost`, `applyHostReady` from the
  first `onReady`, kit primitives (`mountButton`, `mountTextField`,
  `mountSelect`, `mountBadge`, `mountBanner`, `mountEmpty`,
  `mountSpinner`). The offline banner follows the pane service's
  `GET /status` probe, never the OAuth-account connection flag (which
  reads permanently disconnected for this integration-less guest). The graph itself is custom inline SVG (the kit ships no
  graph primitive): nodes laid out by payload `waves`, edges as lines,
  click/Enter selects a node for the details card. Colors come only from
  host tokens (running = primary, completed = success, failed = error,
  pending = muted; selection pair for the picked node).
- `panel/dag-view.ts` — pure snapshot-to-view parser, no DOM. A `null`
  dag is an empty view; any other shape break is `DAG_SNAPSHOT_MALFORMED`
  with the field named, and the panel renders that as an error card with
  Retry — never blank.
- `panel/strings.ts` — package dictionaries for all 13 host locales,
  picked from `ready.locale` (exact, then language prefix, then English).
- `panel/main.js` — built IIFE, checked in, kept byte-identical to the
  builtin build output. Regenerate with `bun run extensions:build` from
  the repository root and copy
  `packages/web/server/built-in-extensions/dag-pane/panel/main.js` back
  here. `panel/*.test.ts` runs under `bun test`.
- `service/handlers.js` — `createDagServiceHandlers({ fs, snapshotDir,
  createBridge })`. Wraps the adapter-A bridge (`packages/web/server/lib/
  opencode/omo-bridge-runtime.js`, imported relatively and inlined into
  the shipped bundle by the node build entry): `GET /status` (probe +
  snapshot sessions), `GET /snapshot?sessionId=`, `POST /steer` (invoke
  attached to the live session, handle kept for cancel), `POST /cancel`
  (provisional kill receipt). Engine-absent steers answer 503 with the
  bridge's degraded message.
- `service/main.js` — loopback entry and node build entry. Requires
  `OPENCHAMBER_SERVICE_PORT` + `OPENCHAMBER_SERVICE_TOKEN`, enforces the
  bearer on every request including `/health`, binds 127.0.0.1 only. The
  shipped bundle is the self-contained ESM the builtin build produces;
  the host never compiles TypeScript.

## Data path

Snapshots live in the OS temp dir under `omo-dag-snapshots/
<sessionId>.snapshot.json` (override with `OMO_SNAPSHOT_DIR` where the
process inherits user env — the CLI; the service sandbox does not, so the
service always uses the default and the CLI defaults to the same). The
panel never touches the filesystem: it calls `serviceRequest`, and the
service reads the file. The wrapper entry for steering is per-guest
storage (`wrapperEntry`, edited in the panel); with no entry anywhere the
bridge resolves the native/vendored engine before answering engine-absent,
so the field is an optional override rather than a mandatory setup step.

## Ship (desktop, no manual install)

`packages/extensions/registry.json` maps `openchamber-builtin-dag-pane`
to this directory with explicit files (`panel/index.html`, `icon.svg`)
and build entries (`panel/main.ts` → browser IIFE, `service/main.js` →
node ESM). `bun run extensions:build` stages the bundle under
`packages/web/server/built-in-extensions/` (generated, git-ignored,
shipped in the web package and unpacked from ASAR for Electron service
entries). A fresh install shows the DAG rail icon with no Settings →
Extensions folder install. The guest ships enabled with exactly the
`service` grant (its only declaration) and no approval dialog; disable
stops the service while retaining data and credentials.
