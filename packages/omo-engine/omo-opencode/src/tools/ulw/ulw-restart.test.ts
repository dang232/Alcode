/**
 * ulw-restart.test.ts — restart and recovery semantics for the native ULW tools.
 *
 * The store persists runs, rosters, receipts, dead workers, and submission
 * claims to one versioned file; it never reads the CLI loop files, so a
 * backend restart recovers only what the tools wrote. Recovery is
 * restoration from that file plus explicit re-dispatch — never silent
 * re-creation — and a restart must never resurrect phantom runs, duplicate
 * workers, or settled receipts. These cases pin that contract through the
 * real tool constructors: goal-create, dispatch (with a spawning host
 * client), evidence, checkpoint, complete, and status.
 */

import { describe, expect, test } from "bun:test"
import { z } from "zod"

import type { OmoJsonObject, OmoJsonValue, OmoToolDefinition } from "../../plugin-types.ts"
import { createFakeHostClient } from "../../team/fake-host-client.ts"
import { FileUlwPersistence } from "../../ulw/persistence.ts"
import { UlwStore } from "../../ulw/store.ts"
import { createUlwCheckpointTool } from "./checkpoint.ts"
import { createUlwCompleteTool } from "./complete.ts"
import { createUlwDispatchTool } from "./dispatch.ts"
import { createUlwEvidenceTool } from "./evidence.ts"
import { createUlwGoalCreateTool } from "./goal-create.ts"
import { createUlwStatusTool } from "./status.ts"

const RUN_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const FROZEN_NOW = 1700000000000

function testStore(): UlwStore {
  let counter = 0
  return new UlwStore({
    now: () => FROZEN_NOW,
    newRunId: () => `run-${(counter += 1)}`,
  })
}

