import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { compileDag } from "../dag/graph"
import type { DagNode, DagRunId } from "../dag/types"
import { delegationNodeId } from "../delegation/plan"
import { createTaskRecordStore } from "../store"
import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type {
  ManagerAdmissionPort,
  ManagerAdmissionRunRecord,
  ManagerAdmissionRunSpec,
  ManagerDelegationSpec,
  ManagerDelegationStartRequest,
  ManagerStartSpec,
  TaskManagerOptions,
} from "./types"

afterEach(() => {
  cleanupProjects()
})

// SAFETY: DagRunId is a branded string; each literal below names one test run so two ports can be
// told apart. No engine id is derived from them.
const CONSTRUCTION_RUN = "dag_late_bind_construction" as DagRunId
const LATE_RUN = "dag_late_bind_late" as DagRunId
const REPLACEMENT_RUN = "dag_late_bind_replacement" as DagRunId

const delegation: ManagerDelegationStartRequest = {
  objective: "prove the late-bound admission seam",
  workingDirectory: "/tmp/late-bind-fixture",
  roles: [
    { key: "investigate", assignment: "find the seam and report it" },
    { key: "verify", assignment: "report observed evidence only" },
  ],
  parent_session_id: "parent-late-bind",
}

function makeHarness(admission?: ManagerAdmissionPort) {
  const project = tempProject()
  const inProcess = new FakeRunner()
  const options: TaskManagerOptions = {
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": inProcess, process: new FakeRunner() },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
    // The ordinary delegated start resolves the verification catalogue; a host-owned authority
    // outside the workspace would make the test read real user state.
    verificationAuthorityRoot: join(project, "authority"),
  }
  return {
    manager: createTaskManager(admission === undefined ? options : { ...options, admission }),
    inProcess,
    project,
  }
}

function makePort(tag: string, runId: DagRunId) {
  const calls: string[] = []
  const runSpecs: ManagerAdmissionRunSpec[] = []
  let persisted: ManagerAdmissionRunRecord | undefined
  let startRunCount = 0

  const port: ManagerAdmissionPort = {
    startRun: async (spec) => {
      startRunCount += 1
      runSpecs.push(spec)
      calls.push(`startRun:${spec.parentSessionId}`)
      const compiled = compileDag(spec.definition, { at: "2026-01-01T00:00:00.000Z" })
      if (!compiled.ok) throw new Error(compiled.errors.map((error) => error.message).join("; "))
      const nodes = compiled.nodes.map((node): DagNode => ({
        ...node,
        state: "completed",
        taskId: `st_${node.id}`,
        output: `done:${node.id}`,
        outputBytes: `done:${node.id}`.length,
      }))
      persisted = { runId, nodes }
      return { runId }
    },
    admit: async (target) => {
      const nodeId = "nodeId" in target ? target.nodeId : delegationNodeId(target.role, 1)
      calls.push(`admit:${nodeId}`)
      return { taskId: `st_${nodeId}`, nodeId }
    },
    wait: async (taskId) => {
      calls.push(`wait:${taskId}`)
      return { taskId, status: "completed" }
    },
    record: (observedRunId) => {
      calls.push(`record:${observedRunId}`)
      if (persisted === undefined) throw new Error("no run was started")
      return persisted
    },
    cancel: async (observedRunId) => {
      calls.push(`cancel:${observedRunId}`)
    },
  }

  return { tag, port, calls, runSpecs, startRunCount: () => startRunCount }
}

function delegatedSpec(workingDirectory: string): ManagerStartSpec & { readonly delegation: ManagerDelegationSpec } {
  return {
    ...baseSpec(),
    delegation: {
      objective: "prove the late-bound seam on the ordinary start path",
      workingDirectory,
      roles: [
        { key: "investigate", assignment: "find the seam and report it" },
        { key: "verify", assignment: "report observed evidence only" },
      ],
    },
  }
}

