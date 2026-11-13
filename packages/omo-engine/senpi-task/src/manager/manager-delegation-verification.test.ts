// The delegated completion gate must read evidence the PRODUCTION path wrote, keyed by the PARENT
// task - never by the reusable DAG run id.
//
// This file drives real delegated starts over a git fixture with a real approved catalogue. The
// catalogue's single check passes only when the workspace says "after-edit", and only the port's
// simulated implement node writes that text. A "verified" terminal therefore proves the host ran the
// approved check against the POST-EDIT tree and the gate read the evidence that run wrote - not a
// hand-authored record and not a record from another parent or epoch.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { compileDag } from "../dag/graph"
import type { DagNode, DagRunId } from "../dag/types"
import { parseVerificationRecord } from "../dag/verification"
import { delegationNodeId } from "../delegation/plan"
import type { TaskRecord } from "../state"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import { approvalAuthorityFor, type ApprovalAuthority } from "../verification/approval-authority"
import { approveCandidate, readApprovals } from "../verification/approval-store"
import type { OrdinaryCatalogue } from "../verification/catalogue"
import { evaluateOrdinaryCompletion } from "../verification/completion-gate"
import type { VerificationStatus } from "../verification/completion-status"
import { VERIFICATION_CONFIG_VERSION } from "../verification/config"
import { readCaptureReceipt, verificationReceiptRoot, workspaceRevision } from "../verification/evidence-store"
import { ORDINARY_VERIFICATION_NODE } from "../verification/ordinary-capture"
import { candidateForApproval, resolveCatalogue, WORKSPACE_ID } from "../verification/resolution"
import { baseSpec, categoryPlanner, FakeRunner, settings } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type {
  ManagerAdmissionPort,
  ManagerAdmissionRunRecord,
  ManagerDelegatedStartResult,
  ManagerDelegationSpec,
  ManagerStartSpec,
  TaskManagerOptions,
} from "./types"

// SAFETY: DagRunId is a branded string, and this literal only names the fake port's run.
const RUN_ID = "dag_delegation_gate_evidence" as DagRunId
const CHECK_ID = "post-edit-build-check"

// The persisted record carries verification_status on disk; the test reads that raw carrier
// directly so assertions cover the bytes written, not only the parsed view, exactly like
// manager-delegation.test.ts.
type RawTaskRecord = TaskRecord & { readonly verification_status?: VerificationStatus }

function rawRecord(store: TaskRecordStore, taskId: string): RawTaskRecord {
  const text = readFileSync(join(store.stateDir, "tasks", `${taskId}.json`), "utf8")
  // SAFETY: the path is the store's own record file, written by the manager under test; only the
  // fields asserted on below are read.
  return JSON.parse(text) as RawTaskRecord
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...args], { cwd, stdio: "ignore" })
}

function verificationConfig(markerPath: string): string {
  return JSON.stringify({
    version: 1,
    checks: [
      {
        id: CHECK_ID,
        name: "post-edit build check",
        // build is the category the pre-fix selection policy always dropped for an ordinary scope,
        // while the completion gate demanded every catalogue check.
        category: "build",
        // Writes an execution receipt OUTSIDE the workspace and passes only against the edited
        // tree. The host, not the test, supplies the status and the marker is never written here.
        command: [
          "node",
          "-e",
          "require('fs').writeFileSync(process.argv[1],'executed'); if (!require('fs').readFileSync('src/sum.js','utf8').includes('after-edit')) process.exit(3)",
          markerPath,
        ],
        timeoutMs: 10_000,
      },
    ],
  })
}

type PortOptions = {
  readonly edit: boolean
  // Runs at the START of the port's startRun, i.e. after the manager took its spawn-time baseline
  // and before the delegated fold. Used to restore a deliberately corrupted git index.
  readonly onStartRun?: () => void
  readonly onDefinition?: (key: string) => void
}

