// The completion-status distinctions, proven through the REAL manager lifecycle: a real record
// store, a real task manager and the production outcome tracker. Only the runner is a fixture
// handle whose outcome the test settles - exactly the knob a completed turn turns in production.
//
// Every case asserts the PERSISTED status, not just an error string: the typed terminal status
// plus the gate's verification_status read back from the on-disk record JSON. (Typed loads drop
// unknown fields, so the record file and the completion events are the readable carriers of the
// claim the manager stamp writes.) A blocked verdict must land as an error carrying "blocked",
// never as a completed run.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
import { evaluateOrdinaryCompletion } from "./completion-gate"
import { isBlocked, isVerified } from "./completion-status"
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

type FixtureOptions = {
  // "standard": one approved check. "absent": no verification.json at all. "malformed": a
  // verification.json the config loader must reject.
  readonly config?: "standard" | "absent" | "malformed"
  // package.json scripts. Omitted entirely by default, so discovery finds no candidates.
  readonly scripts?: Record<string, string>
}

type Fixture = {
  readonly workspace: string
  readonly stateDir: string
  readonly authority: ApprovalAuthority
  readonly store: TaskRecordStore
  readonly manager: ReturnType<typeof createTaskManager>
  readonly started: Array<{ taskId: string; handle: FakeHandle }>
  readonly settleAll: () => void
}

type StatusPackageJson = {
  readonly name: string
  readonly private: true
  readonly scripts?: Record<string, string>
}

function fixture(options: FixtureOptions = {}): Fixture {
  const { config = "standard", scripts } = options
  const root = tempRoot("p22-status-")
  const workspace = join(root, "workspace")
  const stateDir = join(root, "state")
  mkdirSync(join(workspace, ".alcode"), { recursive: true })
  // The optional scripts are added by statement, not by an empty-object spread.
  const packageJson: StatusPackageJson =
    scripts === undefined ? { name: "status", private: true } : { name: "status", private: true, scripts }
  writeFileSync(join(workspace, "package.json"), JSON.stringify(packageJson))
  if (config === "standard") {
    writeFileSync(
      join(workspace, ".alcode", "verification.json"),
      JSON.stringify({ version: 1, checks: [{ id: CHECK_ID, name: "gate check", category: "unit", command: COMMAND, timeoutMs: 20_000 }] }),
    )
  } else if (config === "malformed") {
    writeFileSync(join(workspace, ".alcode", "verification.json"), "{ not json\n")
  }
  git(workspace, "init", "-q"); git(workspace, "add", "-A"); git(workspace, "-c", "user.email=g@x", "-c", "user.name=g", "commit", "-qm", "init")

  const authority = approvalAuthorityFor(workspace, join(root, "authority"))
  if (config === "standard") {
    const subject = { workspaceId: ".", checkId: CHECK_ID, command: COMMAND, cwd: ".", packageScope: "", timeoutMs: 20_000, configVersion: VERIFICATION_CONFIG_VERSION }
    approveCandidate({
      authority,
      candidate: { fingerprint: approvalFingerprint(subject), checkId: CHECK_ID, command: COMMAND, cwd: ".", packageScope: "", timeoutMs: 20_000 },
      workspaceId: ".",
      configVersion: VERIFICATION_CONFIG_VERSION,
      approvedBy: "alcode:tester",
    })
  }

  // The state_dir override keeps every record under the temp root (a bare project_dir would
  // resolve to the agent-dir store instead) and makes the persisted files directly readable.
  const store = createTaskRecordStore({ project_dir: stateDir, task: { state_dir: stateDir } })
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
  const started = await f.manager.start({ prompt: "do it", parent_session_id: "parent-status", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
  if (started.kind !== "started") throw new Error("spawn refused: " + JSON.stringify(started))
  if (beforeSettle !== undefined) await beforeSettle(started.task_id)
  const done = f.manager.waitFor(started.task_id)
  f.settleAll()
  const record = await done
  return { taskId: started.task_id, status: record.status, error: record.error_message }
}

// Evidence written through the production capture path with a stub runner: these cases test the
// STATUS mapping, not command execution (which the 2.1.9/2.1.10 suites cover).
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
    binding: { runId: taskId, sessionId: "parent-status", epoch: options.epoch },
    changedFiles: ["tracked.txt"],
    available: [{ checkId: CHECK_ID, category: "unit", command: COMMAND, timeoutMs: 20_000, criteria: [] }],
  })
}

// The persisted record as it sits on disk: status plus the gate's verification_status claim the
// manager stamp writes. Read raw because typed loads drop unknown fields.
type RawCompletionRecord = {
  readonly status: string
  readonly verification_status: unknown
  readonly error_message: unknown
}

