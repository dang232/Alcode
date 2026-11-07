/**
 * Repair end-to-end acceptance harness (deterministic by default, live on demand).
 *
 * Runs one ordinary task through the REAL repair chain:
 *   repair/orchestrator.runRepairAttempt + real repair store +
 *   real verification evidence store + real completion gate.
 *
 * The model boundary is SCRIPTED by default (clearly labelled): a scripted
 * invoker that reads the diagnosis context and proposes the correct edit for
 * the happy path, and the real runVerificationCommand runner executes the
 * fixture check for real. Without --live nothing calls a live model; the trace
 * records liveModel=false.
 *
 * --live replaces the scripted invoker with the PRODUCTION adapter,
 * createHostDiagnosisInvoker (repair/model-diagnosis.ts), driven by the host's
 * real in-process runner and the engine's own configured provider/model. The
 * engine builds its credential store itself: this script never reads an auth
 * file, never puts a key in argv, and never prints credential text. A provider
 * failure is a hard BLOCKED (exit 2, one line) - live mode never falls back to
 * the scripted invoker. The live trace records liveModel=true, the provider
 * name and model id, and the raw model response length + SHA-256 (never the
 * response text itself).
 *
 * Usage:
 *   node scripts/qa/repair-e2e.mjs [--only=happy] [--only=negative] [--no-reexec] [--live]
 *
 * The harness imports TypeScript sources directly, which needs an runtime
 * that resolves extensionless TS imports (bun). When launched with plain
 * `node`, this file re-execs itself under `bun` and passes the exit code
 * through, so `node scripts/qa/repair-e2e.mjs` works verbatim.
 *
 * Runtime fixture root (created at run time, never committed):
 *   .omo/ulw/p231/fixture/   happy-ws/ + negative-ws/ (throwaway git
 *   workspaces, removed at the end) plus evidence and repairs dirs.
 * Trace:
 *   .omo/ulw/p231/e2e-trace.json
 */

import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  asBoolean,
  asNonBlankString,
  asObjectValue,
  asRecord,
  asString,
  asStringArray,
} from "./wire-values.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(ROOT, "packages", "omo-engine", "senpi-task", "src");
const FIXROOT = path.join(ROOT, ".omo", "ulw", "p231", "fixture");
const TRACE_PATH = path.join(ROOT, ".omo", "ulw", "p231", "e2e-trace.json");

// LIVE mode is opt-in: every existing code path and every printed line stays
// exactly as it was when the flag is absent.
const liveMode = process.argv.includes("--live");
const LIVE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.REPAIR_E2E_LIVE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();
// A distinctive substring of the SCRIPTED invoker's fixed proposal. The live
// self-check proves the model text did not come from that function: this text
// must be absent from the live answer and the scripted function must not have
// run at all.
const SCRIPTED_PLAN_SENTINEL = "add() in src/sum.js subtracts instead of adding";

// Live-mode output is buffered so a BLOCKED exit prints exactly one line.
const liveOutput = [];
function say(line) {
  if (liveMode) liveOutput.push(line);
  else console.log(line);
}
function flushOutput() {
  if (!liveMode) return;
  for (const line of liveOutput) console.log(line);
  liveOutput.length = 0;
}

