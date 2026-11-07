// Unit test of the manager repair wiring (scripted invoker, no live model).
//
// This file tests ONLY the wiring in manager.ts: a blocked ordinary completion whose block is
// attributable to a failed approved check starts exactly one repair attempt through
// ./repair/orchestrator runRepairAttempt; every other block keeps its current behaviour plus an
// explicit reason and starts none. The model boundary is a scripted orchestrator invoker (never a
// live model call); the durable layers are real (temp git workspace, real file evidence store,
// real completion gate, real repair attempt store on disk). No sleeps: each async signal is
// subscribed before the action that produces it (invoker-called promises, manager.waitFor, and a
// store.appendEvent wrapper for repair_finished) and awaited with a bounded timeout.

import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { OmoTaskSettingsSchema } from "../../../omo-config-core/src/index.ts"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { createTaskManager } from "./manager"
import type { TaskManager } from "./types"
import type { TaskRecord } from "../state"
import { FakeRunner, flush } from "./__fixtures__/manager-fakes"
import type { ManagerStartSpec } from "./types"
import { approvalAuthorityFor, type ApprovalAuthority } from "../verification/approval-authority"
import { approveCandidate } from "../verification/approval-store"
import { VERIFICATION_CONFIG_VERSION } from "../verification/config"
import { candidateForApproval } from "../verification/resolution"
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store"
import { createOrdinaryVerificationCapture } from "../verification/ordinary-capture"
import type { RepairPlan } from "../repair/plan"

type RepairWiringLogPayload = {
  readonly verification_status?: string;
  readonly code?: string;
  readonly reason?: string;
};

type RepairWiringLogEvent = {
  readonly type?: string;
  readonly payload?: RepairWiringLogPayload;
};

type RepairHarnessRepairConfig = {
  readonly invoker?: RepairDiagnosisInvoker;
  readonly editExecutor?: RepairEditExecutor;
  readonly runner?: VerificationRunner;
};

function isStringTag(value: string | undefined): value is string {
  return value !== undefined && Object.prototype.toString.call(value) === "[object String]";
}
import type { VerificationCommandResult, VerificationRunner } from "../verification/contract"
import type { DagVerifyCheck } from "../dag/verification"
import { createRepairAttemptStore } from "../repair/store"
import type { RepairDiagnosisInvoker, RepairEditExecutor, RepairModelProposal } from "../repair/orchestrator"

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
  const workspace = join(track(mkdtempSync(join(tmpdir(), "repair-wiring-"))), "work")
  mkdirSync(workspace, { recursive: true })
  writeFileSync(join(workspace, "tracked.txt"), "baseline\n")
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "repair-wiring", private: true }))
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

function writeInvalidCatalogue(projectRoot: string): void {
  mkdirSync(join(projectRoot, ".alcode"), { recursive: true })
  writeFileSync(
    join(projectRoot, ".alcode", "verification.json"),
    JSON.stringify({
      version: VERIFICATION_CONFIG_VERSION,
      checks: [{ id: "bad id with spaces", name: "bad", category: "unit", command: ["node", "-e", "process.exit(0)"] }],
    }),
  )
}

function approveDeclaredCheck(projectRoot: string, authority: ApprovalAuthority, checkId: string): void {
  const candidate = candidateForApproval({ projectRoot, workspaceId: ".", changedFiles: [], checkId })
  if (candidate === null) throw new Error(`expected a config candidate for ${checkId}`)
  approveCandidate({
    authority,
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
    approvedBy: "repair-wiring-test",
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
    binding: { runId: options.runId, sessionId: "repair-wiring-parent", epoch: options.epoch },
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
  readonly invoker?: RepairDiagnosisInvoker
  readonly editExecutor?: RepairEditExecutor
  readonly runner?: VerificationRunner
}): RepairHarness {
  const stateRoot = track(mkdtempSync(join(tmpdir(), "repair-wiring-state-")))
  const store = createTaskRecordStore({ project_dir: stateRoot })
  const inProcess = new FakeRunner()
  const processRunner = new FakeRunner()
  let repairConfig: RepairHarnessRepairConfig | undefined;
  if (options.invoker !== undefined || options.editExecutor !== undefined || options.runner !== undefined) {
    let inner: RepairHarnessRepairConfig = {};
    if (options.invoker !== undefined) inner = { ...inner, invoker: options.invoker };
    if (options.editExecutor !== undefined) inner = { ...inner, editExecutor: options.editExecutor };
    if (options.runner !== undefined) inner = { ...inner, runner: options.runner };
    repairConfig = inner;
  }
  let managerInit: Parameters<typeof createTaskManager>[0] = {
    store,
    runners: { "in-process": inProcess, process: processRunner },
    planner: () => ({ kind: "resolved", plan: { model: "test/model" } }),
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
    cwd: options.workspace,
    verificationAuthorityRoot: options.authorityRoot,
  };
  if (repairConfig !== undefined) managerInit = { ...managerInit, repair: repairConfig };
  const manager = createTaskManager(managerInit)
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
  return { prompt: "do the thing", parent_session_id: "repair-wiring-parent", depth: 1, cwd: workspace, execution_mode: "in-process" }
}

function readLogEvents(store: TaskRecordStore, taskId: string): RepairWiringLogEvent[] {
  try {
    const text = readFileSync(join(store.stateDir, "logs", `${taskId}.jsonl`), "utf8")
    // SAFETY: log lines are JSONL task events; the named event type states the fields the tests read.
    return text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as RepairWiringLogEvent)
  } catch {
    return []
  }
}

