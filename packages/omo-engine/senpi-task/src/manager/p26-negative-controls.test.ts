// Phase 2.6 C4 negative controls: twelve committed controls, each one owned invariant.
//
// Every control asserts exactly the same rule, explicitly:
//
//   not (terminal status === "completed" && verification status === "verified")
//
// A control additionally asserts its own post-condition from the p26 matrix. The pair under test is
// always read from a real seam: a manager-owned TaskRecord, the completion gate over evidence the
// production capture wrote, the delegation collector, the panel parser, or the dag-pane service.
// Nothing here invents a run id: ports call the real DAG manager for run identity, and evidence is
// written by createOrdinaryVerificationCapture.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagManager } from "../dag/manager"
import { createDagManager } from "../dag/manager"
import { createDagFileStore } from "../dag/store"
import type { DagNode, DagNodeId, DagNodeState, DagRunId } from "../dag/types"
import type { DagVerifyCheck } from "../dag/verification"
import { buildEngineeringDelegationPlan, collectDelegationResults, delegationNodeId } from "../delegation/plan"
import type { TaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import type { TaskRecordStore } from "../store"
import { approvalAuthorityFor } from "../verification/approval-authority"
import { approveCandidate, readApprovals } from "../verification/approval-store"
import { catalogueFrom } from "../verification/catalogue"
import { evaluateOrdinaryCompletion } from "../verification/completion-gate"
import type { CompletionGateVerdict, VerificationStatus } from "../verification/completion-status"
import { VERIFICATION_CONFIG_VERSION } from "../verification/config"
import { createFileEvidenceStore, workspaceRevision } from "../verification/evidence-store"
import { createOrdinaryVerificationCapture } from "../verification/ordinary-capture"
import { candidateForApproval, resolveCatalogue, WORKSPACE_ID } from "../verification/resolution"
import { baseSpec, categoryPlanner, FakeRunner, settings } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type {
  ManagerAdmissionPort,
  ManagerAdmissionRunRecord,
  ManagerAdmissionTerminal,
  ManagerDelegationSpec,
  ManagerStartSpec,
  TaskManagerOptions,
} from "./types"

const PARENT_SESSION_ID = "p26-controls-parent"
const CHECK_ID = "p26-control-check"

const scratchRoots: string[] = []

function scratchDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  scratchRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// The persisted record carries verification_status on disk; the controls read that raw carrier
// directly so assertions cover the bytes written, exactly like manager-delegation.test.ts.
type RawTaskRecord = TaskRecord & { readonly verification_status?: VerificationStatus }

function rawRecord(store: TaskRecordStore, taskId: string): RawTaskRecord {
  const text = readFileSync(join(store.stateDir, "tasks", `${taskId}.json`), "utf8")
  // SAFETY: the path is the store's own record file, written by the manager under test; only the
  // fields asserted on below are read.
  return JSON.parse(text) as RawTaskRecord
}

type PersistedEvent = { readonly type: string }

function readEvents(store: TaskRecordStore, taskId: string): PersistedEvent[] {
  const path = join(store.stateDir, "logs", `${taskId}.jsonl`)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      // SAFETY: every line is a JSON object appended by the task store's own event writer; this
      // control reads only the event type.
      return JSON.parse(line) as PersistedEvent
    })
}

// ---------------------------------------------------------------------------
// The one invariant.
// ---------------------------------------------------------------------------

type ClaimObservation = {
  readonly terminalStatus: string | undefined
  readonly verificationStatus: string | undefined
}

// THE invariant every control asserts. Written as one explicit boolean rather than an object match
// so no control can quietly soften it.
function expectNeverCompletedVerified(observation: ClaimObservation): void {
  expect(observation.terminalStatus === "completed" && observation.verificationStatus === "verified").toBe(false)
}

// The manager's delegated fold maps the ONE gate vocabulary onto the parent record: only "verified"
// completes the parent, "blocked" fails it, and "unverified" completes it without a claim. This
// projection exists so gate-level controls can state the same pair the fold would write; the
// controls that drive the manager read the pair off the persisted record instead.
function claimFromVerdict(verdict: CompletionGateVerdict): ClaimObservation {
  if (verdict.verification === "verified") {
    return { terminalStatus: "completed", verificationStatus: "verified" }
  }
  if (verdict.verification === "blocked") {
    return { terminalStatus: "error", verificationStatus: "blocked" }
  }
  return { terminalStatus: "completed", verificationStatus: "unverified" }
}

// ---------------------------------------------------------------------------
// Real-seam fixtures.
// ---------------------------------------------------------------------------

