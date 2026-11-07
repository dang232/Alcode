// Repair-chain adversarial integration suite.
//
// INTEGRATION SCAFFOLDING: every test drives the REAL modules on disk -
// orchestrator.runRepairAttempt, edit-executor.applyRepairEdits,
// plan.validateRepairPlan, execute.reverifyAfterRepair,
// verification/completion-gate.evaluateOrdinaryCompletion, and
// repair/store.createRepairAttemptStore - against REAL temp workspaces under
// os.tmpdir (created per test, removed in afterEach; never inside the repo).
// The ONLY scripted seams are the model invoker (RepairDiagnosisInvoker), the
// edit-executor callback the orchestrator owns, and the verification runner
// handle (the exact knob a real check execution turns). No model calls, no
// sleeps, no production edits.
import { describe, expect, test, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DagVerifyCheck, DagVerifyCheckCategory } from "../dag/verification";
import { parseVerificationRecord, runVerificationCommand } from "../dag/verification";
import { VERIFICATION_STATUSES } from "../verification/contract";
import type { VerificationCommandResult, VerificationRunner } from "../verification/contract";
import { catalogueFrom, type OrdinaryCatalogue } from "../verification/catalogue";
import { evaluateOrdinaryCompletion } from "../verification/completion-gate";
import { isBlocked, isVerified } from "../verification/completion-status";
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store";
import { createOrdinaryVerificationCapture } from "../verification/ordinary-capture";
import { advanceRepairAttempt, createRepairAttempt } from "./attempt";
import { applyRepairEdits } from "./edit-executor";
import { reverifyAfterRepair } from "./execute";
import { MAX_PLAN_CORRECTIONS, runRepairAttempt } from "./orchestrator";
import type {
  RepairDiagnosisInvoker,
  RepairEditExecutor,
  RepairModelProposal,
  RunRepairAttemptInput,
} from "./orchestrator";
import { validateRepairPlan, type RepairPlan } from "./plan";
import { createRepairAttemptStore } from "./store";
import { isLegalRepairTransition, REPAIR_STATES, transitionRepairAttempt } from "./state";

const roots: string[] = [];
function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
}

// One unified git workspace per test: ordinary files for evidence/gate tests
// plus src + verification + approval material for executor/plan tests.
function gitWorkspace(name: string): string {
  const workspace = join(tempRoot(name), "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "verification"), { recursive: true });
  mkdirSync(join(workspace, ".alcode"), { recursive: true });
  writeFileSync(join(workspace, "tracked.txt"), "baseline\n");
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "repair-integration", private: true }));
  writeFileSync(join(workspace, "src", "fix.ts"), "export const counter = 0;\n");
  writeFileSync(join(workspace, "src", "other.ts"), "export const other = 1;\n");
  writeFileSync(join(workspace, "verification", "catalogue.json"), '{"checks":[]}\n');
  writeFileSync(join(workspace, ".alcode", "approval.json"), '{"approvers":[]}\n');
  git(workspace, "init", "-q");
  git(workspace, "add", "-A");
  git(workspace, "-c", "user.email=t@x", "-c", "user.name=t", "commit", "-qm", "init");
  return workspace;
}

function makeCheck(
  id: string,
  coveredPaths?: readonly string[],
  category: DagVerifyCheckCategory = "unit",
): DagVerifyCheck {
  const check: DagVerifyCheck = {
    checkId: id,
    category,
    command: ["node", "-e", "process.exit(0)"],
    timeoutMs: 20_000,
    criteria: [],
  };
  return coveredPaths === undefined ? check : { ...check, coveredPaths: [...coveredPaths] };
}

function catalogueFor(checks: readonly DagVerifyCheck[]): OrdinaryCatalogue {
  return catalogueFrom(
    checks.map((check) => ({
      check,
      provenance: { source: "config" as const, location: "repair.integration.test", reason: "test" },
    })),
  );
}

