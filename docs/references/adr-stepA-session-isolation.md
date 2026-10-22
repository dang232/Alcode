# ADR Step A: Session Isolation

One bad session must not erase its siblings. Filters and linkage keep each session in its own lane.

## Status

Accepted.

## Decision

Keep fork parentage explicit through the sync layer rewrite and cover both call sites (G6).
Drop stale archived children by rule and rebuild the live set through reconnect recovery (G7).
Hold per session filtering steady so a failed entity never blocks unrelated complete ones.

## Consequences

Forks land under the right parent on real runs.
Archive races stop resurrecting dead children as active orphans.
Reconnects converge on the same live set every time.

## Refs

- `packages/ui/src/lib/opencode/events.ts:107,242,262-264`
- `packages/ui/src/sync/session-actions.ts:2843`
- `packages/ui/src/sync/child-session-discovery.ts:12`
- `packages/ui/src/sync/reconnect-recovery.ts:124-150`
- `.omo/waves/alcode-design/gap-contract.md: G6, G7`
