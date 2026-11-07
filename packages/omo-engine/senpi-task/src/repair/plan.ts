// Constrained repair-plan validation: a repair plan is a proposal, never an
// authority. This validator rejects plans that reach for verification or
// approval material, weaken required tests, broaden scope without saying so,
// touch files no addressed check owns, claim completion (only the completion
// gate in ../verification/completion-gate.ts may judge), or omit the rerun
// set. Every rejection carries a stable code string.
//
// What this module does NOT do: it never judges whether the repair will work,
// never re-runs anything, and never substitutes for the gate. A plan that
// passes still earns nothing until fresh evidence passes the gate.

import { catalogueChecks, type OrdinaryCatalogue } from "../verification/catalogue";
import type { DagVerifyCheck } from "../dag/verification";

// The repair proposal. filesToChange is the closed file set the repair may
// touch; scopeJustification is the justification field the host must fill when
// the repair's real footprint reaches beyond filesToChange. claimedComplete
// must stay absent or false: a repair never declares itself complete.
export type RepairPlan = {
  readonly addressedCheckIds: readonly string[];
  readonly suspectedRootCause: string;
  readonly supportingEvidence: readonly string[];
  readonly filesToChange: readonly string[];
  readonly symbolsToChange?: readonly string[];
  readonly expectedBehaviourChange: string;
  readonly risks: readonly string[];
  readonly checksToRerun: readonly string[];
  readonly checksToRemainUnchanged: readonly string[];
  readonly rollbackPlan: string;
  readonly claimedComplete?: boolean;
  readonly scopeJustification?: string;
};

export type RepairPlanViolationCode =
  | "protected_alcode_path"
  | "protected_verification_authority"
  | "weakens_required_test"
  | "unjustified_scope_broadening"
  | "outside_approved_scope"
  | "unknown_check"
  | "claims_completion"
  | "missing_rerun_set";

export type RepairPlanViolation = {
  readonly code: RepairPlanViolationCode;
  readonly message: string;
  readonly path?: string;
};

export type ValidateRepairPlanResult = {
  readonly ok: boolean;
  readonly violations: readonly RepairPlanViolation[];
};

// One proposed file edit the host observed (or the model declared) behind
// filesToChange. The validator cannot diff: the host populates addsTestSkip /
// narrowsAssertions from the real diff, and an unpopulated hint reads as
// "not observed", never as proof of safety.
type PlannedFileOperation = {
  readonly path: string;
  readonly operation: "create" | "modify" | "delete";
  readonly addsTestSkip?: boolean;
  readonly narrowsAssertions?: boolean;
};

export type ValidateRepairPlanContext = {
  readonly catalogue: OrdinaryCatalogue;
  readonly fileOperations?: readonly PlannedFileOperation[];
};

function normalizePlanPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function pathSegments(path: string): readonly string[] {
  return normalizePlanPath(path).split("/").filter((segment) => segment.length > 0);
}

// Same cover semantics the evidence gate uses (see pathsIntersect in
// dag/verification.ts): equality or prefix in either direction, so a scoped
// directory covers its files and a file covers its scoped directory.
function scopeCovers(scopePath: string, file: string): boolean {
  const scope = normalizePlanPath(scopePath);
  const target = normalizePlanPath(file);
  if (scope.length === 0 || target.length === 0) return false;
  return target === scope || target.startsWith(scope + "/") || scope.startsWith(target + "/");
}

const ALCODE_SENSITIVE_NAME = /(verif|approval|authorit|catalog|policy|allow|key|secret|credential|token)/i;
const VERIFICATION_AUTHORITY_FILE = /(catalogue|catalog|approval|authority)/i;
const TEST_FILE = /(^|\/)(__tests__\/.*|.*\.(test|spec)\.[A-Za-z0-9]+)$/i;

function isTestPath(path: string): boolean {
  return TEST_FILE.test(normalizePlanPath(path));
}

