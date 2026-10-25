// Conservative graph assist: the graph may only recommend MORE caution, never less.
// Harness mirrors scheduler-conflict.test.ts (FakeManager behavior) so admission semantics
// stay comparable across suites.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ManagerStartSpec, TaskManager } from "../manager/types"
import type { TaskRecord, TaskStatus } from "../state"
import { compileDag, type DagDefinition, type DagNodeInput } from "./graph"
import {
  applyGraphSerialization,
  isGraphSafeToParallelize,
  recommendExtraSerialization,
  recommendExtraVerification,
  recommendGraphAssist,
  withGraphAssistChecks,
  type GraphAssistNeighbor,
  type GraphImpactNeighborhood,
} from "./graph-assist"
import type { DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { createDagScheduler } from "./scheduler"
import { createDagFileStore, type DagFileStore } from "./store"
import type { DagNodeId, DagRunId } from "./types"
import {
  evaluateAcceptance,
  readRunVerificationRecords,
  selectVerificationChecks,
  type DagChangeScope,
  type DagVerifyCheck,
  type DagVerifyCommandResult,
  type DagVerifyRunner,
} from "./verification"

// See scheduler-frontier.test.ts: Bun honours a preload's setDefaultTimeout only for the first
// test file of a run.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

// SAFETY: test-only brands for fixed fixture ids; nothing at runtime inspects their shape.
const runId = "run-graph-assist" as DagRunId
const parentSessionId = "ses-graph-assist-parent"
const rootSessionId = "ses-graph-assist-root"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-graph-assist-"))
  cleanupRoots.push(directory)
  return directory
}

function neighbor(symbol: string, overrides: Partial<GraphAssistNeighbor> = {}): GraphAssistNeighbor {
  return { symbol, confidence: 1, resolved: true, ...overrides }
}

function neighborhood(overrides: Partial<GraphImpactNeighborhood> = {}): GraphImpactNeighborhood {
  return {
    changedSymbols: ["sym-a"],
    impactedBy: new Map([["sym-a", [neighbor("sym-a-out")]]]),
    unresolvedSymbols: [],
    ...overrides,
  }
}

function nodeId(id: string): DagNodeId {
  return id as DagNodeId
}

