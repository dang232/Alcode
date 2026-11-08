// allow: SIZE_OK - one integrated suite drives runEngineeringDelegation through the real DAG
// manager, scheduler, journal, wait surface, and file store so the delegation seam is proven
// against engine state instead of a hand-written double.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "../../../omo-config-core/src/index.ts"

import { createDagWaitSurface, type DagRunResult } from "../dag/handle"
import { createDagManager, type DagManager, type DagRunRecordV1 } from "../dag/manager"
import { createDagScheduler, type DagScheduler } from "../dag/scheduler"
import { createDagFileStore, type DagFileStore } from "../dag/store"
import type { DagNodeId, DagNodeState, DagRunEvent, DagRunId } from "../dag/types"
import type { ManagedChildHandle } from "../manager/child-handle"
import { createTaskManager } from "../manager/manager"
import type { ChildPlanner, ManagedRunner, ManagedStartSpec } from "../manager/types"
import type { RunnerOutcome } from "../runners/in-process/child-handle"
import { createTaskRecordStore } from "../store"

import { collectDelegationResults, delegationNodeId, type RoleSpec } from "./plan"
import {
  runEngineeringDelegation,
  type EngineeringDelegationRunCompletion,
  type EngineeringDelegationRunRequest,
  type EngineeringDelegationRunResult,
} from "./run"

// bunfig preloads a timeout floor only for the first test file of a run; later files silently fall
// back to 5000ms. This suite writes real checkpoints through an fsync-backed store on Windows.
setDefaultTimeout(process.platform === "win32" ? 30_000 : 10_000)

const PARENT_SESSION_ID = "session-delegation-run-parent"
const ROOT_SESSION_ID = "session-delegation-run-root"
const OBJECTIVE = "Fix the failing parser test without changing public behavior."

const INVESTIGATE = delegationNodeId("investigate")
const REVIEW = delegationNodeId("review")
const VERIFY = delegationNodeId("verify")

// review -> investigate is the plan's default edge; verify's default edge names implement, which is
// absent here, so the request adds an explicit review dependency to build the full chain.
const ROLES = [
  { key: "investigate", assignment: "Locate the failing assertion and the parser paths it exercises." },
  { key: "review", assignment: "Review the investigation for missed risks and wrong assumptions." },
  { key: "verify", assignment: "Run the parser test and report the observed output.", dependsOn: ["review"] },
] satisfies readonly RoleSpec[]

const CLEANUP_ROOTS: string[] = []

afterEach(() => {
  for (const root of CLEANUP_ROOTS.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
    expect(fs.existsSync(root)).toBe(false)
  }
})

function completedOutcome(nodeId: string): RunnerOutcome {
  return { status: "completed", finalResponse: `${nodeId} small text result` }
}

function failedOutcome(nodeId: string): RunnerOutcome {
  return {
    status: "error",
    killed: false,
    failure: { kind: "child-prompt-failed", message: `failure:${nodeId}` },
  }
}

// The same in-package ChildPlanner shape src/dag/e2e-failure.test.ts uses: resolve every route to a
// scripted model and keep the declared category or agent type. This proves plan resolution only; the
// runner below supplies the controllable outcome.
function stubPlanner(spec: Parameters<ChildPlanner>[0]): ReturnType<ChildPlanner> {
  const target = spec.category ?? spec.subagent_type ?? "default"
  const plan = { model: spec.model ?? `scripted/${target}` }
  if (spec.category !== undefined) {
    return { kind: "resolved", plan: { ...plan, category: spec.category } }
  }
  if (spec.subagent_type !== undefined) {
    return { kind: "resolved", plan: { ...plan, agentType: spec.subagent_type } }
  }
  return { kind: "resolved", plan }
}

// The rendered delegation prompt names its node on a line of its own. The managed start spec does
// not carry the scheduler's node id, so the stub reads the plan's rendered identity from the prompt.
const NODE_ID_LINE = /^Node: (\S+)$/m

function nodeIdOf(spec: ManagedStartSpec): string {
  const match = NODE_ID_LINE.exec(spec.prompt)
  return match?.[1] ?? spec.taskId
}

// A stub child runner: each node id maps to a scripted RunnerOutcome. The manager, scheduler,
// journal, node records, and dependency frontier around it are the real engine.
class StubOutcomeRunner implements ManagedRunner {
  readonly startedNodeIds: string[] = []
  readonly #outcomes: ReadonlyMap<string, RunnerOutcome>

