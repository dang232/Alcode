/**
 * ulw-tools.test.ts — unit coverage for the six native ULW tools.
 *
 * Every tool is built against an isolated store, so runs never leak
 * between tests. Refusals are asserted on the thrown value itself: no
 * timing, no polling, no luck.
 */

import { describe, expect, test } from "bun:test"
import { z } from "zod"

import type { OmoJsonObject, OmoJsonValue, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
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

const RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const FROZEN_NOW = 1700000000000

function testStore(): UlwStore {
  let counter = 0
  return new UlwStore({
    now: () => FROZEN_NOW,
    newRunId: () => `run-${(counter += 1)}`,
  })
}

function toolContext(): OmoToolContext {
  const directory = process.platform === "win32" ? "I:/work/project" : "/work/project"
  return {
    sessionID: "ses_main",
    messageID: "msg_1",
    agent: "test-agent",
    directory,
    worktree: directory,
    aborted: () => false,
  }
}

function activeRun(store: UlwStore, id = RUN_ID): void {
  store.createRun({ id, brief: "Ship the loop", sessionScope: "ses_main" })
}

async function jsonOf(tool: OmoToolDefinition, args: OmoJsonObject): Promise<OmoJsonValue> {
  const outcome = await tool.execute(args, toolContext())
  const text = z.string().parse(outcome)
  // SAFETY: every ULW tool answers with a JSON string; parsing it yields bounded JSON values.
  return JSON.parse(text) as OmoJsonValue
}

async function refusalOf(tool: OmoToolDefinition, args: OmoJsonObject): Promise<Error> {
  try {
    await tool.execute(args, toolContext())
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error("tool threw a non-error value")
  }
  throw new Error("tool executed instead of refusing")
}

describe("ulw_goal_create", () => {
  test("#given a brief and scope #when opened #then the run record pins id, scope, and active status", async () => {
    // given
    const store = testStore()
    const tool = createUlwGoalCreateTool({ store })

    // when
    // SAFETY: ulw_goal_create answers with the run record, which carries string id and status.
    const record = (await jsonOf(tool, { brief: "Ship the loop", sessionScope: "ses_main", id: RUN_ID })) as {
      id: string
      status: string
    }

    // then
    expect(record.id).toBe(RUN_ID)
    expect(record.status).toBe("active")
    expect(store.getRun(RUN_ID)).toMatchObject({ brief: "Ship the loop", sessionScope: "ses_main" })
  })

  test("#given no session scope #when opened #then the calling session owns the run", async () => {
    // given
    const store = testStore()
    const tool = createUlwGoalCreateTool({ store })

    // when
    // SAFETY: ulw_goal_create answers with the run record, which carries the string session scope.
    const record = (await jsonOf(tool, { brief: "Ship the loop", id: RUN_ID })) as { sessionScope: string }

    // then
    expect(record.sessionScope).toBe("ses_main")
  })

  test("#given a blank brief #when opened #then the caller is told what to fix", async () => {
    // given
    const tool = createUlwGoalCreateTool({ store: testStore() })

    // when
    const error = await refusalOf(tool, { brief: "  " })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
  })
})

describe("ulw_status", () => {
  test("#given runs #when no run id is passed #then every run is listed", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const tool = createUlwStatusTool({ store })

    // when
    // SAFETY: ulw_status without a run id answers with the run list, whose entries carry string ids.
    const status = (await jsonOf(tool, {})) as { runs: readonly { id: string }[] }

    // then
    expect(status.runs.map((run) => run.id)).toEqual([RUN_ID])
  })

  test("#given a dispatched run #when inspected #then roster, receipts, and missing goals are reported", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    store.dispatchGoal(RUN_ID, "G002", "ses_worker_b")
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_worker_a" })
    const tool = createUlwStatusTool({ store })

    // when
    // SAFETY: ulw_status for a run answers with its roster and missing receipts in the asserted shapes.
    const status = (await jsonOf(tool, { runId: RUN_ID })) as {
      roster: Record<string, readonly string[]>
      missingReceipts: readonly string[]
    }

    // then
    expect(status.roster).toEqual({ G001: ["ses_worker_a"], G002: ["ses_worker_b"] })
    expect(status.missingReceipts).toEqual(["G002"])
  })

  test("#given an unknown run #when inspected #then the lookup refusal travels", async () => {
    // given
    const tool = createUlwStatusTool({ store: testStore() })

    // when
    const error = await refusalOf(tool, { runId: "ghost" })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
    // SAFETY: the instanceof expect above proves `error` is a UlwUsageError.
    expect((error as UlwUsageError).code).toBe("RUN_NOT_FOUND")
  })
})

