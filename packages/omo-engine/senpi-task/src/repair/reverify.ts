// Conservative affected-check rule for reverification.
//
// A check is affected when any changed file matches its configured scope
// (coveredPaths, with the same cover semantics the evidence gate uses). When
// attribution breaks down — a check declares no scope, a changed file has no
// attributable owner, or the plan touched a file outside every check scope —
// the result is the FULL approved applicable set with reason "impact_uncertain"
// and conservative: true, so the host reruns everything instead of guessing.
//
// This module never judges acceptance and re-implements none of it:
// reverification produces FRESH evidence and the completion gate in
// ../verification/completion-gate.ts stays the sole authority that decides.

import { catalogueChecks, type OrdinaryCatalogue } from "../verification/catalogue";
import type { DagVerifyCheck } from "../dag/verification";
import type { RepairPlan } from "./plan";

type AffectedChecksReason = "scope_match" | "impact_uncertain" | "no_approved_checks";

export type AffectedChecksResult = {
  readonly checks: readonly DagVerifyCheck[];
  readonly reason: AffectedChecksReason;
  readonly conservative: boolean;
};

function normalizeAffectedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

// Same cover semantics the evidence gate uses (see pathsIntersect in
// dag/verification.ts): equality or prefix in either direction.
function scopeMatches(scopePath: string, file: string): boolean {
  const scope = normalizeAffectedPath(scopePath);
  const target = normalizeAffectedPath(file);
  if (scope.length === 0 || target.length === 0) return false;
  return target === scope || target.startsWith(scope + "/") || scope.startsWith(target + "/");
}

export function affectedChecks(
  plan: Pick<RepairPlan, "filesToChange">,
  catalogue: OrdinaryCatalogue,
  changedFiles: readonly string[],
): AffectedChecksResult {
  const approved: readonly DagVerifyCheck[] = catalogue.status === "configured" ? catalogueChecks(catalogue) : [];
  if (approved.length === 0) {
    return { checks: [], reason: "no_approved_checks", conservative: false };
  }

  const candidates = [...new Set([...changedFiles, ...plan.filesToChange].map(normalizeAffectedPath))].sort();
  const scopeOf = (check: DagVerifyCheck): readonly string[] => check.coveredPaths ?? [];

  // Trigger 1: a check that declares no scope cannot attribute files, so no
  // file set can prove it unaffected.
  const scopeless = approved.some((check) => scopeOf(check).length === 0);
  // Trigger 2: any candidate file with no attributable owner — no approved
  // scope covers it, so its blast radius is unknown.
  const ownerless = candidates.some(
    (file) => !approved.some((check) => scopeOf(check).some((scopePath) => scopeMatches(scopePath, file))),
  );
  // Trigger 3: the plan itself touched a file outside every check scope.
  // (Overlaps trigger 2 over the union, but named separately: it fires on the
  // plan's declared footprint even when the observed changedFiles list is
  // empty or unattributable.)
  const planOutside = plan.filesToChange
    .map(normalizeAffectedPath)
    .some((file) => !approved.some((check) => scopeOf(check).some((scopePath) => scopeMatches(scopePath, file))));

  if (scopeless || ownerless || planOutside) {
    return { checks: approved, reason: "impact_uncertain", conservative: true };
  }

  const affected = approved.filter((check) =>
    scopeOf(check).some((scopePath) => candidates.some((file) => scopeMatches(scopePath, file))),
  );
  return { checks: affected, reason: "scope_match", conservative: false };
}

// The ordered check ids the host must rerun before the gate may judge: the
// scope-affected set in catalogue order, unioned with every explicitly
// addressed check (a failed check needs fresh passing evidence even when no
// changed file falls in its scope, or the gate will keep blocking on stale
// evidence). Unknown addressed ids trail in plan order — the plan validator
// rejects those, but this pure function never silently drops a name the host
// must answer for. Order is deterministic: catalogue order, then plan order.
export function requiredReverification(
  plan: Pick<RepairPlan, "filesToChange" | "addressedCheckIds">,
  catalogue: OrdinaryCatalogue,
  changedFiles: readonly string[],
): readonly string[] {
  const { checks } = affectedChecks(plan, catalogue, changedFiles);
  const ordered = checks.map((check) => check.checkId);
  const known = new Set(ordered);
  const extra = plan.addressedCheckIds.filter((checkId) => !known.has(checkId));
  return [...ordered, ...extra];
}
