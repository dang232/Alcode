import { describe, expect, test } from "bun:test"

import {
  dispatchedChildrenPendingError,
  goalNotDispatchedError,
  invalidInputError,
  runNotActiveError,
  runNotFoundError,
  UlwUsageError,
} from "./errors.ts"

describe("ulw usage error vocabulary", () => {
  test("#given a checkpoint refusal #when raised #then the run and every missing receipt travel with it", () => {
    // when
    const error = dispatchedChildrenPendingError("run-1", ["G002", "G001"])

    // then
    expect(error.name).toBe("UlwUsageError")
    expect(error.code).toBe("DISPATCHED_CHILDREN_PENDING")
    expect(error.runId).toBe("run-1")
    expect(error.missingGoalIds).toEqual(["G002", "G001"])
    expect(error.message).toContain("run-1")
    expect(error.message).toContain("G002")
    expect(error.message).toContain("G001")
  })

  test("#given a run lookup failure #when raised #then the run ref travels without missing goals", () => {
    // when
    const error = runNotFoundError("ghost")

    // then
    expect(error.name).toBe("UlwUsageError")
    expect(error.code).toBe("RUN_NOT_FOUND")
    expect(error.runId).toBe("ghost")
    expect(error.missingGoalIds).toBeUndefined()
  })

  test("#given recovery failures #when raised #then the run identity is recorded", () => {
    // when
    const inactive = runNotActiveError("run-1", "complete")
    const undispatched = goalNotDispatchedError("run-1", "G009")
    const invalid = invalidInputError("run-1", "ULW goalId must be a non-empty string.")

    // then
    expect(inactive.name).toBe("UlwUsageError")
    expect(inactive.code).toBe("RUN_NOT_ACTIVE")
    expect(inactive.runId).toBe("run-1")
    expect(undispatched.code).toBe("GOAL_NOT_DISPATCHED")
    expect(undispatched.message).toContain("G009")
    expect(invalid.code).toBe("INVALID_INPUT")
    expect(invalid).toBeInstanceOf(UlwUsageError)
  })
})
