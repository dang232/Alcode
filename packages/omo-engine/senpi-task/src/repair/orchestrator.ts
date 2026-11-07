// Repair attempt orchestration: one linear pass over a single blocked
// ordinary task, from durable attempt creation to a gate-decided terminal
// state.
//
// The order is fixed and every step reads cancellation fresh from the
// injected callback, so a stop settles the attempt as repair_cancelled
// instead of pushing it forward:
//
//   1. createRepairAttempt (./attempt, starts in "diagnosing") +
//      createRepairAttemptStore (./store) + persist.
//   2. buildRepairDiagnosisInput (./diagnosis) from authoritative inputs
//      only (durabled evidence, catalogue, workspace revision). The attempt
//      is created already diagnosing, so no state edge is traversed here:
//      creation IS the diagnosing entry (a diagnosing -> diagnosing edge
//      does not exist in ./state and is never forced).
//   3. Ask the model through the injected RepairDiagnosisInvoker. A
//      "no defensible diagnosis" answer settles repair_failed with the
//      model's reason - never a fabricated repair.
//   4. validateRepairPlan (./plan). On rejection the violation reasons go
//      back to the model for at most MAX_PLAN_CORRECTIONS bounded
//      correction rounds, then the attempt settles repair_failed.
//   5. Apply edits through the injected RepairEditExecutor, then advance
//      to repairing. The executor reports the changed files; they travel to
//      reverification and to the manager-facing outcome. They are also
//      recorded on the terminal attempt outcome's detail line, because the
//      RepairAttempt record shape (./attempt) carries no changed-files
//      field and sibling modules are not modified here.
//   6. Advance to reverifying and call reverifyAfterRepair (./execute),
//      which owns revision recompute, stale invalidation, conservative
//      affected checks, the real capture, and the gate verdict.
//   7. Advance to repaired ONLY when the gate verdict is "verified";
//      otherwise repair_failed. "verified" is never written from a repair
//      state or a model claim - the gate verdict is the only source.
//
// ADAPTATIONS (parallel-lane files absent from src/repair at write time):
// - There is no ./model-diagnosis module on disk, so the invoker is an
//   injected dependency typed here (RepairDiagnosisInvoker). If a
//   model-diagnosis module lands later, its call should be wrapped to fit
//   this signature.
// - There is no ./edit-executor module on disk (no applyRepairEdits to
//   read), so the edit step is an injected dependency typed here
//   (RepairEditExecutor). If an edit-executor module lands later, it should
//   be wrapped to fit this signature.
// - ./diagnosis does not export its RepairDiagnosisInput type, so it is
//   re-derived here with Extract over the exported
//   RepairDiagnosisInputResult. ./plan does not export its
//   PlannedFileOperation type, so it is re-derived here from the exported
//   ValidateRepairPlanContext.
// - ./attempt also exports a minimal RepairPlan (summary/steps/createdAt)
//   that is DISTINCT from ./plan's RepairPlan. The terminal-capable plan
//   object validated and executed is always ./plan's RepairPlan; the
//   attempt record persists the projection planToAttemptPlan below.

import type { VerificationStatus } from "../verification/completion-status";
import type { OrdinaryCatalogue } from "../verification/catalogue";
import type { VerificationRunner } from "../verification/contract";
import {
  advanceRepairAttempt,
  createRepairAttempt,
  type RepairAttempt,
  type RepairOutcome,
} from "./attempt";
import {
  buildRepairDiagnosisInput,
  type RepairDiagnosisInputResult,
} from "./diagnosis";
import { reverifyAfterRepair } from "./execute";
import {
  validateRepairPlan,
  type RepairPlan,
  type RepairPlanViolation,
  type ValidateRepairPlanContext,
} from "./plan";
import type { RepairState } from "./state";
import { createRepairAttemptStore } from "./store";

// The authoritative diagnosis context the host builds from durable evidence.
// Re-derived here because ./diagnosis exports the result union but not this
// member type.
type RepairDiagnosisInput = Extract<
  RepairDiagnosisInputResult,
  { readonly ok: true }
>["input"];

// One proposed file operation behind filesToChange. Re-derived here because
// ./plan exports the validation context but not this member type.
export type RepairPlannedFileOperation = NonNullable<
  ValidateRepairPlanContext["fileOperations"]
