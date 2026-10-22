import { describe, expect, it } from "bun:test";
import {
  createRecord,
  STALE_AFTER_MS,
  type NewKnowledgeInput,
  type ProjectKnowledgeRecord,
} from "./record";
import {
  evaluateFreshness,
  evaluateInvalidation,
  evaluatePromotion,
  reobserveForRevalidation,
  type HeadTreeProbe,
  type InvalidationInput,
} from "./validator";

const PROJECT_A = "demo-12345678";
const REVISION_A = "a".repeat(40);
const REVISION_B = "c".repeat(40);
const BLOB_A = "b".repeat(64);
const BLOB_B = "d".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const VALIDATED_AT = "2026-10-02T00:00:00.000Z";

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

function mustCreate(overrides?: { claim?: string }): ProjectKnowledgeRecord {
  const input = overrides?.claim === undefined ? baseInput() : { ...baseInput(), claim: overrides.claim };
  const result = createRecord(input);
  if (result.kind === "refused") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

function headProbe(record: ProjectKnowledgeRecord): HeadTreeProbe {
  return {
    source: "head-tree",
    revision: record.sourceRevision,
    symbolResolved: true,
    blobSha256: BLOB_A,
    revisionReachable: true,
  };
}

function invalidationInput(record: ProjectKnowledgeRecord): InvalidationInput {
  return {
    probe: headProbe(record),
    headRevision: record.sourceRevision,
    nowMs: Date.parse(VALIDATED_AT),
    symbolHits: 1,
    renameResolved: false,
    nodeWriteScopes: ["memory"],
    secretFound: false,
    successorValidated: false,
  };
}

describe("project-knowledge validator", () => {
  it("#given no live probe #when promotion is evaluated #then the record stays hypothesis", () => {
    // given (M03: promotion via assertion without a live rg probe)
    const record = mustCreate();
    const probe: HeadTreeProbe = { ...headProbe(record), symbolResolved: false };

    // when
    const result = evaluatePromotion(record, { probe, secretClean: true }, VALIDATED_AT);

    // then (INV-03: no self-promote)
    expect(result.outcome).toBe("stays-hypothesis");
    expect(result.record.category).toBe("unverified-hypothesis");
  });

  it("#given full probe evidence #when promotion is evaluated #then the record promotes", () => {
    // given
    const record = mustCreate();

    // when
    const result = evaluatePromotion(record, { probe: headProbe(record), secretClean: true }, VALIDATED_AT);

    // then
    expect(result.outcome).toBe("promoted");
    expect(result.failedChecks).toEqual([]);
    expect(result.record.category).toBe("source-verified");
    expect(result.record.validatedAt).toBe(VALIDATED_AT);
  });

  it("#given low confidence #when promotion is evaluated #then the record stays capped", () => {
    // given (confidence <= 0.5 caps at previously-verified, never source-verified)
    const created = createRecord({ ...baseInput(), confidence: 0.5 });
    if (created.kind === "refused") throw new Error(`fixture refused: ${created.reason}`);
    const record = created.record;

    // when
    const result = evaluatePromotion(record, { probe: headProbe(record), secretClean: true }, VALIDATED_AT);

    // then
    expect(result.outcome).toBe("stays-hypothesis");
    expect(result.failedChecks).toContain("confidence");
  });

  it("#given method none #when promotion is evaluated #then the record stays hypothesis", () => {
    // given
    const created = createRecord({ ...baseInput(), validationMethod: "none" });
    if (created.kind === "refused") throw new Error(`fixture refused: ${created.reason}`);

    // when
    const result = evaluatePromotion(created.record, { probe: headProbe(created.record), secretClean: true }, VALIDATED_AT);

    // then
    expect(result.outcome).toBe("stays-hypothesis");
    expect(result.failedChecks).toContain("method-none");
  });

  it("#given a moved HEAD #when freshness is evaluated #then source-verified demotes", () => {
    // given (M14)
    const promoted = evaluatePromotion(mustCreate(), { probe: headProbe(mustCreate()), secretClean: true }, VALIDATED_AT);
    const record = promoted.record;

    // when
    const result = evaluateFreshness(record, REVISION_B, Date.parse(VALIDATED_AT));

    // then (INV-14: no human input)
    expect(result.demoted).toBe(true);
    expect(result.record.category).toBe("previously-verified");
    expect(result.appliedCase).toBe("HEAD-MOVE");
  });

  it("#given week-old evidence #when freshness is evaluated #then source-verified demotes", () => {
    // given
    const created = mustCreate();
    const promoted = evaluatePromotion(created, { probe: headProbe(created), secretClean: true }, VALIDATED_AT);

    // when
    const result = evaluateFreshness(promoted.record, REVISION_A, Date.parse(VALIDATED_AT) + STALE_AFTER_MS + 1);

    // then
    expect(result.demoted).toBe(true);
    expect(result.appliedCase).toBe("EVID-STALE");
  });

  it("#given fresh evidence at HEAD #when freshness is evaluated #then nothing changes", () => {
    // given
    const created = mustCreate();
    const promoted = evaluatePromotion(created, { probe: headProbe(created), secretClean: true }, VALIDATED_AT);

    // when
    const result = evaluateFreshness(promoted.record, REVISION_A, Date.parse(VALIDATED_AT) + STALE_AFTER_MS);

    // then (exactly 7 days is still fresh)
    expect(result.demoted).toBe(false);
    expect(result.appliedCase).toBeNull();
  });

  it("#given rewritten content under the same path #when invalidated #then the record revalidates", () => {
    // given (M15: same path, new blob, old fingerprint)
    const record = mustCreate();
    const probe: HeadTreeProbe = { ...headProbe(record), blobSha256: BLOB_B };

    // when
    const result = evaluateInvalidation(record, { ...invalidationInput(record), probe });

    // then (INV-15: validity binds to the blob sha256, not the path)
    expect(result.disposition).toBe("REVALIDATED");
    expect(result.appliedCase).toBe("SRC-EDIT");
  });

  it("#given a dirty working tree #when any evaluation runs #then it is refused", () => {
    // given (M22)
    const record = mustCreate();
    const probe: HeadTreeProbe = { ...headProbe(record), source: "working-tree" };

    // when
    const promotion = evaluatePromotion(record, { probe, secretClean: true }, VALIDATED_AT);
    const invalidation = evaluateInvalidation(record, { ...invalidationInput(record), probe });

    // then
    expect(promotion.outcome).toBe("refused-working-tree");
    expect(promotion.record).toEqual(record);
    expect(invalidation.refusedWorkingTree).toBe(true);
    expect(invalidation.disposition).toBe("UNCHANGED");
    expect(invalidation.record).toEqual(record);
  });

  it("#given a deleted source file #when invalidated #then the record supersedes", () => {
    // given
    const record = mustCreate();
    const probe: HeadTreeProbe = { ...headProbe(record), blobSha256: null };

    // when
    const result = evaluateInvalidation(record, { ...invalidationInput(record), probe });

    // then
    expect(result.disposition).toBe("SUPERSEDED");
    expect(result.appliedCase).toBe("SRC-DELETE");
    expect(result.record.category).toBe("superseded");
  });

  it("#given a renamed symbol with no hit #when invalidated #then the record supersedes", () => {
    // given
    const record = mustCreate();

    // when
    const result = evaluateInvalidation(record, { ...invalidationInput(record), symbolHits: 0 });

    // then
    expect(result.disposition).toBe("SUPERSEDED");
    expect(result.appliedCase).toBe("SYM-RENAME");
  });

  it("#given a resolved rename #when invalidated #then the record revalidates", () => {
    // given
    const record = mustCreate();

    // when
    const result = evaluateInvalidation(record, { ...invalidationInput(record), symbolHits: 0, renameResolved: true });

    // then
    expect(result.disposition).toBe("REVALIDATED");
    expect(result.appliedCase).toBe("SYM-RENAME");
  });

  it("#given unreachable provenance #when invalidated #then the record supersedes", () => {
    // given
    const record = mustCreate();
    const probe: HeadTreeProbe = { ...headProbe(record), revisionReachable: false };

    // when
    const result = evaluateInvalidation(record, { ...invalidationInput(record), probe });

    // then
    expect(result.disposition).toBe("SUPERSEDED");
    expect(result.appliedCase).toBe("PROV-BREAK");
  });

  it("#given a secret match #when invalidated #then the record supersedes", () => {
    // given
    const record = mustCreate();

    // when
    const result = evaluateInvalidation(record, { ...invalidationInput(record), secretFound: true });

    // then
    expect(result.disposition).toBe("SUPERSEDED");
    expect(result.appliedCase).toBe("SECRET-FOUND");
  });

  it("#given a validated successor #when invalidated #then the record supersedes", () => {
    // given
    const record = mustCreate();

    // when
    const result = evaluateInvalidation(record, { ...invalidationInput(record), successorValidated: true });

    // then
    expect(result.disposition).toBe("SUPERSEDED");
    expect(result.appliedCase).toBe("SUPERSEDE-CHAIN");
  });

  it("#given unchanged evidence #when invalidated #then nothing changes", () => {
    // given
    const record = mustCreate();

    // when
    const result = evaluateInvalidation(record, invalidationInput(record));

    // then
    expect(result.disposition).toBe("UNCHANGED");
    expect(result.appliedCase).toBeNull();
  });

  it("#given a new HEAD #when reobserved and promoted #then the binding refreshes", () => {
    // given (previously-verified re-passes the entry check at the new HEAD)
    const created = mustCreate();
    const promoted = evaluatePromotion(created, { probe: headProbe(created), secretClean: true }, VALIDATED_AT);
    const demoted = evaluateFreshness(promoted.record, REVISION_B, Date.parse(VALIDATED_AT));
    const reobserved = reobserveForRevalidation(demoted.record, REVISION_B, BLOB_B);
    if (reobserved === undefined) throw new Error("fixture reobserve failed");

    // when
    const probe: HeadTreeProbe = {
      source: "head-tree",
      revision: REVISION_B,
      symbolResolved: true,
      blobSha256: BLOB_B,
      revisionReachable: true,
    };
    const result = evaluatePromotion(reobserved, { probe, secretClean: true }, "2026-10-09T00:00:00.000Z");

    // then
    expect(result.outcome).toBe("promoted");
    expect(result.record.sourceRevision).toBe(REVISION_B);
  });
});