function toolContext() {
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

describe("ulw restart and recovery", () => {
  test("#given a full run #when driven through the real tools #then workers are real sessions and completion is gated", async () => {
    // given
    const store = testStore()
    const fake = createFakeHostClient()
    const create = createUlwGoalCreateTool({ store })
    const dispatch = createUlwDispatchTool({ store, getClient: () => fake.client })
    const evidence = createUlwEvidenceTool({ store })
    const checkpoint = createUlwCheckpointTool({ store })
    const complete = createUlwCompleteTool({ store })

    // when: open the run, then spawn one real worker per goal
    await jsonOf(create, { brief: "Ship the loop", sessionScope: "ses_main", id: RUN_ID })
    // SAFETY: a spawned batch ulw_dispatch answers with one entry per goal, each naming the spawned session.
    const batch = (await jsonOf(dispatch, {
      runId: RUN_ID,
      maxParallel: 2,
      goals: [
        { goalId: "G001", prompt: "Do the assigned work well." },
        { goalId: "G002", prompt: "Do the assigned work well." },
      ],
    })) as { dispatches: readonly { goalId: string; workerSessionId: string }[] }
    const byGoal = new Map(batch.dispatches.map((d) => [d.goalId, d.workerSessionId]))

    // then: every worker id names a session the host client actually spawned
    expect(batch.dispatches).toHaveLength(2)
    for (const dispatch of batch.dispatches) {
      expect(fake.sessions.has(dispatch.workerSessionId)).toBe(true)
    }

    // when: only the first goal reports back
    await jsonOf(evidence, {
      runId: RUN_ID,
      goalId: "G001",
      childSessionId: byGoal.get("G001"),
      status: "completed",
    })
    const refusal = await refusalOf(checkpoint, { runId: RUN_ID })

    // then: the checkpoint names the unsettled goal instead of closing over it
    expect(refusal.message).toContain("G002")

    // when: the second goal reports failure and the run checkpoints
    await jsonOf(evidence, {
      runId: RUN_ID,
      goalId: "G002",
      childSessionId: byGoal.get("G002"),
      status: "failed",
      reason: "worker hit a real error",
    })
    // SAFETY: ulw_checkpoint answers with the gated scope, which carries the checked and missing goal ids.
    const gate = (await jsonOf(checkpoint, { runId: RUN_ID })) as {
      runId: string
      checkedGoalIds: readonly string[]
      missingGoalIds: readonly string[]
    }
    expect(gate.missingGoalIds).toEqual([])
    expect([...gate.checkedGoalIds].sort()).toEqual(["G001", "G002"])

    // then: the run closes only once every dispatch has its receipt
    // SAFETY: ulw_complete answers with the run record, which carries the terminal status.
    const closed = (await jsonOf(complete, { runId: RUN_ID, status: "complete" })) as { status: string }
    expect(closed.status).toBe("complete")
    expect(store.receiptFor(RUN_ID, "G002")).toMatchObject({ status: "failed" })
  })

  test("#given a backend restart #when the store reloads its file #then completed work is kept and unfinished work reconciles", async () => {
    // given: a run with two spawned workers, one receipt, one still out
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const nodeFs = await import("node:fs")
    const dir = mkdtempSync(join(tmpdir(), "ulw-restart-"))
    try {
      const filePath = join(dir, "ulw", "store.json")
      const persistent = () =>
        new UlwStore({
          now: () => FROZEN_NOW,
          newRunId: `run-${Math.random().toString(36).slice(2)}`,
          persistence: new FileUlwPersistence({ fs: nodeFs, filePath }),
        })
      const before = persistent()
      const fake = createFakeHostClient()
      await jsonOf(createUlwGoalCreateTool({ store: before }), {
        brief: "Ship the loop",
        sessionScope: "ses_main",
        id: RUN_ID,
      })
      // SAFETY: a spawned batch ulw_dispatch answers with one entry per goal, each naming the spawned session.
      const batch = (await jsonOf(
        createUlwDispatchTool({ store: before, getClient: () => fake.client }),
        {
          runId: RUN_ID,
          goals: [
            { goalId: "G001", prompt: "Do the assigned work well." },
            { goalId: "G002", prompt: "Do the assigned work well." },
          ],
        },
      )) as { dispatches: readonly { goalId: string; workerSessionId: string }[] }
      const workerOf = new Map(batch.dispatches.map((dispatch) => [dispatch.goalId, dispatch.workerSessionId]))
      await jsonOf(createUlwEvidenceTool({ store: before }), {
        runId: RUN_ID,
        goalId: "G001",
        childSessionId: workerOf.get("G001"),
        status: "completed",
      })

      // when: the backend restarts — the old store is dropped, a new one loads the same file
      const after = persistent()
      expect(after.getLoadReport()).toMatchObject({ durable: true, reason: "recovered" })

      // then: identity, roster, receipts, and evidence are intact
      expect(after.getRun(RUN_ID)).toMatchObject({ brief: "Ship the loop", sessionScope: "ses_main" })
      expect(after.receiptFor(RUN_ID, "G001")).toMatchObject({ status: "completed" })
      // The finished worker is not dispatched again: its pair is already recorded once.
      // SAFETY: workerOf was built from the dispatch batch above, so G001 maps to a real session id.
      expect(after.dispatchGoal(RUN_ID, "G001", workerOf.get("G001") as string)).toEqual([workerOf.get("G001")])
      // The unfinished worker reconciles against the real host: ses_fake_ sessions
      // the fake host still holds read alive, unknown ones read dead.
      const reconciled = after.reconcileRun(RUN_ID, (sessionId) => fake.sessions.has(sessionId))
      expect(reconciled.alive).toEqual([workerOf.get("G002")])
      expect(reconciled.dead).toEqual([])
      expect(after.interruptedFor(RUN_ID)).toEqual([
        { goalId: "G002", workerSessionId: workerOf.get("G002"), state: "awaiting" },
      ])

      // when: the run recovers — re-dispatch the interrupted goal to a new worker and settle it
      // SAFETY: a spawned batch ulw_dispatch answers with one entry per goal, each naming the spawned session.
      const retry = (await jsonOf(
        createUlwDispatchTool({ store: after, getClient: () => fake.client }),
        { runId: RUN_ID, goals: [{ goalId: "G002", prompt: "Do the assigned work well." }] },
      )) as { dispatches: readonly { goalId: string; workerSessionId: string }[] }
      expect(retry.dispatches[0].workerSessionId).not.toBe(workerOf.get("G002"))
      await jsonOf(createUlwEvidenceTool({ store: after }), {
        runId: RUN_ID,
        goalId: "G002",
        childSessionId: retry.dispatches[0].workerSessionId,
        status: "completed",
      })

      // then: checkpoint passes and the run completes with no duplicate execution
      // SAFETY: ulw_checkpoint answers with the gated scope, which carries the checked and missing goal ids.
      const gate = (await jsonOf(createUlwCheckpointTool({ store: after }), { runId: RUN_ID })) as {
        missingGoalIds: readonly string[]
      }
      expect(gate.missingGoalIds).toEqual([])
      // SAFETY: ulw_complete answers with the run record, which carries the terminal status.
      const closed = (await jsonOf(createUlwCompleteTool({ store: after }), { runId: RUN_ID, status: "complete" })) as {
        status: string
      }
      expect(closed.status).toBe("complete")
      expect(fake.sessions.size).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given a duplicate delivery of one submission #when goal-create runs twice #then one run opens and both resolve to it", async () => {
    // given
    const store = testStore()
    const create = createUlwGoalCreateTool({ store })
    const status = createUlwStatusTool({ store })

    // when: the same pending submission is delivered twice
    // SAFETY: ulw_goal_create answers with the run record, which carries string id and status.
    const first = (await jsonOf(create, { brief: "Ship the loop", sessionScope: "ses_main", submissionId: "sub-1" })) as {
      id: string
      deduped: boolean
    }
    // SAFETY: a repeated submission resolves to the accepted run, whose record carries the same string id.
    const second = (await jsonOf(create, { brief: "Ship the loop", sessionScope: "ses_main", submissionId: "sub-1" })) as {
      id: string
      deduped: boolean
    }

    // then: one root run, both deliveries resolve to it, no duplicate workers
    expect(first.deduped).toBe(false)
    expect(second.deduped).toBe(true)
    expect(second.id).toBe(first.id)
    expect(store.listRuns()).toHaveLength(1)
    // SAFETY: ulw_status for a submission answers with that submission's run record.
    const resolved = (await jsonOf(status, { submissionId: "sub-1" })) as { run: { id: string } }
    expect(resolved.run.id).toBe(first.id)
  })

  test("#given identical brief text #when submissions differ #then two independent runs open", async () => {
    // given
    const store = testStore()
    const create = createUlwGoalCreateTool({ store })

    // when: two intentional submissions carry the same prompt text
    // SAFETY: ulw_goal_create answers with the run record, which carries string id and status.
    const first = (await jsonOf(create, { brief: "Same words", sessionScope: "ses_main", submissionId: "sub-a" })) as {
      id: string
    }
    // SAFETY: a different submission opens its own run, whose record carries a different string id.
    const second = (await jsonOf(create, { brief: "Same words", sessionScope: "ses_main", submissionId: "sub-b" })) as {
      id: string
    }

    // then: identical text never merges separate submissions
    expect(second.id).not.toBe(first.id)
    expect(store.listRuns()).toHaveLength(2)
  })

  test("#given an existing run id #when opened again #then the second open is refused, never duplicated", async () => {
    // given
    const store = testStore()
    const create = createUlwGoalCreateTool({ store })
    await jsonOf(create, { brief: "Ship the loop", sessionScope: "ses_main", id: RUN_ID })

    // when / then: a retry with the same id is refused instead of forking the run
    const refusal = await refusalOf(create, { brief: "Ship the loop", sessionScope: "ses_main", id: RUN_ID })
    expect(refusal.message).toContain(RUN_ID)
    expect(store.listRuns()).toHaveLength(1)
  })

  test("#given a submission accepted before restart #when redelivered after restart #then it resolves to the recovered run", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const nodeFs = await import("node:fs")
    const dir = mkdtempSync(join(tmpdir(), "ulw-submission-restart-"))
    try {
      const filePath = join(dir, "ulw", "store.json")
      const freshStore = () =>
        new UlwStore({
          persistence: new FileUlwPersistence({ fs: nodeFs, filePath }),
        })
      // given: a submission accepted and completed before the restart
      const before = freshStore()
      // SAFETY: ulw_goal_create answers with the run record, which carries string id and status.
      const opened = (await jsonOf(createUlwGoalCreateTool({ store: before }), {
        brief: "Ship the loop",
        sessionScope: "ses_main",
        submissionId: "sub-restart-1",
      })) as { id: string; deduped: boolean }
      expect(opened.deduped).toBe(false)
      const dispatch = createUlwDispatchTool({ store: before })
      await jsonOf(dispatch, { runId: opened.id, goalId: "G001", workerSessionId: "ses_worker_a" })
      await jsonOf(createUlwEvidenceTool({ store: before }), {
        runId: opened.id,
        goalId: "G001",
        childSessionId: "ses_worker_a",
        status: "completed",
      })
      // when: the process restarts and the same submission is delivered again
      const after = freshStore()
      expect(after.getLoadReport()).toMatchObject({ durable: true, reason: "recovered" })
      // SAFETY: a redelivered submission resolves to the recovered run, whose record carries the same string id.
      const redelivered = (await jsonOf(createUlwGoalCreateTool({ store: after }), {
        brief: "Ship the loop",
        sessionScope: "ses_main",
        submissionId: "sub-restart-1",
      })) as { id: string; deduped: boolean }

      // then: the same root run, no duplicate execution, evidence intact
      expect(redelivered.deduped).toBe(true)
      expect(redelivered.id).toBe(opened.id)
      expect(after.listRuns()).toHaveLength(1)
      expect(after.receiptFor(opened.id, "G001")).toMatchObject({ status: "completed" })
      // SAFETY: ulw_status for a submission answers with that submission's run record.
      const status = (await jsonOf(createUlwStatusTool({ store: after }), { submissionId: "sub-restart-1" })) as {
        run: { id: string }
        missingReceipts: readonly string[]
      }
      expect(status.run.id).toBe(opened.id)
      expect(status.missingReceipts).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