>[number];

// What the model is asked, per round. correctionRound 0 is the initial ask;
// 1..MAX_PLAN_CORRECTIONS are bounded corrections carrying the previous
// round's violations.
export type RepairModelRequest = {
  readonly diagnosis: RepairDiagnosisInput;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly correctionRound: number;
  readonly previousViolations?: readonly RepairPlanViolation[];
};

export type RepairModelProposal =
  | {
      readonly status: "proposed";
      readonly plan: RepairPlan;
      readonly fileOperations?: readonly RepairPlannedFileOperation[];
    }
  | { readonly status: "no_defensible_diagnosis"; readonly reason: string };

// Injected model boundary (./model-diagnosis is absent on disk; this is the
// seam a future module wraps to fit). The orchestrator never treats a
// proposal as verified - it is validated, executed, and judged by the gate.
export type RepairDiagnosisInvoker = (
  request: RepairModelRequest,
) => Promise<RepairModelProposal>;

type RepairEditRequest = {
  readonly plan: RepairPlan;
  readonly diagnosis: RepairDiagnosisInput;
  readonly attemptId: string;
  readonly workspaceDir: string;
  readonly isCancelled?: () => boolean;
};

type RepairEditResult = {
  readonly changedFiles: readonly string[];
};

// Injected edit boundary (./edit-executor is absent on disk; this is the
// seam a future applyRepairEdits wraps to fit). The executor owns the
// workspace writes; the orchestrator only routes its reported footprint.
export type RepairEditExecutor = (
  request: RepairEditRequest,
) => Promise<RepairEditResult>;

export type RunRepairAttemptInput = {
  readonly taskId: string;
  readonly runEpoch: number;
  readonly workspaceId: string;
  readonly attemptNumber?: number;
  // Evidence run id the diagnosis builder reads. Defaults to taskId: the
  // common case binds one run id per task.
  readonly runId?: string;
  // The original failed evidence the durable attempt is created with.
  readonly failedCheckIds: readonly string[];
  readonly failedEvidenceIds: readonly string[];
  readonly diagnosisRevision: string;
  // Authoritative inputs the diagnosis builder and the gate read.
  readonly catalogue: OrdinaryCatalogue;
  readonly evidenceRoot: string;
  readonly workspaceDir: string;
  readonly repairStoreRoot: string;
  // Injected boundaries.
  readonly invoker: RepairDiagnosisInvoker;
  readonly editExecutor: RepairEditExecutor;
  readonly runner: VerificationRunner;
  // Re-read before and after every step; never cached.
  readonly isCancelled?: () => boolean;
  readonly sessionId?: string;
  // Forwarded to every state transition (caps the reverifying -> repairing
  // loop for a manager-driven next round).
  readonly retryLimit?: number;
  readonly now?: number;
};

// The attempt record fields the manager needs, plus the gate verdict that
// decided the terminal state. gateVerdict is present only when
// reverifyAfterRepair evaluated and the gate judged.
export type RepairAttemptOutcome = {
  readonly attemptId: string;
  readonly finalState: RepairState;
  readonly gateVerdict?: VerificationStatus;
  readonly gateCode?: string;
  readonly changedFiles: readonly string[];
  readonly reason?: string;
  readonly detail?: string;
};

// Bounded plan corrections: the initial proposal plus this many retries.
export const MAX_PLAN_CORRECTIONS = 2;

function terminalResult(
  state: "repaired" | "repair_failed" | "repair_cancelled",
): "repaired" | "failed" | "cancelled" {
  if (state === "repaired") return "repaired";
  if (state === "repair_failed") return "failed";
  return "cancelled";
}

// Projection of the validated ./plan RepairPlan onto the ./attempt record's
// minimal plan shape (summary/steps/createdAt). The full plan object drives
// the edit executor and reverification; the record keeps the summary.
function planToAttemptPlan(plan: RepairPlan, createdAt: number): RepairAttempt["plan"] {
  return {
    summary: plan.suspectedRootCause,
    steps: [
      ...plan.filesToChange.map((file) => `edit ${file}`),
      ...plan.checksToRerun.map((checkId) => `rerun ${checkId}`),
    ],
    createdAt,
  };
}

