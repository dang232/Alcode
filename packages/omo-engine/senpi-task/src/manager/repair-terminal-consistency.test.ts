// Terminal-record consistency for a gate-verified repair, proved through the REAL manager, task
// record store, completion gate, evidence store, and repair attempt store.
//
// Canonical semantics this file pins:
// - `status` is the run's lifecycle fact.
// - `verification_status` is the completion gate's final word about the CURRENT evidence.
// - `error_message` is the CURRENT terminal error only, and is ABSENT on a clean success.
// A verified repair corrects the gate-blocked terminal in place for the same epoch. The original
// verification failure is HISTORY and stays readable elsewhere: the pre-repair evidence attempt
// remains on disk, the repair attempt store keeps the failed check/evidence ids and outcome, and
// the task log keeps verification_blocked / repair_finished.
//
// Only the gate's own blocked terminal may be upgraded. An infrastructure error, a cancellation,
// a repair failure, or an old epoch never reaches the correction and keeps its real error text.

import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import { OmoTaskSettingsSchema } from "../../../omo-config-core/src/index.ts"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import type { TaskRecord } from "../state"
import { createTaskManager } from "./manager"
import type { ManagerStartSpec, TaskManager } from "./types"
import { FakeRunner } from "./__fixtures__/manager-fakes"
import { approvalAuthorityFor } from "../verification/approval-authority"
import { approveCandidate } from "../verification/approval-store"
import { VERIFICATION_CONFIG_VERSION } from "../verification/config"
import { candidateForApproval } from "../verification/resolution"
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store"
import { createOrdinaryVerificationCapture, ORDINARY_VERIFICATION_NODE } from "../verification/ordinary-capture"
import { parseVerificationRecord, type DagVerifyCheck } from "../dag/verification"
import type { RepairPlan } from "../repair/plan"
import type { RepairDiagnosisInvoker, RepairModelProposal } from "../repair/orchestrator"
import { createRepairAttemptStore } from "../repair/store"
import type { VerificationCommandResult, VerificationRunner } from "../verification/contract"

type RepairHarness = {
  readonly manager: TaskManager
  readonly store: TaskRecordStore
  readonly inProcess: FakeRunner
  readonly workspace: string
  readonly stateRoot: string
  readonly evidenceRoot: string
  readonly repairRoot: string
}

type BlockedRun = {
  readonly harness: RepairHarness
  readonly taskId: string
  readonly finished: Promise<void>
  readonly baselineRevision: string
  readonly terminal: TaskRecord
}

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

const roots: string[] = []

function track<T extends string>(dir: T): T {
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function deferred<T>(): Deferred<T> {
  let resolveValue!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return { promise, resolve: resolveValue }
}

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" })
}

function makeGitWorkspace(): string {
  const workspace = join(track(mkdtempSync(join(tmpdir(), "repair-terminal-"))), "work")
  mkdirSync(join(workspace, "src"), { recursive: true })
  writeFileSync(join(workspace, "src", "fix.ts"), "export const counter = 0\n")
  writeFileSync(join(workspace, "tracked.txt"), "baseline\n")
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "repair-terminal", private: true }))
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
    approvedBy: "repair-terminal-consistency-test",
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
    binding: { runId: options.runId, sessionId: "repair-terminal-parent", epoch: options.epoch },
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

function makeRepairHarness(options: {
  readonly workspace: string
  readonly authorityRoot: string
  readonly invoker: RepairDiagnosisInvoker
  readonly runner: VerificationRunner
}): RepairHarness {
  const stateRoot = track(mkdtempSync(join(tmpdir(), "repair-terminal-state-")))
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
    repair: { invoker: options.invoker, runner: options.runner },
  })
  return {
    manager,
    store,
    inProcess,
    workspace: options.workspace,
    stateRoot,
    evidenceRoot: join(store.stateDir, "verifications"),
    repairRoot: join(store.stateDir, "repairs"),
  }
}

function startSpec(workspace: string): ManagerStartSpec {
  return {
    prompt: "do the thing",
    parent_session_id: "repair-terminal-parent",
    depth: 1,
    cwd: workspace,
    execution_mode: "in-process",
  }
}

function proposedPlan(oldText: string, newText: string): RepairModelProposal {
  return {
    status: "proposed",
    plan: goodPlan(),
    fileOperations: [
      { path: "src/fix.ts", operation: "modify", edits: [{ path: "src/fix.ts", oldText, newText }] },
    ],
  }
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

// Subscribe to the exact repair_finished append before the child settles: the async repair is
// observed through its own event, never a poll or a sleep.
function observeRepairFinished(harness: RepairHarness, taskId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const originalAppend = harness.store.appendEvent
    harness.store.appendEvent = (id, event) => {
      const result = originalAppend.call(harness.store, id, event)
      if (id === taskId && event.type === "repair_finished") resolve()
      return result
    }
  })
}

function eventLog(harness: RepairHarness, taskId: string): string {
  try {
    return readFileSync(join(harness.store.stateDir, "logs", `${taskId}.jsonl`), "utf8")
  } catch {
    return ""
  }
}

