// Scheduler integration for evidence-first verification: node checks gate
// completion, failures fail the node, and the run gate reads persisted records.
// Harness mirrors scheduler-conflict.test.ts with verify options added.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { dagFingerprint, nodeFingerprintInput } from "./fingerprint"
import { compileDag, type DagDefinition, type DagNodeInput } from "./graph"
import { nodeFingerprintFromInput } from "./manager"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagRunId } from "./types"
import {
  parseVerificationRecord,
  readRunVerificationRecords,
  runVerificationCommand,
  type DagVerifyCheck,
  type DagVerifyCommandResult,
  type DagVerifyRunner,
} from "./verification"
import { repairDagRun } from "./repair"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

// SAFETY: test-only brand for a fixed fixture id; nothing at runtime inspects its shape.
const runId = "run-verify" as DagRunId
const parentSessionId = "ses-verify-parent"
const rootSessionId = "ses-verify-root"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-verify-"))
  cleanupRoots.push(directory)
  return directory
}

function check(overrides: Partial<DagVerifyCheck> = {}): DagVerifyCheck {
  return {
    checkId: "unit-core",
    category: "unit",
    command: ["bun", "test"],
    timeoutMs: 30_000,
    criteria: ["AC-1"],
    ...overrides,
  }
}

function node(id: string, options: { readonly dependsOn?: readonly string[]; readonly verify?: readonly DagVerifyCheck[] } = {}): DagNodeInput {
  const entry: DagNodeInput = { id, prompt: `do ${id}`, category: "quick" }
  const withDeps = options.dependsOn === undefined || options.dependsOn.length === 0
    ? entry
    : { ...entry, dependsOn: [...options.dependsOn] }
  if (options.verify === undefined) return withDeps
  return { ...withDeps, verify: [...options.verify] }
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "verify-test", name: "verify test", nodes }
}

function recordFor(input: DagDefinition, id: DagRunId = runId): DagRunRecordV1 {
  const createdAt = "2026-10-22T00:00:00.000Z"
  const compiled = compileDag(input, { at: createdAt })
  if (!compiled.ok) throw new Error("test DAG did not compile")
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId: id,
    runKey: input.key,
    name: input.name,
    parentSessionId,
    rootSessionId,
    definitionFingerprint: "definition-fingerprint",
    definition: {
      key: input.key,
      name: input.name,
      nodes: input.nodes.map((entry) => ({ ...entry, effectivePrompt: entry.prompt })),
    },
    status: "pending",
    generation: 1,
    createdAt,
    updatedAt: createdAt,
    nodes: compiled.nodes,
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
  }
}

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class VerifyFakeManager implements TaskManager {
  readonly starts: string[] = []
  readonly #tasks = new Map<string, {
    record: TaskRecord
    readonly completion: Promise<TaskRecord>
    readonly resolveCompletion: (record: TaskRecord) => void
  }>()
  readonly #startedSignals = new Map<string, ReturnType<typeof deferred<void>>>()
  readonly #residencyWaiters = new Map<string, ReturnType<typeof deferred<void>>>()
  #taskCounter = 0

  whenStarted(nodeId: string): Promise<void> {
    let signal = this.#startedSignals.get(nodeId)
    if (signal === undefined) {
      signal = deferred<void>()
      this.#startedSignals.set(nodeId, signal)
    }
    if (this.starts.includes(nodeId)) signal.resolve()
    return signal.promise
  }

  residencyChanged(session: string): Promise<void> {
    let waiter = this.#residencyWaiters.get(session)
    if (waiter === undefined) {
      waiter = deferred<void>()
      this.#residencyWaiters.set(session, waiter)
    }
    return waiter.promise
  }

  #notifyResidency(session: string): void {
    const waiter = this.#residencyWaiters.get(session)
    if (waiter === undefined) return
    this.#residencyWaiters.delete(session)
    waiter.resolve()
  }

  recordOf(nodeId: string): TaskRecord | undefined {
    return [...this.#tasks.values()].find((entry) => String(entry.record.owner?.nodeId) === nodeId)?.record
  }

  complete(nodeId: string, status: TaskStatus = "completed"): void {
    const entry = [...this.#tasks.values()].find((candidate) => String(candidate.record.owner?.nodeId) === nodeId)
    if (entry === undefined) throw new Error(`unknown fake task for ${nodeId}`)
    entry.record = {
      ...entry.record,
      status,
      updated_at: "2026-10-22T00:00:01.000Z",
      ...(status === "completed" ? { final_response: `done ${nodeId}` } : { error_message: `${status} ${nodeId}` }),
    }
    entry.resolveCompletion(entry.record)
    this.#notifyResidency(entry.record.parent_session_id)
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    const nodeId = String(owner.nodeId)
    this.#taskCounter += 1
    const taskId = `task-${this.#taskCounter}`
    const completion = deferred<TaskRecord>()
    this.#tasks.set(taskId, {
      record: {
        task_id: taskId,
        name: nodeId,
        parent_session_id: parentSessionId,
        root_session_id: rootSessionId,
        depth: 1,
        category: "quick",
        execution_mode: "in-process",
        model: "fake-model",
        notify_on_terminal: true,
        owner,
        status: "running",
        residency_state: "resident",
        created_at: "2026-10-22T00:00:00.000Z",
        updated_at: "2026-10-22T00:00:00.000Z",
        notification: { run_epoch: 1, notified_epoch: 0 },
      },
      completion: completion.promise,
      resolveCompletion: completion.resolve,
    })
    this.starts.push(nodeId)
    this.#startedSignals.get(nodeId)?.resolve()
    return { kind: "started", reused: false, task_id: taskId, status: "running", name: nodeId }
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return this.recordOf(String(owner.nodeId))
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const entry = this.#tasks.get(taskId)
    if (entry === undefined) throw new Error(`unknown fake task ${taskId}`)
    return entry.completion
  }

  start(): Promise<never> { throw new Error("not implemented") }
  continueTask(): Promise<never> { throw new Error("not implemented") }
  sendToTask(): Promise<never> { throw new Error("not implemented") }
  interruptTask(): Promise<never> { throw new Error("not implemented") }
  cancelTask(): Promise<never> { throw new Error("not implemented") }
  list(): readonly [] { return [] }
  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }
  forget(): void {}
  getResidentHandle(): undefined { return undefined }
  subscribeChild(): () => void { return () => undefined }
  residentTaskIds(): readonly string[] { return [] }
  promoteToBackground(): boolean { return false }
  wasBackground(): boolean { return true }
}

