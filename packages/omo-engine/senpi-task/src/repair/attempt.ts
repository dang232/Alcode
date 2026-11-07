// A single repair attempt: the durable identity and payloads the repair
// lifecycle moves through REPAIR_TRANSITIONS (see ./state.ts).
//
// Identity is deterministic: attemptId derives from
// taskId + runEpoch + attemptNumber, so a retry round is addressable without
// a lookup and two writers computing the same round compute the same id. The
// id embeds its inputs in a parseable form (see parseRepairAttemptId) so the
// store can route an attemptId back to its task directory with no index.

import {
  transitionRepairAttempt,
  type RepairState,
  type RepairTransitionContext,
  type RepairTransitionResult,
} from "./state";

export type RepairPlan = {
  readonly summary: string;
  readonly steps: readonly string[];
  readonly createdAt: number;
};

export type RepairOutcome = {
  readonly result: "repaired" | "failed" | "cancelled";
  readonly reason?: string;
  readonly detail?: string;
  readonly recordedAt: number;
};

export type RepairAttempt = {
  readonly attemptId: string;
  readonly taskId: string;
  readonly runEpoch: number;
  readonly workspaceId: string;
  readonly attemptNumber: number;
  readonly state: RepairState;
  readonly failedCheckIds: readonly string[];
  readonly failedEvidenceIds: readonly string[];
  // The workspace revision the diagnosis was taken against. Kept exact: it is
  // compared for equality with evidence revisions, so it is never truncated.
  readonly diagnosisRevision: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly plan?: RepairPlan;
  readonly outcome?: RepairOutcome;
};

function assertSafeSegment(value: string, name: string): void {
  if (value.length === 0 || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new Error(`invalid ${name} for repair attempt identity: ${JSON.stringify(value)}`);
  }
}

// Deterministic identity: `${taskId}.e${runEpoch}.r${attemptNumber}`. The
// ".e<epoch>.r<round>" suffix is appended by this function only, so parsing
// with a greedy prefix match (see parseRepairAttemptId) recovers the exact
// taskId even when the taskId itself contains dots.
function deriveRepairAttemptId(taskId: string, runEpoch: number, attemptNumber: number): string {
  assertSafeSegment(taskId, "taskId");
  if (!Number.isSafeInteger(runEpoch) || runEpoch < 0) {
    throw new Error(`invalid runEpoch for repair attempt identity: ${JSON.stringify(runEpoch)}`);
  }
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`invalid attemptNumber for repair attempt identity: ${JSON.stringify(attemptNumber)}`);
  }
  return `${taskId}.e${runEpoch}.r${attemptNumber}`;
}

export type ParsedRepairAttemptId = {
  readonly taskId: string;
  readonly runEpoch: number;
  readonly attemptNumber: number;
};

// Inverse of deriveRepairAttemptId. Returns null when the id was not minted
// by deriveRepairAttemptId; never throws, so the store can treat an unknown
// id as "not found" instead of failing a whole listing.
export function parseRepairAttemptId(attemptId: string): ParsedRepairAttemptId | null {
  const match = /^(.*)\.e(\d+)\.r(\d+)$/.exec(attemptId);
  if (match === null) return null;
  const taskId = match[1] ?? "";
  const runEpoch = Number(match[2]);
  const attemptNumber = Number(match[3]);
  if (taskId.length === 0 || !Number.isSafeInteger(runEpoch) || !Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    return null;
  }
  try {
    const canonical = deriveRepairAttemptId(taskId, runEpoch, attemptNumber);
    if (canonical !== attemptId) return null;
  } catch {
    return null;
  }
  return { taskId, runEpoch, attemptNumber };
}

export type CreateRepairAttemptInput = {
  readonly taskId: string;
  readonly runEpoch: number;
  readonly workspaceId: string;
  // Defaults to 1: the first diagnosis of a blocked run.
  readonly attemptNumber?: number;
  readonly failedCheckIds: readonly string[];
  readonly failedEvidenceIds: readonly string[];
  readonly diagnosisRevision: string;
  readonly now?: number;
};

// A new attempt always starts in "diagnosing": a repair plan has not been
// made yet, so there is no state it could honestly start in.
export function createRepairAttempt(input: CreateRepairAttemptInput): RepairAttempt {
  if (input.workspaceId.length === 0) {
    throw new Error("invalid workspaceId for repair attempt: it must not be empty");
  }
  const attemptNumber = input.attemptNumber ?? 1;
  const attemptId = deriveRepairAttemptId(input.taskId, input.runEpoch, attemptNumber);
  const now = input.now ?? Date.now();
  return {
    attemptId,
    taskId: input.taskId,
    runEpoch: input.runEpoch,
    workspaceId: input.workspaceId,
    attemptNumber,
    state: "diagnosing",
    failedCheckIds: [...input.failedCheckIds],
    failedEvidenceIds: [...input.failedEvidenceIds],
    diagnosisRevision: input.diagnosisRevision,
    createdAt: now,
    updatedAt: now,
  };
}

export type AdvanceRepairAttemptContext = RepairTransitionContext & {
  // Attached to the advanced attempt when present. Pass the plan on the
  // diagnosing -> repair_planned move; passing it elsewhere only records it.
  readonly plan?: RepairPlan;
  // Attached when the move lands on a terminal state. When omitted, a
  // minimal outcome is synthesized from the terminal state (and from the
  // redirect reason on a retry-limit redirect), so a terminal attempt never
  // persists without an outcome.
  readonly outcome?: RepairOutcome;
};

function terminalOutcomeResult(state: RepairState): RepairOutcome["result"] | null {
  if (state === "repaired") return "repaired";
  if (state === "repair_failed") return "failed";
  if (state === "repair_cancelled") return "cancelled";
  return null;
}

// Pure advance: runs the table transition, then records plan/outcome payloads
// on the advanced copy. Rejections pass through untouched - the input attempt
// is never mutated, so a rejected move leaves no trace.
export function advanceRepairAttempt(
  attempt: RepairAttempt,
  next: RepairState,
  ctx: AdvanceRepairAttemptContext,
): RepairTransitionResult<RepairAttempt> {
  const transitioned = transitionRepairAttempt(attempt, next, ctx);
  if (transitioned.status === "rejected") return transitioned;
  const now = ctx.now ?? Date.now();
  let advanced = transitioned.attempt;
  if (ctx.plan !== undefined) {
    advanced = { ...advanced, plan: ctx.plan };
  }
  const terminal = terminalOutcomeResult(transitioned.to);
  if (terminal !== null) {
    let synthesized: RepairOutcome = { result: terminal, recordedAt: now };
    const synthesizedReason = transitioned.reason ?? ctx.reason;
    if (synthesizedReason !== undefined) {
      synthesized = { ...synthesized, reason: synthesizedReason };
    }
    const outcome: RepairOutcome = ctx.outcome ?? synthesized;
    advanced = { ...advanced, outcome };
  }
  return { ...transitioned, attempt: advanced };
}
