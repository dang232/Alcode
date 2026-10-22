# ADR Step A: Acceptance vs Execution

Step A accepts only what runs prove. Comments and reads don't close gaps.

## Status

Accepted.

## Decision

Drive fail closed branches with real tests: corrupt, foreign, and oversize loop states plus too large snapshots and malformed pump lines (G5).
Mark fork linkage and archived child handling as pinned by comment until run evidence lands (G6, G7).
Flip F12/F13 from UNKNOWN to HOLDS only with passing runs and counter assertions.

## Consequences

Untested branches can't hide behind review.
Pins stay honest about what's proven.
Reviewers see exactly which UNKNOWNs remain.

## Refs

- `packages/web/server/lib/opencode/omo-loop-driver.ts:211-236,334,375`
- `packages/web/server/lib/opencode/omo-bridge-runtime.js:67-69,685,703`
- `packages/ui/src/sync/child-session-discovery.ts:12`
- `.omo/waves/alcode-design/gap-contract.md: G5, G6, G7`
