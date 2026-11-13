import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { delegationNodeId } from "../delegation/plan"
import { compileDag } from "../dag/graph"
import type { DagNode, DagNodeId, DagRunId } from "../dag/types"
import { createTaskRecordStore } from "../store"

import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type {
  ManagerAdmissionPort,
  ManagerAdmissionRunRecord,
  ManagerAdmissionRunSpec,
  ManagerDelegationStartRequest,
  TaskManagerOptions,
} from "./types"

afterEach(() => {
  cleanupProjects()
})

const delegation: ManagerDelegationStartRequest = {
  objective: "prove the manager-owned admission seam",
  workingDirectory: "/tmp/admission-fixture",
  roles: [
    { key: "investigate", assignment: "find the seam and report it" },
    { key: "verify", assignment: "report observed evidence only" },
  ],
  parent_session_id: "parent-delegation",
}

// SAFETY: the admission port keys its run by this branded DAG id; the fake port returns the exact
// literal below and the assertion reads it back from the manager result.
const runId = "dag_admission_test" as DagRunId

function makeManager(admission?: ManagerAdmissionPort) {
  const project = tempProject()
  const inProcess = new FakeRunner()
  const options: TaskManagerOptions = {
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": inProcess, process: new FakeRunner() },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
  }
  return {
    manager: createTaskManager(admission === undefined ? options : { ...options, admission }),
    inProcess,
    project,
  }
}

function makeFakePort(options: { readonly foreignForMissing?: boolean } = {}) {
  const calls: string[] = []
  const admitted: string[] = []
  const runSpecs: ManagerAdmissionRunSpec[] = []
  let persisted: ManagerAdmissionRunRecord | undefined

  // The annotation IS the shape acceptance test: a fake that drifts from the port stops compiling.
  const port: ManagerAdmissionPort = {
    startRun: async (spec) => {
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
      if (options.foreignForMissing === true && nodes.length > 0) {
        const keeper = nodes[nodes.length - 1]!
        // SAFETY: this test sentinel only renames a compiled node so the observed terminal count
        // stays equal to the plan; no engine id is derived from it.
        persisted = {
          runId,
          nodes: [
            ...nodes.slice(0, -1),
            { ...keeper, id: "foreign-node" as DagNodeId, taskId: "st_foreign-node" },
          ],
        }
      } else {
        persisted = { runId, nodes }
      }
      return { runId }
    },
    admit: async (target) => {
      const nodeId = "nodeId" in target ? target.nodeId : delegationNodeId(target.role, 1)
      admitted.push(nodeId)
      calls.push(`admit:${nodeId}`)
      return { taskId: `st_${nodeId}`, nodeId }
    },
    wait: async (taskId) => {
      calls.push(`wait:${taskId}`)
      return { taskId, status: "completed" }
    },
    record: (runId) => {
      calls.push(`record:${runId}`)
      if (persisted === undefined) throw new Error("no run was started")
      return persisted
    },
    cancel: async (runId) => {
      calls.push(`cancel:${runId}`)
    },
  }

  return { port, calls, admitted, runSpecs }
}