function fakeRunner(results: ReadonlyMap<string, DagVerifyCommandResult>): DagVerifyRunner {
  return async (input) => {
    const result = results.get(input.check.checkId)
    if (result === undefined) throw new Error(`no fake result for ${input.check.checkId}`)
    return result
  }
}

function passResult(): DagVerifyCommandResult {
  return { started: true, exitCode: 0, timedOut: false, cancelled: false, output: "pass", outputBytes: 4, durationMs: 5, uncertainEffect: false }
}

function verifyFixture(
  input: DagDefinition,
  manager: VerifyFakeManager,
  options: {
    readonly runner?: DagVerifyRunner
    readonly projectDir?: string
    readonly verifyChecks?: readonly DagVerifyCheck[]
    readonly store?: DagFileStore
  } = {},
) {
  const projectDir = options.projectDir ?? tempProject()
  const store = options.store ?? createDagFileStore({ project_dir: projectDir })
  const initialRecord = recordFor(input)
  store.writeCheckpoint(runId, initialRecord)
  let eventTime = Date.parse("2026-10-22T00:00:02.000Z")
  const scheduler = createDagScheduler({
    store,
    taskManager: manager,
    initialRecord,
    now: () => eventTime++,
    verifyRunner: options.runner,
    verifyProjectDir: projectDir,
    verifyChecks: options.verifyChecks,
  })
  return { scheduler, store, projectDir }
}

