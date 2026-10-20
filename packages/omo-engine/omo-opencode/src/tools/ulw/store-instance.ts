/**
 * store-instance.ts — the process-wide native ULW store the tools write.
 *
 * Single-writer rule: native tools are the only writers of this store. The
 * CLI-owned loop files under `<repoRoot>/.omo/ulw-loop` stay CLI-written;
 * nothing here reads or writes them.
 *
 * The store module itself is owned by the a2-store node of this run. This
 * file re-checks its exports exist before use: when the store lane failed,
 * importing this module throws the BLOCKED error below instead of serving
 * half-wired tools.
 */

import { gateCheckpoint } from "../../ulw/checkpoint.ts"
import { UlwStore } from "../../ulw/store.ts"

/**
 * Proves the store lane's exports work before any tool uses them: a probe
 * run is created and checkpointed in an isolated store. A failed a2-store
 * lane surfaces here as a construction or call failure, never as a
 * half-wired tool.
 */
function checkStoreModule(): void {
  const probe = new UlwStore({ now: () => 0, newRunId: () => "probe" })
  probe.createRun({ id: "probe", brief: "probe", sessionScope: "probe" })
  probe.dispatchGoal("probe", "probe-goal", "probe-worker")
  probe.recordChildResult("probe", "probe-goal", { childSessionId: "probe-worker" })
  gateCheckpoint(probe, "probe")
}

try {
  checkStoreModule()
} catch (error) {
  throw new Error(
    "[ulw tools] BLOCKED: the native ULW store module is unusable; refusing to build ULW tools.",
    { cause: error },
  )
}

let shared: UlwStore | undefined

/** Returns the process-wide store, creating it on first use. */
export function getUlwStore(): UlwStore {
  if (shared === undefined) {
    shared = new UlwStore()
  }
  return shared
}

/** Replaces the process-wide store. Tests pass a fresh store; pass `undefined` to reset. */
export function setUlwStoreForTests(store: UlwStore | undefined): void {
  shared = store
}
