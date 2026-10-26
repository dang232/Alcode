import { describe, expect, it } from "bun:test";
import { createRecord, type NewKnowledgeInput, type ProjectKnowledgeRecord } from "./record";
import {
  FRESHNESS_WEIGHT,
  SCOPE_MATCH_WEIGHT,
  SOURCE_AUTHORITY_WEIGHT,
  TASK_RELEVANCE_WEIGHT,
  VERIFICATION_WEIGHT,
  retrieveProjectKnowledge,
} from "./retrieve";

const PROJECT_A = "demo-12345678";
const REVISION_A = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");

function baseInput(claim: string, sourceFile: string, confidence: number): NewKnowledgeInput {
  return {
    projectId: PROJECT_A,
    claim,
    sourceFile,
    sourceSymbol: "file",
    sourceRevision: REVISION_A,
    sourceBlobSha256: BLOB_A,
    observedAt: OBSERVED_AT,
    validationMethod: "rg-resolve",
    confidence,
    scope: { writeScopes: ["memory"] },
    invalidationConditions: ["SRC-EDIT", "SRC-DELETE"],
  };
}

function mustCreate(claim: string, sourceFile: string, confidence: number): ProjectKnowledgeRecord {
  const result = createRecord(baseInput(claim, sourceFile, confidence));
  if (result.kind === "refused") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

describe("project-knowledge retrieve relevance", () => {
  it("#given module entry-point and contract records #when a task names the module #then the entry point ranks first (M01)", () => {
    // given (M01: two records about the gateway module plus unrelated notes)
    const entryPoint = mustCreate(
      "The gateway entry points live in src/gateway.ts and export retryRequest.",
      "src/gateway.ts",
      0.8,
    );
    const contracts = mustCreate(
      "The gateway contracts require idempotent retries with backoff.",
      "src/gateway.ts",
      0.8,
    );
    const ledgerNote = mustCreate("The treasury ledger balances every midnight.", "src/ledger.ts", 0.8);
    const roadmapNote = mustCreate("The quarterly roadmap review meets Thursday.", "docs/roadmap.md", 0.8);

    // when
    const result = retrieveProjectKnowledge([entryPoint, contracts, ledgerNote, roadmapNote], {
      projectId: PROJECT_A,
      queryTexts: ["gateway entry points"],
      nodeWriteScopes: ["memory"],
      nowMs: NOW_MS,
    });

    // then (the entry point names the task terms verbatim, so the ranker puts it first)
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([entryPoint.id, contracts.id]);
  });

  it("#given a confident-but-irrelevant record #when a task favors another record #then relevance decides, not confidence (M02)", () => {
    // given (M02: identical non-relevance factors, only confidence differs)
    const relevant = mustCreate(
      "The ledger reconciliation balances every midnight.",
      "src/ledger.ts",
      0.5,
    );
    const confidentNoise = mustCreate("The ledger backup window closes hourly.", "src/backup.ts", 1);

    // when
    const result = retrieveProjectKnowledge([confidentNoise, relevant], {
      projectId: PROJECT_A,
      queryTexts: ["ledger reconciliation"],
      nodeWriteScopes: ["memory"],
      nowMs: NOW_MS,
    });

    // then (section 5: task relevance carries the largest single weight)
    expect(TASK_RELEVANCE_WEIGHT).toBeGreaterThan(SOURCE_AUTHORITY_WEIGHT);
    expect(TASK_RELEVANCE_WEIGHT).toBeGreaterThan(FRESHNESS_WEIGHT);
    expect(TASK_RELEVANCE_WEIGHT).toBeGreaterThan(SCOPE_MATCH_WEIGHT);
    expect(TASK_RELEVANCE_WEIGHT).toBeGreaterThan(VERIFICATION_WEIGHT);
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([relevant.id, confidentNoise.id]);
  });
});
