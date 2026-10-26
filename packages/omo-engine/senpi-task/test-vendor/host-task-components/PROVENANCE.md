# Provenance

Test-fixture support vendored from oh-my-openAlcore at 8a4dd14a (2026-10-22): `omo-senpi/src/components/task/{residency-registry,config-generation-store,member-liveness}.ts` and `omo-senpi/src/extension/idle-injection-coordinator.ts`. Only deviation: `member-liveness.ts` resolves its `senpi-task` value imports from this checkout by relative path (`team/messaging/session-marker-index`, `team/liveness-ownership`, local coordinator); the `SenpiExtensionAPI` import is type-only and erased at runtime. Production code untouched; fixtures only.
