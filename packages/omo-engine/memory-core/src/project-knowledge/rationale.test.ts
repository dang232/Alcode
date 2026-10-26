import { describe, expect, it } from "bun:test";
import {
  createRecord,
  parseRecordFile,
  recordFilePath,
  renderRecordFile,
  type NewKnowledgeInput,
  type ProjectKnowledgeRecord,
  type RationaleKind,
} from "./record";
import { evaluatePromotion, evaluateRationalePromotion, type HeadTreeProbe } from "./validator";

const PROJECT_A = "demo-12345678";
const REVISION_A = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const VALIDATED_AT = "2026-10-02T00:00:00.000Z";

const KINDS: readonly RationaleKind[] = [
  "purpose",
  "design-intent",
  "invariant",
  "hazard",
  "history",
  "cross-reference",
  "verification-ref",
];

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

function mustCreate(input: NewKnowledgeInput): ProjectKnowledgeRecord {
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

describe("project-knowledge rationale metadata", () => {
  it("#given a pre-rationale file #when it loads #then it parses with rationale undefined", () => {
    // given (field 17 is additive: old files carry no pk-rationale key)
    const record = mustCreate(baseInput());
    const content = renderRecordFile(record);
    expect(content).not.toContain("pk-rationale");

    // when
    const parsed = parseRecordFile(recordFilePath(record.id), content);

    // then (old records parse unchanged)
    expect(parsed.kind).toBe("record");
    if (parsed.kind === "record") {
      expect(parsed.record.rationale).toBeUndefined();
      expect(parsed.record).toEqual(record);
    }
  });

  it("#given model-generated notes #when a record is created #then standing defaults to unverified-hypothesis", () => {
    // when
    const record = mustCreate({
      ...baseInput(),
      rationale: {
        notes: [
          { kind: "purpose", text: "Retry aloud so operators see the policy.", confidence: 0.8 },
          { kind: "hazard", text: "Non-idempotent routes must bypass this path.", confidence: 0.7 },
        ],
      },
    });

    // then (entry state for explanations, never verified fact)
    expect(record.rationale?.notes).toEqual([
      { kind: "purpose", text: "Retry aloud so operators see the policy.", standing: "unverified-hypothesis", confidence: 0.8 },
      { kind: "hazard", text: "Non-idempotent routes must bypass this path.", standing: "unverified-hypothesis", confidence: 0.7 },
    ]);
  });

  it("#given a verified standing at entry #when a record is created #then the write is refused", () => {
    // when (a model-generated explanation must never enter as verified fact)
    const result = createRecord({
      ...baseInput(),
      rationale: {
        notes: [{ kind: "purpose", text: "Retry aloud.", confidence: 0.9, standing: "source-verified" }],
      },
    });

    // then
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toBe("invalid-rationale-standing");
  });

  it("#given every rationale kind #when a record renders and parses #then it round-trips", () => {
    // given (stored notes may hold verified standing after their own promotion)
    const record = mustCreate(baseInput());
    const withRationale: ProjectKnowledgeRecord = {
      ...record,
      category: "source-verified",
      validatedAt: VALIDATED_AT,
      rationale: {
        notes: KINDS.map((kind, index) => ({
          kind,
          text: `Rationale note for ${kind}.`,
          standing: "source-verified" as const,
          confidence: 0.6 + index * 0.05,
        })),
      },
    };

    // when
    const parsed = parseRecordFile(recordFilePath(withRationale.id), renderRecordFile(withRationale));

    // then
    expect(parsed.kind).toBe("record");
    if (parsed.kind === "record") expect(parsed.record).toEqual(withRationale);
  });

  it("#given an unverified rationale note #when promotion is evaluated #then the record stays hypothesis", () => {
    // given (evidence that would otherwise promote: pinned probe, method set,
    // confidence above 0.5, secret scan clean)
    const record = mustCreate({
      ...baseInput(),
      rationale: { notes: [{ kind: "design-intent", text: "Retries stay idempotent-only.", confidence: 0.8 }] },
    });

    // when
    const result = evaluatePromotion(record, { probe: headProbe(record), secretClean: true }, VALIDATED_AT);

    // then (the explanation cannot ride the claim's probe into verified fact)
    expect(result.outcome).toBe("stays-hypothesis");
    expect(result.failedChecks).toEqual(["rationale-unverified"]);
  });

  it("#given a working-tree probe #when rationale promotion is evaluated #then it is refused", () => {
    // given
    const record = mustCreate({
      ...baseInput(),
      rationale: { notes: [{ kind: "invariant", text: "Backoff caps at thirty seconds.", confidence: 0.8 }] },
    });
    const note = record.rationale?.notes[0];
    if (note === undefined) throw new Error("fixture missing rationale note");

    // when
    const result = evaluateRationalePromotion(note, {
      probe: { ...headProbe(record), source: "working-tree" },
      secretClean: true,
    });

    // then
    expect(result.outcome).toBe("refused-working-tree");
    expect(result.note.standing).toBe("unverified-hypothesis");
  });

  it("#given verified notes #when promotion is evaluated #then the record can promote", () => {
    // given (notes verify first on their own evidence, then the record gate holds)
    const record = mustCreate({
      ...baseInput(),
      rationale: { notes: [{ kind: "purpose", text: "Retry aloud so operators see the policy.", confidence: 0.8 }] },
    });
    const note = record.rationale?.notes[0];
    if (note === undefined) throw new Error("fixture missing rationale note");
    const promotedNote = evaluateRationalePromotion(
      note,
      { probe: headProbe(record), secretClean: true },
    );
    expect(promotedNote.outcome).toBe("promoted");
    const ready: ProjectKnowledgeRecord = {
      ...record,
      rationale: { notes: [promotedNote.note] },
    };

    // when
    const result = evaluatePromotion(ready, { probe: headProbe(ready), secretClean: true }, VALIDATED_AT);

    // then
    expect(result.outcome).toBe("promoted");
    expect(result.record.category).toBe("source-verified");
  });

  it("#given a malformed rationale key #when it loads #then it is dropped", () => {
    // given (valid YAML scalar, invalid rationale JSON)
    const seeded = mustCreate({
      ...baseInput(),
      rationale: { notes: [{ kind: "purpose", text: "Retry aloud.", confidence: 0.8 }] },
    });
    const content = renderRecordFile(seeded).replace(/^pk-rationale: .*$/m, "pk-rationale: just-a-string");

    // when
    const parsed = parseRecordFile(recordFilePath(seeded.id), content);

    // then
    expect(parsed.kind).toBe("dropped");
    if (parsed.kind === "dropped") expect(parsed.reason).toBe("malformed-rationale");
  });
});
