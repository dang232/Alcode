import type { DagManager, DagStartParams } from "../dag/manager"
import type { DagRunResult } from "../dag/handle"
import { isTerminalDagRunStatus } from "../dag/types"
import type { DagNodeId, DagRunId } from "../dag/types"

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
 * The deadline cannot be honoured at this seam. The manager exposes no run-cancel
 * (DagManager: manager.ts:211-218; its attach handle: manager.ts:161-164), and the engine's only
 * cancel is DagScheduler.cancel (scheduler.ts:151,336), which the scheduler owner - not this
 * module - wires. Once the wait surface reports a non-terminal snapshot there is no way for this
 * module to stop the run.
 *
 * This is an explicit typed failure, not a completion: `ok: false` means a caller cannot read it
 * as success, and no cancellation is claimed. The real node observations ride along so the caller
 * can report what actually happened.
 */
export type EngineeringDelegationDeadlineUnavailable = {
  readonly ok: false
  readonly kind: "deadline_unavailable_at_manager_seam"
  readonly reason: string
  readonly runId: DagRunId
  readonly outcomes: readonly DelegationNodeOutcome[]
  readonly unresolved: boolean
}

export type EngineeringDelegationRunCompletion = {
  readonly ok: true
  readonly runId: DagRunId
  readonly outcomes: readonly DelegationNodeOutcome[]
  readonly unresolved: boolean
  // Which planned node(s) had no terminal outcome and which outcome(s) belong to a node the plan
  // never carried. They stay separate so a caller can name both directions, not just a boolean.
  readonly missingNodeIds: readonly DagNodeId[]
  readonly foreignNodeIds: readonly DagNodeId[]
}

// Module-private on purpose: the union below is the published contract, and no consumer imports
// the plan-rejection member by name (manager.ts imports the completion and deadline members).
type EngineeringDelegationPlanRejected = {
  readonly ok: false
  readonly rejection: DelegationPlanRejection
}

export type EngineeringDelegationRunResult =
  | EngineeringDelegationRunCompletion
  | EngineeringDelegationDeadlineUnavailable
  | EngineeringDelegationPlanRejected

const NO_DEADLINE = Number.POSITIVE_INFINITY

/**
 * Why a run's terminal node set does not match the plan. The two set conditions stay separate so
 * a caller can name the missing planned node(s) and the unplanned outcome(s); a count cannot tell
 * them apart. `run_record_unreadable` is the manager seam's own condition, never a set mismatch.
 */
type DelegationNodeSetMismatch =
  | "planned_node_outcomes_missing"
  | "unplanned_node_outcomes_present"
  | "planned_and_unplanned_node_outcomes"

export type DelegationUnresolvedReason = DelegationNodeSetMismatch | "run_record_unreadable"

export type DelegationNodeSetComparison = {
  readonly missingNodeIds: readonly DagNodeId[]
  readonly foreignNodeIds: readonly DagNodeId[]
  readonly mismatch: DelegationNodeSetMismatch | undefined
}

/**
 * Compare planned node ids against terminal outcome ids. A count is not an oracle: one planned
 * node dropped and one unplanned node added keeps the length while changing the result, so both
 * directions are derived from the id sets and reported by name.
 */
export function compareDelegationNodeSets(
  plannedNodeIds: readonly DagNodeId[],
  outcomes: readonly DelegationNodeOutcome[],
): DelegationNodeSetComparison {
  const planned = new Set<string>(plannedNodeIds)
  const observed = new Set<DagNodeId>(outcomes.map((outcome) => outcome.nodeId))
  const missingNodeIds = plannedNodeIds.filter((nodeId) => !observed.has(nodeId))
  const foreignNodeIds = [...observed].filter((nodeId) => !planned.has(nodeId))
  const mismatch = missingNodeIds.length === 0 && foreignNodeIds.length === 0
    ? undefined
    : missingNodeIds.length > 0 && foreignNodeIds.length > 0
      ? "planned_and_unplanned_node_outcomes"
      : missingNodeIds.length > 0
        ? "planned_node_outcomes_missing"
        : "unplanned_node_outcomes_present"
  return { missingNodeIds, foreignNodeIds, mismatch }
}

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
  const deadlineMs = request.deadlineMs
  if (deadlineMs !== undefined && (!Number.isFinite(deadlineMs) || deadlineMs < 0)) {
    throw new DelegationRunError(
      "invalid_deadline",
      `deadlineMs must be a finite non-negative number, received ${deadlineMs}`,
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

  // SAFETY: every node id in this definition was branded by delegationNodeId() inside the plan
  // builder; DagNodeInput widens ids back to string, so the plan owns this narrowing.
  const plannedNodeIds = plan.definition.nodes.map((node) => node.id as DagNodeId)

  const now = deps.now ?? Date.now
  const startedAt = now()
  const deadlineAt = deadlineMs === undefined ? undefined : startedAt + deadlineMs

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
  const deadlineElapsed = stoppedBeforeTerminal && deadlineMs !== undefined

  // Node records stay authoritative: a terminal run reads the durable record, a run that stopped
  // before its terminal state reads the same record through the live handle. Both are engine
  // state, never ours.
  const nodes = stoppedBeforeTerminal
    ? deps.dagManager.attach(runId, request.parentSessionId).snapshot().nodes
    : deps.dagManager.record(runId, request.parentSessionId).nodes

  const { results } = collectDelegationResults(nodes)
  // A running node has no terminal outcome, so collectDelegationResults omits it; `unresolved`
  // reports that absence instead of inventing a state for it. The comparison is by planned id, not
  // by count: an unplanned terminal node never stands in for a missing planned one.
  const comparison = compareDelegationNodeSets(plannedNodeIds, results)
  const unresolved = comparison.mismatch !== undefined

  // The deadline elapsed before the run settled, and the engine's only cancel is DagScheduler.cancel
  // (scheduler.ts:151,336) - not on the manager (manager.ts:211-218) or on the handle
  // manager.attach returns (manager.ts:161-164). Fail loudly with the real observations instead of
  // returning a success-shaped completion or inventing a terminal status the engine does not have.
  if (deadlineElapsed) {
    return {
      ok: false,
      kind: "deadline_unavailable_at_manager_seam",
      reason:
        `deadline of ${deadlineMs}ms elapsed before run ${runId} reached a terminal state; ` +
        "the manager seam exposes no run cancel, so the run was left running and the deadline " +
        "could not be honoured (DagScheduler.cancel belongs to the scheduler owner)",
      runId,
      outcomes: results,
      unresolved,
    }
  }

  // Deliberately no verification verdict: no `verified`, `accepted`, or pass/fail field exists on
  // this result. The engine's evidence gate owns acceptance (dag/verification.ts), and inferring
  // "every node completed" as success here is exactly the judgement this layer must not make.
  return {
    ok: true,
    runId,
    outcomes: results,
    unresolved,
    missingNodeIds: comparison.missingNodeIds,
    foreignNodeIds: comparison.foreignNodeIds,
  }
}