function symbols(entries: ReadonlyArray<readonly [string, readonly string[]]>): ReadonlyMap<DagNodeId, readonly string[]> {
  return new Map(entries.map(([id, syms]) => [nodeId(id), syms]))
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

function failResult(): DagVerifyCommandResult {
  return { started: true, exitCode: 1, timedOut: false, cancelled: false, output: "fail", outputBytes: 4, durationMs: 5, uncertainEffect: false }
}

function fakeRunner(results: ReadonlyMap<string, DagVerifyCommandResult>): DagVerifyRunner {
  return async (input) => {
    const result = results.get(input.check.checkId)
    if (result === undefined) throw new Error(`no fake result for ${input.check.checkId}`)
    return result
  }
}

function scopeNode(id: string, options: { readonly writeScopes?: readonly string[]; readonly verify?: readonly DagVerifyCheck[] } = {}): DagNodeInput {
  const entry: DagNodeInput = { id, prompt: `do ${id}`, category: "quick" }
  const withScopes = options.writeScopes === undefined ? entry : { ...entry, writeScopes: [...options.writeScopes] }
  if (options.verify === undefined) return withScopes
  return { ...withScopes, verify: [...options.verify] }
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "graph-assist-test", name: "graph assist test", nodes }
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

class GraphAssistFakeManager implements TaskManager {
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
    const id = String(owner.nodeId)
    this.#taskCounter += 1
    const taskId = `task-${this.#taskCounter}`
    const completion = deferred<TaskRecord>()
    this.#tasks.set(taskId, {
      record: {
        task_id: taskId,
        name: id,
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
    this.starts.push(id)
    this.#startedSignals.get(id)?.resolve()
    return { kind: "started", reused: false, task_id: taskId, status: "running", name: id }
  }

  findOwnedTask(): undefined { return undefined }
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

function assistFixture(
  input: DagDefinition,
  manager: GraphAssistFakeManager,
  options: {
    readonly runId?: DagRunId
    readonly store?: DagFileStore
    readonly runner?: DagVerifyRunner
    readonly projectDir?: string
    readonly verifyChecks?: readonly DagVerifyCheck[]
    readonly graphAssist?: Parameters<typeof createDagScheduler>[0]["graphAssist"]
  } = {},
) {
  const projectDir = options.projectDir ?? tempProject()
  const store = options.store ?? createDagFileStore({ project_dir: projectDir })
  const id = options.runId ?? runId
  const initialRecord = recordFor(input, id)
  store.writeCheckpoint(id, initialRecord)
  let eventTime = Date.parse("2026-10-22T00:00:02.000Z")
  const scheduler = createDagScheduler({
    store,
    taskManager: manager,
    initialRecord,
    now: () => eventTime++,
    ...(options.runner === undefined ? {} : { verifyRunner: options.runner }),
    verifyProjectDir: projectDir,
    ...(options.verifyChecks === undefined ? {} : { verifyChecks: options.verifyChecks }),
    ...(options.graphAssist === undefined ? {} : { graphAssist: options.graphAssist }),
  })
  return { scheduler, store, projectDir }
}

function changeScope(): DagChangeScope {
  return {
    changedFiles: ["src/a.ts"],
    touchesScheduler: true,
    touchesCompletionGate: false,
    touchesWorkerLifecycle: false,
    touchesPersistedState: false,
    isDocsOnly: false,
  }
}

describe("graph assist admission stays conservative", () => {
  test("#given a writeScopes conflict and a low-risk graph #when the run admits #then the conflict still serializes", async () => {
    // given - a and b share a scope; the graph claims their symbols are disjoint.
    const manager = new GraphAssistFakeManager()
    const { scheduler } = assistFixture(
      definition([scopeNode("a", { writeScopes: ["db"] }), scopeNode("b", { writeScopes: ["db"] })]),
      manager,
      {
        graphAssist: {
          neighborhood: neighborhood(),
          nodeSymbols: symbols([["a", ["sym-a"]], ["b", ["sym-x"]]]),
        },
      },
    )

    // when - the run admits the first pass.
    const running = scheduler.run()
    await manager.whenStarted("a")

    // then - the graph's low-risk claim released nothing: b waits for a.
    expect(manager.starts).toEqual(["a"])

    // when - the holder settles.
    manager.complete("a")
    await manager.whenStarted("b")

    // then - b serialized behind a and the run completes.
    expect(manager.starts).toEqual(["a", "b"])
    manager.complete("b")
    const result = await running
    expect(result.status).toBe("completed")
  })

  test("#given applyGraphSerialization #when merging #then parked nodes stay parked and admittable only shrinks", () => {
    // given - the base partition parked c on a writeScopes conflict.
    const admittable = [nodeId("a"), nodeId("b")]
    const conflicted = [nodeId("c")]

    // when - the graph holds back b (plus unknown ids the merge must ignore).
    const merged = applyGraphSerialization(admittable, conflicted, [nodeId("b"), nodeId("c"), nodeId("zzz")])

    // then - nothing was released: c stays parked, b joins it, unknown ids vanish.
    expect(merged.admittable).toEqual([nodeId("a")])
    expect(merged.conflicted).toEqual([nodeId("c"), nodeId("b")])
  })

  test("#given no graph extras #when merging #then the partition is the identical reference", () => {
    // given - the no-graph path through the scheduler.
    const admittable = [nodeId("a")]
    const conflicted = [nodeId("b")]

    // when - nothing extra is recommended.
    const merged = applyGraphSerialization(admittable, conflicted, [])

    // then - the merge is the identity, so admission reads exactly like today.
    expect(merged.admittable).toBe(admittable)
    expect(merged.conflicted).toBe(conflicted)
  })
})

describe("graph assist never declares safety from ignorance", () => {
  test("#given a missing graph #when asking if two tasks are safe #then the answer is never safe", () => {
    // given - no graph at all.
    // when/then - independence is refused, not assumed.
    expect(isGraphSafeToParallelize(["sym-a"], ["sym-b"], undefined)).toBe(false)
  })

  test("#given unresolved symbols #when they touch either side #then the pair is never safe", () => {
    // given - an unresolved dynamic touching one side.
    const uncertain = neighborhood({ unresolvedSymbols: ["dyn-1"] })

    // when/then - the pair stays serialized even though the static impact is disjoint.
    expect(isGraphSafeToParallelize(["sym-a"], ["dyn-1"], uncertain)).toBe(false)
    expect(isGraphSafeToParallelize(["dyn-1"], ["sym-a"], uncertain)).toBe(false)
  })

  test("#given a changed symbol with no neighborhood entry #when asking #then the pair is never safe", () => {
    // given - the graph knows sym-a but says nothing about sym-b.
    const partial = neighborhood()

    // when/then - unknown is not empty: safety is refused.
    expect(isGraphSafeToParallelize(["sym-a"], ["sym-b"], partial)).toBe(false)
  })

  test("#given a fully attributed disjoint graph #when asking #then safety can be proven", () => {
    // given - both sides fully mapped with disjoint resolved closures.
    const proven = neighborhood({
      changedSymbols: ["sym-a"],
      impactedBy: new Map([
        ["sym-a", []],
        ["sym-x", []],
      ]),
    })

    // when/then - affirmative proof clears the pair (the predicate is not vacuous).
    expect(isGraphSafeToParallelize(["sym-a"], ["sym-x"], proven)).toBe(true)
    expect(isGraphSafeToParallelize(["sym-a"], ["sym-a"], proven)).toBe(false)
  })

  test("#given a low-confidence edge #when asking #then the pair is never safe", () => {
    // given - an edge at the 0.50 promotion-style gate (never proven).
    const weak = neighborhood({
      changedSymbols: ["sym-a"],
      impactedBy: new Map([["sym-a", [neighbor("sym-shared", { confidence: 0.5 })]], ["sym-x", [neighbor("sym-shared", { confidence: 1 })]]]),
    })

    // when/then - capped confidence cannot prove independence.
    expect(isGraphSafeToParallelize(["sym-a"], ["sym-x"], weak)).toBe(false)
  })

  test("#given a missing graph #when recommending serialization #then the frontier serializes past the first node", async () => {
    // given - three disjoint-scope roots with no graph at all.
    const manager = new GraphAssistFakeManager()
    const { scheduler } = assistFixture(
      definition([
        scopeNode("a", { writeScopes: ["x"] }),
        scopeNode("b", { writeScopes: ["y"] }),
        scopeNode("c", { writeScopes: ["z"] }),
      ]),
      manager,
      { graphAssist: {} },
    )

    // when - the run admits.
    const running = scheduler.run()
    await manager.whenStarted("a")

    // then - ignorance serializes: only the first node runs.
    expect(manager.starts).toEqual(["a"])

    // when - each holder settles in turn.
    manager.complete("a")
    await manager.whenStarted("b")
    expect(manager.starts).toEqual(["a", "b"])
    manager.complete("b")
    await manager.whenStarted("c")

    // then - the run still completes, strictly serialized.
    manager.complete("c")
    const result = await running
    expect(result.status).toBe("completed")
    expect(manager.starts).toEqual(["a", "b", "c"])
  })

  test("#given pure recommendExtraSerialization #when the graph is missing or unresolved #then holdbacks are non-empty", () => {
    // given - two admittable nodes.
    const admittable = [nodeId("a"), nodeId("b")]
    const nodeSyms = symbols([["a", ["sym-a"]], ["b", ["sym-b"]]])

    // when - the graph is missing.
    const missing = recommendExtraSerialization({ admittable, nodeSymbols: nodeSyms, neighborhood: undefined })

    // then - caution is recommended, never clearance.
    expect(missing.extraSerialized).toEqual([nodeId("b")])

    // when - the graph reports unresolved dynamics.
    const unresolved = recommendExtraSerialization({
      admittable,
      nodeSymbols: nodeSyms,
      neighborhood: neighborhood({
        changedSymbols: ["sym-a"],
        impactedBy: new Map([["sym-a", []]]),
        unresolvedSymbols: ["dyn-1"],
      }),
    })

    // then - the risky node is held back.
    expect(unresolved.extraSerialized).toEqual([nodeId("b")])
  })
})

describe("graph assist verification stays fail-closed", () => {
  test("#given required checks and a low-risk graph #when merging #then every required check still runs", () => {
    // given - the base plan plus a low-risk graph recommending nothing.
    const scope = changeScope()
    const available = [check(), check({ checkId: "typecheck", category: "typecheck", command: ["bun", "run", "typecheck"] })]
    const base = selectVerificationChecks(scope, available)
    const lowRisk = recommendExtraVerification({
      neighborhood: neighborhood({
        changedSymbols: ["sym-a"],
        impactedBy: new Map([["sym-a", []]]),
      }),
      nodeSymbols: symbols([["a", ["sym-elsewhere"]]]),
      admittable: [nodeId("a")],
      available: [],
    })

    // when - the assist merges behind the base plan.
    const merged = withGraphAssistChecks(base.required, lowRisk.extraChecks)

    // then - nothing required was dropped and nothing spurious was added.
    expect(lowRisk.extraChecks).toEqual([])
    expect(merged.map((entry) => entry.checkId)).toEqual(base.required.map((entry) => entry.checkId))
  })

  test("#given a missing record and a low-risk graph #when the gate reads #then acceptance still blocks", () => {
    // given - a mandatory requirement with no evidence, plus a low-risk graph.
    const required = [check()]
    const lowRisk = recommendExtraVerification({
      neighborhood: neighborhood({ changedSymbols: ["sym-a"], impactedBy: new Map([["sym-a", []]]) }),
      available: [],
    })
    const merged = withGraphAssistChecks(required, lowRisk.extraChecks)
    const current = { sourceRevision: "rev", nodeFingerprints: new Map(), generation: 1 }

    // when - both gates read.
    const withoutGraph = evaluateAcceptance({ requirements: required.map((entry) => ({ check: entry })), records: new Map(), current, latestAttempts: new Map() })
    const withGraph = evaluateAcceptance({ requirements: merged.map((entry) => ({ check: entry })), records: new Map(), current, latestAttempts: new Map() })

    // then - both block on the missing record.
    expect(withoutGraph.accepted).toBe(false)
    expect(withGraph.accepted).toBe(false)
    expect(withGraph.reasons).toEqual(withoutGraph.reasons)
  })

  test("#given declared checks but no runner and a low-risk graph #when the run settles #then the node still fails closed", async () => {
    // given - a required node check with no runner, plus a low-risk graph.
    const manager = new GraphAssistFakeManager()
    const { scheduler } = assistFixture(
      definition([scopeNode("a", { verify: [check()] })]),
      manager,
      {
        graphAssist: {
          neighborhood: neighborhood({ changedSymbols: ["sym-a"], impactedBy: new Map([["sym-a", []]]) }),
          nodeSymbols: symbols([["a", ["sym-elsewhere"]]]),
          candidateChecks: [check({ checkId: "regression-extra", category: "regression", command: ["bun", "test", "extra"] })],
        },
      },
    )

    // when - the run settles.
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running

    // then - the graph predicted low risk but the node still fails instead of completing unverified.
    const node = result.nodes.find((entry) => String(entry.id) === "a")
    expect(node?.state).toBe("failed")
    expect(node?.error?.code).toBe("verification_failed")
    expect(result.status).toBe("failed")
  })

  test("#given a risky graph and a failing extra check #when the run settles #then the extra check fails the run", async () => {
    // given - a clean base plan plus a risky graph recommending one more check that fails.
    const extra = check({ checkId: "regression-extra", category: "regression", command: ["bun", "test", "extra"] })
    const manager = new GraphAssistFakeManager()
    const { scheduler, store } = assistFixture(
      definition([scopeNode("a")]),
      manager,
      {
        runner: fakeRunner(new Map([["regression-extra", failResult()]])),
        verifyChecks: [],
        graphAssist: {
          neighborhood: neighborhood(),
          nodeSymbols: symbols([["a", ["sym-a"]]]),
          candidateChecks: [extra],
        },
      },
    )

    // when - the run settles.
    const running = scheduler.run()
    await manager.whenStarted("a")
    manager.complete("a")
    const result = await running

    // then - the node completed but the appended check failed the run at the gate.
    expect(result.nodes.find((entry) => String(entry.id) === "a")?.state).toBe("completed")
    expect(result.status).toBe("failed")
    const collected = readRunVerificationRecords(store, runId)
    expect(collected.records.get("regression-extra")?.status).toBe("failed")
  })

  test("#given the same run with and without a low-risk graph #when both settle #then the mandatory gate reads byte-identical requirements", async () => {
    // given - two identical single-node runs, one with a low-risk graph.
    const lowRiskAssist = {
      neighborhood: neighborhood({ changedSymbols: [], impactedBy: new Map() }),
      nodeSymbols: symbols([["a", ["sym-a"]]]),
      candidateChecks: [check({ checkId: "regression-extra", category: "regression", command: ["bun", "test", "extra"] })],
    } as const
    const digest = (record: DagRunRecordV1): string =>
      JSON.stringify({
        status: record.status,
        nodes: record.nodes.map((entry) => ({ id: String(entry.id), state: entry.state })),
      })

    const firstManager = new GraphAssistFakeManager()
    const first = assistFixture(definition([scopeNode("a")]), firstManager, { runId: "run-graph-base" as DagRunId })
    const firstRunning = first.scheduler.run()
    await firstManager.whenStarted("a")
    firstManager.complete("a")
    const firstResult = await firstRunning

    const secondManager = new GraphAssistFakeManager()
    const second = assistFixture(definition([scopeNode("a")]), secondManager, {
      runId: "run-graph-assisted" as DagRunId,
      graphAssist: { ...lowRiskAssist },
    })
    const secondRunning = second.scheduler.run()
    await secondManager.whenStarted("a")
    secondManager.complete("a")
    const secondResult = await secondRunning

    // then - the low-risk graph changed nothing observable about the gate.
    expect(secondResult.status).toBe("completed")
    expect(digest(secondResult)).toBe(digest(firstResult))
  })
})

describe("graph assist hook shape", () => {
  test("#given the single hook #when the graph is missing #then it recommends serialization and checks together", () => {
    // given - a missing graph over two admittable nodes.
    const admittable = [nodeId("a"), nodeId("b")]

    // when - the single hook runs.
    const recommendation = recommendGraphAssist({
      neighborhood: undefined,
      admittable,
      nodeSymbols: symbols([["a", ["sym-a"]], ["b", ["sym-b"]]]),
      availableChecks: [check()],
    })

    // then - both caution channels fire at once.
    expect(recommendation.extraSerialized).toEqual([nodeId("b")])
    expect(recommendation.extraChecks.map((entry) => entry.checkId)).toEqual(["unit-core"])
    expect(recommendation.reasons.length).toBeGreaterThan(0)
  })

  test("#given withGraphAssistChecks #when extras duplicate base #then base order and identity survive", () => {
    // given - a base plan and overlapping extras.
    const base = [check(), check({ checkId: "typecheck", category: "typecheck", command: ["bun", "run", "typecheck"] })]

    // when - extras repeat a base check and add one.
    const merged = withGraphAssistChecks(base, [
      check({ checkId: "typecheck", category: "typecheck", command: ["bun", "run", "typecheck"] }),
      check({ checkId: "regression-extra", category: "regression", command: ["bun", "test", "extra"] }),
    ])

    // then - the base prefix is untouched and the new check joins once.
    expect(merged[0]).toBe(base[0])
    expect(merged[1]).toBe(base[1])
    expect(merged.map((entry) => entry.checkId)).toEqual(["unit-core", "typecheck", "regression-extra"])
  })
})
