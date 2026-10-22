import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import {
  selectWorkflow,
  KNOWN_STRATEGIES,
  DEFAULT_MAX_REPLANS,
  type TaskProfile,
} from "./workflow-select";

describe("selectWorkflow", () => {
  test("trivial task selects direct without fan-out", () => {
    const decision = selectWorkflow({ complexity: "trivial", clarity: "clear" });
    expect(decision.strategy).toBe("direct");
    expect(decision.maxAttempts).toBe(1);
    expect(decision.gates).toEqual([]);
    expect(decision.reason.length).toBeGreaterThan(0);
    expect(decision.runId.startsWith("run-")).toBe(true);
    expect(decision.reason.split("\n")).toHaveLength(1);
  });

  test("unclear multi-file bug selects explore-then-execute", () => {
    const decision = selectWorkflow({
      complexity: "moderate",
      clarity: "unclear",
      fileCount: 5,
    });
    expect(decision.strategy).toBe("explore-then-execute");
    expect(decision.maxAttempts).toBe(3);
    expect(decision.reason).toContain("5");
  });

  test("security-sensitive task selects high-assurance with gate requirements", () => {
    const decision = selectWorkflow({
      complexity: "simple",
      clarity: "clear",
      risk: "security-sensitive",
    });
    expect(decision.strategy).toBe("high-assurance");
    const gates = decision.gates.map((g) => g.gate);
    expect(gates).toContain("security-review");
    expect(gates).toContain("human-approval");
  });

  test("explicit user mode is preserved over evidence", () => {
    const decision = selectWorkflow({
      complexity: "trivial",
      clarity: "clear",
      explicitMode: "plan-then-execute",
    });
    expect(decision.strategy).toBe("plan-then-execute");
    expect(decision.reason).toContain("explicit mode requested");
  });

  test("unknown explicit mode falls through to evidence", () => {
    const decision = selectWorkflow({
      complexity: "trivial",
      clarity: "clear",
      explicitMode: "not-a-real-mode",
    });
    expect(decision.strategy).toBe("direct");
  });

  test("malformed classification cannot bypass gates", () => {
    const decision = selectWorkflow({
      complexity: "trivial",
      clarity: "clear",
      risk: "low",
      classificationValid: false,
    });
    expect(decision.strategy).toBe("high-assurance");
    expect(decision.gates.length).toBeGreaterThan(0);
    const gates = decision.gates.map((g) => g.gate);
    expect(gates).toContain("security-review");
    expect(gates).toContain("human-approval");
  });

  test("malformed classification wins when explicit mode is unrecognized", () => {
    const decision = selectWorkflow({
      explicitMode: "not-a-real-mode",
      complexity: "trivial",
      classificationValid: false,
    });
    expect(decision.strategy).toBe("high-assurance");
    expect(decision.gates.length).toBeGreaterThan(0);
  });

  test("new dependency evidence changes the strategy", () => {
    const base: TaskProfile = { complexity: "simple", clarity: "clear" };
    const before = selectWorkflow(base);
    expect(before.strategy).toBe("direct");
    const after = selectWorkflow({ ...base, newDependencyEvidence: true });
    expect(after.strategy).toBe("explore-then-execute");
    expect(after.strategy).not.toBe(before.strategy);
  });

  test("strategy change preserves session identity and completed work", () => {
    const first = selectWorkflow({
      complexity: "simple",
      clarity: "clear",
      sessionId: "sess-1",
      completedWorkUnits: 4,
    });
    expect(first.strategy).toBe("direct");
    const second = selectWorkflow({
      complexity: "simple",
      clarity: "clear",
      sessionId: "sess-1",
      runId: first.runId,
      completedWorkUnits: 4,
      newDependencyEvidence: true,
    });
    expect(second.strategy).toBe("explore-then-execute");
    expect(second.runId).toBe(first.runId);
    expect(second.sessionId).toBe("sess-1");
    expect(second.preservedWorkUnits).toBe(4);
  });

  test("repeated decisions terminate via bounded replanning", () => {
    const decision = selectWorkflow({
      complexity: "complex",
      clarity: "unclear",
      fileCount: 4,
      replanCount: DEFAULT_MAX_REPLANS,
      maxReplans: DEFAULT_MAX_REPLANS,
    });
    expect(decision.strategy).toBe("bounded-recovery");
    expect(decision.gates.map((g) => g.gate)).toContain("human-approval");
  });

  test("replan budget exhaustion wins over all other evidence", () => {
    const decision = selectWorkflow({
      risk: "security-sensitive",
      replanCount: 9,
      maxReplans: 3,
    });
    expect(decision.strategy).toBe("bounded-recovery");
  });

  test("unavailable provider capability yields safe fallback", () => {
    const decision = selectWorkflow({
      complexity: "complex",
      clarity: "clear",
      fileCount: 6,
      providerCapabilityUnavailable: true,
    });
    expect(decision.strategy).toBe("plan-then-execute");
    expect(decision.gates).toEqual([]);
  });

  test("complex multi-file work fans out via parallel-native", () => {
    const decision = selectWorkflow({
      complexity: "complex",
      clarity: "clear",
      fileCount: 4,
    });
    expect(decision.strategy).toBe("parallel-native");
    expect(decision.maxAttempts).toBe(2);
  });

  test("complex unclear work plans before executing", () => {
    const decision = selectWorkflow({ complexity: "complex", clarity: "clear" });
    expect(decision.strategy).toBe("plan-then-execute");
  });

  test("all six strategies are reachable and decisions are deterministic", () => {
    const profiles: TaskProfile[] = [
      { complexity: "trivial", clarity: "clear" },
      { clarity: "unclear", fileCount: 3 },
      { complexity: "complex", clarity: "clear" },
      { complexity: "complex", clarity: "clear", fileCount: 3 },
      { risk: "security-sensitive" },
      { replanCount: 3, maxReplans: 3 },
    ];
    const strategies = profiles.map((p) => selectWorkflow(p).strategy);
    expect([...strategies].sort()).toEqual([...KNOWN_STRATEGIES].sort());
    for (const profile of profiles) {
      const a = selectWorkflow(profile);
      const b = selectWorkflow(profile);
      expect(a.strategy).toBe(b.strategy);
      expect(a.reason).toBe(b.reason);
      expect(a.runId).not.toBe(b.runId);
    }
  });

  test("every decision carries a one-line observable reason and sane attempts", () => {
    const profiles: TaskProfile[] = [
      {},
      { explicitMode: "direct" },
      { explicitMode: "high-assurance" },
      { classificationValid: false },
      { risk: "security-sensitive" },
      { providerCapabilityUnavailable: true },
      { newDependencyEvidence: true },
      { clarity: "unclear", fileCount: 2 },
      { complexity: "complex", risk: "high" },
      { replanCount: 10 },
    ];
    for (const profile of profiles) {
      const decision = selectWorkflow(profile);
      expect(decision.reason.split("\n")).toHaveLength(1);
      expect(decision.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(decision.runId.length).toBeGreaterThan(0);
    }
  });

  test("explicit high-assurance mode carries its gate", () => {
    const decision = selectWorkflow({ explicitMode: "high-assurance" });
    expect(decision.strategy).toBe("high-assurance");
    expect(decision.gates.map((g) => g.gate)).toContain("security-review");
  });

  test("the real runner path consumes the decision (not display-only)", () => {
    const runnerSource = readFileSync(
      new URL("./runner.ts", import.meta.url),
      "utf8",
    );
    expect(runnerSource).toContain("selectWorkflow(");
    expect(runnerSource).toContain("workflowDecision,");
    expect(runnerSource).toContain('workflowDecision.strategy !== "direct"');
    expect(runnerSource).toContain("requireMeaningfulWork,");
  });
});
