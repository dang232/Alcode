import { describe, expect, it } from "bun:test";
import { recordFilePath, createRecord, type NewKnowledgeInput, type ProjectKnowledgeRecord } from "./record";
import { resolveAuditRecord, retrieveProjectKnowledge, type RetrievalRequest } from "./retrieve";
import { UNTRUSTED_MEMORY_HEADER } from "./budget";

const PROJECT_A = "demo-12345678";
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
    invalidationConditions: ["SRC-EDIT", "SRC-DELETE"],
  };
}

function mustCreate(claim: string, sourceFile: string): ProjectKnowledgeRecord {
  const result = createRecord({ ...baseInput(), claim, sourceFile });
  if (result.kind === "refused") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

function baseRequest(): RetrievalRequest {
  return {
    projectId: PROJECT_A,
    queryTexts: ["gateway request retries"],
    nodeWriteScopes: ["memory"],
    nowMs: NOW_MS,
  };
}

describe("project-knowledge retrieve", () => {
  it("#given a superseded record #when a fuzzy query runs #then it stays invisible but resolves by exact id", () => {
    // given (M04)
    const live = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    const dead: ProjectKnowledgeRecord = {
      ...mustCreate("The gateway backoff schedule honors jitter.", "src/gateway.ts"),
      category: "superseded",
    };

    // when
    const result = retrieveProjectKnowledge([live, dead], baseRequest());

    // then (INV-04)
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([live.id]);
    // INV-18: audit read by exact id still resolves
    expect(resolveAuditRecord([live, dead], dead.id)).toEqual(dead);
    expect(resolveAuditRecord([live, dead], "pk-000000000000")).toBeUndefined();
  });

  it("#given working-tree-only knowledge #when retrieval runs #then it is absent", () => {
    // given (M13: retrieval reads the HEAD tree only, never the working tree)
    const committed = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    const workingTreeOnly = mustCreate("The gateway circuit breaker trips fast.", "src/breaker.ts");

    // when (only committed files reach retrieval)
    const result = retrieveProjectKnowledge([committed], baseRequest());

    // then
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([committed.id]);
    expect(result.ranked.some((entry) => entry.record.id === workingTreeOnly.id)).toBe(false);
  });

  it("#given own-session records #when retrieval runs #then they are excluded", () => {
    // given (M17)
    const shared = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    const own = mustCreate("The gateway retry budget refreshes hourly.", "src/gateway.ts");

    // when
    const result = retrieveProjectKnowledge(
      [shared, own],
      { ...baseRequest(), excludeSessionRecordIds: new Set([own.id]) },
    );

    // then
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([shared.id]);
  });

  it("#given a disjoint-scope record #when retrieval runs #then it serves as a hint only", () => {
    // given (M19)
    const created = createRecord({
      ...baseInput(),
      claim: "The gateway retry budget refreshes hourly for overseas traffic.",
      sourceFile: "src/gateway.ts",
      scope: { writeScopes: ["billing"] },
    });
    if (created.kind === "refused") throw new Error(`fixture refused: ${created.reason}`);
    const hinted = created.record;

    // when
    const result = retrieveProjectKnowledge([hinted], baseRequest());

    // then (read-only hint, never scoped truth)
    expect(result.ranked.length).toBe(1);
    expect(result.ranked[0]?.scopeNote).toBe("hint-only");
    expect(result.budget.text).toContain("hint-only");
  });

  it("#given a secret-bearing claim #when retrieval runs #then it is purged", () => {
    // given (M06 read path: defense in depth past the write and load gates)
    const clean = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    const tainted: ProjectKnowledgeRecord = {
      ...mustCreate("The gateway backoff schedule honors jitter.", "src/other.ts"),
      claim: "The deploy token=fake-test-value-123 lives in config.",
    };

    // when
    const result = retrieveProjectKnowledge([clean, tainted], baseRequest());

    // then
    expect(result.purgedSecretIds).toEqual([tainted.id]);
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([clean.id]);
    expect(result.budget.text.includes("fake-test-value-123")).toBe(false);
  });

  it("#given no query texts #when retrieval runs #then nothing ranks", () => {
    // given
    const record = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");

    // when
    const result = retrieveProjectKnowledge([record], { ...baseRequest(), queryTexts: [] });

    // then (no relevance evidence, no injection)
    expect(result.ranked).toEqual([]);
  });

  it("#given relevant and irrelevant records #when retrieval runs #then only relevant ranks", () => {
    // given
    const relevant = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    const irrelevant = mustCreate("The treasury ledger balances every midnight.", "src/ledger.ts");

    // when
    const result = retrieveProjectKnowledge(
      [relevant, irrelevant],
      { ...baseRequest(), queryTexts: ["gateway retries requests"] },
    );

    // then
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([relevant.id]);
  });

  it("#given a surfaced path #when retrieval runs #then it never repeats", () => {
    // given
    const record = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");

    // when
    const result = retrieveProjectKnowledge(
      [record],
      { ...baseRequest(), surfacedPaths: new Set([recordFilePath(record.id)]) },
    );

    // then
    expect(result.ranked).toEqual([]);
  });

  it("#given ranked records #when the block builds #then it carries the header and provenance", () => {
    // given
    const record = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");

    // when
    const result = retrieveProjectKnowledge([record], baseRequest());

    // then (INV-09 provenance triple + category, INV-11 header)
    expect(result.budget.text.startsWith(UNTRUSTED_MEMORY_HEADER)).toBe(true);
    expect(result.budget.text).toContain(record.id);
    expect(result.budget.text).toContain("unverified-hypothesis");
    expect(result.budget.text).toContain("src/gateway.ts");
    expect(result.budget.text).toContain(record.sourceRevision.slice(0, 12));
  });
});
