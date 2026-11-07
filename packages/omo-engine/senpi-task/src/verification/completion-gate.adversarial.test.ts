// The ordinary-completion gate, proven through the REAL manager lifecycle: a real record store, a real
// task manager and the production outcome tracker. Only the runner is a fixture handle whose outcome
// the test settles - exactly the knob a completed turn turns in production.
//
// Every case asserts the PERSISTED terminal status, because that is what a parent, a notification and
// task_output read. A refusal must land as a failure with the gate's code, never as completed.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "../../../omo-config-core/src/index.ts"
import { makeHandle, type FakeHandle } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager/manager"
import type { ManagedRunner, ManagerStartSpec } from "../manager/types"
import { createTaskRecordStore } from "../store"
import type { TaskRecordStore } from "../store"
import { approvalFingerprint } from "./approval"
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { approveCandidate } from "./approval-store"
import { createFileEvidenceStore, workspaceRevision } from "./evidence-store"
import { createOrdinaryVerificationCapture } from "./ordinary-capture"
import { VERIFICATION_CONFIG_VERSION } from "./config"

const roots: string[] = []
function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" })
}

type MutablePlan = { model: string; category?: string }

// A named plan shape: the optional category is added by statement, not by an empty-object spread.
function gatePlanner(spec: ManagerStartSpec) {
  const plan: MutablePlan = { model: "gate/model" }
  if (spec.category !== undefined) plan.category = spec.category
  return { kind: "resolved" as const, plan }
}

const CHECK_ID = "unit-gate"
const COMMAND = ["node", "-e", "process.exit(0)"]

type Fixture = {
  readonly workspace: string
  readonly stateDir: string
  readonly authority: ApprovalAuthority
  readonly store: TaskRecordStore
  readonly manager: ReturnType<typeof createTaskManager>
  readonly started: Array<{ taskId: string; handle: FakeHandle }>
  readonly settleAll: () => void
}

function fixture(): Fixture {
  const root = tempRoot("p22-gate-")
  const workspace = join(root, "workspace")
  const stateDir = join(root, "state")
  mkdirSync(join(workspace, ".alcode"), { recursive: true })
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "gate", private: true }))
  writeFileSync(join(workspace, "tracked.txt"), "one\n")
  writeFileSync(
    join(workspace, ".alcode", "verification.json"),
    JSON.stringify({ version: 1, checks: [{ id: CHECK_ID, name: "gate check", category: "unit", command: COMMAND, timeoutMs: 20_000 }] }),
  )
  git(workspace, "init", "-q"); git(workspace, "add", "-A"); git(workspace, "-c", "user.email=g@x", "-c", "user.name=g", "commit", "-qm", "init")

  const authority = approvalAuthorityFor(workspace, join(root, "authority"))
  const subject = { workspaceId: ".", checkId: CHECK_ID, command: COMMAND, cwd: ".", packageScope: "", timeoutMs: 20_000, configVersion: VERIFICATION_CONFIG_VERSION }
  approveCandidate({
    authority,
    candidate: { fingerprint: approvalFingerprint(subject), checkId: CHECK_ID, command: COMMAND, cwd: ".", packageScope: "", timeoutMs: 20_000 },
    workspaceId: ".",
    configVersion: VERIFICATION_CONFIG_VERSION,
    approvedBy: "alcode:tester",
  })

  const store = createTaskRecordStore({ project_dir: stateDir })
  const started: Array<{ taskId: string; handle: FakeHandle }> = []
  const runner: ManagedRunner = {
    start: async (spec) => {
      const fake = makeHandle(spec.taskId, 1000 + started.length)
      started.push({ taskId: spec.taskId, handle: fake })
      return fake.handle
    },
  }
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: gatePlanner,
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
    cwd: workspace,
    verificationAuthorityRoot: authority.root,
  })
  return {
    workspace,
    stateDir,
    authority,
    store,
    manager,
    started,
    settleAll: () => {
      for (const entry of started) entry.handle.settle({ status: "completed", finalResponse: "work done" })
    },
  }
}

