// The ordinary-completion gate, proven through the REAL manager lifecycle: a real record store, a real
// task manager and the production outcome tracker. Only the runner is a fixture handle whose outcome
// the test settles - exactly the knob a completed turn turns in production.
//
// Every case asserts the PERSISTED terminal status, because that is what a parent, a notification and
// task_output read. A refusal must land as a failure with the gate's code, never as completed.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "../../../omo-config-core/src/index.ts"
import { buildVerificationRecord, parseVerificationRecord, serializeVerificationRecord, type DagVerifyCheck } from "../dag/verification"
import { makeHandle, type FakeHandle } from "../manager/__fixtures__/manager-fakes"
import { createTaskManager } from "../manager/manager"
import type { ManagedRunner, ManagedStartSpec, ManagerStartSpec } from "../manager/types"
import { createTaskRecordStore } from "../store"
import type { TaskRecordStore } from "../store"
import { approvalFingerprint } from "./approval"
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { approveCandidate } from "./approval-store"
import { evaluateOrdinaryCompletion } from "./completion-gate"
import { createFileEvidenceStore, readCaptureReceipt, verificationReceiptRoot, workspaceRevision } from "./evidence-store"
import type { OrdinaryCatalogue } from "./catalogue"
import { ORDINARY_VERIFICATION_NODE, createOrdinaryVerificationCapture } from "./ordinary-capture"
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
const FAILING_COMMAND = ["node", "-e", "process.exit(4)"]
const WRITING_COMMAND = ["node", "-e", "require('fs').appendFileSync('tracked.txt','check wrote\\n')"]

type Fixture = {
  readonly workspace: string
  readonly stateDir: string
  readonly authority: ApprovalAuthority
  readonly store: TaskRecordStore
  readonly manager: ReturnType<typeof createTaskManager>
  readonly started: Array<{ taskId: string; handle: FakeHandle }>
  readonly specs: readonly ManagedStartSpec[]
  readonly settleAll: () => void
}

function fixture(checkCommand: readonly string[] = COMMAND): Fixture {
  const root = tempRoot("p22-gate-")
  const workspace = join(root, "workspace")
  const stateDir = join(root, "state")
  mkdirSync(join(workspace, ".alcode"), { recursive: true })
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "gate", private: true }))
  writeFileSync(join(workspace, "tracked.txt"), "one\n")
  writeFileSync(
    join(workspace, ".alcode", "verification.json"),
    JSON.stringify({ version: 1, checks: [{ id: CHECK_ID, name: "gate check", category: "unit", command: checkCommand, timeoutMs: 20_000 }] }),
  )
  git(workspace, "init", "-q"); git(workspace, "add", "-A"); git(workspace, "-c", "user.email=g@x", "-c", "user.name=g", "commit", "-qm", "init")

  const authority = approvalAuthorityFor(workspace, join(root, "authority"))
  const subject = { workspaceId: ".", checkId: CHECK_ID, command: checkCommand, cwd: ".", packageScope: "", timeoutMs: 20_000, configVersion: VERIFICATION_CONFIG_VERSION }
  approveCandidate({
    authority,
    candidate: { fingerprint: approvalFingerprint(subject), checkId: CHECK_ID, command: checkCommand, cwd: ".", packageScope: "", timeoutMs: 20_000 },
    workspaceId: ".",
    configVersion: VERIFICATION_CONFIG_VERSION,
    approvedBy: "alcode:tester",
  })

  const store = createTaskRecordStore({ project_dir: stateDir })
  const started: Array<{ taskId: string; handle: FakeHandle }> = []
  const specs: ManagedStartSpec[] = []
  const runner: ManagedRunner = {
    start: async (spec) => {
      specs.push(spec)
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
    stateDir: store.stateDir,
    authority,
    store,
    manager,
    started,
    specs,
    settleAll: () => {
      for (const entry of started) entry.handle.settle({ status: "completed", finalResponse: "work done" })
    },
  }
}

