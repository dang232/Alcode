import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { compileDag } from "../dag/graph"
import type { DagNode, DagRunId } from "../dag/types"
import { delegationNodeId } from "../delegation/plan"
import type { TaskStatus } from "../state"
import { createTaskRecordStore } from "../store"
import type { VerificationStatus } from "../verification/completion-status"

import { baseSpec, categoryPlanner, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type {
  AdmitResident,
  ManagedRunner,
  ManagedStartSpec,
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

const PARENT_SESSION_ID = "parent-p27-cases"

// SAFETY: DagRunId is a branded string; each literal names one test run so two runs can be told
// apart. No engine id is derived from them.
const A_RUN = "dag_p27_case_a" as DagRunId

// The ONE forbidden shape: a completed terminal that also claims verification. A missing record
// cannot be that shape, so undefined passes.
type ClaimView = {
  readonly status: TaskStatus
  readonly verification_status?: VerificationStatus
}

function assertNoCompletedAndVerified(record: ClaimView | undefined): void {
  const forbidden = record !== undefined && record.status === "completed" && record.verification_status === "verified"
  expect(forbidden).toBe(false)
}

function delegatedSpec(workingDirectory: string): ManagerStartSpec & { readonly delegation: ManagerDelegationSpec } {
  return {
    ...baseSpec({ parent_session_id: PARENT_SESSION_ID }),
    delegation: {
      objective: "prove the p27 admission case table at the manager seam",
      workingDirectory,
      roles: [
        { key: "investigate", assignment: "report the admission evidence" },
        { key: "verify", assignment: "report observed evidence only" },
      ],
    },
  }
}

function makeScriptedPort(runId: DagRunId) {
  const calls: string[] = []
  let persisted: ManagerAdmissionRunRecord | undefined
  const port: ManagerAdmissionPort = {
    startRun: async (spec: ManagerAdmissionRunSpec) => {
      calls.push(`startRun:${spec.parentSessionId}`)
      const compiled = compileDag(spec.definition, { at: "2026-01-01T00:00:00.000Z" })
      if (!compiled.ok) throw new Error(compiled.errors.map((error) => error.message).join("; "))
      persisted = {
        runId,
        nodes: compiled.nodes.map((node): DagNode => {
          const output = `done:${node.id}`
          return { ...node, state: "completed", taskId: `st_${node.id}`, output, outputBytes: output.length }
        }),
      }
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
  }
  return { port, calls }
}

type Harness = {
  readonly project: string
  readonly store: ReturnType<typeof createTaskRecordStore>
  readonly manager: ReturnType<typeof createTaskManager>
  readonly startedSpecs: () => readonly ManagedStartSpec[]
  readonly residencyCalls: () => number
}

function makeHarness(options: {
  readonly residencyMaxChildren?: number
  readonly admission?: ManagerAdmissionPort
  readonly admit?: AdmitResident
  readonly inProcess?: ManagedRunner
} = {}): Harness {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const started: ManagedStartSpec[] = []
  let residencyCalls = 0
  const delegate = options.inProcess ?? new FakeRunner()
  const runner: ManagedRunner = {
    start: (spec) => {
      started.push(spec)
      return delegate.start(spec)
    },
  }
  const admit: AdmitResident = options.admit ?? (() => {
    residencyCalls += 1
    return Promise.resolve({ kind: "admitted" })
  })
  const config = settings({
    default_concurrency: 5,
    max_depth: 1,
    ...(options.residencyMaxChildren === undefined ? {} : { residency_max_children: options.residencyMaxChildren }),
  })
  const taskOptions: TaskManagerOptions = {
    store,
    runners: { "in-process": runner, process: new FakeRunner() },
    planner: categoryPlanner(),
    config,
    cwd: project,
    admit,
    verificationAuthorityRoot: join(project, "authority"),
    ...(options.admission === undefined ? {} : { admission: options.admission }),
  }
  return {
    project,
    store,
    manager: createTaskManager(taskOptions),
    startedSpecs: () => started,
    residencyCalls: () => residencyCalls,
  }
}

// p27 cases D and E moved to the host composition that owns the production port:
// I:/migration/oh-my-openAlcore/packages/omo-senpi/src/components/task/dag-admission-port.test.ts.
// The engine has no production ManagerAdmissionPort producer by design (p27 row 12), and the real
// host factory takes {runtime, authorizedParentSessionId, workingDirectory} - a shape no
// cross-repository env-var seam can satisfy honestly. Case D (admit stays pending until the
// scheduler's dag.node.task-attached event, starts no child) now extends the host test that already
// exercised that boundary; case E (residency_max_children 1 never deadlocks a two-node delegated
// run) was moved there verbatim. Cases A and C remain here because they assert the ENGINE-side
// admission drive and its fail-closed refusal, which this package owns.

describe("p27 admission cases (todo 4)", () => {
  test("A #given a free residency slot and the parent's current epoch #when the delegated start runs #then the scheduler admits every planned node", async () => {
    // given: one slot, no resident child, and a current parent epoch.
    const { port, calls } = makeScriptedPort(A_RUN)
    const harness = makeHarness({ residencyMaxChildren: 1, admission: port })

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project))

    // then: every planned node was admitted and waited, and the coordinator never took the slot.
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    expect(calls.filter((call) => call.startsWith("admit:"))).toEqual([
      "admit:delegation-investigate-1",
      "admit:delegation-verify-1",
    ])
    expect(calls.filter((call) => call.startsWith("wait:"))).toEqual([
      "wait:st_delegation-investigate-1",
      "wait:st_delegation-verify-1",
    ])
    expect(result.outcomes.every((outcome) => outcome.outcome === "completed")).toBe(true)

    const record = harness.manager.get(result.task_id)
    expect(record?.status).toBe("completed")
    expect(record?.residency_state).toBe("disposed")
    expect(record?.notification.run_epoch).toBe(0)
    expect(record?.verification_status).toBe("unverified")
    assertNoCompletedAndVerified(record)
    // Free slot: the delegated parent is not a resident, so the adapter is never asked to admit it.
    expect(harness.residencyCalls()).toBe(0)
    expect(harness.startedSpecs()).toHaveLength(0)
  })

  test("C #given only admitResident and no ManagerAdmissionPort #when the delegated start runs #then it refuses admission_unavailable and starts no run", async () => {
    // given: a residency adapter that WOULD admit, and no delegated admission port.
    const harness = makeHarness({ residencyMaxChildren: 1 })

    // when
    const result = await harness.manager.start(delegatedSpec(harness.project))

    // then: capacity is not admission; the delegated path refuses before claiming anything.
    expect(result.kind).toBe("admission_unavailable")
    if (result.kind !== "admission_unavailable") throw new Error(`expected admission_unavailable, received ${result.kind}`)
    expect(result.reason).toBe("admission_unavailable")
    expect(result.message).toContain("TaskManagerOptions.admission")
    expect(harness.store.list().records).toHaveLength(0)
    expect(harness.startedSpecs()).toHaveLength(0)
    expect(harness.residencyCalls()).toBe(0)
    assertNoCompletedAndVerified(undefined)
  })
})
