// Integration proof of the ordinary child's verification authority through a REAL worker: a real
// task store, a real task manager, and a real InProcessRunner with only the LLM turn scripted (an
// injected createSession port). The child surface is read out of the CAPTURED
// CreateAgentSessionOptions.customTools array; the evidence is read from the host's own state tree.
//
// Authority model (Policy C): NO child - ordinary, revived, DAG, member or curated - receives a
// verification tool. The host captures the spawn-time approved catalogue when the child's turn
// settles, and only the completion gate may publish a verdict. These tests therefore assert two
// things in one place: the denied child surface, and the host path's resulting verdict/evidence.
//
// Trust rules this file obeys:
// - An approval is only written through the real approveCandidate host action; no test fakes a
//   check result or a capture receipt.
// - P7/P9 use the evidence-store + ordinary-capture path directly with a stubbed command
//   runner because they are storage/freshness tests, not authorization tests.
// - Markers live OUTSIDE the git workspace so the provenance snapshot cannot see them.
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"

import { OmoTaskSettingsSchema } from "../../../omo-config-core/src/index.ts"
import { parseVerificationRecord, type DagVerifyRunner } from "../dag/verification"
import { loadSenpiBarrel } from "../lazy/senpi-barrel"
import { createTaskManager } from "../manager/manager"
import { createInProcessManagedRunner } from "../manager/runner"
import type { ChildPlanner, ManagedRunner, ManagerStartSpec, TaskManager } from "../manager/types"
import { InProcessRunner, type ChildSession, type ChildSessionListener } from "../runners/in-process"
import type { TaskRecordStore } from "../store"
import { createTaskRecordStore } from "../store"
import { approvalAuthorityFor, type ApprovalAuthority } from "./approval-authority"
import { approveCandidate } from "./approval-store"
import { VERIFICATION_CONFIG_VERSION } from "./config"
import { candidateForApproval } from "./resolution"
import {
  ORDINARY_VERIFICATION_NODE,
  createOrdinaryVerificationCapture,
  ordinaryEvidenceFreshness,
} from "./ordinary-capture"
import { VERIFY_TOOL_NAME } from "./verify-tool"
import { createFileEvidenceStore } from "./evidence-store"

const PARENT_SESSION_ID = "verify-it-parent"

const tempRoots: string[] = []

function trackRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

beforeAll(async () => {
  // The lazy senpi barrel has no test preload in this checkout, so the suite warms it
  // directly before any InProcessRunner builds child session options against it. The explicit
  // budget is the hook's own deadline, not a wait: under a full-folder run the process is still
  // busy with earlier files' timers and the default 5s is not enough for the cold import.
  await loadSenpiBarrel()
}, 120_000)

// ---------------------------------------------------------------------------
// Scripted child session: the ONLY fake in the worker path. Prompt/steer/
// abort/subscribe mirror the engine's ChildSession contract; nothing here
// executes tools, resolves models, or touches verification.
// ---------------------------------------------------------------------------
type MutableText = { value: string | undefined }

type FakeChildSession = {
  readonly session: ChildSession
  readonly resolvePrompt: () => void
  readonly promptTexts: string[]
  readonly lastText: MutableText
}

let sessionCounter = 0

