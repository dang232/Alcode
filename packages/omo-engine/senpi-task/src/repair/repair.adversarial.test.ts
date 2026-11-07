// Adversarial proof for the repair slice: every test exercises the real
// modules (real repair store on disk, real evidence store, real completion
// gate) with plain bun:test - no sleeps, no mocks of engine behavior. The
// only fixture is the verification runner handle (the exact knob a real check
// execution turns) plus injected revision/changed-file ports where the module
// declares them.
//
// Each test names the scenario it pins in its title. Scenarios are the 16
// numbered behaviours in the brief (the brief says "17" but numbers 1-16, so
// there is no 17th item to pin - see the final report).
import { describe, expect, test, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DagVerifyCheck, DagVerifyCheckCategory } from "../dag/verification";
import { parseVerificationRecord } from "../dag/verification";
import { catalogueFrom, type OrdinaryCatalogue } from "../verification/catalogue";
import { evaluateOrdinaryCompletion } from "../verification/completion-gate";
import { VERIFICATION_STATUSES } from "../verification/contract";
import type { VerificationCommandResult, VerificationRunner } from "../verification/contract";
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store";
import { createOrdinaryVerificationCapture } from "../verification/ordinary-capture";
import { advanceRepairAttempt, createRepairAttempt, type RepairAttempt, type RepairPlan as AttemptPlan } from "./attempt";
import { buildRepairDiagnosisInput } from "./diagnosis";
import { reverifyAfterRepair } from "./execute";
import { validateRepairPlan, type RepairPlan } from "./plan";
import { affectedChecks, requiredReverification } from "./reverify";
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

function gitWorkspace(name: string): string {
  const workspace = join(tempRoot(name), "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "tracked.txt"), "baseline\n");
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "repair-adversarial", private: true }));
  git(workspace, "init", "-q");
  git(workspace, "add", "-A");
  git(workspace, "-c", "user.email=t@x", "-c", "user.name=t", "commit", "-qm", "init");
  return workspace;
}

