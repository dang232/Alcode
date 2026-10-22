import { describe, test, expect } from "bun:test";
import {
  buildRunnerProfileInput,
  buildWorkflowProfile,
  resolveExecutionOptions,
  type EnrichedProfile,
  type WorkflowProfileInput,
} from "./workflow-profile";
import {
  KNOWN_STRATEGIES,
  selectWorkflow,
  type WorkflowStrategy,
} from "./workflow-select";

const EXPECTED_EXECUTION_OPTIONS = {
  direct: { requireMeaningfulWork: false, requiredConsecutive: 1 },
  "explore-then-execute": { requireMeaningfulWork: true, requiredConsecutive: 1 },
  "plan-then-execute": { requireMeaningfulWork: true, requiredConsecutive: 1 },
  "parallel-native": { requireMeaningfulWork: true, requiredConsecutive: 1 },
  "high-assurance": { requireMeaningfulWork: true, requiredConsecutive: 2 },
  "bounded-recovery": { requireMeaningfulWork: true, requiredConsecutive: 2 },
} satisfies Record<
  WorkflowStrategy,
  { requireMeaningfulWork: boolean; requiredConsecutive: number }
>;

describe("buildWorkflowProfile", () => {
  test("trivial message yields trivial complexity and the direct path", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message: "Fix typo in the welcome banner",
    });
    expect(enriched.profile.complexity).toBe("trivial");
    expect(enriched.profile.clarity).toBe("clear");
    expect(enriched.profile.risk).toBe("low");
    expect(enriched.profile.fileCount).toBe(1);
    expect(enriched.profile.classificationValid).toBe(true);
    expect(enriched.explicit).toBe(false);
    expect(enriched.basis).toContain("complexity:trivial");
    expect(selectWorkflow(enriched.profile).strategy).toBe("direct");
  });

  test("security markers yield security-sensitive risk", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message: "Rotate the admin auth token and update the permission check",
    });
    expect(enriched.profile.risk).toBe("security-sensitive");
    expect(enriched.basis).toContain("risk:security-sensitive");
    expect(selectWorkflow(enriched.profile).strategy).toBe("high-assurance");
  });

  test("unclear multi-file message takes the explore path", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message:
        "The failure is unreproducible and mysterious; it spans src/render/view.ts and src/render/layout.ts, root cause unknown",
    });
    expect(enriched.profile.clarity).toBe("unclear");
    expect(enriched.profile.fileCount).toBe(2);
    expect(enriched.basis).toContain("clarity:unclear");
    expect(enriched.basis).toContain("fileCount:2");
    expect(selectWorkflow(enriched.profile).strategy).toBe("explore-then-execute");
  });

  test("complex multi-step message yields complex complexity", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message:
        "Refactor the parser:\n1. Extract lexing into src/parse/lexer.ts\n2. Move validation into src/parse/validator.ts\n3. Wire output through src/parse/emitter.ts",
    });
    expect(enriched.profile.complexity).toBe("complex");
    expect(enriched.profile.fileCount).toBe(3);
    expect(enriched.basis).toContain("complexity:complex");
    expect(enriched.basis).toContain("complexityEvidence:numbered-steps>=3");
  });

  test("agent fallback marks provider capability unavailable", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message: "Fix typo in the welcome banner",
      requestedAgent: "Sisyphus",
      resolvedAgent: "hephaestus",
    });
    expect(enriched.profile.providerCapabilityUnavailable).toBe(true);
    expect(enriched.basis).toContain("providerCapabilityUnavailable:true");
    expect(selectWorkflow(enriched.profile).strategy).toBe("plan-then-execute");
  });

  test("matching agent keeps provider capability available", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message: "Fix typo in the welcome banner",
      requestedAgent: "  Sisyphus ",
      resolvedAgent: "sisyphus",
    });
    expect(enriched.profile.providerCapabilityUnavailable).toBe(false);
    expect(enriched.basis).toContain("providerCapabilityUnavailable:false");
  });

  test("empty message without explicit mode is classification-invalid", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({ message: "   " });
    expect(enriched.profile.classificationValid).toBe(false);
    expect(enriched.basis).toContain("classificationValid:false");
    expect(selectWorkflow(enriched.profile).strategy).toBe("high-assurance");
  });

  test("explicit mode passes through normalized", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message: "Fix typo in the welcome banner",
      explicitMode: "  Plan-Then-Execute ",
    });
    expect(enriched.profile.explicitMode).toBe("plan-then-execute");
    expect(enriched.explicit).toBe(true);
    expect(enriched.basis).toContain("explicitMode:plan-then-execute");
    expect(selectWorkflow(enriched.profile).strategy).toBe("plan-then-execute");
  });

  test("directory is recorded in signal provenance without disk access", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message: "Fix typo in the welcome banner",
      directory: "I:/repo",
    });
    const directorySignals = enriched.signals.filter(
      (signal) => signal.field === "directory",
    );
    expect(directorySignals).toHaveLength(1);
    const directorySignal = directorySignals[0];
    expect(directorySignal?.value).toBe("I:/repo");
    expect(directorySignal?.provenance).toContain("never read from disk");
  });

  test("every signal carries field, value, and provenance", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message: "Fix typo in the welcome banner",
      sessionId: "sess-1",
      runId: "run-1",
    });
    expect(enriched.signals.length).toBeGreaterThan(0);
    for (const signal of enriched.signals) {
      expect(signal.field.length).toBeGreaterThan(0);
      expect(signal.provenance.length).toBeGreaterThan(0);
    }
    for (const code of enriched.basis) {
      expect(code.length).toBeGreaterThan(0);
    }
  });

  test("new dependency markers are detected", () => {
    const enriched: EnrichedProfile = buildWorkflowProfile({
      message: "Please install-package acme-queue as a new-library for the worker",
    });
    expect(enriched.profile.newDependencyEvidence).toBe(true);
    expect(enriched.basis).toContain("newDependencyEvidence:true");
    expect(selectWorkflow(enriched.profile).strategy).toBe("explore-then-execute");
  });
});