function persistedRaw(harness: RepairHarness, taskId: string): string {
  return readFileSync(join(harness.store.stateDir, "tasks", `${taskId}.json`), "utf8")
}

function evidenceFile(harness: RepairHarness, taskId: string, checkId: string, attempt: number): string {
  return join(harness.evidenceRoot, taskId, `${ORDINARY_VERIFICATION_NODE}.${checkId}.${attempt}.json`)
}

function readEvidence(harness: RepairHarness, taskId: string, checkId: string, attempt: number) {
  return parseVerificationRecord(readFileSync(evidenceFile(harness, taskId, checkId, attempt), "utf8"))
}

async function blockedRun(invoker: RepairDiagnosisInvoker, repairRunner: VerificationRunner): Promise<BlockedRun> {
  const workspace = makeGitWorkspace()
  const authorityRoot = track(mkdtempSync(join(tmpdir(), "repair-terminal-auth-")))
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
  const terminal = await withTimeout(waiter, 10_000, "blocked terminal")
  expect(terminal.status).toBe("error")
  return { harness, taskId, finished, baselineRevision, terminal }
}

describe("verified repair terminal-record consistency", () => {
  test("verified repair clears error_message, keeps the failed evidence as history, and survives restart", async () => {
    const { harness, taskId, finished, baselineRevision, terminal } = await blockedRun(
      async () => proposedPlan("counter = 0", "counter = 1"),
      stubRunner(0, "green"),
    )
    await withTimeout(finished, 20_000, "repair_finished")

    // The waiter snapshot was taken when the blocked terminal landed, BEFORE the repair corrected
    // the record. This is exactly the pre-repair value a `?? terminal.error_message` fallback
    // reports; the persisted record below proves it is not on disk anymore.
    expect(terminal.error_message).toContain("completion blocked: verification_failed")

    const persisted = persistedRaw(harness, taskId)
    expect(persisted).toContain('"status":"completed"')
    expect(persisted).toContain('"verification_status":"verified"')
    expect(persisted).not.toContain('"error_message"')

    // History (a): the original failed evidence attempt is still on disk, unmodified.
    const original = readEvidence(harness, taskId, "unit-a", 1)
    expect(original?.status).not.toBe("passed")
    expect(original?.sourceRevision).toBe(baselineRevision)

    // History (b): the durable repair attempt names the failed check and settled repaired.
    const attempt = createRepairAttemptStore({ root: harness.repairRoot }).load(`${taskId}.e0.r1`)
    expect(attempt?.state).toBe("repaired")
    expect(attempt?.failedCheckIds).toContain("unit-a")

    // The fresh evidence is a NEW attempt against the repaired revision.
    const fresh = readEvidence(harness, taskId, "unit-a", 2)
    expect(fresh?.status).toBe("passed")
    expect(fresh?.sourceRevision).not.toBe(baselineRevision)
    expect(fresh?.workerAttempt).toBe(0)

    // History (c): the task log still carries the block and the repair.
    const log = eventLog(harness, taskId)
    expect(log).toContain('"type":"verification_blocked"')
    expect(log).toContain('"type":"repair_finished"')

    // Restart: a fresh store over the same state dir reads the corrected record, the history
    // attempt, and the preserved failed evidence.
    const reopened = createTaskRecordStore({ project_dir: harness.stateRoot })
    const reloaded = reopened.load(taskId)
    expect(reloaded?.status).toBe("completed")
    expect(reloaded?.error_message).toBeUndefined()
    expect(readFileSync(join(reopened.stateDir, "tasks", `${taskId}.json`), "utf8")).toContain(
      '"verification_status":"verified"',
    )
    expect(createRepairAttemptStore({ root: harness.repairRoot }).load(`${taskId}.e0.r1`)?.state).toBe("repaired")
    expect(readEvidence(harness, taskId, "unit-a", 1)?.status).not.toBe("passed")
  }, 40_000)

  test("a repair failure keeps the real gate error and never publishes verified", async () => {
    const { harness, taskId, finished } = await blockedRun(
      async () => ({ status: "no_defensible_diagnosis", reason: "scripted: thin evidence" }),
      stubRunner(0, "green"),
    )
    await withTimeout(finished, 20_000, "repair_finished")

    const log = eventLog(harness, taskId)
    expect(log).toContain('"final_state":"repair_failed"')
    expect(log).toContain('"verification_status":"blocked"')
    expect(log).not.toContain('"verification_status":"verified"')

    const persisted = persistedRaw(harness, taskId)
    expect(persisted).toContain('"status":"error"')
    expect(persisted).toContain('"error_message":"completion blocked: verification_failed:')
    expect(persisted).not.toContain('"verification_status":"verified"')
  }, 40_000)

  test("cancellation stays cancelled and keeps its own error text", async () => {
    const hold = deferred<RepairModelProposal>()
    const called = deferred<void>()
    const invoker: RepairDiagnosisInvoker = async () => {
      called.resolve(undefined)
      return await hold.promise
    }
    const { harness, taskId, finished } = await blockedRun(invoker, stubRunner(0, "green"))
    await withTimeout(called.promise, 5000, "repair invoker call")

    harness.store.mutate(taskId, (record) => ({
      ...record,
      status: "cancelled",
      error_message: "cancelled by user",
    }))
    hold.resolve(proposedPlan("counter = 0", "counter = 1"))
    await withTimeout(finished, 20_000, "repair_finished")

    const persisted = persistedRaw(harness, taskId)
    expect(persisted).toContain('"status":"cancelled"')
    expect(persisted).toContain('"error_message":"cancelled by user"')
    expect(persisted).not.toContain('"verification_status":"verified"')
  }, 40_000)

  test("an infrastructure failure message is never cleared by a verified repair", async () => {
    const hold = deferred<RepairModelProposal>()
    const called = deferred<void>()
    const invoker: RepairDiagnosisInvoker = async () => {
      called.resolve(undefined)
      return await hold.promise
    }
    const { harness, taskId, finished } = await blockedRun(invoker, stubRunner(0, "green"))
    await withTimeout(called.promise, 5000, "repair invoker call")

    harness.store.mutate(taskId, (record) => ({ ...record, error_message: "spawn failed: ENOENT" }))
    hold.resolve(proposedPlan("counter = 0", "counter = 1"))
    await withTimeout(finished, 20_000, "repair_finished")

    // The attempt itself verified, but the terminal it would upgrade is not the gate's block.
    const log = eventLog(harness, taskId)
    expect(log).toContain('"final_state":"repaired"')
    expect(log).toContain('"verification_status":"blocked"')

    const persisted = persistedRaw(harness, taskId)
    expect(persisted).toContain('"status":"error"')
    expect(persisted).toContain('"error_message":"spawn failed: ENOENT"')
    expect(persisted).not.toContain('"verification_status":"verified"')
  }, 40_000)

  test("a reverification verdict other than verified never triggers the correction", async () => {
    const { harness, taskId, finished } = await blockedRun(
      async () => proposedPlan("counter = 0", "counter = 1"),
      stubRunner(1, "still red"),
    )
    await withTimeout(finished, 20_000, "repair_finished")

    const log = eventLog(harness, taskId)
    expect(log).toContain('"final_state":"repair_failed"')
    expect(log).toContain('"gate_verdict":"blocked"')
    expect(log).not.toContain('"verification_status":"verified"')

    const persisted = persistedRaw(harness, taskId)
    expect(persisted).toContain('"status":"error"')
    expect(persisted).toContain('"error_message":"completion blocked: verification_failed:')
    expect(persisted).not.toContain('"verification_status":"verified"')
  }, 40_000)

  test("an old epoch cannot rewrite the current terminal", async () => {
    const hold = deferred<RepairModelProposal>()
    const called = deferred<void>()
    const invoker: RepairDiagnosisInvoker = async () => {
      called.resolve(undefined)
      return await hold.promise
    }
    const { harness, taskId } = await blockedRun(invoker, stubRunner(0, "green"))
    await withTimeout(called.promise, 5000, "repair invoker call")

    // The run moved on: a new epoch owns the record now, with its own terminal error.
    harness.store.mutate(taskId, (record) => ({
      ...record,
      notification: { ...record.notification, run_epoch: 1 },
      error_message: "new epoch terminal",
    }))
    const attemptFile = join(harness.repairRoot, taskId, `${taskId}.e0.r1.json`)
    const settled = waitForRepairAttemptTerminal(attemptFile)
    hold.resolve(proposedPlan("counter = 0", "counter = 1"))
    await withTimeout(settled, 20_000, `terminal repair attempt at ${attemptFile}`)

    const persisted = persistedRaw(harness, taskId)
    expect(persisted).toContain('"run_epoch":1')
    expect(persisted).toContain('"status":"error"')
    expect(persisted).toContain('"error_message":"new epoch terminal"')
    expect(persisted).not.toContain('"verification_status":"verified"')
    // The stale attempt published no repair_finished event at all.
    expect(eventLog(harness, taskId)).not.toContain('"type":"repair_finished"')
  }, 40_000)
})

// Terminal repair states: the attempt file is renamed into place before runRepairAttempt
// resolves, so the manager's post-attempt epoch fence has already run when this event is
// delivered (microtasks drain before I/O callbacks).
function waitForRepairAttemptTerminal(attemptFile: string): Promise<void> {
  const attemptId = basename(attemptFile, ".json")
  const root = dirname(dirname(attemptFile))
  return new Promise<void>((resolve, reject) => {
    let watcher: ReturnType<typeof watch> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      watcher?.close()
      if (timer !== undefined) clearTimeout(timer)
      if (error === undefined) resolve()
      else reject(error)
    }
    const check = () => {
      try {
        const state = createRepairAttemptStore({ root }).load(attemptId)?.state
        if (state === "repaired" || state === "repair_failed" || state === "repair_cancelled") finish()
      } catch {
        // A transient read fault is retried by the next filesystem event.
      }
    }
    timer = setTimeout(() => finish(new Error(`timed out waiting for terminal repair attempt ${attemptId}`)), 20_000)
    timer.unref?.()
    try {
      watcher = watch(dirname(attemptFile), check)
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
      return
    }
    check()
  })
}