describe("ulw_dispatch single", () => {
  test("#given a goal and worker #when dispatched #then the roster entry is recorded", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const tool = createUlwDispatchTool({ store })

    // when
    // SAFETY: a single ulw_dispatch answers with the goal's worker session list.
    const dispatch = (await jsonOf(tool, {
      runId: RUN_ID,
      goalId: "G001",
      workerSessionId: "ses_worker_a",
    })) as { workers: readonly string[] }

    // then
    expect(dispatch.workers).toEqual(["ses_worker_a"])
    expect(store.rosterFor(RUN_ID)).toEqual({ G001: ["ses_worker_a"] })
  })

  test("#given no worker session #when dispatched #then the caller is told what to fix", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const tool = createUlwDispatchTool({ store })

    // when
    const error = await refusalOf(tool, { runId: RUN_ID, goalId: "G001" })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
  })

  test("#given an unknown run #when dispatched #then the lookup refusal travels", async () => {
    // given
    const tool = createUlwDispatchTool({ store: testStore() })

    // when
    const error = await refusalOf(tool, { runId: "ghost", goalId: "G001", workerSessionId: "ses_w" })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
  })
})

describe("ulw_dispatch batch", () => {
  test("#given explicit worker sessions #when dispatched #then every goal is recorded without spawning", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const tool = createUlwDispatchTool({ store })

    // when
    // SAFETY: a batch ulw_dispatch answers with one entry per goal, each naming goal and worker session.
    const batch = (await jsonOf(tool, {
      runId: RUN_ID,
      goals: [
        { goalId: "G001", workerSessionId: "ses_worker_a" },
        { goalId: "G002", workerSessionId: "ses_worker_b" },
      ],
    })) as { dispatches: readonly { goalId: string; workerSessionId: string }[] }

    // then
    expect(batch.dispatches.map((dispatch) => [dispatch.goalId, dispatch.workerSessionId])).toEqual([
      ["G001", "ses_worker_a"],
      ["G002", "ses_worker_b"],
    ])
  })

  test("#given goals without sessions and no client #when dispatched #then the tool names the explicit-session fallback", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const tool = createUlwDispatchTool({ store })

    // when
    const error = await refusalOf(tool, { runId: RUN_ID, goals: [{ goalId: "G001" }] })

    // then
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("workerSessionId")
    // The refusal is a dead end only if it hides the one spawner the model does have.
    expect(error.message).toContain("task worker per goal")
    expect(store.dispatchedGoalIds(RUN_ID)).toEqual([])
  })

  test("#given goals and a host client #when dispatched #then the pool spawns one worker per goal", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const fake = createFakeHostClient()
    const tool = createUlwDispatchTool({ store, getClient: () => fake.client })

    // when
    // SAFETY: a spawned batch ulw_dispatch answers with one entry per goal, each naming the spawned session.
    const batch = (await jsonOf(tool, {
      runId: RUN_ID,
      maxParallel: 1,
      goals: [
        { goalId: "G001", prompt: "Do the assigned work well." },
        { goalId: "G002", prompt: "Do the assigned work well." },
      ],
    })) as { dispatches: readonly { goalId: string; workerSessionId: string }[] }

    // then
    expect(batch.dispatches).toHaveLength(2)
    for (const dispatch of batch.dispatches) {
      expect(dispatch.workerSessionId.startsWith("ses_fake_")).toBe(true)
      expect(fake.sessions.has(dispatch.workerSessionId)).toBe(true)
    }
    expect(store.dispatchedGoalIds(RUN_ID).sort()).toEqual(["G001", "G002"])
    const creates = fake.calls.filter((call) => call.method === "create")
    expect(creates).toHaveLength(2)
  })

  test("#given a pool failure #when dispatched #then the failure travels and nothing is recorded", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const fake = createFakeHostClient({ createErrorMessage: "boom" })
    const tool = createUlwDispatchTool({ store, getClient: () => fake.client })

    // when
    const error = await refusalOf(tool, { runId: RUN_ID, goals: [{ goalId: "G001" }] })

    // then
    expect(error).toBeInstanceOf(TeamRuntimeError)
    // SAFETY: the instanceof expect above proves `error` is a TeamRuntimeError.
    expect((error as TeamRuntimeError).code).toBe("member_start_rejected")
    expect(store.dispatchedGoalIds(RUN_ID)).toEqual([])
  })

  test("#given a plan-gated specialist without session evidence #when dispatched #then the pool denial travels", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const fake = createFakeHostClient()
    const tool = createUlwDispatchTool({ store, getClient: () => fake.client })

    // when
    const error = await refusalOf(tool, {
      runId: RUN_ID,
      goals: [{ goalId: "G001", agent: "plan-consultant" }],
    })

    // then
    expect(error).toBeInstanceOf(TeamRuntimeError)
    expect(fake.sessions.size).toBe(0)
    expect(store.dispatchedGoalIds(RUN_ID)).toEqual([])
  })

  test("#given a partial pool failure #when dispatched #then spawned workers are cancelled and nothing is recorded", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const fake = createFakeHostClient()
    const spawned = new Map([
      ["g001", {
        name: "g001",
        sessionId: "ses_fake_partial",
        status: "running" as const,
        agentType: "general-purpose" as const,
      }],
    ])
    const failure = new TeamRuntimeError("member 'g002' failed to start: boom", "member_start_rejected", RUN_ID)
    const tool = createUlwDispatchTool({
      store,
      getClient: () => fake.client,
      spawnMembers: async () => ({ spawned, failure }),
    })

    // when
    const error = await refusalOf(tool, {
      runId: RUN_ID,
      goals: [{ goalId: "G001" }, { goalId: "G002" }],
    })

    // then
    expect(error).toBeInstanceOf(TeamRuntimeError)
    expect(store.dispatchedGoalIds(RUN_ID)).toEqual([])
    const interrupts = fake.calls.filter((call) => call.method === "interrupt")
    expect(interrupts.length).toBeGreaterThanOrEqual(1)
  })

  test("#given explicit goals plus a failing spawn #when dispatched #then explicit goals stay unrecorded", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const fake = createFakeHostClient({ createErrorMessage: "boom" })
    const tool = createUlwDispatchTool({ store, getClient: () => fake.client })

    // when
    const error = await refusalOf(tool, {
      runId: RUN_ID,
      goals: [{ goalId: "G001", workerSessionId: "ses_worker_a" }, { goalId: "G002" }],
    })

    // then
    expect(error).toBeInstanceOf(TeamRuntimeError)
    expect(store.dispatchedGoalIds(RUN_ID)).toEqual([])
  })
})

