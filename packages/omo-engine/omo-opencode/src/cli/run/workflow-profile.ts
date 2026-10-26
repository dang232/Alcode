/**
 * workflow-profile.ts
 *
 * Deterministic, synchronous, dependency-free enrichment of runner inputs
 * into a TaskProfile plus the evidence behind every derived field.
 *
 * Each derived field is recorded twice: once as a ProfileSignal
 * ({field, value, provenance}) and once as a basis code string
 * ("<field>:<value>" plus evidence codes). The runner directory is recorded
 * in signal provenance only; this module never reads from disk and uses no
 * clock, randomness, filesystem, or network access.
 */

import type {
  RiskLevel,
  TaskClarity,
  TaskComplexity,
  TaskProfile,
  WorkflowStrategy,
} from "./workflow-select";

export interface ResolvedModelRef {
  providerID: string;
  modelID: string;
}

export interface RunnerProfileArgs {
  message: string;
  sessionId: string;
  requestedAgent?: string;
  resolvedAgent?: string;
  requestedModel?: string;
  resolvedModel?: ResolvedModelRef;
  directory?: string;
  explicitMode?: string;
  replanCount?: number;
  maxReplans?: number;
  completedWorkUnits?: number;
  runId?: string;
}

export interface WorkflowProfileInput {
  message: string;
  sessionId?: string;
  requestedAgent?: string;
  resolvedAgent?: string;
  requestedModel?: string;
  resolvedModel?: ResolvedModelRef;
  directory?: string;
  explicitMode?: string;
  replanCount?: number;
  maxReplans?: number;
  completedWorkUnits?: number;
  runId?: string;
}

export interface ProfileSignal {
  field: string;
  value: string | number | boolean;
  provenance: string;
}

export interface EnrichedProfile {
  profile: TaskProfile;
  signals: ProfileSignal[];
  basis: string[];
  explicit: boolean;
}

export interface ExecutionOptions {
  requireMeaningfulWork: boolean;
  requiredConsecutive: number;
}

const SECURITY_MARKERS = [
  "auth",
  "login",
  "password",
  "token",
  "secret",
  "credential",
  "api-key",
  "permission",
  "admin",
  "migration",
  "payment",
  "destructive",
];

const UNCLEAR_MARKERS = [
  "unknown",
  "not sure",
  "not-sure",
  "unreproducible",
  "intermittent",
  "mysterious",
  "diagnose",
  "diagnosis",
  "root cause",
  "root-cause",
];

const DEPENDENCY_MARKERS = [
  "add dependency",
  "add-dependency",
  "install package",
  "install-package",
  "new library",
  "new-library",
  "migrate to",
  "migrate-to",
];

const MULTI_MODULE_MARKERS = [
  "multi-module",
  "multiple modules",
  "across modules",
  "several modules",
  "multiple services",
  "microservices",
];

const TRIVIAL_MESSAGE_LIMIT = 160;
const COMPLEX_NUMBERED_STEP_THRESHOLD = 3;
const MAX_FILE_COUNT = 99;

const CODE_PATH_PATTERN =
  /\b[A-Za-z0-9_][A-Za-z0-9_.$~-]*(?:\/[A-Za-z0-9_.$~-]+)*\.[A-Za-z0-9]{1,5}\b/g;

const EXECUTION_OPTIONS = {
  direct: { requireMeaningfulWork: false, requiredConsecutive: 1 },
  "explore-then-execute": { requireMeaningfulWork: true, requiredConsecutive: 1 },
  "plan-then-execute": { requireMeaningfulWork: true, requiredConsecutive: 1 },
  "parallel-native": { requireMeaningfulWork: true, requiredConsecutive: 1 },
  "high-assurance": { requireMeaningfulWork: true, requiredConsecutive: 2 },
  "bounded-recovery": { requireMeaningfulWork: true, requiredConsecutive: 2 },
} satisfies Record<WorkflowStrategy, ExecutionOptions>;

function containsMarker(loweredMessage: string, markers: string[]): boolean {
  return markers.some((marker) => loweredMessage.includes(marker));
}

function countNumberedSteps(message: string): number {
  let steps = 0;
  const lines = message.split("\n");
  for (const line of lines) {
    if (/^\s*\d+[.)]\s+\S/.test(line)) {
      steps += 1;
    }
  }
  return steps;
}

function countCodePaths(message: string): number {
  const matches = message.match(CODE_PATH_PATTERN);
  if (matches === null) {
    return 1;
  }
  const uniquePaths = new Set<string>();
  for (const token of matches) {
    const extension = token.slice(token.lastIndexOf(".") + 1);
    if (/[a-zA-Z]/.test(extension)) {
      uniquePaths.add(token.toLowerCase());
    }
  }
  if (uniquePaths.size === 0) {
    return 1;
  }
  return Math.min(uniquePaths.size, MAX_FILE_COUNT);
}

/**
 * Enrich runner input into a TaskProfile with full evidence.
 * Deterministic, synchronous, dependency-free: the same input always
 * yields the same profile, signals, basis codes, and explicit flag.
 */
