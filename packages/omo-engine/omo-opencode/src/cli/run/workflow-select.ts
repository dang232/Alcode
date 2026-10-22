/**
 * workflow-select.ts
 *
 * Deterministic, synchronous, dependency-free workflow strategy selector.
 * Explicit-mode-first: an explicit user-requested mode always wins (when known),
 * otherwise the decision derives from task-profile evidence.
 *
 * Six strategies: direct | explore-then-execute | plan-then-execute |
 * parallel-native | high-assurance | bounded-recovery
 */

export type WorkflowStrategy =
  | "direct"
  | "explore-then-execute"
  | "plan-then-execute"
  | "parallel-native"
  | "high-assurance"
  | "bounded-recovery";

export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex";
export type TaskClarity = "clear" | "partial" | "unclear";
export type RiskLevel = "low" | "medium" | "high" | "security-sensitive";

export interface GateRequirement {
  /** Machine-readable gate id, e.g. "security-review", "human-approval". */
  gate: string;
  /** Why this gate is required for the decision. */
  reason: string;
}

export interface TaskProfile {
  /** Explicit user-requested mode; wins over all evidence when recognized. */
  explicitMode?: string;
  complexity?: TaskComplexity;
  /** How well understood the task scope is. */
  clarity?: TaskClarity;
  risk?: RiskLevel;
  /** Number of files plausibly touched. */
  fileCount?: number;
  /** True when the task was classified by an untrusted/malformed classifier. */
  classificationValid?: boolean;
  /** New dependency / external-capability evidence discovered mid-run. */
  newDependencyEvidence?: boolean;
  /** Provider capability unavailable (e.g. no parallel runner). */
  providerCapabilityUnavailable?: boolean;
  /** Count of prior replans for this run (bounded replanning). */
  replanCount?: number;
  /** Max replans allowed before forcing a terminal strategy. */
  maxReplans?: number;
  /** Completed work units that must be preserved across strategy change. */
  completedWorkUnits?: number;
  /** Stable run id carried across replans; generated when absent. */
  runId?: string;
  /** Session identity preserved across strategy changes. */
  sessionId?: string;
}

export interface WorkflowDecision {
  strategy: WorkflowStrategy;
  /** One-line observable reason for the decision. */
  reason: string;
  /** Stable run identifier carried across replans. */
  runId: string;
  /** Max execution attempts for the chosen strategy. */
  maxAttempts: number;
  gates: GateRequirement[];
  /** Session identity echoed from the profile, when provided. */
  sessionId?: string;
  /** Completed work units carried over from the profile, when provided. */
  preservedWorkUnits?: number;
}

export const KNOWN_STRATEGIES: readonly WorkflowStrategy[] = [
  "direct",
  "explore-then-execute",
  "plan-then-execute",
  "parallel-native",
  "high-assurance",
  "bounded-recovery",
];

export const DEFAULT_MAX_REPLANS = 3;

const MAX_ATTEMPTS_BY_STRATEGY = {
  direct: 1,
  "explore-then-execute": 3,
  "plan-then-execute": 2,
  "parallel-native": 2,
  "high-assurance": 2,
  "bounded-recovery": 3,
} satisfies Record<WorkflowStrategy, number>;

let runSequence = 0;

function nextRunId(): string {
  runSequence += 1;
  return `run-${Date.now().toString(36)}-${runSequence.toString(36)}`;
}

function isKnownStrategy(value: string | undefined): value is WorkflowStrategy {
  // SAFETY: KNOWN_STRATEGIES is a const tuple of WorkflowStrategy; widening
  // to readonly string[] only permits the .includes(string) lookup, and the
  // true branch re-narrows through this function's type predicate.
  return (
    value !== undefined &&
    (KNOWN_STRATEGIES as readonly string[]).includes(value)
  );
}

/**
 * Select a workflow strategy for a task profile.
 * Deterministic, synchronous, dependency-free. Explicit mode wins first.
 */
