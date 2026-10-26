/**
 * Project-knowledge supersede chains: atomic successor promotion with
 * predecessor supersede (INV-05), and the supersede-visibility guard (INV-18).
 *
 * A batch plans purely first: the successor must validate in the same batch
 * and the predecessor must be live. The commit re-checks every precondition
 * and only then mutates, so a crash or a failed validation can never leave a
 * promoted successor beside a live predecessor (or vice versa). Replaying a
 * `supersedes` link against an already-superseded id is refused.
 */

import type { ProjectKnowledgeRecord } from "./record";
import { evaluatePromotion, type PromotionEvidence } from "./validator";

export interface SupersedeSource {
  get(id: string): ProjectKnowledgeRecord | undefined;
  has(id: string): boolean;
}

export interface SupersedeTarget extends SupersedeSource {
  insert(record: ProjectKnowledgeRecord): boolean;
  replace(record: ProjectKnowledgeRecord): void;
}

export interface SupersedePlan {
  readonly successor: ProjectKnowledgeRecord;
  readonly predecessorId: string;
}

export type SupersedePlanResult =
  | { readonly kind: "planned"; readonly plan: SupersedePlan }
  | { readonly kind: "refused"; readonly reason: string };

export type SupersedeCommitResult =
  | { readonly kind: "committed"; readonly successor: ProjectKnowledgeRecord; readonly predecessor: ProjectKnowledgeRecord }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Section 6 SUPERSEDE-CHAIN: validate the successor and mark the predecessor
 * `superseded` in one batch, or do neither.
 */
export function planSupersedeBatch(
  current: SupersedeSource,
  successorCandidate: ProjectKnowledgeRecord,
  predecessorId: string,
  evidence: PromotionEvidence,
  validatedAt: string,
): SupersedePlanResult {
  if (successorCandidate.supersedes !== predecessorId) return { kind: "refused", reason: "link-mismatch" };
  const predecessor = current.get(predecessorId);
  if (predecessor === undefined) return { kind: "refused", reason: "predecessor-missing" };
  // INV-18: a replayed link against an already-superseded id cannot resurrect it.
  if (predecessor.category === "superseded") return { kind: "refused", reason: "already-superseded" };
  if (current.has(successorCandidate.id)) return { kind: "refused", reason: "duplicate-successor" };
  const promotion = evaluatePromotion(successorCandidate, evidence, validatedAt);
  if (promotion.outcome !== "promoted") {
    return { kind: "refused", reason: `successor-not-valid:${promotion.failedChecks.join(",")}` };
  }
  return { kind: "planned", plan: { successor: promotion.record, predecessorId } };
}

/**
 * All-or-nothing commit: every precondition is re-checked before the first
 * mutation, so a failure between successor-promote and predecessor-supersede
 * is impossible by construction.
 */
export function commitSupersedeBatch(target: SupersedeTarget, plan: SupersedePlan): SupersedeCommitResult {
  const predecessor = target.get(plan.predecessorId);
  if (predecessor === undefined) return { kind: "refused", reason: "predecessor-missing" };
  if (predecessor.category === "superseded") return { kind: "refused", reason: "already-superseded" };
  if (plan.successor.supersedes !== plan.predecessorId) return { kind: "refused", reason: "link-mismatch" };
  if (target.has(plan.successor.id)) return { kind: "refused", reason: "duplicate-successor" };
  if (!target.insert(plan.successor)) return { kind: "refused", reason: "duplicate-successor" };
  const superseded: ProjectKnowledgeRecord = { ...predecessor, category: "superseded" };
  target.replace(superseded);
  return { kind: "committed", successor: plan.successor, predecessor: superseded };
}
