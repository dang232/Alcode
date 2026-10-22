# ADR Step A: Retry Budget

Retries stay bounded and counted. Nothing loops forever, nothing drops silently.

## Status

Accepted.

## Decision

Cap loop driver iterations and kill grace windows; a refused call writes nothing and returns a code (G5, G1).
Count every drop with explicit counters: `snapshot_too_large`, `droppedOversize`, `malformed_json`.
Assert those counters in tests so oversize and corrupt inputs prove their path.

## Consequences

Corrupt or huge inputs degrade visibly instead of hanging.
Budgets make flaky runs reproducible and cheap to diagnose.
Teams can't add quiet retries without updating the counters.

## Refs

- `packages/web/server/lib/opencode/omo-loop-driver.ts:211-236,334,375`
- `packages/web/server/lib/opencode/omo-bridge-runtime.js:67-69,685,703`
- `packages/web/server/lib/opencode/omo-invoker-worker.ts:301`
- `.omo/waves/alcode-design/gap-contract.md: G1, G5`
