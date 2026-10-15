# alcode-builtin-dag-pane — DAG side pane guest

Built-in SDK guest (project-ide todo 13, graduated to app-owned). Panel id
`alcode-builtin-dag-pane` under `packages/extensions/dag-pane`
(registry id carries the reserved prefix; the directory keeps the short
`dag-pane` name, the same id-to-directory mapping the build tests use for
fixtures). Never the Herdr dashboard. The guest renders OmO run graphs
with node details and steers/cancels the live session. Hosted by the
Electron desktop shell's webview only: the rail hides its surface
everywhere else (see `packages/ui/src/lib/surfaces/registry.ts`,
`DESKTOP_ONLY_PLUGIN_SURFACE_IDS`). No web, VS Code, or mobile pane host
exists for this guest.

## Layout

- `package.json` — the builtin manifest (package envelope: `alcode`
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
- The panel follows the active conversation: the host posts the run model
  (`run-model` channel, bridge snapshot shape, `null` when the
  conversation holds no delegation evidence) and the panel binds to
  `hostSessionId` only — no session picker, no manual pin. The host model
  wins for the active conversation; the service snapshot, then the /loop
  projection, cover steer- and loop-initiated runs the store never sees.
  Stale answers never paint: every conversation switch and refresh takes a
  generation. A run-model post is held even when it arrives before its
  conversation binds (the host sends it from its own effect); on a switch
  the stored post survives only when it names the newly bound
  conversation, and painting still requires the stored conversation to
  equal the active one.
- `service/handlers.js` — `createDagServiceHandlers({ fs, snapshotDir,
  createBridge })`. Wraps the adapter-A bridge (`packages/web/server/lib/
  opencode/omo-bridge-runtime.js`, imported relatively and inlined into
  the shipped bundle by the node build entry): `GET /status` (probe +
  snapshot sessions + read-only `loopRuns` + read-only `liveRuns` for
  steers this service still tracks), `GET /snapshot?sessionId=`,
  `GET /loop?sessionId=&directory=` (loop-state projection in the snapshot
  document shape, live-run pending fallback keyed on liveness with the
  route report refining the label when present), `POST /steer` (invoke
  attached to the live session, handle kept for cancel; on settle the
  service records a completion snapshot — pending shape flipped to
  completed/failed with the observed outcome — unless richer snapshot
  data already landed, never on cancel), `POST /cancel`
  (provisional kill receipt). `GET /history?directory=` lists past runs:
  completed snapshots plus terminal loop rows, newest first, capped;
  malformed snapshots counted as skipped; live runs never listed.
  `/steer` accepts an optional `directory` so the completion snapshot
  records its project scope for the History filter. Engine-absent steers answer 503 with the
  bridge's degraded message. Loop rows never write: the loop engine owns
  `.omo/ulw-loop/*`, the bridge owns the snapshots, and the service only
  reads both plus its in-memory per-session route registry (50 entries,
  restart-cleared). `POST /debug/route` upserts the registry; `GET /status`
  accepts the panel directory and merges snapshot ids first, loop-only ids
  after; the panel paints `/loop` while `/snapshot` 404s, and snapshot
  data wins once it lands.
- `service/main.js` — loopback entry and node build entry. Requires
  `ALCODE_SERVICE_PORT` + `ALCODE_SERVICE_TOKEN`, enforces the
  bearer on every request including `/health`, binds 127.0.0.1 only. The
  shipped bundle is the self-contained ESM the builtin build produces;
  the host never compiles TypeScript.

## Data path

Steer/loop snapshots live in the OS temp dir under `omo-dag-snapshots/
<sessionId>.snapshot.json` (override with `OMO_SNAPSHOT_DIR` where the
process inherits user env — the CLI; the service sandbox does not, so the
service always uses the default and the CLI defaults to the same).
Chat-path runs (native engine delegation) never emit bridge snapshot events,
so the host posts the run model it builds from engine session data to
`POST /snapshot`, and the service persists it project-scoped under
`<project>/.omo/dag-runs/<sessionId>.snapshot.json` (live file) plus capped
immutable terminal records in `<project>/.omo/dag-runs/history/<sessionId>/`
(newest 20). `GET /snapshot` reads the temp file first, then the live file
when the caller names its directory; `GET /history` with a directory filter
merges temp snapshots, loop rows, and project-scoped records, deduped by
(session, updatedAt, status). Project-scoped entries appear only under their
own directory filter. The panel's History covers the followed conversation
only and stays display-only: rows never bind the live view.
The panel never touches the filesystem: it calls `serviceRequest`, and the
service reads the file. The wrapper entry for steering is per-guest
storage (`wrapperEntry`, kept silently — no visible input); with no entry anywhere the
bridge resolves the native/vendored engine before answering engine-absent,
so a saved path stays an optional override and empty means auto-resolve.

## Ship (desktop, no manual install)

`packages/extensions/registry.json` maps `alcode-builtin-dag-pane`
to this directory with explicit files (`panel/index.html`, `icon.svg`)
and build entries (`panel/main.ts` → browser IIFE, `service/main.js` →
node ESM). `bun run extensions:build` stages the bundle under
`packages/web/server/built-in-extensions/` (generated, git-ignored,
shipped in the web package and unpacked from ASAR for Electron service
entries). A fresh install shows the DAG rail icon with no Settings →
Extensions folder install. The guest ships enabled with exactly the
`service` grant (its only declaration) and no approval dialog; disable
stops the service while retaining data and credentials.