function createFakeSession(): FakeChildSession {
  sessionCounter += 1
  const promptTexts: string[] = []
  const lastText: MutableText = { value: undefined }
  let settlePrompt: (() => void) | undefined
  const listeners = new Set<ChildSessionListener>()
  const session: ChildSession = {
    sessionId: `verify-it-session-${sessionCounter}`,
    prompt(text: string) {
      promptTexts.push(text)
      return new Promise<void>((resolve) => {
        settlePrompt = resolve
      })
    },
    async steer(text: string) {
      void text
      return "handled"
    },
    async followUp(text: string) {
      void text
      return "handled"
    },
    // WHY: aborting ends the turn in the engine contract (the runner reports a cancelled
    // outcome once the aborted prompt settles), so the scripted session settles its own
    // pending prompt instead of leaving cancel/waitFor parked on it forever.
    async abort() {
      settlePrompt?.()
    },
    subscribe(listener: ChildSessionListener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getLastAssistantText() {
      return lastText.value
    },
    dispose() {},
  }
  return {
    session,
    promptTexts,
    lastText,
    resolvePrompt: () => settlePrompt?.(),
  }
}

type CapturedSurface = {
  readonly options: CreateAgentSessionOptions
  readonly fake: FakeChildSession
}

type MutablePlan = { model: string; category?: string; agentType?: string }

const planner: ChildPlanner = (spec) => {
  const plan: MutablePlan = { model: "verify-it/test-model" }
  if (spec.category !== undefined) plan.category = spec.category
  if (spec.subagent_type !== undefined) plan.agentType = spec.subagent_type
  return { kind: "resolved", plan }
}

const unusedProcessRunner: ManagedRunner = {
  start: async () => {
    throw new Error("verify-it: the process runner must not be used by these tests")
  },
}

type StartRoute = {
  readonly category?: string
  readonly subagent_type?: string
  readonly cwd?: string
}

// The route fields are mutable here because each one is added only when the test supplied it;
// the object is handed to the real manager unchanged.
type MutableStartSpec = {
  readonly prompt: string
  readonly parent_session_id: string
  readonly depth: number
  readonly execution_mode: ManagerStartSpec["execution_mode"]
  cwd?: string
  category?: string
  subagent_type?: string
}

type Harness = {
  readonly root: string
  readonly workspace: string
  readonly store: TaskRecordStore
  readonly manager: TaskManager
  readonly evidenceRoot: string
  readonly authority: ApprovalAuthority
  readonly captured: CapturedSurface[]
  readonly startedIds: string[]
  startChild: (route?: StartRoute) => Promise<{ readonly taskId: string; readonly surfaceIndex: number }>
  cleanup: () => Promise<void>
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...args], { cwd, stdio: "ignore" })
}

function markerCheckConfig(markerPath: string): string {
  return JSON.stringify({
    version: 1,
    checks: [
      {
        id: "marker-check",
        name: "marker check",
        category: "unit",
        command: ["node", "-e", "require('fs').writeFileSync(process.argv[1],'1')", markerPath],
        timeoutMs: 10_000,
      },
    ],
  })
}

function invalidMarkerCheckConfig(markerPath: string): string {
  // Same declared marker command, but the check id breaks the catalogue schema, so the whole
  // catalogue is invalid and nothing in it may execute.
  return JSON.stringify({
    version: 1,
    checks: [
      {
        id: "bad id with spaces",
        name: "bad check",
        category: "unit",
        command: ["node", "-e", "require('fs').writeFileSync(process.argv[1],'1')", markerPath],
        timeoutMs: 10_000,
      },
    ],
  })
}

function makeHarness(config: "valid" | "invalid" | "absent", markerPath?: string): Harness {
  const root = trackRoot("senpi-verify-it-")
  const workspace = join(root, "work")
  mkdirSync(workspace, { recursive: true })
  git(workspace, ["init"])
  git(workspace, ["config", "user.email", "verify-it@example.com"])
  git(workspace, ["config", "user.name", "verify-it"])
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "verify-it", version: "0.0.0" }))
  // A declared-but-never-approved marker command keeps the catalogue valid; the marker file
  // itself is never created because execution is always refused without an approval.
  const markerDefault = join(root, "marker.txt")
  if (config === "valid") {
    mkdirSync(join(workspace, ".alcode"), { recursive: true })
    writeFileSync(join(workspace, ".alcode", "verification.json"), markerCheckConfig(markerPath ?? markerDefault))
  } else if (config === "invalid") {
    mkdirSync(join(workspace, ".alcode"), { recursive: true })
    writeFileSync(
      join(workspace, ".alcode", "verification.json"),
      invalidMarkerCheckConfig(markerPath ?? ""),
    )
  }
  git(workspace, ["add", "-A"])
  git(workspace, ["commit", "-m", "verify-it fixture"])

  const authority = approvalAuthorityFor(workspace, join(root, "authority"))
  const stateRoot = join(root, "state")
  mkdirSync(stateRoot, { recursive: true })
  const store = createTaskRecordStore({ project_dir: stateRoot })
  const captured: CapturedSurface[] = []
  const runner = new InProcessRunner({
    sharedParentTools: [],
    createSession: async (options) => {
      const fake = createFakeSession()
      captured.push({ options, fake })
      return fake.session
    },
  })
  const manager = createTaskManager({
    store,
    runners: { "in-process": createInProcessManagedRunner(runner), process: unusedProcessRunner },
    planner,
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
    cwd: workspace,
    verificationAuthorityRoot: authority.root,
  })
  const startedIds: string[] = []
  return {
    root,
    workspace,
    store,
    manager,
    evidenceRoot: join(store.stateDir, "verifications"),
    authority,
    captured,
    startedIds,
    startChild: async (route = {}) => {
      const spec: MutableStartSpec = {
        prompt: "verify the work",
        parent_session_id: PARENT_SESSION_ID,
        depth: 1,
        cwd: workspace,
        execution_mode: "in-process",
      }
      if (route.category !== undefined) spec.category = route.category
      if (route.subagent_type !== undefined) spec.subagent_type = route.subagent_type
      if (route.cwd !== undefined) spec.cwd = route.cwd
      if (route.category === undefined && route.subagent_type === undefined) spec.category = "quick"
      const started = await manager.start(spec)
      if (started.kind !== "started") {
        throw new Error(`verify-it: child refused to start: ${JSON.stringify(started)}`)
      }
      startedIds.push(started.task_id)
      return { taskId: started.task_id, surfaceIndex: captured.length - 1 }
    },
    cleanup: async () => {
      for (const taskId of startedIds) {
        if (manager.get(taskId)?.status === "running") {
          await manager.cancelTask(taskId)
        }
      }
    },
  }
}

