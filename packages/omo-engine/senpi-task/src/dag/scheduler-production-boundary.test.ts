// Production-boundary proof for evidence-first verification (slice 4.2):
// every scenario drives the real scheduler fold path and the canonical
// completion gate, importing the production entry points through the package
// barrel (the exact file the "./dag" export map points at). The fake worker
// manager only stands in for child execution; verification-state
// transitions, the repair budget, and the acceptance gate stay on real code.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import {
  compileDag,
  createDagFileStore,
  createDagScheduler,
  dagFingerprint,
  evaluateAcceptance,
  nodeFingerprintFromInput,
  nodeFingerprintInput,
  parseVerificationRecord,
  readRunVerificationRecords,
  repairDagRun,
  verificationRecordKey,
  type DagAcceptanceRequirement,
  type DagDefinition,
  type DagNodeInput,
  type DagRunId,
  type DagRunRecordV1,
  type DagTaskOwner,
  type DagVerificationRecord,
  type DagVerifyCheck,
  type DagVerifyCommandResult,
  type DagVerifyRunner,
  type OwnedStartResult,
} from "./index"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

// SAFETY: test-only brand for a fixed fixture id; nothing at runtime inspects its shape.
const runId = "run-boundary" as DagRunId
const parentSessionId = "ses-boundary-parent"
const rootSessionId = "ses-boundary-root"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-boundary-"))
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

function node(
  id: string,
  options: { readonly dependsOn?: readonly string[]; readonly verify?: readonly DagVerifyCheck[] } = {},
): DagNodeInput {
  const entry: DagNodeInput = { id, prompt: `do ${id}`, category: "quick" }
  const withDeps =
    options.dependsOn === undefined || options.dependsOn.length === 0
      ? entry
      : { ...entry, dependsOn: [...options.dependsOn] }
  if (options.verify === undefined) return withDeps
  return { ...withDeps, verify: [...options.verify] }
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "boundary-test", name: "boundary test", nodes }
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

// Minimal worker stand-in: only child execution is faked. Admission,
// folding, verification, and the gate run the production scheduler.
class BoundaryFakeManager implements TaskManager {
  readonly starts: string[] = []
  readonly #tasks = new Map<
    string,
    {
      record: TaskRecord
      readonly completion: Promise<TaskRecord>
      readonly resolveCompletion: (record: TaskRecord) => void
    }
  >()
  readonly #startedSignals = new Map<string, ReturnType<typeof deferred<void>>>()
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

  residencyChanged(_session: string): Promise<void> {
    return new Promise<void>(() => undefined)
  }

  complete(nodeId: string, status: TaskStatus = "completed"): void {
    const entry = [...this.#tasks.values()].find(
      (candidate) => String(candidate.record.owner?.nodeId) === nodeId,
    )
    if (entry === undefined) throw new Error(`unknown fake task for ${nodeId}`)
    entry.record = {
      ...entry.record,
      status,
      updated_at: "2026-10-22T00:00:01.000Z",
      ...(status === "completed"
        ? { final_response: `done ${nodeId}` }
        : { error_message: `${status} ${nodeId}` }),
    }
    entry.resolveCompletion(entry.record)
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
    return [...this.#tasks.values()].find(
      (entry) => String(entry.record.owner?.nodeId) === String(owner.nodeId),
    )?.record
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const entry = this.#tasks.get(taskId)
    if (entry === undefined) throw new Error(`unknown fake task ${taskId}`)
    return entry.completion
  }

  start(): Promise<never> {
    throw new Error("not implemented")
  }
  continueTask(): Promise<never> {
    throw new Error("not implemented")
  }
  sendToTask(): Promise<never> {
    throw new Error("not implemented")
  }
  interruptTask(): Promise<never> {
    throw new Error("not implemented")
  }
  cancelTask(): Promise<never> {
    throw new Error("not implemented")
  }
  list(): readonly [] {
    return []
  }
  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }
  forget(): void {}
  getResidentHandle(): undefined {
    return undefined
  }
  subscribeChild(): () => void {
    return () => undefined
  }
  residentTaskIds(): readonly string[] {
    return []
  }
  promoteToBackground(): boolean {
    return false
  }
  wasBackground(): boolean {
    return true
  }
}

