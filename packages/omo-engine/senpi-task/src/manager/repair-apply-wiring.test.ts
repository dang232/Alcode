// Manager-level proof that the DEFAULT repair applier is the real authorized executor.
//
// The scripted invoker below returns a plan WITH concrete find/replace payloads, exactly the shape
// the edit-payload lane added. Nothing injects `repair.editExecutor`, so manager.ts must run
// `applyRepairEdits` itself: the fixture file really changes on disk, the workspace revision moves,
// and the completion gate evaluates the freshly rerun evidence. Two fail-closed cases ride the same
// default: a workspace revision that moved after the repair baseline is refused, and an edit whose
// claimed replacement produces no on-disk change ends repair_failed instead of success.
//
// No sleeps: every async signal is subscribed before the action that produces it (a store.appendEvent
// wrapper for repair_finished) and awaited with a bounded timeout. Durable layers are real: a temp
// git workspace, the real approval authority, the real file evidence store, the real completion gate,
// the real repair attempt store, and the real applyRepairEdits path through the senpi edit tool.

import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "../../../omo-config-core/src/index.ts"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import type { TaskManager } from "./types"
import type { TaskRecord } from "../state"
import { FakeRunner } from "./__fixtures__/manager-fakes"
import type { ManagerStartSpec } from "./types"
import { approvalAuthorityFor } from "../verification/approval-authority"
import { approveCandidate } from "../verification/approval-store"
import { VERIFICATION_CONFIG_VERSION } from "../verification/config"
import { candidateForApproval } from "../verification/resolution"
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store"
import { createOrdinaryVerificationCapture, ORDINARY_VERIFICATION_NODE } from "../verification/ordinary-capture"
import type { RepairPlan } from "../repair/plan"
import type { RepairDiagnosisInvoker, RepairModelProposal } from "../repair/orchestrator"
import { createRepairAttemptStore } from "../repair/store"
import type { VerificationCommandResult, VerificationRunner } from "../verification/contract"
import type { DagVerifyCheck } from "../dag/verification"
import { parseVerificationRecord } from "../dag/verification"

type RepairFinishedPayload = {
  readonly reason?: string
  readonly attempt_id?: string
  readonly final_state?: string
  readonly gate_verdict?: string
  readonly verification_status?: string
  readonly changed_files?: readonly string[]
  readonly gate_code?: string
  readonly detail?: string
}

type RepairLogEvent = {
  readonly type?: string
  readonly payload?: RepairFinishedPayload
}

const roots: string[] = []
function track<T extends string>(dir: T): T {
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" })
}

function makeGitWorkspace(): string {
  const workspace = join(track(mkdtempSync(join(tmpdir(), "repair-apply-"))), "work")
  mkdirSync(join(workspace, "src"), { recursive: true })
  writeFileSync(join(workspace, "src", "fix.ts"), "export const counter = 0\n")
  writeFileSync(join(workspace, "tracked.txt"), "baseline\n")
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "repair-apply", private: true }))
  git(workspace, "init", "-q")
  git(workspace, "add", "-A")
  git(workspace, "-c", "user.email=t@x", "-c", "user.name=t", "commit", "-qm", "init")
  return workspace
}

function writeDeclaredCheck(projectRoot: string, checkId: string, command: readonly string[]): void {
  mkdirSync(join(projectRoot, ".alcode"), { recursive: true })
  writeFileSync(
    join(projectRoot, ".alcode", "verification.json"),
    JSON.stringify({
      version: VERIFICATION_CONFIG_VERSION,
      checks: [{ id: checkId, name: `${checkId} name`, category: "unit", command: [...command] }],
    }),
  )
}

function approveDeclaredCheck(projectRoot: string, authorityRoot: string, checkId: string): void {
  const candidate = candidateForApproval({ projectRoot, workspaceId: ".", changedFiles: [], checkId })
  if (candidate === null) throw new Error(`expected a config candidate for ${checkId}`)
  approveCandidate({
    authority: approvalAuthorityFor(projectRoot, authorityRoot),
    candidate: {
      fingerprint: candidate.fingerprint,
      checkId: candidate.checkId,
      command: candidate.command,
      cwd: candidate.cwd,
      packageScope: candidate.packageScope,
      timeoutMs: candidate.timeoutMs,
    },
    workspaceId: ".",
    configVersion: VERIFICATION_CONFIG_VERSION,
    approvedBy: "repair-apply-wiring-test",
  })
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
  })
}