// The port owns admission, so the "implement" edit happens inside startRun: after the host took its
// pre-run baseline and before the delegated fold runs the catalogue.
function makePort(workspace: string, options: PortOptions): ManagerAdmissionPort {
  let persisted: ManagerAdmissionRunRecord | undefined
  return {
    startRun: async (spec) => {
      options.onStartRun?.()
      options.onDefinition?.(spec.definition.key)
      if (options.edit) appendFileSync(join(workspace, "src/sum.js"), "after-edit\n")
      const compiled = compileDag(spec.definition, { at: "2026-01-01T00:00:00.000Z" })
      if (!compiled.ok) throw new Error(compiled.errors.map((error) => error.message).join("; "))
      persisted = {
        runId: RUN_ID,
        nodes: compiled.nodes.map((node): DagNode => ({
          ...node,
          state: "completed",
          taskId: `st_${node.id}`,
          output: "done",
          outputBytes: "done".length,
        })),
      }
      return { runId: RUN_ID }
    },
    admit: async (target) => {
      const nodeId = "nodeId" in target ? target.nodeId : delegationNodeId(target.role, 1)
      return { taskId: `st_${nodeId}`, nodeId }
    },
    wait: async (taskId) => ({ taskId, status: "completed" }),
    record: () => {
      if (persisted === undefined) throw new Error("no run was started")
      return persisted
    },
  }
}

function managerOptions(
  workspace: string,
  store: TaskRecordStore,
  authority: ApprovalAuthority,
  port: ManagerAdmissionPort,
): TaskManagerOptions {
  return {
    store,
    runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: workspace,
    verificationAuthorityRoot: authority.root,
    admission: port,
  }
}

function delegatedSpec(workspace: string): ManagerStartSpec & { readonly delegation: ManagerDelegationSpec } {
  return {
    ...baseSpec({ cwd: workspace }),
    delegation: {
      objective: "prove the delegated gate reads parent-task evidence",
      workingDirectory: workspace,
      roles: [{ key: "implement", assignment: "append after-edit to src/sum.js" }],
    },
  }
}

type Fixture = {
  readonly root: string
  readonly workspace: string
  readonly stateDir: string
  readonly store: TaskRecordStore
  readonly authority: ApprovalAuthority
  readonly evidenceRoot: string
  readonly markerPath: string
  readonly preEditRevision: string
  readonly result: Extract<ManagerDelegatedStartResult, { readonly kind: "delegated" }>
  readonly terminal: RawTaskRecord
  readonly gate: OrdinaryCatalogue
  readonly definitionKeys: readonly string[]
}

async function driveDelegatedFixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "senpi-delegation-gate-"))
  const workspace = join(root, "work")
  mkdirSync(workspace, { recursive: true })
  git(workspace, ["init"])
  git(workspace, ["config", "user.email", "delegation-gate@example.com"])
  git(workspace, ["config", "user.name", "delegation-gate"])
  mkdirSync(join(workspace, "src"), { recursive: true })
  writeFileSync(join(workspace, "src", "sum.js"), "before-edit\n")
  const markerPath = join(root, "check-executed.txt")
  mkdirSync(join(workspace, ".alcode"), { recursive: true })
  writeFileSync(join(workspace, ".alcode", "verification.json"), verificationConfig(markerPath))
  git(workspace, ["add", "-A"])
  git(workspace, ["commit", "-m", "delegation gate fixture"])

  // A real approval, recorded through the host action - no approval record is hand-written.
  const authority = approvalAuthorityFor(workspace, join(root, "authority"))
  const candidate = candidateForApproval({
    projectRoot: workspace,
    workspaceId: WORKSPACE_ID,
    changedFiles: null,
    checkId: CHECK_ID,
  })
  if (candidate === null) throw new Error("the fixture catalogue did not expose the check")
  approveCandidate({
    authority,
    candidate,
    workspaceId: WORKSPACE_ID,
    configVersion: VERIFICATION_CONFIG_VERSION,
    approvedBy: "alcode:delegation-gate-test",
  })

  const stateDir = join(root, "state")
  const store = createTaskRecordStore({ project_dir: workspace, task: { state_dir: stateDir } })
  const definitionKeys: string[] = []
  const manager = createTaskManager(managerOptions(
    workspace,
    store,
    authority,
    makePort(workspace, { edit: true, onDefinition: (key) => definitionKeys.push(key) }),
  ))
  const preEditRevision = workspaceRevision(workspace)
  const result = await manager.start(delegatedSpec(workspace))
  if (result.kind !== "delegated") throw new Error(`expected delegated, received ${result.kind}`)

  const terminal = rawRecord(store, result.task_id)
  const approvals = readApprovals(authority, WORKSPACE_ID)
  const gate = resolveCatalogue({
    projectRoot: workspace,
    workspaceId: WORKSPACE_ID,
    changedFiles: null,
    authority,
    approvals,
  })
  return {
    root,
    workspace,
    stateDir,
    store,
    authority,
    evidenceRoot: join(stateDir, "verifications"),
    markerPath,
    preEditRevision,
    result,
    terminal,
    gate,
    definitionKeys,
  }
}