describe("manager admission port (p25 todo 13)", () => {
  test("#given no admission port #when a delegated start is requested #then it refuses with admission_unavailable and starts nothing", async () => {
    // given
    const { manager, inProcess } = makeManager()

    // when
    const result = await manager.startDelegated(delegation)

    // then
    expect(result.kind).toBe("admission_unavailable")
    if (result.kind !== "admission_unavailable") throw new Error("expected admission_unavailable")
    expect(result.reason).toBe("admission_unavailable")
    expect(result.message).toContain("TaskManagerOptions.admission")
    expect(inProcess.startedSpecs).toHaveLength(0)
    expect(manager.list({ scope: "all" })).toHaveLength(0)
  })

  test("#given a fake port that satisfies the shape #when the same delegated start runs #then the manager drives it and folds its persisted node records", async () => {
    // given
    const { port, calls, admitted, runSpecs } = makeFakePort()
    const { manager, inProcess, project } = makeManager(port)

    // when
    const result = await manager.startDelegated(delegation)

    // then
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error("expected delegated")
    expect(result.runId).toBe(runId)
    // B6: the port receives the REQUEST's tree, never the manager's construction cwd.
    expect(runSpecs).toHaveLength(1)
    expect(runSpecs[0]?.workingDirectory).toBe(delegation.workingDirectory)
    expect(runSpecs[0]?.workingDirectory).not.toBe(project)
    expect(admitted).toEqual(["delegation-investigate-1", "delegation-verify-1"])
    expect(calls).toEqual([
      "startRun:parent-delegation",
      "admit:delegation-investigate-1",
      "admit:delegation-verify-1",
      "wait:st_delegation-investigate-1",
      "wait:st_delegation-verify-1",
      "record:dag_admission_test",
    ])
    expect(result.outcomes.map((outcome) => outcome.nodeId)).toEqual([
      delegationNodeId("investigate", 1),
      delegationNodeId("verify", 1),
    ])
    expect(result.outcomes.every((outcome) => outcome.outcome === "completed")).toBe(true)
    expect(result.unresolved).toBe(false)
    // No verdict may be written at this seam; the completion gate stays the only authority.
    expect("verification_status" in result).toBe(false)
    expect("verified" in result).toBe(false)
    expect("success" in result).toBe(false)
    // The port owned the children: the ordinary runner started none of them.
    expect(inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given a run record with one planned node missing and one foreign terminal node #when the delegated seam reads it #then it refuses with the named node ids although the counts match", async () => {
    // given: the same terminal-node count as the plan, so a count oracle would read it as resolved.
    const { port } = makeFakePort({ foreignForMissing: true })
    const { manager } = makeManager(port)

    // when
    const result = await manager.startDelegated(delegation)

    // then
    expect(result.kind).toBe("delegation_unresolved")
    if (result.kind !== "delegation_unresolved") throw new Error("expected delegation_unresolved")
    expect(result.reason).toBe("planned_and_unplanned_node_outcomes")
    expect(result.outcomes).toHaveLength(2)
    expect(result.missingNodeIds).toEqual([delegationNodeId("verify", 1)])
    expect(result.foreignNodeIds.map((nodeId) => String(nodeId))).toEqual(["foreign-node"])
    expect(result.message).toContain("planned node(s) delegation-verify-1")
    expect(result.message).toContain("unplanned node(s) foreign-node")
  })

  test("#given a port whose run record cannot be read #when the delegated seam reads it #then it refuses with run_record_unreadable and no fabricated outcomes", async () => {
    // given
    const { port } = makeFakePort()
    const unreadable: ManagerAdmissionPort = {
      ...port,
      record: () => {
        throw new Error("record unavailable")
      },
    }
    const { manager } = makeManager(unreadable)

    // when
    const result = await manager.startDelegated(delegation)

    // then: the failure is a typed cause, never a success-shaped `delegated` with empty outcomes.
    expect(result.kind).toBe("delegation_unresolved")
    if (result.kind !== "delegation_unresolved") throw new Error("expected delegation_unresolved")
    expect(result.reason).toBe("run_record_unreadable")
    expect(result.outcomes).toEqual([])
    expect(result.missingNodeIds).toEqual([])
    expect(result.foreignNodeIds).toEqual([])
    expect(result.message).toContain("run record could not be read")
  })

  test("#given no admission port #when an ordinary start runs #then it starts exactly as before", async () => {
    // given
    const { manager, inProcess } = makeManager()

    // when
    const started = await manager.start(baseSpec({ run_in_background: true }))

    // then
    expect(started.kind).toBe("started")
    expect(inProcess.startedSpecs).toHaveLength(1)
  })

  test("#given a port #when an ordinary start runs #then the port is never consulted", async () => {
    // given
    const { port, calls } = makeFakePort()
    const { manager, inProcess } = makeManager(port)

    // when
    const started = await manager.start(baseSpec({ run_in_background: true }))

    // then
    expect(started.kind).toBe("started")
    expect(inProcess.startedSpecs).toHaveLength(1)
    expect(calls).toEqual([])
  })

  test("#given the manager source #when scanned #then it has no runtime DAG lifecycle import", () => {
    // given
    const source = readFileSync(new URL("./manager.ts", import.meta.url), "utf8")

    // when: the pre-existing `../dag/verification` import is a pure evidence helper, not the DAG
    // runtime. Manager, scheduler, store, journal, graph, handle, and recovery are the runtime.
    const runtimeDagImport = /import\s*(?!type\b)\{[^}]*\}\s*from\s*"\.\.\/dag\/(?:manager|scheduler|store|journal|graph|handle|recovery|node-control-context|node-retry|node-send)"/s
    const dynamicDagImport = /import\(\s*"\.\.\/dag\/(?:manager|scheduler|store|journal|graph|handle|recovery)/

    // then
    expect(runtimeDagImport.test(source)).toBe(false)
    expect(dynamicDagImport.test(source)).toBe(false)
  })
})
