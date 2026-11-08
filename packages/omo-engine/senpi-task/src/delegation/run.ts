import type { DagManager, DagStartParams } from "../dag/manager"
import type { DagRunResult } from "../dag/handle"
import { isTerminalDagRunStatus } from "../dag/types"
import type { DagRunId } from "../dag/types"

import {
  buildEngineeringDelegationPlan,
  collectDelegationResults,
  type DelegationNodeOutcome,
  type DelegationPlanRejection,
  type EngineeringDelegationRequest,
} from "./plan"

// This module turns a delegation plan into an engine run. It owns no scheduler and no persistence:
// the native DAG manager creates/reuses the run, the host's scheduler admits the nodes as real
// child tasks, and the existing wait surface resolves the terminal result.

const DELEGATION_RUN_ERROR_CODES = ["invalid_deadline", "wait_unavailable"] as const

type DelegationRunErrorCode = (typeof DELEGATION_RUN_ERROR_CODES)[number]

export class DelegationRunError extends Error {
  readonly code: DelegationRunErrorCode

  constructor(code: DelegationRunErrorCode, message: string) {
    super(message)
    this.name = "DelegationRunError"
    this.code = code
  }
}

export type EngineeringDelegationRunRequest = {
  readonly objective: string
  readonly workingDirectory: string
  readonly roles: EngineeringDelegationRequest["roles"]
  // DagStartParams requires both ids (dag/manager.ts:198-202). A top-level delegation is its own
  // root, so rootSessionId defaults to parentSessionId.
  readonly parentSessionId: string
  readonly rootSessionId?: string
  readonly maxNodes?: number
  readonly deadlineMs?: number
}

/**
 * The engine-side run control. These are the real manager members, narrowed so the tests can prove
 * the shape this module depends on has not drifted:
 * - `start`: the native start path (manager.ts:212, implemented at :276 -> startRun:354). The caller
 *   supplies its runtime start: manager.start creates/reuses the fingerprint-keyed run, and the
 *   runtime's own native scheduler kickoff admits the nodes. A bare manager.start with no such
 *   kickoff creates the run but admits no child, so only the deadline would end the wait.
 * - `attach`: the run handle (manager.ts:214, implemented at :289). Its handle type exposes only
 *   runId + snapshot (manager.ts:161-164) - it has NO cancel, stop, or wait member.
 * - `record`: the authoritative durable node records (manager.ts:215).
 */
export type EngineeringDelegationRunDeps = {
  readonly dagManager: Pick<DagManager, "start" | "attach" | "record">
  readonly now?: () => number
  /**
   * The existing wait surface (createDagWaitSurface(...).wait, dag/handle.ts:86,149) adapted by the
   * caller with its deadline: resolve the terminal DagRunResult, or, when the remaining budget
   * elapses first, the run's current NON-terminal snapshot. It never rejects to signal a deadline.
   */
  readonly wait?: (runId: DagRunId, deadlineMs: number) => Promise<DagRunResult>
}

/**
 * What this seam could do about a deadline. The manager exposes no run-cancel
 * (DagManager: manager.ts:211-218; its attach handle: manager.ts:161-164), so it is either
 * unnecessary or unavailable. The engine's only cancel is DagScheduler.cancel
 * (scheduler.ts:151,336), which the scheduler owner - not this module - wires.
 */
type EngineeringDelegationDeadlineCancellation = "not_needed" | "unavailable_at_manager_seam"

export type EngineeringDelegationRunCompletion = {
  readonly ok: true
  readonly runId: DagRunId
  readonly outcomes: readonly DelegationNodeOutcome[]
  readonly unresolved: boolean
  readonly deadlineExceeded: boolean
  readonly deadlineCancellation: EngineeringDelegationDeadlineCancellation
}

export type EngineeringDelegationRunResult =
  | EngineeringDelegationRunCompletion
  | { readonly ok: false; readonly rejection: DelegationPlanRejection }

const NO_DEADLINE = Number.POSITIVE_INFINITY