export function selectWorkflow(taskProfile: TaskProfile): WorkflowDecision {
  const profile = taskProfile ?? {};
  const runId = profile.runId ?? nextRunId();
  const carried: Pick<WorkflowDecision, "sessionId" | "preservedWorkUnits"> = {};
  if (profile.sessionId !== undefined) carried.sessionId = profile.sessionId;
  if (profile.completedWorkUnits !== undefined) {
    carried.preservedWorkUnits = profile.completedWorkUnits;
  }
  const decide = (
    strategy: WorkflowStrategy,
    reason: string,
    gates: GateRequirement[] = [],
  ): WorkflowDecision => ({
    strategy,
    reason,
    runId,
    maxAttempts: MAX_ATTEMPTS_BY_STRATEGY[strategy],
    gates,
    ...carried,
  });

  // 1. Explicit-mode-first: honored only when it names a known strategy.
  // Normalized at this I/O boundary once; downstream branches on the domain value.
  const explicitMode = String(profile.explicitMode ?? "").trim() || undefined;
  if (explicitMode !== undefined && isKnownStrategy(explicitMode)) {
    const strategy = explicitMode;
    return decide(
      strategy,
      `explicit mode requested: ${strategy}`,
      strategy === "high-assurance"
        ? [
            {
              gate: "security-review",
              reason: "explicit high-assurance mode requires security review",
            },
          ]
        : [],
    );
  }

  // 2. Malformed classification can never bypass gates: treat as untrusted
  //    input and force the gated high-assurance path.
  if (profile.classificationValid === false) {
    return decide(
      "high-assurance",
      "malformed classification treated as untrusted: gated high-assurance fallback",
      [
        {
          gate: "security-review",
          reason: "untrusted classification requires security review",
        },
        {
          gate: "human-approval",
          reason: "untrusted classification requires human approval",
        },
      ],
    );
  }

  // 3. Bounded replanning: repeated decisions must terminate.
  const replanCount = profile.replanCount ?? 0;
  const maxReplans = profile.maxReplans ?? DEFAULT_MAX_REPLANS;
  if (replanCount >= maxReplans) {
    return decide(
      "bounded-recovery",
      `replan budget exhausted (${replanCount}/${maxReplans}): bounded recovery`,
      [
        {
          gate: "human-approval",
          reason: "exhausted replan budget requires human approval",
        },
      ],
    );
  }

  // 4. Security-sensitive risk always routes to gated high-assurance.
  if (profile.risk === "security-sensitive") {
    return decide(
      "high-assurance",
      "security-sensitive risk requires gated high-assurance workflow",
      [
        {
          gate: "security-review",
          reason: "security-sensitive task requires security review",
        },
        {
          gate: "human-approval",
          reason: "security-sensitive task requires human approval",
        },
      ],
    );
  }

  // 5. Unavailable provider capability yields a safe fallback (no fan-out).
  if (profile.providerCapabilityUnavailable === true) {
    return decide(
      "plan-then-execute",
      "provider capability unavailable: safe plan-then-execute fallback without fan-out",
    );
  }

  // 6. New dependency evidence escalates to exploration before execution.
  if (profile.newDependencyEvidence === true) {
    return decide(
      "explore-then-execute",
      "new dependency evidence discovered: explore-then-execute to resolve unknowns",
    );
  }

  // 7. Unclear multi-file bug: explore before executing.
  const fileCount = profile.fileCount ?? 1;
  if (profile.clarity === "unclear" && fileCount > 1) {
    return decide(
      "explore-then-execute",
      `unclear multi-file scope (${fileCount} files): explore before executing`,
    );
  }

  // 8. Complex or high-risk work plans first. Parallel-native when the
  //    profile shows independent multi-file work at moderate+ complexity.
  if (profile.complexity === "complex" || profile.risk === "high") {
    if (fileCount >= 3 && profile.clarity !== "unclear") {
      return decide(
        "parallel-native",
        `independent multi-file work (${fileCount} files): parallel-native fan-out`,
      );
    }
    return decide(
      "plan-then-execute",
      "complex or high-risk scope: plan before executing",
    );
  }

  // 9. Trivial/simple clear work goes direct without fan-out.
  return decide(
    "direct",
    "trivial or simple clear task: direct execution without fan-out",
  );
}
