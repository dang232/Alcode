/**
 * Native ULW usage errors: caller-fixable refusals from the native store.
 *
 * A usage error means the caller asked for something the store cannot honor
 * yet (unknown run, inactive run, receipt without a dispatch, or a
 * checkpoint over dispatched-but-unrecorded children). It is never a crash:
 * the message names the run, the reason, and — for the checkpoint gate —
 * every goal id still missing a receipt.
 */

import type { UlwMissingReceipts } from "./types.ts"

export type UlwUsageErrorCode =
  | "INVALID_INPUT"
  | "RUN_NOT_FOUND"
  | "RUN_NOT_ACTIVE"
  | "GOAL_NOT_DISPATCHED"
  | "GOAL_SESSION_MISMATCH"
  | "DISPATCHED_CHILDREN_PENDING"

function describeMissing(missing: UlwMissingReceipts): string {
  return missing.join(", ")
}

/**
 * Raised for caller-fixable ULW store refusals. `runId` always names the run
 * in play; `missingGoalIds` is present only for the checkpoint gate
 * (`DISPATCHED_CHILDREN_PENDING`) and lists every goal id whose dispatch
 * has no recorded child result yet.
 */
export class UlwUsageError extends Error {
  readonly code: UlwUsageErrorCode
  readonly runId: string
  readonly missingGoalIds?: UlwMissingReceipts

  constructor(message: string, code: UlwUsageErrorCode, runId: string, missingGoalIds?: UlwMissingReceipts) {
    super(message)
    this.name = "UlwUsageError"
    this.code = code
    this.runId = runId
    if (missingGoalIds !== undefined) {
      this.missingGoalIds = missingGoalIds
    }
  }
}

/** Refuses a checkpoint over dispatched goals that have no recorded result. */
export function dispatchedChildrenPendingError(runId: string, missing: UlwMissingReceipts): UlwUsageError {
  return new UlwUsageError(
    `Cannot checkpoint run '${runId}': dispatched children have no recorded result: ${describeMissing(missing)}. Record each child result first.`,
    "DISPATCHED_CHILDREN_PENDING",
    runId,
    [...missing],
  )
}

/** Rejects blank run/goal/session ids and blank receipt fields. */
export function invalidInputError(runId: string, message: string): UlwUsageError {
  return new UlwUsageError(message, "INVALID_INPUT", runId)
}

/** Rejects work against a run id the store has never seen. */
export function runNotFoundError(runId: string): UlwUsageError {
  return new UlwUsageError(`Unknown ULW run: '${runId}'.`, "RUN_NOT_FOUND", runId)
}

/** Rejects dispatches and receipts once a run has left `active`. */
export function runNotActiveError(runId: string, status: string): UlwUsageError {
  return new UlwUsageError(
    `ULW run '${runId}' is ${status}; only an active run accepts dispatches and child results.`,
    "RUN_NOT_ACTIVE",
    runId,
  )
}

/** Rejects a child result for a goal that was never dispatched. */
export function goalNotDispatchedError(runId: string, goalId: string): UlwUsageError {
  return new UlwUsageError(
    `ULW run '${runId}' has no dispatch for goal '${goalId}': dispatch the goal before recording its child result.`,
    "GOAL_NOT_DISPATCHED",
    runId,
  )
}

/** Rejects a child result from a session the goal was never dispatched to. */
export function goalSessionMismatchError(runId: string, goalId: string, childSessionId: string): UlwUsageError {
  return new UlwUsageError(
    `ULW run '${runId}' never dispatched goal '${goalId}' to session '${childSessionId}': record results only from dispatched worker sessions.`,
    "GOAL_SESSION_MISMATCH",
    runId,
  )
}
