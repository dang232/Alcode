// Model-driven repair diagnosis: the narrow seam where the repair loop asks
// the live model what the host's diagnosis input means.
//
// The host builds the diagnosis input from durable evidence (see
// ./diagnosis.ts); this module never rebuilds it and never invents failures.
// `requestRepairDiagnosis` parses the model's structured answer into observed
// facts / hypotheses / supporting evidence / confidence / missing information
// / proposed next action, rejects a malformed or empty answer with a typed
// failure, and returns "no defensible diagnosis" when the model cannot justify
// one. It NEVER synthesises a diagnosis itself: thin evidence means a typed
// no_defensible_diagnosis failure, not a filled-in guess.
//
// PRODUCTION PATH (reused, not reinvented - no HTTP client here):
// - The live model is resolved by `createParentRegistrySessionContext`
//   (manager/parent-registry-context.ts:37), which threads the parent
//   session's live modelRegistry/authStorage/model into every in-process
//   child; `findModelReference` (:73) resolves a `provider/modelId` reference
//   via `registry.find`, and the resume path `resolveResumeContext` (:87)
//   fails closed with `{ok:false, code:"model_unavailable"}` when there is no
//   live registry, no resolved_model, or the model is absent from the live set.
// - The host wires that context onto a ChildSpec via `toChildSpec`
//   (manager/runner.ts:86) - whose fallback rungs are named by `modelSelector`
//   (runners/in-process/runtime-fallback-settings.ts:80) - and launches it
//   through `InProcessRunner.start` (runners/in-process.ts:168), which
//   assembles options with `buildChildSessionOptions`
//   (runners/in-process/child-options.ts:101), opens the session with the
//   default `createAgentSession` (runners/in-process.ts:143-151), and tracks
//   the turn with `createChildHandle`
//   (runners/in-process/child-handle.ts:302); the settled text is read from
//   `waitForIdle` (:290), whose outcome is derived from the emitted events in
//   `turnOutcome` (:157).
// - `createHostDiagnosisInvoker` below reuses exactly that path: the host
//   supplies its live `InProcessRunner.start` and a `childSpecFor` callback
//   that builds the ChildSpec the same way `toChildSpec` does (cwd, a
//   sessionDir under stateDir/children/<taskId>/, depth, parent/root session
//   ids, plus the live model wiring above; a self-contained diagnosis prompt
//   should use promptEnvelope:"bare" so the prompt passes verbatim instead of
//   gaining the subagent ancestry wrapper).
// - When no provider is configured the spec carries no model wiring at all
//   (the context provider's trust-only fallback when no live registry
//   exists); the invoker throws a typed `RunnerError` with kind
//   `model_unavailable` (runners/in-process/runner-error.ts), surfaced
//   publicly by `describeStartFailure` (manager/start-failure.ts:125-126) as
//   "The task child cannot serve this model." It never fabricates model text.

import { RunnerError } from "../runners/in-process/runner-error";
import type { ChildHandle, ChildSpec } from "../runners/in-process";
import type { RunnerFailure } from "../runners/in-process/child-handle";

// The structured request the invoker seam carries: host-authored system
// instructions, the host-produced diagnosis context serialised as JSON (the
// only evidence the model may cite), and the required output contract the
// model's answer must satisfy.
export type RepairDiagnosisRequest = {
  readonly systemInstructions: string;
  readonly diagnosisContextJson: string;
  readonly outputContract: string;
};

// The narrow injection seam. A function taking the structured request above
// and resolving to the RAW model text - no parsing, no interpretation. Tests
// inject fakes; production injects `createHostDiagnosisInvoker` output.
export type RepairDiagnosisInvoker = (request: RepairDiagnosisRequest) => Promise<string>;

// One model hypothesis. supportingFactIndexes cites observedFacts by index -
// the same support rule ./diagnosis.ts enforces for host-built diagnoses, so
// an unsupported claim cannot enter through the model either.
type RepairModelHypothesis = {
  readonly statement: string;
  readonly supportingFactIndexes: readonly number[];
  readonly supportingEvidence: readonly string[];
};