export function validateRepairPlan(plan: RepairPlan, ctx: ValidateRepairPlanContext): ValidateRepairPlanResult {
  const violations: RepairPlanViolation[] = [];
  const approved: readonly DagVerifyCheck[] = ctx.catalogue.status === "configured" ? catalogueChecks(ctx.catalogue) : [];
  const approvedIds = new Set(approved.map((check) => check.checkId));
  const addressedApproved = approved.filter((check) => plan.addressedCheckIds.includes(check.checkId));

  const guardPaths = (paths: readonly string[], operationsLabel: string): void => {
    for (const rawPath of paths) {
      const segments = pathSegments(rawPath);
      // Any path under .alcode/ that carries verification configuration or
      // approval/authority material (name-based heuristic; the validator sees
      // paths, not contents, so a sensitive-looking name fails closed).
      if (segments.includes(".alcode") && ALCODE_SENSITIVE_NAME.test(rawPath)) {
        violations.push({
          code: "protected_alcode_path",
          message: `${operationsLabel} names a protected .alcode/ path carrying verification or approval material: ${rawPath}`,
          path: rawPath,
        });
      }
      // Any file under a verification/ directory that owns the catalogue or
      // approval authority (catalogue/approval/authority files). The gate's
      // contract and catalogue live there; a repair must never rewrite them.
      if (segments.includes("verification")) {
        const fileName = segments[segments.length - 1] ?? "";
        if (VERIFICATION_AUTHORITY_FILE.test(fileName)) {
          violations.push({
            code: "protected_verification_authority",
            message: `${operationsLabel} touches verification authority material: ${rawPath}`,
            path: rawPath,
          });
        }
      }
    }
  };
  guardPaths(plan.filesToChange, "filesToChange");
  guardPaths((ctx.fileOperations ?? []).map((operation) => operation.path), "fileOperations");

  // A repair that removes or weakens a required test is not a repair: deleted
  // test files, added skip/only markers, or narrowed assertion paths all read
  // as weakening. The host reports the diff signals; the plan alone cannot.
  for (const operation of ctx.fileOperations ?? []) {
    if (operation.operation === "delete" && isTestPath(operation.path)) {
      violations.push({
        code: "weakens_required_test",
        message: `repair deletes a required test file: ${operation.path}`,
        path: operation.path,
      });
    }
    if (operation.addsTestSkip === true) {
      violations.push({
        code: "weakens_required_test",
        message: `repair adds a test skip/only marker: ${operation.path}`,
        path: operation.path,
      });
    }
    if (operation.narrowsAssertions === true) {
      violations.push({
        code: "weakens_required_test",
        message: `repair narrows an assertion path: ${operation.path}`,
        path: operation.path,
      });
    }
  }

  // The real footprint must stay inside filesToChange unless the plan carries
  // a justification field saying why it reaches further.
  const declared = new Set(plan.filesToChange.map(normalizePlanPath));
  const justified = plan.scopeJustification !== undefined && plan.scopeJustification.trim().length > 0;
  if (!justified) {
    for (const operation of ctx.fileOperations ?? []) {
      if (!declared.has(normalizePlanPath(operation.path))) {
        violations.push({
          code: "unjustified_scope_broadening",
          message: `repair touches ${operation.path} beyond filesToChange without a scopeJustification`,
          path: operation.path,
        });
      }
    }
  }

  // Every file must sit inside the scope of at least one ADDRESSED check: the
  // plan names the check its repair addresses, and a file no addressed check
  // owns is out of bounds. A run-scoped addressed check (no coveredPaths)
  // covers every file — it attests the whole tree, so it authorises any
  // repair footprint (at the cost of the conservative full rerun downstream).
  for (const rawPath of plan.filesToChange) {
    const covered = addressedApproved.some((check) => {
      const scope = check.coveredPaths ?? [];
      if (scope.length === 0) return true;
      return scope.some((scopePath) => scopeCovers(scopePath, rawPath));
    });
    if (!covered) {
      violations.push({
        code: "outside_approved_scope",
        message: `repair touches ${rawPath}, which sits outside every addressed check's approved scope`,
        path: rawPath,
      });
    }
  }

  // An addressed or rerun check the catalogue never approved names nothing to
  // run: reject it instead of routing reverification at a phantom check.
  for (const checkId of plan.addressedCheckIds) {
    if (!approvedIds.has(checkId)) {
      violations.push({ code: "unknown_check", message: `plan addresses unknown check: ${checkId}`, path: checkId });
    }
  }
  for (const checkId of plan.checksToRerun) {
    if (!approvedIds.has(checkId)) {
      violations.push({ code: "unknown_check", message: `plan reruns unknown check: ${checkId}`, path: checkId });
    }
  }

  if (plan.claimedComplete === true) {
    violations.push({
      code: "claims_completion",
      message: "plan claims completion; only the completion gate may judge completion",
    });
  }
  if (plan.checksToRerun.length === 0) {
    violations.push({ code: "missing_rerun_set", message: "plan omits checksToRerun: reverification needs an explicit rerun set" });
  }

  return { ok: violations.length === 0, violations };
}
