// The persisted repair lifecycle for ordinary-task verification failures.
//
// This module sits BESIDE the canonical completion vocabulary
// (verification/completion-status.ts) and never replaces it: the completion
// gate stays the sole authority for ordinary completion. Repair tracks what
// happens AFTER the gate reports "blocked" - diagnosis, a repair plan,
// re-execution, and re-verification - so a blocked run can earn a fresh gate
// verdict instead of being abandoned or force-completed.
//
// Deliberate separations, stated so this module cannot be mistaken for more:
// - RepairState is disjoint from VerificationStatus and TaskStatus. Mapping a
//   repair state onto "verified" anywhere outside the gate would reintroduce
//   the two-valued pass/fail the vocabulary was built to avoid.
// - All moves are explicit and table-driven (REPAIR_TRANSITIONS). An edge not
//   in the table is rejected, never inferred.
// - Identity fencing (taskId + runEpoch) makes a stale repair update reject
//   instead of resurrecting an older run's lifecycle.

export type RepairState =
  | "diagnosing"
  | "repair_planned"
  | "repairing"
  | "reverifying"
  | "repaired"
  | "repair_failed"
  | "repair_cancelled";

export const REPAIR_STATES: readonly RepairState[] = [
  "diagnosing",
  "repair_planned",
  "repairing",
  "reverifying",
  "repaired",
  "repair_failed",
  "repair_cancelled",
];

const REPAIR_TERMINAL_STATES: readonly RepairState[] = [
  "repaired",
  "repair_failed",
  "repair_cancelled",
];

function isRepairTerminal(state: RepairState): boolean {
  return state === "repaired" || state === "repair_failed" || state === "repair_cancelled";
}

// Exactly which moves are legal. Forward progress reads down the first column
// of each row; every non-terminal row additionally carries the failure edge
// (repair_failed) and the cancellation edge (repair_cancelled). The one loop
// edge is reverifying -> repairing: a failed re-verification earns another
// repair round, counted by attemptNumber and capped by the retry limit.
// Terminal rows carry no outgoing edges.
// The named owner contract for the transition table. A Record would discard
// the per-state evidence the literal carries; the explicit table keeps every
// legal edge visible at the type level.
type RepairTransitionTable = {
  readonly diagnosing: readonly RepairState[];
  readonly repair_planned: readonly RepairState[];
  readonly repairing: readonly RepairState[];
  readonly reverifying: readonly RepairState[];
  readonly repaired: readonly RepairState[];
  readonly repair_failed: readonly RepairState[];
  readonly repair_cancelled: readonly RepairState[];
};

const REPAIR_TRANSITIONS: RepairTransitionTable = {
  diagnosing: ["repair_planned", "repair_failed", "repair_cancelled"],
  repair_planned: ["repairing", "repair_failed", "repair_cancelled"],
  repairing: ["reverifying", "repair_failed", "repair_cancelled"],
  reverifying: ["repaired", "repairing", "repair_failed", "repair_cancelled"],
  repaired: [],
  repair_failed: [],
  repair_cancelled: [],
};

export function isLegalRepairTransition(from: RepairState, next: RepairState): boolean {
  return REPAIR_TRANSITIONS[from].includes(next);
}

// The narrowest shape the transition function reads. RepairAttempt satisfies
// this structurally, so the function stays generic and this module never
// imports the attempt record it operates on.
export type RepairTransitionInput = {
  readonly taskId: string;
  readonly runEpoch: number;
  readonly state: RepairState;
  readonly attemptNumber: number;
  readonly updatedAt: number;
};

export type RepairTransitionContext = {
  readonly taskId: string;
  readonly runEpoch: number;
  // The maximum attemptNumber the retry loop may reach. The first repair
  // round is 1; each reverifying -> repairing edge increments it. Defaults to
  // DEFAULT_REPAIR_RETRY_LIMIT.
  readonly retryLimit?: number;
  // Recorded on the result for explicit terminal moves; ignored otherwise.
  readonly reason?: string;
  // Injected clock so the function stays pure under test. Defaults to Date.now().
  readonly now?: number;
};

const DEFAULT_REPAIR_RETRY_LIMIT = 3;

// The redirect applied when the retry loop has no round left. It is a result
// reason, not a rejection: the attempt settles as repair_failed.
const RETRY_EXHAUSTED_REASON = "retry_exhausted" as const;

type RepairRejectionReason = "task_mismatch" | "stale_epoch" | "illegal_transition";

export type RepairTransitionAdvanced<T extends RepairTransitionInput> = {
  readonly status: "advanced";
  readonly attempt: T;
  readonly from: RepairState;
  readonly to: RepairState;
  // What the caller asked for. Equals `to` except on a retry-limit redirect,
  // where the caller asked for "repairing" and the attempt settled as
  // "repair_failed".
  readonly requested: RepairState;
  readonly redirected: boolean;
  // "retry_exhausted" on a redirect; ctx.reason on explicit terminal moves.
  readonly reason?: string;
};

type RepairTransitionRejected = {
  readonly status: "rejected";
  readonly reason: RepairRejectionReason;
  readonly from: RepairState;
  readonly requested: RepairState;
};

export type RepairTransitionResult<T extends RepairTransitionInput> =
  | RepairTransitionAdvanced<T>
  | RepairTransitionRejected;

export function transitionRepairAttempt<T extends RepairTransitionInput>(
  attempt: T,
  next: RepairState,
  ctx: RepairTransitionContext,
): RepairTransitionResult<T> {
  if (ctx.taskId !== attempt.taskId) {
    return { status: "rejected", reason: "task_mismatch", from: attempt.state, requested: next };
  }
  if (ctx.runEpoch !== attempt.runEpoch) {
    return { status: "rejected", reason: "stale_epoch", from: attempt.state, requested: next };
  }
  if (!isLegalRepairTransition(attempt.state, next)) {
    return { status: "rejected", reason: "illegal_transition", from: attempt.state, requested: next };
  }
  const now = ctx.now ?? Date.now();
  // Retry loop with a cap: a failed re-verification goes back to repairing
  // for another counted round. At the limit there is no round left, so the
  // failure settles as repair_failed with reason "retry_exhausted" instead of
  // looping forever. The redirect is flagged explicitly (redirected: true)
  // because `to` differs from what the caller requested.
  if (attempt.state === "reverifying" && next === "repairing") {
    const limit = ctx.retryLimit ?? DEFAULT_REPAIR_RETRY_LIMIT;
    if (attempt.attemptNumber >= limit) {
      return {
        status: "advanced",
        attempt: { ...attempt, state: "repair_failed", updatedAt: now },
        from: attempt.state,
        to: "repair_failed",
        requested: next,
        redirected: true,
        reason: RETRY_EXHAUSTED_REASON,
      };
    }
    return {
      status: "advanced",
      attempt: { ...attempt, state: next, attemptNumber: attempt.attemptNumber + 1, updatedAt: now },
      from: attempt.state,
      to: next,
      requested: next,
      redirected: false,
    };
  }
  const result: RepairTransitionAdvanced<T> = {
    status: "advanced",
    attempt: { ...attempt, state: next, updatedAt: now },
    from: attempt.state,
    to: next,
    requested: next,
    redirected: false,
  };
  if ((next === "repair_failed" || next === "repair_cancelled") && ctx.reason !== undefined) {
    return { ...result, reason: ctx.reason };
  }
  return result;
}
