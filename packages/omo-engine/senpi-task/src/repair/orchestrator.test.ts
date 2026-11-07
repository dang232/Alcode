// Unit test of the repair orchestration (runRepairAttempt): every boundary
// the orchestrator does not own is scripted - the model invoker, the edit
// executor, and the verification runner are plain in-test functions. The
// durable layers are real: a temp git workspace, the real file evidence
// store, the real completion gate (via reverifyAfterRepair), and the real
// repair attempt store on disk. No model calls, no sleeps.
import { describe, expect, test, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DagVerifyCheck, DagVerifyCheckCategory } from "../dag/verification";
import { catalogueFrom, type OrdinaryCatalogue } from "../verification/catalogue";
import type {
  VerificationCommandResult,
  VerificationRunner,
} from "../verification/contract";
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store";
import { createOrdinaryVerificationCapture } from "../verification/ordinary-capture";
import { createRepairAttemptStore } from "./store";
import type { RepairPlan } from "./plan";
import {
  MAX_PLAN_CORRECTIONS,
  runRepairAttempt,
  type RepairDiagnosisInvoker,
  type RepairEditExecutor,
  type RepairModelProposal,
  type RunRepairAttemptInput,
} from "./orchestrator";

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

function gitWorkspace(name: string): string {
  const workspace = join(tempRoot(name), "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "tracked.txt"), "baseline\n");
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "repair-orchestrator", private: true }));
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
      provenance: { source: "config" as const, location: "orchestrator.test", reason: "test" },
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
    binding: { runId: options.runId, sessionId: "repair-orchestrator", epoch: options.epoch },
    changedFiles: ["tracked.txt"],
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
  // Every weakening vector at once: deleting a required test is observed via
  // fileOperations, and the plan itself claims completion, reruns nothing,
  // and names a phantom check.
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

