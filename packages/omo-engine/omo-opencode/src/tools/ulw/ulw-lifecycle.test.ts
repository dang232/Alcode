/**
 * ulw-lifecycle.test.ts — engine lifecycle regression tests (cases 4-8).
 *
 * Gap coverage: the per-tool suites assert each tool in isolation. These
 * cases drive the full run lifecycle through the real tools against one
 * shared store — create, dispatch (including real spawned child sessions),
 * evidence, checkpoint, terminal completion — proving parent association,
 * receipt updates, terminal states, and cancellation.
 */

import { describe, expect, test } from "bun:test"
import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { createFakeHostClient } from "../../team/fake-host-client.ts"
import { TeamRuntimeError } from "../../team/runtime-errors.ts"
import { UlwUsageError } from "../../ulw/errors.ts"
import { UlwStore } from "../../ulw/store.ts"
import { createUlwCheckpointTool } from "./checkpoint.ts"
import { createUlwCompleteTool } from "./complete.ts"
import { createUlwDispatchTool } from "./dispatch.ts"
import { createUlwEvidenceTool } from "./evidence.ts"
import { createUlwGoalCreateTool } from "./goal-create.ts"
import { createUlwStatusTool } from "./status.ts"

const FROZEN_NOW = 1700000000000

function testStore(): UlwStore {
  let counter = 0
  return new UlwStore({
    now: () => FROZEN_NOW,
    newRunId: () => `lifecycle-run-${(counter += 1)}`,
  })
}

function toolContext(sessionID = "ses_main"): OmoToolContext {
  const directory = process.platform === "win32" ? "I:/work/project" : "/work/project"
  return {
    sessionID,
    messageID: "msg_1",
    agent: "test-agent",
    directory,
    worktree: directory,
    aborted: () => false,
  }
}

async function jsonOf(
  tool: OmoToolDefinition,
  args: OmoJsonObject,
  context: OmoToolContext = toolContext(),
): Promise<OmoJsonObject> {
  const outcome = await tool.execute(args, context)
  const text = z.string().parse(outcome)
  // SAFETY: every ULW tool answers with a JSON string; parsing it yields bounded JSON values.
  return JSON.parse(text) as OmoJsonObject
}

async function refusalOf(
  tool: OmoToolDefinition,
  args: OmoJsonObject,
  context: OmoToolContext = toolContext(),
): Promise<Error> {
  try {
    await tool.execute(args, context)
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error("tool threw a non-error value")
  }
  throw new Error("tool executed instead of refusing")
}

describe("lifecycle (4) child sessions stay with their parent", () => {
  test("#given two active runs #when real children spawn for one #then every child links to the calling parent and the sibling run stays empty", async () => {
    // given
    const store = testStore()
    const fake = createFakeHostClient()
    const goalCreate = createUlwGoalCreateTool({ store })
    const dispatch = createUlwDispatchTool({ store, getClient: () => fake.client })
    await jsonOf(goalCreate, { brief: "Run A", id: "run-4a" }, toolContext("ses_main"))
    await jsonOf(goalCreate, { brief: "Run B", id: "run-4b" }, toolContext("ses_main"))

    // when
    // SAFETY: a spawned batch ulw_dispatch answers with one entry per goal, each naming the spawned session.
    const batch = (await jsonOf(
      dispatch,
      {
        runId: "run-4a",
        goals: [
          { goalId: "G001", prompt: "Do the assigned work well." },
          { goalId: "G002", prompt: "Do the assigned work well." },
        ],
      },
      toolContext("ses_main"),
    )) as { dispatches: readonly { goalId: string; workerSessionId: string }[] }

    // then
    expect(batch.dispatches).toHaveLength(2)
    for (const entry of batch.dispatches) {
      expect(fake.sessions.has(entry.workerSessionId)).toBe(true)
      expect(fake.sessions.get(entry.workerSessionId)?.parentID).toBe("ses_main")
    }
    expect(store.dispatchedGoalIds("run-4b")).toEqual([])
    expect(store.missingReceipts("run-4b")).toEqual([])

    // when — the same goal id is dispatched to the sibling run
    await jsonOf(
      dispatch,
      { runId: "run-4b", goalId: "G001", workerSessionId: "ses_other" },
      toolContext("ses_main"),
    )

    // then — the sibling dispatch stays with its own run
    expect(store.rosterFor("run-4a")["G001"]).not.toContain("ses_other")
    expect(store.rosterFor("run-4b")).toEqual({ G001: ["ses_other"] })
  })
})