type RepairModelDiagnosis = {
  readonly observedFacts: readonly string[];
  readonly hypotheses: readonly RepairModelHypothesis[];
  readonly supportingEvidence: readonly string[];
  readonly confidence: number;
  readonly missingInformation: readonly string[];
  readonly proposedNextAction: string;
};

type RepairDiagnosisFailureReason =
  | "empty_answer"
  | "malformed_answer"
  | "no_defensible_diagnosis"
  | "repair_blocked";

export type RequestRepairDiagnosisResult =
  | { readonly ok: true; readonly diagnosis: RepairModelDiagnosis }
  | {
      readonly ok: false;
      readonly reason: RepairDiagnosisFailureReason;
      readonly detail: string;
      readonly cause?: unknown;
    };

// Typed failure for diagnosis plumbing the invoker itself cannot express
// (cancellation before any model text exists). Model-content failures travel
// as RequestRepairDiagnosisResult members, never as throws.
export class RepairDiagnosisError extends Error {
  readonly reason: "repair_blocked";
  readonly detail: string;

  constructor(reason: "repair_blocked", detail: string, options?: { readonly cause?: unknown }) {
    super(detail, options === undefined ? undefined : { cause: options.cause });
    this.name = "RepairDiagnosisError";
    this.reason = reason;
    this.detail = detail;
  }
}

// The JSON shape a model answer arrives in. Every field arrives as model JSON
// until narrowed below: a mistyped field fails the answer, never the caller. This
// mirrors the candidate pattern in ./store.ts (isRepairAttemptRecord).
type ModelJsonRecord = {
  readonly [key: string]: ModelJsonValue;
};

type ModelJsonValue = null | boolean | number | string | readonly ModelJsonValue[] | ModelJsonRecord;

type ModelAnswerCandidate = {
  readonly defensible?: ModelJsonValue;
  readonly observedFacts?: ModelJsonValue;
  readonly hypotheses?: ModelJsonValue;
  readonly supportingEvidence?: ModelJsonValue;
  readonly confidence?: ModelJsonValue;
  readonly missingInformation?: ModelJsonValue;
  readonly proposedNextAction?: ModelJsonValue;
};

type HypothesisAnswerCandidate = {
  readonly statement?: ModelJsonValue;
  readonly supportingFactIndexes?: ModelJsonValue;
  readonly supportingEvidence?: ModelJsonValue;
};

function isRecordValue(value: ModelJsonValue): value is ModelJsonRecord {
  return value !== null && value instanceof Object && !Array.isArray(value);
}

// SAFETY: JSON.parse returns whatever the model emitted; the candidate types
// only name the fields the checks below read, and the guards reject anything
// missing or mistyped before the value is trusted.
function isAnswerCandidate(value: ModelJsonValue): value is ModelAnswerCandidate {
  return isRecordValue(value);
}

function isHypothesisCandidate(value: ModelJsonValue): value is HypothesisAnswerCandidate {
  return isRecordValue(value);
}

function isStringValue(value: ModelJsonValue): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isStringArray(value: ModelJsonValue): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (Object.prototype.toString.call(entry) !== "[object String]") return false;
  }
  return true;
}

function isNonBlankString(value: ModelJsonValue): value is string {
  if (!isStringValue(value)) return false;
  return value.trim().length > 0;
}

function isBooleanValue(value: ModelJsonValue): value is boolean {
  return Object.prototype.toString.call(value) === "[object Boolean]";
}

function isNumberValue(value: ModelJsonValue): value is number {
  return Object.prototype.toString.call(value) === "[object Number]";
}

function isValidFactIndex(value: ModelJsonValue, upper: number): value is number {
  if (!isNumberValue(value)) return false;
  return Number.isInteger(value) && value >= 0 && value < upper;
}

function malformed(detail: string): RequestRepairDiagnosisResult {
  return { ok: false, reason: "malformed_answer", detail };
}

function noDefensible(detail: string): RequestRepairDiagnosisResult {
  return { ok: false, reason: "no_defensible_diagnosis", detail };
}

// A model that wraps JSON in a markdown fence still answered in JSON; strip
// one fence pair so the contract judges the payload, not the wrapping.
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const withoutOpen = trimmed.replace(/^```[^\n]*\n/, "");
  return withoutOpen.replace(/\n```\s*$/, "").trim();
}

