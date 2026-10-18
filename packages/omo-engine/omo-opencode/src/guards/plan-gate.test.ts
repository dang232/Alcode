import { describe, expect, test } from "bun:test"
import { evaluatePlanGate, invocationGateDenial } from "./plan-gate"

describe("evaluatePlanGate", () => {
  test("refuses the all-false snapshot", () => {
    const verdict = evaluatePlanGate({
      userRequestedPlan: false,
      planArtifactTouched: false,
      executeStarted: false,
    })

    expect(verdict.allowed).toBe(false)
    expect(typeof verdict.reason).toBe("string")
  })

  test("allows the full triple: user request plus artifact minus execution", () => {
    const verdict = evaluatePlanGate({
      userRequestedPlan: true,
      planArtifactTouched: true,
      executeStarted: false,
    })

    expect(verdict).toEqual({ allowed: true })
  })

  test("executeStarted vetoes even when request and artifact are present", () => {
    const verdict = evaluatePlanGate({
      userRequestedPlan: true,
      planArtifactTouched: true,
      executeStarted: true,
    })

    expect(verdict.allowed).toBe(false)
    expect(String(verdict.reason)).toContain("execution already started")
  })

  test("denies a missing user request before checking anything else", () => {
    const verdict = evaluatePlanGate({
      userRequestedPlan: false,
      planArtifactTouched: true,
      executeStarted: false,
    })

    expect(verdict.allowed).toBe(false)
    expect(String(verdict.reason)).toContain("explicitly request planning")
  })

  test("denies a missing plan artifact once the user request is proven", () => {
    const verdict = evaluatePlanGate({
      userRequestedPlan: true,
      planArtifactTouched: false,
      executeStarted: false,
    })

    expect(verdict.allowed).toBe(false)
    expect(String(verdict.reason)).toContain(".omo/plans")
  })

  test("fails closed on unknown input shapes", () => {
    const malformed: unknown[] = [
      undefined,
      null,
      "plan",
      1,
      {},
      { userRequestedPlan: true, planArtifactTouched: true },
      { userRequestedPlan: 1, planArtifactTouched: true, executeStarted: false },
      { userRequestedPlan: true, planArtifactTouched: "yes", executeStarted: false },
      { userRequestedPlan: true, planArtifactTouched: true, executeStarted: 0 },
    ]

    for (const input of malformed) {
      const verdict = evaluatePlanGate(input as never)
      expect(verdict.allowed).toBe(false)
      expect(typeof verdict.reason).toBe("string")
    }
  })
})

describe("invocationGateDenial", () => {
  test("denies both plan-gated types without session evidence", () => {
    for (const gated of ["plan-consultant", "plan-reviewer"]) {
      const denial = invocationGateDenial(gated)
      expect(typeof denial).toBe("string")
      expect(String(denial)).toContain(gated)
    }
  })

  test("returns undefined for types outside the plan gate", () => {
    for (const open of ["explore", "librarian", "omo-native-code-reviewer", "general", ""]) {
      expect(invocationGateDenial(open)).toBeUndefined()
    }
  })
})
