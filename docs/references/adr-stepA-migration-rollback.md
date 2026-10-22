# ADR Step A: Migration Rollback

Step A moves in small verbs: settle, pin, execute, trace, report. Each step can roll back cleanly.

## Status

Accepted.

## Decision

Keep receipts explicit about partial, stale, and cleanup states until runs clear them (G1, G5).
Roll back by restoring the pinned source and rerunning the drift or kill check, not by hand edits.
Leave G8 and the G4 redesign marked out of Step A so scope can't creep mid run.

## Consequences

Partial work never looks complete.
Rollbacks take minutes because the pin points at the good source.
Out of scope items wait their turn instead of blocking Step A.

## Refs

- `packages/web/server/lib/opencode/omo-bridge-runtime.js:1288`
- `packages/web/server/lib/opencode/omo-loop-driver.ts:211-236`
- `packages/web/server/lib/opencode/omo-invoker-worker.ts:301`
- `.omo/waves/alcode-design/gap-contract.md: G1-G8, out-of-Step-A marks`