function parseModelDiagnosis(raw: string): RequestRepairDiagnosisResult {
  if (raw.trim().length === 0) {
    return {
      ok: false,
      reason: "empty_answer",
      detail: "The model returned no text: an empty answer carries no diagnosis.",
    };
  }
  const parsed: ModelJsonValue = JSON.parse(stripCodeFences(raw));
  if (!isAnswerCandidate(parsed)) {
    return malformed("The model answer must be a JSON object carrying the required output contract.");
  }
  // The model's own verdict comes first: an explicit "cannot justify" is
  // honoured as-is and never upgraded into a diagnosis by this module.
  if (parsed.defensible === false) {
    return noDefensible(
      "The model reported it cannot defend a diagnosis from the host evidence; no diagnosis is synthesised.",
    );
  }
  if (parsed.defensible !== undefined && !isBooleanValue(parsed.defensible)) {
    return malformed("The model answer field 'defensible' must be a boolean when present.");
  }
  if (!isStringArray(parsed.observedFacts)) {
    return malformed("The model answer field 'observedFacts' must be an array of strings.");
  }
  const observedFacts = parsed.observedFacts.filter((fact) => fact.trim().length > 0);
  if (!Array.isArray(parsed.hypotheses)) {
    return malformed("The model answer field 'hypotheses' must be an array.");
  }
  // Well-formed but empty substance is not malformed - it is the model
  // declining to justify a diagnosis, which this module reports honestly.
  if (observedFacts.length === 0 || parsed.hypotheses.length === 0) {
    return noDefensible(
      "The model answer carries no usable substance (no observed facts or no hypotheses); no diagnosis is synthesised.",
    );
  }
  const hypotheses: RepairModelHypothesis[] = [];
  for (let index = 0; index < parsed.hypotheses.length; index += 1) {
    // SAFETY: hypotheses passed the Array check above, so indexing yields model JSON for the candidate guard below.
    const entry: ModelJsonValue = parsed.hypotheses[index] as ModelJsonValue;
    if (!isHypothesisCandidate(entry)) {
      return malformed(`The model answer hypotheses[${index}] must be an object.`);
    }
    if (!isNonBlankString(entry.statement)) {
      return malformed(`The model answer hypotheses[${index}].statement must be a non-empty string.`);
    }
    if (!Array.isArray(entry.supportingFactIndexes) || entry.supportingFactIndexes.length === 0) {
      return malformed(
        `The model answer hypotheses[${index}] cites no supporting fact (hypothesis_without_support).`,
      );
    }
    const supportingFactIndexes: number[] = [];
    for (const factIndex of entry.supportingFactIndexes) {
      if (!isValidFactIndex(factIndex, observedFacts.length)) {
        return malformed(
          `The model answer hypotheses[${index}] cites fact index ${String(factIndex)} outside the observed facts (fact_index_out_of_range).`,
        );
      }
      supportingFactIndexes.push(factIndex);
    }
    if (entry.supportingEvidence !== undefined && !isStringArray(entry.supportingEvidence)) {
      return malformed(`The model answer hypotheses[${index}].supportingEvidence must be an array of strings.`);
    }
    hypotheses.push({
      statement: entry.statement,
      supportingFactIndexes,
      supportingEvidence: entry.supportingEvidence === undefined ? [] : [...entry.supportingEvidence],
    });
  }
  if (parsed.supportingEvidence !== undefined && !isStringArray(parsed.supportingEvidence)) {
    return malformed("The model answer field 'supportingEvidence' must be an array of strings when present.");
  }
  if (
    !isNumberValue(parsed.confidence) ||
    !Number.isFinite(parsed.confidence) ||
    parsed.confidence < 0 ||
    parsed.confidence > 1
  ) {
    return malformed("The model answer field 'confidence' must be a number between 0 and 1.");
  }
  if (parsed.missingInformation !== undefined && !isStringArray(parsed.missingInformation)) {
    return malformed("The model answer field 'missingInformation' must be an array of strings when present.");
  }
  if (!isNonBlankString(parsed.proposedNextAction)) {
    return malformed("The model answer field 'proposedNextAction' must be a non-empty string.");
  }
  return {
    ok: true,
    diagnosis: {
      observedFacts: [...observedFacts],
      hypotheses,
      supportingEvidence: parsed.supportingEvidence === undefined ? [] : [...parsed.supportingEvidence],
      confidence: parsed.confidence,
      missingInformation: parsed.missingInformation === undefined ? [] : [...parsed.missingInformation],
      proposedNextAction: parsed.proposedNextAction,
    },
  };
}

