/**
 * run-ref.ts — turn the run reference a caller holds into the native run id.
 *
 * A caller may hold a run id, an accepted submission id, or the session
 * scope that opened the run. The CLI `create-goals` hands back a plan under
 * `.omo/ulw-loop/<sessionId>/`, so dispatch also adopts that plan as a
 * native run. Other tools resolve only runs that already exist; they must
 * not create state just because someone inspected a plan.
 */

import { adoptUlwLoopPlanRun } from "../../ulw/plan-store.ts"
import type { UlwStore } from "../../ulw/store.ts"

/** Resolves an existing run reference, or returns it unchanged for the store's lookup refusal. */
export function resolveExistingRunRef(store: UlwStore, runRef: string): string {
  return store.resolveRunId(runRef) ?? runRef
}

/**
 * Resolves a dispatch target. Falls back to the CLI plan the reference
 * names, opening the native mirror with that session id, so a run created
 * by `create-goals` is dispatchable by the id it returned.
 */
export function resolveDispatchRunRef(store: UlwStore, directory: string, runRef: string): string {
  const resolved = store.resolveRunId(runRef)
  if (resolved !== undefined) return resolved
  return adoptUlwLoopPlanRun(store, directory, runRef) ?? runRef
}
