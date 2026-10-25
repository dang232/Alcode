# Activity workspace

## Ownership

`packages/ui/src/components/activity/` owns the live activity workspace
rendered in the `activity` context-panel surface: the session execution
tree, the interactive run DAG, and the task inspector (timeline plus
model-worded summaries). Data comes from two places and the module never
invents a third:

- Live chat-path runs from `useDagRunModel` (sync-store sessions,
  statuses, messages, parts). This is the primary source.
- Persisted engine snapshots from `GET /api/run-graph/snapshot`, parsed
  with the dag-pane guest's `parseSnapshotDoc`. Used when present;
  unparseable or missing snapshots fall back to the live model.

The server route lives in `packages/web/server/lib/run-graph/` and only
reads `<directory>/.omo/dag-runs/<conversationId>.snapshot.json`. The
code-graph view inside the workspace reuses `CodeGraphPanel` unchanged.

Neighbouring owners: `lib/dagRunModel` owns the chat-path run model;
`lib/surfaces/` owns surface registration; `lib/i18n/messages/`
owns the `activity.*` strings.

## Invariants

- Every row, node, and event traces to a store record or a parsed
  snapshot record. No delegation evidence renders as an explicit empty
  state, never a fabricated graph.
- Unknown stays unknown: unmapped engine states render as `unknown`;
  missing transcripts render as "no events", never inferred content.
- Model summaries and tool evidence stay separate: assistant text and
  subagent outputs render under a source label; tool calls render in the
  timeline with their receipt ids. The panel never presents text as
  model reasoning.
- Fetch failure is an error state with a retry path, never an empty list.
- Node positions come from the model (snapshot waves or layered waves),
  keyed by id, so live updates never jump the layout or drop selection.

## Decisions

### Why the workspace prefers the engine snapshot over the live model when both exist

The snapshot carries the scheduler's own states (`blocked`, `parked`)
and dependency edges; the chat-path model only sees delegation records.
When the snapshot parses, it is the more authoritative picture of the
same run, so it wins and the header names the source. When it is absent
or malformed, the live model still answers. A 404 missing snapshot is
not a fetch failure: the panel falls through to the live model and the
no-run state, while the error card with Retry stays reserved for genuine
fetch failures.

### Why `parked` maps to `blocked` in the activity state union

The scheduler reports `parked` for nodes it refuses to admit; the
workspace's union has no `parked`. Showing it as `pending` would imply
the node may still run on its own, and `unknown` would hide scheduler
information the engine did report. `blocked` with the engine state
visible in the inspector is the honest mapping.

### Why empty selector fallbacks are module constants, not literals

`useSyncExternalStore` treats every new snapshot identity as a change.
A literal `[]` or `{}` fallback in a store selector returns a new
identity on every read, so opening the workspace on a conversation
without messages yet re-renders forever (React #185: maximum update
depth exceeded). The module constants keep the empty case
referentially stable; the stored slices already are.

### Why file links come only from the selected transcript's file tools

`taskAssociatedFiles` reads `read`/`edit`/`write`/`patch` inputs from
messages keyed under the selected session id (plus its `patch` headers).
Report text, summaries, `grep` patterns, and other tools never contribute:
their words may name files the task never touched. No transcript (or no
file calls) renders the honest absence note, never a guessed jump target.
The panel additionally selects the task's own message bucket, not just the
parent conversation's, or the links would only ever see parent messages.

### Why staleness keys off the session-list source

The store names where the session list came from: `persisted` was restored
from cache and has not been confirmed live yet, `live` and `authoritative`
were. The header shows the stale badge exactly then, next to the source
label, instead of inventing a connection state the panel cannot observe:
transport disconnect and reconnect have no UI-consumable signal in the sync
layer, so the panel does not fake one from `navigator.onLine`.

### Why the explanation card states unavailable rationale instead of hiding it

The engine emits progress text and settlement reports but no per-decision
rationale, which Slice 8.1 verified from the recorded run. The card answers
the rationale question with that absence in the open, so a reader never
mistakes a summary for a reason; the `rationale` field is where recorded
rationale lands if the engine ever emits it.

### Why the graph refits on node-set change and never on state updates

The viewport follows layout identity, not render identity. A refit runs on
mount and when the sorted node-id set changes (nodes added or removed, or a
different conversation's graph); state-only updates keep the user's pan and
zoom, and a sizeless frame keeps the current view instead of collapsing to
scale zero. The Fit button is the manual reset. The node-id signature and
the fit/zoom math live in `activityGraphView.ts` so the contract is
unit-tested apart from the component.

### Why session switches reset selection but keep the viewport component mounted

Selection, snapshot, and code-focus reset on conversation or directory
change, so no previous session's inspector, files, or focus leak into the
next one; the store buckets themselves are keyed by session id. The graph
viewport is not reset by hand: a new node set refits it through the normal
rule, which also keeps a same-directory session switch from flashing a
stale layout. Graph gestures only ever call `setView`/`onSelect`, which the
mount suite pins by asserting the session list is unchanged after click,
wheel, and Fit.

### Why the run graph is HTML buttons over SVG edges, not a canvas

Nodes need keyboard focus, aria-pressed selection, and theme-token text;
edges need only lines. DOM nodes give all three without a hit-testing
layer, and the edge SVG stays a pure function of node positions.