const CONTROL_ROLES = [
  { key: "investigate", assignment: "find the seam and report it" },
  { key: "verify", assignment: "report observed evidence only" },
] as const

function delegatedSpec(
  workingDirectory: string,
  options: { readonly deadlineMs?: number; readonly roles?: ManagerDelegationSpec["roles"] } = {},
): ManagerStartSpec & { readonly delegation: ManagerDelegationSpec } {
  const delegation: ManagerDelegationSpec = {
    objective: "prove a p26 negative control can never complete and verify",
    workingDirectory,
    roles: options.roles ?? CONTROL_ROLES,
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  }
  return { ...baseSpec({ parent_session_id: PARENT_SESSION_ID }), delegation }
}

type ScriptedNode = {
  readonly state: DagNodeState
  readonly output: string
}

type PortBehavior = {
  // Node outcomes the scripted children report. Keys are plan node ids, so every id comes from the
  // real plan builder.
  readonly outcomes?: ReadonlyMap<DagNodeId, ScriptedNode>
  // The wait seam. Omitted -> the child settles completed at once.
  readonly wait?: (taskId: string) => Promise<ManagerAdmissionTerminal>
  // Runs inside startRun, after the host took its pre-run baseline (a child-side edit).
  readonly onStart?: () => void
}

type ScriptedPort = {
  readonly port: ManagerAdmissionPort
  readonly cancels: readonly DagRunId[]
  startedRuns(): number
}

// A scripted admission port over the REAL DAG manager: run identity and node ids come from
// dag.start/record, only node outcomes are scripted. This is the same seam shape as
// manager-delegation.test.ts, with no invented run or task id.
function makeScriptedPort(dag: DagManager, behavior: PortBehavior = {}): ScriptedPort {
  const cancels: DagRunId[] = []
  let starts = 0
  const port: ManagerAdmissionPort = {
    startRun: async (spec) => {
      behavior.onStart?.()
      const started = await dag.start({
        definition: spec.definition,
        parentSessionId: spec.parentSessionId,
        rootSessionId: spec.rootSessionId,
      })
      starts += 1
      return { runId: started.snapshot.runId, reused: started.reused }
    },
    admit: async (target) => {
      const nodeId = "nodeId" in target ? target.nodeId : delegationNodeId(target.role, 1)
      return { taskId: nodeId, nodeId }
    },
    wait: async (taskId) => behavior.wait === undefined
      ? { taskId, status: "completed" }
      : behavior.wait(taskId),
    record: (runId) => scriptedRecord(dag, runId, behavior.outcomes),
    cancel: async (runId) => {
      cancels.push(runId)
    },
  }
  return { port, cancels, startedRuns: () => starts }
}

function scriptedRecord(
  dag: DagManager,
  runId: DagRunId,
  outcomes: ReadonlyMap<DagNodeId, ScriptedNode> | undefined,
): ManagerAdmissionRunRecord {
  const record = dag.record(runId, PARENT_SESSION_ID)
  return {
    runId: record.runId,
    nodes: record.nodes.map((node): DagNode => {
      const scripted = outcomes?.get(node.id)
      const output = scripted?.output ?? `done:${node.id}`
      return {
        ...node,
        state: scripted?.state ?? "completed",
        output,
        outputBytes: Buffer.byteLength(output, "utf8"),
      }
    }),
  }
}

type Harness = {
  readonly project: string
  readonly store: TaskRecordStore
  readonly manager: ReturnType<typeof createTaskManager>
}

function makeHarness(project: string, port: ManagerAdmissionPort, stateDir?: string): Harness {
  const store = createTaskRecordStore({
    project_dir: project,
    ...(stateDir === undefined ? {} : { task: { state_dir: stateDir } }),
  })
  const options: TaskManagerOptions = {
    store,
    runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
    verificationAuthorityRoot: join(project, "authority"),
    admission: port,
  }
  return { project, store, manager: createTaskManager(options) }
}

// A real DAG manager. An external state dir keeps store writes out of a git workspace whose changed
// paths feed the verification capture.
function makeDag(project: string, stateDir?: string): DagManager {
  return createDagManager({
    store: createDagFileStore({
      project_dir: project,
      ...(stateDir === undefined ? {} : { task: { state_dir: stateDir } }),
    }),
  })
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" })
}

function gitWorkspace(root: string): string {
  const workspace = join(root, "work")
  mkdirSync(workspace, { recursive: true })
  git(workspace, ["init", "-q"])
  git(workspace, ["config", "user.email", "p26-controls@example.com"])
  git(workspace, ["config", "user.name", "p26-controls"])
  git(workspace, ["config", "commit.gpgsign", "false"])
  return workspace
}

