/**
 * Adversarial lifecycle cases for project knowledge (M05, M07, M11, M18).
 *
 * Project-switch (G2) ground stays in project-switch.test.ts and is not
 * re-proven here; the M15 same-path rewrite case stays in validator.test.ts.
 */
import { describe, expect, it } from "bun:test";
import {
  computeRecordId,
  createRecord,
  ProjectKnowledgeStore,
  type NewKnowledgeInput,
  type ProjectKnowledgeRecord,
} from "./record";
import {
  evaluateFreshness,
  evaluateInvalidation,
  evaluatePromotion,
  reobserveForRevalidation,
  type HeadTreeProbe,
  type PromotionEvidence,
} from "./validator";
import { retrieveProjectKnowledge, type RetrievalRequest } from "./retrieve";
import { commitSupersedeBatch, planSupersedeBatch } from "./supersede";

const PROJECT = "demo-12345678";
const REVISION_A = "a".repeat(40);
const REVISION_B = "c".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const VALIDATED_AT = "2026-10-02T00:00:00.000Z";
const REPROMOTED_AT = "2026-10-03T00:00:00.000Z";

function baseInput(claim: string, sourceFile: string): NewKnowledgeInput {
  return {
    projectId: PROJECT,
    claim,
    sourceFile,
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
  const result = createRecord(baseInput(claim, sourceFile));
  if (result.kind === "refused") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

function headProbe(revision: string, blobSha256: string): HeadTreeProbe {
  return {
    source: "head-tree",
    revision,
    symbolResolved: true,
    blobSha256,
    revisionReachable: true,
  };
}

function evidenceFor(record: ProjectKnowledgeRecord, blobSha256: string): PromotionEvidence {
  return {
    probe: headProbe(record.sourceRevision, blobSha256),
    secretClean: true,
  };
}

function baseRequest(queryTexts: readonly string[]): RetrievalRequest {
  return {
    projectId: PROJECT,
    queryTexts,
    nodeWriteScopes: ["memory"],
    nowMs: Date.parse(VALIDATED_AT),
  };
}

describe("project-knowledge lifecycle adversarial", () => {
  it("#given a record pinned to sha A #when HEAD is sha B on another branch #then it is not served as current truth without revalidation", () => {
    // given (M05: the file is untouched on the new branch, so only the pin is stale)
    const record = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    const promoted = evaluatePromotion(record, evidenceFor(record, BLOB_A), VALIDATED_AT);
    if (promoted.outcome !== "promoted") throw new Error("fixture promotion failed");
    const verified = promoted.record;
    expect(verified.category).toBe("source-verified");

    // when (HEAD moves to B with no revalidation)
    const stale = evaluateFreshness(verified, REVISION_B, Date.parse(VALIDATED_AT));
    const probeAtB = headProbe(REVISION_B, BLOB_A);
    const invalidated = evaluateInvalidation(verified, {
      probe: probeAtB,
      headRevision: REVISION_B,
      nowMs: Date.parse(VALIDATED_AT),
      symbolHits: 1,
      renameResolved: false,
      nodeWriteScopes: ["memory"],
      secretFound: false,
      successorValidated: false,
    });

    // then (the pin no longer proves current truth)
    expect(stale.demoted).toBe(true);
    expect(stale.appliedCase).toBe("HEAD-MOVE");
    expect(stale.record.category).toBe("previously-verified");
    expect(invalidated.disposition).toBe("REVALIDATED");
    expect(invalidated.appliedCase).toBe("HEAD-MOVE");

    // and (re-promotion at B without reobserving is refused)
    const retry = evaluatePromotion(stale.record, { probe: probeAtB, secretClean: true }, REPROMOTED_AT);
    expect(retry.outcome).toBe("stays-hypothesis");
    expect(retry.failedChecks).toContain("revision-not-pinned");

    // and (retrieval serves the demoted record as stale, never as verified truth)
    const served = retrieveProjectKnowledge([stale.record], baseRequest(["gateway retries requests"]));
    expect(served.ranked.map((entry) => entry.record.id)).toEqual([verified.id]);
    expect(served.ranked[0]?.record.category).toBe("previously-verified");

    // but (the revalidation path restores truth at B)
    const reobserved = reobserveForRevalidation(stale.record, REVISION_B, BLOB_A);
    if (reobserved === undefined) throw new Error("fixture reobserve failed");
    const repromoted = evaluatePromotion(reobserved, { probe: probeAtB, secretClean: true }, REPROMOTED_AT);
    expect(repromoted.outcome).toBe("promoted");
    expect(repromoted.record.sourceRevision).toBe(REVISION_B);
  });

  it("#given two sessions in one project #when each retrieves #then neither confirms its own hypothesis", () => {
    // given (M07: both hypotheses are live in the same project)
    const hypothesisA = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    const hypothesisB = mustCreate("The gateway retry budget refreshes hourly.", "src/billing.ts");
    const request = baseRequest(["gateway retry budget requests"]);
    const baseline = retrieveProjectKnowledge([hypothesisA, hypothesisB], request);

    // when (each session excludes only its own uncommitted records)
    const viewA = retrieveProjectKnowledge(
      [hypothesisA, hypothesisB],
      { ...request, excludeSessionRecordIds: new Set([hypothesisA.id]) },
    );
    const viewB = retrieveProjectKnowledge(
      [hypothesisA, hypothesisB],
      { ...request, excludeSessionRecordIds: new Set([hypothesisB.id]) },
    );

    // then (own-session exclusion holds in both directions)
    expect(baseline.ranked.map((entry) => entry.record.id).sort()).toEqual(
      [hypothesisA.id, hypothesisB.id].sort(),
    );
    expect(viewA.ranked.map((entry) => entry.record.id)).toEqual([hypothesisB.id]);
    expect(viewB.ranked.map((entry) => entry.record.id)).toEqual([hypothesisA.id]);
  });

  it("#given two records asserting against each other #when the newer verifies #then only the newer serves as truth", () => {
    // given (M11: the older claim is verified truth first)
    const store = new ProjectKnowledgeStore();
    const predecessor = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    store.insert(predecessor);
    const firstPromotion = evaluatePromotion(predecessor, evidenceFor(predecessor, BLOB_A), VALIDATED_AT);
    if (firstPromotion.outcome !== "promoted") throw new Error("fixture promotion failed");
    store.replace(firstPromotion.record);

    // when (a newer record asserts against it and verifies in one batch)
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");
    const chained: ProjectKnowledgeRecord = { ...successor, supersedes: predecessor.id };
    const planned = planSupersedeBatch(store, chained, predecessor.id, evidenceFor(chained, BLOB_A), REPROMOTED_AT);
    if (planned.kind === "refused") throw new Error(`fixture plan refused: ${planned.reason}`);
    const committed = commitSupersedeBatch(store, planned.plan);
    if (committed.kind === "refused") throw new Error(`fixture commit refused: ${committed.reason}`);

    // then (the conflict resolves to exactly one truth; no silent coexistence)
    expect(committed.successor.category).toBe("source-verified");
    expect(committed.predecessor.category).toBe("superseded");
    expect(store.get(predecessor.id)).toBeUndefined();
    expect(store.getForAudit(predecessor.id)?.category).toBe("superseded");
    const served = retrieveProjectKnowledge(store.eligible(), baseRequest(["gateway retries idempotent requests"]));
    expect(served.ranked.map((entry) => entry.record.id)).toEqual([chained.id]);
  });

  it("#given the same verified fact recorded twice #when it commits #then the identity is stable and the chain stays intact", () => {
    // given (M18: byte-identical inputs)
    const first = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    const second = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    expect(second.id).toBe(first.id);
    expect(
      computeRecordId("src/gateway.ts", "fn:retry", "The gateway retries idempotent requests three times."),
    ).toBe(first.id);

    // when (both commits land in one store)
    const store = new ProjectKnowledgeStore();
    const firstInsert = store.insert(first);
    const secondInsert = store.insert(second);

    // then (no uncontrolled duplicate)
    expect(firstInsert).toBe(true);
    expect(secondInsert).toBe(false);
    expect(store.count()).toBe(1);

    // and (the supersession chain stays intact when the fact is later replaced)
    const promotion = evaluatePromotion(first, evidenceFor(first, BLOB_A), VALIDATED_AT);
    if (promotion.outcome !== "promoted") throw new Error("fixture promotion failed");
    store.replace(promotion.record);
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");
    const chained: ProjectKnowledgeRecord = { ...successor, supersedes: first.id };
    const planned = planSupersedeBatch(store, chained, first.id, evidenceFor(chained, BLOB_A), REPROMOTED_AT);
    if (planned.kind === "refused") throw new Error(`fixture plan refused: ${planned.reason}`);
    const committed = commitSupersedeBatch(store, planned.plan);
    if (committed.kind === "refused") throw new Error(`fixture commit refused: ${committed.reason}`);
    const rerecorded = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    expect(store.insert(rerecorded)).toBe(false);
    expect(store.get(rerecorded.id)).toBeUndefined();
    expect(store.getForAudit(rerecorded.id)?.category).toBe("superseded");
    expect(store.eligible().map((record) => record.id)).toEqual([chained.id]);
  });
});