export async function runEngineeringDelegation(
  deps: EngineeringDelegationRunDeps,
  request: EngineeringDelegationRunRequest,
): Promise<EngineeringDelegationRunResult> {
  if (deps.wait === undefined) {
    throw new DelegationRunError(
      "wait_unavailable",
      "runEngineeringDelegation needs the engine wait surface; it cannot invent a terminal result",
    )
  }
  if (
    request.deadlineMs !== undefined
    && (!Number.isFinite(request.deadlineMs) || request.deadlineMs < 0)
  ) {
    throw new DelegationRunError(
      "invalid_deadline",
      `deadlineMs must be a finite non-negative number, received ${request.deadlineMs}`,
    )
  }

  // Reuse the plan builder; node ids, ordering, bounds, and the definition key stay in one place.
  const plan = buildEngineeringDelegationPlan(
    request.maxNodes === undefined
      ? {
          objective: request.objective,
          workingDirectory: request.workingDirectory,
          roles: request.roles,
        }
      : {
          objective: request.objective,
          workingDirectory: request.workingDirectory,
          roles: request.roles,
          maxNodes: request.maxNodes,
        },
  )
  if (!plan.ok) {
    return { ok: false, rejection: plan }
  }

  const now = deps.now ?? Date.now
  const startedAt = now()
  const deadlineAt = request.deadlineMs === undefined ? undefined : startedAt + request.deadlineMs

  // Idempotency belongs to the engine, not to this module: createDagManager.start holds the key
  // lock and reuses a run whose SUBMITTED definition fingerprints identically (manager.ts:373-387),
  // so a repeated request returns the same runId and spawns no second set of children. Nothing here
  // spawns or dedupes work itself.
  const startParams: DagStartParams = {
    definition: plan.definition,
    parentSessionId: request.parentSessionId,
    rootSessionId: request.rootSessionId ?? request.parentSessionId,
  }
  const started = await deps.dagManager.start(startParams)
  const runId = started.snapshot.runId

  const remaining = deadlineAt === undefined ? NO_DEADLINE : Math.max(0, deadlineAt - now())
  const result = await deps.wait(runId, remaining)
  const stoppedBeforeTerminal = !isTerminalDagRunStatus(result.status)
  // The wait contract returns a non-terminal snapshot only when the deadline elapsed. Without a
  // deadline there is nothing to exceed, so that shape stays `unresolved` rather than mislabelled.
  const deadlineExceeded = stoppedBeforeTerminal && request.deadlineMs !== undefined

  // The engine's only cancel is DagScheduler.cancel (scheduler.ts:151,336), and it is not on the
  // manager (manager.ts:211-218) or on the handle manager.attach returns (manager.ts:161-164).
  // A deadline therefore cannot be cancelled from this seam. Report the children's real states and
  // the missing capability; never write a synthetic `timed_out` status the engine does not have.
  const deadlineCancellation: EngineeringDelegationDeadlineCancellation = stoppedBeforeTerminal
    ? "unavailable_at_manager_seam"
    : "not_needed"

  // Node records stay authoritative: a terminal run reads the durable record, a run stopped by the
  // deadline reads the same record through the live handle. Both are engine state, never ours.
  const nodes = stoppedBeforeTerminal
    ? deps.dagManager.attach(runId, request.parentSessionId).snapshot().nodes
    : deps.dagManager.record(runId, request.parentSessionId).nodes

  const { results } = collectDelegationResults(nodes)

  // Deliberately no verification verdict: no `verified`, `accepted`, or pass/fail field exists on
  // this result. The engine's evidence gate owns acceptance (dag/verification.ts), and inferring
  // "every node completed" as success here is exactly the judgement this layer must not make.
  // A running node has no terminal outcome, so collectDelegationResults omits it; `unresolved`
  // reports that absence instead of inventing a state for it.
  return {
    ok: true,
    runId,
    outcomes: results,
    unresolved: results.length < plan.definition.nodes.length,
    deadlineExceeded,
    deadlineCancellation,
  }
}