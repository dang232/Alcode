import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagedChildListener } from "../../manager/child-handle"
import type { ManagerStartSpec, TaskManager } from "../../manager/types"
import type { TaskRecord, TaskStatus } from "../../state"
import type { SendInput, SendOutcome } from "../../steering"
import { compileDag, type DagDefinition } from "../graph"
import type { DagRunRecordV1 } from "../manager"
import type { DagTaskOwner, OwnedStartResult } from "../owner"
import { createDagScheduler } from "../scheduler"
import type { DagFileStore } from "../store"
import { createDagFileStore } from "../store"
import type { DagRunId } from "../types"
import type { DagVerifyCheck, DagVerifyRunnerInput } from "../verification"
import { derivePlanHints, applyPlanHints } from "./plan-evidence"
import { buildTaskUnderstanding } from "./understanding"
import type { TaskUnderstanding, TaskUnderstandingInput } from "./types"

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// SAFETY: DagRunId is a branded string with no runtime representation; the fixture id is a literal.
const runId = "run-intel" as DagRunId
const parentSessionId = "ses-intel-parent"
const rootSessionId = "ses-intel-root"
const at = "2026-10-23T00:00:00.000Z"
const revision = "a".repeat(40)

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-intel-"))
  roots.push(directory)
  return directory
}

type Start = { readonly spec: ManagerStartSpec; readonly completedAtStart: readonly string[] }

class CaptureManager implements TaskManager {
  readonly starts: Start[] = []
  readonly completed: string[] = []
  readonly #autoComplete: boolean
  readonly #tasks = new Map<string, { record: TaskRecord; readonly done: ReturnType<typeof deferred<TaskRecord>> }>()
  readonly #started = new Map<string, ReturnType<typeof deferred<void>>>()
  #counter = 0

  constructor(autoComplete: boolean) {
    this.#autoComplete = autoComplete
  }

  start(): never { throw new Error("unused") }
  continueTask(): never { throw new Error("unused") }
  sendToTask(_input: SendInput): Promise<SendOutcome> { return Promise.reject(new Error("unused")) }
  interruptTask(): never { throw new Error("unused") }
  cancelTask(): never { throw new Error("unused") }
  list(): readonly [] { return [] }
  forget(): void {}
  getResidentHandle(): undefined { return undefined }
  residentTaskIds(): readonly string[] { return [] }
  promoteToBackground(): boolean { return false }
  wasBackground(): boolean { return true }
  residencyChanged(): Promise<void> { return new Promise<void>(() => undefined) }
  subscribeChild(_taskId: string, _listener: ManagedChildListener): () => void { return () => undefined }

  whenStarted(nodeId: string): Promise<void> {
    let signal = this.#started.get(nodeId)
    if (signal === undefined) {
      signal = deferred<void>()
      this.#started.set(nodeId, signal)
    }
    if (this.starts.some((entry) => entry.spec.name === nodeId)) signal.resolve()
    return signal.promise
  }

