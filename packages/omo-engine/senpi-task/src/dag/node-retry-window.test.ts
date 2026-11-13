// Control for the retry window (p25 D7 / RK4): a retried node KEEPS its prior taskId until the
// replacement's admission batch attaches it, while the execution-intent counter (execAttempt)
// advances immediately. This suite proves that window against the REAL task manager and file store
// by holding the replacement's runner start open, so the window is observed deterministically
// instead of raced against a fast child.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "../../../omo-config-core/src/index.ts"

import type { ManagedChildHandle } from "../manager/child-handle"
import { createTaskManager } from "../manager/manager"
import type { ChildPlanner, ManagedRunner, ManagedStartSpec, TaskManager } from "../manager/types"
import { createTaskRecordStore } from "../store"
import { compileDag, type DagDefinition } from "./graph"
import type { DagRunRecordV1 } from "./manager"
import { createDagScheduler, type DagScheduler } from "./scheduler"
import { createDagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunEvent, DagRunId } from "./types"

// Bun honours a preload's setDefaultTimeout only for the first test file of a run; this suite
// drives the real manager, real fsync-backed store, and a gated runner over temp dirs. Set the
// floor here, where Bun does honour it.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000)

const cleanupRoots: string[] = []
// SAFETY: the DAG store keys its checkpoints and events by this branded run id; the literal is the
// single run this fixture writes, and every read below names the same constant.
const runId = "run-retry-window" as DagRunId
const parentSessionId = "session-retry-window-parent"
const rootSessionId = "session-retry-window-root"
const priorTaskId = "task-prior"
// SAFETY: the compiled node id is a branded identifier; this literal is the only node the fixture
// definition below declares, so every lookup compares against the id that definition produced.
const brokenNodeId = "broken" as DagNodeId

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-retry-window-"))
  cleanupRoots.push(root)
  return root
}

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Bounded wait: a failure to reach the window reports itself instead of hanging the suite.
function within<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout))
}

function node(id: string, dependsOn: readonly string[] = []) {
  const base = { id, prompt: `do ${id}`, category: "quick" } as const
  return dependsOn.length === 0 ? base : { ...base, dependsOn } as const
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "retry-window-test", name: "retry window test", nodes }
}

function recordFor(input: DagDefinition): DagRunRecordV1 {
  const createdAt = "2026-08-14T00:00:00.000Z"
  const compiled = compileDag(input, { at: createdAt })
  if (!compiled.ok) throw new Error("test DAG did not compile")
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

const planner: ChildPlanner = (spec) => {
  const target = spec.category ?? spec.subagent_type ?? "default"
  const plan = { model: spec.model ?? `scripted/${target}` }
  return {
    kind: "resolved",
    plan: spec.category === undefined ? plan : { ...plan, category: spec.category },
  }
}

// The gate is the whole control: start() announces it was entered and does not return until the
// test releases it. Apart from that it is an ordinary completing child.
class GatedRunner implements ManagedRunner {
  readonly startedSpecs: ManagedStartSpec[] = []
  readonly entered = deferred<void>()
  readonly release = deferred<void>()

  async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedSpecs.push(spec)
    this.entered.resolve()
    await this.release.promise
    const output = `output:${spec.prompt.replace(/^do /, "")}`
    return {
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome: () => Promise.resolve({ status: "completed", finalResponse: output }),
      lastAssistantText: () => output,
      dispose: () => Promise.resolve(),
    }
  }
}

type Fixture = {
  readonly taskManager: TaskManager
  readonly runner: GatedRunner
  readonly scheduler: DagScheduler
  readonly durableNode: () => DagNode
  readonly events: () => readonly DagRunEvent[]
}

// A run that already failed on its prior child. The checkpoint carries the prior taskId with the
// prior display attempt and NO execAttempt, which is exactly what an un-retried record looks like.
function failedFixture(): Fixture {
  const project = tempProject()
  const store = createDagFileStore({ project_dir: project })
  const taskStore = createTaskRecordStore({ project_dir: project })
  const runner = new GatedRunner()
  const taskManager = createTaskManager({
    store: taskStore,
    runners: { "in-process": runner, process: runner },
    planner,
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 16, max_depth: 1 }),
    cwd: project,
  })
  const input = definition([node("broken")])
  const base = recordFor(input)
  const at = "2026-08-14T00:00:05.000Z"
  const failed = base.nodes[0]
  if (failed === undefined) throw new Error("test DAG has no node")
  const initialRecord: DagRunRecordV1 = {
    ...base,
    status: "failed",
    startedAt: "2026-08-14T00:00:01.000Z",
    completedAt: "2026-08-14T00:00:09.000Z",
    updatedAt: "2026-08-14T00:00:09.000Z",
    nodes: [{
      ...failed,
      state: "failed",
      taskId: priorTaskId,
      attempt: 1,
      startedAt: "2026-08-14T00:00:02.000Z",
      completedAt: at,
      error: { code: "task_error", message: "boom", nodeId: brokenNodeId, at },
    }],
  }
  store.writeCheckpoint(runId, initialRecord)
  let eventTime = Date.parse("2026-08-14T00:00:10.000Z")
  const scheduler = createDagScheduler({
    store,
    taskManager,
    initialRecord,
    knowledgeHook: null,
    now: () => eventTime++,
  })
  const durableNode = (): DagNode => {
    const record = store.readCheckpoint<DagRunRecordV1>(runId)
    if (record === null) throw new Error("missing durable checkpoint")
    const found = record.nodes.find((entry) => entry.id === brokenNodeId)
    if (found === undefined) throw new Error("missing durable node")
    return found
  }
  const events = (): readonly DagRunEvent[] => store.readEvents(runId, 0, { limit: 200 }).events
  return {
    taskManager,
    runner,
    scheduler,
    durableNode,
    events,
  }
}