function stubRunner(exitCode: number, output: string): VerificationRunner {
  return async (): Promise<VerificationCommandResult> => ({
    started: true,
    exitCode,
    timedOut: false,
    cancelled: false,
    output,
    outputBytes: output.length,
    durationMs: 5,
    uncertainEffect: false,
  });
}

async function captureEvidence(options: {
  readonly workspace: string;
  readonly evidenceRoot: string;
  readonly runId: string;
  readonly epoch: number;
  readonly checks: readonly DagVerifyCheck[];
  readonly exitCode: number;
  readonly output: string;
}): Promise<void> {
  const capture = createOrdinaryVerificationCapture({
    store: createFileEvidenceStore(options.evidenceRoot),
    projectDir: options.workspace,
    currentRevision: () => workspaceRevision(options.workspace),
    runner: stubRunner(options.exitCode, options.output),
  });
  await capture.capture({
    binding: { runId: options.runId, sessionId: "repair-integration", epoch: options.epoch },
    changedFiles: ["src/fix.ts"],
    available: options.checks,
  });
}

function goodPlan(): RepairPlan {
  return {
    addressedCheckIds: ["unit-a"],
    suspectedRootCause: "off-by-one in the retry counter",
    supportingEvidence: ["exit code 4 in unit-a output"],
    filesToChange: ["src/fix.ts"],
    expectedBehaviourChange: "retry counter increments once per round",
    risks: ["none observed"],
    checksToRerun: ["unit-a"],
    checksToRemainUnchanged: [],
    rollbackPlan: "revert src/fix.ts",
  };
}

function badPlan(): RepairPlan {
  return {
    ...goodPlan(),
    claimedComplete: true,
    checksToRerun: [],
    addressedCheckIds: ["phantom-check"],
  };
}

function baseInput(options: {
  readonly workspace: string;
  readonly evidenceRoot: string;
  readonly repairRoot: string;
  readonly catalogue: OrdinaryCatalogue;
  readonly runId: string;
  readonly epoch: number;
  readonly invoker: RepairDiagnosisInvoker;
  readonly editExecutor: RepairEditExecutor;
  readonly runner: VerificationRunner;
  readonly isCancelled?: () => boolean;
}): RunRepairAttemptInput {
  return {
    taskId: "task-1",
    runId: options.runId,
    runEpoch: options.epoch,
    workspaceId: "ws-1",
    attemptNumber: 1,
    failedCheckIds: ["unit-a"],
    failedEvidenceIds: [],
    diagnosisRevision: workspaceRevision(options.workspace),
    catalogue: options.catalogue,
    evidenceRoot: options.evidenceRoot,
    workspaceDir: options.workspace,
    repairStoreRoot: options.repairRoot,
    invoker: options.invoker,
    editExecutor: options.editExecutor,
    runner: options.runner,
    isCancelled: options.isCancelled,
    now: 1000,
  };
}

function scriptedEdit(workspace: string, edits: readonly string[] = ["src/fix.ts"]): RepairEditExecutor {
  return async () => {
    for (const file of edits) {
      const target = join(workspace, file);
      mkdirSync(join(workspace, "src"), { recursive: true });
      writeFileSync(target, "repaired\n");
    }
    return { changedFiles: [...edits] };
  };
}

