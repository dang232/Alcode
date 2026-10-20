import { describe, expect, test } from "bun:test"

import { UlwUsageError } from "./errors.ts"
import { UlwStore } from "./store.ts"

const RUN_ID = "11111111-1111-1111-1111-111111111111"
const FROZEN_NOW = 1700000000000

function storeFor() {
  let counter = 0
  return new UlwStore({
    now: () => FROZEN_NOW,
    newRunId: () => `run-${(counter += 1)}`,
  })
}

function activeRun(store: UlwStore, id = RUN_ID) {
  return store.createRun({ id, brief: "Ship the loop", sessionScope: "ses_main" })
}

describe("native ulw run records", () => {
  test("#given a brief and session scope #when created #then the record pins id, scope, and active status", () => {
    // given
    const store = storeFor()

    // when
    const run = store.createRun({ id: RUN_ID, brief: "Ship the loop", sessionScope: "ses_main" })

    // then
    expect(run).toEqual({
      id: RUN_ID,
      brief: "Ship the loop",
      sessionScope: "ses_main",
      status: "active",
      createdAt: new Date(FROZEN_NOW).toISOString(),
      updatedAt: new Date(FROZEN_NOW).toISOString(),
    })
    expect(store.getRun(RUN_ID)).toEqual(run)
    expect(store.listRuns()).toEqual([run])
  })

  test("#given a blank brief or scope #when created #then the caller is told what to fix", () => {
    // given
    const store = storeFor()

    // when / then
    expect(() => store.createRun({ brief: "  ", sessionScope: "ses_main" })).toThrow(UlwUsageError)
    expect(() => store.createRun({ brief: "Ship it", sessionScope: "  " })).toThrow(UlwUsageError)
    expect(store.listRuns()).toEqual([])
  })

  test("#given an existing run id #when created again #then the second create is refused", () => {
    // given
    const store = storeFor()
    activeRun(store)

    // when / then
    expect(() => activeRun(store)).toThrow(UlwUsageError)
  })

  test("#given an active run #when its status moves #then the updated record is returned", () => {
    // given
    const store = storeFor()
    activeRun(store)

    // when
    const run = store.setRunStatus(RUN_ID, "complete")

    // then
    expect(run.status).toBe("complete")
    expect(store.getRun(RUN_ID)?.status).toBe("complete")
  })

  test("#given an unknown run #when read or moved #then lookup refuses and reads stay empty", () => {
    // given
    const store = storeFor()

    // when / then
    expect(store.getRun("ghost")).toBeUndefined()
    expect(() => store.setRunStatus("ghost", "complete")).toThrow(UlwUsageError)
  })
})

describe("native ulw dispatch roster", () => {
  test("#given dispatched goals #when rostered #then each goal maps to its worker sessions", () => {
    // given
    const store = storeFor()
    activeRun(store)

    // when
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_b")
    store.dispatchGoal(RUN_ID, "G002", "ses_worker_c")

    // then
    expect(store.rosterFor(RUN_ID)).toEqual({
      G001: ["ses_worker_a", "ses_worker_b"],
      G002: ["ses_worker_c"],
    })
    expect(store.dispatchedGoalIds(RUN_ID)).toEqual(["G001", "G002"])
  })

  test("#given a repeated dispatch #when rostered #then the pair is recorded once", () => {
    // given
    const store = storeFor()
    activeRun(store)

    // when
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    const roster = store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")

    // then
    expect(roster).toEqual(["ses_worker_a"])
  })

  test("#given a missing or settled run #when dispatched #then the dispatch is refused and nothing is recorded", () => {
    // given
    const store = storeFor()
    activeRun(store)
    store.setRunStatus(RUN_ID, "complete")

    // when / then
    expect(() => store.dispatchGoal("ghost", "G001", "ses_worker_a")).toThrow(UlwUsageError)
    expect(() => store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")).toThrow(UlwUsageError)
    expect(store.dispatchedGoalIds(RUN_ID)).toEqual([])
  })
})

describe("native ulw child-result receipts", () => {
  test("#given dispatched goals #when results are recorded #then receipts are keyed by goal id", () => {
    // given
    const store = storeFor()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    store.dispatchGoal(RUN_ID, "G002", "ses_worker_b")

    // when
    const first = store.recordChildResult(RUN_ID, "G001", {
      childSessionId: "ses_worker_a",
      resultRef: "a0/report.md",
    })
    store.recordChildResult(RUN_ID, "G002", { childSessionId: "ses_worker_b", status: "failed", reason: "timeout" })

    // then
    expect(first).toMatchObject({ goalId: "G001", childSessionId: "ses_worker_a", status: "completed" })
    expect(store.receiptFor(RUN_ID, "G001")).toEqual(first)
    expect(store.receiptsFor(RUN_ID).G002).toMatchObject({ status: "failed", reason: "timeout" })
    expect(store.missingReceipts(RUN_ID)).toEqual([])
  })

  test("#given a second recording for one goal #when recorded #then the latest receipt wins", () => {
    // given
    const store = storeFor()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")

    // when
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_worker_a", resultRef: "first.md" })
    const latest = store.recordChildResult(RUN_ID, "G001", {
      childSessionId: "ses_worker_a",
      resultRef: "second.md",
    })

    // then
    expect(store.receiptFor(RUN_ID, "G001")).toEqual(latest)
    expect(store.receiptFor(RUN_ID, "G001")?.resultRef).toBe("second.md")
  })

  test("#given an undispatched goal #when a result is recorded #then the receipt is refused", () => {
    // given
    const store = storeFor()
    activeRun(store)

    // when / then
    expect(() =>
      store.recordChildResult(RUN_ID, "G009", { childSessionId: "ses_worker_a" }),
    ).toThrow(UlwUsageError)
    expect(store.receiptFor(RUN_ID, "G009")).toBeUndefined()
  })

  test("#given partial receipts #when missing receipts are listed #then only dispatched-but-unrecorded goals are returned", () => {
    // given
    const store = storeFor()
    activeRun(store)
    store.dispatchGoal(RUN_ID, "G002", "ses_worker_b")
    store.dispatchGoal(RUN_ID, "G001", "ses_worker_a")
    store.recordChildResult(RUN_ID, "G001", { childSessionId: "ses_worker_a" })

    // when / then
    expect(store.missingReceipts(RUN_ID)).toEqual(["G002"])
    expect(store.missingReceipts(RUN_ID, ["G001"])).toEqual([])
    expect(store.missingReceipts(RUN_ID, ["G002", "never-dispatched"])).toEqual(["G002"])
  })
})
