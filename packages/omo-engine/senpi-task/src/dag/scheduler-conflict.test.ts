// Conflict-aware admission (slice 3): a node is admitted only when none of its
// writeScopes intersect the scopes of running nodes or nodes admitted earlier
// in the same pass. Harness mirrors scheduler-frontier.test.ts (FrontierFakeManager
// behavior, renamed) so admission semantics stay comparable across suites.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { dagDefinitionFingerprint, diffNodeFingerprints } from "./fingerprint"
import { compileDag, type DagDefinition, type DagNodeInput } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagRunId } from "./types"

// See scheduler-frontier.test.ts: Bun honours a preload's setDefaultTimeout only for the first
// test file of a run.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

// SAFETY: test-only brand for a fixed fixture id; nothing at runtime inspects its shape.
const runId = "run-conflict" as DagRunId
const parentSessionId = "ses-conflict-parent"
const rootSessionId = "ses-conflict-root"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-conflict-"))
  cleanupRoots.push(directory)
  return directory
}

type ScopeNodeOptions = {
  readonly dependsOn?: readonly string[]
  readonly writeScopes?: readonly string[]
}

function node(id: string, options: ScopeNodeOptions = {}): DagNodeInput {
  const entry: DagNodeInput = { id, prompt: `do ${id}`, category: "quick" }
  const withDeps = options.dependsOn === undefined || options.dependsOn.length === 0
    ? entry
    : { ...entry, dependsOn: [...options.dependsOn] }
  if (options.writeScopes === undefined) return withDeps
  return { ...withDeps, writeScopes: [...options.writeScopes] }
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "conflict-test", name: "conflict test", nodes }
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

class ConflictFakeManager implements TaskManager {
  readonly starts: string[] = []
  readonly attempts: string[] = []
  // Node ids whose next startOwned attempt rejects, simulating a start failure
  // (missing runner, admission error) as opposed to a child that runs and fails.
  readonly failStarts = new Set<string>()
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
    this.attempts.push(nodeId)
    if (this.failStarts.has(nodeId)) throw new Error(`start boom ${nodeId}`)
    const existing = this.recordOf(nodeId)
    if (existing !== undefined) {
      return { kind: "started", reused: true, task_id: existing.task_id, status: existing.status, name: existing.name ?? existing.task_id }
    }
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

function conflictFixture(
  input: DagDefinition,
  manager: ConflictFakeManager,
  options: { readonly runId?: DagRunId; readonly store?: DagFileStore } = {},
) {
  const store = options.store ?? createDagFileStore({ project_dir: tempProject() })
  const id = options.runId ?? runId
  const initialRecord = recordFor(input, id)
  store.writeCheckpoint(id, initialRecord)
  let eventTime = Date.parse("2026-10-22T00:00:02.000Z")
  const scheduler = createDagScheduler({
    store,
    taskManager: manager,
    initialRecord,
    now: () => eventTime++,
  })
  return { scheduler, store }
}

// Event-driven settle observation: resolves once the node reaches the state, never by sleeping.
function whenNodeState(
  scheduler: ReturnType<typeof createDagScheduler>,
  nodeId: string,
  state: string,
): Promise<void> {
  const current = scheduler.snapshot().nodes.find((entry) => String(entry.id) === nodeId)
  if (current?.state === state) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const unsubscribe = scheduler.subscribe((event) => {
      if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || event.to !== state) return
      unsubscribe()
      resolve()
    })
  })
}

