/**
 * ulw-plan-bridge.test.ts — the native tools meet the CLI plan store.
 *
 * `create-goals` writes `.omo/ulw-loop/<sessionId>/goals.json`; the native
 * tools kept a separate run store, so dispatch answered `Unknown ULW run`
 * for a run that plainly existed. These cases drive the real tools against
 * a real plan file and a real store snapshot.
 */

import { afterEach, describe, expect, test } from "bun:test"
import nodeFs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

import type { OmoJsonObject, OmoToolContext, OmoToolDefinition } from "../../plugin-types.ts"
import { FileUlwPersistence } from "../../ulw/persistence.ts"
import { UlwStore } from "../../ulw/store.ts"
import { createUlwCheckpointTool } from "./checkpoint.ts"
import { createUlwCompleteTool } from "./complete.ts"
import { createUlwDispatchTool } from "./dispatch.ts"
import { createUlwEvidenceTool } from "./evidence.ts"
import { createUlwStatusTool } from "./status.ts"

const SESSION = "ses_plan_bridge_smoke"
const GOAL_ID = "G001-receipt-bridge-smoke"
const WORKER_ID = "ses_worker_smoke"
const FROZEN_NOW = 1700000000000

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function planRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ulw-plan-bridge-"))
  temporaryRoots.push(root)
  mkdirSync(join(root, ".omo", "ulw-loop", SESSION), { recursive: true })
  writeFileSync(
    join(root, ".omo", "ulw-loop", SESSION, "goals.json"),
    JSON.stringify({
      version: 1,
      brief: "receipt bridge smoke",
      goals: [{ id: GOAL_ID, title: "receipt bridge smoke", status: "pending" }],
    }),
    "utf8",
  )
  return root
}

function testStore(filePath?: string): UlwStore {
  return new UlwStore({
    now: () => FROZEN_NOW,
    newRunId: () => "unused-run-id",
    persistence: filePath === undefined ? null : new FileUlwPersistence({ fs: nodeFs, filePath }),
  })
}

function toolContext(directory: string): OmoToolContext {
  return {
    sessionID: "ses_main",
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
  context: OmoToolContext,
): Promise<OmoJsonObject> {
  const outcome = await tool.execute(args, context)
  const text = z.string().parse(outcome)
  // SAFETY: every ULW tool answers with a JSON string; parsing it yields bounded JSON values.
  return JSON.parse(text) as OmoJsonObject
}

describe("ulw plan-store bridge", () => {
  test("#given a create-goals plan on disk #when dispatch names its session id #then the plan opens as a native run and the goal dispatches", async () => {
    // given
    const root = planRoot()
    const store = testStore()
    const dispatch = createUlwDispatchTool({ store })

    // when
    // SAFETY: ulw_dispatch answers with the run id and the goal's worker list.
    const answer = (await jsonOf(
      dispatch,
      { runId: SESSION, goalId: GOAL_ID, workerSessionId: WORKER_ID },
      toolContext(root),
    )) as { runId: string; workers: readonly string[] }

    // then
    expect(answer.runId).toBe(SESSION)
    expect(answer.workers).toEqual([WORKER_ID])
    expect(store.getRun(SESSION)).toMatchObject({ brief: "receipt bridge smoke", sessionScope: SESSION })
    expect(store.rosterFor(SESSION)).toEqual({ [GOAL_ID]: [WORKER_ID] })
  })

  test("#given a run opened by goal_create #when dispatch names its session scope #then the same run is dispatched", async () => {
    // given
    const root = planRoot()
    const store = testStore()
    store.createRun({ id: "run-native", brief: "native run", sessionScope: SESSION })
    const dispatch = createUlwDispatchTool({ store })

    // when
    // SAFETY: ulw_dispatch answers with the canonical run id and worker list.
    const answer = (await jsonOf(
      dispatch,
      { runId: SESSION, goalId: GOAL_ID, workerSessionId: WORKER_ID },
      toolContext(root),
    )) as { runId: string }

    // then
    expect(answer.runId).toBe("run-native")
    expect(store.rosterFor("run-native")).toEqual({ [GOAL_ID]: [WORKER_ID] })
  })

  test("#given a dispatched plan goal #when the short id reports and the run closes #then receipt, checkpoint, completion, and disk all agree", async () => {
    // given
    const root = planRoot()
    const filePath = join(root, "ulw-store.json")
    const store = testStore(filePath)
    const dispatch = createUlwDispatchTool({ store })
    const evidence = createUlwEvidenceTool({ store })
    const checkpoint = createUlwCheckpointTool({ store })
    const complete = createUlwCompleteTool({ store })
    const status = createUlwStatusTool({ store })
    const context = toolContext(root)
    await jsonOf(dispatch, { runId: SESSION, goalId: GOAL_ID, workerSessionId: WORKER_ID }, context)

    // when
    // SAFETY: ulw_evidence answers with the recorded receipt.
    const receipt = (await jsonOf(
      evidence,
      { runId: SESSION, goalId: "G001", childSessionId: WORKER_ID, resultRef: "a0/report.md" },
      context,
    )) as { goalId: string; status: string }
    // SAFETY: ulw_checkpoint answers with the gate result and missing goals.
    const gate = (await jsonOf(checkpoint, { runId: SESSION }, context)) as { missingGoalIds: readonly string[] }
    // SAFETY: ulw_complete answers with the updated run record.
    const closed = (await jsonOf(complete, { runId: SESSION, status: "complete" }, context)) as { status: string }
    // SAFETY: ulw_status answers with the run record and receipts.
    const report = (await jsonOf(status, { runId: SESSION }, context)) as {
      run: { status: string }
      receipts: Record<string, { childSessionId: string }>
      missingReceipts: readonly string[]
    }

    // then
    expect(receipt).toMatchObject({ goalId: GOAL_ID, status: "completed" })
    expect(gate.missingGoalIds).toEqual([])
    expect(closed.status).toBe("complete")
    expect(report.run.status).toBe("complete")
    expect(report.missingReceipts).toEqual([])
    expect(report.receipts[GOAL_ID]?.childSessionId).toBe(WORKER_ID)
    expect(JSON.parse(readFileSync(filePath, "utf8")).runs[0]).toMatchObject({
      record: { id: SESSION, status: "complete" },
      receipts: { [GOAL_ID]: { childSessionId: WORKER_ID, status: "completed" } },
    })
    const reloaded = testStore(filePath)
    expect(reloaded.getRun(SESSION)?.status).toBe("complete")
    expect(reloaded.receiptFor(SESSION, GOAL_ID)?.childSessionId).toBe(WORKER_ID)
  })
})