describe("scheduler verification integration", () => {
  test("#given a node check that passes #when the run settles #then the node completes and the record persists", async () => {
    // given a node with a passing check
    const manager = new VerifyFakeManager()
    const { scheduler, store } = verifyFixture(
      definition([node("a", { verify: [check()] })]),
      manager,
      { runner: fakeRunner(new Map([["unit-core", passResult()]])) },
    )
    // when the run settles
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running
    // then the node completed and the genuine record is on disk
    expect(result.status).toBe("completed")
    const text = store.readVerification(runId, "a", "unit-core", 0)
    expect(text === null).toBe(false)
    const parsed = parseVerificationRecord(text ?? "")
    expect(parsed?.status).toBe("passed")
    expect(parsed?.exitCode).toBe(0)
  })

  test("#given a node check that fails #when the run settles #then the node fails and dependents skip", async () => {
    // given a failing node check and a dependent
    const manager = new VerifyFakeManager()
    const failing: DagVerifyCommandResult = {
      started: true, exitCode: 1, timedOut: false, cancelled: false,
      output: "1 pass 2 fail", outputBytes: 13, durationMs: 5, uncertainEffect: false,
    }
    const { scheduler } = verifyFixture(
      definition([node("a", { verify: [check()] }), node("b", { dependsOn: ["a"] })]),
      manager,
      { runner: fakeRunner(new Map([["unit-core", failing]])) },
    )
    // when the run settles
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running
    // then the node failed verification, the dependent skipped, the run failed
    const a = result.nodes.find((entry) => String(entry.id) === "a")
    const b = result.nodes.find((entry) => String(entry.id) === "b")
    expect(a?.state).toBe("failed")
    expect(a?.error?.code).toBe("verification_failed")
    expect(b?.state).toBe("skipped")
    expect(result.status).toBe("failed")
    expect(manager.starts.includes("b")).toBe(false)
  })

  test("#given declared checks but no runner #when the run settles #then the node fails closed, never unverified", async () => {
    // given checks with no runner to execute them
    const manager = new VerifyFakeManager()
    const { scheduler } = verifyFixture(definition([node("a", { verify: [check()] })]), manager)
    // when the run settles
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running
    // then the node fails instead of completing without evidence
    const a = result.nodes.find((entry) => String(entry.id) === "a")
    expect(a?.state).toBe("failed")
    expect(a?.error?.code).toBe("verification_failed")
    expect(result.status).toBe("failed")
  })

  test("#given a failing run-level check #when nodes complete #then the run still fails at the gate", async () => {
    // given workers that succeed but a run-level check that fails
    const manager = new VerifyFakeManager()
    const failing: DagVerifyCommandResult = {
      started: true, exitCode: 2, timedOut: false, cancelled: false,
      output: "type error", outputBytes: 10, durationMs: 5, uncertainEffect: false,
    }
    const runCheck = check({ checkId: "typecheck", category: "typecheck", command: ["bun", "run", "typecheck"] })
    const { scheduler } = verifyFixture(definition([node("a")]), manager, {
      runner: fakeRunner(new Map([["typecheck", failing]])),
      verifyChecks: [runCheck],
    })
    // when the run settles
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running
    // then the node completed but the run failed at acceptance
    expect(result.nodes.find((entry) => String(entry.id) === "a")?.state).toBe("completed")
    expect(result.status).toBe("failed")
  })

  test("#given a malformed record on disk #when the gate runs #then acceptance blocks", async () => {
    // given a malformed verification file beside a passing run
    const manager = new VerifyFakeManager()
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    store.writeVerification(runId, "a", "broken", 0, "{truncated")
    const { scheduler } = verifyFixture(definition([node("a")]), manager, {
      store,
      projectDir,
      runner: fakeRunner(new Map()),
    })
    // when the run settles
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running
    // then the malformed file blocks acceptance
    expect(result.status).toBe("failed")
  })

  test("#given a failed run with persisted records #when repaired through the real store #then the gate accepts", async () => {
    // given a run whose node check fails environmentally
    const manager = new VerifyFakeManager()
    const projectDir = tempProject()
    const store = createDagFileStore({ project_dir: projectDir })
    const flaky = check({ checkId: "flaky-dep", category: "integration", command: ["bun", "test", "flaky"] })
    const { scheduler } = verifyFixture(definition([node("a", { verify: [flaky] })]), manager, {
      store,
      projectDir,
      runner: fakeRunner(new Map([["flaky-dep", {
        started: false, timedOut: false, cancelled: false,
        output: "cannot start: bun not on PATH", outputBytes: 28, durationMs: 3, uncertainEffect: false,
      }]])),
    })
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const settled = await running
    expect(settled.status).toBe("failed")
    // when the owner repairs through the production loop against the same store
    const collected = readRunVerificationRecords(store, runId)
    expect(collected.records.size).toBe(1)
    const definitionNode = node("a", { verify: [flaky] })
    const fingerprint = dagFingerprint(nodeFingerprintInput(nodeFingerprintFromInput(definitionNode)))
    const outcome = await repairDagRun({
      runner: fakeRunner(new Map([["flaky-dep", {
        started: true, exitCode: 0, timedOut: false, cancelled: false,
        output: "3 pass", outputBytes: 6, durationMs: 4, uncertainEffect: false,
      }]])),
      projectDir,
      sourceRevision: settled.definitionFingerprint,
      generation: settled.generation,
      requirements: [{ check: flaky, nodeId: "a" }],
      regressionChecks: [],
      records: collected.records,
      currentFingerprints: new Map([["a", fingerprint]]),
      changedFiles: [],
      persistRecord: (record) => {
        // SAFETY: fixture record id; the brand is compile-time only and nothing reads its shape at runtime.
        store.writeVerification(record.runId as DagRunId, record.nodeId ?? "run", record.checkId, record.repairAttempt, JSON.stringify(record))
      },
    })
    // then the repair is accepted and the stored record proves it
    expect(outcome).toEqual({ kind: "accepted", attempts: 1 })
    const after = readRunVerificationRecords(store, runId)
    expect(after.records.get("a/flaky-dep")?.status).toBe("passed")
  })

  test("#given the real command runner #when a node check runs bun #then the genuine record proves it", async () => {
    // given the production runner executing a real process
    const manager = new VerifyFakeManager()
    const native = check({ checkId: "native-smoke", category: "native", command: ["bun", "-e", "process.exit(0)"] })
    const { scheduler, store, projectDir } = verifyFixture(
      definition([node("a", { verify: [native] })]),
      manager,
      { runner: runVerificationCommand },
    )
    // when the run settles
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running
    // then the real execution accepted the node
    expect(result.status).toBe("completed")
    const parsed = parseVerificationRecord(store.readVerification(runId, "a", "native-smoke", 0) ?? "")
    expect(parsed?.status).toBe("passed")
    expect(parsed?.cwd).toBe(projectDir)
  })
})