describe("ulw_evidence", () => {
  test("#given a dispatched goal #when the child result is recorded #then the receipt settles the dispatch", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    const tool = createUlwEvidenceTool({ store })

    // when
    // SAFETY: ulw_evidence answers with the recorded receipt, which carries the string result status.
    const receipt = (await jsonOf(tool, {
      runId: RUN_ID,
      goalId: "G001",
      childSessionId: "ses_worker_a",
      resultRef: "a0/report.md",
    })) as { status: string }

    // then
    expect(receipt.status).toBe("completed")
    expect(store.missingReceipts(RUN_ID)).toEqual([])
  })

  test("#given a failed child #when the reason is recorded #then the receipt keeps the failure", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    const tool = createUlwEvidenceTool({ store })

    // when
    // SAFETY: ulw_evidence answers with the recorded receipt, which carries status and reason.
    const receipt = (await jsonOf(tool, {
      runId: RUN_ID,
      goalId: "G001",
      childSessionId: "ses_worker_a",
      status: "failed",
      reason: "worker timed out",
    })) as { status: string; reason: string }

    // then
    expect(receipt).toMatchObject({ status: "failed", reason: "worker timed out" })
  })

  test("#given an undispatched goal #when evidence is recorded #then the receipt is refused", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const tool = createUlwEvidenceTool({ store })

    // when
    const error = await refusalOf(tool, { runId: RUN_ID, goalId: "G009", childSessionId: "ses_w" })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
    // SAFETY: the instanceof expect above proves `error` is a UlwUsageError.
    expect((error as UlwUsageError).code).toBe("GOAL_NOT_DISPATCHED")
  })

  test("#given an unknown result status #when evidence is recorded #then the caller is told what to fix", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    const tool = createUlwEvidenceTool({ store })

    // when
    const error = await refusalOf(tool, {
      runId: RUN_ID,
      goalId: "G001",
      childSessionId: "ses_worker_a",
      status: "pending",
    })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
  })
})

