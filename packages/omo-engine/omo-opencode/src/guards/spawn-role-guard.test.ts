import { describe, expect, test } from "bun:test"
import {
  REGISTERED_GATE_ROLES,
  assertGateRole,
  resolveGateRoleName,
} from "./spawn-role-guard"

describe("REGISTERED_GATE_ROLES", () => {
  test("lists exactly the three native gate identities", () => {
    expect([...REGISTERED_GATE_ROLES]).toEqual([
      "omo-native-code-reviewer",
      "omo-native-qa-executor",
      "omo-native-gate-reviewer",
    ])
  })
})

describe("assertGateRole", () => {
  test("accepts every registered native role", () => {
    for (const role of REGISTERED_GATE_ROLES) {
      expect(() => assertGateRole(role)).not.toThrow()
    }
  })

  test("accepts legacy aliases during migration", () => {
    for (const legacy of [
      "omo-senpi-code-reviewer",
      "omo-senpi-qa-executor",
      "omo-senpi-gate-reviewer",
    ]) {
      expect(() => assertGateRole(legacy)).not.toThrow()
    }
  })

  test("throws on generic roles", () => {
    for (const generic of ["reviewer", "code-reviewer", "qa-executor", "gate-reviewer", "general"]) {
      expect(() => assertGateRole(generic)).toThrow("Unknown gate role")
    }
  })

  test("throws on unknown and empty roles", () => {
    for (const unknown of ["omo-native-unknown", "plan-reviewer", "", "   "]) {
      expect(() => assertGateRole(unknown)).toThrow("Unknown gate role")
    }
  })
})

describe("resolveGateRoleName", () => {
  test("resolves each legacy alias to its native name", () => {
    expect(resolveGateRoleName("omo-senpi-code-reviewer")).toBe("omo-native-code-reviewer")
    expect(resolveGateRoleName("omo-senpi-qa-executor")).toBe("omo-native-qa-executor")
    expect(resolveGateRoleName("omo-senpi-gate-reviewer")).toBe("omo-native-gate-reviewer")
  })

  test("passes native names through unchanged", () => {
    expect(resolveGateRoleName("omo-native-code-reviewer")).toBe("omo-native-code-reviewer")
    expect(resolveGateRoleName("omo-native-qa-executor")).toBe("omo-native-qa-executor")
    expect(resolveGateRoleName("omo-native-gate-reviewer")).toBe("omo-native-gate-reviewer")
  })

  test("throws on anything outside the registered set", () => {
    expect(() => resolveGateRoleName("reviewer")).toThrow("Unknown gate role")
    expect(() => resolveGateRoleName("omo-native-planner")).toThrow("Unknown gate role")
  })
})
