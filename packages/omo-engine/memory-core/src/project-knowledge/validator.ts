/**
 * Project-knowledge validator: decidable promotion/demotion, stale handling,
 * and the ten section 6 invalidation cases.
 *
 * Every transition is a pure function of stored fields plus one live HEAD-tree
 * probe supplied by the caller. The probe must come from the committed tree at
 * a pinned sha: a dirty working tree can never promote, demote, or revalidate
 * (INV-22), and promotion never follows model assertion without probe evidence
 * (INV-03). Freshness verdicts for the DAG consume these results; this module
 * claims no scheduling or verification authority of its own (H1, H4).
 */

import {
  STALE_AFTER_MS,
  computeFingerprint,
  type InvalidationCase,
  type ProjectKnowledgeRecord,
} from "./record";

/**
 * Evidence for one validation decision. `revision` is the pinned sha the
 * probe ran at; `blobSha256` is the file blob sha at that revision (`null`
 * when the file is absent from the HEAD tree).
 */
export interface HeadTreeProbe {
  readonly source: "head-tree" | "working-tree";
  readonly revision: string;
  readonly symbolResolved: boolean;
  readonly blobSha256: string | null;
  readonly revisionReachable: boolean;
}

export interface PromotionEvidence {
  readonly probe: HeadTreeProbe;
  readonly secretClean: boolean;
}

export type PromotionOutcome = "promoted" | "stays-hypothesis" | "refused-working-tree";

export interface PromotionResult {
  readonly outcome: PromotionOutcome;
  readonly record: ProjectKnowledgeRecord;
  readonly failedChecks: readonly string[];
}

/**
 * Section 2 promotion (entry state and re-promotion alike). ALL hold or the
 * record stays: (a) the probe ran at the pinned `sourceRevision`; (b) the
 * blob sha256 reproduces the stored fingerprint; (c) `validationMethod` is
 * not `none`; (d) `confidence` exceeds 0.5; (e) the secret scan is clean.
 */
export function evaluatePromotion(
  record: ProjectKnowledgeRecord,
  evidence: PromotionEvidence,
  validatedAt: string,
): PromotionResult {
  if (evidence.probe.source !== "head-tree") {
    return { outcome: "refused-working-tree", record, failedChecks: ["working-tree"] };
  }
  if (record.category !== "unverified-hypothesis" && record.category !== "previously-verified") {
    return { outcome: "stays-hypothesis", record, failedChecks: ["category-not-promotable"] };
  }
  const failedChecks: string[] = [];
  if (evidence.probe.revision !== record.sourceRevision) failedChecks.push("revision-not-pinned");
  if (!evidence.probe.symbolResolved) failedChecks.push("symbol-unresolved");
  if (evidence.probe.blobSha256 === null) {
    failedChecks.push("source-absent");
  } else if (computeFingerprint(record.sourceRevision, evidence.probe.blobSha256) !== record.fingerprint) {
    failedChecks.push("fingerprint-mismatch");
  }
  if (record.validationMethod === "none") failedChecks.push("method-none");
  if (!(record.confidence > 0.5)) failedChecks.push("confidence");
  if (!evidence.secretClean) failedChecks.push("secret");
  if (failedChecks.length > 0) return { outcome: "stays-hypothesis", record, failedChecks };
  return {
    outcome: "promoted",
    record: { ...record, category: "source-verified", validatedAt },
    failedChecks,
  };
}

export interface FreshnessResult {
  readonly demoted: boolean;
  readonly record: ProjectKnowledgeRecord;
  readonly appliedCase: "HEAD-MOVE" | "EVID-STALE" | null;
}

function validatedAgeMs(record: ProjectKnowledgeRecord, nowMs: number): number | undefined {
  if (record.validatedAt === undefined) return undefined;
  const parsed = Date.parse(record.validatedAt);
  return Number.isNaN(parsed) ? undefined : nowMs - parsed;
}

/**
 * Section 2 demotion (INV-14): a `source-verified` record demotes to
 * `previously-verified` when HEAD moved past `sourceRevision` or the evidence
 * is older than 7 days. Decided by comparing two strings and two timestamps;
 * no judgment call. A verified record with no `validatedAt` demotes
 * fail-closed (absent validation time can never prove freshness).
 */
export function evaluateFreshness(
  record: ProjectKnowledgeRecord,
  headRevision: string,
  nowMs: number,
): FreshnessResult {
  if (record.category !== "source-verified") return { demoted: false, record, appliedCase: null };
  const moved = headRevision !== record.sourceRevision;
  const age = validatedAgeMs(record, nowMs);
  const stale = age === undefined || age > STALE_AFTER_MS;
  if (!moved && !stale) return { demoted: false, record, appliedCase: null };
  return {
    demoted: true,
    record: { ...record, category: "previously-verified" },
    appliedCase: moved ? "HEAD-MOVE" : "EVID-STALE",
  };
}

/**
 * Refresh the content binding for revalidation at a new HEAD. Returns
 * `undefined` when the new binding is malformed, so malformed input can never
 * fabricate a passing fingerprint.
 */
export function reobserveForRevalidation(
  record: ProjectKnowledgeRecord,
  revision: string,
  blobSha256: string,
): ProjectKnowledgeRecord | undefined {
  if (!/^[0-9a-f]{40}$/.test(revision) || !/^[0-9a-f]{64}$/.test(blobSha256)) return undefined;
  return { ...record, sourceRevision: revision, fingerprint: computeFingerprint(revision, blobSha256) };
}

