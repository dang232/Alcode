import { describe, expect, it } from "bun:test";
import {
  createRecord,
  parseRecordFile,
  recordFilePath,
  renderRecordFile,
  ProjectKnowledgeStore,
  type NewKnowledgeInput,
  type ProjectKnowledgeRecord,
} from "./record";

const PROJECT_A = "demo-12345678";
const REVISION_A = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";

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

function mustCreate(claim: string): ProjectKnowledgeRecord {
  const result = createRecord({ ...baseInput(), claim });
  if (result.kind === "refused") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

describe("project-knowledge record store", () => {
  it("#given a file missing the fingerprint #when it loads #then it is dropped and counted", () => {
    // given
    const record = mustCreate("The gateway retries idempotent requests three times.");
    const content = renderRecordFile(record).replace(/^pk-fingerprint: .*\n/m, "");

    // when
    const parsed = parseRecordFile(recordFilePath(record.id), content);

    // then
    expect(parsed.kind).toBe("dropped");
    if (parsed.kind === "dropped") expect(parsed.reason).toBe("missing-field");
  });

  it("#given a branch name as revision #when it loads #then it is dropped", () => {
    // given
    const record = mustCreate("The gateway retries idempotent requests three times.");
    const content = renderRecordFile(record).replace(REVISION_A, "main");

    // when
    const parsed = parseRecordFile(recordFilePath(record.id), content);

    // then (field 7: never a branch name)
    expect(parsed.kind).toBe("dropped");
  });

  it("#given no frontmatter #when it loads #then it is dropped", () => {
    // when
    const parsed = parseRecordFile("project-knowledge/pk-abcdef012345.md", "no frontmatter here\n");

    // then
    expect(parsed.kind).toBe("dropped");
  });

  it("#given evidence of high confidence #when a record is created #then it still starts unverified-hypothesis", () => {
    // given (M02: a new record claims strength at write time)
    const input = { ...baseInput(), validationMethod: "test-pass" as const, confidence: 0.95 };

    // when
    const result = createRecord(input);

    // then (INV-02: entry state, never higher)
    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.record.category).toBe("unverified-hypothesis");
      expect(result.record.validatedAt).toBeUndefined();
    }
  });

  it("#given a missing source link #when it loads #then it is dropped", () => {
    // given (M10: provenance missing)
    const record = mustCreate("The gateway retries idempotent requests three times.");
    const content = renderRecordFile(record).replace(/^pk-source-file: .*\n/m, "");

    // when
    const parsed = parseRecordFile(recordFilePath(record.id), content);

    // then
    expect(parsed.kind).toBe("dropped");
  });

  it("#given corrupt scope JSON #when it loads #then it is dropped", () => {
    // given (M17: index corruption)
    const record = mustCreate("The gateway retries idempotent requests three times.");
    const content = renderRecordFile(record).replace(/^pk-write-scopes: .*$/m, "pk-write-scopes: [broken");

    // when
    const parsed = parseRecordFile(recordFilePath(record.id), content);

    // then
    expect(parsed.kind).toBe("dropped");
  });

  it("#given a tampered id #when it loads #then it is dropped", () => {
    // given (field 1: identity is recomputed, never user-supplied)
    const record = mustCreate("The gateway retries idempotent requests three times.");
    const content = renderRecordFile(record).replace(/^pk-id: .*$/m, "pk-id: pk-000000000000");

    // when
    const parsed = parseRecordFile(recordFilePath(record.id), content);

    // then
    expect(parsed.kind).toBe("dropped");
    if (parsed.kind === "dropped") expect(parsed.reason).toBe("id-mismatch");
  });

  it("#given a secret-like claim #when a record is created #then the write is refused", () => {
    // given (M06 write path)
    const input = { ...baseInput(), claim: "The deploy token=fake-test-value-123 lives in config." };

    // when
    const result = createRecord(input);

    // then (INV-06: no partial record persists)
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toBe("secret-found");
  });

  it("#given a secret-bearing file #when committed files load #then it is purged and counted", () => {
    // given (M06 read path at the store boundary)
    const record = mustCreate("The gateway retries idempotent requests three times.");
    const clean = renderRecordFile(record);
    const tainted = clean.replace(
      "The gateway retries idempotent requests three times.",
      "The deploy token=fake-test-value-123 lives in config.",
    );
    const store = new ProjectKnowledgeStore();

    // when
    const summary = store.loadCommitted([
      { path: recordFilePath(record.id), content: clean },
      { path: "project-knowledge/pk-ffffffffffff.md", content: tainted },
    ]);

    // then
    expect(summary.loaded).toBe(1);
    expect(summary.dropped).toBe(1);
    expect(summary.secretPurged).toBe(1);
    expect(store.count()).toBe(1);
  });

  it("#given an empty condition list #when a record is created #then the write is refused", () => {
    // when
    const result = createRecord({ ...baseInput(), invalidationConditions: [] });

    // then (a record with no invalidation conditions is rejected at write)
    expect(result.kind).toBe("refused");
  });

  it("#given an unknown condition #when a record is created #then the write is refused", () => {
    // when
    const result = createRecord({ ...baseInput(), invalidationConditions: ["MADE-UP"] });

    // then
    expect(result.kind).toBe("refused");
  });

  it("#given a valid record #when it renders and parses #then it round-trips", () => {
    // given
    const record = mustCreate("The gateway retries idempotent requests three times.");

    // when
    const parsed = parseRecordFile(recordFilePath(record.id), renderRecordFile(record));

    // then
    expect(parsed.kind).toBe("record");
    if (parsed.kind === "record") expect(parsed.record).toEqual(record);
  });

  it("#given a reload #when committed files load #then prior state is replaced", () => {
    // given
    const first = mustCreate("The gateway retries idempotent requests three times.");
    const store = new ProjectKnowledgeStore();
    store.loadCommitted([{ path: recordFilePath(first.id), content: renderRecordFile(first) }]);

    // when (restart carries nothing over; the new HEAD tree is the whole state)
    const second = mustCreate("The ledger balances every treasury transfer nightly.");
    const summary = store.loadCommitted([{ path: recordFilePath(second.id), content: renderRecordFile(second) }]);

    // then
    expect(summary.loaded).toBe(1);
    expect(store.get(first.id)).toBeUndefined();
    expect(store.get(second.id)).toEqual(second);
  });
});
