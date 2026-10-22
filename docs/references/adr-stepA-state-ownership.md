# ADR Step A: State Ownership

Step A keeps one owner per state shape. The bridge owns snapshots, the server owns listings, UI owns transient picks.
That's the whole rule. Everything below follows it.

## Status

Accepted.

## Decision

Treat `omo-bridge-runtime.js` as the single snapshot writer source and pin the DAG pane copy by test (G2).
Keep session selection authoritative: `setCurrentSession` plus `setActiveSession` guards decide what's live (G3).
Don't let local prefs or pane bundles fork into second sources.

## Consequences

Pane drift fails the build instead of reaching users.
Traced switch races stay bounded and visible before any reorder change.
UI state stays small and replaceable.

## Refs

- `packages/web/server/lib/opencode/omo-bridge-runtime.js:731-776`
- `packages/web/server/built-in-extensions/dag-pane/service/main.js:563-603`
- `packages/ui/src/sync/session-ui-store.ts:1297-1334`
- `packages/ui/src/sync/sync-context.tsx:715-719,1186-1187,1303-1304`
- `.omo/waves/alcode-design/gap-contract.md: G2, G3`
