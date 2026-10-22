# ADR Step A: Worker Lifecycle

Cancel must kill the engine process, not just mark a receipt. Receipts stay provisional until a run proves the kill.

## Status

Accepted.

## Decision

Settle G1 with a kill verification run on Unix and Windows: spawn, cancel, then assert the process exits inside the grace window.
Forward signals through the invoker worker and keep platform differences visible in code.
Only clear `provisional:true` with run logs, or write down the residual risk and bounded escalation.

## Consequences

Cancel claims match reality on both platforms.
Fail closed behavior holds when the kill path breaks.
Extra runs cost time, yet they remove the highest risk item first.

## Refs

- `packages/web/server/lib/opencode/omo-bridge-runtime.js:1288`
- `packages/web/server/lib/opencode/omo-invoker-worker.ts:301`
- `.omo/waves/alcode-design/gap-contract.md: G1, F09`
