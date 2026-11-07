// Post-repair reverification: one executor closing the repair vertical slice.
//
// The repair proposes (see ./plan.ts) and the completion gate disposes (see
// ../verification/completion-gate.ts). This module is the narrow bridge between
// them: validate the plan, rerun exactly the required approved checks against
// the post-repair tree, and hand the fresh evidence to the gate. It judges
// nothing itself - acceptance stays solely with evaluateOrdinaryCompletion.

import { catalogueChecks, type OrdinaryCatalogue } from "../verification/catalogue";
import { evaluateOrdinaryCompletion } from "../verification/completion-gate";
import type { CompletionBlockCode, VerificationStatus } from "../verification/completion-status";
import type { VerificationRunner } from "../verification/contract";
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store";
import { createOrdinaryVerificationCapture } from "../verification/ordinary-capture";
import { requiredReverification } from "./reverify";
import { validateRepairPlan, type RepairPlan, type RepairPlanViolation } from "./plan";

export type ReverifyAfterRepairInput = {
  readonly taskId: string;
  readonly runEpoch: number;
  readonly workspaceDir: string;
  readonly evidenceRoot: string;
  readonly catalogue: OrdinaryCatalogue;
  readonly plan: RepairPlan;
  readonly runner: VerificationRunner;
  readonly changedFiles: readonly string[];
  readonly isCancelled?: () => boolean;
  readonly sessionId?: string;
};

export type ReverifyAfterRepairResult =
  | { readonly status: "rejected"; readonly violations: readonly RepairPlanViolation[] }
  | {
      readonly status: "evaluated";
      readonly verification: VerificationStatus;
      readonly code?: CompletionBlockCode;
      readonly reason?: string;
      readonly evidenceRevision: string;
      readonly executedCheckIds: readonly string[];
    }
  | { readonly status: "cancelled" }
  | { readonly status: "stale" };

export async function reverifyAfterRepair(input: ReverifyAfterRepairInput): Promise<ReverifyAfterRepairResult> {
  // 1. The plan is a proposal, never an authority: reject before anything runs.
  const validation = validateRepairPlan(input.plan, { catalogue: input.catalogue });
  if (!validation.ok) {
    return { status: "rejected", violations: validation.violations };
  }
  if (input.isCancelled?.() === true) {
    return { status: "cancelled" };
  }

  // 2. The authoritative post-repair revision. Prior evidence is invalidated by
  // construction, never by deletion: every verification record is bound to the
  // sourceRevision (workspace HEAD plus working-tree digest) observed when its
  // check ran, and the completion gate rejects any record whose sourceRevision
  // differs from the current tree as stale. A repair changes the tree, so the
  // recomputed revision differs from every pre-repair record's revision and no
  // older passing record can satisfy the gate - only the records written below,
  // stamped with this revision, count. This function never reads old records.
  const evidenceRevision = workspaceRevision(input.workspaceDir);

  // 3. Rerun exactly the required set through the shared capture path. The
  // catalogue is filtered down to the required ids first, so the capture can
  // only execute checks the repair analysis named - never a wider set.
  const requiredCheckIds = requiredReverification(input.plan, input.catalogue, input.changedFiles);
  const required = new Set(requiredCheckIds);
  const available = catalogueChecks(input.catalogue).filter((check) => required.has(check.checkId));

  const store = createFileEvidenceStore(input.evidenceRoot);
  const capture = createOrdinaryVerificationCapture({
    store,
    projectDir: input.workspaceDir,
    currentRevision: () => evidenceRevision,
    runner: input.runner,
    isCancelled: input.isCancelled,
  });
  const captured = await capture.capture({
    binding: { runId: input.taskId, sessionId: input.sessionId ?? input.taskId, epoch: input.runEpoch },
    changedFiles: input.changedFiles,
    available,
  });
  const executedCheckIds = captured.records.map((record) => record.checkId);

  // 5a. Fail closed on cancellation: a stop observed after execution still
  // returns before the gate, so a cancelled run never earns a verdict.
  if (input.isCancelled?.() === true) {
    return { status: "cancelled" };
  }

  // 5b. Fail closed on mid-run tree movement: when the workspace revision after
  // execution differs from the revision the new records were stamped with, the
  // evidence no longer describes the tree and the gate must not see it.
  if (workspaceRevision(input.workspaceDir) !== evidenceRevision) {
    return { status: "stale" };
  }

  // 4. The sole completion authority decides on the freshly written evidence.
  const verdict = evaluateOrdinaryCompletion({
    taskId: input.taskId,
    catalogue: input.catalogue,
    evidenceRoot: input.evidenceRoot,
    workspaceDir: input.workspaceDir,
    epoch: input.runEpoch,
  });
  let evaluated: Extract<ReverifyAfterRepairResult, { status: "evaluated" }> = {
    status: "evaluated",
    verification: verdict.verification,
    evidenceRevision,
    executedCheckIds,
  };
  if (verdict.code !== undefined) {
    evaluated = { ...evaluated, code: verdict.code };
  }
  if (verdict.reason !== undefined) {
    evaluated = { ...evaluated, reason: verdict.reason };
  }
  return evaluated;
}
