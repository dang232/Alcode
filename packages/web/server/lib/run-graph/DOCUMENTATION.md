# Run graph (run/tasks snapshot API)

## Ownership

`GET /api/run-graph/snapshot?directory=&conversationId=` is the read-only
run/tasks surface the activity panel consumes. It serves
`<directory>/.omo/dag-runs/<conversationId>.snapshot.json` and never writes.

`runtime.js` owns reading that document and projecting durable state onto it:
`dag.runs[]` and `tasks.tasks[]` may each carry

- `repair` - the current-epoch repair attempt for that `run_id` / `task_id`
- `repairError` - the attempt store or task record could not be read

The projection itself lives in `../verification-approval/repair-state.js`
because that is the one module `build:verification` bundles for the Node server.

## Invariants

- `repair.verificationStatus` comes only from the persisted task record's
  `verification_status` (the completion gate's claim). No repair state,
  attempt outcome, or plan ever becomes a verification claim.
- An attempt whose `runEpoch` differs from the task record's current
  `notification.run_epoch` is omitted. Stale attempts never render as current.
- No attempt means no `repair` field - never an empty block.
- An unreadable store, missing task record (while attempts exist), or corrupt
  attempt file yields `repairError`; it must never read as "no repair".
- The endpoint is the only run/tasks family. Repair state is enrichment of the
  existing payload, not a parallel endpoint or a second DAG projection.

## Decisions

### Why repair state is projected server-side and not from UI state

The panel has no durable record of an attempt; anything it remembered would be
a session-local guess. The attempt store and task record are the same files the
engine already treats as authority, so the server reads them at request time.

### Why the reader lives under verification-approval

The server runs under Node and cannot resolve the engine's `.ts` sources.
`build:verification` already bundles `verification-approval/routes.js` (which
re-exports the reader) into `server/dist/verification-approval.js`, and that
artifact is what the runtime loads lazily. Adding a workspace dependency on
`@oh-my-opencode/senpi-task` or a second bundle entry was rejected as a wider
packaging change for one read.

### Why `hostFacts` and `modelHypotheses` may be empty

The durable attempt record (repair/store.ts) currently persists the plan,
failed check ids, and the terminal outcome, but not the diagnosis facts or the
model hypotheses. The projection reports `[]` rather than reconstructing them
from a state or plan; consumers must treat an empty list as "not persisted",
not as proof that the diagnosis had no facts.

### Why Windows store inspection precedes the store call

On Windows a `readdir` below a path segment that is a file reports `ENOENT`,
which the engine store maps to an empty task. The reader stats the repair
directory first and compares the persisted `.json` count with the records the
store accepted, so a broken or corrupt store is an error instead of an empty
result.