export interface InvalidationInput {
  readonly probe: HeadTreeProbe;
  /** HEAD sha the records were loaded from. */
  readonly headRevision: string;
  readonly nowMs: number;
  /** `rg <sourceSymbol>` hit count in `sourceFile` while the file exists. */
  readonly symbolHits: number;
  /** A rename-candidate probe resolved the symbol elsewhere. */
  readonly renameResolved: boolean;
  readonly requestingRunScope?: string;
  readonly nodeWriteScopes: readonly string[];
  readonly secretFound: boolean;
  /** A newer record with `supersedes = this.id` completed validation. */
  readonly successorValidated: boolean;
}

export type RecordDisposition = "SUPERSEDED" | "REVALIDATED" | "FILTERED" | "UNCHANGED";

export interface InvalidationResult {
  readonly disposition: RecordDisposition;
  readonly record: ProjectKnowledgeRecord;
  readonly appliedCase: InvalidationCase | null;
  readonly refusedWorkingTree: boolean;
}

function scopesDisjoint(record: ProjectKnowledgeRecord, nodeWriteScopes: readonly string[]): boolean {
  if (record.scope.writeScopes.length === 0) return false;
  const node = new Set(nodeWriteScopes);
  return record.scope.writeScopes.every((entry) => !node.has(entry));
}

/**
 * Section 6 invalidation. Priority order is part of the contract: secrets and
 * broken provenance supersede immediately; per-request filters (environment,
 * scope) never change state; deletions and renames without a hit supersede;
 * edits, HEAD moves, and stale evidence revalidate; anything else is
 * unchanged. `FILTERED` means hidden from this request only (no mark, no
 * revalidation).
 */
export function evaluateInvalidation(
  record: ProjectKnowledgeRecord,
  input: InvalidationInput,
): InvalidationResult {
  // INV-22: a dirty working tree triggers nothing.
  if (input.probe.source !== "head-tree") {
    return { disposition: "UNCHANGED", record, appliedCase: null, refusedWorkingTree: true };
  }
  if (input.secretFound) {
    return {
      disposition: "SUPERSEDED",
      record: { ...record, category: "superseded" },
      appliedCase: "SECRET-FOUND",
      refusedWorkingTree: false,
    };
  }
  if (!input.probe.revisionReachable) {
    return {
      disposition: "SUPERSEDED",
      record: { ...record, category: "superseded" },
      appliedCase: "PROV-BREAK",
      refusedWorkingTree: false,
    };
  }
  // Terminal: no promotion out of `superseded`, ever.
  if (record.category === "superseded") {
    return { disposition: "UNCHANGED", record, appliedCase: null, refusedWorkingTree: false };
  }
  if (record.scope.runScope !== undefined && input.requestingRunScope !== record.scope.runScope) {
    return { disposition: "FILTERED", record, appliedCase: "ENV-CHANGE", refusedWorkingTree: false };
  }
  if (input.successorValidated) {
    return {
      disposition: "SUPERSEDED",
      record: { ...record, category: "superseded" },
      appliedCase: "SUPERSEDE-CHAIN",
      refusedWorkingTree: false,
    };
  }
  if (input.probe.blobSha256 === null) {
    return {
      disposition: "SUPERSEDED",
      record: { ...record, category: "superseded" },
      appliedCase: "SRC-DELETE",
      refusedWorkingTree: false,
    };
  }
  if (input.symbolHits === 0) {
    if (!input.renameResolved) {
      return {
        disposition: "SUPERSEDED",
        record: { ...record, category: "superseded" },
        appliedCase: "SYM-RENAME",
        refusedWorkingTree: false,
      };
    }
    return { disposition: "REVALIDATED", record, appliedCase: "SYM-RENAME", refusedWorkingTree: false };
  }
  if (computeFingerprint(record.sourceRevision, input.probe.blobSha256) !== record.fingerprint) {
    return { disposition: "REVALIDATED", record, appliedCase: "SRC-EDIT", refusedWorkingTree: false };
  }
  if (input.headRevision !== record.sourceRevision) {
    const demoted =
      record.category === "source-verified" ? { ...record, category: "previously-verified" as const } : record;
    return { disposition: "REVALIDATED", record: demoted, appliedCase: "HEAD-MOVE", refusedWorkingTree: false };
  }
  // EVID-STALE needs evidence of an age: a record that was never validated
  // has no evidence clock to expire (unlike freshness demotion, which treats
  // a verified record without `validatedAt` as fail-closed stale).
  const age = validatedAgeMs(record, input.nowMs);
  if (age !== undefined && age > STALE_AFTER_MS) {
    const demoted =
      record.category === "source-verified" ? { ...record, category: "previously-verified" as const } : record;
    return { disposition: "REVALIDATED", record: demoted, appliedCase: "EVID-STALE", refusedWorkingTree: false };
  }
  if (scopesDisjoint(record, input.nodeWriteScopes)) {
    return { disposition: "FILTERED", record, appliedCase: "SCOPE-NARROW", refusedWorkingTree: false };
  }
  return { disposition: "UNCHANGED", record, appliedCase: null, refusedWorkingTree: false };
}