function makeCheck(id: string, coveredPaths?: readonly string[], category: DagVerifyCheckCategory = "unit"): DagVerifyCheck {
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
      provenance: { source: "config" as const, location: "repair.adversarial.test", reason: "test" },
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
    binding: { runId: options.runId, sessionId: "repair-adversarial", epoch: options.epoch },
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

function catalogueWithScopes(): OrdinaryCatalogue {
  return catalogueFor([makeCheck("unit-a", ["src"]), makeCheck("unit-b", ["other"])]);
}

describe("repair adversarial", () => {
  test("[scenario 1] given a failed check when the gate blocks then diagnosis builds from that failure and the attempt persists its ids", async () => {
    const workspace = gitWorkspace("repair-s1-");
    const evidenceRoot = join(tempRoot("repair-s1-ev-"), "evidence");
    const repairRoot = join(tempRoot("repair-s1-rep-"), "repairs");
    const checks = [makeCheck("unit-a", ["src"])];
    await captureEvidence({ workspace, evidenceRoot, runId: "run-1", epoch: 0, checks, exitCode: 4, output: "assertion failed: expected 1 got 2" });

    const gate = evaluateOrdinaryCompletion({ taskId: "run-1", catalogue: catalogueFor(checks), evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(gate.verification).toBe("blocked");

    const store = createRepairAttemptStore({ root: repairRoot });
    const built = buildRepairDiagnosisInput({
      taskId: "task-1",
      runId: "run-1",
      epoch: 0,
      catalogue: catalogueFor(checks),
      evidenceRoot,
      workspaceDir: workspace,
      attemptStore: store,
      changedFiles: () => [],
    });
    if (!built.ok) throw new Error("diagnosis build failed: " + built.detail);
    expect(built.input.failedChecks.length).toBe(1);
    expect(built.input.failedChecks[0]?.checkId).toBe("unit-a");
    // Removing the failed-check -> diagnosis edge (e.g. diagnosis reading an
    // empty set) fails here: the ids below must come from the stored record.
    const attempt = createRepairAttempt({
      taskId: "task-1",
      runEpoch: 0,
      workspaceId: "ws-1",
      failedCheckIds: built.input.failedChecks.map((check) => check.checkId),
      failedEvidenceIds: [],
      diagnosisRevision: built.input.evidenceRevision,
      now: 1000,
    });
    store.save(attempt);
    const reloaded = createRepairAttemptStore({ root: repairRoot }).load(attempt.attemptId);
    expect(reloaded?.failedCheckIds).toEqual(["unit-a"]);
    expect(reloaded?.diagnosisRevision).toBe(built.input.evidenceRevision);
  });

  test("[scenario 2] given a verbose failing check when diagnosis builds then it carries the real exit code and bounded store output", async () => {
    const workspace = gitWorkspace("repair-s2-");
    const evidenceRoot = join(tempRoot("repair-s2-ev-"), "evidence");
    const checks = [makeCheck("unit-a", ["src"])];
    const output = `boom exit=7\n${"E".repeat(5000)}`;
    await captureEvidence({ workspace, evidenceRoot, runId: "run-1", epoch: 0, checks, exitCode: 7, output });

    const built = buildRepairDiagnosisInput({
      taskId: "task-1",
      runId: "run-1",
      epoch: 0,
      catalogue: catalogueFor(checks),
      evidenceRoot,
      workspaceDir: workspace,
      attemptStore: createRepairAttemptStore({ root: join(tempRoot("repair-s2-rep-"), "r") }),
      changedFiles: () => [],
    });
    if (!built.ok) throw new Error("diagnosis build failed: " + built.detail);
    const failed = built.input.failedChecks[0];
    if (failed === undefined) throw new Error("expected one failed check");
    // Invented diagnosis (a synthesised message instead of the stored record)
    // fails here: the exit code and excerpt must match the persisted evidence.
    expect(failed.exitCode).toBe(7);
    expect(failed.outputCapChars).toBe(2000);
    expect(failed.outputExcerpt).toBe(output.slice(0, 2000));
    expect(failed.outputExcerpt.length).toBeLessThanOrEqual(2000);
    expect(failed.outputTruncated).toBe(true);
  });

  test("[scenario 3] given a plan that weakens the catalogue when validated then it is rejected and a sound plan passes", () => {
    const catalogue = catalogueWithScopes();
    const bad: RepairPlan = {
      ...goodPlan(),
      filesToChange: ["src/fix.ts", "src/verification/catalogue.ts"],
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
    // Each weakening vector removed from the validator fails its own line.
    expect(codes).toContain("weakens_required_test");
    expect(codes).toContain("protected_verification_authority");
    expect(codes).toContain("unjustified_scope_broadening");
    expect(codes).toContain("unknown_check");
    expect(codes).toContain("claims_completion");
    const missing = validateRepairPlan({ ...goodPlan(), checksToRerun: [] }, { catalogue });
    expect(missing.ok).toBe(false);
    expect(missing.violations.map((violation) => violation.code)).toContain("missing_rerun_set");
    // The validator must not be a blanket reject: a scoped, complete plan earns ok.
    expect(validateRepairPlan(goodPlan(), { catalogue }).ok).toBe(true);
  });

  test("[scenario 4] given a failing rerun when the executor records evidence then the status derives from the exit code and no plan text is forged in", async () => {
    const workspace = gitWorkspace("repair-s4-");
    const evidenceRoot = join(tempRoot("repair-s4-ev-"), "evidence");
    const catalogue = catalogueWithScopes();
    const plan: RepairPlan = { ...goodPlan(), suspectedRootCause: "UNIQUE-FORGE-SENTINEL-9z7q" };
    const outcome = await reverifyAfterRepair({
      taskId: "task-1",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue,
      plan,
      runner: stubRunner(1, "still broken"),
      changedFiles: ["src/fix.ts"],
    });
    if (outcome.status !== "evaluated") throw new Error("expected evaluation, got " + outcome.status);
    expect(outcome.verification).toBe("blocked");
    const files = readdirSync(join(evidenceRoot, "task-1"));
    expect(files.length).toBeGreaterThan(0);
    let sawFailed = false;
    for (const file of files) {
      const raw = readFileSync(join(evidenceRoot, "task-1", file), "utf8");
      // A repair that could author evidence (a planted "passed") fails here:
      // the persisted record must derive its status from the real exit code.
      const record = parseVerificationRecord(raw);
      if (record?.checkId === "unit-a") {
        sawFailed = true;
        expect(record.status).toBe("failed");
        expect(record.exitCode).toBe(1);
      }
      expect(raw).not.toContain("UNIQUE-FORGE-SENTINEL-9z7q");
    }
    expect(sawFailed).toBe(true);
    // A forged file planted where the repair might write it never verifies:
    // the gate rejects the unreadable record fail-closed instead of trusting it.
    const forgedRoot = join(tempRoot("repair-s4-forge-"), "evidence");
    mkdirSync(join(forgedRoot, "task-9"), { recursive: true });
    writeFileSync(join(forgedRoot, "task-9", "run.unit-a.1.json"), "{ not a record\n");
    const forged = evaluateOrdinaryCompletion({
      taskId: "task-9",
      catalogue,
      evidenceRoot: forgedRoot,
      workspaceDir: workspace,
      epoch: 0,
    });
    expect(forged.verification).toBe("blocked");
  });

  test("[scenario 5] given a successful edit when the tree moves then stale evidence blocks and diagnosis reports the revision split", async () => {
    const workspace = gitWorkspace("repair-s5-");
    const evidenceRoot = join(tempRoot("repair-s5-ev-"), "evidence");
    const checks = [makeCheck("unit-a", ["src"])];
    const catalogue = catalogueFor(checks);
    // Passing evidence first: the gate accepts it while the tree is still.
    await captureEvidence({ workspace, evidenceRoot, runId: "run-pass", epoch: 0, checks, exitCode: 0, output: "green" });
    const fresh = evaluateOrdinaryCompletion({ taskId: "run-pass", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(fresh.verification).toBe("verified");

    writeFileSync(join(workspace, "tracked.txt"), "edited after verification\n");
    const gate = evaluateOrdinaryCompletion({ taskId: "run-pass", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    // Deleting invalidation (treating the old record as fresh) fails here.
    expect(gate.verification).toBe("blocked");
    expect(gate.code).toBe("verification_stale");

    // Failing evidence pins the diagnosis side: the failed record keeps the
    // pre-edit revision while the tree has moved on.
    await captureEvidence({ workspace, evidenceRoot, runId: "run-fail", epoch: 0, checks, exitCode: 3, output: "red" });
    const preEditRevision = workspaceRevision(workspace);
    // A new untracked file: the revision digests git status text, so only a
    // status-visible change (new/toggled file) moves the revision.
    writeFileSync(join(workspace, "second-edit.txt"), "more user work\n");
    const after = buildRepairDiagnosisInput({
      taskId: "task-1",
      runId: "run-fail",
      epoch: 0,
      catalogue,
      evidenceRoot,
      workspaceDir: workspace,
      attemptStore: createRepairAttemptStore({ root: join(tempRoot("repair-s5-rep2-"), "r") }),
      changedFiles: () => [],
    });
    if (!after.ok) throw new Error("diagnosis rebuild failed: " + after.detail);
    expect(after.input.revisionsMatch).toBe(false);
    expect(after.input.evidenceRevision).toBe(preEditRevision);
    expect(after.input.currentRevision).not.toBe(after.input.evidenceRevision);
  });

  test("[scenario 6] given a scoped repair when reverifying then exactly the affected checks rerun, never the untouched scope", async () => {
    const workspace = gitWorkspace("repair-s6-");
    const evidenceRoot = join(tempRoot("repair-s6-ev-"), "evidence");
    const catalogue = catalogueWithScopes();
    const outcome = await reverifyAfterRepair({
      taskId: "task-1",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue,
      plan: goodPlan(),
      runner: stubRunner(0, "green"),
      changedFiles: ["src/fix.ts"],
    });
    if (outcome.status !== "evaluated") throw new Error("expected evaluation, got " + outcome.status);
    // Dropping the affected-set computation (rerunning everything or nothing)
    // fails here: unit-b owns "other/" and must not execute for a src/ repair.
    expect(outcome.executedCheckIds).toEqual(["unit-a"]);
    expect(outcome.executedCheckIds).not.toContain("unit-b");
  });

  test("[scenario 7] given uncertain impact when scoping then the full approved set reruns conservatively", () => {
    const catalogue = catalogueFor([makeCheck("scoped", ["src"]), makeCheck("run-scoped")]);
    const plan: RepairPlan = { ...goodPlan(), addressedCheckIds: ["scoped"], filesToChange: ["src/fix.ts"], checksToRerun: ["scoped"] };
    const result = affectedChecks(plan, catalogue, ["src/fix.ts"]);
    // A scopeless approved check cannot prove itself unaffected, so the whole
    // set is required. Returning only the scope match fails this test.
    expect(result.conservative).toBe(true);
    expect(result.reason).toBe("impact_uncertain");
    expect(result.checks.map((check) => check.checkId).sort()).toEqual(["run-scoped", "scoped"]);
    const required = requiredReverification(plan, catalogue, ["src/fix.ts"]).sort();
    expect(required).toEqual(["run-scoped", "scoped"]);
  });

  test("[scenario 8] given a passing rerun when the executor finishes then fresh evidence for the new revision verifies", async () => {
    const workspace = gitWorkspace("repair-s8-");
    const evidenceRoot = join(tempRoot("repair-s8-ev-"), "evidence");
    // Single-check catalogue: the gate requires every approved check, so a
    // two-check catalogue could never verify off one scoped rerun (see
    // scenario 6 for the untouched-scope half of that rule).
    const catalogue = catalogueFor([makeCheck("unit-a", ["src"])]);
    writeFileSync(join(workspace, "src-fix.ts"), "repaired\n");
    const outcome = await reverifyAfterRepair({
      taskId: "task-1",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue,
      plan: goodPlan(),
      runner: stubRunner(0, "green after repair"),
      changedFiles: ["src/fix.ts"],
    });
    if (outcome.status !== "evaluated") throw new Error("expected evaluation, got " + outcome.status);
    expect(outcome.verification).toBe("verified");
    expect(outcome.evidenceRevision).toBe(workspaceRevision(workspace));
    const files = readdirSync(join(evidenceRoot, "task-1"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const record = parseVerificationRecord(readFileSync(join(evidenceRoot, "task-1", file), "utf8"));
      if (record === null) throw new Error("unreadable fresh evidence: " + file);
      // Stamping the old revision (or no revision) fails here: only records
      // bound to the post-repair tree may satisfy the gate.
      expect(record.sourceRevision).toBe(outcome.evidenceRevision);
      expect(record.workerAttempt).toBe(0);
    }
  });

  test("[scenario 9] given a failing rerun when the gate judges then the run stays blocked", async () => {
    const workspace = gitWorkspace("repair-s9-");
    const evidenceRoot = join(tempRoot("repair-s9-ev-"), "evidence");
    const outcome = await reverifyAfterRepair({
      taskId: "task-1",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue: catalogueWithScopes(),
      plan: goodPlan(),
      runner: stubRunner(2, "still red"),
      changedFiles: ["src/fix.ts"],
    });
    if (outcome.status !== "evaluated") throw new Error("expected evaluation, got " + outcome.status);
    // Promoting a failed rerun to verified fails here.
    expect(outcome.verification).toBe("blocked");
    expect(outcome.code).toBe("verification_failed");
    expect(outcome.executedCheckIds).toEqual(["unit-a"]);
  });

  test("[scenario 10] given a repair that reaches repaired when the gate judges without fresh evidence then it stays blocked: repair publishes no completion", () => {
    const workspace = gitWorkspace("repair-s10-");
    const evidenceRoot = join(tempRoot("repair-s10-ev-"), "evidence");
    const catalogue = catalogueWithScopes();
    let attempt = createRepairAttempt({
      taskId: "task-1",
      runEpoch: 0,
      workspaceId: "ws-1",
      failedCheckIds: ["unit-a"],
      failedEvidenceIds: [],
      diagnosisRevision: "rev-0",
      now: 1000,
    });
    const plan: AttemptPlan = { summary: "fix it", steps: ["edit src/fix.ts"], createdAt: 1001 };
    for (const [next, extra] of [
      ["repair_planned", { plan }],
      ["repairing", {}],
      ["reverifying", {}],
      ["repaired", {}],
    ] as const) {
      const advanced = advanceRepairAttempt(attempt, next, { taskId: "task-1", runEpoch: 0, now: 1002, ...extra });
      if (advanced.status !== "advanced") throw new Error("advance to " + next + " rejected");
      attempt = advanced.attempt;
    }
    expect(attempt.state).toBe("repaired");
    // The repair vocabulary must stay disjoint from the completion vocabulary:
    // mapping any repair state onto "verified" would publish parent completion.
    // SAFETY: VERIFICATION_STATUSES is the closed vocabulary of the completion
    // gate; widening it admits the disjointness check, which itself proves no
    // repair state overlaps the completion vocabulary.
    const overlap = REPAIR_STATES.filter((state) => (VERIFICATION_STATUSES as readonly string[]).includes(state));
    expect(overlap).toEqual([]);
    // A terminal repair with no fresh passing evidence is still blocked.
    const gate = evaluateOrdinaryCompletion({ taskId: "task-1", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(gate.verification).toBe("blocked");
  });

  test("[scenario 11] given an old epoch when it moves a repair then the transition rejects and the stale write throws", () => {
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
    // Accepting a stale epoch (resurrecting an older run's lifecycle) fails here.
    expect(staleMove.status).toBe("rejected");
    if (staleMove.status === "rejected") expect(staleMove.reason).toBe("stale_epoch");
    expect(attempt.state).toBe("diagnosing");

    const root = join(tempRoot("repair-s11-"), "repairs");
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
    expect(store.load(older.attemptId)).toBeNull();
  });

  test("[scenario 12] given concurrent attempts when evidence exists for one epoch then the other borrows nothing", async () => {
    const workspace = gitWorkspace("repair-s12-");
    const evidenceRoot = join(tempRoot("repair-s12-ev-"), "evidence");
    const checks = [makeCheck("unit-a", ["src"])];
    const catalogue = catalogueFor(checks);
    await captureEvidence({ workspace, evidenceRoot, runId: "task-1", epoch: 0, checks, exitCode: 0, output: "green" });
    const sameEpoch = evaluateOrdinaryCompletion({ taskId: "task-1", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 });
    expect(sameEpoch.verification).toBe("verified");
    // Evidence from epoch 0 must not satisfy epoch 1: borrowing it fails here.
    const otherEpoch = evaluateOrdinaryCompletion({ taskId: "task-1", catalogue, evidenceRoot, workspaceDir: workspace, epoch: 1 });
    expect(otherEpoch.verification).toBe("blocked");

    const root = join(tempRoot("repair-s12-rep-"), "repairs");
    const store = createRepairAttemptStore({ root });
    const attemptA = createRepairAttempt({ taskId: "taskA", runEpoch: 0, workspaceId: "ws", failedCheckIds: ["unit-a"], failedEvidenceIds: [], diagnosisRevision: "r", now: 1000 });
    const attemptB = createRepairAttempt({ taskId: "taskB", runEpoch: 0, workspaceId: "ws", failedCheckIds: ["unit-a"], failedEvidenceIds: [], diagnosisRevision: "r", now: 1000 });
    store.save(attemptA);
    store.save(attemptB);
    expect(store.list("taskA").map((entry) => entry.attemptId)).toEqual([attemptA.attemptId]);
    expect(store.list("taskB").map((entry) => entry.attemptId)).toEqual([attemptB.attemptId]);
  });

  test("[scenario 13] given cancellation when the repair stops then it settles cancelled and can never become success", async () => {
    const attempt = createRepairAttempt({
      taskId: "task-1",
      runEpoch: 0,
      workspaceId: "ws-1",
      failedCheckIds: ["unit-a"],
      failedEvidenceIds: [],
      diagnosisRevision: "rev-0",
      now: 1000,
    });
    const cancelled = advanceRepairAttempt(attempt, "repair_cancelled", { taskId: "task-1", runEpoch: 0, reason: "user_stop", now: 1001 });
    if (cancelled.status !== "advanced") throw new Error("cancel rejected");
    expect(cancelled.attempt.state).toBe("repair_cancelled");
    expect(cancelled.attempt.outcome?.result).toBe("cancelled");
    // Terminal rows carry no outgoing edges: any move out of cancelled fails here.
    expect(isLegalRepairTransition("repair_cancelled", "repairing")).toBe(false);
    expect(isLegalRepairTransition("repair_cancelled", "repaired")).toBe(false);
    const escape = transitionRepairAttempt(cancelled.attempt, "repaired", { taskId: "task-1", runEpoch: 0, now: 1002 });
    expect(escape.status).toBe("rejected");

    const workspace = gitWorkspace("repair-s13-");
    const evidenceRoot = join(tempRoot("repair-s13-ev-"), "evidence");
    const outcome = await reverifyAfterRepair({
      taskId: "task-1",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue: catalogueWithScopes(),
      plan: goodPlan(),
      runner: stubRunner(0, "green"),
      changedFiles: ["src/fix.ts"],
      isCancelled: () => true,
    });
    // A cancelled run must never earn a verdict, even with a passing runner.
    expect(outcome.status).toBe("cancelled");
    expect(existsSync(join(evidenceRoot, "task-1"))).toBe(false);
  });

  test("[scenario 14] given a restart when a fresh store opens the same root then repair ownership and state survive", () => {
    const root = join(tempRoot("repair-s14-"), "repairs");
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
    expect(reopened.list("task-1").length).toBe(1);
    // The claim must sit on disk, not just in memory: a restart that lost the
    // file fails this raw read.
    const raw: unknown = JSON.parse(readFileSync(join(root, "task-1", planned.attempt.attemptId + ".json"), "utf8"));
    // SAFETY: the file was just written by the store as a JSON repair record;
    // reading one field as unknown keeps it opaque, and the equality check
    // only compares against the expected state string.
    expect((raw as { readonly state?: unknown }).state).toBe("repair_planned");
  });

  test("[scenario 15] given external user edits when reverification runs then the files are untouched, and mid-run movement yields stale", async () => {
    const workspace = gitWorkspace("repair-s15-");
    const evidenceRoot = join(tempRoot("repair-s15-ev-"), "evidence");
    const sentinel = "user work - do not touch\n";
    writeFileSync(join(workspace, "notes.txt"), sentinel);
    git(workspace, "add", "-A");
    git(workspace, "-c", "user.email=t@x", "-c", "user.name=t", "commit", "-qm", "user edit");
    const before = readdirSync(workspace).sort();
    const outcome = await reverifyAfterRepair({
      taskId: "task-1",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue: catalogueWithScopes(),
      plan: goodPlan(),
      runner: stubRunner(0, "green"),
      changedFiles: ["src/fix.ts"],
    });
    if (outcome.status !== "evaluated") throw new Error("expected evaluation, got " + outcome.status);
    // The slice owns no workspace writer: any repair path that overwrote or
    // deleted the user's file fails here.
    expect(readFileSync(join(workspace, "notes.txt"), "utf8")).toBe(sentinel);
    expect(readdirSync(workspace).sort()).toEqual(before);

    const movingRunner: VerificationRunner = async (): Promise<VerificationCommandResult> => {
      writeFileSync(join(workspace, "notes.txt"), "moved mid-run\n");
      return { started: true, exitCode: 0, timedOut: false, cancelled: false, output: "green", outputBytes: 5, durationMs: 1, uncertainEffect: false };
    };
    const moved = await reverifyAfterRepair({
      taskId: "task-2",
      runEpoch: 0,
      workspaceDir: workspace,
      evidenceRoot,
      catalogue: catalogueWithScopes(),
      plan: goodPlan(),
      runner: movingRunner,
      changedFiles: ["src/fix.ts"],
    });
    // Evidence stamped before the move no longer describes the tree, so the
    // gate must not see it: stale, never evaluated.
    expect(moved.status).toBe("stale");
  });

  test("[scenario 16] given no retry rounds left when another loop is requested then the attempt settles repair_failed with retry_exhausted", () => {
    const root = join(tempRoot("repair-s16-"), "repairs");
    const store = createRepairAttemptStore({ root });
    const seed = createRepairAttempt({
      taskId: "task-1",
      runEpoch: 0,
      workspaceId: "ws-1",
      failedCheckIds: ["unit-a"],
      failedEvidenceIds: [],
      diagnosisRevision: "rev-0",
      now: 1000,
    });
    let attempt: RepairAttempt = seed;
    for (const next of ["repair_planned", "repairing", "reverifying"] as const) {
      const contextBase = { taskId: "task-1", runEpoch: 0, now: 1001 };
      const advanced =
        next === "repair_planned"
          ? advanceRepairAttempt(attempt, next, { ...contextBase, plan: { summary: "s", steps: [], createdAt: 1001 } })
          : advanceRepairAttempt(attempt, next, contextBase);
      if (advanced.status !== "advanced") throw new Error("advance to " + next + " rejected");
      attempt = advanced.attempt;
    }
    expect(attempt.state).toBe("reverifying");
    // At the limit the loop settles honestly instead of spinning forever.
    const exhausted = transitionRepairAttempt(attempt, "repairing", { taskId: "task-1", runEpoch: 0, retryLimit: 1, now: 1002 });
    if (exhausted.status !== "advanced") throw new Error("expected advance-with-redirect");
    expect(exhausted.to).toBe("repair_failed");
    expect(exhausted.redirected).toBe(true);
    expect(exhausted.reason).toBe("retry_exhausted");
    expect(exhausted.attempt.attemptNumber).toBe(1);
    store.save(exhausted.attempt);
    expect(store.load(exhausted.attempt.attemptId)?.state).toBe("repair_failed");

    // Below the limit the same edge still loops with a counted round.
    const looping = transitionRepairAttempt(attempt, "repairing", { taskId: "task-1", runEpoch: 0, retryLimit: 3, now: 1003 });
    if (looping.status !== "advanced") throw new Error("expected loop advance");
    expect(looping.to).toBe("repairing");
    expect(looping.redirected).toBe(false);
    expect(looping.attempt.attemptNumber).toBe(2);
  });
});