// ---------------------------------------------------------------------------
// Dual-runtime entry: re-exec under bun when running on plain node, because
// the real chain is imported from extensionless TypeScript sources.
// ---------------------------------------------------------------------------
const isBun = Object.prototype.toString.call(process.versions.bun) === "[object String]";
if (!isBun && !process.argv.includes("--no-reexec") && !process.env.REPAIR_E2E_VIA_BUN) {
  const candidates = process.platform === "win32" ? ["bun", "bun.exe"] : ["bun"];
  let done = false;
  for (const candidate of candidates) {
    let res;
    try {
      res = spawnSync(
        candidate,
        [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
        { stdio: "inherit", env: { ...process.env, REPAIR_E2E_VIA_BUN: "1" } },
      );
    } catch {
      continue;
    }
    if (res.error && res.error.code === "ENOENT") continue;
    done = true;
    process.exit(res.status ?? 1);
  }
  if (!done) {
    console.log("RESULT: FAIL (bun runtime not found; repair-e2e needs bun to import the real TS chain)");
    process.exit(1);
  }
}

// Real modules, imported dynamically so the bun re-exec above runs first.
const { runRepairAttempt } = await import(path.join(SRC, "repair", "orchestrator.ts"));
const { createRepairAttemptStore } = await import(path.join(SRC, "repair", "store.ts"));
const { createFileEvidenceStore, workspaceRevision } = await import(
  path.join(SRC, "verification", "evidence-store.ts")
);
const { evaluateOrdinaryCompletion } = await import(
  path.join(SRC, "verification", "completion-gate.ts")
);
const { catalogueFrom } = await import(path.join(SRC, "verification", "catalogue.ts"));
const { createOrdinaryVerificationCapture } = await import(
  path.join(SRC, "verification", "ordinary-capture.ts")
);
const { runVerificationCommand } = await import(path.join(SRC, "dag", "verification.ts"));

// ---------------------------------------------------------------------------
// Fixture: a tiny repo with a genuine, understandable defect.
// add() subtracts instead of adding; checks/sum-check.mjs detects it.
// ---------------------------------------------------------------------------
const DEFECTIVE_SUM_JS = `// Adds two numbers. (Defect: subtracts instead of adding.)
export function add(a, b) {
  return a - b;
}
`;

const FIXED_SUM_JS = `// Adds two numbers.
export function add(a, b) {
  return a + b;
}
`;

const UNFIXED_TOUCH_SUM_JS = `// Adds two numbers. (Defect: subtracts instead of adding.)
export function add(a, b) {
  return a - b;
}
// repair-e2e negative: touched but not fixed.
`;

const SUM_CHECK_MJS = `import { add } from "../src/sum.js";
const got = add(2, 3);
if (got !== 5) {
  console.error(\`sum-check: add(2, 3) = \${got}, want 5\`);
  process.exit(1);
}
console.log("sum-check: add(2, 3) = 5 ok");
`;

const CHECK_ID = "sum-check";
const CHECK_FILE = "src/sum.js";

function git(workspaceDir, ...args) {
  execFileSync("git", ["-C", workspaceDir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

function buildFixtureWorkspace(workspaceDir) {
  rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
  mkdirSync(path.join(workspaceDir, "checks"), { recursive: true });
  writeFileSync(path.join(workspaceDir, "src", "sum.js"), DEFECTIVE_SUM_JS);
  writeFileSync(path.join(workspaceDir, "checks", "sum-check.mjs"), SUM_CHECK_MJS);
  writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify({ name: "repair-e2e-fixture", private: true, type: "module" }, null, 2) + "\n",
  );
  git(workspaceDir, "init", "-q");
  git(workspaceDir, "add", "-A");
  git(
    workspaceDir,
    "-c",
    "user.email=repair-e2e@example.com",
    "-c",
    "user.name=repair-e2e",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture init with defective add()",
  );
}

function makeCatalogue() {
  return catalogueFrom([
    {
      check: {
        checkId: CHECK_ID,
        category: "unit",
        command: ["node", "checks/sum-check.mjs"],
        timeoutMs: 20000,
        criteria: ["add(2,3) returns 5"],
        coveredPaths: [CHECK_FILE],
      },
      provenance: {
        source: "config",
        location: "repair-e2e fixture",
        reason: "approved check for the e2e fixture",
      },
    },
  ]);
}

function listEvidenceFiles(evidenceRoot, runId) {
  const dir = path.join(evidenceRoot, runId);
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(dir, name))
    .sort();
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Assertion + trace helpers.
// ---------------------------------------------------------------------------
const failures = [];

function check(id, cond, detail) {
  const mark = cond ? "PASS" : "FAIL";
  say(`${mark} ${id} ${detail}`);
  if (!cond) failures.push(id);
  return cond;
}

function observeAttemptState(repairStoreRoot, taskId, attemptId) {
  try {
    const found = createRepairAttemptStore({ root: repairStoreRoot })
      .list(taskId)
      .find((attempt) => attempt.attemptId === attemptId);
    return found ? found.state : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// One variant run: seed red evidence, run the real chain, assert, trace.
// fixSource: true -> competent repair; false -> edits without fixing.
// ---------------------------------------------------------------------------
async function runVariant({ taskId, workspaceDir, evidenceRoot, repairStoreRoot, epoch, fixSource, liveInvoker = null }) {
  const label = fixSource ? "happy" : "negative";
  say(`--- variant: ${label} (${taskId}) ---`);

  buildFixtureWorkspace(workspaceDir);
  mkdirSync(evidenceRoot, { recursive: true });
  mkdirSync(repairStoreRoot, { recursive: true });
  const catalogue = makeCatalogue();
  const evidenceStore = createFileEvidenceStore(evidenceRoot);

  // Seed genuine failing evidence with the REAL capture path and the REAL
  // command runner, so the defect is proven detected before repair starts.
  const seedCapture = createOrdinaryVerificationCapture({
    store: evidenceStore,
    projectDir: workspaceDir,
    currentRevision: () => workspaceRevision(workspaceDir),
    runner: runVerificationCommand,
  });
  const seed = await seedCapture.capture({
    binding: { runId: taskId, sessionId: "repair-e2e", epoch },
    changedFiles: [CHECK_FILE],
    available: catalogue.checks.map((entry) => entry.check),
  });
  const seedRecord = seed.records.find((record) => record.checkId === CHECK_ID) ?? null;

  const originalRevision = workspaceRevision(workspaceDir);
  const statesVisited = [];
  const checkIdsSeen = [];
  let activeAttemptId = null;
  // Measured, not asserted from a constant: if live mode ever fell back to the
  // scripted invoker this counter would prove it in the trace.
  let scriptedInvocations = 0;

  const noteState = (hook) => {
    if (activeAttemptId === null) return;
    const state = observeAttemptState(repairStoreRoot, taskId, activeAttemptId);
    if (state !== null && statesVisited[statesVisited.length - 1] !== state) {
      statesVisited.push(state);
    }
  };

  // SCRIPTED invoker (not a live model): reads the diagnosis context and
  // proposes the correct edit for the defect the evidence names.
  const scriptedInvoker = async (request) => {
    scriptedInvocations += 1;
    activeAttemptId = request.attemptId;
    say(
      `[SCRIPTED invoker] correctionRound=${request.correctionRound} failedChecks=${request.diagnosis.failedChecks.map((c) => c.checkId).join(",")}`,
    );
    noteState("invoker");
    const failedCheckIds = request.diagnosis.failedChecks.map((failed) => failed.checkId);
    return {
      status: "proposed",
      plan: {
        addressedCheckIds: [...failedCheckIds],
        suspectedRootCause: "add() in src/sum.js subtracts instead of adding; sum-check observes add(2,3) !== 5",
        supportingEvidence: [`exit code seen in ${failedCheckIds.join(",")} output`],
        filesToChange: [CHECK_FILE],
        expectedBehaviourChange: "add(2,3) returns 5",
        risks: ["none observed beyond the one-line fix"],
        checksToRerun: [...failedCheckIds],
        checksToRemainUnchanged: [],
        rollbackPlan: "revert src/sum.js",
      },
    };
  };

  // With --live the production adapter replaces the scripted invoker. There is
  // no fallback: a live provider failure propagates as LiveBlocked below.
  const invoker = liveInvoker === null
    ? scriptedInvoker
    : async (request) => {
        activeAttemptId = request.attemptId;
        noteState("invoker");
        return liveInvoker.invoke(request);
      };

  // SCRIPTED edit executor (not a live model): happy writes the real fix,
  // negative touches the file without fixing the defect.
  const editExecutor = async (editRequest) => {
    say(`[SCRIPTED edit-executor] variant=${label} planFiles=${editRequest.plan.filesToChange.join(",")}`);
    noteState("edit");
    const target = path.join(editRequest.workspaceDir, CHECK_FILE);
    writeFileSync(target, fixSource ? FIXED_SUM_JS : UNFIXED_TOUCH_SUM_JS);
    return { changedFiles: [CHECK_FILE] };
  };

  // REAL verification runner, wrapped only to observe the reverifying state.
  const runner = async (input) => {
    if (!checkIdsSeen.includes(input.check.checkId)) checkIdsSeen.push(input.check.checkId);
    noteState("runner");
    return runVerificationCommand(input);
  };

  const outcome = await runRepairAttempt({
    taskId,
    runId: taskId,
    runEpoch: epoch,
    workspaceId: `e2e-ws-${label}`,
    attemptNumber: 1,
    failedCheckIds: [CHECK_ID],
    failedEvidenceIds: [],
    diagnosisRevision: originalRevision,
    catalogue,
    evidenceRoot,
    workspaceDir,
    repairStoreRoot,
    invoker,
    editExecutor,
    runner,
  });
  if (liveInvoker !== null) {
    const blocked = liveInvoker.blocked();
    if (blocked !== null) throw blocked;
  }
  if (!statesVisited.includes(outcome.finalState)) statesVisited.push(outcome.finalState);

  const resultingRevision = workspaceRevision(workspaceDir);
  const fixedContent = readFileSync(path.join(workspaceDir, CHECK_FILE), "utf8");
  const evidenceFiles = listEvidenceFiles(evidenceRoot, taskId);
  const evidenceRecords = evidenceFiles.map(readJson);
  const gateVerdict = evaluateOrdinaryCompletion({
    taskId,
    catalogue,
    evidenceRoot,
    workspaceDir,
    epoch,
  });
  const stored = createRepairAttemptStore({ root: repairStoreRoot }).load(outcome.attemptId);

  const trace = {
    taskId,
    epoch,
    attemptId: outcome.attemptId,
    originalRevision,
    resultingRevision,
    changedFiles: [...outcome.changedFiles],
    checkIds: [...checkIdsSeen].sort(),
    evidencePaths: evidenceFiles,
    repairStatesVisited: [...statesVisited],
    gateVerdict: outcome.gateVerdict ?? null,
    independentGateVerdict: gateVerdict.verification,
    liveModel: liveInvoker !== null,
  };
  if (liveInvoker !== null) trace.model = { ...liveInvoker.traceModel(), scriptedInvocations };

  return {
    label,
    seedRecord,
    outcome,
    originalRevision,
    resultingRevision,
    fixedContent,
    evidenceFiles,
    evidenceRecords,
    gateVerdict,
    stored,
    trace,
  };
}

// ---------------------------------------------------------------------------
// LIVE mode (--live): the model boundary is the production adapter.
// ---------------------------------------------------------------------------

const LIVE_SYSTEM_INSTRUCTIONS = [
  "You are the repair diagnosis model for a coding agent's repair loop.",
  "The host builds the diagnosis context from durable verification evidence; it is the ONLY evidence you may cite. Never invent a failed check, a file, or an observation the context does not contain.",
  "Answer with exactly one JSON object that satisfies the required output contract. When correctionRound is greater than 0, revise the previous repairPlan so every previousViolations message is satisfied.",
  "The repairPlan is a proposal. A separate verification gate decides whether the repair worked, so never claim completion.",
].join(" ");

const LIVE_OUTPUT_CONTRACT = `Respond with exactly one JSON object and nothing else (no prose, no markdown fence), in this shape:
{
  "defensible": true,
  "observedFacts": ["<fact you rely on, taken from the diagnosis context>"],
  "hypotheses": [
    { "statement": "<what the defect is>", "supportingFactIndexes": [0], "supportingEvidence": ["<evidence from the context>"] }
  ],
  "supportingEvidence": ["<evidence from the context>"],
  "confidence": 0.8,
  "missingInformation": [],
  "proposedNextAction": "<the smallest next action>",
  "repairPlan": {
    "addressedCheckIds": ["<failed check id named in the diagnosis context>"],
    "suspectedRootCause": "<root cause>",
    "supportingEvidence": ["<evidence from the context>"],
    "filesToChange": ["<repo-relative path inside that check's configuredScope>"],
    "expectedBehaviourChange": "<observable behaviour change>",
    "risks": ["<risk, or a single 'none observed' entry>"],
    "checksToRerun": ["<failed check id named in the diagnosis context>"],
    "checksToRemainUnchanged": [],
    "rollbackPlan": "<how to revert the change>"
  }
}
Rules: supportingFactIndexes index observedFacts. Use the exact check ids and paths the context names. The plan is a proposal, never a completion claim.`;

class LiveBlocked extends Error {
  constructor(layer, message) {
    super(message);
    this.name = "LiveBlocked";
    this.layer = layer;
  }
}

function errorMessage(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    if (current instanceof Error) {
      if (current.message) parts.push(current.message);
      current = current.cause;
    } else {
      const text = String(current);
      if (text.length > 0) parts.push(text);
      current = undefined;
    }
  }
  return parts.length > 0 ? parts.join(": ") : "unknown error";
}

// Never echo credential material, even if a provider error quoted it.
function redactSensitive(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*["']?[^\s"',;}]+/gi, "$1=[redacted]");
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

// The only live-mode exit path for a provider/engine failure: exactly one line
// on stdout, exit code 2, no scripted fallback.
function blockAndExit(error) {
  const blocked = error instanceof LiveBlocked ? error : new LiveBlocked("engine", errorMessage(error));
  const message = oneLine(redactSensitive(errorMessage(blocked)));
  const bounded = message.length > 600 ? `${message.slice(0, 600)}...` : message;
  writeSync(1, `LIVE: BLOCKED ${blocked.layer} ${bounded || "unknown provider error"}\n`);
  process.exit(2);
}

const PROVIDER_AUTH_PATTERN = /\b401\b|\b403\b|unauthori[sz]ed|unauthenticated|authenticat|forbidden|api[\s_-]?key|credential|expired|invalid token|no api key/i;
const PROVIDER_TRANSPORT_PATTERN = /fetch failed|econnrefused|econnreset|econnaborted|enotfound|etimedout|eai_again|network|socket|timed out|timeout|connection/i;

function classifyLiveFailure(error) {
  if (error instanceof LiveBlocked) return error;
  const message = errorMessage(error);
  const record = asObjectValue(error);
  const kind =
    record !== null && record.failure !== undefined && asString(record.failure.kind) !== null
      ? record.failure.kind
      : undefined;
  let layer = "provider_response";
  if (kind === "model_unavailable" || /no configured model|not found in the live registry/i.test(message)) {
    layer = "model_resolution";
  } else if (PROVIDER_AUTH_PATTERN.test(message)) {
    layer = "provider_auth";
  } else if (PROVIDER_TRANSPORT_PATTERN.test(message)) {
    layer = "provider_transport";
  } else if (kind === "session-create-failed" || kind === "session_unavailable") {
    layer = "engine";
  }
  return new LiveBlocked(layer, message);
}

function stripJsonFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[^\n]*\n/, "").replace(/\n```\s*$/, "").trim();
}

function isStringArrayValue(value) {
  return asStringArray(value) !== null;
}

function isNonBlankStringValue(value) {
  return asNonBlankString(value) !== null;
}

// Extract the model-authored repairPlan from the SAME answer the production
// parser validated. Nothing here is synthesised: a missing or mistyped field
// fails the live round instead of inventing plan content.
function extractModelPlan(raw) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch (error) {
    return { ok: false, detail: `the live model answer is not valid JSON: ${errorMessage(error)}` };
  }
  const answer = asRecord(parsed);
  const candidate = answer !== null ? answer.repairPlan : undefined;
  if (asRecord(candidate) === null) {
    return { ok: false, detail: "the live model answer carried no repairPlan object" };
  }
  const problems = [];
  if (!isStringArrayValue(candidate.addressedCheckIds) || candidate.addressedCheckIds.length === 0) problems.push("addressedCheckIds");
  if (!isNonBlankStringValue(candidate.suspectedRootCause)) problems.push("suspectedRootCause");
  if (!isStringArrayValue(candidate.supportingEvidence)) problems.push("supportingEvidence");
  if (!isStringArrayValue(candidate.filesToChange) || candidate.filesToChange.length === 0) problems.push("filesToChange");
  if (!isNonBlankStringValue(candidate.expectedBehaviourChange)) problems.push("expectedBehaviourChange");
  if (!isStringArrayValue(candidate.risks)) problems.push("risks");
  if (!isStringArrayValue(candidate.checksToRerun) || candidate.checksToRerun.length === 0) problems.push("checksToRerun");
  if (!isStringArrayValue(candidate.checksToRemainUnchanged)) problems.push("checksToRemainUnchanged");
  if (!isNonBlankStringValue(candidate.rollbackPlan)) problems.push("rollbackPlan");
  if (problems.length > 0) {
    return { ok: false, detail: `the live model repairPlan is missing or mistyped: ${problems.join(", ")}` };
  }
  const plan = {
    addressedCheckIds: [...candidate.addressedCheckIds],
    suspectedRootCause: candidate.suspectedRootCause,
    supportingEvidence: [...candidate.supportingEvidence],
    filesToChange: [...candidate.filesToChange],
    expectedBehaviourChange: candidate.expectedBehaviourChange,
    risks: [...candidate.risks],
    checksToRerun: [...candidate.checksToRerun],
    checksToRemainUnchanged: [...candidate.checksToRemainUnchanged],
    rollbackPlan: candidate.rollbackPlan,
  };
  if (isStringArrayValue(candidate.symbolsToChange)) plan.symbolsToChange = [...candidate.symbolsToChange];
  if (isNonBlankStringValue(candidate.scopeJustification)) plan.scopeJustification = candidate.scopeJustification;
  if (asBoolean(candidate.claimedComplete) !== null) plan.claimedComplete = candidate.claimedComplete;
  return { ok: true, plan };
}

// Build the live engine services exactly the way the host does
// (createAgentSessionServices): the engine owns AuthStorage/ModelRuntime and
// reads its own credential store. This harness never opens an auth file.
async function createLiveModelBoundary() {
  const { loadSenpiBarrel } = await import(path.join(SRC, "lazy", "senpi-barrel.ts"));
  const { createHostDiagnosisInvoker, requestRepairDiagnosis } = await import(
    path.join(SRC, "repair", "model-diagnosis.ts")
  );
  const { InProcessRunner } = await import(path.join(SRC, "runners", "in-process.ts"));

  const senpi = await loadSenpiBarrel();
  const agentDir = senpi.getAgentDir();
  let services;
  try {
    services = await senpi.createAgentSessionServices({
      cwd: ROOT,
      agentDir,
      // The parent's extensions/skills never run in-process for a QA harness;
      // the child runner builds its own builtin-only loader either way.
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      },
    });
  } catch (error) {
    throw new LiveBlocked("engine", `live engine services failed: ${errorMessage(error)}`);
  }

  const settings = services.settingsManager;
  let defaultProvider;
  let defaultModelId;
  try {
    defaultProvider = settings.getDefaultProvider();
    defaultModelId = settings.getDefaultModel();
  } catch (error) {
    throw new LiveBlocked("model_resolution", `configured model could not be read: ${errorMessage(error)}`);
  }

  let model;
  let resolution;
  if (isNonBlankStringValue(defaultProvider) && isNonBlankStringValue(defaultModelId)) {
    model = services.modelRegistry.find(defaultProvider, defaultModelId);
    if (model === undefined) {
      throw new LiveBlocked(
        "model_resolution",
        `configured model ${defaultProvider}/${defaultModelId} is not in the live registry`,
      );
    }
    resolution = "settings_default";
  } else {
    try {
      const available = await services.modelRuntime.getAvailable();
      model = available[0];
      resolution = "first_available";
    } catch (error) {
      throw new LiveBlocked("provider_response", `provider availability check failed: ${errorMessage(error)}`);
    }
  }
  if (model === undefined) {
    const runtimeError = services.modelRuntime.getError();
    throw new LiveBlocked(
      "model_resolution",
      `no configured provider/model resolved from the live engine registry (agent dir: ${agentDir})${runtimeError ? `: ${runtimeError}` : ""}`,
    );
  }

  return {
    agentDir,
    services,
    InProcessRunner,
    createHostDiagnosisInvoker,
    requestRepairDiagnosis,
    modelInfo: {
      provider: model.provider,
      providerName: services.modelRegistry.getProviderDisplayName(model.provider) || model.provider,
      modelId: model.id,
      model,
      resolution,
    },
  };
}

// One live invoker per variant. It owns that variant's child sessions and
// captures the evidence the trace needs (length + hash, never the text).
function createLiveVariantInvoker({ boundary, workspaceDir, label }) {
  const calls = [];
  const handles = new Set();
  let sequence = 0;
  let lastTurnModel = null;
  let blocked = null;

  const baseRunner = new boundary.InProcessRunner({});
  const observedRunner = {
    async start(spec) {
      const handle = await baseRunner.start(spec);
      handles.add(handle);
      return {
        waitForIdle: async () => {
          try {
            const outcome = await handle.waitForIdle();
            if (outcome.status === "completed" && asString(outcome.model) !== null) lastTurnModel = outcome.model;
            return outcome;
          } finally {
            handles.delete(handle);
          }
        },
        dispose: () => handle.dispose(),
      };
    },
  };

  const childSpecFor = (prompt) => {
    sequence += 1;
    const childTaskId = `repair-e2e-live-${label}-${sequence}`;
    return {
      taskId: childTaskId,
      cwd: workspaceDir,
      sessionDir: path.join(FIXROOT, "live-sessions", childTaskId),
      agentDir: boundary.agentDir,
      depth: 1,
      parentSessionId: "repair-e2e",
      rootSessionId: "repair-e2e",
      prompt,
      promptEnvelope: "bare",
      authStorage: boundary.services.authStorage,
      modelRegistry: boundary.services.modelRegistry,
      modelRuntime: boundary.services.modelRuntime,
      model: boundary.modelInfo.model,
    };
  };

  const hostInvoker = boundary.createHostDiagnosisInvoker({ runner: observedRunner, childSpecFor });

  const invokeHostModel = async (request) => {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new LiveBlocked("provider_transport", `the live model call exceeded ${LIVE_TIMEOUT_MS} ms`));
      }, LIVE_TIMEOUT_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([hostInvoker(request), timeout]);
    } catch (error) {
      for (const handle of handles) {
        try {
          await handle.abort();
        } catch {
          // Already gone.
        }
      }
      throw error;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };

  const invoke = async (request) => {
    const diagnosisRequest = {
      systemInstructions: LIVE_SYSTEM_INSTRUCTIONS,
      diagnosisContextJson: JSON.stringify(
        {
          ...request.diagnosis,
          correctionRound: request.correctionRound,
          previousViolations: [...(request.previousViolations ?? [])],
        },
        null,
        2,
      ),
      outputContract: LIVE_OUTPUT_CONTRACT,
    };
    let raw;
    try {
      raw = await invokeHostModel(diagnosisRequest);
    } catch (error) {
      blocked = classifyLiveFailure(error);
      throw blocked;
    }
    const sha256 = createHash("sha256").update(raw, "utf8").digest("hex");
    const call = {
      length: raw.length,
      sha256,
      scriptedSentinelPresent: raw.includes(SCRIPTED_PLAN_SENTINEL),
    };
    calls.push(call);
    say(
      `[LIVE model] attempt=${request.attemptId} correctionRound=${request.correctionRound} responseChars=${call.length} sha256=${sha256.slice(0, 12)}...`,
    );
    const parsed = await boundary.requestRepairDiagnosis(async () => raw, diagnosisRequest);
    if (!parsed.ok) {
      if (parsed.reason === "no_defensible_diagnosis" || parsed.reason === "empty_answer") {
        return { status: "no_defensible_diagnosis", reason: parsed.detail };
      }
      throw new Error(parsed.detail);
    }
    const extracted = extractModelPlan(raw);
    if (!extracted.ok) throw new Error(extracted.detail);
    if (JSON.stringify(extracted.plan).includes(SCRIPTED_PLAN_SENTINEL)) call.scriptedSentinelPresent = true;
    return { status: "proposed", plan: extracted.plan };
  };

  return {
    invoke,
    blocked: () => blocked,
    traceModel: () => {
      const last = calls[calls.length - 1];
      return {
        provider: boundary.modelInfo.provider,
        providerName: boundary.modelInfo.providerName,
        modelId: boundary.modelInfo.modelId,
        modelResolution: boundary.modelInfo.resolution,
        invoker: "createHostDiagnosisInvoker",
        calls: calls.length,
        responseTextLength: last?.length ?? 0,
        responseTextSha256: last?.sha256 ?? "",
        scriptedSentinelPresent: calls.some((call) => call.scriptedSentinelPresent),
        turnReportedModel: lastTurnModel,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : "both";
const runHappy = only === "both" || only === "happy";
const runNegative = only === "both" || only === "negative";
if (!runHappy && !runNegative) {
  console.log(`RESULT: FAIL (unknown --only value: ${only})`);
  process.exit(1);
}

rmSync(FIXROOT, { recursive: true, force: true });
mkdirSync(FIXROOT, { recursive: true });

let liveBoundary = null;
if (liveMode) {
  try {
    liveBoundary = await createLiveModelBoundary();
    say(
      `[LIVE] provider=${liveBoundary.modelInfo.provider} providerName=${liveBoundary.modelInfo.providerName} model=${liveBoundary.modelInfo.modelId} resolution=${liveBoundary.modelInfo.resolution}`,
    );
  } catch (error) {
    blockAndExit(error);
  }
}

const happyTraceHolder = { current: null };
const negativeTraceHolder = { current: null };

if (runHappy) {
  let happy;
  try {
    // One live invoker per variant: it owns that variant's child sessions.
    const happyLive = liveBoundary === null
      ? null
      : createLiveVariantInvoker({
          boundary: liveBoundary,
          workspaceDir: path.join(FIXROOT, "happy-ws"),
          label: "happy",
        });
    happy = await runVariant({
      taskId: "repair-e2e",
      workspaceDir: path.join(FIXROOT, "happy-ws"),
      evidenceRoot: path.join(FIXROOT, "evidence-happy"),
      repairStoreRoot: path.join(FIXROOT, "repairs-happy"),
      epoch: 0,
      fixSource: true,
      liveInvoker: happyLive,
    });
  } catch (error) {
    if (error instanceof LiveBlocked) blockAndExit(error);
    throw error;
  }

  check("A01", happy.seedRecord !== null && happy.seedRecord.status === "failed",
    `seed evidence detects the defect (status=${happy.seedRecord ? happy.seedRecord.status : "none"})`);
  check("A02", happy.outcome.attemptId.length > 0 && happy.trace.originalRevision === happy.originalRevision,
    `diagnosis revision attributable (${happy.originalRevision.slice(0, 12)}...)`);
  check("A03", happy.outcome.finalState === "repaired",
    `final state is repaired (got ${happy.outcome.finalState})`);
  check("A04", happy.outcome.gateVerdict === "verified",
    `gate verdict is verified (got ${happy.outcome.gateVerdict})`);
  check("A05", happy.resultingRevision !== happy.originalRevision,
    `revision differs after repair (${happy.originalRevision.slice(0, 12)}... -> ${happy.resultingRevision.slice(0, 12)}...)`);
  check("A06", happy.fixedContent.includes("a + b") && !happy.fixedContent.includes("a - b"),
    "fixture source file on disk carries the fix");
  check("A07", happy.outcome.changedFiles.includes(CHECK_FILE),
    `changedFiles names ${CHECK_FILE}`);
  check("A08", happy.trace.checkIds.includes(CHECK_ID),
    `executed checks include ${CHECK_ID}`);
  check("A09", happy.evidenceFiles.length > 0 && happy.evidenceRecords.some((record) => record && record.status === "passed"),
    `${happy.evidenceFiles.length} evidence file(s), at least one passed`);
  const expectedStates = ["diagnosing", "repair_planned", "reverifying", "repaired"];
  check("A10", JSON.stringify(happy.trace.repairStatesVisited) === JSON.stringify(expectedStates),
    `repair states visited in order (${happy.trace.repairStatesVisited.join(" -> ")})`);
  check("A11", happy.gateVerdict.verification === "verified",
    `independent completion gate agrees: verified`);
  if (liveMode) {
    check("A12", happy.trace.liveModel === true
      && asString(happy.trace.model?.provider) !== null && happy.trace.model.provider.length > 0
      && asString(happy.trace.model?.modelId) !== null && happy.trace.model.modelId.length > 0,
      `trace records liveModel=true (${happy.trace.model?.provider ?? "?"}/${happy.trace.model?.modelId ?? "?"})`);
    check("A14", happy.trace.model.calls > 0
      && happy.trace.model.responseTextLength > 0
      && /^[0-9a-f]{64}$/.test(happy.trace.model.responseTextSha256)
      && happy.trace.model.scriptedSentinelPresent === false
      && happy.trace.model.scriptedInvocations === 0,
      `live model response hashed (${happy.trace.model.responseTextLength} chars, sha256 ${happy.trace.model.responseTextSha256.slice(0, 12)}...) and no scripted-invoker text`);
  } else {
    check("A12", happy.trace.liveModel === false,
      "trace records liveModel=false (scripted, not live)");
  }
  check("A13", happy.stored !== null && happy.stored.state === "repaired" && happy.stored.outcome?.result === "repaired",
    "durable repair attempt persists as repaired");

  say(`happy attemptId=${happy.outcome.attemptId}`);
  say(`happy originalRevision=${happy.originalRevision}`);
  say(`happy resultingRevision=${happy.resultingRevision}`);
  happyTraceHolder.current = happy.trace;
}

if (runNegative) {
  let negative;
  try {
    const negativeLive = liveBoundary === null
      ? null
      : createLiveVariantInvoker({
          boundary: liveBoundary,
          workspaceDir: path.join(FIXROOT, "negative-ws"),
          label: "negative",
        });
    negative = await runVariant({
      taskId: "repair-e2e-neg",
      workspaceDir: path.join(FIXROOT, "negative-ws"),
      evidenceRoot: path.join(FIXROOT, "evidence-negative"),
      repairStoreRoot: path.join(FIXROOT, "repairs-negative"),
      epoch: 0,
      fixSource: false,
      liveInvoker: negativeLive,
    });
  } catch (error) {
    if (error instanceof LiveBlocked) blockAndExit(error);
    throw error;
  }

  check("N01", negative.outcome.finalState === "repair_failed",
    `final state is repair_failed (got ${negative.outcome.finalState})`);
  check("N02", negative.outcome.gateVerdict === "blocked" && negative.gateVerdict.verification === "blocked",
    `gate returns blocked (outcome=${negative.outcome.gateVerdict}, independent=${negative.gateVerdict.verification})`);
  check("N03", (negative.outcome.reason ?? "").includes("reverification_blocked"),
    `blocked by failed reverification (reason=${negative.outcome.reason})`);
  check("N04", negative.outcome.changedFiles.length > 0 && negative.resultingRevision !== negative.originalRevision,
    "repair edited (revision moved) but did not fix");
  const repairFiles = (() => {
    const dir = path.join(FIXROOT, "repairs-negative", negative.trace.taskId);
    try {
      return readdirSync(dir).map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  })();
  const haystacks = [...negative.evidenceFiles, ...repairFiles]
    .filter((file) => file.endsWith(".json") && existsSync(file) && statSync(file).isFile())
    .map((file) => readFileSync(file, "utf8"));
  haystacks.push(JSON.stringify(negative.outcome));
  check("N05", haystacks.length > 0 && haystacks.every((text) => !text.includes('"verified"')),
    `no "verified" token in ${haystacks.length} evidence/repair payload(s)`);
  const expectedNegativeStates = ["diagnosing", "repair_planned", "reverifying", "repair_failed"];
  check("N06", JSON.stringify(negative.trace.repairStatesVisited) === JSON.stringify(expectedNegativeStates),
    `repair states visited in order (${negative.trace.repairStatesVisited.join(" -> ")})`);

  say(`negative attemptId=${negative.outcome.attemptId}`);
  negativeTraceHolder.current = negative.trace;
}

// Trace first (it must survive cleanup), then remove the throwaway workspaces.
const trace = {
  version: 1,
  createdAt: new Date().toISOString(),
  liveModel: liveMode,
  ...(liveMode
    ? {
        // The model boundary is live; the edit boundary stays the harness's
        // labelled scripted executor (no production edit-executor exists yet).
        scriptedInvoker: false,
        scriptedEditExecutor: true,
        model: {
          provider: liveBoundary.modelInfo.provider,
          providerName: liveBoundary.modelInfo.providerName,
          modelId: liveBoundary.modelInfo.modelId,
          modelResolution: liveBoundary.modelInfo.resolution,
          invoker: "createHostDiagnosisInvoker",
        },
      }
    : { scripted: true }),
  happy: happyTraceHolder.current,
  negative: negativeTraceHolder.current,
};
mkdirSync(path.dirname(TRACE_PATH), { recursive: true });
writeFileSync(TRACE_PATH, JSON.stringify(trace, null, 2) + "\n");
say(`trace: ${TRACE_PATH}`);

for (const workspace of [
  path.join(FIXROOT, "happy-ws"),
  path.join(FIXROOT, "negative-ws"),
  path.join(FIXROOT, "live-sessions"),
]) {
  rmSync(workspace, { recursive: true, force: true });
}

const failed = failures.length > 0;
say(`RESULT: ${failed ? "FAIL" : "PASS"} (${failures.length === 0 ? "all assertions held" : `failed: ${failures.join(", ")}`})`);
flushOutput();
process.exit(failed ? 1 : 0);
