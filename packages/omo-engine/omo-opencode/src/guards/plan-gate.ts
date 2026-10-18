/**
 * plan-gate.ts — native dispatch guard for the plan-review tier.
 *
 * Plan-consultant and plan-reviewer only produce useful verdicts before
 * execution begins, so their dispatch is locked behind three session facts:
 * the user explicitly asked for planning, a `.omo/plans/*.md` artifact was
 * touched, and execution has not started. The execution check is terminal
 * and wins over the other two: once work is underway there is no plan left
 * to review. Anything that is not a fully proven triple stays denied —
 * malformed or missing input fails closed.
 */

/** Subagent types confined behind the plan gate. */
export const PLAN_GATED_SUBAGENT_TYPES: readonly string[] = [
  "plan-consultant",
  "plan-reviewer",
];

/** Session facts the plan gate decides on. Every field must be a boolean. */
export interface PlanGateInput {
  readonly userRequestedPlan: boolean;
  readonly planArtifactTouched: boolean;
  readonly executeStarted: boolean;
}

/** Gate verdict: denials always carry a human-readable reason. */
export interface PlanGateVerdict {
  readonly allowed: boolean;
  readonly reason?: string;
}

function denied(reason: string): PlanGateVerdict {
  return { allowed: false, reason };
}

function isPlanGateInput(value: unknown): value is PlanGateInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["userRequestedPlan"] === "boolean" &&
    typeof candidate["planArtifactTouched"] === "boolean" &&
    typeof candidate["executeStarted"] === "boolean"
  );
}

/**
 * Pure plan-gate verdict over one session snapshot.
 *
 * Evaluation order is deliberate: the execution veto is checked first
 * because it is terminal, then the user-request requirement, then the
 * artifact requirement. Unknown or malformed input is denied.
 */
export function evaluatePlanGate(input: PlanGateInput): PlanGateVerdict {
  if (!isPlanGateInput(input)) {
    return denied(
      "Plan dispatch is denied: the gate input is missing or malformed, " +
        "and the gate fails closed without a proven session snapshot.",
    );
  }
  if (input.executeStarted === true) {
    return denied(
      "Plan dispatch is closed: execution already started in this session, " +
        "so there is no plan left to review. Continue the work directly instead.",
    );
  }
  if (input.userRequestedPlan !== true) {
    return denied(
      "Plan dispatch needs the user to explicitly request planning in this " +
        "session, for example by asking for a plan in their own words. " +
        "Automatic reads never unlock this gate.",
    );
  }
  if (input.planArtifactTouched !== true) {
    return denied(
      "Plan dispatch needs a touched plan artifact (.omo/plans/*.md) in this " +
        "session. Finish the planning step so it produces a plan file, then retry.",
    );
  }
  return { allowed: true };
}

/**
 * Dispatch-site denial for one subagent type, without session state.
 *
 * Plan-gated types are denied unconditionally here because this overload
 * carries no session evidence and the gate fails closed; callers holding
 * session facts should consult `evaluatePlanGate` instead. Every other
 * type is outside this gate and returns undefined (may proceed).
 */
export function invocationGateDenial(subagentType: string): string | undefined {
  const name = typeof subagentType === "string" ? subagentType.trim() : "";
  if (!PLAN_GATED_SUBAGENT_TYPES.includes(name)) return undefined;
  return (
    `Subagent "${name}" is plan-gated and cannot be dispatched without session ` +
      `proof: the user must explicitly request planning, a .omo/plans/*.md ` +
      `artifact must be touched, and execution must not have started. ` +
      `Evaluate the plan gate against the live session before dispatching.`
  );
}