// A bounded wait for an observable file. The deadline race means `start` returns long before the
// slow check ends, so the test must wait for the check's own effects instead of assuming them.
async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadlineAt = Date.now() + timeoutMs
  while (Date.now() < deadlineAt) {
    if (existsSync(path)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return existsSync(path)
}

type SlowCaptureFixture = {
  readonly root: string
  readonly store: TaskRecordStore
  readonly markerPath: string
  readonly evidenceRoot: string
  readonly taskId: string
  readonly result: ManagerDelegatedStartResult
  readonly elapsedMs: number
  readonly deadlineMs: number
}

// The approved check writes its marker immediately, optionally moves the parent's run epoch from
// INSIDE the capture, then keeps running past the budget and only afterwards would pass. A check
// that finishes is what the pre-fix code folded into a completed+verified parent.
function slowCheckCommand(options: {
  readonly markerPath: string
  readonly stateDir: string
  readonly waitMs: number
  readonly bumpEpoch: boolean
}): readonly string[] {
  const body = [
    "const fs = require('fs')",
    "const path = require('path')",
    `fs.writeFileSync(${JSON.stringify(options.markerPath)}, 'executed')`,
    ...(options.bumpEpoch
      ? [
          `const tasksDir = ${JSON.stringify(join(options.stateDir, "tasks"))}`,
          "for (const name of fs.readdirSync(tasksDir)) {",
          "  const file = path.join(tasksDir, name)",
          "  const record = JSON.parse(fs.readFileSync(file, 'utf8'))",
          "  record.notification.run_epoch = record.notification.run_epoch + 1",
          "  fs.writeFileSync(file, JSON.stringify(record))",
          "}",
        ]
      : []),
    `setTimeout(() => { if (!fs.readFileSync('src/sum.js', 'utf8').includes('after-edit')) process.exit(3) }, ${options.waitMs})`,
  ].join("\n")
  return ["node", "-e", body]
}

async function driveSlowCaptureFixture(options: {
  readonly deadlineMs: number
  readonly checkWaitMs: number
  readonly bumpEpoch?: boolean
}): Promise<SlowCaptureFixture> {
  const root = mkdtempSync(join(tmpdir(), "senpi-delegation-capture-deadline-"))
  const workspace = join(root, "work")
  mkdirSync(workspace, { recursive: true })
  git(workspace, ["init"])
  git(workspace, ["config", "user.email", "delegation-deadline@example.com"])
  git(workspace, ["config", "user.name", "delegation-deadline"])
  mkdirSync(join(workspace, "src"), { recursive: true })
  writeFileSync(join(workspace, "src", "sum.js"), "before-edit\n")
  const markerPath = join(root, "check-executed.txt")
  const stateDir = join(root, "state")
  mkdirSync(join(workspace, ".alcode"), { recursive: true })
  writeFileSync(join(workspace, ".alcode", "verification.json"), JSON.stringify({
    version: 1,
    checks: [
      {
        id: CHECK_ID,
        name: "slow post-edit check",
        category: "unit",
        command: slowCheckCommand({
          markerPath,
          stateDir,
          waitMs: options.checkWaitMs,
          bumpEpoch: options.bumpEpoch === true,
        }),
        timeoutMs: 20_000,
      },
    ],
  }))
  git(workspace, ["add", "-A"])
  git(workspace, ["commit", "-m", "delegation capture deadline fixture"])

  // A real approval through the host action: the catalogue is configured, so the host-side capture
  // is not skipped by an unconfigured/empty check set.
  const authority = approvalAuthorityFor(workspace, join(root, "authority"))
  const candidate = candidateForApproval({
    projectRoot: workspace,
    workspaceId: WORKSPACE_ID,
    changedFiles: null,
    checkId: CHECK_ID,
  })
  if (candidate === null) throw new Error("the fixture catalogue did not expose the check")
  approveCandidate({
    authority,
    candidate,
    workspaceId: WORKSPACE_ID,
    configVersion: VERIFICATION_CONFIG_VERSION,
    approvedBy: "alcode:delegation-deadline-test",
  })

  const store = createTaskRecordStore({ project_dir: workspace, task: { state_dir: stateDir } })
  const manager = createTaskManager({
    store,
    runners: { "in-process": new FakeRunner(), process: new FakeRunner() },
    planner: categoryPlanner(),
    config: settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: workspace,
    verificationAuthorityRoot: authority.root,
    admission: makePort(workspace, { edit: true }),
  })
  const spec: ManagerStartSpec & { readonly delegation: ManagerDelegationSpec } = {
    ...baseSpec({ cwd: workspace }),
    delegation: {
      objective: "prove a slow approved check cannot outlive the delegated deadline",
      workingDirectory: workspace,
      roles: [{ key: "implement", assignment: "append after-edit to src/sum.js" }],
      deadlineMs: options.deadlineMs,
    },
  }
  const startedAt = Date.now()
  const result = await manager.start(spec)
  const elapsedMs = Date.now() - startedAt
  // A deadline refusal names no parent id (it is not the delegated success member); the parent is
  // the only record this start claimed.
  const taskId = store.list().records[0]?.task_id ?? ""
  return {
    root,
    store,
    markerPath,
    evidenceRoot: join(stateDir, "verifications"),
    taskId,
    result,
    elapsedMs,
    deadlineMs: options.deadlineMs,
  }
}

let fixture: Fixture | undefined
let setupError: unknown

beforeAll(async () => {
  try {
    fixture = await driveDelegatedFixture()
  } catch (error) {
    setupError = error
    throw error
  }
})

afterAll(() => {
  if (fixture === undefined) return
  rmSync(fixture.root, { recursive: true, force: true })
})

function requireFixture(): Fixture {
  if (fixture === undefined) throw new Error(`delegated fixture did not run: ${String(setupError)}`)
  return fixture
}

function recordPath(f: Fixture, taskId: string, attempt: number): string {
  return join(f.evidenceRoot, taskId, `${ORDINARY_VERIFICATION_NODE}.${CHECK_ID}.${attempt}.json`)
}

describe("delegated completion evidence is parent-task owned", () => {
  test("#given a delegated run with a build-category approved catalogue #when the parent folds #then evidence is keyed by the parent task id and the receipt binds it", () => {
    const f = requireFixture()
    const epoch = f.terminal.notification.run_epoch

    // The terminal record carries the gate's own word, read from disk.
    expect(f.terminal.status).toBe("completed")
    expect(f.terminal.verification_status).toBe("verified")

    // The identity change: epoch 0 writes attempt 1 under the PARENT task id, never the run id.
    const path = recordPath(f, f.result.task_id, epoch + 1)
    expect(existsSync(path)).toBe(true)
    expect(path).toContain(f.result.task_id)
    expect(path).not.toContain(RUN_ID)
    expect(existsSync(join(f.evidenceRoot, RUN_ID))).toBe(false)

    const record = parseVerificationRecord(readFileSync(path, "utf8"))
    expect(record).not.toBeNull()
    if (record === null) throw new Error("the production capture wrote an unreadable record")

    // Traceability, not identity: the DAG run id rides on the record and receipt only.
    expect(record.runId).toBe(RUN_ID)
    expect(record.checkId).toBe(CHECK_ID)
    expect(record.workerAttempt).toBe(epoch)
    expect(record.status).toBe("passed")
    expect(record.started).toBe(true)
    expect(record.exitCode).toBe(0)
    expect(record.sourceRevision).toBe(workspaceRevision(f.workspace))
    expect(record.sourceRevision).not.toBe(f.preEditRevision)

    // The approved build check really executed: its marker is its own consequence, and the pre-fix
    // selection policy (scopeFor hardcoding every touch flag false) would never have run it.
    expect(existsSync(f.markerPath)).toBe(true)
    expect(readFileSync(f.markerPath, "utf8")).toBe("executed")

    const receiptRoot = verificationReceiptRoot(f.evidenceRoot)
    const receipt = readCaptureReceipt(receiptRoot, f.result.task_id, epoch)
    expect(receipt.kind).toBe("found")
    if (receipt.kind !== "found") throw new Error("the production capture wrote no receipt")
    expect(receipt.receipt.taskId).toBe(f.result.task_id)
    expect(receipt.receipt.epoch).toBe(epoch)
    expect(receipt.receipt.dagRunId).toBe(RUN_ID)
    expect(receipt.receipt.records.map((entry) => entry.checkId)).toEqual([CHECK_ID])
    expect(receipt.receipt.records[0]?.file).toBe(`${ORDINARY_VERIFICATION_NODE}.${CHECK_ID}.${epoch + 1}.json`)

    // Re-asking the single verdict authority over the same namespace returns the same claim.
    const verdict = evaluateOrdinaryCompletion({
      taskId: f.result.task_id,
      catalogue: f.gate,
      evidenceRoot: f.evidenceRoot,
      workspaceDir: f.workspace,
      epoch,
    })
    expect(verdict.verification).toBe("verified")
  })

  test("#given production-written delegated evidence #when the gate is asked under another task or epoch #then it does not verify", () => {
    const f = requireFixture()
    const epoch = f.terminal.notification.run_epoch

    const otherTask = evaluateOrdinaryCompletion({
      taskId: "st_not_the_delegated_parent",
      catalogue: f.gate,
      evidenceRoot: f.evidenceRoot,
      workspaceDir: f.workspace,
      epoch,
    })
    expect(otherTask.verification).toBe("blocked")
    if (otherTask.verification !== "blocked") throw new Error("expected a blocked verdict")
    expect(otherTask.code).toBe("verification_evidence_missing")

    // Same namespace, one epoch later: the production-written evidence is fenced out.
    const wrongEpoch = evaluateOrdinaryCompletion({
      taskId: f.result.task_id,
      catalogue: f.gate,
      evidenceRoot: f.evidenceRoot,
      workspaceDir: f.workspace,
      epoch: epoch + 1,
    })
    expect(wrongEpoch.verification).toBe("blocked")
    if (wrongEpoch.verification !== "blocked") throw new Error("expected a blocked verdict")
    expect(wrongEpoch.code).toBe("verification_stale")
  })
})

describe("a reused DAG run never verifies a second parent (A5)", () => {
  test("#given parent A's passing evidence and a reused run #when parent B's capture is skipped #then B is blocked as missing, never verified", async () => {
    const f = requireFixture()
    expect(f.terminal.verification_status).toBe("verified")
    const epochA = f.terminal.notification.run_epoch

    // Same objective, roles and workspace => the SAME definition key => the SAME run id. The fake
    // port stands in for dag/manager.ts's fingerprint-keyed reuse and returns RUN_ID for both.
    const indexPath = join(f.workspace, ".git", "index")
    const indexBackup = readFileSync(indexPath)
    const definitionKeys: string[] = []
    let restored = false
    const bPort = makePort(f.workspace, {
      edit: false,
      onStartRun: () => {
        // The spawn-time baseline already failed (the index is corrupt); restore the real index
        // before the fold so the gate can still describe the tree, exactly like A's revision.
        writeFileSync(indexPath, indexBackup)
        restored = true
      },
      onDefinition: (key) => definitionKeys.push(key),
    })
    const managerB = createTaskManager(managerOptions(f.workspace, f.store, f.authority, bPort))

    // A non-git baseline for B: the spawn-time snapshot fails closed (null), which is precisely the
    // capture skip this regression needs. The port restores the index during startRun.
    writeFileSync(indexPath, "corrupt index, not a git index file")
    const resultB = await managerB.start(delegatedSpec(f.workspace))
    expect(restored).toBe(true)
    if (resultB.kind !== "delegated") throw new Error(`expected delegated, received ${resultB.kind}`)

    expect(resultB.task_id).not.toBe(f.result.task_id)
    expect(resultB.runId).toBe(RUN_ID)
    expect(definitionKeys).toEqual([...f.definitionKeys])

    const terminalB = rawRecord(f.store, resultB.task_id)
    expect(terminalB.status).toBe("error")
    expect(terminalB.verification_status).toBe("blocked")
    expect(terminalB.error_message).toContain("verification_provenance_unknown")
    expect(terminalB.verification_status).not.toBe("verified")

    // A's evidence is still exactly where A's parent wrote it, and B never gained a directory.
    expect(existsSync(recordPath(f, f.result.task_id, epochA + 1))).toBe(true)
    expect(existsSync(join(f.evidenceRoot, resultB.task_id))).toBe(false)
    expect(existsSync(join(f.evidenceRoot, RUN_ID))).toBe(false)

    const verdictB = evaluateOrdinaryCompletion({
      taskId: resultB.task_id,
      catalogue: f.gate,
      evidenceRoot: f.evidenceRoot,
      workspaceDir: f.workspace,
      epoch: terminalB.notification.run_epoch,
    })
    expect(verdictB.verification).toBe("blocked")
    if (verdictB.verification !== "blocked") throw new Error("expected a blocked verdict")
    expect(verdictB.code).toBe("verification_evidence_missing")
  })
})

describe("delegated deadline bounds the host-side verification capture (p25 24f)", () => {
  test("#given an approved check that sleeps past the remaining budget #when the parent folds #then it is failed at the deadline, never completed+verified", async () => {
    // given: the check would pass after its sleep, so only the deadline race can prevent a
    // completed+verified parent. The budget is far below the check's lifetime.
    const checkWaitMs = 1_500
    const deadlineMs = 100
    const f = await driveSlowCaptureFixture({ deadlineMs, checkWaitMs })
    try {
      expect(f.taskId).not.toBe("")

      // The caller gets the typed deadline refusal, not a success-shaped delegated result.
      expect(f.result.kind).toBe("deadline_unavailable_at_manager_seam")
      if (f.result.kind !== "deadline_unavailable_at_manager_seam") {
        throw new Error(`expected the typed deadline error, received ${f.result.kind}`)
      }
      expect(f.result.ok).toBe(false)
      expect(f.result.reason).toContain(`deadline of ${f.deadlineMs}ms elapsed`)
      expect(f.result.reason).toContain("host-side verification capture")
      expect(f.result.runId).toBe(RUN_ID)

      // The parent terminal is the deadline failure - not a completed record with a verification
      // claim written after the caller-observable budget.
      const terminal = rawRecord(f.store, f.taskId)
      expect(terminal.status).toBe("error")
      expect(terminal.verification_status).toBeUndefined()
      expect(terminal.error_message).toContain(`deadline of ${f.deadlineMs}ms elapsed`)
      expect(terminal.error_message).toContain("host-side verification capture")

      // `start` returned while the check was still sleeping: the budget bounded the capture.
      expect(f.elapsedMs).toBeLessThan(checkWaitMs)

      // The approved check really executed (its marker), and its late result is recorded as
      // cancelled - a status no gate evaluation can read as a pass.
      expect(await waitForFile(f.markerPath, 5_000)).toBe(true)
      const evidencePath = join(f.evidenceRoot, f.taskId, `${ORDINARY_VERIFICATION_NODE}.${CHECK_ID}.1.json`)
      expect(await waitForFile(evidencePath, 5_000)).toBe(true)
      const evidence = parseVerificationRecord(readFileSync(evidencePath, "utf8"))
      expect(evidence?.status).toBe("cancelled")

      // The late capture did not rewrite the terminal afterwards.
      const settled = rawRecord(f.store, f.taskId)
      expect(settled.status).toBe("error")
      expect(settled.verification_status).toBeUndefined()
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })

  test("#given the parent epoch moves while the slow check runs #when the deadline elapses #then the fenced fail writes no terminal and no verification claim", async () => {
    // given: the check itself moves the parent's run epoch from INSIDE the capture, before the
    // budget elapses. The deadline failure must still travel through the epoch fence.
    const f = await driveSlowCaptureFixture({ deadlineMs: 1_000, checkWaitMs: 2_500, bumpEpoch: true })
    try {
      expect(f.taskId).not.toBe("")
      expect(f.result.kind).toBe("deadline_unavailable_at_manager_seam")

      // The marker proves the check ran and bumped the epoch before the deadline fired.
      expect(await waitForFile(f.markerPath, 5_000)).toBe(true)
      // Wait for the check to finish so the late capture cannot race the assertions (and so its
      // child no longer holds the fixture tree when cleanup runs).
      const evidencePath = join(f.evidenceRoot, f.taskId, `${ORDINARY_VERIFICATION_NODE}.${CHECK_ID}.1.json`)
      expect(await waitForFile(evidencePath, 8_000)).toBe(true)
      const record = rawRecord(f.store, f.taskId)
      expect(record.status).toBe("running")
      expect(record.verification_status).toBeUndefined()
      expect(record.error_message).toBeUndefined()
    } finally {
      rmSync(f.root, { recursive: true, force: true })
    }
  })
})