  constructor(outcomes: ReadonlyMap<string, RunnerOutcome>) {
    this.#outcomes = outcomes
  }

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const nodeId = nodeIdOf(spec)
    this.startedNodeIds.push(nodeId)
    const outcome = this.#outcomes.get(nodeId) ?? completedOutcome(nodeId)
    return Promise.resolve({
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome: () => Promise.resolve(outcome),
      lastAssistantText: () => outcome.status === "completed" ? outcome.finalResponse : undefined,
      dispose: () => Promise.resolve(),
    })
  }
}

type IntegrationFixture = {
  readonly project: string
  readonly store: DagFileStore
  readonly manager: DagManager
  readonly runner: StubOutcomeRunner
  readonly wait: (runId: DagRunId) => Promise<DagRunResult>
}

function createFixture(outcomes: ReadonlyMap<string, RunnerOutcome> = new Map()): IntegrationFixture {
  const project = fs.mkdtempSync(join(tmpdir(), "senpi-delegation-run-"))
  CLEANUP_ROOTS.push(project)
  const store = createDagFileStore({ project_dir: project })
  const runner = new StubOutcomeRunner(outcomes)
  const taskManager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": runner, process: runner },
    planner: stubPlanner,
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 16, max_depth: 1 }),
    cwd: project,
  })
  const manager = createDagManager({ store })
  const schedulers = new Map<DagRunId, DagScheduler>()
  const runStarted = new Map<DagRunId, Promise<DagRunRecordV1>>()
  const waitSurface = createDagWaitSurface({
    store,
    subscribe: (runId, listener) => {
      const scheduler = schedulers.get(runId)
      if (scheduler === undefined) throw new Error(`missing scheduler for dag run ${runId}`)
      return scheduler.subscribe(listener)
    },
  })

  return {
    project,
    store,
    manager,
    runner,
    // runEngineeringDelegation owns manager.start, so the run id only exists once it calls back into
    // this wait. Starting the real scheduler here is the host runtime's kickoff, not a replacement
    // for the engine: the scheduler, journal, wait surface, and store all stay real.
    async wait(runId) {
      if (!schedulers.has(runId)) {
        const scheduler = createDagScheduler({
          store,
          taskManager,
          initialRecord: manager.record(runId, PARENT_SESSION_ID),
        })
        schedulers.set(runId, scheduler)
        runStarted.set(runId, scheduler.run())
      }
      const result = await waitSurface.wait(runId, PARENT_SESSION_ID)
      await runStarted.get(runId)
      return result
    },
  }
}

function delegationRequest(project: string): EngineeringDelegationRunRequest {
  return {
    objective: OBJECTIVE,
    workingDirectory: project,
    roles: ROLES,
    parentSessionId: PARENT_SESSION_ID,
    rootSessionId: ROOT_SESSION_ID,
  }
}

function completionOf(result: EngineeringDelegationRunResult): EngineeringDelegationRunCompletion {
  if (!result.ok) throw new Error(`expected a run completion, received ${result.rejection.code}`)
  return result
}

function nodeState(record: DagRunRecordV1, nodeId: DagNodeId): DagNodeState {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`missing node ${nodeId}`)
  return node.state
}

function nodeOutputBytes(record: DagRunRecordV1, nodeId: DagNodeId): number {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`missing node ${nodeId}`)
  return node.outputBytes ?? 0
}

function completedSeq(events: readonly DagRunEvent[], nodeId: DagNodeId): number {
  for (const event of events) {
    if (event.type !== "dag.node.transitioned") continue
    if (event.nodeId === nodeId && event.to === "completed") return event.seq
  }
  throw new Error(`missing completed transition for ${nodeId}`)
}

function firstStartSeq(events: readonly DagRunEvent[], nodeId: DagNodeId): number {
  const seqs: number[] = []
  for (const event of events) {
    if (event.type !== "dag.node.transitioned" || event.nodeId !== nodeId) continue
    if (event.to === "scheduled" || event.to === "running") seqs.push(event.seq)
  }
  if (seqs.length === 0) throw new Error(`missing start transition for ${nodeId}`)
  return Math.min(...seqs)
}

const OUTCOME_KEYS = ["nodeId", "outcome", "outputBytes", "role", "state"]

function expectNoVerdict(completion: EngineeringDelegationRunCompletion): void {
  expect(Object.keys(completion).sort()).toEqual([
    "deadlineCancellation",
    "deadlineExceeded",
    "ok",
    "outcomes",
    "runId",
    "unresolved",
  ])
  for (const forbidden of ["accepted", "success", "verdict", "verified"]) {
    expect(forbidden in completion).toBe(false)
  }
  for (const outcome of completion.outcomes) {
    expect(Object.keys(outcome).sort()).toEqual(OUTCOME_KEYS)
    for (const forbidden of ["accepted", "success", "verdict", "verified"]) {
      expect(forbidden in outcome).toBe(false)
    }
  }
}

