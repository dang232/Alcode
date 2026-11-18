// Tests for the model-driven repair diagnosis seam (see ./model-diagnosis.ts).
//
// Every test exercises the real parser/adapter with plain bun:test - no
// sleeps, no engine mocks. The only fakes are the invoker seam itself (the
// exact knob the module declares) and a structural in-process runner double
// for the production adapter.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { RunnerError } from "../runners/in-process/runner-error";
import type { PlannedFileOperation } from "./plan";
import type { ChildHandle, ChildSpec } from "../runners/in-process";
import type { RunnerOutcome } from "../runners/in-process/child-handle";
import {
  createHostDiagnosisInvoker,
  REPAIR_DIAGNOSIS_ANSWER_CONTRACT,
  REPAIR_FILE_OPERATION_PAYLOAD_CONTRACT,
  RepairDiagnosisError,
  requestRepairDiagnosis,
  type RepairDiagnosisInvoker,
  type RepairDiagnosisRequest,
} from "./model-diagnosis";

const REQUEST: RepairDiagnosisRequest = {
  systemInstructions: "You diagnose repair failures from host evidence only.",
  diagnosisContextJson: JSON.stringify({ taskId: "task-1", failedChecks: ["unit-a"] }),
  outputContract: "Respond with the diagnosis JSON contract.",
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validAnswerText(): string {
  return JSON.stringify({
    observedFacts: ["unit-a failed with exit code 4", "evidence revision abc matches the current tree"],
    hypotheses: [
      {
        statement: "The retry counter is off by one.",
        supportingFactIndexes: [0],
        supportingEvidence: ["exit code 4 in the unit-a output excerpt"],
      },
    ],
    supportingEvidence: ["exit code 4 in the unit-a output excerpt"],
    confidence: 0.7,
    missingInformation: ["the full unit-a log beyond the excerpt"],
    proposedNextAction: "Fix the retry counter in src/fix.ts and rerun unit-a.",
  });
}

function answerWithFileOperations(fileOperations: readonly PlannedFileOperation[]): string {
  return JSON.stringify({
    observedFacts: ["unit-a failed with exit code 4", "evidence revision abc matches the current tree"],
    hypotheses: [
      {
        statement: "The retry counter is off by one.",
        supportingFactIndexes: [0],
        supportingEvidence: ["exit code 4 in the unit-a output excerpt"],
      },
    ],
    supportingEvidence: ["exit code 4 in the unit-a output excerpt"],
    confidence: 0.7,
    missingInformation: ["the full unit-a log beyond the excerpt"],
    proposedNextAction: "Fix the retry counter in src/fix.ts and rerun unit-a.",
    fileOperations,
  });
}

function baseSpec(prompt: string): ChildSpec {
  return {
    taskId: "repair-diagnosis",
    cwd: "I:/migration/Alwork",
    sessionDir: "I:/migration/Alwork/.sessions/repair-diagnosis",
    depth: 1,
    parentSessionId: "parent-1",
    rootSessionId: "root-1",
    prompt,
    selectedModel: "test-provider/test-model",
    resolvedModel: {
      provider: "test-provider",
      model_id: "test-model",
      display: "test-provider/test-model",
      source: "category",
    },
  };
}

function specWithoutModel(prompt: string): ChildSpec {
  return {
    taskId: "repair-diagnosis",
    cwd: "I:/migration/Alwork",
    sessionDir: "I:/migration/Alwork/.sessions/repair-diagnosis",
    depth: 1,
    parentSessionId: "parent-1",
    rootSessionId: "root-1",
    prompt,
  };
}

type FakeDiagnosisHandle = {
  readonly handle: ChildHandle;
  readonly disposed: () => boolean;
};

function fakeHandle(outcome: RunnerOutcome): FakeDiagnosisHandle {
  let done = false;
  const handle: ChildHandle = {
    task_id: "repair-diagnosis",
    sessionId: "session-1",
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => undefined,
    subscribe: () => () => undefined,
    waitForIdle: async () => outcome,
    lastAssistantText: () => undefined,
    dispose: async () => {
      done = true;
    },
  };
  return { handle, disposed: () => done };
}

describe("repair model diagnosis", () => {
  test("valid structured answer parses into facts, hypotheses, evidence, confidence, and next action", async () => {
    const invoker: RepairDiagnosisInvoker = async () => validAnswerText();
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
    expect(result.diagnosis.observedFacts).toEqual([
      "unit-a failed with exit code 4",
      "evidence revision abc matches the current tree",
    ]);
    expect(result.diagnosis.hypotheses).toEqual([
      {
        statement: "The retry counter is off by one.",
        supportingFactIndexes: [0],
        supportingEvidence: ["exit code 4 in the unit-a output excerpt"],
      },
    ]);
    expect(result.diagnosis.supportingEvidence).toEqual(["exit code 4 in the unit-a output excerpt"]);
    expect(result.diagnosis.confidence).toBe(0.7);
    expect(result.diagnosis.missingInformation).toEqual(["the full unit-a log beyond the excerpt"]);
    expect(result.diagnosis.proposedNextAction).toBe("Fix the retry counter in src/fix.ts and rerun unit-a.");
    // No file operations declared: parses, and there is nothing to apply.
    expect(result.diagnosis.fileOperations).toEqual([]);
  });

  test("file operations parse with their exact change text: find/replace for modify and content for create", async () => {
    const invoker: RepairDiagnosisInvoker = async () =>
      answerWithFileOperations([
        { path: "src/fix.ts", operation: "modify", find: "counter = 0", replace: "counter = 1" },
        { path: "src/new.ts", operation: "create", content: "export const made = true;\n" },
        { path: "src/old.ts", operation: "delete" },
      ]);
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
    expect(result.diagnosis.fileOperations).toEqual([
      {
        path: "src/fix.ts",
        operation: "modify",
        edits: [{ path: "src/fix.ts", oldText: "counter = 0", newText: "counter = 1" }],
      },
      { path: "src/new.ts", operation: "create", content: "export const made = true;\n" },
      { path: "src/old.ts", operation: "delete" },
    ]);
  });

  test("operations without payloads still parse and simply carry no change text", async () => {
    const invoker: RepairDiagnosisInvoker = async () =>
      answerWithFileOperations([
        { path: "src/fix.ts", operation: "modify" },
        { path: "src/new.ts", operation: "create" },
      ]);
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
    expect(result.diagnosis.fileOperations).toEqual([
      { path: "src/fix.ts", operation: "modify" },
      { path: "src/new.ts", operation: "create" },
    ]);
  });

  test("malformed payloads are typed failures, never coerced", async () => {
    const payloads: readonly unknown[] = [
      [{ path: "src/fix.ts", operation: "modify", find: 42, replace: "x" }],
      [{ path: "src/fix.ts", operation: "modify", find: "counter = 0" }],
      [{ path: "src/fix.ts", operation: "modify", replace: "counter = 1" }],
      [{ path: "src/fix.ts", operation: "modify", find: "", replace: "counter = 1" }],
      [{ path: "src/new.ts", operation: "create", content: 7 }],
      [{ path: "src/old.ts", operation: "delete", content: "stale" }],
      [{ path: "", operation: "modify", find: "a", replace: "b" }],
      [{ path: "src/fix.ts", operation: "rewrite", find: "a", replace: "b" }],
    ];
    for (const payload of payloads) {
      const invoker: RepairDiagnosisInvoker = async () => answerWithFileOperations(payload);
      const result = await requestRepairDiagnosis(invoker, REQUEST);
      if (result.ok) throw new Error(`expected a typed failure for payload ${JSON.stringify(payload)}`);
      expect(result.reason).toBe("malformed_answer");
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  test("fenced JSON answer parses the payload, not the wrapping", async () => {
    const invoker: RepairDiagnosisInvoker = async () => `\`\`\`json\n${validAnswerText()}\n\`\`\``;
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
    expect(result.diagnosis.hypotheses.length).toBe(1);
  });

  test("malformed answer is rejected with a typed failure", async () => {
    const invoker: RepairDiagnosisInvoker = async () => "not json at all {{{";
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("malformed_answer");
    expect(result.detail.length).toBeGreaterThan(0);
  });

  test("a prose answer is re-asked exactly once with the parse error and the exact shape, then succeeds", async () => {
    const requests: RepairDiagnosisRequest[] = [];
    const invoker: RepairDiagnosisInvoker = async (request) => {
      requests.push(request);
      return requests.length === 1 ? "I think the retry counter is off by one." : validAnswerText();
    };
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
    expect(result.reAskCount).toBe(1);
    expect(result.diagnosis.hypotheses.length).toBe(1);
    // Exactly two model calls: the prose answer and one bounded re-ask.
    expect(requests.length).toBe(2);
    expect(requests[0].reAsk).toBeUndefined();
    const reAsk = requests[1].reAsk;
    if (reAsk === undefined) throw new Error("expected the re-ask marker on the second request");
    expect(reAsk.attempt).toBe(1);
    expect(reAsk.parseError).toContain("The model answer is not valid JSON");
    expect(reAsk.requiredContract).toBe(REPAIR_DIAGNOSIS_ANSWER_CONTRACT);
  });

  test("malformed twice fails closed with both answer hashes and no third call", async () => {
    const answers = ["I think the retry counter is off by one.", "Still prose, no JSON here."];
    const requests: RepairDiagnosisRequest[] = [];
    const invoker: RepairDiagnosisInvoker = async (request) => {
      requests.push(request);
      return answers[requests.length - 1];
    };
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("malformed_answer");
    // The bounded retry is exhausted at two calls - never a third.
    expect(requests.length).toBe(2);
    expect(requests[1].reAsk?.attempt).toBe(1);
    // Both raw answers are represented by length + sha256 only, never text.
    for (const answer of answers) {
      expect(result.detail).toContain(`length=${answer.length}`);
      expect(result.detail).toContain(sha256(answer));
      expect(result.detail).not.toContain(answer);
    }
  });

  test("a valid first answer is never re-asked", async () => {
    let calls = 0;
    const invoker: RepairDiagnosisInvoker = async () => {
      calls += 1;
      return validAnswerText();
    };
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
    expect(calls).toBe(1);
    expect(result.reAskCount).toBe(0);
  });

  test("a valid answer the model declines to defend is not re-asked", async () => {
    let calls = 0;
    const invoker: RepairDiagnosisInvoker = async () => {
      calls += 1;
      return JSON.stringify({ defensible: false, observedFacts: [], hypotheses: [] });
    };
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("no_defensible_diagnosis");
    expect(calls).toBe(1);
  });

  test("host adapter puts the parse error and exact JSON shape into the re-ask prompt", async () => {
    const prompts: string[] = [];
    const answers = ["I looked at the failing check and the retry counter is off by one.", validAnswerText()];
    const invoker = createHostDiagnosisInvoker({
      runner: {
        start: async () => {
          const answer = answers[prompts.length - 1];
          return fakeHandle({ status: "completed", finalResponse: answer }).handle;
        },
      },
      childSpecFor: (prompt) => {
        prompts.push(prompt);
        return baseSpec(prompt);
      },
    });
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.detail}`);
    expect(result.reAskCount).toBe(1);
    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("## Re-ask");
    expect(prompts[1]).toContain("## Re-ask: the previous answer could not be parsed");
    expect(prompts[1]).toContain("The model answer is not valid JSON");
    expect(prompts[1]).toContain(REPAIR_DIAGNOSIS_ANSWER_CONTRACT);
  });

  test("wrongly shaped answer is rejected as malformed", async () => {
    const invoker: RepairDiagnosisInvoker = async () =>
      JSON.stringify({ observedFacts: "a single string, not an array", hypotheses: [] });
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("malformed_answer");
  });

  test("empty answer is rejected as empty, not parsed", async () => {
    const invoker: RepairDiagnosisInvoker = async () => "   \n  ";
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("empty_answer");
  });

  test("hypothesis without supporting facts is rejected as malformed", async () => {
    const invoker: RepairDiagnosisInvoker = async () =>
      JSON.stringify({
        observedFacts: ["unit-a failed"],
        hypotheses: [{ statement: "Unsupported guess.", supportingFactIndexes: [] }],
        confidence: 0.5,
        proposedNextAction: "Look closer.",
      });
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("malformed_answer");
    expect(result.detail).toContain("hypothesis_without_support");
  });

  test("hypothesis citing a fact index out of range is rejected as malformed", async () => {
    const invoker: RepairDiagnosisInvoker = async () =>
      JSON.stringify({
        observedFacts: ["unit-a failed"],
        hypotheses: [{ statement: "Guess.", supportingFactIndexes: [7] }],
        confidence: 0.5,
        proposedNextAction: "Look closer.",
      });
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("malformed_answer");
    expect(result.detail).toContain("fact_index_out_of_range");
  });

  test("model declining to justify returns no-defensible-diagnosis and synthesises nothing", async () => {
    const invoker: RepairDiagnosisInvoker = async () =>
      JSON.stringify({
        defensible: false,
        observedFacts: [],
        hypotheses: [],
        confidence: 0,
        proposedNextAction: "",
      });
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("no_defensible_diagnosis");
    expect("diagnosis" in result).toBe(false);
  });

  test("well-formed answer with no hypotheses returns no-defensible-diagnosis, not a guess", async () => {
    const invoker: RepairDiagnosisInvoker = async () =>
      JSON.stringify({
        observedFacts: ["unit-a failed"],
        hypotheses: [],
        confidence: 0.1,
        proposedNextAction: "Gather more evidence.",
      });
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("no_defensible_diagnosis");
    expect("diagnosis" in result).toBe(false);
  });

  test("invoker error propagates as repair blocked with its cause", async () => {
    const cause = new RunnerError({ kind: "child-turn-failed", message: "child turn produced no assistant output" });
    const invoker: RepairDiagnosisInvoker = async () => {
      throw cause;
    };
    const result = await requestRepairDiagnosis(invoker, REQUEST);
    if (result.ok) throw new Error("expected a failure");
    expect(result.reason).toBe("repair_blocked");
    expect(result.cause).toBe(cause);
  });

  test("host adapter runs the prompt through the runner and returns the raw model text", async () => {
    const seen: string[] = [];
    const started: ChildSpec[] = [];
    const { handle, disposed } = fakeHandle({ status: "completed", finalResponse: validAnswerText() });
    const invoker = createHostDiagnosisInvoker({
      runner: {
        start: async (spec) => {
          started.push(spec);
          return handle;
        },
      },
      childSpecFor: (prompt) => {
        seen.push(prompt);
        return baseSpec(prompt);
      },
    });
    const raw = await invoker(REQUEST);
    expect(raw).toBe(validAnswerText());
    expect(started.length).toBe(1);
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain(REQUEST.systemInstructions);
    expect(seen[0]).toContain(REQUEST.diagnosisContextJson);
    expect(seen[0]).toContain(REQUEST.outputContract);
    // The model is asked for the concrete change text, not just file names,
    // and told where the host-provided file content lives.
    expect(seen[0]).toContain(REPAIR_FILE_OPERATION_PAYLOAD_CONTRACT);
    expect(seen[0]).toContain("workspaceContext");
    expect(seen[0]).toContain("verbatim");
    expect(seen[0]).toContain("find");
    expect(seen[0]).toContain("replace");
    expect(disposed()).toBe(true);
  });

  test("host adapter throws typed model_unavailable when no provider is configured and never starts a child", async () => {
    let starts = 0;
    const invoker = createHostDiagnosisInvoker({
      runner: {
        start: async (spec) => {
          starts += 1;
          return fakeHandle({ status: "completed", finalResponse: "{}" }).handle;
        },
      },
      childSpecFor: (prompt) => specWithoutModel(prompt),
    });
    let thrown: unknown;
    try {
      await invoker(REQUEST);
    } catch (error) {
      thrown = error;
    }
    expect(starts).toBe(0);
    if (!RunnerError.is(thrown)) throw new Error("expected a RunnerError");
    expect(thrown.failure.kind).toBe("model_unavailable");
  });

  test("host adapter surfaces a failed turn as the same typed runner failure and still disposes", async () => {
    const { handle, disposed } = fakeHandle({
      status: "error",
      failure: { kind: "child-turn-failed", message: "child turn produced no assistant output" },
    });
    const invoker = createHostDiagnosisInvoker({
      runner: { start: async () => handle },
      childSpecFor: (prompt) => baseSpec(prompt),
    });
    let thrown: unknown;
    try {
      await invoker(REQUEST);
    } catch (error) {
      thrown = error;
    }
    if (!RunnerError.is(thrown)) throw new Error("expected a RunnerError");
    expect(thrown.failure.kind).toBe("child-turn-failed");
    expect(disposed()).toBe(true);
  });

  test("host adapter surfaces cancellation as repair blocked and still disposes", async () => {
    const { handle, disposed } = fakeHandle({ status: "cancelled" });
    const invoker = createHostDiagnosisInvoker({
      runner: { start: async () => handle },
      childSpecFor: (prompt) => baseSpec(prompt),
    });
    let thrown: unknown;
    try {
      await invoker(REQUEST);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RepairDiagnosisError);
    expect(disposed()).toBe(true);
  });
});
