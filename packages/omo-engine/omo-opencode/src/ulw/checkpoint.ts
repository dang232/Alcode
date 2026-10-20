/**
 * Native ULW checkpoint gating.
 *
 * A checkpoint closes one or more goals. It is refused while any goal in
 * scope was dispatched to a worker session but has no recorded child
 * result: closing it would silently drop the child's work. The refusal is
 * an {@link UlwUsageError} with code `DISPATCHED_CHILDREN_PENDING` whose
 * message lists every goal id still missing a receipt, so the caller can
 * collect exactly those results and retry.
 */

import { dispatchedChildrenPendingError } from "./errors.ts"
import type { UlwStore } from "./store.ts"
import type { UlwMissingReceipts } from "./types.ts"

export type UlwCheckpointScope =
  | { readonly kind: "run" }
  | { readonly kind: "goals"; readonly goalIds: readonly string[] }

export type UlwCheckpointResult = {
  readonly runId: string
  readonly checkedGoalIds: readonly string[]
  readonly missingGoalIds: UlwMissingReceipts
}

/**
 * Refuses the checkpoint when any in-scope dispatched goal has no recorded
 * child result, throwing the named usage error that lists the missing
 * receipts. Returns the settled scope when every dispatched goal in scope
 * has its receipt. Goals that were never dispatched need no receipt and
 * never block.
 */
export function gateCheckpoint(
  store: UlwStore,
  runId: string,
  scope: UlwCheckpointScope = { kind: "run" },
): UlwCheckpointResult {
  const goalIds = scope.kind === "run" ? undefined : [...scope.goalIds]
  const missing = store.missingReceipts(runId, goalIds)
  if (missing.length > 0) {
    throw dispatchedChildrenPendingError(runId, missing)
  }
  const checkedGoalIds = goalIds ?? Object.keys(store.rosterFor(runId))
  return { runId, checkedGoalIds, missingGoalIds: missing }
}