function commitAll(workspace: string, message: string): void {
  git(workspace, ["add", "-A"])
  git(workspace, ["commit", "-qm", message])
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

// Await an observable state change with a bounded deadline. Used only for file effects and the
// service's live map, never as a stand-in for a real event.
async function waitForCondition(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadlineAt = Date.now() + timeoutMs
  while (Date.now() < deadlineAt) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return check()
}

// The panel and the dag-pane service are shipped guest surfaces in another package. They are loaded
// at their real paths (computed, not statically resolved) so this engine suite exercises the shipped
// code without adding a cross-package type dependency to the engine program.
function guestSurface(relativePath: string) {
  const url = new URL(relativePath, import.meta.url).href
  return import(url)
}

const PANEL_DAG_VIEW = "../../../../extensions/dag-pane/panel/dag-view.ts"
const PANEL_ACTIVITY_VIEW = "../../../../extensions/dag-pane/panel/activity-view.ts"
const DAG_SERVICE_HANDLERS = "../../../../extensions/dag-pane/service/handlers.js"

describe("p26 C4 negative controls", () => {
  // N1 ---------------------------------------------------------------------
  test("N1 #given one failed child #when the delegated parent folds #then it fails and is never completed+verified", async () => {
    // given: the real DAG run, with the verify node reporting failure.
    const project = scratchDir("senpi-p26-n1-")
    const port = makeScriptedPort(makeDag(project), {
      outcomes: new Map([[delegationNodeId("verify"), { state: "failed", output: "the verify child failed" }]]),
    })
    const harness = makeHarness(project, port.port)

    // when
    const result = await harness.manager.start(delegatedSpec(project))

    // then
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    expect(result.outcomes.some((outcome) => outcome.outcome === "failed")).toBe(true)
    const terminal = rawRecord(harness.store, result.task_id)
    expect(terminal.status).toBe("error")
    expect(terminal.error_message).toContain("ended failed")
    expect(terminal.verification_status).toBeUndefined()
    expectNeverCompletedVerified({ terminalStatus: terminal.status, verificationStatus: terminal.verification_status })
  })

  // N2 ---------------------------------------------------------------------
  test("N2 #given a child wait that outlives the deadline #when the budget elapses #then the typed deadline refusal never completes or verifies", async () => {
    // given: the run identity is real, and the wait never settles. The budget is the only way out.
    const project = scratchDir("senpi-p26-n2-")
    const port = makeScriptedPort(makeDag(project), { wait: () => new Promise(() => {}) })
    const harness = makeHarness(project, port.port)

    // when
    const result = await harness.manager.start(delegatedSpec(project, { deadlineMs: 500 }))

    // then: the caller gets the typed deadline error, not a success shape.
    expect(result.kind).toBe("deadline_unavailable_at_manager_seam")
    if (result.kind !== "deadline_unavailable_at_manager_seam") {
      throw new Error(`expected the typed deadline error, received ${result.kind}`)
    }
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("deadline of 500ms elapsed")
    expect(result.reason).toContain("while admitted children were running")
    expect(port.cancels).toHaveLength(1)
    expect(port.cancels[0]).toBe(result.runId)

    // The parent terminal is the deadline failure: no verification claim was stamped.
    const parent = harness.store.list().records[0]
    expect(parent?.status).toBe("error")
    const terminal = rawRecord(harness.store, parent?.task_id ?? "")
    expect(terminal.error_message).toContain("deadline of 500ms elapsed")
    expect(terminal.verification_status).toBeUndefined()
    expectNeverCompletedVerified({ terminalStatus: terminal.status, verificationStatus: terminal.verification_status })
  })

  // N3 ---------------------------------------------------------------------
  test("N3 #given a live delegated parent #when it is cancelled #then cancellation stays terminal and publishes no verdict", async () => {
    // given
    const project = scratchDir("senpi-p26-n3-")
    let releaseWait: (terminal: ManagerAdmissionTerminal) => void = () => {}
    let signalWait: () => void = () => {}
    const waitEntered = new Promise<void>((resolve) => {
      signalWait = resolve
    })
    const parked = new Promise<ManagerAdmissionTerminal>((resolve) => {
      releaseWait = resolve
    })
    const port = makeScriptedPort(makeDag(project), {
      wait: (taskId) => {
        signalWait()
        return parked.then(() => ({ taskId, status: "completed" }))
      },
    })
    const harness = makeHarness(project, port.port)
    const start = harness.manager.start(delegatedSpec(project))

    // when: the parent is cancelled while its admitted children are parked.
    await waitEntered
    const parent = harness.store.list().records[0]
    expect(parent).toBeDefined()
    if (parent === undefined) throw new Error("the delegated parent was never claimed")
    const cancelled = await harness.manager.cancelTask(parent.task_id, "p26 N3 parent cancellation")
    releaseWait({ taskId: "parked", status: "completed" })
    await start

    // then: the cancel terminal stands; the late fold wrote nothing.
    expect(cancelled.kind).toBe("cancelled")
    const terminal = rawRecord(harness.store, parent.task_id)
    expect(terminal.status).toBe("cancelled")
    expect(terminal.verification_status).toBeUndefined()
    expect(terminal.final_response).toBeUndefined()
    const eventTypes = readEvents(harness.store, parent.task_id).map((event) => event.type)
    expect(eventTypes.some((type) => type === "verification_blocked" || type === "verification_unverified")).toBe(false)
    expectNeverCompletedVerified({ terminalStatus: terminal.status, verificationStatus: terminal.verification_status })
  })

  // N4 ---------------------------------------------------------------------
  test("N4 #given the identical delegation plan dispatched twice #when the engine starts it #then one run and one node set exist, never a second verified parent", async () => {
    // given: the plan builder is deterministic and the real DAG manager keys reuse by fingerprint.
    const project = scratchDir("senpi-p26-n4-")
    const request = {
      objective: "prove duplicate dispatch reuses one run",
      workingDirectory: project,
      roles: CONTROL_ROLES,
    } as const
    const firstPlan = buildEngineeringDelegationPlan(request)
    const secondPlan = buildEngineeringDelegationPlan(request)
    if (!firstPlan.ok || !secondPlan.ok) throw new Error("the control plan was rejected")
    expect(secondPlan.definition.key).toBe(firstPlan.definition.key)

    const store = createDagFileStore({ project_dir: project })
    const dag = createDagManager({ store })

    // when
    const first = await dag.start({ definition: firstPlan.definition, parentSessionId: PARENT_SESSION_ID, rootSessionId: PARENT_SESSION_ID })
    const second = await dag.start({ definition: secondPlan.definition, parentSessionId: PARENT_SESSION_ID, rootSessionId: PARENT_SESSION_ID })

    // then: one run, one child set, no second dispatch.
    expect(second.reused).toBe(true)
    expect(second.snapshot.runId).toBe(first.snapshot.runId)
    expect(second.snapshot.nodes.map((node) => node.id)).toEqual(first.snapshot.nodes.map((node) => node.id))
    expect(second.snapshot.nodes).toHaveLength(CONTROL_ROLES.length)
    const runFiles = existsSync(store.paths.runs)
      ? readdirSync(store.paths.runs).filter((entry) => entry.endsWith(".json"))
      : []
    expect(runFiles).toHaveLength(1)
    expectNeverCompletedVerified({ terminalStatus: second.snapshot.status, verificationStatus: undefined })
  })

  // N5 ---------------------------------------------------------------------
  test("N5 #given a duplicate terminal delivery for one node #when the collector folds it #then one outcome exists and no verification claim is created", async () => {
    // given: two deliveries name the same real plan node id.
    const project = scratchDir("senpi-p26-n5-")
    const plan = buildEngineeringDelegationPlan({
      objective: "prove duplicate delivery collapses",
      workingDirectory: project,
      roles: [{ key: "review", assignment: "review the change" }],
    })
    if (!plan.ok) throw new Error("the control plan was rejected")
    const dag = createDagManager({ store: createDagFileStore({ project_dir: project }) })
    const started = await dag.start({ definition: plan.definition, parentSessionId: PARENT_SESSION_ID, rootSessionId: PARENT_SESSION_ID })
    const authoritative = dag.record(started.snapshot.runId, PARENT_SESSION_ID).nodes[0]
    if (authoritative === undefined) throw new Error("the plan produced no node")
    const firstDelivery: DagNode = {
      ...authoritative,
      state: "completed",
      taskId: "first-delivery",
      output: "found it",
      outputBytes: Buffer.byteLength("found it", "utf8"),
    }
    const secondDelivery: DagNode = {
      ...firstDelivery,
      taskId: "second-delivery",
      output: "found it again",
      outputBytes: Buffer.byteLength("found it again", "utf8"),
    }

    // when
    const collection = collectDelegationResults([firstDelivery, secondDelivery])

    // then
    expect(collection.results).toHaveLength(1)
    expect(collection.duplicatesIgnored).toBe(1)
    expect(collection.results[0]?.nodeId).toBe(authoritative.id)
    expect(collection.results[0]?.outputBytes).toBe(Buffer.byteLength("found it again", "utf8"))
    expect(Object.keys(collection).sort()).toEqual(["duplicatesIgnored", "results"])
    expectNeverCompletedVerified({
      terminalStatus: collection.results[0]?.outcome === "completed" ? "completed" : "error",
      verificationStatus: undefined,
    })
  })

  // N6 ---------------------------------------------------------------------
  test("N6 #given a passed check from another epoch #when the gate is asked #then the same evidence is refused as stale and never verifies", async () => {
    // given: real evidence written by the production capture against a real git revision.
    const root = scratchDir("senpi-p26-n6-")
    const workspace = gitWorkspace(root)
    writeFileSync(join(workspace, "src.txt"), "before-edit\n")
    commitAll(workspace, "p26 N6 fixture")
    const dag = makeDag(root)
    const started = await dag.start({
      definition: { key: "p26-n6-stale-epoch", name: "p26 N6", nodes: [{ id: "stale-epoch-check", prompt: "run the check", category: "quick" }] },
      parentSessionId: PARENT_SESSION_ID,
      rootSessionId: PARENT_SESSION_ID,
    })
    const runId = started.snapshot.runId
    const evidenceRoot = join(root, "evidence")
    const check: DagVerifyCheck = {
      checkId: CHECK_ID,
      category: "unit",
      command: ["node", "-e", "process.stdout.write('ok')"],
      timeoutMs: 10_000,
      criteria: ["the fixture check runs"],
      coveredPaths: [],
    }
    const catalogue = catalogueFrom([{
      check,
      provenance: { source: "config", location: ".alcode/verification.json", reason: "p26 N6 control fixture" },
    }])
    const capture = createOrdinaryVerificationCapture({
      store: createFileEvidenceStore(evidenceRoot),
      projectDir: workspace,
      currentRevision: () => workspaceRevision(workspace),
    })
    const captured = await capture.capture({ binding: { taskId: runId, sessionId: PARENT_SESSION_ID, epoch: 0 }, changedFiles: [], available: [check] })
    expect(captured.records[0]?.status).toBe("passed")

    // when: the same record is read under the epoch it was written for, then one epoch later.
    const sameEpoch = evaluateOrdinaryCompletion({ taskId: runId, catalogue, evidenceRoot, workspaceDir: workspace, epoch: 0 })
    const staleEpoch = evaluateOrdinaryCompletion({ taskId: runId, catalogue, evidenceRoot, workspaceDir: workspace, epoch: 1 })

    // then
    expect(sameEpoch.verification).toBe("verified")
    expect(staleEpoch.verification).toBe("blocked")
    if (staleEpoch.verification !== "blocked") throw new Error("expected a blocked stale verdict")
    expect(staleEpoch.code).toBe("verification_stale")
    expectNeverCompletedVerified(claimFromVerdict(staleEpoch))
  })

  // N7 ---------------------------------------------------------------------
  test("N7 #given a completed child with no usable output #when the parent folds #then it is classified unusable and fails, never completed+verified", async () => {
    // given: the node completed but returned zero bytes.
    const project = scratchDir("senpi-p26-n7-")
    const port = makeScriptedPort(makeDag(project), {
      outcomes: new Map([[delegationNodeId("verify"), { state: "completed", output: "" }]]),
    })
    const harness = makeHarness(project, port.port)

    // when
    const result = await harness.manager.start(delegatedSpec(project))

    // then
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    const collected = collectDelegationResults(port.port.record(result.runId).nodes)
    const verifyOutcome = collected.results.find((outcome) => outcome.nodeId === delegationNodeId("verify"))
    expect(verifyOutcome?.outcome).toBe("unusable")
    expect(verifyOutcome?.outputBytes).toBe(0)

    const terminal = rawRecord(harness.store, result.task_id)
    expect(terminal.status).toBe("error")
    expect(terminal.error_message).toContain("ended unusable")
    expect(terminal.verification_status).toBeUndefined()
    expectNeverCompletedVerified({ terminalStatus: terminal.status, verificationStatus: terminal.verification_status })
  })

  // N8 ---------------------------------------------------------------------
  test("N8 #given conflicting implement recommendations #when the plan is built #then it is blocked before any run and the workspace file is unchanged", async () => {
    // given
    const project = scratchDir("senpi-p26-n8-")
    const target = join(project, "summary.txt")
    writeFileSync(target, "unchanged\n")
    const before = sha256File(target)
    const port = makeScriptedPort(makeDag(project))
    const harness = makeHarness(project, port.port)

    // when: two implement roles disagree about who owns the edit.
    const result = await harness.manager.start(delegatedSpec(project, {
      roles: [
        { key: "implement", assignment: "rewrite summary.txt one way" },
        { key: "implement", assignment: "rewrite summary.txt another way" },
      ],
    }))

    // then: the block is a plan rejection before a parent or run exists.
    expect(result.kind).toBe("delegation_plan_rejected")
    if (result.kind !== "delegation_plan_rejected") throw new Error(`expected a plan rejection, received ${result.kind}`)
    expect(result.code).toBe("conflicting_implement_roles")
    expect(harness.store.list().records).toHaveLength(0)
    expect(port.startedRuns()).toBe(0)
    expect(sha256File(target)).toBe(before)
    expectNeverCompletedVerified({ terminalStatus: undefined, verificationStatus: undefined })
  })

  // N9 ---------------------------------------------------------------------
  test("N9 #given an approved check that fails after the edit #when the parent folds #then it stays blocked and never completes+verifies", async () => {
    // given: a real git tree, a real approval, and a check that runs and fails.
    const root = scratchDir("senpi-p26-n9-")
    const workspace = gitWorkspace(root)
    const stateDir = join(root, "state")
    writeFileSync(join(workspace, "src.txt"), "before-edit\n")
    const markerPath = join(root, "check-executed.txt")
    mkdirSync(join(workspace, ".alcode"), { recursive: true })
    writeFileSync(join(workspace, ".alcode", "verification.json"), JSON.stringify({
      version: 1,
      checks: [{
        id: CHECK_ID,
        name: "p26 failing post-edit check",
        category: "unit",
        command: [
          "node",
          "-e",
          "require('fs').writeFileSync(process.argv[1],'executed'); process.exit(3)",
          markerPath,
        ],
        timeoutMs: 10_000,
      }],
    }))
    commitAll(workspace, "p26 N9 fixture")
    const authority = approvalAuthorityFor(workspace, join(root, "authority"))
    const candidate = candidateForApproval({ projectRoot: workspace, workspaceId: WORKSPACE_ID, changedFiles: null, checkId: CHECK_ID })
    if (candidate === null) throw new Error("the fixture catalogue did not expose the check")
    approveCandidate({
      authority,
      candidate,
      workspaceId: WORKSPACE_ID,
      configVersion: VERIFICATION_CONFIG_VERSION,
      approvedBy: "alcode:p26-n9-control",
    })
    const preEditRevision = workspaceRevision(workspace)
    const port = makeScriptedPort(makeDag(workspace, stateDir), {
      // The child-side edit happens after the host's baseline and before the fold's capture.
      onStart: () => appendFileSync(join(workspace, "src.txt"), "after-edit\n"),
    })
    const store = createTaskRecordStore({ project_dir: workspace, task: { state_dir: stateDir } })
    const manager = createTaskManager({
      store,
      runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
      planner: categoryPlanner(),
      config: settings({ default_concurrency: 5, max_depth: 1 }),
      cwd: workspace,
      verificationAuthorityRoot: authority.root,
      admission: port.port,
    })

    // when
    const result = await manager.start(delegatedSpec(workspace, {
      roles: [{ key: "implement", assignment: "append after-edit to src.txt" }],
    }))

    // then: the edit happened, the check executed, and the gate blocked the parent.
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    expect(readFileSync(join(workspace, "src.txt"), "utf8")).toContain("after-edit")
    expect(workspaceRevision(workspace)).not.toBe(preEditRevision)
    expect(existsSync(markerPath)).toBe(true)
    const terminal = rawRecord(store, result.task_id)
    expect(terminal.status).toBe("error")
    expect(terminal.verification_status).toBe("blocked")
    expect(terminal.error_message).toContain("completion blocked: verification_failed")

    const approvals = readApprovals(authority, WORKSPACE_ID)
    const gate = resolveCatalogue({ projectRoot: workspace, workspaceId: WORKSPACE_ID, changedFiles: null, authority, approvals })
    const verdict = evaluateOrdinaryCompletion({
      taskId: result.task_id,
      catalogue: gate,
      evidenceRoot: join(store.stateDir, "verifications"),
      workspaceDir: workspace,
      epoch: terminal.notification.run_epoch,
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("expected a blocked verdict")
    expect(verdict.code).toBe("verification_failed")
    expectNeverCompletedVerified({ terminalStatus: terminal.status, verificationStatus: terminal.verification_status })
  })

  // N10 --------------------------------------------------------------------
  test("N10 #given no approved catalogue #when the delegated parent folds #then it completes unverified and the panel fails closed", async () => {
    // given: no verification config and no approval anywhere in the workspace.
    const project = scratchDir("senpi-p26-n10-")
    const port = makeScriptedPort(makeDag(project))
    const harness = makeHarness(project, port.port)

    // when
    const result = await harness.manager.start(delegatedSpec(project))

    // then: the run completes, but no verification is claimed.
    expect(result.kind).toBe("delegated")
    if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)
    const terminal = rawRecord(harness.store, result.task_id)
    expect(terminal.status).toBe("completed")
    expect(terminal.verification_status).toBe("unverified")
    const events = readEvents(harness.store, result.task_id)
    expect(events.some((event) => event.type === "verification_unverified")).toBe(true)

    // The named gate states are unverified too: no catalogue, and candidates nobody approved.
    const evidenceRoot = join(harness.store.stateDir, "verifications")
    const epoch = terminal.notification.run_epoch
    const noCatalogue = evaluateOrdinaryCompletion({
      taskId: result.task_id,
      catalogue: { status: "none", reason: "no verification checks are declared for this workspace" },
      evidenceRoot,
      workspaceDir: project,
      epoch,
    })
    const unapproved = evaluateOrdinaryCompletion({
      taskId: result.task_id,
      catalogue: { status: "approval_required", pending: [CHECK_ID], reason: "candidate checks exist but none is approved" },
      evidenceRoot,
      workspaceDir: project,
      epoch,
    })
    expect(noCatalogue.verification).toBe("unverified")
    expect(unapproved.verification).toBe("unverified")

    // The panel projection of a completed record with no verification_status is unverified too.
    const activity = await guestSurface(PANEL_ACTIVITY_VIEW)
    expect(activity.formatVerificationStatus(undefined)).toBe("unverified")
    expectNeverCompletedVerified({ terminalStatus: terminal.status, verificationStatus: terminal.verification_status })
    expectNeverCompletedVerified(claimFromVerdict(noCatalogue))
    expectNeverCompletedVerified(claimFromVerdict(unapproved))
  })

  // N11 --------------------------------------------------------------------
  test("N11 #given a repaired record with no verification_status #when the panel projects it #then it renders unverified, never verified", async () => {
    // given: a success-shaped repair state whose gate claim is missing.
    const panelView = await guestSurface(PANEL_DAG_VIEW)
    const activity = await guestSurface(PANEL_ACTIVITY_VIEW)
    const repair = {
      attemptId: "repair-attempt-1",
      taskId: "task-without-claim",
      epoch: 1,
      state: "repaired",
      failedChecks: [],
      rerunChecks: [],
      changedFiles: [],
      hostFacts: [],
      modelHypotheses: [],
      updatedAt: 1,
    }
    const doc = {
      schemaVersion: 1,
      sessionId: "ses_p26_n11",
      updatedAt: "2026-11-08T00:00:00.000Z",
      dag: {
        runs: [{
          run_id: "run-without-claim",
          run_key: "p26-n11",
          name: "p26 N11",
          status: "completed",
          nodes: [],
          edges: [],
          waves: [],
          repair,
        }],
      },
      tasks: { tasks: [{ task_id: "task-without-claim", status: "completed", repair }] },
    }

    // when
    const outcome = panelView.parseSnapshotDoc(doc)

    // then
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("the panel rejected a well-formed snapshot")
    const run = outcome.view.runs[0]
    expect(run.repair.state).toBe("repaired")
    expect(run.repair.verificationStatus).toBeNull()
    expect(activity.formatVerificationStatus(run.repair.verificationStatus)).toBe("unverified")
    expect(JSON.stringify(run.repair)).not.toContain("verified")
    expectNeverCompletedVerified({
      terminalStatus: run.status,
      verificationStatus: activity.formatVerificationStatus(run.repair.verificationStatus),
    })
  })

  // N12 --------------------------------------------------------------------
  test("N12 #given a synthetic steer document and a project engine document #when the pane serves them #then the synthetic doc never verifies and never masks the engine doc", async () => {
    // given: the real service, a real quick child, and a project-scoped engine document.
    const root = scratchDir("senpi-p26-n12-")
    const snapshotDir = join(root, "snapshots")
    mkdirSync(snapshotDir, { recursive: true })
    const projectDir = join(root, "project")
    mkdirSync(projectDir, { recursive: true })
    const handlersModule = await guestSurface(DAG_SERVICE_HANDLERS)
    const quickBridge = (exitCode: number) => ({
      probe: async () => ({ available: true, compatible: true, code: "OMO_PROBE_OK" }),
      invoke: ({ message, sessionId }: { message: string; sessionId: string }) => {
        const child = spawn(process.execPath, ["-e", exitCode === 0 ? "" : "process.exit(1)"], { stdio: "ignore", windowsHide: true })
        const wait = () => new Promise((resolve) => {
          child.on("close", (code: number | null, signal: string | null) => resolve({ exitCode: code, signal, result: null, sessionId }))
        })
        return { entry: "p26-stub", argv: ["run", message], child, writer: null, wait, cancel: async () => ({ ok: true }) }
      },
    })
    const service = handlersModule.createDagServiceHandlers({
      fs: (await import("node:fs")).default,
      snapshotDir,
      createBridge: () => quickBridge(0),
    })
    const sessionId = "ses_p26_n12_synthetic"
    const syntheticPath = join(snapshotDir, `${sessionId}.snapshot.json`)

    // when: a steer settles with no engine document present -> the guarded synthetic fallback lands.
    const steered = await service.handleRequest({ method: "POST", path: "/steer", body: { message: "p26 n12 steer", sessionId, directory: projectDir } })
    expect(steered.status).toBe(200)
    expect(await waitForCondition(() => existsSync(syntheticPath))).toBe(true)
    const synthetic = JSON.parse(readFileSync(syntheticPath, "utf8"))
    const servedSynthetic = await service.handleRequest({ method: "GET", path: "/snapshot", query: { sessionId } })

    // then: the synthetic document is completed but carries no verification claim at all.
    expect(servedSynthetic.status).toBe(200)
    expect(synthetic.tasks).toBeNull()
    expect(synthetic.dag.runs[0].run_key).toBe(`steer:${sessionId}`)
    expect(synthetic.verification_status).toBeUndefined()
    expect(servedSynthetic.body.verification_status).toBeUndefined()
    const panelView = await guestSurface(PANEL_DAG_VIEW)
    const parsedSynthetic = panelView.parseSnapshotDoc(synthetic)
    expect(parsedSynthetic.ok).toBe(true)
    if (!parsedSynthetic.ok) throw new Error("the panel rejected the synthetic document")
    expect(JSON.stringify(parsedSynthetic.view)).not.toContain("verified")
    expectNeverCompletedVerified({
      terminalStatus: synthetic.dag.runs[0].status,
      verificationStatus: synthetic.verification_status,
    })

    // and: a project engine document outranks the temp synthetic one, regardless of age.
    const engineDoc = {
      schemaVersion: 1,
      sessionId,
      updatedAt: "2026-11-08T00:00:00.000Z",
      directory: projectDir,
      dag: {
        runs: [{
          run_id: "engine-run",
          run_key: "engine-run",
          name: "engine run",
          status: "running",
          nodes: [],
          edges: [],
          waves: [],
        }],
      },
      tasks: { tasks: [{ task_id: "engine-task", status: "completed" }] },
    }
    const engineDir = join(projectDir, ".omo", "dag-runs")
    mkdirSync(engineDir, { recursive: true })
    writeFileSync(join(engineDir, `${sessionId}.snapshot.json`), JSON.stringify(engineDoc))
    const servedEngine = await service.handleRequest({ method: "GET", path: "/snapshot", query: { sessionId, directory: projectDir } })
    expect(servedEngine.status).toBe(200)
    expect(servedEngine.body.dag.runs[0].run_key).toBe("engine-run")
    expect(servedEngine.body.tasks.tasks[0].task_id).toBe("engine-task")

    // and: settleSteer refuses to write a synthetic document beside an engine document.
    const guardedSessionId = "ses_p26_n12_guarded"
    writeFileSync(join(engineDir, `${guardedSessionId}.snapshot.json`), JSON.stringify({ ...engineDoc, sessionId: guardedSessionId }))
    const guarded = await service.handleRequest({ method: "POST", path: "/steer", body: { message: "p26 n12 guarded steer", sessionId: guardedSessionId, directory: projectDir } })
    expect(guarded.status).toBe(200)
    expect(await waitForCondition(() => !service.live.has(guardedSessionId))).toBe(true)
    expect(existsSync(join(snapshotDir, `${guardedSessionId}.snapshot.json`))).toBe(false)
  })
})