function eventTypes(store: TaskRecordStore, taskId: string): string[] {
  return readLogEvents(store, taskId).map((event) => event.type).filter((type): type is string => isStringTag(type))
}

function goodPlan(): RepairPlan {
  return {
    addressedCheckIds: ["unit-a"],
    suspectedRootCause: "off-by-one in the retry counter",
    supportingEvidence: ["exit code 1 in unit-a output"],
    filesToChange: ["src/fix.ts"],
    expectedBehaviourChange: "retry counter increments once per round",
    risks: ["none observed"],
    checksToRerun: ["unit-a"],
    checksToRemainUnchanged: [],
    rollbackPlan: "revert src/fix.ts",
  }
}

describe("manager repair wiring (scripted invoker unit test)", () => {
  test("blocked-by-failed-check starts exactly one attempt", async () => {
    const workspace = makeGitWorkspace()
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-wiring-auth-")))
    writeDeclaredCheck(workspace, "unit-a", ["node", "-e", "process.exit(0)"])
    approveDeclaredCheck(workspace, approvalAuthorityFor(workspace, authorityRoot), "unit-a")

    let invokerCalls = 0
    let resolveCalled: () => void = () => {}
    const called = new Promise<void>((resolve) => {
      resolveCalled = resolve
    })
    const invoker: RepairDiagnosisInvoker = async () => {
      invokerCalls += 1
      resolveCalled()
      const proposal: RepairModelProposal = { status: "no_defensible_diagnosis", reason: "scripted: thin evidence" }
      return proposal
    }
    const harness = makeRepairHarness({ workspace, authorityRoot, invoker })
    const started = await harness.manager.start(startSpec(workspace))
    if (started.kind !== "started") throw new Error(`expected started: ${JSON.stringify(started)}`)
    const taskId = started.task_id
    await captureEvidence({ workspace, evidenceRoot: harness.evidenceRoot, runId: taskId, epoch: 0, checkId: "unit-a", exitCode: 1, output: "red" })

    const waiter = harness.manager.waitFor(taskId)
    harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    const terminal: TaskRecord = await withTimeout(waiter, 5000, "blocked terminal")
    expect(terminal.status).toBe("error")

    await withTimeout(called, 5000, "repair invoker call")
    await flush()
    await flush()
    expect(invokerCalls).toBe(1)

    // Exactly one: draining again starts no second attempt.
    await flush()
    await flush()
    expect(invokerCalls).toBe(1)

    // Attributability: the durable attempt persists task id, epoch, workspace identity and the
    // original failed evidence before any model call.
    const repairStore = createRepairAttemptStore({ root: harness.repairRoot })
    const attempts = repairStore.list(taskId)
    expect(attempts).toHaveLength(1)
    const attempt = attempts[0]
    expect(attempt?.taskId).toBe(taskId)
    expect(attempt?.runEpoch).toBe(0)
    expect(attempt?.workspaceId.length ?? 0).toBeGreaterThan(0)
    expect(attempt?.failedCheckIds).toContain("unit-a")
    expect(attempt?.failedEvidenceIds.length ?? 0).toBeGreaterThan(0)

    // The task stays blocked and never publishes success. verification_status is an event-level
    // carrier (typed store loads drop it), so truth is read from the record status plus the
    // verification_blocked event payload.
    const record = harness.store.load(taskId)
    expect(record?.status).toBe("error")
    expect(record?.final_response).toBeUndefined()
    expect(record?.error_message).toContain("completion blocked")
    const blockedEvent = readLogEvents(harness.store, taskId).find((event) => event.type === "verification_blocked")
    expect(blockedEvent?.payload?.verification_status).toBe("blocked")
    expect(blockedEvent?.payload?.code).toBe("verification_failed")
  })

  test("cancelled task starts none", async () => {
    const workspace = makeGitWorkspace()
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-wiring-auth-")))
    writeDeclaredCheck(workspace, "unit-a", ["node", "-e", "process.exit(0)"])
    approveDeclaredCheck(workspace, approvalAuthorityFor(workspace, authorityRoot), "unit-a")

    let invokerCalls = 0
    const invoker: RepairDiagnosisInvoker = async () => {
      invokerCalls += 1
      const proposal: RepairModelProposal = { status: "no_defensible_diagnosis", reason: "scripted" }
      return proposal
    }
    const harness = makeRepairHarness({ workspace, authorityRoot, invoker })
    const started = await harness.manager.start(startSpec(workspace))
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    await captureEvidence({ workspace, evidenceRoot: harness.evidenceRoot, runId: taskId, epoch: 0, checkId: "unit-a", exitCode: 1, output: "red" })

    const waiter = harness.manager.waitFor(taskId)
    await harness.manager.cancelTask(taskId)
    harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    const terminal: TaskRecord = await withTimeout(waiter, 5000, "cancelled terminal")
    expect(terminal.status).toBe("cancelled")

    await flush()
    await flush()
    expect(invokerCalls).toBe(0)
    expect(createRepairAttemptStore({ root: harness.repairRoot }).list(taskId)).toHaveLength(0)
  })

  test("invalid catalogue starts none", async () => {
    const workspace = makeGitWorkspace()
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-wiring-auth-")))
    writeInvalidCatalogue(workspace)

    let invokerCalls = 0
    const invoker: RepairDiagnosisInvoker = async () => {
      invokerCalls += 1
      const proposal: RepairModelProposal = { status: "no_defensible_diagnosis", reason: "scripted" }
      return proposal
    }
    const harness = makeRepairHarness({ workspace, authorityRoot, invoker })
    const started = await harness.manager.start(startSpec(workspace))
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id

    const waiter = harness.manager.waitFor(taskId)
    harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    const terminal: TaskRecord = await withTimeout(waiter, 5000, "invalid-catalogue terminal")
    expect(terminal.status).toBe("error")

    await flush()
    await flush()
    expect(invokerCalls).toBe(0)
    expect(createRepairAttemptStore({ root: harness.repairRoot }).list(taskId)).toHaveLength(0)
    // Non-repairable blocks keep current behaviour plus an explicit reason field.
    const types = eventTypes(harness.store, taskId)
    expect(types).toContain("repair_skipped")
    const skipped = readLogEvents(harness.store, taskId).find((event) => event.type === "repair_skipped")
    expect(Object.prototype.toString.call(skipped?.payload?.reason)).toBe("[object String]")
    expect(String(skipped?.payload?.reason)).toContain("invalid_catalogue")
  })

  test("malformed evidence starts none", async () => {
    const workspace = makeGitWorkspace()
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-wiring-auth-")))
    writeDeclaredCheck(workspace, "unit-a", ["node", "-e", "process.exit(0)"])
    approveDeclaredCheck(workspace, approvalAuthorityFor(workspace, authorityRoot), "unit-a")

    let invokerCalls = 0
    const invoker: RepairDiagnosisInvoker = async () => {
      invokerCalls += 1
      const proposal: RepairModelProposal = { status: "no_defensible_diagnosis", reason: "scripted" }
      return proposal
    }
    const harness = makeRepairHarness({ workspace, authorityRoot, invoker })
    const started = await harness.manager.start(startSpec(workspace))
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id

    // Malformed (unparseable) evidence: the gate blocks as malformed, which is never repairable.
    const dir = join(harness.evidenceRoot, taskId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "run.unit-a.1.json"), "this is not json{")

    const waiter = harness.manager.waitFor(taskId)
    harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    const terminal: TaskRecord = await withTimeout(waiter, 5000, "malformed terminal")
    expect(terminal.status).toBe("error")

    await flush()
    await flush()
    expect(invokerCalls).toBe(0)
    expect(createRepairAttemptStore({ root: harness.repairRoot }).list(taskId)).toHaveLength(0)
    const types = eventTypes(harness.store, taskId)
    expect(types).toContain("repair_skipped")
  })

  test("a repair that cannot fix leaves the task blocked and never publishes success", async () => {
    const workspace = makeGitWorkspace()
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-wiring-auth-")))
    writeDeclaredCheck(workspace, "unit-a", ["node", "-e", "process.exit(0)"])
    approveDeclaredCheck(workspace, approvalAuthorityFor(workspace, authorityRoot), "unit-a")

    let invokerCalls = 0
    const invoker: RepairDiagnosisInvoker = async () => {
      invokerCalls += 1
      const proposal: RepairModelProposal = { status: "proposed", plan: goodPlan() }
      return proposal
    }
    const editExecutor: RepairEditExecutor = async (request) => {
      for (const file of request.plan.filesToChange) {
        const target = join(request.workspaceDir, file)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, "repaired\n")
      }
      return { changedFiles: [...request.plan.filesToChange] }
    }
    // The rerun still fails: the gate verdict stays blocked, so the task must stay blocked.
    const harness = makeRepairHarness({ workspace, authorityRoot, invoker, editExecutor, runner: stubRunner(1, "still red") })
    const started = await harness.manager.start(startSpec(workspace))
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    await captureEvidence({ workspace, evidenceRoot: harness.evidenceRoot, runId: taskId, epoch: 0, checkId: "unit-a", exitCode: 1, output: "red" })

    // Subscribe to the exact repair completion before triggering it.
    let resolveFinished: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve
    })
    // SAFETY: tests observe the repair_finished emit through the store seam; the narrow appendEvent view names only that seam.
    const mutableStore = harness.store as { appendEvent: TaskRecordStore["appendEvent"] }
    const originalAppend = harness.store.appendEvent.bind(harness.store)
    // SAFETY: the wrapper forwards the same repair_finished event shape the store persists; never narrows the payload.
    mutableStore.appendEvent = ((id: string, event: { readonly type: string; readonly payload: unknown }) => {
      // SAFETY: test wrapper forwards the observed event to the real appendEvent; the payload shape is the store event contract.
      const result = originalAppend(id, event as never)
      if (id === taskId && event.type === "repair_finished") resolveFinished()
      return result
    }) as TaskRecordStore["appendEvent"]

    const waiter = harness.manager.waitFor(taskId)
    harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    const terminal = await withTimeout(waiter, 5000, "blocked terminal")
    expect(terminal.status).toBe("error")

    await withTimeout(finished, 10000, "repair_finished")
    expect(invokerCalls).toBeGreaterThan(0)

    const record = harness.store.load(taskId)
    expect(record?.status).toBe("error")
    expect(record?.status).not.toBe("completed")
    expect(record?.final_response).toBeUndefined()
    expect(record?.error_message).toContain("completion blocked")
    const blockedEvent = readLogEvents(harness.store, taskId).find((event) => event.type === "verification_blocked")
    expect(blockedEvent?.payload?.verification_status).toBe("blocked")
    const stored = createRepairAttemptStore({ root: harness.repairRoot }).load(`${taskId}.e0.r1`)
    expect(stored?.state).toBe("repair_failed")
  })

  test("a stale epoch publishes nothing", async () => {
    const workspace = makeGitWorkspace()
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-wiring-auth-")))
    writeDeclaredCheck(workspace, "unit-a", ["node", "-e", "process.exit(0)"])
    approveDeclaredCheck(workspace, approvalAuthorityFor(workspace, authorityRoot), "unit-a")

    let invokerCalls = 0
    let resolveCalled: () => void = () => {}
    const called = new Promise<void>((resolve) => {
      resolveCalled = resolve
    })
    let releaseRepair: (proposal: RepairModelProposal) => void = () => {}
    const gate = new Promise<RepairModelProposal>((resolve) => {
      releaseRepair = resolve
    })
    const invoker: RepairDiagnosisInvoker = async () => {
      invokerCalls += 1
      resolveCalled()
      return await gate
    }
    const harness = makeRepairHarness({ workspace, authorityRoot, invoker, runner: stubRunner(0, "green") })
    const started = await harness.manager.start(startSpec(workspace))
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    await captureEvidence({ workspace, evidenceRoot: harness.evidenceRoot, runId: taskId, epoch: 0, checkId: "unit-a", exitCode: 1, output: "red" })

    const eventsBefore: RepairWiringLogEvent[] = []
    // SAFETY: tests observe the repair_finished emit through the store seam; the narrow appendEvent view names only that seam.
    const mutableStore = harness.store as { appendEvent: TaskRecordStore["appendEvent"] }
    const originalAppend = harness.store.appendEvent.bind(harness.store)
    let repairFinishedAfterStale = 0
    // SAFETY: the wrapper forwards the same repair_finished event shape the store persists; never narrows the payload.
    mutableStore.appendEvent = ((id: string, event: { readonly type: string; readonly payload: unknown }) => {
      // SAFETY: test wrapper forwards the observed event to the real appendEvent; the payload shape is the store event contract.
      const result = originalAppend(id, event as never)
      if (id === taskId && event.type === "repair_finished") repairFinishedAfterStale += 1
      return result
    }) as TaskRecordStore["appendEvent"]

    const waiter2 = harness.manager.waitFor(taskId)
    harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    await withTimeout(waiter2, 5000, "blocked terminal")
    await withTimeout(called, 5000, "repair invoker call")

    // The record moves on while the attempt is in flight: the attempt epoch is now stale.
    const bumped = harness.store.mutate(taskId, (fresh) => ({
      ...fresh,
      notification: { ...fresh.notification, run_epoch: fresh.notification.run_epoch + 1 },
    }))
    expect(bumped?.notification.run_epoch).toBe(1)
    eventsBefore.push(...readLogEvents(harness.store, taskId))

    releaseRepair({ status: "no_defensible_diagnosis", reason: "scripted late answer" })
    await flush()
    await flush()
    await flush()
    expect(invokerCalls).toBe(1)

    // Stale guard: no repair event for the old epoch, and the moved-on record is untouched.
    expect(repairFinishedAfterStale).toBe(0)
    const current = harness.store.load(taskId)
    expect(current?.notification.run_epoch).toBe(1)
    expect(eventTypes(harness.store, taskId).filter((type) => type === "repair_finished")).toHaveLength(0)
    void eventsBefore
  })

  test("default host adapter without a live model ends repair_failed and stays blocked", async () => {
    const workspace = makeGitWorkspace()
    const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-wiring-auth-")))
    writeDeclaredCheck(workspace, "unit-a", ["node", "-e", "process.exit(0)"])
    approveDeclaredCheck(workspace, approvalAuthorityFor(workspace, authorityRoot), "unit-a")

    // No scripted invoker: the production default adapter fails closed as model_unavailable.
    const harness = makeRepairHarness({ workspace, authorityRoot, runner: stubRunner(1, "still red") })
    const started = await harness.manager.start(startSpec(workspace))
    if (started.kind !== "started") throw new Error("expected started")
    const taskId = started.task_id
    await captureEvidence({ workspace, evidenceRoot: harness.evidenceRoot, runId: taskId, epoch: 0, checkId: "unit-a", exitCode: 1, output: "red" })

    let resolveFinished: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve
    })
    // SAFETY: tests observe the repair_finished emit through the store seam; the narrow appendEvent view names only that seam.
    const mutableStore2 = harness.store as { appendEvent: TaskRecordStore["appendEvent"] }
    const originalAppend2 = mutableStore2.appendEvent.bind(harness.store)
    // SAFETY: the wrapper forwards the same repair_finished event shape the store persists; never narrows the payload.
    mutableStore2.appendEvent = ((id: string, event: { readonly type: string; readonly payload: unknown }) => {
      // SAFETY: test wrapper forwards the observed event to the real appendEvent; the payload shape is the store event contract.
      const result = originalAppend2(id, event as never)
      if (id === taskId && event.type === "repair_finished") resolveFinished()
      return result
    }) as TaskRecordStore["appendEvent"]

    const waiter = harness.manager.waitFor(taskId)
    harness.inProcess.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" })
    const terminal: TaskRecord = await withTimeout(waiter, 5000, "blocked terminal")
    expect(terminal.status).toBe("error")

    await withTimeout(finished, 10000, "repair_finished")
    const record = harness.store.load(taskId)
    expect(record?.status).toBe("error")
    expect(record?.error_message).toContain("completion blocked")
    const blockedEvent = readLogEvents(harness.store, taskId).find((event) => event.type === "verification_blocked")
    expect(blockedEvent?.payload?.verification_status).toBe("blocked")
    const stored = createRepairAttemptStore({ root: harness.repairRoot }).load(`${taskId}.e0.r1`)
    expect(stored?.state).toBe("repair_failed")
    const detail = `${stored?.outcome?.reason ?? ""} ${readLogEvents(harness.store, taskId).map((event) => JSON.stringify(event)).join(" ")}`
    expect(detail).toContain("model_unavailable")
  })
})