function capturedSurface(harness: Harness, index: number): CapturedSurface {
  const surface = harness.captured[index]
  if (surface === undefined) throw new Error(`verify-it: no captured child surface at index ${index}`)
  return surface
}

function capturedOptions(harness: Harness, index: number): CreateAgentSessionOptions {
  return capturedSurface(harness, index).options
}

function capturedToolNames(harness: Harness, index: number): string[] {
  return (capturedOptions(harness, index).customTools ?? []).map((tool) => tool.name)
}

// P1/P2/P10 share this: an approval written by the host before the child's turn is what lets the
// completion capture execute the configured check. Later approvals must never reach that snapshot.
function approveMarkerCheck(harness: Harness, approvedBy = "alcode:tester"): void {
  const candidate = candidateForApproval({
    projectRoot: harness.workspace,
    workspaceId: ".",
    changedFiles: [],
    checkId: "marker-check",
  })
  if (candidate === null) throw new Error("verify-it: expected the declared candidate")
  approveCandidate({
    authority: harness.authority,
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
    approvedBy,
  })
}

// Settle the scripted turn, then read the PERSISTED terminal: the waiter is settled by the terminal
// write and the verification claim is stamped right after it.
async function completeChild(harness: Harness, taskId: string, surfaceIndex: number, text = "done") {
  const terminal = harness.manager.waitFor(taskId)
  const fake = capturedSurface(harness, surfaceIndex).fake
  fake.lastText.value = text
  fake.resolvePrompt()
  await terminal
  const persisted = harness.store.load(taskId)
  if (persisted === null) throw new Error(`verify-it: no persisted terminal for ${taskId}`)
  return persisted
}

function evidenceEntries(evidenceRoot: string): string[] {
  return existsSync(evidenceRoot) ? readdirSync(evidenceRoot) : []
}