describe("ulw_checkpoint", () => {
  test("#given every dispatch has its receipt #when checkpointed #then the gate passes", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_worker_a" })
    const tool = createUlwCheckpointTool({ store })

    // when
    // SAFETY: a passing ulw_checkpoint answers with the gate result, which lists missing goals.
    const result = (await jsonOf(tool, { runId: RUN_ID })) as { missingGoalIds: readonly string[] }

    // then
    expect(result.missingGoalIds).toEqual([])
  })

  test("#given a dispatched goal with no receipt #when checkpointed #then the refusal lists the missing goal", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    store.dispatchGoal(RUN_ID, "G002", "ses_worker_b")
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_worker_a" })
    const tool = createUlwCheckpointTool({ store })

    // when
    const error = await refusalOf(tool, { runId: RUN_ID })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
    // SAFETY: the instanceof expect above proves `error` is a UlwUsageError.
    expect((error as UlwUsageError).code).toBe("DISPATCHED_CHILDREN_PENDING")
    // SAFETY: the instanceof expect above proves `error` is a UlwUsageError.
    expect((error as UlwUsageError).missingGoalIds).toEqual(["G002"])
  })

  test("#given a goal-scoped checkpoint #when only out-of-scope goals are pending #then the gate passes", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    store.dispatchGoal(RUN_ID, "G002", "ses_worker_b")
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_worker_a" })
    const tool = createUlwCheckpointTool({ store })

    // when
    // SAFETY: a passing ulw_checkpoint answers with the gate result, which lists the checked goals.
    const result = (await jsonOf(tool, { runId: RUN_ID, goalIds: ["G001"] })) as {
      checkedGoalIds: readonly string[]
    }

    // then
    expect(result.checkedGoalIds).toEqual(["G001"])
  })
})

describe("ulw_complete", () => {
  test("#given pending receipts #when completed #then the checkpoint refusal travels", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    const tool = createUlwCompleteTool({ store })

    // when
    const error = await refusalOf(tool, { runId: RUN_ID, status: "complete" })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
    // SAFETY: the instanceof expect above proves `error` is a UlwUsageError.
    expect((error as UlwUsageError).code).toBe("DISPATCHED_CHILDREN_PENDING")
    expect(store.getRun(RUN_ID)?.status).toBe("active")
  })

  test("#given settled receipts #when completed #then the run closes", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_worker_a" })
    const tool = createUlwCompleteTool({ store })

    // when
    // SAFETY: ulw_complete answers with the updated run record, which carries the string status.
    const record = (await jsonOf(tool, { runId: RUN_ID, status: "complete" })) as { status: string }

    // then
    expect(record.status).toBe("complete")
  })

  test("#given pending receipts #when failed #then the run closes without waiting on them", async () => {
    // given
    const store = testStore()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    const tool = createUlwCompleteTool({ store })

    // when
    // SAFETY: ulw_complete answers with the updated run record, which carries the string status.
    const record = (await jsonOf(tool, { runId: RUN_ID, status: "failed" })) as { status: string }

    // then
    expect(record.status).toBe("failed")
  })

  test("#given an unknown status #when closed #then the caller is told what to fix", async () => {
    // given
    const store = testStore()
    activeRun(store)
    const tool = createUlwCompleteTool({ store })

    // when
    const error = await refusalOf(tool, { runId: RUN_ID, status: "done" })

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
  })
})