describe("buildRunnerProfileInput", () => {
  test("maps runner arguments to profile input", () => {
    const input: WorkflowProfileInput = buildRunnerProfileInput({
      message: "Fix typo in the welcome banner",
      sessionId: "sess-1",
      requestedAgent: "sisyphus",
      resolvedAgent: "hephaestus",
      requestedModel: "anthropic/claude-x",
      resolvedModel: { providerID: "anthropic", modelID: "claude-x" },
      directory: "I:/repo",
      explicitMode: "direct",
      replanCount: 1,
      maxReplans: 3,
      completedWorkUnits: 2,
      runId: "run-abc",
    });
    expect(input.message).toBe("Fix typo in the welcome banner");
    expect(input.sessionId).toBe("sess-1");
    expect(input.requestedAgent).toBe("sisyphus");
    expect(input.resolvedAgent).toBe("hephaestus");
    expect(input.requestedModel).toBe("anthropic/claude-x");
    expect(input.resolvedModel).toEqual({
      providerID: "anthropic",
      modelID: "claude-x",
    });
    expect(input.directory).toBe("I:/repo");
    expect(input.explicitMode).toBe("direct");
    expect(input.replanCount).toBe(1);
    expect(input.maxReplans).toBe(3);
    expect(input.completedWorkUnits).toBe(2);
    expect(input.runId).toBe("run-abc");

    const enriched: EnrichedProfile = buildWorkflowProfile(input);
    expect(enriched.profile.sessionId).toBe("sess-1");
    expect(enriched.profile.runId).toBe("run-abc");
    expect(enriched.profile.explicitMode).toBe("direct");
    expect(enriched.explicit).toBe(true);
  });

  test("omits unset optional fields", () => {
    const input: WorkflowProfileInput = buildRunnerProfileInput({
      message: "Fix typo in the welcome banner",
      sessionId: "sess-1",
    });
    expect(input.requestedAgent).toBeUndefined();
    expect(input.directory).toBeUndefined();
    expect(input.explicitMode).toBeUndefined();
    const enriched: EnrichedProfile = buildWorkflowProfile(input);
    expect(enriched.profile.explicitMode).toBeUndefined();
    expect(enriched.explicit).toBe(false);
  });
});

describe("resolveExecutionOptions", () => {
  test("resolves all six strategies", () => {
    expect(KNOWN_STRATEGIES).toHaveLength(6);
    for (const strategy of KNOWN_STRATEGIES) {
      expect(resolveExecutionOptions(strategy)).toEqual(
        EXPECTED_EXECUTION_OPTIONS[strategy],
      );
    }
  });

  test("direct skips the meaningful-work gate while gated strategies confirm twice", () => {
    expect(resolveExecutionOptions("direct")).toEqual({
      requireMeaningfulWork: false,
      requiredConsecutive: 1,
    });
    expect(resolveExecutionOptions("high-assurance")).toEqual({
      requireMeaningfulWork: true,
      requiredConsecutive: 2,
    });
    expect(resolveExecutionOptions("bounded-recovery")).toEqual({
      requireMeaningfulWork: true,
      requiredConsecutive: 2,
    });
  });
});
