import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { compileDag } from "../dag/graph"
import type { DagNode, DagNodeId, DagRunId } from "../dag/types"
import { delegationNodeId } from "../delegation/plan"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import type { TaskRecordStore } from "../store"
import { approvalAuthorityFor } from "../verification/approval-authority"
import { readApprovals } from "../verification/approval-store"
import { evaluateOrdinaryCompletion } from "../verification/completion-gate"
import type { VerificationStatus } from "../verification/completion-status"
import { resolveCatalogue, WORKSPACE_ID } from "../verification/resolution"

import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type {
  ManagerAdmissionPort,
  ManagerAdmissionRunRecord,
  ManagerAdmissionRunSpec,
  ManagerDelegationSpec,
  ManagerStartSpec,
  TaskManagerOptions,
} from "./types"

afterEach(() => {
  cleanupProjects()
})

// SAFETY: DagRunId is a branded string, and this literal names a test run; no engine id is derived
// from it.
const RUN_ID = "dag_manager_delegation" as DagRunId

type ScriptedState = "completed" | "failed"

function isTerminalNodeState(state: DagNode["state"]): boolean {
  return state === "completed" || state === "failed" || state === "cancelled" || state === "skipped"
}

function makePort(options: {
  outcomes?: readonly ScriptedState[]
  waitForever?: boolean
  onWait?: () => void
  admitForever?: boolean
  startForever?: boolean
  withCancel?: boolean
  // Keep the observed terminal-node COUNT equal to the plan while dropping one planned node and
  // adding one foreign terminal node. A count oracle calls that resolved; a planned-id set does not.
  foreignForMissing?: boolean
} = {}) {
  const outcomes = options.outcomes ?? ["completed", "completed"]
  const calls: string[] = []
  const runSpecs: ManagerAdmissionRunSpec[] = []
  const cancels: { readonly runId: DagRunId; readonly reason?: string }[] = []
  let persisted: ManagerAdmissionRunRecord | undefined

  const port: ManagerAdmissionPort = {
    startRun: async (spec) => {
      runSpecs.push(spec)
      calls.push(`startRun:${spec.parentSessionId}`)
      if (options.startForever === true) return new Promise(() => {})
      const compiled = compileDag(spec.definition, { at: "2026-01-01T00:00:00.000Z" })
      if (!compiled.ok) throw new Error(compiled.errors.map((error) => error.message).join("; "))
      const nodes = compiled.nodes.map((node, index): DagNode => {
        const output = `done:${node.id}`
        return {
          ...node,
          state: outcomes[index] ?? "completed",
          taskId: `st_${node.id}`,
          output,
          outputBytes: output.length,
        }
      })
      if (options.foreignForMissing === true && nodes.length > 0) {
        const keeper = nodes[nodes.length - 1]!
        // SAFETY: this test sentinel only renames a compiled node so the observed terminal count
        // stays equal to the plan; no engine id is derived from it.
        const foreign = { ...keeper, id: "foreign-node" as DagNodeId, taskId: "st_foreign-node" }
        persisted = { runId: RUN_ID, nodes: [...nodes.slice(0, -1), foreign] }
      } else {
        persisted = { runId: RUN_ID, nodes }
      }
      return { runId: RUN_ID }
    },
    admit: async (target) => {
      const nodeId = "nodeId" in target ? target.nodeId : delegationNodeId(target.role, 1)
      calls.push(`admit:${nodeId}`)
      if (options.admitForever === true) return new Promise(() => {})
      return { taskId: `st_${nodeId}`, nodeId }
    },
    wait: async (taskId) => {
      calls.push(`wait:${taskId}`)
      options.onWait?.()
      if (options.waitForever === true) return new Promise(() => {})
      return { taskId, status: "completed" }
    },
    record: (runId) => {
      calls.push(`record:${runId}`)
      if (persisted === undefined) throw new Error("no run was started")
      return persisted
    },
  }
  if (options.withCancel !== false) {
    port.cancel = async (runId, reason) => {
      cancels.push(reason === undefined ? { runId } : { runId, reason })
      calls.push(`cancel:${runId}`)
      // A real cancellation terminalizes every node the run still owns, so a deadline never
      // leaves a child running.
      if (persisted !== undefined) {
        persisted = {
          runId: persisted.runId,
          nodes: persisted.nodes.map((node) => isTerminalNodeState(node.state) ? node : { ...node, state: "cancelled" }),
        }
      }
    }
  }

  return {
    port,
    calls,
    runSpecs,
    cancels,
    childrenLeftRunning: () => persisted?.nodes.some((node) => !isTerminalNodeState(node.state)) ?? false,
  }
}

