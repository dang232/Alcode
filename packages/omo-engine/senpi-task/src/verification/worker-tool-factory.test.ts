// Factory-level proof that the ordinary worker's verification tool is owned by the host: every
// callback the tool runs was closed over host state, and the child-facing request carries nothing.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { parseVerificationRecord } from "../dag/verification"
import { createTaskRecord, type TaskRecord } from "../state"
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { approveCandidate } from "./approval-store"
import { VERIFICATION_CONFIG_VERSION } from "./config"
import { ORDINARY_VERIFICATION_NODE } from "./ordinary-capture"
import { candidateForApproval } from "./resolution"
import { snapshotWorkspace, type WorkspaceBaseline } from "./run-provenance"
import { VERIFY_TOOL_NAME } from "./verify-tool"
import { createWorkerVerificationTool, type WorkerVerificationHost } from "./worker-tool-factory"


// Every temp dir this file creates is tracked so a test run leaves no QA state behind.
const createdDirs: string[] = []

function track<T extends string>(dir: T): T {
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function git(dir: string, ...args: readonly string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" })
}

// A committed repo: snapshotWorkspace needs a git tree and workspaceRevision needs a HEAD, while a
// committed baseline leaves changedFiles empty so selection never depends on test scaffolding.
function makeRepo(files: Record<string, string>): string {
  const dir = track(mkdtempSync(join(tmpdir(), "worker-verify-")))
  git(dir, "init")
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  git(dir, "add", "-A")
  git(
    dir,
    "-c",
    "user.email=worker-verify@example.com",
    "-c",
    "user.name=worker-verify",
    "commit",
    "-m",
    "init",
    "--quiet",
    "--allow-empty",
  )
  return dir
}

function liveRecord(projectRoot: string, epoch: number): TaskRecord {
  const base = createTaskRecord({
    parent_session_id: "sess-parent",
    root_session_id: "sess-root",
    depth: 1,
    execution_mode: "in-process",
    model: "test/model",
    notify_on_terminal: false,
  })
  return {
    ...base,
    notification: { ...base.notification, run_epoch: epoch },
    spawn_spec: { version: 1 as const, cwd: projectRoot, prompt: "do the thing" },
  }
}

// One temp authority per temp project: never the real ~/.alcode, never the workspace itself.
const authorityByProject = new Map<string, ApprovalAuthority>()

function authorityFor(projectRoot: string): ApprovalAuthority {
  const existing = authorityByProject.get(projectRoot)
  if (existing !== undefined) return existing
  const created = approvalAuthorityFor(projectRoot, track(mkdtempSync(join(tmpdir(), "worker-authority-"))))
  authorityByProject.set(projectRoot, created)
  return created
}

function makeHost(
  projectRoot: string,
  input: {
    readonly record: TaskRecord | undefined
    readonly baseline?: WorkspaceBaseline | null
    readonly isCancelled?: () => boolean
  },
): WorkerVerificationHost & { readonly evidenceRoot: string } {
  const evidenceRoot = join(track(mkdtempSync(join(tmpdir(), "worker-evidence-"))), "verifications")
  return {
    taskId: input.record?.task_id ?? "st_00000001",
    projectRoot,
    authority: authorityFor(projectRoot),
    evidenceRoot,
    record: () => input.record,
    baseline: input.baseline === undefined ? snapshotWorkspace(projectRoot) : input.baseline,
    isCancelled: input.isCancelled ?? (() => false),
  }
}

// A declared check plus the approval record its own fingerprint binds to, so the catalogue resolves
// "configured" without the factory ever taking an approval decision of its own.
function writeDeclaredCheck(projectRoot: string, checkId: string, command: readonly string[]): void {
  mkdirSync(join(projectRoot, ".alcode"), { recursive: true })
  writeFileSync(
    join(projectRoot, ".alcode", "verification.json"),
    JSON.stringify({
      version: VERIFICATION_CONFIG_VERSION,
      checks: [{ id: checkId, name: `${checkId} name`, category: "unit", command }],
    }),
  )
}

// The host's own approval action, used by mechanism tests only: it is NOT a human authorization and
// no test in this package treats it as one.
function approveDeclaredCheck(projectRoot: string, checkId: string): void {
  const candidate = candidateForApproval({ projectRoot, workspaceId: ".", changedFiles: [], checkId })
  if (candidate === null) throw new Error(`expected a config candidate for ${checkId}`)
  approveCandidate({
    authority: authorityFor(projectRoot),
    candidate: {
      fingerprint: candidate.fingerprint,
      checkId: candidate.checkId,
      command: candidate.command,
      cwd: candidate.cwd,
      packageScope: candidate.packageScope,
      timeoutMs: candidate.timeoutMs,
    },
    workspaceId: ".",
    configVersion: VERIFICATION_CONFIG_VERSION,
    approvedBy: "factory-test",
  })
}

function writeApprovedCheck(projectRoot: string, checkId: string, command: readonly string[]): void {
  writeDeclaredCheck(projectRoot, checkId, command)
  approveDeclaredCheck(projectRoot, checkId)
}

function readEvidence(host: { readonly evidenceRoot: string }, taskId: string, checkId: string): string {
  return readFileSync(join(host.evidenceRoot, taskId, `${ORDINARY_VERIFICATION_NODE}.${checkId}.1.json`), "utf8")
}

describe("worker verification tool factory", () => {
  test("#given a live record with an approved check #when the child executes #then the evidence carries the host task id, session and epoch", async () => {
    // given a repo whose only configured check passes and is approved
    const projectRoot = makeRepo({})
    writeApprovedCheck(projectRoot, "unit-core", ["node", "-e", "process.exit(0)"])
    const record = liveRecord(projectRoot, 3)
    const host = makeHost(projectRoot, { record })
    const tool = createWorkerVerificationTool(host)

    // when the child executes with its empty request
    expect(tool.name).toBe(VERIFY_TOOL_NAME)
    const result = await tool.execute()

    // then the host binding — not anything the child sent — owns the persisted record
    expect(result.isError).toBe(false)
    const persisted = parseVerificationRecord(readEvidence(host, record.task_id, "unit-core"))
    if (persisted === null) throw new Error("expected a persisted verification record")
    expect(persisted.runId).toBe(record.task_id)
    expect(persisted.parentSessionId).toBe("sess-parent")
    expect(persisted.workerAttempt).toBe(3)
    expect(persisted.status).toBe("passed")
  })

  test("#given a terminal record #when the child executes #then it is refused as unavailable and writes nothing", async () => {
    // given a run that already reached a terminal status
    const projectRoot = makeRepo({})
    const host = makeHost(projectRoot, { record: { ...liveRecord(projectRoot, 0), status: "completed" } })

    // when the child executes
    const result = await createWorkerVerificationTool(host).execute()

    // then no live run owns the call and no evidence directory appears
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_unavailable")
    expect(existsSync(host.evidenceRoot)).toBe(false)
  })

  test("#given the host could not attribute changes #when the child executes #then it fails closed as provenance unknown", async () => {
    // given a live run on a tree the host never snapshotted
    const projectRoot = makeRepo({})
    const host = makeHost(projectRoot, { record: liveRecord(projectRoot, 0), baseline: null })

    // when the child executes
    const result = await createWorkerVerificationTool(host).execute()

    // then the tool refuses instead of guessing an empty change set
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_provenance_unknown")
    expect(existsSync(host.evidenceRoot)).toBe(false)
  })

  test("#given discovered candidates with no approval #when the child executes #then it is refused as approval required and the command never runs", async () => {
    // given a manifest check the host never approved, whose command would mark the tree if run
    const projectRoot = makeRepo({
      "package.json": JSON.stringify({
        name: "candidate-tree",
        scripts: { test: "node -e \"require('node:fs').writeFileSync('ran.txt', 'x')\"" },
      }),
    })
    const host = makeHost(projectRoot, { record: liveRecord(projectRoot, 0) })

    // when the child executes
    const result = await createWorkerVerificationTool(host).execute()

    // then the candidates stay pending, nothing is recorded, and the command never ran
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(result.details.records).toBe(0)
    expect(existsSync(host.evidenceRoot)).toBe(false)
    expect(existsSync(join(projectRoot, "ran.txt"))).toBe(false)
  })

  test("#given two concurrent executes on one tool #when both run #then the captures serialize and both settle", async () => {
    // given an approved check that marks entry and exit around a short sleep
    const projectRoot = makeRepo({})
    writeApprovedCheck(projectRoot, "unit-order", [
      "node",
      "-e",
      "const fs = require('node:fs');"
        + "fs.appendFileSync('order.log', 's\\n');"
        + "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);"
        + "fs.appendFileSync('order.log', 'e\\n');",
    ])
    const host = makeHost(projectRoot, { record: liveRecord(projectRoot, 0) })
    const tool = createWorkerVerificationTool(host)

    // when two executes race on the same tool instance
    const [first, second] = await Promise.all([tool.execute(), tool.execute()])

    // then both settle green and the second capture started only after the first finished
    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(readFileSync(join(projectRoot, "order.log"), "utf8")).toBe("s\ne\ns\ne\n")
  })

  test("#given cancellation lands during execution #when the child executes #then the outcome is cancelled and non-passing", async () => {
    // given an approved check and a cancel that lands after the check starts but before it closes
    const projectRoot = makeRepo({})
    writeApprovedCheck(projectRoot, "unit-cancel", ["node", "-e", "process.exit(0)"])
    let calls = 0
    const host = makeHost(projectRoot, {
      record: liveRecord(projectRoot, 0),
      isCancelled: () => {
        calls += 1
        return calls > 2
      },
    })

    // when the child executes
    const result = await createWorkerVerificationTool(host).execute()

    // then the record is cancelled — never a pass — and the tool reports the failure
    expect(result.isError).toBe(true)
    expect(result.details.executed.map((entry) => entry.status)).toEqual(["cancelled"])
  })

  test("#given an approval written after the tool was built #when the child executes #then the spawn-time snapshot still refuses", async () => {
    // given a declared check with no approval when the host built the tool, and a marker command
    const projectRoot = makeRepo({})
    const marker = join(track(mkdtempSync(join(tmpdir(), "worker-forge-"))), "marker.txt")
    const command = [
      "node",
      "-e",
      "require('node:fs').writeFileSync(process.argv[1], 'ran')",
      marker,
    ]
    writeDeclaredCheck(projectRoot, "unit-forge", command)
    const record = liveRecord(projectRoot, 1)
    const host = makeHost(projectRoot, { record })
    const tool = createWorkerVerificationTool(host)

    // when the child mints itself an approval inside the project tree it can write
    approveDeclaredCheck(projectRoot, "unit-forge")

    // then the authority the tool holds is still the empty snapshot taken at spawn
    const result = await tool.execute()
    expect(result.isError).toBe(true)
    expect(result.details.error?.code).toBe("verification_approval_required")
    expect(result.details.records).toBe(0)
    expect(existsSync(marker)).toBe(false)

    // and a tool built AFTER the write does see it, which is what makes the snapshot the barrier
    const rebuilt = await createWorkerVerificationTool(makeHost(projectRoot, { record })).execute()
    expect(rebuilt.isError).toBe(false)
    expect(existsSync(marker)).toBe(true)
  })
})