type Timeline = {
  readonly before: DagNode
  readonly windowRecord: DagNode
  readonly windowCheckpoint: DagNode
  readonly heldCheckpoint: DagNode
  readonly heldEvents: readonly DagRunEvent[]
  readonly after: DagNode
  readonly replacementTaskId: string
  readonly events: readonly DagRunEvent[]
  readonly taskManager: TaskManager
}

// Drives one retry end to end and stops at every observable boundary:
//   before            - the settled failed record
//   windowRecord      - the synchronous control-verb snapshot (retried, not yet admitted)
//   windowCheckpoint  - the same window read back from disk
//   heldCheckpoint    - admission has entered startOwned; the replacement task exists but the node
//                       has NOT been attached, so the node still names the prior child
//   after             - the attached replacement completed
async function runRetryTimeline(): Promise<Timeline> {
  const fixture = failedFixture()
  const before = fixture.durableNode()
  const retried = fixture.scheduler.retryNode(runId)
  // The control verb's snapshot is taken BEFORE the fresh scheduler starts; the fresh scheduler
  // then advances the node to `scheduled` synchronously up to its first admission await, so the
  // durable read taken after retryNode() returns can already show that flip. Neither moment has
  // attached the replacement, which is what this window is about.
  const windowRecord = retried.record.nodes[0]
  if (windowRecord === undefined) throw new Error("missing retried node")
  const windowCheckpoint = fixture.durableNode()
  await within(fixture.runner.entered.promise)
  const heldCheckpoint = fixture.durableNode()
  const heldEvents = fixture.events()
  // The replacement child record is already durable; only the node attribution is still prior.
  const replacementTaskId = fixture.runner.startedSpecs[0]?.taskId
  if (replacementTaskId === undefined) throw new Error("replacement start never reached the runner")
  fixture.runner.release.resolve()
  const after = await within(retried.run)
  const afterNode = after.nodes.find((entry) => entry.id === brokenNodeId)
  if (afterNode === undefined) throw new Error("missing attached node")
  return {
    before,
    windowRecord,
    windowCheckpoint,
    heldCheckpoint,
    heldEvents,
    after: afterNode,
    replacementTaskId,
    events: fixture.events(),
    taskManager: fixture.taskManager,
  }
}

// The bridge wire contract: the adapter that feeds the DAG pane projects each engine node through
// this exact allowlist (snake_case; optional fields stay absent rather than serializing as null).
// The adapter source lives outside this package, so the projection is pinned here; the assertions
// below compare it against the engine record, which DOES carry execAttempt.
const BRIDGE_WIRE_NODE_KEYS = [
  "id", "label", "prompt", "depends_on", "state", "attempt", "created_at", "task_id",
  "started_at", "completed_at", "last_error",
] as const

// The allowlisted wire shape: optional engine fields stay absent instead of serializing as null.
type BridgeWireNode = {
  id: string
  label?: string
  prompt: string
  depends_on: readonly string[]
  state: DagNode["state"]
  attempt: number
  created_at: string
  task_id?: string
  started_at?: string
  completed_at?: string
  last_error?: { code: string; message: string }
}

function toBridgeWireNode(source: DagNode): BridgeWireNode {
  const wire: BridgeWireNode = {
    id: source.id,
    prompt: source.prompt,
    depends_on: source.dependsOn,
    state: source.state,
    attempt: source.attempt,
    created_at: source.createdAt,
  }
  if (source.label !== undefined) wire.label = source.label
  if (source.taskId !== undefined) wire.task_id = source.taskId
  if (source.startedAt !== undefined) wire.started_at = source.startedAt
  if (source.completedAt !== undefined) wire.completed_at = source.completedAt
  if (source.error !== undefined) {
    wire.last_error = { code: source.error.code, message: source.error.message }
  }
  return wire
}