describe("worker verification through a real ordinary child", () => {
  test("#given a real child #when the session is constructed #then it has no verify tool and the host capture verifies the configured check (P1)", async () => {
    // P1: the authority surface moved. The real child must NOT carry a verification tool, while the
    // host capture still executes the approved check at completion and the gate publishes verified.
    const root = trackRoot("senpi-verify-it-p1root-")
    const marker = join(root, "marker.txt")
    const harness = makeHarness("valid", marker)
    try {
      approveMarkerCheck(harness)
      const { taskId, surfaceIndex } = await harness.startChild({ category: "quick" })
      expect(capturedToolNames(harness, surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      const terminal = await completeChild(harness, taskId, surfaceIndex)
      expect(terminal.status).toBe("completed")
      expect(terminal.verification_status).toBe("verified")
      // The approved command really ran, and the evidence lives under the task id the host owns.
      expect(existsSync(marker)).toBe(true)
      expect(evidenceEntries(harness.evidenceRoot)).toEqual([taskId])
      const files = readdirSync(join(harness.evidenceRoot, taskId))
      expect(files.some((file) => file.startsWith(`${ORDINARY_VERIFICATION_NODE}.marker-check.`))).toBe(true)
    } finally {
      await harness.cleanup()
    }
  })

  test("#given a live child with no approval #when it completes #then the host captures nothing and the run is unverified (P2)", async () => {
    // P2: with no approval the spawn-time catalogue is approval_required, so no host capture runs.
    // The completion still publishes success (the ordinary run is not gated) but claims nothing.
    const harness = makeHarness("valid")
    try {
      const { taskId, surfaceIndex } = await harness.startChild({ category: "quick" })
      expect(capturedToolNames(harness, surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      const live = harness.manager.get(taskId)
      expect(live?.status).toBe("running")
      expect(live?.spawn_spec?.cwd).toBe(harness.workspace)
      const completed = await completeChild(harness, taskId, surfaceIndex)
      expect(completed.status).toBe("completed")
      expect(completed.verification_status).toBe("unverified")
      expect(existsSync(join(harness.evidenceRoot, taskId))).toBe(false)
    } finally {
      await harness.cleanup()
    }
  })

  test("#given declared candidates and no approval #when the child completes #then the check command never runs (P3)", async () => {
    // P3: approval gate. The marker sits OUTSIDE the workspace so the provenance snapshot
    // stays clean; the proof is the marker's absence plus an empty evidence root, i.e. the host
    // capture never started the declared command because nothing approved it.
    const root = trackRoot("senpi-verify-it-p3root-")
    const marker = join(root, "marker.txt")
    const harness = makeHarness("valid", marker)
    try {
      const { taskId, surfaceIndex } = await harness.startChild({ category: "quick" })
      expect(capturedToolNames(harness, surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      const terminal = await completeChild(harness, taskId, surfaceIndex)
      expect(terminal.status).toBe("completed")
      expect(terminal.verification_status).toBe("unverified")
      expect(existsSync(marker)).toBe(false)
      expect(existsSync(join(harness.evidenceRoot, taskId))).toBe(false)
      expect(evidenceEntries(harness.evidenceRoot)).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })

  test("#given a child outside any git work tree #when it completes #then the host fails closed as provenance_unknown and writes nothing (P4)", async () => {
    // P4: provenance fail-closed. The host cannot snapshot a tree that is not a work tree, so the
    // completion is blocked as provenance_unknown rather than guessed from an empty change set.
    const root = trackRoot("senpi-verify-it-p4root-")
    const marker = join(root, "marker.txt")
    const harness = makeHarness("valid", marker)
    try {
      approveMarkerCheck(harness)
      // Same approved workspace minus its VCS identity: the catalogue still resolves, but the host
      // can no longer attribute the change set it would run the check against.
      rmSync(join(harness.workspace, ".git"), { recursive: true, force: true })
      const { taskId, surfaceIndex } = await harness.startChild({ category: "quick" })
      expect(capturedToolNames(harness, surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      const terminal = await completeChild(harness, taskId, surfaceIndex)
      expect(terminal.status).toBe("error")
      expect(terminal.verification_status).toBe("blocked")
      expect(terminal.error_message).toContain("verification_provenance_unknown")
      expect(existsSync(join(harness.evidenceRoot, taskId))).toBe(false)
      expect(existsSync(marker)).toBe(false)
      expect(evidenceEntries(harness.evidenceRoot)).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })

  test("#given a malformed verification catalogue #when the child completes #then the gate blocks malformed and executes nothing (P5)", async () => {
    // P5: invalid catalogue. The file declares the marker command but breaks the schema, so the
    // catalogue is rejected wholesale and the completion gate blocks without executing it.
    const root = trackRoot("senpi-verify-it-p5root-")
    const marker = join(root, "marker.txt")
    const harness = makeHarness("invalid", marker)
    try {
      const { taskId, surfaceIndex } = await harness.startChild({ category: "quick" })
      expect(capturedToolNames(harness, surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      const terminal = await completeChild(harness, taskId, surfaceIndex)
      expect(terminal.status).toBe("error")
      expect(terminal.verification_status).toBe("blocked")
      expect(terminal.error_message).toContain("verification_evidence_malformed")
      expect(existsSync(marker)).toBe(false)
    } finally {
      await harness.cleanup()
    }
  })

  test("#given a cancelled child #when its turn is stopped #then no capture runs and nothing is published as passed (P6)", async () => {
    // P6: cancellation. The wait subscribes before the cancel is triggered; a cancelled run never
    // reaches the completion gate, so the host capture must write no evidence and no verdict.
    const harness = makeHarness("valid")
    try {
      const { taskId, surfaceIndex } = await harness.startChild({ category: "quick" })
      expect(capturedToolNames(harness, surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      const terminal = harness.manager.waitFor(taskId)
      await harness.manager.cancelTask(taskId)
      const cancelled = await terminal
      expect(cancelled.status).toBe("cancelled")
      expect(existsSync(join(harness.evidenceRoot, taskId))).toBe(false)
      expect(evidenceEntries(harness.evidenceRoot)).toEqual([])
    } finally {
      await harness.cleanup()
    }
  })

  test("#given a persisted evidence record #when the epoch advances #then freshness follows the record epoch (P7)", async () => {
    // P7: epoch fencing over the storage path. Execution is blocked by the approval gate by
    // design, so this test persists through ordinary-capture with a stubbed command runner
    // (a storage/freshness test, not an authorization test) and checks the epoch rule.
    const root = trackRoot("senpi-verify-it-p7-")
    const workspace = join(root, "work")
    mkdirSync(workspace, { recursive: true })
    git(workspace, ["init"])
    const evidenceRoot = join(root, "evidence")
    const revision = "verify-it-revision-p7"
    const runner: DagVerifyRunner = async () => ({
      started: true,
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      output: "ok",
      outputBytes: 2,
      durationMs: 3,
      uncertainEffect: false,
    })
    const capture = createOrdinaryVerificationCapture({
      store: createFileEvidenceStore(evidenceRoot),
      projectDir: workspace,
      currentRevision: () => revision,
      runner,
      isCancelled: () => false,
    })
    const outcome = await capture.capture({
      binding: { taskId: "verify-it-p7", sessionId: "verify-it-parent", epoch: 7 },
      changedFiles: ["src/work.ts"],
      available: [
        {
          checkId: "unit-check",
          category: "unit",
          command: ["node", "--version"],
          timeoutMs: 10_000,
          criteria: [],
        },
      ],
    })
    expect(outcome.records).toHaveLength(1)
    expect(outcome.persistedPaths).toHaveLength(1)
    const record = outcome.records[0]
    if (record === undefined) throw new Error("verify-it: capture persisted no record")
    expect(record.status).toBe("passed")
    expect(record.runId).toBe("verify-it-p7")
    expect(ordinaryEvidenceFreshness(record, { sourceRevision: revision, epoch: 7 })).toEqual({
      fresh: true,
    })
    expect(ordinaryEvidenceFreshness(record, { sourceRevision: revision, epoch: 8 })).toEqual({
      fresh: false,
      reason: "run epoch changed",
    })
  })

  test("#given two children in one workspace #when one is cancelled #then each lifecycle stays its own task (P8)", async () => {
    // P8: concurrency. Cancelling the first child settles only its own record; the second keeps
    // running and later completes on its own path. Neither child carries a verification tool, and
    // an unapproved catalogue means neither host capture writes evidence.
    const harness = makeHarness("valid")
    try {
      const first = await harness.startChild({ category: "quick" })
      const second = await harness.startChild({ category: "quick" })
      expect(first.taskId).not.toBe(second.taskId)
      expect(capturedToolNames(harness, first.surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      expect(capturedToolNames(harness, second.surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)

      const terminal = harness.manager.waitFor(first.taskId)
      await harness.manager.cancelTask(first.taskId)
      const cancelled = await terminal
      expect(cancelled.status).toBe("cancelled")
      expect(harness.manager.get(second.taskId)?.status).toBe("running")

      const completed = await completeChild(harness, second.taskId, second.surfaceIndex)
      expect(completed.status).toBe("completed")
      expect(completed.verification_status).toBe("unverified")
      expect(existsSync(join(harness.evidenceRoot, first.taskId))).toBe(false)
      expect(existsSync(join(harness.evidenceRoot, second.taskId))).toBe(false)
    } finally {
      await harness.cleanup()
    }
  })

  test("#given persisted evidence #when a brand new store instance reads it #then the record parses with its run id (P9)", async () => {
    // P9: durability. This test replays P7's persist step verbatim in its own temp dirs (no
    // ordering dependence on P7), then reads through a BRAND NEW store instance over the
    // same root and parses the bytes.
    const root = trackRoot("senpi-verify-it-p9-")
    const workspace = join(root, "work")
    mkdirSync(workspace, { recursive: true })
    git(workspace, ["init"])
    const evidenceRoot = join(root, "evidence")
    const runner: DagVerifyRunner = async () => ({
      started: true,
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      output: "ok",
      outputBytes: 2,
      durationMs: 3,
      uncertainEffect: false,
    })
    const capture = createOrdinaryVerificationCapture({
      store: createFileEvidenceStore(evidenceRoot),
      projectDir: workspace,
      currentRevision: () => "verify-it-revision-p9",
      runner,
      isCancelled: () => false,
    })
    const outcome = await capture.capture({
      binding: { taskId: "verify-it-p9", sessionId: "verify-it-parent", epoch: 9 },
      changedFiles: ["src/work.ts"],
      available: [
        {
          checkId: "unit-check",
          category: "unit",
          command: ["node", "--version"],
          timeoutMs: 10_000,
          criteria: [],
        },
      ],
    })
    expect(outcome.persistedPaths).toHaveLength(1)

    const reopened = createFileEvidenceStore(evidenceRoot)
    expect(reopened.listVerifications("verify-it-p9")).toContain("run.unit-check.1.json")
    const text = reopened.readVerification("verify-it-p9", ORDINARY_VERIFICATION_NODE, "unit-check", 1)
    expect(text).not.toBeNull()
    if (text === null) throw new Error("verify-it: persisted evidence missing on re-read")
    const parsed = parseVerificationRecord(text)
    expect(parsed?.runId).toBe("verify-it-p9")
    expect(parsed?.checkId).toBe("unit-check")
    expect(parsed?.status).toBe("passed")
  })

  test("#given a curated read-only child #when the session is constructed #then neither it nor an ordinary child receives verify", async () => {
    // Security assertion: curated read-only children execute commands through a restricted broker,
    // and ordinary children no longer own verification authority at all. Both surfaces must be
    // tool-free; only the ordinary run's host capture may publish a verdict.
    const root = trackRoot("senpi-verify-it-curatedroot-")
    const marker = join(root, "marker.txt")
    const harness = makeHarness("valid", marker)
    try {
      approveMarkerCheck(harness)
      const curated = await harness.startChild({ subagent_type: "explore" })
      const ordinary = await harness.startChild({ category: "quick" })
      expect(capturedToolNames(harness, curated.surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      expect(capturedToolNames(harness, ordinary.surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)

      const curatedTerminal = await completeChild(harness, curated.taskId, curated.surfaceIndex)
      expect(curatedTerminal.status).toBe("completed")
      expect(curatedTerminal.verification_status).toBe("unverified")

      const ordinaryTerminal = await completeChild(harness, ordinary.taskId, ordinary.surfaceIndex)
      expect(ordinaryTerminal.status).toBe("completed")
      expect(ordinaryTerminal.verification_status).toBe("verified")
      expect(existsSync(join(harness.evidenceRoot, curated.taskId))).toBe(false)
      expect(existsSync(join(harness.evidenceRoot, ordinary.taskId))).toBe(true)
    } finally {
      await harness.cleanup()
    }
  })

  test("#given an approval written after spawn #when the child completes #then the run snapshot refuses and the command never runs (P10)", async () => {
    // P10: the completion snapshot cannot be self-approved mid-run. The child can write inside its
    // own project tree; authority was read at spawn, before the child had a turn, and that snapshot
    // is what the host capture consults. The later approval must not make the run executed/verified.
    const root = trackRoot("senpi-verify-it-p10root-")
    const marker = join(root, "marker.txt")
    const harness = makeHarness("valid", marker)
    try {
      const { taskId, surfaceIndex } = await harness.startChild({ category: "quick" })
      expect(capturedToolNames(harness, surfaceIndex)).not.toContain(VERIFY_TOOL_NAME)
      approveMarkerCheck(harness, "alcode:self-minted-by-the-child")

      const terminal = await completeChild(harness, taskId, surfaceIndex)
      expect(terminal.status).toBe("completed")
      expect(terminal.verification_status).toBe("unverified")
      expect(existsSync(marker)).toBe(false)
      expect(existsSync(join(harness.evidenceRoot, taskId))).toBe(false)
    } finally {
      await harness.cleanup()
    }
  })
})