function violationDetail(violations: readonly RepairPlanViolation[]): string {
  return violations
    .map((violation) =>
      violation.path === undefined
        ? `${violation.code}: ${violation.message}`
        : `${violation.code}(${violation.path}): ${violation.message}`,
    )
    .join("; ");
}

export async function runRepairAttempt(
  input: RunRepairAttemptInput,
): Promise<RepairAttemptOutcome> {
  const taskId = input.taskId;
  const runEpoch = input.runEpoch;
  const runId = input.runId ?? input.taskId;
  const attemptNumber = input.attemptNumber ?? 1;
  const clock = (): number => input.now ?? Date.now();
  const cancelled = (): boolean => input.isCancelled?.() === true;

  const store = createRepairAttemptStore({ root: input.repairStoreRoot });
  let attempt = createRepairAttempt({
    taskId,
    runEpoch,
    workspaceId: input.workspaceId,
    attemptNumber,
    failedCheckIds: input.failedCheckIds,
    failedEvidenceIds: input.failedEvidenceIds,
    diagnosisRevision: input.diagnosisRevision,
    now: clock(),
  });
  store.save(attempt);
  let changedFiles: readonly string[] = [];

  const transitionCtx = () => ({
    taskId,
    runEpoch,
    retryLimit: input.retryLimit,
    now: clock(),
  });

  // Settle to a terminal state, persist, and report. All non-terminal repair
  // states carry the repair_failed and repair_cancelled edges, so this holds
  // from any step that has not already terminated.
  const settle = (
    current: RepairAttempt,
    next: "repaired" | "repair_failed" | "repair_cancelled",
    reason?: string,
    detail?: string,
    gateVerdict?: VerificationStatus,
    gateCode?: string,
  ): RepairAttemptOutcome => {
    let settleOutcome: RepairOutcome = {
      result: terminalResult(next),
      recordedAt: clock(),
    };
    if (reason !== undefined) settleOutcome = { ...settleOutcome, reason };
    if (detail !== undefined) settleOutcome = { ...settleOutcome, detail };
    const settled = advanceRepairAttempt(current, next, {
      ...transitionCtx(),
      reason,
      outcome: settleOutcome,
    });
    if (settled.status === "rejected") {
      throw new Error(
        `repair orchestration cannot settle ${current.state} to ${next}: ${settled.reason}`,
      );
    }
    attempt = settled.attempt;
    store.save(attempt);
    const outcome: RepairAttemptOutcome = {
      attemptId: attempt.attemptId,
      finalState: attempt.state,
      changedFiles: [...changedFiles],
    };
    let withVerdict = outcome;
    if (gateVerdict !== undefined) withVerdict = { ...withVerdict, gateVerdict };
    if (gateCode !== undefined) withVerdict = { ...withVerdict, gateCode };
    if (reason !== undefined) withVerdict = { ...withVerdict, reason };
    if (detail !== undefined) withVerdict = { ...withVerdict, detail };
    return withVerdict;
  };

  const settleCancelled = (current: RepairAttempt): RepairAttemptOutcome =>
    settle(current, "repair_cancelled", "cancelled");

  // Advance one non-terminal edge; throws on rejection because the caller
  // drives the table's legal path with fenced identity.
  const advance = (
    current: RepairAttempt,
    next: RepairState,
    plan?: RepairAttempt["plan"],
  ): RepairAttempt => {
    let advanceInput: ReturnType<typeof transitionCtx> & { readonly plan?: RepairAttempt["plan"] } = transitionCtx();
    if (plan !== undefined) advanceInput = { ...advanceInput, plan };
    const moved = advanceRepairAttempt(current, next, advanceInput);
    if (moved.status === "rejected") {
      throw new Error(
        `repair orchestration illegal transition ${current.state} -> ${next}: ${moved.reason}`,
      );
    }
    store.save(moved.attempt);
    return moved.attempt;
  };

  // Already diagnosing by construction (creation is the diagnosing entry).
  if (cancelled()) return settleCancelled(attempt);

  const built = buildRepairDiagnosisInput({
    taskId,
    runId,
    epoch: runEpoch,
    catalogue: input.catalogue,
    evidenceRoot: input.evidenceRoot,
    workspaceDir: input.workspaceDir,
    attemptStore: store,
  });
  if (!built.ok) {
    return settle(
      attempt,
      "repair_failed",
      `diagnosis_unavailable:${built.reason}`,
      built.detail,
    );
  }
  const diagnosis = built.input;
  if (cancelled()) return settleCancelled(attempt);

  // Model rounds: initial proposal plus at most MAX_PLAN_CORRECTIONS
  // corrections. Violations from each rejection feed the next round.
  let plan: RepairPlan | null = null;
  let previousViolations: readonly RepairPlanViolation[] | undefined;
  for (let round = 0; round <= MAX_PLAN_CORRECTIONS; round += 1) {
    if (cancelled()) return settleCancelled(attempt);
    let proposal: RepairModelProposal;
    try {
      let repairRequest: RepairModelRequest = {
        diagnosis,
        attemptId: attempt.attemptId,
        attemptNumber: attempt.attemptNumber,
        correctionRound: round,
      };
      if (previousViolations !== undefined) repairRequest = { ...repairRequest, previousViolations };
      proposal = await input.invoker(repairRequest);
    } catch (error) {
      return settle(
        attempt,
        "repair_failed",
        "diagnosis_invoker_error",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (cancelled()) return settleCancelled(attempt);
    if (proposal.status === "no_defensible_diagnosis") {
      return settle(attempt, "repair_failed", "no_defensible_diagnosis", proposal.reason);
    }
    let validationContext: ValidateRepairPlanContext = { catalogue: input.catalogue };
    if (proposal.fileOperations !== undefined) validationContext = { ...validationContext, fileOperations: proposal.fileOperations };
    const validation = validateRepairPlan(proposal.plan, validationContext);
    if (validation.ok) {
      plan = proposal.plan;
      break;
    }
    previousViolations = validation.violations;
    if (round >= MAX_PLAN_CORRECTIONS) {
      return settle(
        attempt,
        "repair_failed",
        "plan_retry_exhausted",
        violationDetail(validation.violations),
      );
    }
  }
  if (plan === null) {
    throw new Error("repair orchestration plan loop ended without a plan");
  }

  attempt = advance(attempt, "repair_planned", planToAttemptPlan(plan, clock()));
  if (cancelled()) return settleCancelled(attempt);

  try {
    const edited = await input.editExecutor({
      plan,
      diagnosis,
      attemptId: attempt.attemptId,
      workspaceDir: input.workspaceDir,
      isCancelled: input.isCancelled,
    });
    changedFiles = [...edited.changedFiles];
  } catch (error) {
    return settle(
      attempt,
      "repair_failed",
      "edit_error",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (cancelled()) return settleCancelled(attempt);

  attempt = advance(attempt, "repairing");
  attempt = advance(attempt, "reverifying");
  if (cancelled()) return settleCancelled(attempt);

  let reverified: Awaited<ReturnType<typeof reverifyAfterRepair>>;
  try {
    reverified = await reverifyAfterRepair({
      taskId,
      runEpoch,
      workspaceDir: input.workspaceDir,
      evidenceRoot: input.evidenceRoot,
      catalogue: input.catalogue,
      plan,
      runner: input.runner,
      changedFiles,
      isCancelled: input.isCancelled,
      sessionId: input.sessionId,
    });
  } catch (error) {
    return settle(
      attempt,
      "repair_failed",
      "reverify_error",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (reverified.status === "cancelled" || cancelled()) {
    return settleCancelled(attempt);
  }
  if (reverified.status === "stale") {
    return settle(
      attempt,
      "repair_failed",
      "reverification_stale",
      "workspace moved mid-run; fresh evidence no longer describes the tree",
    );
  }
  if (reverified.status === "rejected") {
    return settle(
      attempt,
      "repair_failed",
      "reverify_rejected",
      violationDetail(reverified.violations),
    );
  }
  // The gate verdict is the only source of "verified": a "repaired" advance
  // happens exclusively on this branch, never from a model claim.
  if (reverified.verification === "verified") {
    return settle(
      attempt,
      "repaired",
      undefined,
      changedFiles.length === 0
        ? "no files changed"
        : `changedFiles: ${changedFiles.join(", ")}`,
      reverified.verification,
      reverified.code,
    );
  }
  return settle(
    attempt,
    "repair_failed",
    `reverification_blocked:${reverified.code ?? "unknown"}`,
    reverified.reason ?? "gate verdict is not verified",
    reverified.verification,
    reverified.code,
  );
}
