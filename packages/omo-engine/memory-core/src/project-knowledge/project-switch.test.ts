import { describe, expect, it } from "bun:test";
import {
  commitRecord,
  createRecord,
  ProjectKnowledgeStore,
  renderRecordFile,
  recordFilePath,
  type NewKnowledgeInput,
  type ProjectKnowledgeRecord,
} from "./record";
import { retrieveProjectKnowledge, type RetrievalRequest } from "./retrieve";

const PROJECT_A = "demo-12345678";
const PROJECT_B = "other-87654321";
const REVISION_A = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");

function baseInput(projectId: string, claim: string): NewKnowledgeInput {
  return {
    projectId,
    claim,
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

function mustCreate(projectId: string, claim: string): ProjectKnowledgeRecord {
  const result = createRecord(baseInput(projectId, claim));
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

describe("project-knowledge project switch", () => {
  it("#given a write for the active project #when it commits #then it is visible there", () => {
    // given
    const store = new ProjectKnowledgeStore();
    const record = mustCreate(PROJECT_A, "The gateway retries idempotent requests three times.");

    // when
    const committed = commitRecord(store, record, PROJECT_A);

    // then
    expect(committed.kind).toBe("committed");
    const result = retrieveProjectKnowledge(store.eligible(), baseRequest(PROJECT_A));
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([record.id]);
  });

  it("#given a write issued before the switch #when it commits after #then it is refused", () => {
    // given (G2: the write was issued for A but lands after the project switched to B)
    const store = new ProjectKnowledgeStore();
    const record = mustCreate(PROJECT_A, "The gateway retries idempotent requests three times.");

    // when
    const committed = commitRecord(store, record, PROJECT_B);

    // then (never visible to the new project)
    expect(committed.kind).toBe("refused");
    if (committed.kind === "refused") expect(committed.reason).toBe("project-switch");
    const forB = retrieveProjectKnowledge(store.eligible(), baseRequest(PROJECT_B));
    expect(forB.ranked).toEqual([]);
    expect(store.has(record.id)).toBe(false);
  });

  it("#given committed project A records #when the project switches #then B never sees them", () => {
    // given
    const store = new ProjectKnowledgeStore();
    const record = mustCreate(PROJECT_A, "The gateway retries idempotent requests three times.");
    const committed = commitRecord(store, record, PROJECT_A);
    if (committed.kind === "refused") throw new Error(`fixture refused: ${committed.reason}`);
    store.loadCommitted([{ path: recordFilePath(record.id), content: renderRecordFile(record) }]);

    // when (the switch changes only which id retrieval filters by)
    const forB = retrieveProjectKnowledge(store.eligible(), baseRequest(PROJECT_B));
    const forA = retrieveProjectKnowledge(store.eligible(), baseRequest(PROJECT_A));

    // then (the retrieval filter holds across the switch ordering)
    expect(forB.ranked).toEqual([]);
    expect(forA.ranked.map((entry) => entry.record.id)).toEqual([record.id]);
  });

  it("#given a late write rebound to the new project #when it commits #then it stays out of the old project", () => {
    // given
    const store = new ProjectKnowledgeStore();
    const record = mustCreate(PROJECT_B, "The gateway retries idempotent requests five times.");

    // when
    const committed = commitRecord(store, record, PROJECT_B);

    // then
    expect(committed.kind).toBe("committed");
    expect(retrieveProjectKnowledge(store.eligible(), baseRequest(PROJECT_B)).ranked.length).toBe(1);
    expect(retrieveProjectKnowledge(store.eligible(), baseRequest(PROJECT_A)).ranked).toEqual([]);
  });
});