async function spawnAndSettle(f: Fixture, beforeSettle?: (taskId: string) => Promise<void> | void): Promise<{ taskId: string; status: string; error: string | undefined }> {
  const started = await f.manager.start({ prompt: "do it", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
  if (started.kind !== "started") throw new Error("spawn refused: " + JSON.stringify(started))
  if (beforeSettle !== undefined) await beforeSettle(started.task_id)
  const done = f.manager.waitFor(started.task_id)
  f.settleAll()
  const record = await done
  return { taskId: started.task_id, status: record.status, error: record.error_message }
}

// Evidence written through the production capture path with a stub runner: these cases test the GATE,
// not command execution (which the 2.1.9/2.1.10 suites cover).
async function writeEvidence(f: Fixture, taskId: string, options: { status: "passed" | "failed"; epoch: number; revision?: string }): Promise<void> {
  const capture = createOrdinaryVerificationCapture({
    store: createFileEvidenceStore(join(f.store.stateDir, "verifications")),
    projectDir: f.workspace,
    currentRevision: () => options.revision ?? workspaceRevision(f.workspace),
    runner: async () => ({
      started: true,
      exitCode: options.status === "passed" ? 0 : 4,
      timedOut: false,
      cancelled: false,
      output: options.status,
      outputBytes: options.status.length,
      durationMs: 5,
      uncertainEffect: false,
    }),
    isCancelled: () => false,
  })
  await capture.capture({
    binding: { runId: taskId, sessionId: "parent-gate", epoch: options.epoch },
    changedFiles: ["tracked.txt"],
    available: [{ checkId: CHECK_ID, category: "unit", command: COMMAND, timeoutMs: 20_000, criteria: [] }],
  })
}

describe("ordinary completion gate", () => {
  test("#given fresh passing evidence #when the child completes #then the run is published as completed", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      await writeEvidence(f, taskId, { status: "passed", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0 })
    })
    expect(result.status).toBe("completed")
  })

  test("#given no evidence #when the child completes #then it is blocked as missing", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f)
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_evidence_missing")
  })

  test("#given failing evidence #when the child completes #then it is blocked as failed", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      await writeEvidence(f, taskId, { status: "failed", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0 })
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_failed")
  })

  test("#given evidence from a different workspace revision #when the child completes #then it is stale and blocked", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      await writeEvidence(f, taskId, { status: "passed", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0, revision: "deadbeef+0000000000000000" })
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_stale")
  })

  test("#given the workspace changed after the evidence #when the child completes #then it is stale and blocked", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      await writeEvidence(f, taskId, { status: "passed", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0 })
      writeFileSync(join(f.workspace, "tracked.txt"), "edited after verification\n")
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_stale")
  })

  test("#given evidence from another epoch #when the child completes #then it is stale and blocked", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      const epoch = f.manager.get(taskId)?.notification.run_epoch ?? 0
      await writeEvidence(f, taskId, { status: "passed", epoch: epoch + 5 })
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_stale")
  })

  test("#given a cancelled run #when its outcome settles #then it is never published as completed", async () => {
    const f = fixture()
    const started = await f.manager.start({ prompt: "do it", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    if (started.kind !== "started") throw new Error("spawn refused")
    const done = f.manager.waitFor(started.task_id)
    await f.manager.cancelTask(started.task_id)
    f.started[0]?.handle.settle({ status: "cancelled" })
    const record = await done
    expect(record.status).toBe("cancelled")
  })

  test("#given an approval revoked after spawn #when the child completes #then the spawn-time requirement still blocks", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f, async () => {
      // the child (or anyone in the workspace) removes the approval after the spawn snapshot
      rmSync(join(f.authority.workspaceDir), { recursive: true, force: true })
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_evidence_missing")
  })

  test("#given evidence for a check outside the approved catalogue #when the child completes #then it cannot satisfy the requirement", async () => {
    // A revoked approval must not be replaceable by running something else and filing its record.
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      const capture = createOrdinaryVerificationCapture({
        store: createFileEvidenceStore(join(f.store.stateDir, "verifications")),
        projectDir: f.workspace,
        currentRevision: () => workspaceRevision(f.workspace),
        runner: async () => ({ started: true, exitCode: 0, timedOut: false, cancelled: false, output: "ok", outputBytes: 2, durationMs: 3, uncertainEffect: false }),
        isCancelled: () => false,
      })
      await capture.capture({
        binding: { runId: taskId, sessionId: "parent-gate", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0 },
        changedFiles: ["tracked.txt"],
        available: [{ checkId: "unit-unapproved", category: "unit", command: ["node", "-e", "process.exit(0)"], timeoutMs: 20_000, criteria: [] }],
      })
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_evidence_missing")
  })

  test("#given two concurrent children #when only one produced evidence #then the other cannot borrow it", async () => {
    const f = fixture()
    const first = await f.manager.start({ prompt: "a", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    const second = await f.manager.start({ prompt: "b", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    if (first.kind !== "started" || second.kind !== "started") throw new Error("spawn refused")
    await writeEvidence(f, first.task_id, { status: "passed", epoch: f.manager.get(first.task_id)?.notification.run_epoch ?? 0 })
    const doneFirst = f.manager.waitFor(first.task_id)
    const doneSecond = f.manager.waitFor(second.task_id)
    f.settleAll()
    const a = await doneFirst
    const b = await doneSecond
    expect(a.status).toBe("completed")
    expect(b.status).toBe("error")
    expect(b.error_message).toContain("verification_evidence_missing")
  })

  test("#given a restarted manager over the same state #when a fresh run completes without evidence #then the gate still blocks", async () => {
    const f = fixture()
    const first = await spawnAndSettle(f)
    expect(first.status).toBe("error")

    // A brand-new manager + store over the same state root: restart is not a bypass.
    const store = createTaskRecordStore({ project_dir: f.stateDir })
    const handles: FakeHandle[] = []
    const runner: ManagedRunner = {
      start: async (spec) => {
        const fake = makeHandle(spec.taskId, 7777)
        handles.push(fake)
        return fake.handle
      },
    }
    const manager = createTaskManager({
      store,
      runners: { "in-process": runner, process: runner },
      planner: gatePlanner,
      config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
      cwd: f.workspace,
      verificationAuthorityRoot: f.authority.root,
    })
    const started = await manager.start({ prompt: "after restart", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    if (started.kind !== "started") throw new Error("spawn refused")
    const done = manager.waitFor(started.task_id)
    for (const handle of handles) handle.settle({ status: "completed", finalResponse: "done" })
    const settled = await done
    expect(settled.status).toBe("error")
    expect(settled.error_message).toContain("verification_evidence_missing")
  })
})