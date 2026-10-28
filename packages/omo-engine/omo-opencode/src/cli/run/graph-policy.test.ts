import { describe, expect, test } from "bun:test";

import {
  GRAPH_POLICY_ENV,
  isGraphPreflightForcedOff,
  selectGraphContextLevel,
} from "./graph-policy";

describe("graph preflight policy", () => {
  test("#given explicit direct mode on a trivial task #when selected #then level 0 explicit-direct", () => {
    const decision = selectGraphContextLevel({
      explicitMode: "direct",
      complexity: "trivial",
      strategy: "direct",
      message: "fix math.ts",
      fileCount: 1,
    });

    expect(decision.level).toBe(0);
    expect(decision.reasonCode).toBe("explicit-direct");
    expect(decision.maxBytes).toBe(0);
    expect(decision.maxSubjects).toBe(0);
    expect(decision.escalateToHighAssurance).toBe(false);
  });

  test("#given a message with no code signal and no file count #when selected #then level 0 non-code", () => {
    const decision = selectGraphContextLevel({
      strategy: "direct",
      message: "hello, how are you today?",
    });

    expect(decision.level).toBe(0);
    expect(decision.reasonCode).toBe("non-code");
  });

  test("#given a security-sensitive risk #when selected #then level 3 risk-high with full budgets", () => {
    const decision = selectGraphContextLevel({
      risk: "security-sensitive",
      strategy: "high-assurance",
      message: "rotate the auth token in auth.ts",
      fileCount: 1,
    });

    expect(decision.level).toBe(3);
    expect(decision.reasonCode).toBe("risk-high");
    expect(decision.maxBytes).toBe(4096);
    expect(decision.maxSubjects).toBe(3);
  });

  test("#given a code question phrased with plural nouns #when selected #then it is not treated as non-code", () => {
    const decision = selectGraphContextLevel({
      message: "Where is a session resolved for a quota request, and which tests cover that path? Name the files.",
    });

    expect(decision.reasonCode).not.toBe("non-code");
    expect(decision.level).toBeGreaterThan(0);
  });

  test("#given a security-sensitive task in explicit direct mode #when selected #then risk still wins over the mode", () => {
    const decision = selectGraphContextLevel({
      explicitMode: "direct",
      complexity: "trivial",
      risk: "security-sensitive",
      message: "change the token rotation",
    });

    expect(decision.level).toBe(3);
    expect(decision.reasonCode).toBe("risk-high");
  });

  test("#given a high-risk task whose graph is unavailable after a replan #when selected #then escalation survives the level cap", () => {
    const decision = selectGraphContextLevel({
      risk: "high",
      message: "migrate the payment schema",
      graphAvailable: false,
      replanCount: 1,
    });

    expect(decision.level).toBe(2);
    expect(decision.notes).toContain("replan-capped");
    expect(decision.escalateToHighAssurance).toBe(true);
  });

  test("#given a camelCase identifier #when selected #then the message reads as code", () => {
    const decision = selectGraphContextLevel({ message: "why does verifyToken reject my token" });

    expect(decision.reasonCode).not.toBe("non-code");
  });

  test("#given a security-sensitive task whose wording has no code signal #when selected #then risk still wins over non-code", () => {
    const decision = selectGraphContextLevel({
      risk: "security-sensitive",
      strategy: "high-assurance",
      message: "rotate the refresh token contract",
    });

    expect(decision.level).toBe(3);
    expect(decision.reasonCode).toBe("risk-high");
  });

  test("#given a high risk #when selected #then level 3 risk-high", () => {
    const decision = selectGraphContextLevel({
      risk: "high",
      strategy: "plan-then-execute",
      message: "migrate the payment flow in pay.ts",
      fileCount: 2,
    });

    expect(decision.level).toBe(3);
    expect(decision.reasonCode).toBe("risk-high");
  });

  test("#given complex scope #when selected #then level 2 scope-broad", () => {
    const decision = selectGraphContextLevel({
      complexity: "complex",
      clarity: "clear",
      risk: "low",
      strategy: "plan-then-execute",
      message: "refactor checkout flow step by step",
      fileCount: 1,
    });

    expect(decision.level).toBe(2);
    expect(decision.reasonCode).toBe("scope-broad");
    expect(decision.maxBytes).toBe(4096);
    expect(decision.maxSubjects).toBe(3);
  });

  test("#given unclear scope #when selected #then level 2 scope-broad", () => {
    const decision = selectGraphContextLevel({
      complexity: "moderate",
      clarity: "unclear",
      risk: "low",
      strategy: "explore-then-execute",
      message: "diagnose the mysterious failure in render.ts, root cause unknown",
      fileCount: 1,
    });

    expect(decision.level).toBe(2);
    expect(decision.reasonCode).toBe("scope-broad");
  });

  test("#given three or more files #when selected #then level 2 scope-broad", () => {
    const decision = selectGraphContextLevel({
      complexity: "moderate",
      clarity: "clear",
      risk: "low",
      strategy: "parallel-native",
      message: "touch src/a.ts src/b.ts src/c.ts",
      fileCount: 3,
    });

    expect(decision.level).toBe(2);
    expect(decision.reasonCode).toBe("scope-broad");
  });

  test("#given an ordinary code task #when selected #then level 1 code-task with small budgets", () => {
    const decision = selectGraphContextLevel({
      complexity: "moderate",
      clarity: "clear",
      risk: "low",
      strategy: "plan-then-execute",
      message: "fix add() in math.ts",
      fileCount: 1,
    });

    expect(decision.level).toBe(1);
    expect(decision.reasonCode).toBe("code-task");
    expect(decision.maxBytes).toBe(1024);
    expect(decision.maxSubjects).toBe(1);
  });

  test("#given an unavailable graph on a level-3 task #when selected #then the level holds with a note and escalation", () => {
    const decision = selectGraphContextLevel({
      risk: "high",
      strategy: "high-assurance",
      message: "rotate the auth token in auth.ts",
      fileCount: 1,
      graphAvailable: false,
    });

    expect(decision.level).toBe(3);
    expect(decision.reasonCode).toBe("risk-high");
    expect(decision.notes).toContain("graph-unavailable");
    expect(decision.escalateToHighAssurance).toBe(true);
  });

  test("#given an unavailable graph on a level-1 task #when selected #then the level holds with a note but no escalation", () => {
    const decision = selectGraphContextLevel({
      complexity: "moderate",
      clarity: "clear",
      risk: "low",
      strategy: "plan-then-execute",
      message: "fix add() in math.ts",
      fileCount: 1,
      graphAvailable: false,
    });

    expect(decision.level).toBe(1);
    expect(decision.notes).toContain("graph-unavailable");
    expect(decision.escalateToHighAssurance).toBe(false);
  });

  test("#given a stale graph #when selected #then a graph-stale note is added without changing the level", () => {
    const decision = selectGraphContextLevel({
      complexity: "moderate",
      clarity: "clear",
      risk: "low",
      strategy: "plan-then-execute",
      message: "fix add() in math.ts",
      fileCount: 1,
      graphStale: true,
    });

    expect(decision.level).toBe(1);
    expect(decision.reasonCode).toBe("code-task");
    expect(decision.notes).toContain("graph-stale");
  });

  test("#given a replan on a level-3 task #when selected #then the level caps at 2 with a replan-capped note", () => {
    const decision = selectGraphContextLevel({
      risk: "high",
      strategy: "high-assurance",
      message: "rotate the auth token in auth.ts",
      fileCount: 1,
      replanCount: 1,
    });

    expect(decision.level).toBe(2);
    expect(decision.reasonCode).toBe("risk-high");
    expect(decision.maxBytes).toBe(4096);
    expect(decision.maxSubjects).toBe(3);
    expect(decision.notes).toContain("replan-capped");
    expect(decision.escalateToHighAssurance).toBe(false);
  });

  test("#given the preflight env switch #when read #then only an explicit zero forces level 0", () => {
    expect(GRAPH_POLICY_ENV).toBe("OMO_GRAPH_PREFLIGHT");
    expect(isGraphPreflightForcedOff({})).toBe(false);
    expect(isGraphPreflightForcedOff({ OMO_GRAPH_PREFLIGHT: "1" })).toBe(false);
    expect(isGraphPreflightForcedOff({ OMO_GRAPH_PREFLIGHT: "0" })).toBe(true);
  });
});