describe("repair integration", () => {
  test("model cannot forge verification evidence: fabricated verified claim leaves the gate blocked", async () => {
    const workspace = gitWorkspace("rint-forge-");
    const evidenceRoot = join(tempRoot("rint-forge-ev-"), "evidence");
    const repairRoot = join(tempRoot("rint-forge-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    const catalogue = catalogueFor(checks);
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let editsRan = false;
    // Fabricated "verified" claim: the model declares the repair complete in
    // the plan itself instead of earning a gate verdict.
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue,
        runId: "task-1",
        epoch: 0,
        invoker: async () => {
          const proposal: RepairModelProposal = {
            status: "proposed",
            plan: { ...goodPlan(), claimedComplete: true },
          };
          return proposal;
        },
        editExecutor: async () => {
          editsRan = true;
          return { changedFiles: [] };
        },
        runner: stubRunner(0, "green"),
      }),
    );

    // The validator rejects claims_completion on every round, so the forged
    // claim never reaches the executor and never earns a verdict.
    expect(outcome.finalState).toBe("repair_failed");
    expect(outcome.reason).toBe("plan_retry_exhausted");
    expect(outcome.gateVerdict).toBeUndefined();
    expect(editsRan).toBe(false);
    const gate = evaluateOrdinaryCompletion({
      taskId: "task-1",
      catalogue,
      evidenceRoot,
      workspaceDir: workspace,
      epoch: 0,
    });
    expect(gate.verification).toBe("blocked");
    expect(isVerified(gate)).toBe(false);
  });

  test("model cannot edit approval authority or catalogue paths: applyRepairEdits rejects protected paths", async () => {
    const workspace = gitWorkspace("rint-protected-");
    const baseline = workspaceRevision(workspace);
    const beforeCatalogue = readFileSync(join(workspace, "verification", "catalogue.json"), "utf8");
    const beforeApproval = readFileSync(join(workspace, ".alcode", "approval.json"), "utf8");

    const catalogueReceipt = await applyRepairEdits({
      plan: {
        ...goodPlan(),
        addressedCheckIds: ["unit-a"],
        filesToChange: ["verification/catalogue.json"],
      },
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "verification/catalogue.json", oldText: '"checks":[]', newText: '"checks":["x"]' }],
    });
    expect(catalogueReceipt.status).toBe("rejected");
    expect(catalogueReceipt.files).toEqual([]);
    expect(catalogueReceipt.failures).toHaveLength(1);
    expect(catalogueReceipt.failures[0]?.code).toBe("protected_path");
    expect(readFileSync(join(workspace, "verification", "catalogue.json"), "utf8")).toBe(beforeCatalogue);

    const approvalReceipt = await applyRepairEdits({
      plan: {
        ...goodPlan(),
        addressedCheckIds: ["unit-a"],
        filesToChange: [".alcode/approval.json"],
      },
      workspaceDir: workspace,
      baselineRevision: workspaceRevision(workspace),
      edits: [{ path: ".alcode/approval.json", oldText: '"approvers":[]', newText: '"approvers":["mallory"]' }],
    });
    expect(approvalReceipt.status).toBe("rejected");
    expect(approvalReceipt.files).toEqual([]);
    expect(approvalReceipt.failures[0]?.code).toBe("protected_path");
    expect(readFileSync(join(workspace, ".alcode", "approval.json"), "utf8")).toBe(beforeApproval);
    expect(workspaceRevision(workspace)).toBe(baseline);
  });

  test("model cannot weaken the catalogue: validateRepairPlan rejects test deletion, skips, and phantom checks", () => {
    const catalogue = catalogueFor([makeCheck("unit-a", ["src"]), makeCheck("unit-b", ["other"])]);
    const bad: RepairPlan = {
      ...goodPlan(),
      filesToChange: ["src/fix.ts", "verification/catalogue.json"],
      checksToRerun: ["unit-a", "phantom-check"],
      claimedComplete: true,
    };
    const result = validateRepairPlan(bad, {
      catalogue,
      fileOperations: [
        { path: "src/fix.test.ts", operation: "delete" },
        { path: "src/extra.ts", operation: "modify" },
      ],
    });
    expect(result.ok).toBe(false);
    const codes = result.violations.map((violation) => violation.code);
    expect(codes).toContain("weakens_required_test");
    expect(codes).toContain("protected_verification_authority");
    expect(codes).toContain("unjustified_scope_broadening");
    expect(codes).toContain("unknown_check");
    expect(codes).toContain("claims_completion");
    const missing = validateRepairPlan({ ...goodPlan(), checksToRerun: [] }, { catalogue });
    expect(missing.ok).toBe(false);
    expect(missing.violations.map((violation) => violation.code)).toContain("missing_rerun_set");
    expect(validateRepairPlan(goodPlan(), { catalogue }).ok).toBe(true);
  });

  test("model cannot bypass plan validation: orchestrator refuses an unvalidated plan without running edits", async () => {
    const workspace = gitWorkspace("rint-nobypass-");
    const evidenceRoot = join(tempRoot("rint-nobypass-ev-"), "evidence");
    const repairRoot = join(tempRoot("rint-nobypass-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let invokerCalls = 0;
    let editsRan = false;
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async () => {
          invokerCalls += 1;
          const proposal: RepairModelProposal = { status: "proposed", plan: badPlan() };
          return proposal;
        },
        editExecutor: async () => {
          editsRan = true;
          return { changedFiles: [] };
        },
        runner: stubRunner(0, "green"),
      }),
    );

    expect(MAX_PLAN_CORRECTIONS).toBe(2);
    expect(invokerCalls).toBe(1 + MAX_PLAN_CORRECTIONS);
    expect(editsRan).toBe(false);
    expect(outcome.finalState).toBe("repair_failed");
    expect(outcome.reason).toBe("plan_retry_exhausted");
    expect(outcome.gateVerdict).toBeUndefined();
  });

  test("model cannot modify unapproved files without renewed validation: out-of-scope plan and off-plan edit both reject", async () => {
    // Plan layer: unit-a owns src/ only, so a plan touching other/ is outside
    // every addressed check's approved scope.
    const catalogue = catalogueFor([makeCheck("unit-a", ["src"])]);
    const scoped = validateRepairPlan(
      { ...goodPlan(), filesToChange: ["other/hack.ts"] },
      { catalogue },
    );
    expect(scoped.ok).toBe(false);
    expect(scoped.violations.map((violation) => violation.code)).toContain("outside_approved_scope");

    // Executor layer: even with a valid plan, an edit outside filesToChange
    // is rejected before anything is written.
    const workspace = gitWorkspace("rint-scope-");
    const baseline = workspaceRevision(workspace);
    const beforeFix = readFileSync(join(workspace, "src", "fix.ts"), "utf8");
    const beforeOther = readFileSync(join(workspace, "src", "other.ts"), "utf8");
    const receipt = await applyRepairEdits({
      plan: goodPlan(),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "src/other.ts", oldText: "other = 1", newText: "other = 2" }],
    });
    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures[0]?.code).toBe("outside_plan");
    expect(readFileSync(join(workspace, "src", "fix.ts"), "utf8")).toBe(beforeFix);
    expect(readFileSync(join(workspace, "src", "other.ts"), "utf8")).toBe(beforeOther);
    expect(workspaceRevision(workspace)).toBe(baseline);
  });

  test("claimed edit with no real filesystem change is rejected: lying writer yields no_filesystem_change", async () => {
    const workspace = gitWorkspace("rint-nochange-");
    const baseline = workspaceRevision(workspace);
    const before = readFileSync(join(workspace, "src", "fix.ts"), "utf8");
    const receipt = await applyRepairEdits({
      plan: goodPlan(),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "src/fix.ts", oldText: "counter = 0", newText: "counter = 1" }],
      overrides: {
        // Test-only seam simulating a lying writer: resolves without touching disk.
        executeEdit: async () => undefined,
      },
    });
    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0]?.code).toBe("no_filesystem_change");
    expect(readFileSync(join(workspace, "src", "fix.ts"), "utf8")).toBe(before);
  });

  test("external user edits are not overwritten: concurrent modification yields revision_conflict", async () => {
    const workspace = gitWorkspace("rint-conflict-");
    const baseline = workspaceRevision(workspace);
    writeFileSync(join(workspace, "src", "other.ts"), "export const other = 99;\n");
    const beforeFix = readFileSync(join(workspace, "src", "fix.ts"), "utf8");
    const receipt = await applyRepairEdits({
      plan: goodPlan(),
      workspaceDir: workspace,
      baselineRevision: baseline,
      edits: [{ path: "src/fix.ts", oldText: "counter = 0", newText: "counter = 1" }],
    });
    expect(receipt.status).toBe("rejected");
    expect(receipt.files).toEqual([]);
    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0]?.code).toBe("revision_conflict");
    expect(readFileSync(join(workspace, "src", "fix.ts"), "utf8")).toBe(beforeFix);
    expect(readFileSync(join(workspace, "src", "other.ts"), "utf8")).toBe("export const other = 99;\n");
  });

  test("stale evidence cannot complete: tree movement turns verified into verification_stale", async () => {
    const workspace = gitWorkspace("rint-stale-");
    const evidenceRoot = join(tempRoot("rint-stale-ev-"), "evidence");
    const checks = [makeCheck("unit-a", ["src"])];
    const catalogue = catalogueFor(checks);
    await captureEvidence({ workspace, evidenceRoot, runId: "run-pass", epoch: 0, checks, exitCode: 0, output: "green" });
    const fresh = evaluateOrdinaryCompletion({ taskId: "run-pass", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(fresh.verification).toBe("verified");

    writeFileSync(join(workspace, "tracked.txt"), "edited after verification\n");
    const moved = evaluateOrdinaryCompletion({ taskId: "run-pass", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(moved.verification).toBe("blocked");
    expect(moved.code).toBe("verification_stale");
    expect(isVerified(moved)).toBe(false);
    expect(isBlocked(moved)).toBe(true);
  });

  test("failed re-verification cannot become verified: failing runner stays blocked", async () => {
    const workspace = gitWorkspace("rint-failreverify-");
    const evidenceRoot = join(tempRoot("rint-failreverify-ev-"), "evidence");
    const catalogue = catalogueFor([makeCheck("unit-a", ["src"]), makeCheck("unit-b", ["other"])]);
    const outcome = await reverifyAfterRepair({
      taskId: "task-1",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue,
      plan: goodPlan(),
      runner: stubRunner(2, "still red"),
      changedFiles: ["src/fix.ts"],
    });
    if (outcome.status !== "evaluated") throw new Error("expected evaluation, got " + outcome.status);
    expect(outcome.verification).toBe("blocked");
    expect(outcome.code).toBe("verification_failed");
    expect(outcome.executedCheckIds).toEqual(["unit-a"]);
  });

  test("execute.ts mid-run movement fence is load-bearing: a check that edits a tracked file during capture makes reverifyAfterRepair return stale, never verified", async () => {
    const workspace = gitWorkspace("rint-midrun-");
    const evidenceRoot = join(tempRoot("rint-midrun-ev-"), "evidence");
    // The check itself moves the tree while it runs: tracked.txt is git-tracked at init, so
    // appending to it changes the workspace revision between evidence capture and the fence.
    const movingCheck: DagVerifyCheck = {
      checkId: "unit-a",
      category: "unit",
      command: ["node", "-e", "require('node:fs').appendFileSync('tracked.txt','moved during check\\n')"],
      timeoutMs: 20_000,
      criteria: [],
      coveredPaths: ["src"],
    };
    const catalogue = catalogueFor([movingCheck]);
    const revisionBeforeRun = workspaceRevision(workspace);

    const outcome = await reverifyAfterRepair({
      taskId: "task-1",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue,
      plan: goodPlan(),
      // The real production runner: the check command executes in the workspace and edits it.
      runner: runVerificationCommand,
      changedFiles: ["src/fix.ts"],
    });

    expect(outcome.status).toBe("stale");
    if (outcome.status !== "stale") throw new Error("expected stale, got " + outcome.status);
    // The tree really moved during the run, and the fresh evidence for it was written before
    // the fence refused the verdict.
    expect(workspaceRevision(workspace)).not.toBe(revisionBeforeRun);
    expect(readFileSync(join(workspace, "tracked.txt"), "utf8")).toContain("moved during check");
    expect(createFileEvidenceStore(evidenceRoot).listVerifications("task-1").length).toBeGreaterThan(0);

    // Even if a caller ignored the stale status and asked the gate, the movement must block it:
    // "verified" is unreachable for evidence describing a tree that has since changed.
    const gate = evaluateOrdinaryCompletion({ taskId: "task-1", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(gate.verification).toBe("blocked");
    expect(isVerified(gate)).toBe(false);
  });

  test("old epoch cannot publish events or completion: stale transition, stale store write, and cross-epoch gate block", async () => {
    const attempt = createRepairAttempt({
      taskId: "task-1",
      runEpoch: 0,
      workspaceId: "ws-1",
      failedCheckIds: ["unit-a"],
      failedEvidenceIds: [],
      diagnosisRevision: "rev-0",
      now: 1000,
    });
    const staleMove = transitionRepairAttempt(attempt, "repair_planned", { taskId: "task-1", runEpoch: 1, now: 1001 });
    expect(staleMove.status).toBe("rejected");
    if (staleMove.status === "rejected") expect(staleMove.reason).toBe("stale_epoch");

    const root = join(tempRoot("rint-epoch-"), "repairs");
    const store = createRepairAttemptStore({ root });
    const newer = createRepairAttempt({
      taskId: "task-1",
      runEpoch: 1,
      workspaceId: "ws-1",
      failedCheckIds: ["unit-a"],
      failedEvidenceIds: [],
      diagnosisRevision: "rev-1",
      now: 2000,
    });
    store.save(newer);
    const older = { ...attempt, updatedAt: 3000 };
    expect(() => store.save(older)).toThrow(/stale/);
    expect(store.list("task-1").map((entry) => entry.attemptId)).toEqual([newer.attemptId]);

    const workspace = gitWorkspace("rint-epochws-");
    const evidenceRoot = join(tempRoot("rint-epoch-ev-"), "evidence");
    const checks = [makeCheck("unit-a", ["src"])];
    const catalogue = catalogueFor(checks);
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 0, output: "green" });
    const sameEpoch = evaluateOrdinaryCompletion({ taskId: "task-1", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(sameEpoch.verification).toBe("verified");
    const otherEpoch = evaluateOrdinaryCompletion({ taskId: "task-1", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 1 });
    expect(otherEpoch.verification).toBe("blocked");
    expect(isVerified(otherEpoch)).toBe(false);
  });

  test("cancellation during diagnosis never becomes success: immediate stop settles repair_cancelled", async () => {
    const workspace = gitWorkspace("rint-canceld-");
    const evidenceRoot = join(tempRoot("rint-canceld-ev-"), "evidence");
    const repairRoot = join(tempRoot("rint-canceld-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let invokerCalls = 0;
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async () => {
          invokerCalls += 1;
          const proposal: RepairModelProposal = { status: "proposed", plan: goodPlan() };
          return proposal;
        },
        editExecutor: scriptedEdit(workspace),
        runner: stubRunner(0, "green"),
        isCancelled: () => true,
      }),
    );

    expect(invokerCalls).toBe(0);
    expect(outcome.finalState).toBe("repair_cancelled");
    expect(outcome.reason).toBe("cancelled");
    expect(outcome.gateVerdict).not.toBe("verified");
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_cancelled");
    expect(stored?.outcome?.result).toBe("cancelled");
  });

  test("cancellation during planning never becomes success: stop before the model settles repair_cancelled", async () => {
    const workspace = gitWorkspace("rint-cancelp-");
    const evidenceRoot = join(tempRoot("rint-cancelp-ev-"), "evidence");
    const repairRoot = join(tempRoot("rint-cancelp-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let invokerCalls = 0;
    let cancelReads = 0;
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async () => {
          invokerCalls += 1;
          const proposal: RepairModelProposal = { status: "proposed", plan: goodPlan() };
          return proposal;
        },
        editExecutor: scriptedEdit(workspace),
        runner: stubRunner(0, "green"),
        isCancelled: () => {
          cancelReads += 1;
          return cancelReads >= 3;
        },
      }),
    );

    expect(invokerCalls).toBe(0);
    expect(outcome.finalState).toBe("repair_cancelled");
    expect(outcome.gateVerdict).not.toBe("verified");
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_cancelled");
  });

  test("cancellation during editing never becomes success: mid-edit stop skips reverification", async () => {
    const workspace = gitWorkspace("rint-cancele-");
    const evidenceRoot = join(tempRoot("rint-cancele-ev-"), "evidence");
    const repairRoot = join(tempRoot("rint-cancele-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let editing = false;
    let runnerCalls = 0;
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async () => ({ status: "proposed", plan: goodPlan() }),
        editExecutor: async (request) => {
          expect(request.isCancelled?.()).toBe(false);
          editing = true;
          return { changedFiles: [] };
        },
        runner: async (...args) => {
          runnerCalls += 1;
          return stubRunner(0, "green")(...args);
        },
        isCancelled: () => editing,
      }),
    );

    expect(outcome.finalState).toBe("repair_cancelled");
    expect(outcome.gateVerdict).not.toBe("verified");
    expect(runnerCalls).toBe(0);
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_cancelled");
  });

  test("cancellation during re-verification never becomes success: mid-run stop yields cancelled, never verified", async () => {
    const workspace = gitWorkspace("rint-cancelr-");
    const evidenceRoot = join(tempRoot("rint-cancelr-ev-"), "evidence");
    const repairRoot = join(tempRoot("rint-cancelr-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    const catalogue = catalogueFor(checks);
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let stopNow = false;
    const runner: VerificationRunner = async () => {
      // Stop lands mid-run: the post-execution fence must still refuse a verdict.
      stopNow = true;
      return { started: true, exitCode: 0, timedOut: false, cancelled: false, output: "green", outputBytes: 5, durationMs: 1, uncertainEffect: false };
    };
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue,
        runId: "task-1",
        epoch: 0,
        invoker: async () => ({ status: "proposed", plan: goodPlan() }),
        editExecutor: scriptedEdit(workspace),
        runner,
        isCancelled: () => stopNow,
      }),
    );

    expect(outcome.finalState).toBe("repair_cancelled");
    expect(outcome.gateVerdict).not.toBe("verified");
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_cancelled");
    expect(stored?.outcome?.result).toBe("cancelled");
  });

  test("retry exhaustion terminates as repair_failed with the real failed check ids", async () => {
    const workspace = gitWorkspace("rint-retry-");
    const evidenceRoot = join(tempRoot("rint-retry-ev-"), "evidence");
    const repairRoot = join(tempRoot("rint-retry-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let calls = 0;
    let editsRan = false;
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async () => {
          calls += 1;
          const proposal: RepairModelProposal = { status: "proposed", plan: badPlan() };
          return proposal;
        },
        editExecutor: async () => {
          editsRan = true;
          return { changedFiles: [] };
        },
        runner: stubRunner(0, "green"),
      }),
    );

    expect(calls).toBe(1 + MAX_PLAN_CORRECTIONS);
    expect(editsRan).toBe(false);
    expect(outcome.finalState).toBe("repair_failed");
    expect(outcome.reason).toBe("plan_retry_exhausted");
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_failed");
    expect(stored?.failedCheckIds).toEqual(["unit-a"]);
  });

  test("restart preserves attempt state: new store instance over the same dir reloads the attempt", () => {
    const root = join(tempRoot("rint-restart-"), "repairs");
    const store = createRepairAttemptStore({ root });
    const attempt = createRepairAttempt({
      taskId: "task-1",
      runEpoch: 2,
      workspaceId: "ws-7",
      failedCheckIds: ["unit-a"],
      failedEvidenceIds: [],
      diagnosisRevision: "rev-2",
      now: 1000,
    });
    store.save(attempt);
    const planned = advanceRepairAttempt(attempt, "repair_planned", {
      taskId: "task-1",
      runEpoch: 2,
      plan: { summary: "fix it", steps: ["edit src/fix.ts"], createdAt: 1001 },
      now: 1002,
    });
    if (planned.status !== "advanced") throw new Error("advance rejected");
    store.save(planned.attempt);

    const reopened = createRepairAttemptStore({ root });
    const reloaded = reopened.load(planned.attempt.attemptId);
    expect(reloaded?.state).toBe("repair_planned");
    expect(reloaded?.runEpoch).toBe(2);
    expect(reloaded?.workspaceId).toBe("ws-7");
    expect(reloaded?.plan?.summary).toBe("fix it");
    expect(reloaded?.failedCheckIds).toEqual(["unit-a"]);
    expect(reopened.list("task-1")).toHaveLength(1);
    // SAFETY: repair attempt files are JSON the store wrote; the narrow state view names only the field this test reads.
    const raw = JSON.parse(readFileSync(join(root, "task-1", planned.attempt.attemptId + ".json"), "utf8")) as {
      readonly state?: unknown;
    };
    expect(raw.state).toBe("repair_planned");
  });

  test("parent status cannot say verified when the gate disagrees: repaired state with blocked gate is not verified", () => {
    const workspace = gitWorkspace("rint-parent-");
    const evidenceRoot = join(tempRoot("rint-parent-ev-"), "evidence");
    const catalogue = catalogueFor([makeCheck("unit-a", ["src"])]);
    let attempt = createRepairAttempt({
      taskId: "task-1",
      runEpoch: 0,
      workspaceId: "ws-1",
      failedCheckIds: ["unit-a"],
      failedEvidenceIds: [],
      diagnosisRevision: "rev-0",
      now: 1000,
    });
    const plan = { summary: "fix it", steps: ["edit src/fix.ts"], createdAt: 1001 };
    for (const next of ["repair_planned", "repairing", "reverifying", "repaired"] as const) {
      const baseInput = { taskId: "task-1", runEpoch: 0, now: 1002 };
      const advanced = next === "repair_planned"
        ? advanceRepairAttempt(attempt, next, { ...baseInput, plan })
        : advanceRepairAttempt(attempt, next, baseInput);
      if (advanced.status !== "advanced") throw new Error("advance to " + next + " rejected");
      attempt = advanced.attempt;
    }
    expect(attempt.state).toBe("repaired");
    // The repair vocabulary stays disjoint from the completion vocabulary.
    // SAFETY: VERIFICATION_STATUSES is a readonly tuple of literals; the readonly string view only enables includes over the disjoint vocabularies.
    const overlap = REPAIR_STATES.filter((state) => (VERIFICATION_STATUSES as readonly string[]).includes(state));
    expect(overlap).toEqual([]);
    expect(isLegalRepairTransition("repair_cancelled", "repaired")).toBe(false);
    // No fresh passing evidence exists, so the gate disagrees with the state.
    const gate = evaluateOrdinaryCompletion({ taskId: "task-1", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(gate.verification).toBe("blocked");
    expect(isVerified(gate)).toBe(false);
    expect(isBlocked(gate)).toBe(true);
    // A parent that maps the repair state onto "verified" would lie: only the
    // gate verdict authorizes a verified parent status.
    expect(attempt.state === "repaired" && !isVerified(gate)).toBe(true);
  });
});