  complete(nodeId: string): void {
    const entry = [...this.#tasks.values()].find((task) => task.record.name === nodeId)
    if (entry === undefined) throw new Error(`unknown fake task ${nodeId}`)
    entry.record = { ...entry.record, status: "completed", updated_at: at, final_response: `done ${nodeId}` }
    this.completed.push(nodeId)
    entry.done.resolve(entry.record)
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return [...this.#tasks.values()].find((task) => task.record.owner?.nodeId === owner.nodeId)?.record
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const entry = this.#tasks.get(taskId)
    if (entry === undefined) throw new Error(`unknown fake task ${taskId}`)
    return entry.done.promise
  }

  startOwned(spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    this.starts.push({ spec, completedAtStart: [...this.completed] })
    this.#counter += 1
    const taskId = `task-${this.#counter}`
    const done = deferred<TaskRecord>()
    const record: TaskRecord = {
      task_id: taskId,
      name: spec.name ?? taskId,
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
      created_at: at,
      updated_at: at,
      notification: { run_epoch: 1, notified_epoch: 0 },
    }
    this.#tasks.set(taskId, { record, done })
    this.#started.get(String(owner.nodeId))?.resolve()
    if (this.#autoComplete) queueMicrotask(() => this.complete(String(owner.nodeId)))
    return Promise.resolve({ kind: "started", reused: false, task_id: taskId, status: "running", name: String(owner.nodeId) })
  }
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "intel-test", name: "intel test", nodes }
}

function recordFor(input: DagDefinition): DagRunRecordV1 {
  const compiled = compileDag(input, { at })
  if (!compiled.ok) throw new Error("fixture DAG did not compile")
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId,
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
    createdAt: at,
    updatedAt: at,
    nodes: compiled.nodes,
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
  }
}

type FixtureOptions = {
  readonly intelligence?: { readonly understanding: TaskUnderstanding; readonly candidateChecks?: readonly DagVerifyCheck[] }
  readonly verifyChecks?: readonly DagVerifyCheck[]
  readonly verifyRunner?: (input: DagVerifyRunnerInput) => Promise<{
    started: boolean
    exitCode?: number
    timedOut: boolean
    cancelled: boolean
    output: string
    outputBytes: number
    durationMs: number
    uncertainEffect: boolean
  }>
  readonly verifyProjectDir?: string
}

function fixture(input: DagDefinition, manager: CaptureManager, options: FixtureOptions = {}) {
  const base = createDagFileStore({ project_dir: tempProject() })
  const store: DagFileStore = base
  const initialRecord = recordFor(input)
  store.writeCheckpoint(runId, initialRecord)
  let clock = Date.parse(at)
  const scheduler = createDagScheduler({
    store,
    taskManager: manager,
    initialRecord,
    intelligence: options.intelligence,
    verifyChecks: options.verifyChecks,
    verifyRunner: options.verifyRunner,
    verifyProjectDir: options.verifyProjectDir,
    now: () => clock++,
  })
  return { scheduler, store }
}

function envelope(projectId = "proj-a", rev = revision) {
  return {
    projectId,
    worktreeId: "wt-main",
    revision: rev,
    fingerprint: "f".repeat(64),
    freshness: "fresh" as const,
    coverage: "indexed" as const,
    truncated: false,
    items: [],
  }
}

function understandingInput(overrides: Partial<TaskUnderstandingInput> = {}): TaskUnderstandingInput {
  return {
    scope: { projectId: "proj-a", worktreeId: "wt-main", revision, fingerprint: "f".repeat(64) },
    queries: {
      symbolContext: {
        ...envelope(),
        items: [],
        definition: { id: "fn:add@math.ts", file: "math.ts", line: 3, name: "add", confidence: 1, knowledgeIds: ["pk-math"] },
        callers: [{ id: "fn:sum@app.ts", file: "app.ts", line: 9, name: "sum", confidence: 1, knowledgeIds: [] }],
        callees: [],
      },
      impact: {
        ...envelope(),
        items: [],
        subject: { id: "fn:add@math.ts", file: "math.ts", line: 3, confidence: 1, knowledgeIds: [] },
        impacted: [{ id: "fn:sum@app.ts", file: "app.ts", line: 9, confidence: 1, knowledgeIds: [] }],
      },
      findTests: {
        ...envelope(),
        items: [],
        subjectFile: "math.ts",
        candidates: [{ id: "test:math.test.ts", file: "math.test.ts", line: 1, confidence: 1, knowledgeIds: [] }],
      },
      detectChanges: { ...envelope(), items: [], changes: [] },
      search: { ...envelope(), items: [] },
      trace: { ...envelope(), items: [] },
    },
    knowledge: [
      {
        id: "pk-math",
        claim: "add() must stay pure: callers depend on it not mutating arguments.",
        category: "source-verified",
        sourceFile: "math.ts",
        sourceRevision: revision,
        validatedAt: at,
      },
    ],
    ...overrides,
  }
}

const mathNode = { id: "math", prompt: "Update add() in math.ts to reject non-finite input.", category: "quick", writeScopes: ["math.ts"] } as const
const gatewayNode = { id: "gateway", prompt: "Update retry() in gateway.ts to cap attempts.", category: "quick", writeScopes: ["gateway.ts"] } as const

describe("DAG scheduler intelligence", () => {
  test("#given intelligence #when two unrelated nodes admit #then each worker receives only its own bounded evidence", async () => {
    const manager = new CaptureManager(true)
    const understanding = buildTaskUnderstanding(understandingInput())
    const { scheduler } = fixture(definition([mathNode, gatewayNode]), manager, {
      intelligence: { understanding },
      verifyProjectDir: tempProject(),
    })

    const result = await scheduler.run()

    expect(result.status).toBe("completed")
    const math = manager.starts.find((entry) => entry.spec.name === "math")?.spec.prompt ?? ""
    const gateway = manager.starts.find((entry) => entry.spec.name === "gateway")?.spec.prompt ?? ""
    expect(math).toContain("[fn:add@math.ts] math.ts:3")
    expect(math).toContain("[test:math.test.ts] math.test.ts:1")
    expect(math).toContain("pk-math")
    expect(math).not.toContain("gateway.ts")
    expect(gateway).not.toContain("math.ts")
    expect(math.startsWith("Update add() in math.ts")).toBe(true)
    expect(math.includes("Node evidence (untrusted code-graph and memory")).toBe(true)
  })

  test("#given no intelligence #when the same DAG runs #then every worker prompt is the untouched effective prompt", async () => {
    const manager = new CaptureManager(true)
    const { scheduler } = fixture(definition([mathNode, gatewayNode]), manager)

    const result = await scheduler.run()

    expect(result.status).toBe("completed")
    expect(manager.starts.map((entry) => entry.spec.prompt)).toEqual([mathNode.prompt, gatewayNode.prompt])
  })

  test("#given exactly one start per node #when a two-node run completes #then no node is spawned twice", async () => {
    const manager = new CaptureManager(true)
    const understanding = buildTaskUnderstanding(understandingInput())
    const { scheduler } = fixture(definition([mathNode, gatewayNode]), manager, { intelligence: { understanding } })

    await scheduler.run()

    expect(manager.starts.map((entry) => entry.spec.name).sort()).toEqual(["gateway", "math"])
  })

  test("#given disjoint explicit scopes #when both nodes are ready #then both are admitted without waiting for a completion", async () => {
    const manager = new CaptureManager(false)
    const understanding = buildTaskUnderstanding(understandingInput())
    const { scheduler } = fixture(definition([mathNode, gatewayNode]), manager, { intelligence: { understanding } })

    const running = scheduler.run()
    await Promise.all([manager.whenStarted("math"), manager.whenStarted("gateway")])
    expect(manager.completed).toEqual([])
    manager.complete("math")
    manager.complete("gateway")
    const result = await running
    expect(result.status).toBe("completed")
  })

  test("#given intelligence without change evidence #when two ready nodes admit #then the frontier serializes instead of clearing", async () => {
    const manager = new CaptureManager(false)
    const missingChanges = understandingInput()
    const { detectChanges: _dropped, ...queries } = missingChanges.queries ?? {}
    const understanding = buildTaskUnderstanding({ ...missingChanges, queries })
    expect(understanding.usableForCaution).toBe(true)
    const { scheduler } = fixture(definition([mathNode, gatewayNode]), manager, { intelligence: { understanding } })

    const running = scheduler.run()
    await manager.whenStarted("math")
    expect(manager.completed).toEqual([])
    manager.complete("math")
    await manager.whenStarted("gateway")
    expect(manager.starts.find((entry) => entry.spec.name === "gateway")?.completedAtStart).toEqual(["math"])
    manager.complete("gateway")
    expect((await running).status).toBe("completed")
  })

  test("#given two nodes derived onto one shared file #when the plan hints are applied #then the second node waits for the first to complete", async () => {
    const manager = new CaptureManager(false)
    const shared = { nodeId: "one", prompt: "Edit add() in math.ts." } as const
    const sharedTwo = { nodeId: "two", prompt: "Edit add() tests in math.ts." } as const
    const understanding = buildTaskUnderstanding(understandingInput())
    const hints = derivePlanHints(understanding, [shared, sharedTwo])
    expect(hints.writeScopes.get("one")).toEqual(["math.ts"])
    expect(hints.writeScopes.get("two")).toEqual(["math.ts"])
    const planned = applyPlanHints(definition([{ ...shared, id: "one", category: "quick" }, { ...sharedTwo, id: "two", category: "quick" }]), hints)
    const { scheduler } = fixture(planned, manager)

    const running = scheduler.run()
    await manager.whenStarted("one")
    expect(manager.completed).toEqual([])
    manager.complete("one")
    await manager.whenStarted("two")
    const two = manager.starts.find((entry) => entry.spec.name === "two")
    expect(two?.completedAtStart).toEqual(["one"])
    manager.complete("two")
    expect((await running).status).toBe("completed")
  })

  test("#given a dependent verification node #when its prerequisite is running #then it starts only after completion", async () => {
    const manager = new CaptureManager(false)
    const build = { id: "build", prompt: "Change add() in math.ts.", category: "quick" } as const
    const verify = { id: "verify", prompt: "Run the math checks.", category: "quick", dependsOn: ["build"] } as const
    const { scheduler } = fixture(definition([build, verify]), manager)

    const running = scheduler.run()
    await manager.whenStarted("build")
    manager.complete("build")
    await manager.whenStarted("verify")
    expect(manager.starts.find((entry) => entry.spec.name === "verify")?.completedAtStart).toEqual(["build"])
    manager.complete("verify")
    expect((await running).status).toBe("completed")
  })

  test("#given intelligence candidate checks #when the run gate reads requirements #then those checks execute behind the base plan", async () => {
    const manager = new CaptureManager(true)
    const understanding = buildTaskUnderstanding(understandingInput())
    const baseCheck: DagVerifyCheck = { checkId: "typecheck", category: "typecheck", command: ["bun", "run", "typecheck"], timeoutMs: 1000, criteria: ["types"] }
    const impactCheck: DagVerifyCheck = { checkId: "math-tests", category: "unit", command: ["bun", "test", "math.test.ts"], timeoutMs: 1000, criteria: ["add"], coveredPaths: ["math.ts"] }
    const executed: string[] = []
    const { scheduler } = fixture(definition([mathNode]), manager, {
      intelligence: { understanding, candidateChecks: [impactCheck] },
      verifyChecks: [baseCheck],
      verifyProjectDir: tempProject(),
      verifyRunner: (input) => {
        executed.push(input.check.checkId)
        return Promise.resolve({ started: true, exitCode: 0, timedOut: false, cancelled: false, output: "ok", outputBytes: 2, durationMs: 1, uncertainEffect: false })
      },
    })

    const result = await scheduler.run()

    expect(result.status).toBe("completed")
    expect(executed.sort()).toEqual(["math-tests", "typecheck"])
  })
})
