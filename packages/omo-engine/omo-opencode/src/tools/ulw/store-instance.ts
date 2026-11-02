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

import nodeFs from "node:fs"

import { gateCheckpoint } from "../../ulw/checkpoint.ts"
import { FileUlwPersistence } from "../../ulw/persistence.ts"
import { UlwStore } from "../../ulw/store.ts"

/**
 * Environment pointer for the durable store file. Hosts that know their
 * data directory (Electron main, the web server when it launches managed
 * OpenCode) set it to `<dataDir>/ulw/store.json`; the plugin host then
 * recovers runs across restarts. Unset means process-scoped and in-memory.
 */
export const ULW_STORE_FILE_ENV = "ALCODE_ULW_STORE_FILE"

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

/**
 * Points the process-wide store at a durable file. The next `getUlwStore`
 * call loads it (recovering runs) and every later mutation saves
 * atomically. Call once at host startup, before any tool runs.
 */
export function configureUlwStorePersistence(options: { filePath: string }): void {
  shared = new UlwStore({
    persistence: new FileUlwPersistence({ fs: nodeFs, filePath: options.filePath }),
  })
}

/** Returns the process-wide store, creating it on first use. */
export function getUlwStore(): UlwStore {
  if (shared === undefined) {
    const filePath = process.env[ULW_STORE_FILE_ENV]?.trim()
    shared =
      filePath !== undefined && filePath.length > 0
        ? new UlwStore({ persistence: new FileUlwPersistence({ fs: nodeFs, filePath }) })
        : new UlwStore()
  }
  return shared
}

/** Replaces the process-wide store. Tests pass a fresh store; pass `undefined` to reset. */
export function setUlwStoreForTests(store: UlwStore | undefined): void {
  shared = store
}
