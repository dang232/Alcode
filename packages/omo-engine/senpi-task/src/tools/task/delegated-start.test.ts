import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { compileDag } from "../../dag/graph"
import type { DagNode, DagRunId } from "../../dag/types"
import { delegationNodeId } from "../../delegation/plan"
import type {
  ManagerAdmissionPort,
  ManagerAdmissionRunRecord,
  ManagerDelegatedStartResult,
  ManagerDelegationSpec,
  ManagerStartSpec,
  StartResult,
  TaskManager,
  TerminalTaskRecord,
} from "../../manager"
import { createTaskManager } from "../../manager"
import { createTaskRecordStore } from "../../store"
import type { TaskRecordStore } from "../../store"
import {
  categoryPlanner,
  cleanupProjects,
  FakeRunner,
  settings,
  tempProject,
} from "../../manager/__fixtures__/manager-fakes"
import { createFakeManager, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"
import type { TaskToolContext, TaskToolDeps } from "./types"

const OMO_CONFIG = { categories: {}, agents: {} }
const PARENT_SESSION = "parent-session-1"
// SAFETY: DagRunId is a branded string; this literal names a fake test run, not an engine id.
const RUN_ID = "dag_tool_delegated" as DagRunId

afterEach(() => {
  cleanupProjects()
})

function makePort() {
  const calls: string[] = []
  let persisted: ManagerAdmissionRunRecord | undefined
  const port: ManagerAdmissionPort = {
    startRun: async (spec) => {
      calls.push(`startRun:${spec.parentSessionId}`)
      const compiled = compileDag(spec.definition, { at: "2026-01-01T00:00:00.000Z" })
      if (!compiled.ok) throw new Error(compiled.errors.map((error) => error.message).join("; "))
      persisted = {
        runId: RUN_ID,
        nodes: compiled.nodes.map((node): DagNode => {
          const output = `done:${node.id}`
          return { ...node, state: "completed", taskId: `st_${node.id}`, output, outputBytes: output.length }
        }),
      }
      return { runId: RUN_ID }
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
    record: (runId) => {
      calls.push(`record:${runId}`)
      if (persisted === undefined) throw new Error("no run was started")
      return persisted
    },
  }
  return { port, calls }
}

function makeHarness(admission?: ManagerAdmissionPort) {
  const project = tempProject()
  const authorityRoot = join(project, "authority")
  const store = createTaskRecordStore({ project_dir: project })
  const inProcess = new FakeRunner()
  const manager = createTaskManager({
    store,
    runners: { "in-process": inProcess, process: new FakeRunner() },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
    verificationAuthorityRoot: authorityRoot,
    admission,
  })
  return { project, store, inProcess, manager }
}

// The injected reader reads the raw persisted claim for cross-process authority; the typed store
// lane now parses the same field, which the payoff test below proves without a reader.
function storeReader(store: TaskRecordStore): (taskId: string) => TerminalTaskRecord | undefined {
  return (taskId) => {
    try {
      const text = readFileSync(join(store.stateDir, "tasks", `${taskId}.json`), "utf8")
      // SAFETY: the store wrote this record file; the test reads the persisted claim by id.
      return JSON.parse(text) as TerminalTaskRecord
    } catch {
      return undefined
    }
  }
}

function deps(manager: TaskManager, store?: TaskRecordStore): TaskToolDeps {
  return {
    manager,
    omoConfig: OMO_CONFIG,
    agents: {},
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }),
    readTerminalRecord: store === undefined ? undefined : storeReader(store),
  }
}

function ctx(cwd: string): TaskToolContext {
  return { cwd, sessionManager: { getSessionId: () => PARENT_SESSION } }
}

function delegatedParams(cwd?: string) {
  return {
    category: "quick",
    delegation: {
      objective: "prove the tool-level delegated entry",
      working_directory: cwd,
      roles: [
        { key: "investigate" as const, assignment: "find the seam and report it" },
        { key: "verify" as const, assignment: "report observed evidence only" },
      ],
    },
  }
}

function rawRecord(store: TaskRecordStore, taskId: string): TerminalTaskRecord {
  const text = readFileSync(join(store.stateDir, "tasks", `${taskId}.json`), "utf8")
  // SAFETY: the store wrote this record file; the test reads the persisted terminal claim by id.
  return JSON.parse(text) as TerminalTaskRecord
}