describe("repair orchestrator", () => {
  test("happy path: scripted proposal, edit, and passing rerun ends repaired with a gate verdict", async () => {
    const workspace = gitWorkspace("orch-happy-");
    const evidenceRoot = join(tempRoot("orch-happy-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-happy-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    const catalogue = catalogueFor(checks);
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 4, output: "red" });
    const revision = workspaceRevision(workspace);

    let invokerCalls = 0;
    const invoker: RepairDiagnosisInvoker = async (request) => {
      invokerCalls += 1;
      expect(request.correctionRound).toBe(0);
      expect(request.attemptId).toContain("task-1");
      const proposal: RepairModelProposal = { status: "proposed", plan: goodPlan() };
      return proposal;
    };

    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue,
        runId: "task-1",
        epoch: 0,
        invoker,
        editExecutor: scriptedEdit(workspace),
        runner: stubRunner(0, "green"),
      }),
    );

    expect(outcome.finalState).toBe("repaired");
    expect(outcome.gateVerdict).toBe("verified");
    expect(outcome.changedFiles).toEqual(["src/fix.ts"]);
    expect(invokerCalls).toBe(1);
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repaired");
    expect(stored?.outcome?.result).toBe("repaired");
    expect(stored?.diagnosisRevision).toBe(revision);
    // The persisted summary names the diagnosed cause, not a model verdict.
    expect(stored?.plan?.summary).toContain("off-by-one");
  });

  test("model says no defensible diagnosis: repair_failed with an explicit reason, edits never run", async () => {
    const workspace = gitWorkspace("orch-nodef-");
    const evidenceRoot = join(tempRoot("orch-nodef-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-nodef-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let editsRan = false;
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async () => ({
          status: "no_defensible_diagnosis",
          reason: "evidence contradicts every candidate root cause",
        }),
        editExecutor: async () => {
          editsRan = true;
          return { changedFiles: [] };
        },
        runner: stubRunner(0, "green"),
      }),
    );

    expect(outcome.finalState).toBe("repair_failed");
    expect(outcome.reason).toBe("no_defensible_diagnosis");
    expect(outcome.detail).toContain("contradicts");
    expect(outcome.gateVerdict).toBeUndefined();
    expect(editsRan).toBe(false);
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_failed");
    expect(stored?.outcome?.reason).toBe("no_defensible_diagnosis");
  });

  test("plan rejected twice then failed: exactly initial plus two corrections, then repair_failed", async () => {
    const workspace = gitWorkspace("orch-plan-");
    const evidenceRoot = join(tempRoot("orch-plan-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-plan-ev-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    const seenRounds: number[] = [];
    const seenViolationCounts: number[] = [];
    let editsRan = false;
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async (request) => {
          seenRounds.push(request.correctionRound);
          seenViolationCounts.push(request.previousViolations?.length ?? 0);
          const proposal: RepairModelProposal = {
            status: "proposed",
            plan: badPlan(),
            fileOperations: [{ path: "src/fix.test.ts", operation: "delete" }],
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

    expect(outcome.finalState).toBe("repair_failed");
    expect(outcome.reason).toBe("plan_retry_exhausted");
    expect(seenRounds).toEqual([0, 1, 2]);
    // Correction rounds carry the previous rejection's violations forward.
    expect(seenViolationCounts[0]).toBe(0);
    expect(seenViolationCounts[1]).toBeGreaterThan(0);
    expect(seenViolationCounts[2]).toBeGreaterThan(0);
    expect(editsRan).toBe(false);
  });

  test("a rejected first plan followed by a sound correction still repairs", async () => {
    const workspace = gitWorkspace("orch-correct-");
    const evidenceRoot = join(tempRoot("orch-correct-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-correct-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let calls = 0;
    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async (request) => {
          calls += 1;
          if (request.correctionRound === 0) {
            const proposal: RepairModelProposal = { status: "proposed", plan: badPlan() };
            return proposal;
          }
          expect(request.previousViolations?.length ?? 0).toBeGreaterThan(0);
          const proposal: RepairModelProposal = { status: "proposed", plan: goodPlan() };
          return proposal;
        },
        editExecutor: scriptedEdit(workspace),
        runner: stubRunner(0, "green"),
      }),
    );

    expect(calls).toBe(2);
    expect(outcome.finalState).toBe("repaired");
    expect(outcome.gateVerdict).toBe("verified");
  });

  test("failed reverification stays blocked: never repaired without a verified gate verdict", async () => {
    const workspace = gitWorkspace("orch-blocked-");
    const evidenceRoot = join(tempRoot("orch-blocked-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-blocked-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async () => ({ status: "proposed", plan: goodPlan() }),
        editExecutor: scriptedEdit(workspace),
        runner: stubRunner(2, "still red"),
      }),
    );

    expect(outcome.finalState).toBe("repair_failed");
    expect(outcome.gateVerdict).toBe("blocked");
    expect(outcome.reason ?? "").toContain("reverification_blocked");
    expect(outcome.changedFiles).toEqual(["src/fix.ts"]);
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_failed");
  });

  test("cancellation during diagnosis ends repair_cancelled before the model is asked", async () => {
    const workspace = gitWorkspace("orch-canceld-");
    const evidenceRoot = join(tempRoot("orch-canceld-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-canceld-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let invokerCalls = 0;
    // The stop lands after the diagnosis build but before the model round:
    // the orchestrator reads cancellation once after creation and once after
    // the build, so the third read (top of the model loop) observes it.
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
    expect(outcome.reason).toBe("cancelled");
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_cancelled");
    expect(stored?.outcome?.result).toBe("cancelled");
  });

  test("cancellation during editing ends repair_cancelled without reverifying", async () => {
    const workspace = gitWorkspace("orch-cancele-");
    const evidenceRoot = join(tempRoot("orch-cancele-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-cancele-rep-"), "repairs");
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
          // A stop landing mid-edit: not yet visible when the edit starts,
          // visible when the orchestrator re-reads it afterwards.
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
    expect(runnerCalls).toBe(0);
    const stored = createRepairAttemptStore({ root: repairRoot }).load(outcome.attemptId);
    expect(stored?.state).toBe("repair_cancelled");
  });

  test("retry exhaustion: the model is asked at most initial plus two corrections, never in a loop", async () => {
    const workspace = gitWorkspace("orch-retry-");
    const evidenceRoot = join(tempRoot("orch-retry-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-retry-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    let calls = 0;
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
        editExecutor: scriptedEdit(workspace),
        runner: stubRunner(0, "green"),
      }),
    );

    expect(MAX_PLAN_CORRECTIONS).toBe(2);
    expect(calls).toBe(1 + MAX_PLAN_CORRECTIONS);
    expect(outcome.finalState).toBe("repair_failed");
    expect(outcome.reason).toBe("plan_retry_exhausted");
  });

  test("missing failure evidence fails the attempt instead of inventing a diagnosis", async () => {
    const workspace = gitWorkspace("orch-noev-");
    const evidenceRoot = join(tempRoot("orch-noev-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-noev-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    // Passing evidence only: the diagnosis builder finds no failed record.
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 0, output: "green" });

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
      }),
    );

    expect(invokerCalls).toBe(0);
    expect(outcome.finalState).toBe("repair_failed");
    expect(outcome.reason ?? "").toContain("diagnosis_unavailable");
  });

  test("durable record: the terminal attempt persists with its plan summary and outcome", async () => {
    const workspace = gitWorkspace("orch-durable-");
    const evidenceRoot = join(tempRoot("orch-durable-ev-"), "evidence");
    const repairRoot = join(tempRoot("orch-durable-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 1, output: "red" });

    const outcome = await runRepairAttempt(
      baseInput({
        workspace,
        evidenceRoot,
        repairRoot,
        catalogue: catalogueFor(checks),
        runId: "task-1",
        epoch: 0,
        invoker: async () => ({ status: "proposed", plan: goodPlan() }),
        editExecutor: scriptedEdit(workspace),
        runner: stubRunner(0, "green"),
      }),
    );

    const raw = readFileSync(join(repairRoot, "task-1", `${outcome.attemptId}.json`), "utf8");
    // SAFETY: repair attempt files are JSON the store wrote; the narrow view names only the state and plan summary this test reads.
    const record = JSON.parse(raw) as { readonly state?: unknown; readonly plan?: { readonly summary?: unknown } };
    expect(record.state).toBe("repaired");
    expect(record.plan?.summary).toBe("off-by-one in the retry counter");
  });
});