function makeCheck(checkId: string): DagVerifyCheck {
  return { checkId, category: "unit", command: ["node", "-e", "process.exit(0)"], timeoutMs: 20_000, criteria: [] }
}

async function captureEvidence(options: {
  readonly workspace: string
  readonly evidenceRoot: string
  readonly runId: string
  readonly epoch: number
  readonly checkId: string
  readonly exitCode: number
  readonly output: string
}): Promise<void> {
  const capture = createOrdinaryVerificationCapture({
    store: createFileEvidenceStore(options.evidenceRoot),
    projectDir: options.workspace,
    currentRevision: () => workspaceRevision(options.workspace),
    runner: stubRunner(options.exitCode, options.output),
  })
  await capture.capture({
    binding: { runId: options.runId, sessionId: "repair-apply-parent", epoch: options.epoch },
    changedFiles: [],
    available: [makeCheck(options.checkId)],
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

type RepairHarness = {
  readonly manager: TaskManager
  readonly store: TaskRecordStore
  readonly inProcess: FakeRunner
  readonly workspace: string
  readonly evidenceRoot: string
  readonly repairRoot: string
}

function makeRepairHarness(options: {
  readonly workspace: string
  readonly authorityRoot: string
  readonly invoker: RepairDiagnosisInvoker
  readonly runner: VerificationRunner
}): RepairHarness {
  const stateRoot = track(mkdtempSync(join(tmpdir(), "repair-apply-state-")))
  const store = createTaskRecordStore({ project_dir: stateRoot })
  const inProcess = new FakeRunner()
  const processRunner = new FakeRunner()
  const manager = createTaskManager({
    store,
    runners: { "in-process": inProcess, process: processRunner },
    planner: () => ({ kind: "resolved", plan: { model: "test/model" } }),
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
    cwd: options.workspace,
    verificationAuthorityRoot: options.authorityRoot,
    // Deliberately NO editExecutor: the manager must default to the real applyRepairEdits.
    repair: { invoker: options.invoker, runner: options.runner },
  })
  return {
    manager,
    store,
    inProcess,
    workspace: options.workspace,
    evidenceRoot: join(store.stateDir, "verifications"),
    repairRoot: join(store.stateDir, "repairs"),
  }
}

function startSpec(workspace: string): ManagerStartSpec {
  return {
    prompt: "do the thing",
    parent_session_id: "repair-apply-parent",
    depth: 1,
    cwd: workspace,
    execution_mode: "in-process",
  }
}

function readLogEvents(store: TaskRecordStore, taskId: string): RepairLogEvent[] {
  try {
    const text = readFileSync(join(store.stateDir, "logs", `${taskId}.jsonl`), "utf8")
    // SAFETY: log lines are JSONL task events; RepairLogEvent names the fields these tests read.
    return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as RepairLogEvent)
  } catch {
    return []
  }
}

function repairFinishedEvents(store: TaskRecordStore, taskId: string): RepairFinishedPayload[] {
  return readLogEvents(store, taskId)
    .filter((event) => event.type === "repair_finished")
    .flatMap((event) => (event.payload === undefined ? [] : [event.payload]))
}

function goodPlan(): RepairPlan {
  return {
    addressedCheckIds: ["unit-a"],
    suspectedRootCause: "the fixture counter starts at zero",
    supportingEvidence: ["unit-a failed on the committed fixture"],
    filesToChange: ["src/fix.ts"],
    expectedBehaviourChange: "the counter starts at one",
    risks: ["none observed for the fixture"],
    checksToRerun: ["unit-a"],
    checksToRemainUnchanged: [],
    rollbackPlan: "restore src/fix.ts from HEAD",
  }
}

function proposedPlan(oldText: string, newText: string): RepairModelProposal {
  return {
    status: "proposed",
    plan: goodPlan(),
    fileOperations: [
      {
        path: "src/fix.ts",
        operation: "modify",
        edits: [{ path: "src/fix.ts", oldText, newText }],
      },
    ],
  }
}

// Subscribe to the exact repair_finished append before the child settles, so the async repair is
// observed through its own event rather than a poll or a sleep.
function observeRepairFinished(harness: RepairHarness, taskId: string): Promise<RepairFinishedPayload> {
  return new Promise<RepairFinishedPayload>((resolve) => {
    // SAFETY: tests observe the repair_finished emit through the store seam; this view names only it.
    const mutableStore = harness.store as { appendEvent: TaskRecordStore["appendEvent"] }
    const originalAppend = mutableStore.appendEvent.bind(harness.store)
    // SAFETY: the wrapper forwards the same event shape the store persists and only reads fields the log format carries.
    mutableStore.appendEvent = ((id: string, event: { readonly type: string; readonly payload: unknown }) => {
      // SAFETY: test wrapper forwards the observed event to the real appendEvent; the payload shape is the store event contract.
      const result = originalAppend(id, event as never)
      if (id === taskId && event.type === "repair_finished") {
        // SAFETY: repair_finished payloads are RepairFinishedPayload by construction in manager.ts.
        resolve(event.payload as RepairFinishedPayload)
      }
      return result
    }) as TaskRecordStore["appendEvent"]
  })
}

type BlockedRun = {
  readonly harness: RepairHarness
  readonly taskId: string
  readonly finished: Promise<RepairFinishedPayload>
  readonly baselineRevision: string
}

async function blockedRun(invoker: RepairDiagnosisInvoker, repairRunner: VerificationRunner): Promise<BlockedRun> {
  const workspace = makeGitWorkspace()
  const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-apply-auth-")))
  writeDeclaredCheck(workspace, "unit-a", ["node", "-e", "process.exit(0)"])
  approveDeclaredCheck(workspace, authorityRoot, "unit-a")

  const harness = makeRepairHarness({ workspace, authorityRoot, invoker, runner: repairRunner })
  const started = await harness.manager.start(startSpec(workspace))
  if (started.kind !== "started") throw new Error(`expected started: ${JSON.stringify(started)}`)
  const taskId = started.task_id
  await captureEvidence({
    workspace,
    evidenceRoot: harness.evidenceRoot,
    runId: taskId,
    epoch: 0,
    checkId: "unit-a",
    exitCode: 1,
    output: "red",
  })
  const baselineRevision = workspaceRevision(workspace)
  const finished = observeRepairFinished(harness, taskId)
  const waiter = harness.manager.waitFor(taskId)
  harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
  const terminal: TaskRecord = await withTimeout(waiter, 5000, "blocked terminal")
  expect(terminal.status).toBe("error")
  return { harness, taskId, finished, baselineRevision }
}

describe("manager default repair applier (scripted payload plan, real executor)", () => {
  test("applies the plan on disk, moves the revision, and the gate evaluates fresh evidence", async () => {
    const invoker: RepairDiagnosisInvoker = async () => proposedPlan("counter = 0", "counter = 1")
    const { harness, taskId, finished, baselineRevision } = await blockedRun(invoker, stubRunner(0, "green"))

    const payload = await withTimeout(finished, 10_000, "repair_finished")

    // The fixture file really changed on disk through the default executor.
    expect(readFileSync(join(harness.workspace, "src", "fix.ts"), "utf8")).toBe("export const counter = 1\n")
    const repairedRevision = workspaceRevision(harness.workspace)
    expect(repairedRevision).not.toBe(baselineRevision)

    // The manager reported the executor's real footprint, and the gate accepted the FRESH rerun.
    expect(payload.final_state).toBe("repaired")
    expect(payload.gate_verdict).toBe("verified")
    expect(payload.changed_files).toEqual(["src/fix.ts"])

    // History: the pre-repair failed record is NOT overwritten by the rerun.
    const originalEvidence = parseVerificationRecord(
      readFileSync(join(harness.evidenceRoot, taskId, `${ORDINARY_VERIFICATION_NODE}.unit-a.1.json`), "utf8"),
    )
    expect(originalEvidence?.status).not.toBe("passed")
    expect(originalEvidence?.sourceRevision).toBe(baselineRevision)

    // Fresh evidence, not the pre-repair record: the rerun is the next attempt carrying the
    // post-edit revision, and it is what the gate reads.
    const freshEvidence = parseVerificationRecord(
      readFileSync(join(harness.evidenceRoot, taskId, `${ORDINARY_VERIFICATION_NODE}.unit-a.2.json`), "utf8"),
    )
    expect(freshEvidence?.status).toBe("passed")
    expect(freshEvidence?.sourceRevision).toBe(repairedRevision)
    expect(freshEvidence?.workerAttempt).toBe(0)

    const attempt = createRepairAttemptStore({ root: harness.repairRoot }).load(`${taskId}.e0.r1`)
    expect(attempt?.state).toBe("repaired")
    // A repair the gate accepts DOES publish success: the pre-repair "blocked" terminal is
    // corrected in place for the same epoch, and only after the gate was re-asked over the fresh
    // evidence. The repair state alone never publishes - the gate verdict is what allowed it.
    const persisted = readFileSync(join(harness.store.stateDir, "tasks", `${taskId}.json`), "utf8")
    expect(persisted).toContain('"status":"completed"')
    expect(persisted).toContain('"verification_status":"verified"')
    expect(persisted).not.toContain('"error_message"')
  })

  test("refuses to write when the workspace moved after the repair baseline", async () => {
    const workspace = makeGitWorkspace()
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-apply-auth-")))
    writeDeclaredCheck(workspace, "unit-a", ["node", "-e", "process.exit(0)"])
    approveDeclaredCheck(workspace, authorityRoot, "unit-a")

    let invokerCalls = 0
    const invoker: RepairDiagnosisInvoker = async () => {
      invokerCalls += 1
      // A concurrent user edit lands after the manager snapshotted the repair baseline.
      writeFileSync(join(workspace, "tracked.txt"), "concurrent user edit\n")
      return proposedPlan("counter = 0", "counter = 1")
    }
    const harness = makeRepairHarness({ workspace, authorityRoot, invoker, runner: stubRunner(0, "green") })
    const started = await harness.manager.start(startSpec(workspace))
    if (started.kind !== "started") throw new Error(`expected started: ${JSON.stringify(started)}`)
    const taskId = started.task_id
    await captureEvidence({ workspace, evidenceRoot: harness.evidenceRoot, runId: taskId, epoch: 0, checkId: "unit-a", exitCode: 1, output: "red" })
    const finished = observeRepairFinished(harness, taskId)
    const waiter = harness.manager.waitFor(taskId)
    harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    expect((await withTimeout(waiter, 5000, "blocked terminal")).status).toBe("error")

    const payload = await withTimeout(finished, 10_000, "repair_finished")

    expect(invokerCalls).toBe(1)
    expect(payload.final_state).toBe("repair_failed")
    expect(payload.gate_verdict).toBe("blocked")
    expect(payload.reason).toBe("edit_error")
    expect(payload.detail).toContain("revision_conflict")
    // Neither the repair target nor the concurrent user edit was overwritten.
    expect(readFileSync(join(workspace, "src", "fix.ts"), "utf8")).toBe("export const counter = 0\n")
    expect(readFileSync(join(workspace, "tracked.txt"), "utf8")).toBe("concurrent user edit\n")
    expect(createRepairAttemptStore({ root: harness.repairRoot }).load(`${taskId}.e0.r1`)?.state).toBe("repair_failed")
    expect(harness.store.load(taskId)?.status).toBe("error")
  })

  test("a claimed edit that produces no on-disk change fails the attempt", async () => {
    // Raw texts differ (so plan validation passes) but both normalize to the same LF text: the real
    // edit tool refuses to write an identical file, and the manager must surface that as a failure.
    const invoker: RepairDiagnosisInvoker = async () =>
      proposedPlan("export const counter = 0\r\n", "export const counter = 0\n")
    const { harness, taskId, finished } = await blockedRun(invoker, stubRunner(0, "green"))

    const payload = await withTimeout(finished, 10_000, "repair_finished")

    expect(payload.final_state).toBe("repair_failed")
    expect(payload.gate_verdict).toBe("blocked")
    expect(payload.reason).toBe("edit_error")
    // The file is byte-identical: no success, no fresh evidence, no "verified".
    expect(readFileSync(join(harness.workspace, "src", "fix.ts"), "utf8")).toBe("export const counter = 0\n")
    expect(createRepairAttemptStore({ root: harness.repairRoot }).load(`${taskId}.e0.r1`)?.state).toBe("repair_failed")
    expect(repairFinishedEvents(harness.store, taskId).some((event) => event.gate_verdict === "verified")).toBe(false)
    expect(harness.store.load(taskId)?.status).toBe("error")
  })
})