describe("task tool delegated start (p25 todo 15)", () => {
  test("#given a fake admission port #when the task tool starts a delegated parent #then the parent reaches a terminal record and the tool surfaces the gate verdict", async () => {
    // given: the port is injected where the manager is constructed, exactly as a host wiring does.
    const { port, calls } = makePort()
    const harness = makeHarness(port)
    const execute = buildTaskExecute(deps(harness.manager, harness.store))

    // when
    const result = await execute("delegated-1", delegatedParams(harness.project), undefined, undefined, ctx(harness.project))

    // then: the terminal record exists, carries the gate's own claim, and the parent was never a
    // spawned child (the port admitted the nodes; the runner started nothing).
    const taskId = result.details.task_id
    expect(taskId.startsWith("st_")).toBe(true)
    const record = rawRecord(harness.store, taskId)
    expect(record.status).toBe("completed")
    expect(record.verification_status).toBe("unverified")
    expect(record.terminal_at).toBeDefined()
    expect(harness.inProcess.startedSpecs).toHaveLength(0)

    // The tool reports the gate claim, not a success of its own: a completed-but-unverified run
    // reads as `unverified`, and the body says so explicitly.
    expect(result.details.status).toBe("unverified")
    expect(result.details.run_epoch).toBe(record.notification.run_epoch)
    expect(result.details.delegation?.run_id).toBe(RUN_ID)
    expect(result.details.delegation?.terminal_status).toBe("completed")
    expect(result.details.delegation?.verification_status).toBe("unverified")
    expect(result.details.delegation?.unresolved).toBe(false)
    expect(result.details.delegation?.outcomes.map((outcome) => outcome.nodeId)).toEqual([
      delegationNodeId("investigate"),
      delegationNodeId("verify"),
    ])
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain(`parent ${taskId}`)
    expect(text).toContain("verification: unverified")
    expect(text).toContain("This is NOT a verified completion")
    expect(text).not.toContain("verification: verified")
    expect(calls).toContain(`startRun:${PARENT_SESSION}`)
  })

  test("#given no admission port #when the task tool starts a delegated parent #then it refuses with admission_unavailable and persists nothing", async () => {
    // given
    const harness = makeHarness()
    const execute = buildTaskExecute(deps(harness.manager, harness.store))

    // when
    const result = await execute("delegated-2", delegatedParams(harness.project), undefined, undefined, ctx(harness.project))

    // then
    expect(result.details.status).toBe("admission_unavailable")
    expect(result.details.task_id).toBe("")
    expect(result.details.reason).toContain("TaskManagerOptions.admission")
    expect(harness.store.list().records).toHaveLength(0)
    expect(harness.inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given an admission port #when the same tool starts an ordinary task #then the ordinary spawn path is unchanged and never consults the port", async () => {
    // given
    const { port, calls } = makePort()
    const harness = makeHarness(port)
    const execute = buildTaskExecute(deps(harness.manager, harness.store))

    // when
    const result = await execute(
      "ordinary-1",
      { prompt: "ordinary child", category: "quick", run_in_background: true },
      undefined,
      undefined,
      ctx(harness.project),
    )

    // then
    expect(result.details.status).toBe("running")
    expect(result.details.task_id.startsWith("st_")).toBe(true)
    expect(result.details.delegation).toBeUndefined()
    expect(harness.store.load(result.details.task_id)?.status).toBe("running")
    expect(harness.inProcess.startedSpecs).toHaveLength(1)
    expect(harness.inProcess.startedSpecs[0]?.prompt).toBe("ordinary child")
    expect(calls).toEqual([])
  })

  test("#given a persisted verified verdict #when the terminal record is read #then the tool surfaces verified without computing it", async () => {
    // given: the real manager produced the record; only the persisted claim reader reports verified,
    // proving the tool projects the gate's word instead of deriving one.
    const { port } = makePort()
    const harness = makeHarness(port)
    const persisted = storeReader(harness.store)
    const execute = buildTaskExecute({
      ...deps(harness.manager),
      readTerminalRecord: (taskId) => {
        const record = persisted(taskId)
        return record === undefined ? undefined : { ...record, verification_status: "verified" }
      },
    })

    // when
    const result = await execute("delegated-verified", delegatedParams(harness.project), undefined, undefined, ctx(harness.project))

    // then
    expect(result.details.status).toBe("completed")
    expect(result.details.delegation?.verification_status).toBe("verified")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("verification: verified")
    expect(text).not.toContain("This is NOT a verified completion")
  })

  test("#given a persisted verified claim with no injected reader #when the delegated start settles #then the manager fallback surfaces the claim instead of undefined", async () => {
    // given: the claim survives the store's own write and parse path, and the manager reads that
    // record. No raw-file reader is wired, so only the typed record lane can carry the verdict.
    const project = tempProject()
    const store = createTaskRecordStore({ project_dir: project })
    const record = makeRecord({
      task_id: "st_00000041",
      status: "completed",
      terminal_at: "2026-01-01T00:01:00.000Z",
    })
    store.save({ ...record, verification_status: "verified" as const })
    // The fake answers the delegation branch only: runDelegatedTask always supplies a delegation
    // spec, so the ordinary overload is declared for type compatibility and never called.
    function fakeDelegatedStart(
      spec: ManagerStartSpec & { readonly delegation: ManagerDelegationSpec },
    ): Promise<StartResult | ManagerDelegatedStartResult>
    function fakeDelegatedStart(spec: ManagerStartSpec): Promise<StartResult>
    function fakeDelegatedStart(): Promise<StartResult | ManagerDelegatedStartResult> {
      return Promise.resolve({
        kind: "delegated",
        runId: RUN_ID,
        task_id: record.task_id,
        outcomes: [],
        unresolved: false,
      })
    }
    const manager = createFakeManager({
      start: fakeDelegatedStart,
      get: (taskId) => store.load(taskId) ?? undefined,
    })
    const toolDeps = deps(manager)
    expect(toolDeps.readTerminalRecord).toBeUndefined()

    // when
    const result = await buildTaskExecute(toolDeps)(
      "delegated-parser-payoff",
      delegatedParams(project),
      undefined,
      undefined,
      ctx(project),
    )

    // then: manager.get is the fallback carrier, and it now returns the persisted claim.
    expect(manager.get(record.task_id)).toMatchObject({ verification_status: "verified" })
    expect(result.details.status).toBe("completed")
    expect(result.details.delegation?.verification_status).toBe("verified")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("verification: verified")
  })

  test("#given a parsed unverified claim and no injected reader #when the delegated start settles #then the tool fails closed to unverified", async () => {
    // given: the real manager's record carries the gate's unverified claim and no raw reader is wired.
    const { port } = makePort()
    const harness = makeHarness(port)
    const execute = buildTaskExecute(deps(harness.manager))

    // when
    const result = await execute("delegated-fail-closed", delegatedParams(harness.project), undefined, undefined, ctx(harness.project))

    // then: the claim is the gate's own unverified word; the tool never upgrades it to verified.
    expect(rawRecord(harness.store, result.details.task_id).verification_status).toBe("unverified")
    expect(harness.manager.get(result.details.task_id)?.verification_status).toBe("unverified")
    expect(result.details.status).toBe("unverified")
    expect(result.details.delegation?.verification_status).toBe("unverified")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("verification: unverified")
    expect(text).not.toContain("verification: verified")
  })

  test("#given delegation and a spawn-only field #when validated #then the field is rejected instead of silently ignored", async () => {
    // given
    const manager = createFakeManager({})
    const execute = buildTaskExecute(deps(manager))

    // when
    const batch = await execute(
      "delegated-batch",
      { ...delegatedParams(), tasks: [{ prompt: "child" }] },
      undefined,
      undefined,
      ctx("/work/project"),
    )
    const background = await execute(
      "delegated-background",
      { ...delegatedParams(), run_in_background: true },
      undefined,
      undefined,
      ctx("/work/project"),
    )

    // then
    expect(batch.details.status).toBe("invalid_arguments")
    expect(background.details.status).toBe("invalid_arguments")
    expect(batch.details.reason).toContain("tasks is not supported with delegation")
    expect(background.details.reason).toContain("run_in_background true is not supported")
  })
})