export function buildWorkflowProfile(input: WorkflowProfileInput): EnrichedProfile {
  const message = input.message;
  const loweredMessage = message.toLowerCase();
  const normalizedMode = (input.explicitMode ?? "").trim().toLowerCase();
  const explicit = normalizedMode.length > 0;

  const signals: ProfileSignal[] = [];
  const basis: string[] = [];
  const record = (
    field: string,
    value: string | number | boolean,
    provenance: string,
  ): void => {
    signals.push({ field, value, provenance });
    basis.push(`${field}:${String(value)}`);
  };

  record("explicitMode", explicit ? normalizedMode : "(none)", "explicitMode");

  const classificationValid = message.trim().length > 0 || explicit;
  record("classificationValid", classificationValid, "message+explicitMode");

  const risk: RiskLevel = containsMarker(loweredMessage, SECURITY_MARKERS)
    ? "security-sensitive"
    : "low";
  record("risk", risk, "message");

  const clarity: TaskClarity = containsMarker(loweredMessage, UNCLEAR_MARKERS)
    ? "unclear"
    : "clear";
  record("clarity", clarity, "message");

  const fileCount = countCodePaths(message);
  record("fileCount", fileCount, "message");

  const numberedSteps = countNumberedSteps(message);
  const stepMarkers = numberedSteps > 0 || loweredMessage.includes("step ");
  const multiModule = containsMarker(loweredMessage, MULTI_MODULE_MARKERS);
  let complexity: TaskComplexity = "moderate";
  let complexityEvidence = "default-moderate";
  if (numberedSteps >= COMPLEX_NUMBERED_STEP_THRESHOLD || multiModule) {
    complexity = "complex";
    complexityEvidence =
      numberedSteps >= COMPLEX_NUMBERED_STEP_THRESHOLD
        ? "numbered-steps>=3"
        : "multi-module";
  } else if (
    message.length < TRIVIAL_MESSAGE_LIMIT &&
    stepMarkers === false &&
    fileCount <= 1 &&
    clarity !== "unclear"
  ) {
    complexity = "trivial";
    complexityEvidence = "short-clear-single-file";
  }
  record("complexity", complexity, "message");
  record("complexityEvidence", complexityEvidence, "message");

  const newDependencyEvidence = containsMarker(loweredMessage, DEPENDENCY_MARKERS);
  record("newDependencyEvidence", newDependencyEvidence, "message");

  const requestedAgent = (input.requestedAgent ?? "").trim().toLowerCase();
  const resolvedAgent = (input.resolvedAgent ?? "").trim().toLowerCase();
  const providerCapabilityUnavailable =
    requestedAgent.length > 0 && requestedAgent !== resolvedAgent;
  record(
    "providerCapabilityUnavailable",
    providerCapabilityUnavailable,
    "requestedAgent+resolvedAgent",
  );

  record(
    "directory",
    input.directory ?? "(unset)",
    "runner directory (recorded only, never read from disk)",
  );

  const profile: TaskProfile = {
    complexity,
    clarity,
    risk,
    fileCount,
    classificationValid,
    newDependencyEvidence,
    providerCapabilityUnavailable,
  };
  if (explicit) {
    profile.explicitMode = normalizedMode;
  }
  if (input.sessionId !== undefined) {
    profile.sessionId = input.sessionId;
    record("sessionId", input.sessionId, "run-input");
  }
  if (input.replanCount !== undefined) {
    profile.replanCount = input.replanCount;
    record("replanCount", input.replanCount, "run-input");
  }
  if (input.maxReplans !== undefined) {
    profile.maxReplans = input.maxReplans;
    record("maxReplans", input.maxReplans, "run-input");
  }
  if (input.completedWorkUnits !== undefined) {
    profile.completedWorkUnits = input.completedWorkUnits;
    record("completedWorkUnits", input.completedWorkUnits, "run-input");
  }
  if (input.runId !== undefined) {
    profile.runId = input.runId;
    record("runId", input.runId, "run-input");
  }

  return { profile, signals, basis, explicit };
}

/**
 * Resolve runner execution gates for a chosen workflow strategy.
 * Direct runs skip the meaningful-work gate; every other strategy enforces
 * it, with gated strategies requiring two consecutive confirmations.
 */
export function resolveExecutionOptions(strategy: WorkflowStrategy): ExecutionOptions {
  return EXECUTION_OPTIONS[strategy];
}

/**
 * Map raw runner arguments to a normalized WorkflowProfileInput.
 * Pure field mapping: no inference, no disk access, no side effects.
 */
export function buildRunnerProfileInput(args: RunnerProfileArgs): WorkflowProfileInput {
  const input: WorkflowProfileInput = {
    message: args.message,
    sessionId: args.sessionId,
  };
  if (args.requestedAgent !== undefined) {
    input.requestedAgent = args.requestedAgent;
  }
  if (args.resolvedAgent !== undefined) {
    input.resolvedAgent = args.resolvedAgent;
  }
  if (args.requestedModel !== undefined) {
    input.requestedModel = args.requestedModel;
  }
  if (args.resolvedModel !== undefined) {
    input.resolvedModel = args.resolvedModel;
  }
  if (args.directory !== undefined) {
    input.directory = args.directory;
  }
  if (args.explicitMode !== undefined) {
    input.explicitMode = args.explicitMode;
  }
  if (args.replanCount !== undefined) {
    input.replanCount = args.replanCount;
  }
  if (args.maxReplans !== undefined) {
    input.maxReplans = args.maxReplans;
  }
  if (args.completedWorkUnits !== undefined) {
    input.completedWorkUnits = args.completedWorkUnits;
  }
  if (args.runId !== undefined) {
    input.runId = args.runId;
  }
  return input;
}