describe("runEngineeringDelegation over the real DAG manager", () => {
  test("#given a three-role plan #when the real engine settles #then every node completes in dependency order and only node observations are returned", async () => {
    // given
    const fixture = createFixture()

    // when
    const result = await runEngineeringDelegation(
      { dagManager: fixture.manager, wait: fixture.wait },
      delegationRequest(fixture.project),
    )

    // then
    const completion = completionOf(result)
    expect(fixture.runner.startedNodeIds).toEqual([INVESTIGATE, REVIEW, VERIFY])
    expect(completion.unresolved).toBe(false)
    expect(completion.deadlineExceeded).toBe(false)
    expect(completion.deadlineCancellation).toBe("not_needed")

    // The run id exists in the manager's listing and its durable run record is on disk.
    const listed = fixture.manager.list(PARENT_SESSION_ID)
    expect(listed.map((summary) => summary.runId)).toContain(completion.runId)
    expect(fs.existsSync(fixture.store.paths.run(completion.runId))).toBe(true)

    const record = fixture.manager.record(completion.runId, PARENT_SESSION_ID)
    expect(record.status).toBe("completed")
    expect(nodeState(record, INVESTIGATE)).toBe("completed")
    expect(nodeState(record, REVIEW)).toBe("completed")
    expect(nodeState(record, VERIFY)).toBe("completed")
    for (const nodeId of [INVESTIGATE, REVIEW, VERIFY]) {
      expect(nodeOutputBytes(record, nodeId)).toBeGreaterThan(0)
    }

    // Dependency ordering comes from the real frontier: a dependent's first start is journaled after
    // its dependency's completed transition.
    const events = fixture.manager.history({
      runId: completion.runId,
      parentSessionId: PARENT_SESSION_ID,
      limit: 256,
    }).events
    expect(completedSeq(events, INVESTIGATE)).toBeLessThan(firstStartSeq(events, REVIEW))
    expect(completedSeq(events, REVIEW)).toBeLessThan(firstStartSeq(events, VERIFY))

    // The collector classified the durable node records, and the run result reuses that collection.
    const collected = collectDelegationResults(record.nodes)
    const collectedByRole = new Map(collected.results.map((outcome) => [outcome.role, outcome.outcome]))
    expect(collected.results).toHaveLength(3)
    expect(collectedByRole.get("investigate")).toBe("completed")
    expect(collectedByRole.get("review")).toBe("completed")
    expect(collectedByRole.get("verify")).toBe("completed")
    expect(completion.outcomes).toEqual(collected.results)
    expectNoVerdict(completion)
  })

  test("#given a failing review child #when the real engine settles #then the collector reports that child failed, verify is skipped, and the result claims no success or verdict", async () => {
    // given
    const reviewFailure = new Map<string, RunnerOutcome>()
    reviewFailure.set(REVIEW, failedOutcome(REVIEW))
    const fixture = createFixture(reviewFailure)

    // when
    const result = await runEngineeringDelegation(
      { dagManager: fixture.manager, wait: fixture.wait },
      delegationRequest(fixture.project),
    )

    // then
    const completion = completionOf(result)
    // verify never starts: the real frontier skip-cascades it after review fails.
    expect(fixture.runner.startedNodeIds).toEqual([INVESTIGATE, REVIEW])

    const record = fixture.manager.record(completion.runId, PARENT_SESSION_ID)
    expect(record.status).toBe("failed")
    expect(nodeState(record, INVESTIGATE)).toBe("completed")
    expect(nodeState(record, REVIEW)).toBe("failed")
    expect(nodeState(record, VERIFY)).toBe("skipped")

    const collected = collectDelegationResults(record.nodes)
    const collectedByRole = new Map(collected.results.map((outcome) => [outcome.role, outcome.outcome]))
    expect(collectedByRole.get("review")).toBe("failed")
    expect(collectedByRole.get("verify")).toBe("skipped")
    expect(completion.outcomes).toEqual(collected.results)
    expect(completion.outcomes.some((outcome) => outcome.outcome === "failed")).toBe(true)
    expect(completion.unresolved).toBe(false)
    expect(completion.deadlineExceeded).toBe(false)
    expectNoVerdict(completion)
  })
})