type RawRecordEnvelope = {
  readonly status?: unknown
  readonly verification_status?: unknown
  readonly error_message?: unknown
}

function readRaw(stateDir: string, taskId: string): RawCompletionRecord {
  const parsed: unknown = JSON.parse(readFileSync(join(stateDir, "tasks", `${taskId}.json`), "utf8"))
  if (parsed === null || parsed instanceof Array || !(parsed instanceof Object)) throw new Error("persisted record is not an object")
  // SAFETY: the store writes a flat JSON object per record; instanceof Object above excludes null and arrays.
  const record = parsed as RawRecordEnvelope
  // SAFETY: the manager persists status as a TaskStatus string; a non-string fails every status expect below.
  const status = record.status as string
  if (status.length === 0) throw new Error("persisted record has no status")
  return { status, verification_status: record.verification_status, error_message: record.error_message }
}

describe("completion status", () => {
  test("#given no catalogue #when the child completes #then the run succeeds but is reported unverified, never verified", async () => {
    const f = fixture({ config: "absent" })
    const result = await spawnAndSettle(f)
    expect(result.status).toBe("completed")
    const raw = readRaw(f.stateDir, result.taskId)
    expect(raw.status).toBe("completed")
    // Exact literal: mapping "no checks" to verified would report a pass that never ran.
    expect(raw.verification_status).toBe("unverified")
  })

  test("#given a configured catalogue with zero checks #when the gate evaluates #then it is unverified", async () => {
    // Unreachable through manager spawn - an empty config file is invalid, and resolution never
    // yields a configured-but-empty catalogue - so the mapping is pinned by direct evaluation.
    // Reverting it to "blocked" (fail-closed overreach) or "verified" (a pass that ran nothing)
    // fails this test.
    const f = fixture()
    const started = await f.manager.start({ prompt: "do it", parent_session_id: "parent-status", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    if (started.kind !== "started") throw new Error("spawn refused: " + JSON.stringify(started))
    const epoch = f.manager.get(started.task_id)?.notification.run_epoch ?? 0
    await writeEvidence(f, started.task_id, { status: "passed", epoch })
    const verdict = evaluateOrdinaryCompletion({
      taskId: started.task_id,
      catalogue: { status: "configured", checks: [] },
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch,
    })
    expect(verdict.verification).toBe("unverified")
    expect(isBlocked(verdict)).toBe(false)
    expect(isVerified(verdict)).toBe(false)
    const done = f.manager.waitFor(started.task_id)
    f.settleAll()
    await done
  })

  test("#given an invalid catalogue #when the child completes #then it is blocked fail-closed", async () => {
    const f = fixture({ config: "malformed" })
    const result = await spawnAndSettle(f)
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_evidence_malformed")
    // An unreadable requirement is never the same as no requirement: it blocks, it never
    // degrades into "unverified".
    expect(readRaw(f.stateDir, result.taskId).verification_status).toBe("blocked")
  })

  test("#given a configured catalogue whose check produced no record #when the child completes #then it is blocked as missing", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f)
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_evidence_missing")
    expect(readRaw(f.stateDir, result.taskId).verification_status).toBe("blocked")
  })

  test("#given evidence predating a workspace edit #when the child completes #then it is blocked as stale", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      await writeEvidence(f, taskId, { status: "passed", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0 })
      writeFileSync(join(f.workspace, "tracked.txt"), "edited after verification\n")
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_stale")
    expect(readRaw(f.stateDir, result.taskId).verification_status).toBe("blocked")
  })

  test("#given passing approved evidence #when the child completes #then the run is completed and reported verified", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      await writeEvidence(f, taskId, { status: "passed", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0 })
    })
    expect(result.status).toBe("completed")
    const raw = readRaw(f.stateDir, result.taskId)
    expect(raw.status).toBe("completed")
    // Exact literal: only a gate verdict of "verified" may ever write "verified".
    expect(raw.verification_status).toBe("verified")
  })

  test("#given failing evidence for a completed turn #when the gate blocks #then the persisted record is an error carrying blocked, never completed", async () => {
    // The revert this pins: publishing the runner's "completed" while the gate says blocked,
    // which a parent would trust as done work.
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      await writeEvidence(f, taskId, { status: "failed", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0 })
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_failed")
    const raw = readRaw(f.stateDir, result.taskId)
    expect(raw.status).toBe("error")
    expect(raw.status).not.toBe("completed")
    expect(raw.verification_status).toBe("blocked")
  })

  test("#given a blocked run #when a fresh store opens the same state root #then the blocked claim is still there and a fresh run without evidence is still blocked", async () => {
    const f = fixture()
    const first = await spawnAndSettle(f)
    expect(first.status).toBe("error")
    expect(readRaw(f.stateDir, first.taskId).verification_status).toBe("blocked")

    // A brand-new store over the same state root: restart is not a bypass. The state_dir
    // override keeps the fresh store on this root (a bare project_dir would resolve to the
    // agent-dir store instead). The claim is read from the on-disk record JSON, the carrier
    // the manager stamp writes to.
    const reopened = createTaskRecordStore({ project_dir: f.stateDir, task: { state_dir: f.stateDir } })
    const persisted = readRaw(reopened.stateDir, first.taskId)
    expect(persisted.status).toBe("error")
    expect(persisted.verification_status).toBe("blocked")

    const handles: FakeHandle[] = []
    const runner: ManagedRunner = {
      start: async (spec) => {
        const fake = makeHandle(spec.taskId, 7777)
        handles.push(fake)
        return fake.handle
      },
    }
    const manager = createTaskManager({
      store: reopened,
      runners: { "in-process": runner, process: runner },
      planner: gatePlanner,
      config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
      cwd: f.workspace,
      verificationAuthorityRoot: f.authority.root,
    })
    const started = await manager.start({ prompt: "after restart", parent_session_id: "parent-status", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    if (started.kind !== "started") throw new Error("spawn refused")
    const done = manager.waitFor(started.task_id)
    for (const handle of handles) handle.settle({ status: "completed", finalResponse: "done" })
    const settled = await done
    // Reverting the missing-evidence mapping would let this post-restart run complete.
    expect(settled.status).toBe("error")
    expect(settled.error_message).toContain("verification_evidence_missing")
    expect(readRaw(reopened.stateDir, started.task_id).verification_status).toBe("blocked")
  })

  test("#given two concurrent runs #when only one produced evidence #then the other is blocked and borrows no status", async () => {
    const f = fixture()
    const first = await f.manager.start({ prompt: "a", parent_session_id: "parent-status", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    const second = await f.manager.start({ prompt: "b", parent_session_id: "parent-status", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    if (first.kind !== "started" || second.kind !== "started") throw new Error("spawn refused")
    await writeEvidence(f, first.task_id, { status: "passed", epoch: f.manager.get(first.task_id)?.notification.run_epoch ?? 0 })
    const doneFirst = f.manager.waitFor(first.task_id)
    const doneSecond = f.manager.waitFor(second.task_id)
    f.settleAll()
    const a = await doneFirst
    const b = await doneSecond
    expect(a.status).toBe("completed")
    expect(readRaw(f.stateDir, first.task_id).verification_status).toBe("verified")
    // The revert this pins: the second run inheriting the first run's evidence and completing.
    expect(b.status).toBe("error")
    expect(b.error_message).toContain("verification_evidence_missing")
    expect(readRaw(f.stateDir, second.task_id).verification_status).toBe("blocked")
  })

  test("#given persisted terminal records #when their JSON is serialized again #then verification_status survives with its exact literal value", async () => {
    // Exact literals: any revert that swaps verified/unverified, drops the claim, or writes a
    // non-literal (a boolean, a code) in its place fails here.
    const f = fixture()
    const ok = await spawnAndSettle(f, async (taskId) => {
      await writeEvidence(f, taskId, { status: "passed", epoch: f.manager.get(taskId)?.notification.run_epoch ?? 0 })
    })
    const blocked = await spawnAndSettle(f)
    const okPath = join(f.stateDir, "tasks", `${ok.taskId}.json`)
    const blockedPath = join(f.stateDir, "tasks", `${blocked.taskId}.json`)
    expect(readFileSync(okPath, "utf8")).toContain('"verification_status":"verified"')
    expect(readFileSync(blockedPath, "utf8")).toContain('"verification_status":"blocked"')
    for (const [path, literal] of [[okPath, "verified"], [blockedPath, "blocked"]] as const) {
      const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
      if (raw === null || raw instanceof Array || !(raw instanceof Object)) throw new Error("persisted record is not an object")
      // SAFETY: the store writes a flat JSON object per record; instanceof Object above excludes null and arrays.
      const claim = (raw as RawRecordEnvelope).verification_status
      expect(claim).toBe(literal)
      const roundTripped: unknown = JSON.parse(JSON.stringify(raw))
      if (roundTripped === null || roundTripped instanceof Array || !(roundTripped instanceof Object)) {
        throw new Error("round-tripped record is not an object")
      }
      // SAFETY: a JSON round-trip of the flat record object above preserves its shape.
      expect((roundTripped as RawRecordEnvelope).verification_status).toBe(literal)
    }
  })
})
