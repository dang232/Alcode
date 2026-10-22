import { describe, expect, it } from "bun:test";
import {
  applyBudget,
  KNOWLEDGE_BLOCK_MAX_BYTES,
  KNOWLEDGE_BLOCK_MAX_RECORDS,
  UNTRUSTED_MEMORY_HEADER,
  type BudgetedEntry,
} from "./budget";
import { createRecord, type NewKnowledgeInput, type ProjectKnowledgeRecord } from "./record";

const PROJECT_A = "demo-12345678";
const REVISION_A = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";

function baseInput(claim: string, sourceFile: string): NewKnowledgeInput {
  return {
    projectId: PROJECT_A,
    claim,
    sourceFile,
    sourceSymbol: "file",
    sourceRevision: REVISION_A,
    sourceBlobSha256: BLOB_A,
    observedAt: OBSERVED_AT,
    validationMethod: "rg-resolve",
    confidence: 0.9,
    scope: { writeScopes: ["memory"] },
    invalidationConditions: ["SRC-EDIT"],
  };
}

function mustCreate(claim: string, sourceFile: string): ProjectKnowledgeRecord {
  const result = createRecord(baseInput(claim, sourceFile));
  if (result.kind === "refused") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

function entry(record: ProjectKnowledgeRecord, totalScore: number): BudgetedEntry {
  return { record, totalScore, scopeNote: "in-scope" };
}

function manyRecords(count: number, claimWords: string): ProjectKnowledgeRecord[] {
  const records: ProjectKnowledgeRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    records.push(mustCreate(`Project atlas ${claimWords} marker ${index}.`, `src/atlas-${index}.ts`));
  }
  return records;
}

/** Settled (non-hypothesis) records, so count/byte truncation is what trims. */
function manySettled(count: number, claimWords: string): ProjectKnowledgeRecord[] {
  return manyRecords(count, claimWords).map((record) => ({
    ...record,
    category: "previously-verified" as const,
    validatedAt: "2026-10-02T00:00:00.000Z",
  }));
}

describe("project-knowledge budget", () => {
  it("#given fifty eligible records #when the budget applies #then the block stays bounded", () => {
    // given (M09)
    const records = manySettled(50, "gateway relay");
    const entries = records.map((record, index) => entry(record, 50 - index));

    // when
    const result = applyBudget(entries);

    // then (INV-09: at most 12 records and 4 KB)
    expect(result.included.length).toBe(KNOWLEDGE_BLOCK_MAX_RECORDS);
    expect(result.bytes).toBeLessThanOrEqual(KNOWLEDGE_BLOCK_MAX_BYTES);
    expect(result.text.startsWith(UNTRUSTED_MEMORY_HEADER)).toBe(true);
    // every included entry keeps its provenance triple and category
    for (const included of result.included) {
      expect(result.text).toContain(included.record.id);
      expect(result.text).toContain(included.record.category);
      expect(result.text).toContain(included.record.sourceFile);
      expect(result.text).toContain(included.record.sourceRevision.slice(0, 12));
      expect(result.text).toContain(included.record.fingerprint.slice(0, 12));
    }
  });

  it("#given five hypotheses #when the budget applies #then at most one survives", () => {
    // given (M10)
    const records = manyRecords(5, "gateway relay");
    const entries = records.map((record, index) => entry(record, 5 - index));

    // when
    const result = applyBudget(entries);

    // then (INV-10)
    const hypotheses = result.included.filter((included) => included.record.category === "unverified-hypothesis");
    expect(hypotheses.length).toBe(1);
    expect(result.dropped.filter((drop) => drop.reason === "hypothesis-cap").length).toBe(4);
  });

  it("#given fifteen settled records #when the budget applies #then the lowest scores drop first", () => {
    // given
    const records = manySettled(15, "gateway relay");
    const entries = records.map((record, index) => entry(record, 15 - index));

    // when
    const result = applyBudget(entries);

    // then (truncation order: lowest total first)
    expect(result.included.length).toBe(KNOWLEDGE_BLOCK_MAX_RECORDS);
    expect(result.included[0]?.totalScore).toBe(15);
    expect(result.included[result.included.length - 1]?.totalScore).toBe(4);
    expect(result.dropped.every((drop) => drop.reason === "budget-records")).toBe(true);
  });

  it("#given stale records covered by fresh ones #when the budget applies #then the stale ones drop", () => {
    // given
    const fresh: ProjectKnowledgeRecord = {
      ...mustCreate("Project atlas gateway relay marker fresh.", "src/atlas-same.ts"),
      category: "source-verified",
      validatedAt: "2026-10-02T00:00:00.000Z",
    };
    const stale: ProjectKnowledgeRecord = {
      ...mustCreate("Project atlas gateway relay marker stale.", "src/atlas-same.ts"),
      category: "previously-verified",
      validatedAt: "2026-09-01T00:00:00.000Z",
    };

    // when
    const result = applyBudget([entry(stale, 0.9), entry(fresh, 0.8)]);

    // then
    expect(result.included.map((included) => included.record.id)).toEqual([fresh.id]);
    expect(result.dropped.map((drop) => drop.reason)).toEqual(["fresh-cover"]);
  });

  it("#given a huge block #when the budget applies #then bytes stay within cap", () => {
    // given (500-char claims blow past 4 KB at 12 records)
    const records: ProjectKnowledgeRecord[] = [];
    for (let index = 0; index < 12; index += 1) {
      const created = mustCreate(`Project atlas gateway relay ${"x".repeat(440)} ${index}.`, `src/atlas-${index}.ts`);
      records.push({ ...created, category: "previously-verified", validatedAt: "2026-10-02T00:00:00.000Z" });
    }

    // when
    const result = applyBudget(records.map((record, index) => entry(record, 12 - index)));

    // then
    expect(result.bytes).toBeLessThanOrEqual(KNOWLEDGE_BLOCK_MAX_BYTES);
    expect(result.dropped.some((drop) => drop.reason === "budget-bytes")).toBe(true);
  });

  it("#given no entries #when the block builds #then the header still stands", () => {
    // when
    const result = applyBudget([]);

    // then (H1 travels even with the data absent)
    expect(result.text).toBe(UNTRUSTED_MEMORY_HEADER);
    expect(result.included).toEqual([]);
  });
});