describe("DAG retry window", () => {
  test("#given a failed node with a prior child #when retried #then the durable window keeps the prior task id while execAttempt advances and attempt does not", async () => {
    // given - the settled failed record already names its prior child
    const timeline = await runRetryTimeline()

    // then - BEFORE the retry the record is the un-retouched prior attempt
    expect(timeline.before).toMatchObject({ state: "failed", taskId: priorTaskId, attempt: 1 })
    expect(timeline.before.execAttempt).toBeUndefined()

    // then - the WINDOW keeps the prior task id, advances execAttempt, and leaves the display
    // attempt alone. The control-verb snapshot is `pending`; the durable read may already be
    // `scheduled` because admission starts synchronously, but nothing is attached yet.
    expect(timeline.windowRecord).toMatchObject({ state: "pending", taskId: priorTaskId, attempt: 1, execAttempt: 1 })
    expect(["pending", "scheduled"]).toContain(timeline.windowCheckpoint.state)
    for (const node of [timeline.windowRecord, timeline.windowCheckpoint]) {
      expect(node.taskId).toBe(timeline.before.taskId)
      expect(node.execAttempt).toBe((timeline.before.execAttempt ?? 0) + 1)
      expect(node.attempt).toBe(timeline.before.attempt)
    }

    // then - admission reached startOwned (the replacement child exists) but attachment has NOT
    // happened: the node still names the prior id and the wire has not moved to a new attempt
    expect(timeline.heldCheckpoint).toMatchObject({ state: "scheduled", taskId: priorTaskId, attempt: 1, execAttempt: 1 })
    const owned = timeline.taskManager.findOwnedTask({ kind: "dag", runId, nodeId: brokenNodeId })
    expect(owned?.task_id).toBe(timeline.replacementTaskId)
    expect(owned?.task_id).not.toBe(priorTaskId)
    expect(timeline.heldEvents.filter((event) => event.type === "dag.node.task-attached")).toHaveLength(0)

    // then - AFTER attachment the replacement id and the advanced attempt land together
    expect(timeline.after).toMatchObject({
      state: "completed",
      taskId: timeline.replacementTaskId,
      attempt: 2,
      execAttempt: 1,
    })
    expect(timeline.after.taskId).not.toBe(priorTaskId)
    const retriedEvent = timeline.events.find((event) => event.type === "dag.node.retried")
    expect(retriedEvent).toMatchObject({
      type: "dag.node.retried",
      nodeId: "broken",
      priorTaskId,
      execAttempt: 1,
    })
    const attached = timeline.events.filter((event) => event.type === "dag.node.task-attached")
    expect(attached).toHaveLength(1)
    expect(attached[0]).toMatchObject({ taskId: timeline.replacementTaskId, attempt: 2 })
    const order = timeline.events.map((event) => event.type)
    expect(order.indexOf("dag.node.retried")).toBeLessThan(order.indexOf("dag.node.task-attached"))
  })

  test("#given the three retry moments #when each node is projected to the bridge wire #then no wire node carries execAttempt and task_id moves only with attempt", async () => {
    // given
    const timeline = await runRetryTimeline()

    // then - the ENGINE record does carry the execution-intent counter in the window...
    expect(timeline.windowRecord.execAttempt).toBe(1)
    expect(timeline.heldCheckpoint.execAttempt).toBe(1)
    expect(JSON.stringify(timeline.windowRecord)).toContain("\"execAttempt\":1")

    // ...and the WIRE projection does not, at any of the three moments
    const wireBefore = toBridgeWireNode(timeline.before)
    const wireWindow = toBridgeWireNode(timeline.windowRecord)
    const wireHeld = toBridgeWireNode(timeline.heldCheckpoint)
    const wireAfter = toBridgeWireNode(timeline.after)
    for (const wire of [wireBefore, wireWindow, wireHeld, wireAfter]) {
      expect(Object.keys(wire)).not.toContain("execAttempt")
      expect(Object.keys(wire)).not.toContain("exec_attempt")
      expect(Object.keys(wire).every((key) => BRIDGE_WIRE_NODE_KEYS.some((field) => field === key))).toBe(true)
      expect(JSON.stringify(wire)).not.toContain("execAttempt")
    }
    // Negative control: the assertion above is not vacuous. A spread-based "wire" (the mistake
    // this allowlist prevents) would put execAttempt on the wire, so the check can fail.
    expect(JSON.stringify({ ...timeline.windowRecord })).toContain("execAttempt")

    // then - the wire pair is honest at every moment: the prior id is only ever paired with the
    // PRIOR display attempt, so nothing labels the prior child as the current attempt. The id and
    // the attempt move together in the single task-attached fold.
    expect(wireBefore).toMatchObject({ state: "failed", task_id: priorTaskId, attempt: 1 })
    expect(wireWindow).toMatchObject({ state: "pending", task_id: priorTaskId, attempt: 1 })
    expect(wireHeld).toMatchObject({ task_id: priorTaskId, attempt: 1 })
    expect(["pending", "scheduled"]).toContain(wireHeld.state)
    expect(wireAfter).toMatchObject({ task_id: timeline.replacementTaskId, attempt: 2 })
  })
})