describe("DAG scheduler conflict-aware admission", () => {
  test("#given three disjoint-scope roots #when all are runnable #then all three start in one pass with overlapping windows", async () => {
    // given - three roots touching nothing in common.
    const manager = new ConflictFakeManager()
    const { scheduler } = conflictFixture(
      definition([node("a", { writeScopes: ["x"] }), node("b", { writeScopes: ["y"] }), node("c", { writeScopes: ["z"] })]),
      manager,
    )

    // when - the run admits the whole frontier before anything settles.
    const running = scheduler.run()
    await Promise.all([manager.whenStarted("a"), manager.whenStarted("b"), manager.whenStarted("c")])

    // then - every node started while every sibling was still running: overlap, no serialization.
    expect(manager.starts).toEqual(["a", "b", "c"])
    expect(manager.recordOf("a")?.status).toBe("running")
    expect(manager.recordOf("b")?.status).toBe("running")
    expect(manager.recordOf("c")?.status).toBe("running")

    // cleanup - the run settles only once every node is terminal.
    manager.complete("a")
    manager.complete("b")
    manager.complete("c")
    const result = await running
    expect(result.status).toBe("completed")
  })

  test("#given a dependent with a disjoint scope #when its dependency settles #then it starts only after the dependency", async () => {
    // given - b depends on a; scopes do not overlap so only the dependency gates.
    const manager = new ConflictFakeManager()
    const { scheduler } = conflictFixture(
      definition([node("a", { writeScopes: ["x"] }), node("b", { dependsOn: ["a"], writeScopes: ["y"] })]),
      manager,
    )

    // when - a starts and stays running.
    const running = scheduler.run()
    await manager.whenStarted("a")

    // then - b has not started while a is still running.
    expect(manager.starts).toEqual(["a"])

    // when - a settles.
    manager.complete("a")
    await manager.whenStarted("b")

    // then - b started after a settled.
    expect(manager.starts).toEqual(["a", "b"])

    // cleanup.
    manager.complete("b")
    const result = await running
    expect(result.status).toBe("completed")
  })

  test("#given two same-scope roots submitted together #when the first is running #then the second waits and starts only after the first settles", async () => {
    // given - the adversarial shape: a and b declare the same scope, c is disjoint.
    const manager = new ConflictFakeManager()
    const { scheduler } = conflictFixture(
      definition([
        node("a", { writeScopes: ["db"] }),
        node("b", { writeScopes: ["db"] }),
        node("c", { writeScopes: ["cache"] }),
      ]),
      manager,
    )

    // when - the run admits the first pass.
    const running = scheduler.run()
    await Promise.all([manager.whenStarted("a"), manager.whenStarted("c")])

    // then - b is parked while a holds the scope: no overlap, no lost-edit window.
    expect(manager.starts).toEqual(["a", "c"])
    expect(manager.attempts).toEqual(["a", "c"])

    // when - the holder settles.
    manager.complete("a")
    await manager.whenStarted("b")
    await whenNodeState(scheduler, "b", "running")

    // then - b started after a settled, serialized on the journal clock.
    const snapshot = scheduler.snapshot()
    const a = snapshot.nodes.find((entry) => String(entry.id) === "a")
    const b = snapshot.nodes.find((entry) => String(entry.id) === "b")
    expect(a?.state).toBe("completed")
    expect(b?.state).toBe("running")
    expect(Date.parse(b?.startedAt ?? "")).toBeGreaterThanOrEqual(Date.parse(a?.completedAt ?? ""))

    // cleanup.
    manager.complete("b")
    manager.complete("c")
    const result = await running
    expect(result.status).toBe("completed")
  })

  test("#given the holder fails at start #when the conflicted sibling waits #then it is admitted next pass and the run ends failed, never hung", async () => {
    // given - the livelock guard shape: a fails before it ever holds the scope.
    const manager = new ConflictFakeManager()
    manager.failStarts.add("a")
    const { scheduler } = conflictFixture(
      definition([node("a", { writeScopes: ["db"] }), node("b", { writeScopes: ["db"] })]),
      manager,
    )

    // when - the run admits the first pass and a fails at start.
    const running = scheduler.run()
    await manager.whenStarted("b")

    // then - b was never attempted while a was unresolved, and runs once a is terminal.
    expect(manager.attempts).toEqual(["a", "b"])
    expect(manager.starts).toEqual(["b"])

    // cleanup - the run reports the start failure instead of hanging or throwing.
    manager.complete("b")
    const result = await running
    expect(result.status).toBe("failed")
  })

  test("#given a node without writeScopes #when compiled #then it defaults to empty and admits like today", async () => {
    // given - a scope-free root next to a scoped one.
    const manager = new ConflictFakeManager()
    const { scheduler } = conflictFixture(
      definition([node("plain"), node("scoped", { writeScopes: ["db"] })]),
      manager,
    )

    // when - the run admits the frontier.
    const running = scheduler.run()
    await Promise.all([manager.whenStarted("plain"), manager.whenStarted("scoped")])

    // then - the scope-free node was never parked by the conflict gate.
    expect(manager.starts).toEqual(["plain", "scoped"])

    // cleanup.
    manager.complete("plain")
    manager.complete("scoped")
    const result = await running
    expect(result.status).toBe("completed")
  })

  test("#given a scope-only amendment #when the definition changes #then the node fingerprint invalidates", () => {
    // given - two definitions differing only in writeScopes.
    const before = definition([node("a", { writeScopes: ["x"] })])
    const after = definition([node("a", { writeScopes: ["y"] })])
    const fingerprintOf = (input: DagDefinition): ReturnType<typeof dagDefinitionFingerprint> =>
      dagDefinitionFingerprint({
        name: input.key,
        scheduler: { waveAdmission: "dependency-frontier", failurePolicy: "continue-independent", dependencyData: "filesystem-only" },
        nodes: input.nodes.map((entry) => ({
          nodeId: entry.id,
          label: entry.id,
          dependsOn: [...(entry.dependsOn ?? [])],
          prompt: entry.prompt,
          route: { kind: "category", category: "quick" },
          writeScopes: [...(entry.writeScopes ?? [])],
          childName: entry.id,
        })),
      })

    // when - both are fingerprinted and diffed.
    const unchanged = diffNodeFingerprints(
      [{ nodeId: "a", label: "a", dependsOn: [], prompt: "do a", route: { kind: "category", category: "quick" }, writeScopes: ["x"], childName: "a" }],
      [{ nodeId: "a", label: "a", dependsOn: [], prompt: "do a", route: { kind: "category", category: "quick" }, writeScopes: ["x"], childName: "a" }],
    )
    const changed = diffNodeFingerprints(
      [{ nodeId: "a", label: "a", dependsOn: [], prompt: "do a", route: { kind: "category", category: "quick" }, writeScopes: ["x"], childName: "a" }],
      [{ nodeId: "a", label: "a", dependsOn: [], prompt: "do a", route: { kind: "category", category: "quick" }, writeScopes: ["y"], childName: "a" }],
    )

    // then - identical scopes reuse, changed scopes invalidate.
    expect(unchanged.changedIds).toEqual([])
    expect(changed.changedIds).toEqual(["a"])
    expect(fingerprintOf(before)).not.toBe(fingerprintOf(after))
  })
})
