import { describe, expect, test } from "bun:test"

import { gateCheckpoint } from "./checkpoint.ts"
import { UlwUsageError } from "./errors.ts"
import { UlwStore } from "./store.ts"

const RUN_ID = "22222222-2222-2222-2222-222222222222"
const FROZEN_NOW = 1700000000000

function storeFor() {
  let counter = 0
  return new UlwStore({
    now: () => FROZEN_NOW,
    newRunId: () => `run-${(counter += 1)}`,
  })
}

function dispatchedRun(store: UlwStore, goalIds: readonly string[] = ["G001"]): UlwStore {
  store.createRun({ id: RUN_ID, brief: "Ship the loop", sessionScope: "ses_main" })
  for (const goalId of goalIds) {
    store.dispatchGoal(RUN_ID, goalId, `ses_${goalId.toLowerCase()}`)
  }
  return store
}

describe("native ulw checkpoint gating", () => {
  test("#given a dispatched goal with no child result #when checkpointed #then the usage error lists the missing receipt", () => {
    // given
    const store = dispatchedRun(storeFor(), ["G001", "G002"])
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_g001" })

    // when
    let error: unknown
    try {
      gateCheckpoint(store, RUN_ID)
    } catch (thrown) {
      error = thrown
    }

    // then
    expect(error).toBeInstanceOf(UlwUsageError)
    // SAFETY: the instanceof expect above proves `error` is an UlwUsageError.
    const usage = error as UlwUsageError
    expect(usage.code).toBe("DISPATCHED_CHILDREN_PENDING")
    expect(usage.runId).toBe(RUN_ID)
    expect(usage.missingGoalIds).toEqual(["G002"])
    expect(usage.message).toContain(RUN_ID)
    expect(usage.message).toContain("G002")
    // refusal records nothing: the goal is still missing its receipt
    expect(store.missingReceipts(RUN_ID)).toEqual(["G002"])
  })

  test("#given every dispatched goal has its receipt #when checkpointed #then the gate passes", () => {
    // given
    const store = dispatchedRun(storeFor(), ["G001"])
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_g001", resultRef: "a0/report.md" })

    // when
    const result = gateCheckpoint(store, RUN_ID)

    // then
    expect(result).toEqual({ runId: RUN_ID, checkedGoalIds: ["G001"], missingGoalIds: [] })
  })

  test("#given a failed child result #when checkpointed #then the receipt still settles the dispatch", () => {
    // given
    const store = dispatchedRun(storeFor(), ["G001"])
    store.recordChildResult(RUN_ID, "G001", {
      childSessionId: "ses_g001",
      status: "failed",
      reason: "worker timed out",
    })

    // when
    const result = gateCheckpoint(store, RUN_ID)

    // then
    expect(result.missingGoalIds).toEqual([])
  })

  test("#given a goal-scoped checkpoint #when only out-of-scope goals are pending #then the gate passes", () => {
    // given
    const store = dispatchedRun(storeFor(), ["G001", "G002"])
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_g001" })

    // when
    const result = gateCheckpoint(store, RUN_ID, { kind: "goals", goalIds: ["G001"] })

    // then
    expect(result).toEqual({ runId: RUN_ID, checkedGoalIds: ["G001"], missingGoalIds: [] })
  })

  test("#given undispatched goals #when checkpointed #then they never block", () => {
    // given
    const store = storeFor()
    store.createRun({ id: RUN_ID, brief: "Ship the loop", sessionScope: "ses_main" })

    // when
    const result = gateCheckpoint(store, RUN_ID, { kind: "goals", goalIds: ["G001"] })

    // then
    expect(result.missingGoalIds).toEqual([])
  })

  test("#given an unknown run #when checkpointed #then the lookup refusal travels instead", () => {
    // given
    const store = storeFor()

    // when / then
    expect(() => gateCheckpoint(store, "ghost")).toThrow(UlwUsageError)
    try {
      gateCheckpoint(store, "ghost")
    } catch (error) {
      // SAFETY: the toThrow expect above proves the gate throws UlwUsageError for unknown runs.
      expect((error as UlwUsageError).code).toBe("RUN_NOT_FOUND")
    }
  })
})
