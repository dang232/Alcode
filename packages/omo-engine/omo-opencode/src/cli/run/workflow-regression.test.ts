import { describe, test, expect } from "bun:test";
import {
  buildRunnerProfileInput,
  buildWorkflowProfile,
  resolveExecutionOptions,
  type RunnerProfileArgs,
} from "./workflow-profile";
import { selectWorkflow, type WorkflowStrategy } from "./workflow-select";

/**
 * Slice 2 integration regression suite.
 *
 * Every case runs through the real production path
 * buildRunnerProfileInput -> buildWorkflowProfile -> selectWorkflow ->
 * resolveExecutionOptions. No mocks, no invented exports.
 */
function runWorkflowPipeline(
  args: Omit<RunnerProfileArgs, "sessionId"> & { sessionId?: string },
) {
  // SAFETY: sessionId is required by the production contract; the suite
  // uses one fixed fixture identity except the test that asserts echo.
  const profileInput = buildRunnerProfileInput({
    sessionId: "sess-regression-fixture",
    ...args,
  });
  const enriched = buildWorkflowProfile(profileInput);
  const decision = selectWorkflow(enriched.profile);
  const execOpts = resolveExecutionOptions(decision.strategy);
  return { enriched, decision, execOpts };
}

const NON_DIRECT_STRATEGIES: WorkflowStrategy[] = [
  "explore-then-execute",
  "plan-then-execute",
  "parallel-native",
  "high-assurance",
  "bounded-recovery",
];