describe("lifecycle (5) goal and child results update the run", () => {
  test("#given dispatched goals #when child results arrive through evidence #then the run receipts update with each goal result", async () => {
    // given
    const store = testStore()
    const goalCreate = createUlwGoalCreateTool({ store })
    const dispatch = createUlwDispatchTool({ store })
    const evidence = createUlwEvidenceTool({ store })
    const status = createUlwStatusTool({ store })
    await jsonOf(goalCreate, { brief: "Ship the loop", id: "run-5" })
    await jsonOf(dispatch, { runId: "run-5", goalId: "G001", workerSessionId: "ses_w_a" })
    await jsonOf(dispatch, { runId: "run-5", goalId: "G002", workerSessionId: "ses_w_b" })

    // when
    await jsonOf(evidence, {
      runId: "run-5",
      goalId: "G001",
      childSessionId: "ses_w_a",
      resultRef: "a0/report.md",
    })
    await jsonOf(evidence, {
      runId: "run-5",
      goalId: "G002",
      childSessionId: "ses_w_b",
      status: "failed",
      reason: "worker timed out",
    })

    // then
    // SAFETY: ulw_status for a run answers with its roster, receipts, and missing receipts.
    const report = (await jsonOf(status, { runId: "run-5" })) as {
      roster: Record<string, readonly string[]>
      receipts: Record<string, { childSessionId: string; status: string }>
      missingReceipts: readonly string[]
    }
    expect(report.missingReceipts).toEqual([])
    expect(report.receipts["G001"]).toMatchObject({
      childSessionId: "ses_w_a",
      status: "completed",
    })
    expect(report.receipts["G002"]).toMatchObject({
      childSessionId: "ses_w_b",
      status: "failed",
    })
    expect(store.receiptFor("run-5", "G001")?.resultRef).toBe("a0/report.md")
  })
})

describe("lifecycle (6) success reaches terminal completion", () => {
  test("#given a fully-evidenced run #when checkpointed then completed #then the run terminates complete with receipts intact and refuses further work", async () => {
    // given
    const store = testStore()
    const goalCreate = createUlwGoalCreateTool({ store })
    const dispatch = createUlwDispatchTool({ store })
    const evidence = createUlwEvidenceTool({ store })
    const checkpoint = createUlwCheckpointTool({ store })
    const complete = createUlwCompleteTool({ store })
    const status = createUlwStatusTool({ store })
    await jsonOf(goalCreate, { brief: "Ship the loop", id: "run-6" })
    await jsonOf(dispatch, { runId: "run-6", goalId: "G001", workerSessionId: "ses_w_a" })
    await jsonOf(evidence, {
      runId: "run-6",
      goalId: "G001",
      childSessionId: "ses_w_a",
      resultRef: "a0/report.md",
    })

    // when — the required synthesis gate passes, then the run completes
    // SAFETY: a passing ulw_checkpoint answers with the gate result, which lists missing goals.
    const gate = (await jsonOf(checkpoint, { runId: "run-6" })) as {
      missingGoalIds: readonly string[]
    }
    expect(gate.missingGoalIds).toEqual([])
    // SAFETY: ulw_complete answers with the updated run record, which carries the string status.
    const record = (await jsonOf(complete, { runId: "run-6", status: "complete" })) as {
      status: string
    }

    // then
    expect(record.status).toBe("complete")
    // SAFETY: ulw_status for a run answers with its record, receipts, and missing receipts.
    const report = (await jsonOf(status, { runId: "run-6" })) as {
      run: { status: string }
      receipts: Record<string, { status: string }>
      missingReceipts: readonly string[]
    }
    expect(report.run.status).toBe("complete")
    expect(report.receipts["G001"]).toMatchObject({ status: "completed" })
    expect(report.missingReceipts).toEqual([])
    const dispatchError = await refusalOf(dispatch, {
      runId: "run-6",
      goalId: "G002",
      workerSessionId: "ses_w_b",
    })
    expect(dispatchError).toBeInstanceOf(UlwUsageError)
    // SAFETY: the instanceof expect above proves `dispatchError` is a UlwUsageError.
    expect((dispatchError as UlwUsageError).code).toBe("RUN_NOT_ACTIVE")
    const evidenceError = await refusalOf(evidence, {
      runId: "run-6",
      goalId: "G001",
      childSessionId: "ses_w_a",
    })
    expect(evidenceError).toBeInstanceOf(UlwUsageError)
  })
})

