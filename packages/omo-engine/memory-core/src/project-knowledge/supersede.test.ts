import { describe, expect, it } from "bun:test";
import { createRecord, ProjectKnowledgeStore, type NewKnowledgeInput, type ProjectKnowledgeRecord } from "./record";
import { retrieveProjectKnowledge } from "./retrieve";
import { commitSupersedeBatch, planSupersedeBatch } from "./supersede";
import { reobserveForRevalidation, type PromotionEvidence } from "./validator";

const PROJECT_A = "demo-12345678";
const REVISION_A = "a".repeat(40);
const REVISION_B = "c".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const VALIDATED_AT = "2026-10-02T00:00:00.000Z";
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");

function baseInput(claim: string, sourceFile: string): NewKnowledgeInput {
  return {
    projectId: PROJECT_A,
    claim,
    sourceFile,
    sourceSymbol: "fn:retry",
    sourceRevision: REVISION_A,
    sourceBlobSha256: BLOB_A,
    observedAt: OBSERVED_AT,
    validationMethod: "rg-resolve",
    confidence: 0.9,
    scope: { writeScopes: ["memory"] },
    invalidationConditions: ["SRC-EDIT", "SUPERSEDE-CHAIN"],
  };
}

function mustCreate(claim: string, sourceFile: string): ProjectKnowledgeRecord {
  const result = createRecord(baseInput(claim, sourceFile));
  if (result.kind === "refused") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

function evidenceFor(record: ProjectKnowledgeRecord, blobSha256: string): PromotionEvidence {
  return {
    probe: {
      source: "head-tree",
      revision: record.sourceRevision,
      symbolResolved: true,
      blobSha256,
      revisionReachable: true,
    },
    secretClean: true,
  };
}

describe("project-knowledge supersede", () => {
  it("#given a validated successor #when the batch commits #then both records flip together", () => {
    // given (M11: two records assert against each other; the newer wins atomically)
    const store = new ProjectKnowledgeStore();
    const predecessor = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    store.insert(predecessor);
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");
    const chained: ProjectKnowledgeRecord = { ...successor, supersedes: predecessor.id };

    // when
    const planned = planSupersedeBatch(store, chained, predecessor.id, evidenceFor(chained, BLOB_A), VALIDATED_AT);
    if (planned.kind === "refused") throw new Error(`plan refused: ${planned.reason}`);
    const committed = commitSupersedeBatch(store, planned.plan);

    // then (INV-05: successor promotion and predecessor supersede land together)
    expect(committed.kind).toBe("committed");
    if (committed.kind === "committed") {
      expect(committed.successor.category).toBe("source-verified");
      expect(committed.predecessor.category).toBe("superseded");
    }
    expect(store.get(predecessor.id)).toBeUndefined();
    expect(store.getForAudit(predecessor.id)?.category).toBe("superseded");
    expect(store.get(chained.id)?.category).toBe("source-verified");
  });

  it("#given a failing successor #when planning runs #then the store is untouched", () => {
    // given (M05: crash between successor-promote and predecessor-supersede)
    const store = new ProjectKnowledgeStore();
    const predecessor = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    store.insert(predecessor);
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");
    const chained: ProjectKnowledgeRecord = { ...successor, supersedes: predecessor.id };
    const failing = evidenceFor(chained, "e".repeat(64));

    // when (the successor cannot validate, so no batch exists to crash inside)
    const planned = planSupersedeBatch(store, chained, predecessor.id, failing, VALIDATED_AT);

    // then (INV-05: neither promotes nor supersedes)
    expect(planned.kind).toBe("refused");
    expect(store.get(predecessor.id)).toEqual(predecessor);
    expect(store.has(chained.id)).toBe(false);
  });

  it("#given a mid-batch change #when the batch commits #then it refuses without mutating", () => {
    // given (M16: partial invalidation cannot land half-applied)
    const store = new ProjectKnowledgeStore();
    const predecessor = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    store.insert(predecessor);
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");
    const chained: ProjectKnowledgeRecord = { ...successor, supersedes: predecessor.id };
    const planned = planSupersedeBatch(store, chained, predecessor.id, evidenceFor(chained, BLOB_A), VALIDATED_AT);
    if (planned.kind === "refused") throw new Error(`plan refused: ${planned.reason}`);
    store.replace({ ...predecessor, category: "superseded" });

    // when (the predecessor moved under the plan)
    const committed = commitSupersedeBatch(store, planned.plan);

    // then
    expect(committed.kind).toBe("refused");
    expect(store.has(chained.id)).toBe(false);
  });

  it("#given a committed batch #when it commits again #then the replay is refused", () => {
    // given (M18: duplicate updates cannot resurrect or duplicate)
    const store = new ProjectKnowledgeStore();
    const predecessor = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    store.insert(predecessor);
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");
    const chained: ProjectKnowledgeRecord = { ...successor, supersedes: predecessor.id };
    const planned = planSupersedeBatch(store, chained, predecessor.id, evidenceFor(chained, BLOB_A), VALIDATED_AT);
    if (planned.kind === "refused") throw new Error(`plan refused: ${planned.reason}`);
    const first = commitSupersedeBatch(store, planned.plan);
    if (first.kind === "refused") throw new Error(`commit refused: ${first.reason}`);

    // when
    const replayPlan = planSupersedeBatch(store, chained, predecessor.id, evidenceFor(chained, BLOB_A), VALIDATED_AT);
    const replayCommit = commitSupersedeBatch(store, planned.plan);

    // then (INV-18: the superseded id stays terminal)
    expect(replayPlan.kind).toBe("refused");
    expect(replayCommit.kind).toBe("refused");
    expect(store.getForAudit(predecessor.id)?.category).toBe("superseded");
  });

  it("#given a mismatched link #when planning runs #then it is refused", () => {
    // given
    const store = new ProjectKnowledgeStore();
    const predecessor = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    store.insert(predecessor);
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");

    // when (successor.supersedes does not point at the predecessor)
    const planned = planSupersedeBatch(store, successor, predecessor.id, evidenceFor(successor, BLOB_A), VALIDATED_AT);

    // then
    expect(planned.kind).toBe("refused");
    if (planned.kind === "refused") expect(planned.reason).toBe("link-mismatch");
  });

  it("#given a superseded predecessor #when retrieval runs #then only the successor serves", () => {
    // given
    const store = new ProjectKnowledgeStore();
    const predecessor = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    store.insert(predecessor);
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");
    const chained: ProjectKnowledgeRecord = { ...successor, supersedes: predecessor.id };
    const planned = planSupersedeBatch(store, chained, predecessor.id, evidenceFor(chained, BLOB_A), VALIDATED_AT);
    if (planned.kind === "refused") throw new Error(`plan refused: ${planned.reason}`);
    const committed = commitSupersedeBatch(store, planned.plan);
    if (committed.kind === "refused") throw new Error(`commit refused: ${committed.reason}`);

    // when
    const result = retrieveProjectKnowledge(store.eligible(), {
      projectId: PROJECT_A,
      queryTexts: ["gateway retries requests"],
      nodeWriteScopes: ["memory"],
      nowMs: NOW_MS,
    });

    // then
    expect(result.ranked.map((entry) => entry.record.id)).toEqual([committed.successor.id]);
  });

  it("#given malformed reobservation #when it runs #then no binding is fabricated", () => {
    // given
    const record = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");

    // when
    const branchName = reobserveForRevalidation(record, "main", BLOB_A);
    const shortBlob = reobserveForRevalidation(record, REVISION_B, "deadbeef");

    // then (a non-sha can never fabricate a passing fingerprint)
    expect(branchName).toBeUndefined();
    expect(shortBlob).toBeUndefined();
  });
});