describe("late-bound admission port (p27 todo 7)", () => {
  test("#given a manager constructed without a port #when a delegated start runs before the setter #then it refuses admission_unavailable and persists nothing", async () => {
    // given
    const { manager, inProcess } = makeHarness()

    // when
    const result = await manager.startDelegated(delegation)

    // then: a typed refusal, never a throw and never an ordinary spawn.
    expect(result.kind).toBe("admission_unavailable")
    if (result.kind !== "admission_unavailable") throw new Error("expected admission_unavailable")
    expect(result.reason).toBe("admission_unavailable")
    expect(inProcess.startedSpecs).toHaveLength(0)
    expect(manager.list({ scope: "all" })).toHaveLength(0)
  })

  test("#given a manager constructed without a port #when a delegated start runs on the ordinary path before the setter #then it refuses admission_unavailable and claims no parent", async () => {
    // given
    const { manager, inProcess, project } = makeHarness()

    // when
    const result = await manager.start(delegatedSpec(project))

    // then
    expect(result.kind).toBe("admission_unavailable")
    if (result.kind !== "admission_unavailable") throw new Error("expected admission_unavailable")
    expect(result.reason).toBe("admission_unavailable")
    expect(inProcess.startedSpecs).toHaveLength(0)
    expect(manager.list({ scope: "all" })).toHaveLength(0)
  })

  test("#given a manager constructed without a port #when the late-bound port is set #then the same manager drives it", async () => {
    // given
    const late = makePort("late", LATE_RUN)
    const { manager, inProcess } = makeHarness()
    expect(manager.setAdmissionPort).toBeTypeOf("function")

    // when
    manager.setAdmissionPort(late.port)
    const result = await manager.startDelegated(delegation)

    // then: the late-bound port created and observed the one run.
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    expect(result.runId).toBe(LATE_RUN)
    expect(late.startRunCount()).toBe(1)
    expect(late.calls).toEqual([
      "startRun:parent-late-bind",
      `admit:${delegationNodeId("investigate", 1)}`,
      `admit:${delegationNodeId("verify", 1)}`,
      `wait:st_${delegationNodeId("investigate", 1)}`,
      `wait:st_${delegationNodeId("verify", 1)}`,
      `record:${LATE_RUN}`,
    ])
    // The port owned the children; the manager's runner started none of them.
    expect(inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given a manager constructed without a port #when the late-bound port is set #then the ordinary delegated start path drives it too", async () => {
    // given
    const late = makePort("late", LATE_RUN)
    const { manager, inProcess, project } = makeHarness()
    manager.setAdmissionPort(late.port)

    // when
    const result = await manager.start(delegatedSpec(project))

    // then
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    expect(result.runId).toBe(LATE_RUN)
    expect(late.startRunCount()).toBe(1)
    expect(inProcess.startedSpecs).toHaveLength(0)
    expect(manager.get(result.task_id)?.status).toBe("completed")
  })

  test("#given a construction-time port #when the setter runs twice #then only the last port runs and exactly one run is created", async () => {
    // given
    const construction = makePort("construction", CONSTRUCTION_RUN)
    const replacement = makePort("replacement", REPLACEMENT_RUN)
    const { manager } = makeHarness(construction.port)

    // when: two replacements prove the setter overwrites rather than stacking ports.
    manager.setAdmissionPort(replacement.port)
    manager.setAdmissionPort(replacement.port)
    const result = await manager.startDelegated(delegation)

    // then: one manager, one run, and the first port never saw a request.
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    expect(result.runId).toBe(REPLACEMENT_RUN)
    expect(construction.calls).toEqual([])
    expect(construction.startRunCount()).toBe(0)
    expect(replacement.startRunCount()).toBe(1)
    expect(replacement.runSpecs).toHaveLength(1)
    // A delegated start claims a parent record for task/epoch correlation; the parent is not a child
    // of the admission port, and the port still creates exactly one run.
    expect(manager.list({ scope: "all" })).toHaveLength(1)
  })

  test("#given a late-bound port #when an ordinary non-delegated start runs #then the child starts exactly as before and the port is never consulted", async () => {
    // given
    const late = makePort("late", LATE_RUN)
    const { manager, inProcess } = makeHarness()
    manager.setAdmissionPort(late.port)

    // when
    const started = await manager.start(baseSpec({ run_in_background: true }))

    // then
    expect(started.kind).toBe("started")
    expect(inProcess.startedSpecs).toHaveLength(1)
    expect(late.calls).toEqual([])
  })
})