describe("workflow regression (slice 2 integration)", () => {
  test("small low-risk request runs direct without the meaningful-work gate", () => {
    const { enriched, decision, execOpts } = runWorkflowPipeline({
      message: "Fix typo in the welcome banner",
    });
    expect(enriched.profile.classificationValid).toBe(true);
    expect(enriched.profile.risk).toBe("low");
    expect(decision.strategy).toBe("direct");
    expect(execOpts.requireMeaningfulWork).toBe(false);
    expect(execOpts.requiredConsecutive).toBe(1);
  });

  test("unfamiliar multi-file bug takes explore-then-execute", () => {
    const { enriched, decision } = runWorkflowPipeline({
      message:
        "The failure is unreproducible and mysterious; it spans src/render/view.ts and src/render/layout.ts, root cause unknown",
    });
    expect(enriched.profile.clarity).toBe("unclear");
    expect(enriched.profile.fileCount).toBe(2);
    expect(decision.strategy).toBe("explore-then-execute");
  });

  test("complex dependency-bearing task plans before executing", () => {
    const { enriched, decision } = runWorkflowPipeline({
      message:
        "Refactor the checkout flow:\n1. Update cart state\n2. Refresh totals\n3. Persist order",
    });
    expect(enriched.profile.complexity).toBe("complex");
    expect(["plan-then-execute", "parallel-native"]).toContain(
      decision.strategy,
    );
  });

  test("independent multi-file work fans out via parallel-native", () => {
    const { enriched, decision, execOpts } = runWorkflowPipeline({
      message:
        "Refactor the parser:\n1. Extract lexing into src/parse/lexer.ts\n2. Move validation into src/parse/validator.ts\n3. Wire output through src/parse/emitter.ts",
    });
    expect(enriched.profile.clarity).toBe("clear");
    expect(enriched.profile.fileCount).toBe(3);
    expect(decision.strategy).toBe("parallel-native");
    expect(execOpts.requireMeaningfulWork).toBe(true);
  });

  test("shared-file unclear multi-file work explores, never fans out blind", () => {
    const { enriched, decision } = runWorkflowPipeline({
      message:
        "The shared src/render/cache.ts failure is unreproducible and mysterious; it spans src/render/view.ts and src/render/layout.ts, root cause unknown, please diagnose",
    });
    expect(enriched.profile.clarity).toBe("unclear");
    expect(enriched.profile.fileCount).toBe(3);
    expect(decision.strategy).toBe("explore-then-execute");
    expect(decision.strategy).not.toBe("parallel-native");
  });

  test("security-sensitive work takes gated high-assurance", () => {
    const { enriched, decision } = runWorkflowPipeline({
      message: "Rotate the admin auth token and update the permission check",
    });
    expect(enriched.profile.risk).toBe("security-sensitive");
    expect(decision.strategy).toBe("high-assurance");
    const gates = decision.gates.map((gate) => gate.gate);
    expect(gates).toContain("security-review");
    expect(gates).toContain("human-approval");
  });

  test("explicit supported mode is preserved over auto selection", () => {
    const { enriched, decision } = runWorkflowPipeline({
      message: "Fix typo in the welcome banner",
      explicitMode: "  Plan-Then-Execute  ",
    });
    expect(enriched.explicit).toBe(true);
    expect(enriched.profile.explicitMode).toBe("plan-then-execute");
    expect(decision.strategy).toBe("plan-then-execute");
    expect(decision.reason).toContain("explicit mode requested");
  });

  test("agent fallback yields the safe plan-then-execute fallback", () => {
    const { enriched, decision } = runWorkflowPipeline({
      message: "Fix typo in the welcome banner",
      requestedAgent: "Sisyphus",
      resolvedAgent: "hephaestus",
    });
    expect(enriched.profile.providerCapabilityUnavailable).toBe(true);
    expect(decision.strategy).toBe("plan-then-execute");
  });

  test("malformed profile input falls back to gated high-assurance", () => {
    const { enriched, decision } = runWorkflowPipeline({ message: "   " });
    expect(enriched.profile.classificationValid).toBe(false);
    expect(decision.strategy).toBe("high-assurance");
    const gates = decision.gates.map((gate) => gate.gate);
    expect(gates).toContain("security-review");
    expect(gates).toContain("human-approval");
  });

  test("empty message never goes direct and is classification-invalid", () => {
    const { enriched, decision } = runWorkflowPipeline({ message: "" });
    expect(enriched.profile.classificationValid).toBe(false);
    expect(decision.strategy).not.toBe("direct");
  });

  test("exhausted replan budget terminates in bounded-recovery exactly once", () => {
    const { enriched, decision } = runWorkflowPipeline({
      message: "Fix typo in the welcome banner",
      replanCount: 3,
      maxReplans: 3,
      runId: "run-regression-bounded-1",
    });
    expect(decision.strategy).toBe("bounded-recovery");
    expect(decision.gates.map((gate) => gate.gate)).toEqual([
      "human-approval",
    ]);
    const again = selectWorkflow(enriched.profile);
    expect(again.strategy).toBe("bounded-recovery");
    expect(again.reason).toBe(decision.reason);
    expect(again.runId).toBe(decision.runId);
  });

  test("session identity is echoed intact through profile to decision", () => {
    const { enriched, decision } = runWorkflowPipeline({
      message: "Fix typo in the welcome banner",
      sessionId: "sess-regression-echo",
    });
    expect(enriched.profile.sessionId).toBe("sess-regression-echo");
    expect(decision.sessionId).toBe("sess-regression-echo");
  });

  test("every non-direct strategy enforces the meaningful-work gate", () => {
    for (const strategy of NON_DIRECT_STRATEGIES) {
      const execOpts = resolveExecutionOptions(strategy);
      expect(execOpts.requireMeaningfulWork).toBe(true);
      expect(execOpts.requireMeaningfulWork).toBe(strategy !== "direct");
    }
  });

  test("gated strategies require two consecutive confirmations", () => {
    expect(
      resolveExecutionOptions("high-assurance").requiredConsecutive,
    ).toBe(2);
    expect(
      resolveExecutionOptions("bounded-recovery").requiredConsecutive,
    ).toBe(2);
    expect(resolveExecutionOptions("direct").requiredConsecutive).toBe(1);
  });

  test("selector cross-check: trivial clear work still goes direct", () => {
    expect(
      selectWorkflow({ complexity: "trivial", clarity: "clear" }).strategy,
    ).toBe("direct");
  });
});