// Parse the model's structured answer. Never throws for model-content
// reasons: malformed/empty answers become typed failures, a model that cannot
// justify a diagnosis becomes no_defensible_diagnosis (never a synthesised
// guess), and an invoker that throws becomes repair_blocked with its cause.
export async function requestRepairDiagnosis(
  invoker: RepairDiagnosisInvoker,
  input: RepairDiagnosisRequest,
): Promise<RequestRepairDiagnosisResult> {
  let raw: string;
  try {
    raw = await invoker(input);
  } catch (error) {
    return {
      ok: false,
      reason: "repair_blocked",
      detail: `The diagnosis model call failed before producing an answer: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
    };
  }
  try {
    return parseModelDiagnosis(raw);
  } catch (error) {
    return {
      ok: false,
      reason: "malformed_answer",
      detail: `The model answer is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function buildRepairDiagnosisPrompt(request: RepairDiagnosisRequest): string {
  return [
    request.systemInstructions,
    "",
    "## Diagnosis context (host-observed JSON - the only evidence you may cite)",
    request.diagnosisContextJson,
    "",
    "## Required output contract (respond with exactly this JSON shape, no prose)",
    request.outputContract,
  ].join("\n");
}

// The host's live runner surface, structurally the `InProcessRunnerLike` from
// manager/runner.ts: `start` is `InProcessRunner.start`. Only `start` is
// needed - diagnosis never resumes a session.
type HostDiagnosisChildRunner = {
  start(spec: ChildSpec): Promise<ChildHandle>;
};

// Production dependencies. `childSpecFor` is host-owned and must build the
// ChildSpec the same way `toChildSpec` (manager/runner.ts:86) does, with the
// live model wiring from `createParentRegistrySessionContext`
// (manager/parent-registry-context.ts:37).
export type HostDiagnosisInvokerDeps = {
  readonly runner: HostDiagnosisChildRunner;
  readonly childSpecFor: (prompt: string) => ChildSpec;
};

function hasModelWiring(spec: ChildSpec): boolean {
  return (
    spec.model !== undefined ||
    spec.modelRegistry !== undefined ||
    spec.selectedModel !== undefined ||
    spec.resolvedModel !== undefined
  );
}

// The PRODUCTION adapter: runs the diagnosis prompt as a real in-process
// child through the host's existing execution path and returns its raw text
// for `requestRepairDiagnosis` to parse. Turn failures propagate as the same
// typed `RunnerError` kinds the manager already classifies (see
// `describeStartFailure`); only the no-provider case is raised here, because
// the child must never start without a model to serve it.
export function createHostDiagnosisInvoker(deps: HostDiagnosisInvokerDeps): RepairDiagnosisInvoker {
  return async (request) => {
    const spec = deps.childSpecFor(buildRepairDiagnosisPrompt(request));
    if (!hasModelWiring(spec)) {
      throw new RunnerError({
        kind: "model_unavailable",
        message:
          "Repair diagnosis has no configured model: the live parent registry resolved no provider, so no diagnosis child was started.",
      });
    }
    const handle = await deps.runner.start(spec);
    try {
      const outcome = await handle.waitForIdle();
      if (outcome.status === "completed") return outcome.finalResponse;
      if (outcome.status === "cancelled") {
        throw new RepairDiagnosisError(
          "repair_blocked",
          "The repair diagnosis child was cancelled before producing an answer.",
        );
      }
      let failureInput: RunnerFailure = {
        kind: outcome.failure.kind,
        message: outcome.failure.message,
      };
      if (outcome.failure.reason !== undefined) failureInput = { ...failureInput, reason: outcome.failure.reason };
      if (outcome.failure.cause !== undefined) failureInput = { ...failureInput, cause: outcome.failure.cause };
      throw new RunnerError(failureInput);
    } finally {
      await handle.dispose();
    }
  };
}
