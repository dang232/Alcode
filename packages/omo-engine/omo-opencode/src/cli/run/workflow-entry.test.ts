import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRunnerProfileInput,
  buildWorkflowProfile,
} from "./workflow-profile";
import { selectWorkflow } from "./workflow-select";

describe("workflow entry wiring", () => {
  test("security-sensitive message maps to high-assurance through the real pipeline", () => {
    const input = buildRunnerProfileInput({
      message: "Rotate the admin auth token and update the permission check",
      sessionId: "session-entry-security",
      directory: "/tmp/work",
    });
    const enriched = buildWorkflowProfile(input);
    const decision = selectWorkflow(enriched.profile);
    expect(decision.strategy).toBe("high-assurance");
    expect(decision.gates.length).toBeGreaterThan(0);
    expect(enriched.basis).toContain("risk:security-sensitive");
  });

  test("trivial message maps to direct", () => {
    const input = buildRunnerProfileInput({
      message: "Fix typo in the welcome banner",
      sessionId: "session-entry-trivial",
      directory: "/tmp/work",
    });
    const enriched = buildWorkflowProfile(input);
    const decision = selectWorkflow(enriched.profile);
    expect(decision.strategy).toBe("direct");
    expect(decision.gates).toEqual([]);
  });

  test("explicit workflow passthrough wins over message evidence", () => {
    const input = buildRunnerProfileInput({
      message: "Fix typo in the welcome banner",
      sessionId: "session-entry-explicit",
      explicitMode: "plan-then-execute",
    });
    const enriched = buildWorkflowProfile(input);
    const decision = selectWorkflow(enriched.profile);
    expect(enriched.explicit).toBe(true);
    expect(decision.strategy).toBe("plan-then-execute");
    expect(decision.reason).toContain("explicit mode requested");
  });

  test("runner.ts calls the enriched profile path (regression guard)", () => {
    const source = readFileSync(join(import.meta.dir, "runner.ts"), "utf-8");
    expect(source).toContain("buildWorkflowProfile(");
    expect(source).toContain("resolveExecutionOptions(");
  });

  test("rich multi-signal message never selects direct", () => {
    const input = buildRunnerProfileInput({
      message:
        "The auth login failure is unreproducible and mysterious; it spans src/render/view.ts and src/render/layout.ts, root cause unknown",
      sessionId: "session-entry-rich",
      directory: "/tmp/work",
    });
    const enriched = buildWorkflowProfile(input);
    const decision = selectWorkflow(enriched.profile);
    expect(decision.strategy).not.toBe("direct");
  });
});