function fakeRunner(results: ReadonlyMap<string, DagVerifyCommandResult>): DagVerifyRunner {
  return async (input) => {
    const result = results.get(input.check.checkId)
    if (result === undefined) throw new Error(`no fake result for ${input.check.checkId}`)
    return result
  }
}

function passResult(): DagVerifyCommandResult {
  return {
    started: true,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    output: "pass",
    outputBytes: 4,
    durationMs: 5,
    uncertainEffect: false,
  }
}

function failResult(): DagVerifyCommandResult {
  return {
    started: true,
    exitCode: 1,
    timedOut: false,
    cancelled: false,
    output: "1 pass 2 fail",
    outputBytes: 13,
    durationMs: 5,
    uncertainEffect: false,
  }
}

function envFailureResult(): DagVerifyCommandResult {
  return {
    started: false,
    timedOut: false,
    cancelled: false,
    output: "cannot start: bun not on PATH",
    outputBytes: 28,
    durationMs: 3,
    uncertainEffect: false,
  }
}

function fixture(
  input: DagDefinition,
  manager: BoundaryFakeManager,
  options: {
    readonly runner?: DagVerifyRunner
    readonly projectDir?: string
    readonly verifyChecks?: readonly DagVerifyCheck[]
  } = {},
) {
  const projectDir = options.projectDir ?? tempProject()
  const store = createDagFileStore({ project_dir: projectDir })
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

function fingerprintOf(entry: DagNodeInput): string {
  return dagFingerprint(nodeFingerprintInput(nodeFingerprintFromInput(entry)))
}

function persistInto(store: ReturnType<typeof createDagFileStore>) {
  return (record: DagVerificationRecord): void => {
    // SAFETY: fixture record id; the brand is compile-time only and nothing reads its shape at runtime.
    store.writeVerification(
      record.runId as DagRunId,
      record.nodeId ?? "run",
      record.checkId,
      record.repairAttempt,
      JSON.stringify(record),
    )
  }
}

describe("production boundary integration", () => {
  test("P10 #given the package barrel #when the production entry points resolve #then they drive a real scheduler run", async () => {
    // given the barrel-resolved production modules driving the run below
    const manager = new BoundaryFakeManager()
    const { scheduler, store } = fixture(definition([node("a", { verify: [check()] })]), manager, {
      runner: fakeRunner(new Map([["unit-core", passResult()]])),
    })
    // when a run settles through the barrel-resolved scheduler
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running
    // then the node accepted on genuine persisted evidence
    expect(result.status).toBe("completed")
    const parsed = parseVerificationRecord(store.readVerification(runId, "a", "unit-core", 0) ?? "")
    expect(parsed?.status).toBe("passed")
  })

  test("P02 #given a failed node with a skipped dependent #when the gate reads persisted records #then missing evidence blocks acceptance", async () => {
    // given a failing node whose dependent carries its own required check
    const manager = new BoundaryFakeManager()
    const { scheduler, store } = fixture(
      definition([node("a", { verify: [check()] }), node("b", { dependsOn: ["a"], verify: [check()] })]),
      manager,
      { runner: fakeRunner(new Map([["unit-core", failResult()]])) },
    )
    // when the run settles through the production fold path and gate
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running
    expect(result.status).toBe("failed")
    // then the skipped dependent left no record and the canonical gate agrees
    const collected = readRunVerificationRecords(store, runId)
    const requirements: readonly DagAcceptanceRequirement[] = [
      { check: check(), nodeId: "a" },
      { check: check(), nodeId: "b" },
    ]
    const verdict = evaluateAcceptance({
      requirements,
      records: collected.records,
      current: {
        sourceRevision: result.definitionFingerprint,
        nodeFingerprints: new Map([
          ["a", fingerprintOf(node("a", { verify: [check()] }))],
          ["b", fingerprintOf(node("b", { dependsOn: ["a"], verify: [check()] }))],
        ]),
        generation: result.generation,
      },
      latestAttempts: new Map(),
    })
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.some((reason) => reason.includes("missing verification record for b/unit-core"))).toBe(
      true,
    )
  })

  test("P08 #given one passing and one failing goal #when the run settles #then the aggregate cannot complete", async () => {
    // given two independent goals, one of which fails verification
    const manager = new BoundaryFakeManager()
    const { scheduler, store } = fixture(
      definition([node("good", { verify: [check({ checkId: "good-check" })] }), node("bad", { verify: [check({ checkId: "bad-check" })] })]),
      manager,
      {
        runner: fakeRunner(
          new Map([
            ["good-check", passResult()],
            ["bad-check", failResult()],
          ]),
        ),
      },
    )
    // when the run settles
    const running = scheduler.run()
    await manager.whenStarted("good")
    await manager.whenStarted("bad")
    manager.complete("good")
    manager.complete("bad")
    const result = await running
    // then the valid goal completed but the aggregate still failed
    expect(result.nodes.find((entry) => String(entry.id) === "good")?.state).toBe("completed")
    expect(result.nodes.find((entry) => String(entry.id) === "bad")?.state).toBe("failed")
    expect(result.status).toBe("failed")
    const collected = readRunVerificationRecords(store, runId)
    expect(collected.records.get(verificationRecordKey("good", "good-check"))?.status).toBe("passed")
    expect(collected.records.get(verificationRecordKey("bad", "bad-check"))?.status).toBe("failed")
  })

  test("P04 #given an environment failure #when the owner repair loop reruns the check #then valid evidence accepts", async () => {
    // given a node whose check cannot start in the worker environment
    const manager = new BoundaryFakeManager()
    const flaky = check({ checkId: "flaky-dep", category: "integration", command: ["bun", "test", "flaky"] })
    const { scheduler, store, projectDir } = fixture(definition([node("a", { verify: [flaky] })]), manager, {
      runner: fakeRunner(
        new Map([
          [
            "flaky-dep",
            {
              started: false,
              timedOut: false,
              cancelled: false,
              output: "cannot start: bun not on PATH",
              outputBytes: 28,
              durationMs: 3,
              uncertainEffect: false,
            },
          ],
        ]),
      ),
    })
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const settled = await running
    expect(settled.status).toBe("failed")
    // when the owner loop repairs against the same production store
    const collected = readRunVerificationRecords(store, runId)
    const entry = node("a", { verify: [flaky] })
    const outcome = await repairDagRun({
      runner: fakeRunner(new Map([["flaky-dep", passResult()]])),
      projectDir,
      sourceRevision: settled.definitionFingerprint,
      generation: settled.generation,
      requirements: [{ check: flaky, nodeId: "a" }],
      regressionChecks: [],
      records: collected.records,
      currentFingerprints: new Map([["a", fingerprintOf(entry)]]),
      changedFiles: [],
      persistRecord: persistInto(store),
    })
    // then one bounded attempt collected valid evidence and the gate accepts
    expect(outcome).toEqual({ kind: "accepted", attempts: 1 })
    const after = readRunVerificationRecords(store, runId)
    expect(after.records.get(verificationRecordKey("a", "flaky-dep"))?.status).toBe("passed")
  })

  test("P05 #given a passing repair #when a regression check fails #then acceptance is still refused", async () => {
    // given a failed node and a regression check that guards the fix
    const manager = new BoundaryFakeManager()
    const target = check({ checkId: "target", category: "unit" })
    const regression = check({ checkId: "regression", category: "integration", command: ["bun", "test", "regression"] })
    const { scheduler, store, projectDir } = fixture(definition([node("a", { verify: [target] })]), manager, {
      runner: fakeRunner(new Map([["target", envFailureResult()]])),
    })
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const settled = await running
    expect(settled.status).toBe("failed")
    // when the target passes on repair but the regression check fails
    const collected = readRunVerificationRecords(store, runId)
    const entry = node("a", { verify: [target] })
    const outcome = await repairDagRun({
      runner: fakeRunner(
        new Map([
          ["target", passResult()],
          ["regression", failResult()],
        ]),
      ),
      projectDir,
      sourceRevision: settled.definitionFingerprint,
      generation: settled.generation,
      requirements: [{ check: target, nodeId: "a" }],
      regressionChecks: [regression],
      records: collected.records,
      currentFingerprints: new Map([["a", fingerprintOf(entry)]]),
      changedFiles: [],
      persistRecord: persistInto(store),
    })
    // then the repair is refused despite the fixed target
    expect(outcome.kind).toBe("blocked")
    if (outcome.kind === "blocked") {
      expect(outcome.reasons.some((reason) => reason.includes("regression check regression did not pass"))).toBe(
        true,
      )
    }
  })

  test("P06 #given passing evidence #when the source fingerprint changes #then the record goes stale and blocks", async () => {
    // given a node that passes verification on the current sources
    const manager = new BoundaryFakeManager()
    const { scheduler, store, projectDir } = fixture(definition([node("a", { verify: [check()] })]), manager, {
      runner: fakeRunner(new Map([["unit-core", passResult()]])),
    })
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const settled = await running
    expect(settled.status).toBe("completed")
    // when the sources change under the collected evidence
    const collected = readRunVerificationRecords(store, runId)
    const outcome = await repairDagRun({
      runner: fakeRunner(new Map([["unit-core", passResult()]])),
      projectDir,
      sourceRevision: settled.definitionFingerprint,
      generation: settled.generation,
      requirements: [{ check: check(), nodeId: "a" }],
      regressionChecks: [],
      records: collected.records,
      currentFingerprints: new Map([["a", "changed-fingerprint"]]),
      changedFiles: ["src/a.ts"],
      persistRecord: persistInto(store),
    })
    // then the stale record cannot accept and no new attempt is spent on it
    expect(outcome.kind).toBe("blocked")
    if (outcome.kind === "blocked") {
      expect(outcome.reasons.some((reason) => reason.includes("stale verification record"))).toBe(true)
    }
  })

  test("P07 #given a persistently failing check #when the repair budget is spent #then the node and run stay unaccepted", async () => {
    // given a node whose check fails on every attempt
    const manager = new BoundaryFakeManager()
    const { scheduler, store, projectDir } = fixture(definition([node("a", { verify: [check()] })]), manager, {
      runner: fakeRunner(new Map([["unit-core", envFailureResult()]])),
    })
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const settled = await running
    expect(settled.status).toBe("failed")
    // when the owner loop runs against a one-attempt budget
    const collected = readRunVerificationRecords(store, runId)
    const entry = node("a", { verify: [check()] })
    const outcome = await repairDagRun({
      runner: fakeRunner(new Map([["unit-core", envFailureResult()]])),
      projectDir,
      sourceRevision: settled.definitionFingerprint,
      generation: settled.generation,
      budgets: {
        maxAttemptsPerRun: 5,
        maxAttemptsPerNode: 5,
        maxAttemptsPerCheck: 1,
        maxIdenticalFailures: 5,
      },
      requirements: [{ check: check(), nodeId: "a" }],
      regressionChecks: [],
      records: collected.records,
      currentFingerprints: new Map([["a", fingerprintOf(entry)]]),
      changedFiles: [],
      persistRecord: persistInto(store),
    })
    // then exhaustion blocks without false success
    expect(outcome.kind).toBe("blocked")
    if (outcome.kind === "blocked") {
      expect(outcome.reasons.some((reason) => reason.includes("repair budget spent"))).toBe(true)
    }
    const after = readRunVerificationRecords(store, runId)
    const verdict = evaluateAcceptance({
      requirements: [{ check: check(), nodeId: "a" }],
      records: after.records,
      current: {
        sourceRevision: settled.definitionFingerprint,
        nodeFingerprints: new Map([["a", fingerprintOf(entry)]]),
        generation: settled.generation,
      },
      latestAttempts: new Map(),
    })
    expect(verdict.accepted).toBe(false)
  })
})
