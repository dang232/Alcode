import { describe, expect, it } from "bun:test";
import { createRecord, type NewKnowledgeInput, type ProjectKnowledgeRecord } from "./record";
import { retrieveProjectKnowledge, type RetrievalRequest } from "./retrieve";

const PROJECT_A = "demo-12345678";
const PROJECT_B = "other-87654321";
const REVISION_A = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");

function baseInput(): NewKnowledgeInput {
  return {
    projectId: PROJECT_A,
    claim: "The gateway retries idempotent requests three times.",
    sourceFile: "src/gateway.ts",
    sourceSymbol: "fn:retry",
    sourceRevision: REVISION_A,
    sourceBlobSha256: BLOB_A,
    observedAt: OBSERVED_AT,
    validationMethod: "rg-resolve",
    confidence: 0.9,
    scope: { writeScopes: ["memory"] },
    invalidationConditions: ["SRC-EDIT"],
  };
}

function mustCreate(input: NewKnowledgeInput): ProjectKnowledgeRecord {
  const result = createRecord(input);
  if (result.kind === "refused") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

function baseRequest(projectId: string): RetrievalRequest {
  return {
    projectId,
    queryTexts: ["gateway retries requests"],
    nodeWriteScopes: ["memory"],
    nowMs: NOW_MS,
  };
}

describe("project-knowledge isolation", () => {
  it("#given records from two projects #when project B queries #then only B records serve", () => {
    // given (M06)
    const recordA = mustCreate(baseInput());
    const recordB = mustCreate({
      ...baseInput(),
      projectId: PROJECT_B,
      claim: "The gateway retries idempotent requests five times.",
    });

    // when
    const result = retrieveProjectKnowledge([recordA, recordB], baseRequest(PROJECT_B));

    // then (INV-07: no cross-project rows)
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([recordB.id]);
  });

  it("#given an environment record #when the wrong env queries #then it is filtered", () => {
    // given (M08)
    const record = mustCreate({
      ...baseInput(),
      claim: "The gateway retry budget refreshes hourly in production.",
      scope: { writeScopes: ["memory"], runScope: "prod" },
    });

    // when
    const wrong = retrieveProjectKnowledge([record], { ...baseRequest(PROJECT_A), runScope: "staging" });
    const missing = retrieveProjectKnowledge([record], baseRequest(PROJECT_A));

    // then (INV-08)
    expect(wrong.ranked).toEqual([]);
    expect(missing.ranked).toEqual([]);
  });

  it("#given an environment record #when the matching env queries #then it serves with its qualifier", () => {
    // given
    const record = mustCreate({
      ...baseInput(),
      claim: "The gateway retry budget refreshes hourly in production.",
      scope: { writeScopes: ["memory"], runScope: "prod" },
    });

    // when
    const result = retrieveProjectKnowledge([record], { ...baseRequest(PROJECT_A), runScope: "prod" });

    // then (the env qualifier travels with the record, never dropped)
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([record.id]);
    expect(result.budget.text).toContain("env: prod");
  });

  it("#given ordinary records #when any env queries #then they still serve", () => {
    // given
    const record = mustCreate(baseInput());

    // when
    const result = retrieveProjectKnowledge([record], { ...baseRequest(PROJECT_A), runScope: "staging" });

    // then (records without an env qualifier are not env-gated)
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([record.id]);
  });
});