function makeHarness(admission?: ManagerAdmissionPort) {
  const project = tempProject()
  const authorityRoot = join(project, "authority")
  const store = createTaskRecordStore({ project_dir: project })
  const inProcess = new FakeRunner()
  const options: TaskManagerOptions = {
    store,
    runners: { "in-process": inProcess, process: new FakeRunner() },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
    verificationAuthorityRoot: authorityRoot,
  }
  const withAdmission = admission === undefined ? options : { ...options, admission }
  return { project, authorityRoot, store, inProcess, manager: createTaskManager(withAdmission) }
}

function delegatedSpec(
  workingDirectory: string,
  deadlineMs?: number,
): ManagerStartSpec & { readonly delegation: ManagerDelegationSpec } {
  const delegation: ManagerDelegationSpec = {
    objective: "prove the manager-owned delegated lifecycle",
    workingDirectory,
    roles: [
      { key: "investigate", assignment: "find the seam and report it" },
      { key: "verify", assignment: "report observed evidence only" },
    ],
  }
  return {
    ...baseSpec(),
    delegation: deadlineMs === undefined ? delegation : { ...delegation, deadlineMs },
  }
}

// The persisted record carries verification_status on disk; this test reads that raw carrier
// directly so assertions cover the bytes written, not only the parsed view.
type RawTaskRecord = TaskRecord & { readonly verification_status?: VerificationStatus }

function rawRecord(store: TaskRecordStore, taskId: string): RawTaskRecord {
  const text = readFileSync(join(store.stateDir, "tasks", `${taskId}.json`), "utf8")
  // SAFETY: the path is the store's own record file, written by the manager under test; the test
  // reads only the fields it asserts on below.
  return JSON.parse(text) as RawTaskRecord
}

type PersistedEventPayload = {
  readonly verification_status?: string
  readonly code?: string
  readonly reason?: string
}

type PersistedEvent = { readonly type: string; readonly payload?: PersistedEventPayload }

function readEvents(store: TaskRecordStore, taskId: string): PersistedEvent[] {
  try {
    const text = readFileSync(join(store.stateDir, "logs", `${taskId}.jsonl`), "utf8")
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        // SAFETY: every line is a JSON object appended by the task store's own event writer; this
        // test reads only `type` and the named payload fields it asserts on.
        return JSON.parse(line) as PersistedEvent
      })
  } catch {
    return []
  }
}

// The test recomputes the gate from the same parent-owned inputs the manager used. Equality with the
// record's stamped verification_status proves the claim came from evaluateOrdinaryCompletion, not
// from the manager inventing one.
function expectedGate(store: TaskRecordStore, project: string, authorityRoot: string, taskId: string, epoch: number) {
  const authority = approvalAuthorityFor(project, authorityRoot)
  const approvals = readApprovals(authority, WORKSPACE_ID)
  const catalogue = resolveCatalogue({
    projectRoot: project,
    workspaceId: WORKSPACE_ID,
    changedFiles: null,
    authority,
    approvals,
  })
  return evaluateOrdinaryCompletion({
    taskId,
    catalogue,
    evidenceRoot: join(store.stateDir, "verifications"),
    workspaceDir: project,
    epoch,
  })
}

const VERDICT_KEYS = ["verified", "success", "verdict", "verification", "verification_status"]