async function spawnAndSettle(f: Fixture, beforeSettle?: (taskId: string) => Promise<void> | void): Promise<{ taskId: string; status: string; error: string | undefined; verificationStatus: string | undefined }> {
  const started = await f.manager.start({ prompt: "do it", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
  if (started.kind !== "started") throw new Error("spawn refused: " + JSON.stringify(started))
  if (beforeSettle !== undefined) await beforeSettle(started.task_id)
  const done = f.manager.waitFor(started.task_id)
  f.settleAll()
  await done
  // The waiter settles on the terminal transition, BEFORE the verification claim is stamped, so
  // the persisted record is the surface a parent, a notification and task_output actually read.
  const persisted = f.store.load(started.task_id)
  if (persisted === null) throw new Error("the terminal record was not persisted")
  return { taskId: started.task_id, status: persisted.status, error: persisted.error_message, verificationStatus: persisted.verification_status }
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
    binding: { taskId: taskId, sessionId: "parent-gate", epoch: options.epoch },
    changedFiles: ["tracked.txt"],
    available: [{ checkId: CHECK_ID, category: "unit", command: COMMAND, timeoutMs: 20_000, criteria: [] }],
  })
}

describe("ordinary completion gate", () => {
  test("#given a configured catalogue #when the ordinary child completes #then the host captures the check and publishes verified", async () => {
    const f = fixture()
    const result = await spawnAndSettle(f)
    expect(result.status).toBe("completed")
    expect(result.verificationStatus).toBe("verified")
    // The launch spec is the captured child surface: no child ever receives verification authority.
    expect(f.specs[0]?.verificationTool).toBeUndefined()
    // The evidence and the receipt were written by the HOST capture, not by the child.
    const files = hostEvidenceFiles(f.stateDir, result.taskId)
    expect(files).toHaveLength(1)
    const record = parseHostRecord(f.stateDir, result.taskId, files[0])
    expect(record.checkId).toBe(CHECK_ID)
    expect(record.status).toBe("passed")
    if (record.workerAttempt === undefined) throw new Error("the host record carries no run epoch")
    const receipt = readCaptureReceipt(verificationReceiptRoot(join(f.stateDir, "verifications")), result.taskId, record.workerAttempt)
    expect(receipt.kind).toBe("found")
  })

  test("#given no host evidence #when the gate evaluates #then it is blocked as missing", () => {
    // A configured ordinary completion can no longer reach the gate without evidence, because the
    // host capture always runs first. The "no evidence" refusal is therefore asserted at the gate's
    // own boundary, which is the only place a missing evidence tree can still be observed.
    const f = fixture()
    const verdict = evaluateOrdinaryCompletion({
      taskId: "st_gate_no_evidence",
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("a run with no evidence was verified")
    expect(verdict.code).toBe("verification_evidence_missing")
  })

  test("#given an approved check that fails #when the child completes #then the host capture blocks it as failed", async () => {
    const f = fixture(FAILING_COMMAND)
    const result = await spawnAndSettle(f)
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_failed")
    expect(result.verificationStatus).toBe("blocked")
  })

  test("#given an approved check that writes the tree #when the child completes #then its own evidence is stale and blocked", async () => {
    const f = fixture(WRITING_COMMAND)
    const result = await spawnAndSettle(f)
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_stale")
  })

  test("#given host evidence and a later workspace edit #when the gate evaluates #then the pre-edit record is stale", async () => {
    const f = fixture()
    const taskId = "st_gate_changed_after"
    await writeEvidence(f, taskId, { status: "passed", epoch: 0 })
    writeFileSync(join(f.workspace, "tracked.txt"), "edited after verification\n")
    const verdict = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("pre-edit evidence verified the edited tree")
    expect(verdict.code).toBe("verification_stale")
  })

  test("#given host evidence from another epoch #when the gate evaluates at this epoch #then it is stale", async () => {
    const f = fixture()
    const taskId = "st_gate_other_epoch"
    await writeEvidence(f, taskId, { status: "passed", epoch: 5 })
    const verdict = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("another epoch's evidence verified this run")
    expect(verdict.code).toBe("verification_stale")
    expect(verdict.reason).toContain("another epoch")
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

  test("#given an approval revoked after spawn #when the child completes #then the spawn-time snapshot still runs the approved check", async () => {
    // The child (or anyone in the workspace) removes the approval after the spawn snapshot. The
    // requirement must not be droppable: the host capture executes the check the spawn-time
    // catalogue required and the gate verifies from that evidence.
    const f = fixture()
    const result = await spawnAndSettle(f, async () => {
      rmSync(f.authority.workspaceDir, { recursive: true, force: true })
    })
    expect(result.status).toBe("completed")
    expect(result.verificationStatus).toBe("verified")
    expect(hostEvidenceFiles(f.stateDir, result.taskId)).toHaveLength(1)
  })

  test("#given a child-written record outside the approved catalogue #when the child completes #then it is untrusted and cannot satisfy the requirement", async () => {
    // A child can write a schema-valid record, but it has no host capture receipt and is not the
    // approved check. The host capture still runs the one approved check; the untrusted file makes
    // the gate fail closed as malformed instead of being ignored or counted.
    const f = fixture()
    const result = await spawnAndSettle(f, async (taskId) => {
      const epoch = f.manager.get(taskId)?.notification.run_epoch ?? 0
      const check: DagVerifyCheck = { checkId: "unit-unapproved", category: "unit", command: COMMAND, timeoutMs: 20_000, criteria: [] }
      const forged = buildVerificationRecord({
        runId: "dag_child_claim",
        parentSessionId: "parent-gate",
        rootSessionId: "parent-gate",
        workerAttempt: epoch,
        check,
        cwd: f.workspace,
        projectDir: f.workspace,
        sourceRevision: workspaceRevision(f.workspace),
        generation: 0,
        repairAttempt: 0,
        result: { started: true, exitCode: 0, timedOut: false, cancelled: false, output: "ok", outputBytes: 2, durationMs: 3, uncertainEffect: false },
      })
      const dir = join(f.stateDir, "verifications", taskId)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${ORDINARY_VERIFICATION_NODE}.unit-unapproved.1.json`), serializeVerificationRecord(forged))
    })
    expect(result.status).toBe("error")
    expect(result.error).toContain("verification_evidence_malformed")
    expect(result.error).toContain("not listed in the host capture receipt")
  })

  test("#given two concurrent children in one configured workspace #when both complete #then each verifies from its own host-captured evidence", async () => {
    // Cross-task borrowing is asserted at the gate boundary by A5. Here the subject is the ordinary
    // completion path: every run's evidence lands under its OWN task id and is verified by the gate.
    const f = fixture()
    const first = await f.manager.start({ prompt: "a", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    const second = await f.manager.start({ prompt: "b", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    if (first.kind !== "started" || second.kind !== "started") throw new Error("spawn refused")
    const doneFirst = f.manager.waitFor(first.task_id)
    const doneSecond = f.manager.waitFor(second.task_id)
    f.settleAll()
    await doneFirst
    await doneSecond
    const a = f.store.load(first.task_id)
    const b = f.store.load(second.task_id)
    expect(a?.status).toBe("completed")
    expect(a?.verification_status).toBe("verified")
    expect(b?.status).toBe("completed")
    expect(b?.verification_status).toBe("verified")
    expect(hostEvidenceFiles(f.stateDir, first.task_id)).toHaveLength(1)
    expect(hostEvidenceFiles(f.stateDir, second.task_id)).toHaveLength(1)
  })

  test("#given a restarted manager over the same state #when a fresh configured run completes #then its own host evidence verifies it", async () => {
    const f = fixture()
    const first = await spawnAndSettle(f)
    expect(first.status).toBe("completed")
    expect(first.verificationStatus).toBe("verified")

    // A brand-new manager + store over the same state root: restart does not bypass the gate and
    // does not reuse the previous run's evidence. The new run is captured under its own task id.
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
    await done
    const settled = store.load(started.task_id)
    expect(settled?.status).toBe("completed")
    expect(settled?.verification_status).toBe("verified")
    expect(started.task_id).not.toBe(first.taskId)
    expect(hostEvidenceFiles(store.stateDir, started.task_id)).toHaveLength(1)
    expect(hostEvidenceFiles(f.stateDir, first.taskId)).toHaveLength(1)
  })
})

function approvedCatalogue(): OrdinaryCatalogue {
  return {
    status: "configured",
    checks: [
      {
        check: { checkId: CHECK_ID, category: "unit", command: COMMAND, timeoutMs: 20_000, criteria: [] },
        provenance: { source: "config", location: ".alcode/verification.json", reason: "approved by the gate test" },
      },
    ],
  }
}

// The A4 boundary: a record is evidence only when the HOST capture receipt for this exact
// (task, epoch) lists it and its bytes still match. A schema-valid passing record written by hand
// has no receipt; a record rewritten after the capture no longer matches its digest. Neither may
// ever be accepted, no matter how correct the JSON looks.
describe("A4 host capture receipt trust boundary", () => {
  test("A4 #given a hand-written passing record with no receipt #when the gate evaluates #then it is blocked as malformed", () => {
    const f = fixture()
    const taskId = "st_a4_forged"
    const catalogue = approvedCatalogue()
    if (catalogue.status !== "configured") throw new Error("the fixture catalogue is not configured")
    const check = catalogue.checks[0]?.check
    if (check === undefined) throw new Error("the fixture catalogue lost its check")
    const forged = buildVerificationRecord({
      runId: "dag_forged",
      parentSessionId: "parent-gate",
      rootSessionId: "parent-gate",
      workerAttempt: 0,
      check,
      cwd: f.workspace,
      projectDir: f.workspace,
      sourceRevision: workspaceRevision(f.workspace),
      generation: 0,
      repairAttempt: 0,
      result: { started: true, exitCode: 0, timedOut: false, cancelled: false, output: "ok", outputBytes: 2, durationMs: 1, uncertainEffect: false },
    })
    const dir = join(f.store.stateDir, "verifications", taskId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${ORDINARY_VERIFICATION_NODE}.${CHECK_ID}.1.json`), serializeVerificationRecord(forged))

    const verdict = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("a forged record was accepted")
    expect(verdict.code).toBe("verification_evidence_malformed")
    expect(verdict.reason).toContain("host capture receipt")
  })

  test("A4 #given host-captured evidence #when its record is rewritten after capture #then the receipt digest mismatch blocks it", async () => {
    const f = fixture()
    const taskId = "st_a4_tampered"
    await writeEvidence(f, taskId, { status: "passed", epoch: 0 })
    const recordFile = join(f.store.stateDir, "verifications", taskId, `${ORDINARY_VERIFICATION_NODE}.${CHECK_ID}.1.json`)
    appendFileSync(recordFile, " ")

    const verdict = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("a tampered record was accepted")
    expect(verdict.code).toBe("verification_evidence_malformed")
    expect(verdict.reason).toContain("digest")
  })

  test("A4 #given a record the host capture wrote #when the gate evaluates #then the receipt makes it verified", async () => {
    const f = fixture()
    const taskId = "st_a4_host"
    await writeEvidence(f, taskId, { status: "passed", epoch: 0 })

    const verdict = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("verified")
  })
})

describe("approved catalogue requirement set", () => {
  test("approved catalogue #given a configured catalogue with zero checks #when the gate evaluates #then it is unverified", () => {
    const f = fixture()
    const verdict = evaluateOrdinaryCompletion({
      taskId: "st_no_checks",
      catalogue: { status: "configured", checks: [] },
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("unverified")
  })
})

// D4: attribution is a precondition, not evidence. A run whose baseline the host could not snapshot
// must not be reported as a run that merely produced no evidence.
describe("capture outcome provenance preconditions", () => {
  test("capture outcome #given an unavailable baseline #when the gate evaluates #then it is provenance_unknown before reading evidence", () => {
    const f = fixture()
    const verdict = evaluateOrdinaryCompletion({
      taskId: "st_never_captured",
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
      preconditions: { baseline: "unavailable" },
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("expected a blocked verdict")
    expect(verdict.code).toBe("verification_provenance_unknown")
  })

  test("capture outcome #given a pinned source revision #when the gate evaluates #then it judges the evidence against that tree", async () => {
    const f = fixture()
    const taskId = "st_pinned_revision"
    const pinned = workspaceRevision(f.workspace)
    await writeEvidence(f, taskId, { status: "passed", epoch: 0, revision: pinned })
    // The fold compares the tree after capture and blocks stale before calling the gate. The gate's
    // own contract is to judge the pinned revision it was handed, never to re-read a later tree.
    writeFileSync(join(f.workspace, "tracked.txt"), "post-capture edit\n")
    const verdict = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
      sourceRevision: pinned,
    })
    expect(verdict.verification).toBe("verified")
  })
})

// ---------------------------------------------------------------------------------------------
// p28 C6 adversarial matrix (gate-level half). A4/A5/A8 live in the delegated suite and in the
// receipt block above; these are the cases whose authority boundary is this gate.
// ---------------------------------------------------------------------------------------------

function evidenceRecordPath(stateDir: string, taskId: string, checkId: string, attempt: number): string {
  return join(stateDir, "verifications", taskId, `${ORDINARY_VERIFICATION_NODE}.${checkId}.${attempt}.json`)
}

// The host capture chooses the attempt from the run epoch, so tests read what landed instead of
// pinning a filename the production epoch decides.
function hostEvidenceFiles(stateDir: string, taskId: string): string[] {
  const dir = join(stateDir, "verifications", taskId)
  return existsSync(dir) ? readdirSync(dir) : []
}

function parseHostRecord(stateDir: string, taskId: string, file: string | undefined) {
  if (file === undefined) throw new Error("the host capture wrote no record")
  const record = parseVerificationRecord(readFileSync(join(stateDir, "verifications", taskId, file), "utf8"))
  if (record === null) throw new Error("the host capture wrote an unreadable record")
  return record
}

describe("A1 a child's claim is never evidence", () => {
  test("A1 #given a child that claims every test passed #when the host check fails #then the run is blocked failed from host evidence, never verified", async () => {
    const f = fixture(FAILING_COMMAND)
    const started = await f.manager.start({ prompt: "do it", parent_session_id: "parent-gate", depth: 1, category: "quick", cwd: f.workspace, execution_mode: "in-process" })
    if (started.kind !== "started") throw new Error(`spawn refused: ${started.kind}`)
    const done = f.manager.waitFor(started.task_id)
    const claim = "all 42 tests passed; verification: verified"
    f.started[0]?.handle.settle({ status: "completed", finalResponse: claim })
    await done

    // The persisted terminal is what a parent, a notification and task_output read. The waiter is
    // settled by the terminal write and the verification claim is stamped right after it, so read
    // the record back from the store instead of the in-memory value the waiter returned.
    const persisted = f.store.load(started.task_id)
    if (persisted === null) throw new Error("the blocked terminal was not persisted")
    expect(persisted.status).toBe("error")
    expect(persisted.verification_status).toBe("blocked")
    expect(persisted.error_message).toContain("verification_failed")
    // The claim is not even a reason the gate can cite: no prose is parsed as evidence.
    expect(persisted.error_message).not.toContain("42 tests")
    // The failing status came from the HOST capture's own record, not from the child's claim.
    const hostRecord = parseVerificationRecord(readFileSync(evidenceRecordPath(f.store.stateDir, started.task_id, CHECK_ID, 1), "utf8"))
    expect(hostRecord?.status).toBe("failed")
  })
})

describe("A6 evidence from another epoch is fenced out", () => {
  test("A6 #given host evidence written at epoch 0 #when the gate evaluates at epoch 1 #then the record is stale by identity", async () => {
    const f = fixture()
    const taskId = "st_a6_epoch_fence"
    await writeEvidence(f, taskId, { status: "passed", epoch: 0 })

    // Control: the same evidence verifies for the epoch that wrote it.
    const sameEpoch = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(sameEpoch.verification).toBe("verified")

    const record = parseVerificationRecord(readFileSync(evidenceRecordPath(f.store.stateDir, taskId, CHECK_ID, 1), "utf8"))
    if (record === null) throw new Error("the host capture wrote an unreadable record")
    expect(record.workerAttempt).toBe(0)
    const receipt = readCaptureReceipt(verificationReceiptRoot(join(f.store.stateDir, "verifications")), taskId, 0)
    expect(receipt.kind).toBe("found")
    if (receipt.kind === "found") expect(receipt.receipt.epoch).toBe(0)

    const nextEpoch = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 1,
    })
    expect(nextEpoch.verification).toBe("blocked")
    if (nextEpoch.verification !== "blocked") throw new Error("an epoch-0 record verified an epoch-1 run")
    expect(nextEpoch.code).toBe("verification_stale")
    expect(nextEpoch.reason).toContain("another epoch")
  })
})

describe("A7 evidence from the pre-edit revision is stale", () => {
  test("A7 #given evidence captured against the pre-edit tree #when the tree is edited before the gate #then the pre-edit record blocks stale", async () => {
    const f = fixture()
    const taskId = "st_a7_pre_edit"
    const preEdit = workspaceRevision(f.workspace)
    await writeEvidence(f, taskId, { status: "passed", epoch: 0, revision: preEdit })

    const record = parseVerificationRecord(readFileSync(evidenceRecordPath(f.store.stateDir, taskId, CHECK_ID, 1), "utf8"))
    if (record === null) throw new Error("the host capture wrote an unreadable record")
    expect(record.sourceRevision).toBe(preEdit)

    writeFileSync(join(f.workspace, "tracked.txt"), "edited after the evidence\n")
    expect(workspaceRevision(f.workspace)).not.toBe(preEdit)

    // No pinned revision is handed over: the gate reads the tree it is asked about, and that tree is
    // no longer the one the record names. A silently refreshed record would hide this.
    const verdict = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("pre-edit evidence verified the edited tree")
    expect(verdict.code).toBe("verification_stale")
  })
})

describe("A9 a failing required check blocks", () => {
  test("A9 #given the approved check exited non-zero #when the gate evaluates #then it blocks failed and names the check and exit", async () => {
    const f = fixture()
    const taskId = "st_a9_failed_check"
    await writeEvidence(f, taskId, { status: "failed", epoch: 0 })

    const record = parseVerificationRecord(readFileSync(evidenceRecordPath(f.store.stateDir, taskId, CHECK_ID, 1), "utf8"))
    if (record === null) throw new Error("the host capture wrote an unreadable record")
    expect(record.status).toBe("failed")
    expect(record.exitCode).toBe(4)

    const verdict = evaluateOrdinaryCompletion({
      taskId,
      catalogue: approvedCatalogue(),
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("a failed approved check verified")
    expect(verdict.code).toBe("verification_failed")
    expect(verdict.reason).toContain(CHECK_ID)
    expect(verdict.reason).toContain("failed")
  })
})

describe("A10 nothing required is not a pass", () => {
  test("A10 #given no approved applicable checks #when the gate evaluates #then every catalogue variant is unverified, never verified or blocked", () => {
    const f = fixture()
    const base = {
      taskId: "st_a10_no_checks",
      evidenceRoot: join(f.store.stateDir, "verifications"),
      workspaceDir: f.workspace,
      epoch: 0,
    }
    const none = evaluateOrdinaryCompletion({ ...base, catalogue: { status: "none", reason: "no checks are declared" } })
    expect(none.verification).toBe("unverified")

    const approvalRequired = evaluateOrdinaryCompletion({
      ...base,
      catalogue: { status: "approval_required", pending: [CHECK_ID], reason: "candidates exist but none is approved" },
    })
    expect(approvalRequired.verification).toBe("unverified")

    const configuredEmpty = evaluateOrdinaryCompletion({ ...base, catalogue: { status: "configured", checks: [] } })
    expect(configuredEmpty.verification).toBe("unverified")

    // "Nothing to run" is never a claim, so no evidence was read or required.
    expect(existsSync(join(base.evidenceRoot, base.taskId))).toBe(false)
  })
})

describe("A19 a missing check dependency is an explicit block", () => {
  test("A19 #given an approved check whose executable is missing #when the host capture runs it #then the record is non-passing and the gate blocks naming the check", async () => {
    const f = fixture()
    const taskId = "st_a19_missing_runner"
    const checkId = "missing-executable-check"
    const check: DagVerifyCheck = {
      checkId,
      category: "build",
      command: ["definitely-not-a-real-binary-p28"],
      timeoutMs: 10_000,
      criteria: [],
    }
    const evidenceRoot = join(f.store.stateDir, "verifications")
    const capture = createOrdinaryVerificationCapture({
      store: createFileEvidenceStore(evidenceRoot),
      projectDir: f.workspace,
      currentRevision: () => workspaceRevision(f.workspace),
    })
    await capture.capture({
      binding: { taskId, sessionId: "parent-gate", epoch: 0 },
      changedFiles: ["tracked.txt"],
      available: [check],
      required: [check],
    })

    const record = parseVerificationRecord(readFileSync(evidenceRecordPath(f.store.stateDir, taskId, checkId, 1), "utf8"))
    if (record === null) throw new Error("the host capture wrote an unreadable record")
    expect(record.status).not.toBe("passed")
    expect(record.status).toBe("failed")
    expect(record.signal).toBe("spawn_error")

    const catalogue: OrdinaryCatalogue = {
      status: "configured",
      checks: [{ check, provenance: { source: "config", location: ".alcode/verification.json", reason: "A19 fixture" } }],
    }
    const verdict = evaluateOrdinaryCompletion({ taskId, catalogue, evidenceRoot, workspaceDir: f.workspace, epoch: 0 })
    expect(verdict.verification).toBe("blocked")
    if (verdict.verification !== "blocked") throw new Error("a check that never started verified")
    expect(verdict.code).toBe("verification_failed")
    expect(verdict.reason).toContain(checkId)
  })
})