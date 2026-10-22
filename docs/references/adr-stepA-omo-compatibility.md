# ADR Step A: OmO Compatibility

Step A doesn't fight upstream limits. It documents them and keeps both paths honest.

## Status

Accepted.

## Decision

Leave the static native agent catalog workaround in place; removal waits on upstream V2 `add()` (G8, out of Step A).
Verify whether the bridge spend and sign in gate covers the native worker barrel path, then report (G4).
Defer any `resolveModel` availability redesign past Step A.

## Consequences

Builds stay green without pretending the workaround is gone.
Bridge vs native path differences stay visible in code.
Nobody sneaks a redesign into a verification step.

## Refs

- `packages/web/server/lib/agents/omo-native-catalog.js:22-33`
- `packages/omo-engine/omo-opencode/src/plugin-setup.ts:17`
- `packages/web/server/lib/opencode/omo-bridge-runtime.js:973`
- `packages/web/server/lib/opencode/omo-invoker-worker.ts:340`
- `packages/omo-engine/model-core/src/model-resolver.ts:38`
- `.omo/waves/alcode-design/gap-contract.md: G4, G8`