describe("manager delegated lifecycle on the ordinary start path (p25 todo 14)", () => {
  test("#given a delegated spec and a port with two completed children #when start runs #then the parent completes with the gate's verdict and the result carries no verdict key", async () => {
    // given
    const { port } = makePort()
    const harness = makeHarness(port)

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project))

    // then
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    expect(result.runId).toBe(RUN_ID)
    expect(result.unresolved).toBe(false)
    expect(result.outcomes.map((outcome) => outcome.nodeId)).toEqual([
      delegationNodeId("investigate"),
      delegationNodeId("verify"),
    ])
    expect(result.outcomes.every((outcome) => outcome.outcome === "completed")).toBe(true)

    // The returned object names the parent task and the run, and NOTHING else. A caller cannot read
    // a manager-computed verdict out of it.
    expect(Object.keys(result).sort()).toEqual(["kind", "outcomes", "runId", "task_id", "unresolved"])
    for (const forbidden of [...VERDICT_KEYS, "ok"]) {
      expect(forbidden in result).toBe(false)
    }

    // The manager-owned parent record carries the terminal state. The gate is the only source of the
    // verification claim: recompute it from the same run-scoped inputs and compare.
    const record = harness.manager.get(result.task_id)
    expect(record?.status).toBe("completed")
    expect(record?.terminal_at).toBeDefined()
    expect(record?.error_message).toBeUndefined()
    expect(record?.residency_state).toBe("disposed")
    const gate = expectedGate(
      harness.store,
      harness.project,
      harness.authorityRoot,
      result.task_id,
      record?.notification.run_epoch ?? -1,
    )
    expect(gate.verification).toBe("unverified")
    expect(rawRecord(harness.store, result.task_id).verification_status).toBe(gate.verification)
    const unverified = readEvents(harness.store, result.task_id).find((event) => event.type === "verification_unverified")
    expect(unverified?.payload?.verification_status).toBe("unverified")

    // No second spawn mechanism: the port owned the children; the manager's runner started none.
    expect(harness.inProcess.startedSpecs).toHaveLength(0)
    expect(result.outcomes).toHaveLength(2)
  })

  test("#given no admission port #when a delegated start runs #then it refuses with admission_unavailable and starts nothing", async () => {
    // given
    const harness = makeHarness()

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project))

    // then
    expect(result.kind).toBe("admission_unavailable")
    if (result.kind !== "admission_unavailable") throw new Error("expected admission_unavailable")
    expect(result.reason).toBe("admission_unavailable")
    expect(result.message).toContain("TaskManagerOptions.admission")
    expect(harness.store.list().records).toHaveLength(0)
    expect(harness.inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given a port #when an ordinary non-delegated start runs #then it takes the unchanged spawn path and never consults the port", async () => {
    // given
    const { port, calls } = makePort()
    const harness = makeHarness(port)

    // when
    const started = await harness.manager.start(baseSpec({ run_in_background: true }))

    // then
    expect(started.kind).toBe("started")
    if (started.kind !== "started") throw new Error("expected started")
    expect(harness.inProcess.startedSpecs).toHaveLength(1)
    expect(calls).toEqual([])
    // An ordinary child occupies a residency slot; the delegated coordinator deliberately does not.
    expect(harness.manager.get(started.task_id)?.residency_state).toBe("resident")
  })

  test("#given a delegated spec and a port whose waits never settle #when the deadline elapses #then the typed deadline error propagates and the parent is never completed", async () => {
    // given: this port exposes NO cancel, so the deadline text must not claim a stop.
    const { port, calls } = makePort({ waitForever: true, withCancel: false })
    const harness = makeHarness(port)

    // when: a zero budget makes the deadline path deterministic - the wait never settles.
    const result = await harness.manager.start(delegatedSpec(harness.project, 0))

    // then
    expect(result.kind).toBe("deadline_unavailable_at_manager_seam")
    if (result.kind !== "deadline_unavailable_at_manager_seam") throw new Error("expected the typed deadline error")
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("deadline of 0ms elapsed")
    expect(result.reason).toContain("exposes no run cancel")
    expect(calls).not.toContain(`cancel:${RUN_ID}`)
    // `ok: false` is the checkbox-16 typed error's own shape; it is not a verdict claim.
    expect("ok" in result).toBe(true)
    for (const forbidden of VERDICT_KEYS) {
      expect(forbidden in result).toBe(false)
    }

    const records = harness.store.list().records
    expect(records).toHaveLength(1)
    const parent = records[0]
    expect(parent?.status).toBe("error")
    expect(parent?.error_message).toContain("deadline of 0ms elapsed")
    expect(rawRecord(harness.store, parent?.task_id ?? "").verification_status).toBeUndefined()
  })

  test("#given a request working directory that differs from the manager cwd #when the delegated start runs #then the port receives the request's tree", async () => {
    // given: a second real tree, distinct from the manager's construction cwd.
    const otherTree = tempProject()
    const { port, runSpecs } = makePort()
    const harness = makeHarness(port)
    expect(otherTree).not.toBe(harness.project)

    // when
    const result = await harness.manager.start(delegatedSpec(otherTree))

    // then
    expect(result.kind).toBe("delegated")
    expect(runSpecs).toHaveLength(1)
    expect(runSpecs[0]?.workingDirectory).toBe(otherTree)
    expect(runSpecs[0]?.workingDirectory).not.toBe(harness.project)
  })

  test("#given a startRun that never settles #when the deadline elapses #then the caller gets the pre-identity timeout and no node is admitted", async () => {
    // given: the port parks before it can report a run identity.
    const { port, calls } = makePort({ startForever: true })
    const harness = makeHarness(port)

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project, 0))

    // then: no run id exists to fence a run-scoped refusal to, so the portable outcome is the typed
    // start failure; nothing was admitted and the parent is terminal.
    expect(result.kind).toBe("delegation_start_failed")
    if (result.kind !== "delegation_start_failed") throw new Error("expected delegation_start_failed")
    expect(result.reason).toBe("admission_start_timeout")
    expect(result.message).toContain("while the admission port was creating the run")
    expect(calls.some((call) => call.startsWith("admit:"))).toBe(false)
    expect(calls.some((call) => call.startsWith("wait:"))).toBe(false)
    const parent = harness.store.list().records[0]
    expect(parent?.status).toBe("error")
    expect(parent?.error_message).toContain("deadline of 0ms elapsed")
  })

  test("#given an admit that never settles #when the deadline elapses #then the deadline interrupts the admit and the port's cancel stops the run", async () => {
    // given
    const { port, calls, cancels, childrenLeftRunning } = makePort({ admitForever: true })
    const harness = makeHarness(port)

    // when: the timer is armed before startRun, so a blocked admit cannot hold the caller.
    const result = await harness.manager.start(delegatedSpec(harness.project, 0))

    // then: the caller got the typed refusal, the run was cancelled, and no wait was ever reached.
    expect(result.kind).toBe("deadline_unavailable_at_manager_seam")
    if (result.kind !== "deadline_unavailable_at_manager_seam") throw new Error("expected the typed deadline error")
    expect(result.reason).toContain("while nodes were being admitted")
    expect(result.reason).toContain("cancelled through the admission port")
    expect(cancels.map((cancel) => cancel.runId)).toEqual([RUN_ID])
    expect(cancels[0]?.reason).toContain("deadline of 0ms elapsed")
    expect(calls.some((call) => call.startsWith("wait:"))).toBe(false)

    // A deadline-failed parent never leaves work behind: the run is terminal and no child runs.
    expect(childrenLeftRunning()).toBe(false)
    expect(result.unresolved).toBe(false)
    const parent = harness.store.list().records[0]
    expect(parent?.status).toBe("error")
    expect(parent?.error_message).toContain("deadline of 0ms elapsed")
    expect(rawRecord(harness.store, parent?.task_id ?? "").verification_status).toBeUndefined()
  })

  test("#given admitted children whose waits never settle #when the deadline elapses #then the manager cancels the run and leaves no child running", async () => {
    // given: admission succeeded, so the deadline must reach the already-admitted children.
    const { port, calls, cancels, childrenLeftRunning } = makePort({ waitForever: true })
    const harness = makeHarness(port)

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project, 0))

    // then
    expect(result.kind).toBe("deadline_unavailable_at_manager_seam")
    if (result.kind !== "deadline_unavailable_at_manager_seam") throw new Error("expected the typed deadline error")
    expect(result.reason).toContain("while admitted children were running")
    expect(calls).toContain(`cancel:${RUN_ID}`)
    expect(cancels).toHaveLength(1)
    expect(childrenLeftRunning()).toBe(false)
    const parent = harness.store.list().records[0]
    expect(parent?.status).toBe("error")
    expect(parent?.error_message).toContain("deadline of 0ms elapsed")
  })

  test("#given the parent epoch moves at the terminal write #when the fold commits #then neither a terminal nor a verification claim is written", async () => {
    // given: the store wrapper bumps the epoch in the SAME call that would carry the fold's terminal
    // write, after every earlier ownership check already passed. This is the exact window a
    // check-then-act fence cannot close; the CAS must re-read the epoch under the write's own lock.
    const project = tempProject()
    const authorityRoot = join(project, "authority")
    const base = createTaskRecordStore({ project_dir: project })
    let armed = false
    let bumped = false
    const store: TaskRecordStore = {
      ...base,
      mutate: (taskId, mutation) => {
        if (armed && !bumped) {
          bumped = true
          base.mutate(taskId, (record) => ({
            ...record,
            notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 },
          }))
        }
        return base.mutate(taskId, mutation)
      },
    }
    const { port } = makePort({ onWait: () => { armed = true } })
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings({ default_concurrency: 5, max_depth: 1 }),
      cwd: project,
      verificationAuthorityRoot: authorityRoot,
      admission: port,
    })

    // when
    const result = await manager.start(delegatedSpec(project))

    // then
    expect(bumped).toBe(true)
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error("expected delegated")
    expect(manager.get(result.task_id)?.status).toBe("running")
    expect(rawRecord(store, result.task_id).verification_status).toBeUndefined()
  })

  test("#given a run record with one foreign terminal node and one planned node missing #when the delegated start folds #then the parent is failed as unresolved although the counts match", async () => {
    // given: the same terminal-node count as the plan, so a count oracle would read it as resolved.
    const { port } = makePort({ foreignForMissing: true })
    const harness = makeHarness(port)

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project))

    // then
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error("expected delegated")
    expect(result.unresolved).toBe(true)
    expect(result.outcomes).toHaveLength(2)
    expect(result.outcomes.some((outcome) => outcome.nodeId === "foreign-node")).toBe(true)
    const record = harness.manager.get(result.task_id)
    expect(record?.status).toBe("error")
    expect(record?.error_message).toContain("did not carry exactly the planned node set")
    expect(rawRecord(harness.store, result.task_id).verification_status).toBeUndefined()
  })

  test("#given the parent record's epoch moves while the run is in flight #when the fold runs #then the stale writer writes no terminal and no verification claim", async () => {
    // given: the wait simulates a concurrent revival moving the parent's run epoch. The captured
    // epoch the fold was armed under no longer names the record's current run.
    let harnessRef: ReturnType<typeof makeHarness> | undefined
    const { port } = makePort({
      onWait: () => {
        const harness = harnessRef
        if (harness === undefined) return
        const parent = harness.store.list().records[0]
        if (parent === undefined) return
        harness.store.mutate(parent.task_id, (record) => ({
          ...record,
          notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 },
        }))
      },
    })
    const harness = makeHarness(port)
    harnessRef = harness

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project))

    // then: the run's outcomes are still reported, but the stale parent writer wrote no terminal.
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error("expected delegated")
    const records = harness.store.list().records
    expect(records).toHaveLength(1)
    expect(records[0]?.status).toBe("running")
    expect(rawRecord(harness.store, result.task_id).verification_status).toBeUndefined()
  })

  test("#given a port whose run record shows one failed child #when the delegated start folds the run #then the parent is never completed and claims no verification", async () => {
    // given
    const { port } = makePort({ outcomes: ["completed", "failed"] })
    const harness = makeHarness(port)

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project))

    // then
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error("expected delegated")
    expect(result.unresolved).toBe(false)
    expect(result.outcomes.some((outcome) => outcome.outcome === "failed")).toBe(true)

    const record = harness.manager.get(result.task_id)
    expect(record?.status).toBe("error")
    expect(record?.error_message).toContain("ended failed")
    expect(rawRecord(harness.store, result.task_id).verification_status).toBeUndefined()
    for (const forbidden of VERDICT_KEYS) {
      expect(forbidden in result).toBe(false)
    }
  })
})