describe("lifecycle (7) provider failure ends failed, never false-success", () => {
  test("#given a provider failure mid-dispatch #when the run is failed #then the run is failed, never complete and never left running", async () => {
    // given
    const store = testStore()
    const fake = createFakeHostClient({ createErrorMessage: "boom" })
    const goalCreate = createUlwGoalCreateTool({ store })
    const dispatch = createUlwDispatchTool({ store, getClient: () => fake.client })
    const complete = createUlwCompleteTool({ store })
    const status = createUlwStatusTool({ store })
    await jsonOf(goalCreate, { brief: "Ship the loop", id: "run-7" })

    // when — the provider failure travels and records nothing
    const dispatchError = await refusalOf(dispatch, {
      runId: "run-7",
      goals: [{ goalId: "G001", prompt: "Do the assigned work well." }],
    })
    expect(dispatchError).toBeInstanceOf(TeamRuntimeError)
    expect(store.dispatchedGoalIds("run-7")).toEqual([])
    // SAFETY: ulw_complete answers with the updated run record, which carries the string status.
    const record = (await jsonOf(complete, { runId: "run-7", status: "failed" })) as {
      status: string
    }

    // then — failed state, never false success, never permanent running
    expect(record.status).toBe("failed")
    expect(record.status).not.toBe("complete")
    expect(record.status).not.toBe("active")
    // SAFETY: ulw_status for a run answers with its record.
    const report = (await jsonOf(status, { runId: "run-7" })) as { run: { status: string } }
    expect(report.run.status).toBe("failed")
    expect(store.getRun("run-7")?.status).toBe("failed")
  })

  // FAIL (source gap): terminal states are not terminal. ulw_complete
  // moves any known run via `store.setRunStatus` with no active/terminal
  // check (src/tools/ulw/complete.ts:54; src/ulw/store.ts:116), so a failed
  // run re-completes with status complete once the receipt gate passes
  // vacuously — a false success. The exact assertion below throws
  // `Error: tool executed instead of refusing` instead of resolving a
  // RUN_NOT_ACTIVE refusal. Fixer: refuse ulw_complete once the run has
  // left active, then drop `.failing` here.
  test("#given a failed run #when completed #then the false success is refused", async () => {
    // given
    const store = testStore()
    const fake = createFakeHostClient({ createErrorMessage: "boom" })
    const goalCreate = createUlwGoalCreateTool({ store })
    const dispatch = createUlwDispatchTool({ store, getClient: () => fake.client })
    const complete = createUlwCompleteTool({ store })
    await jsonOf(goalCreate, { brief: "Ship the loop", id: "run-7b" })
    await refusalOf(dispatch, {
      runId: "run-7b",
      goals: [{ goalId: "G001", prompt: "Do the assigned work well." }],
    })
    await jsonOf(complete, { runId: "run-7b", status: "failed" })

    // when / then
    const error = await refusalOf(complete, { runId: "run-7b", status: "complete" })
    expect(error).toBeInstanceOf(UlwUsageError)
    // SAFETY: the instanceof expect above proves `error` is a UlwUsageError.
    expect((error as UlwUsageError).code).toBe("RUN_NOT_ACTIVE")
  })
})

describe("lifecycle (8) cancellation marks the run and children cancelled", () => {
  // FAIL (source gap): cancellation has no terminal state. UlwRunStatus is
  // "active" | "complete" | "failed" | "blocked" (src/ulw/types.ts:19) and
  // ulw_complete only accepts complete/failed/blocked
  // (src/tools/ulw/complete.ts:30), so an active run with live children
  // cannot be marked cancelled — the exact assertion below throws
  // UlwUsageError INVALID_INPUT instead of resolving a cancelled record.
  // Fixer: add the cancelled terminal state plus child interrupt, then drop
  // `.failing` here so this case enforces the contract for real.
  test.failing("#FAIL given an active run with live children #when cancelled #then the run and children are marked cancelled", async () => {
    // given
    const store = testStore()
    const fake = createFakeHostClient()
    const goalCreate = createUlwGoalCreateTool({ store })
    const dispatch = createUlwDispatchTool({ store, getClient: () => fake.client })
    const complete = createUlwCompleteTool({ store })
    await jsonOf(goalCreate, { brief: "Ship the loop", id: "run-8" })
    // SAFETY: a spawned batch ulw_dispatch answers with one entry per goal, each naming the spawned session.
    const batch = (await jsonOf(
      dispatch,
      { runId: "run-8", goals: [{ goalId: "G001", prompt: "Do the assigned work well." }] },
      toolContext("ses_main"),
    )) as { dispatches: readonly { goalId: string; workerSessionId: string }[] }
    expect(batch.dispatches).toHaveLength(1)
    expect(fake.sessions.has(batch.dispatches[0].workerSessionId)).toBe(true)

    // when
    // SAFETY: cancelling a run must answer with the updated run record carrying status cancelled.
    const record = (await jsonOf(complete, { runId: "run-8", status: "cancelled" })) as {
      status: string
    }

    // then
    expect(record.status).toBe("cancelled")
  })
})
