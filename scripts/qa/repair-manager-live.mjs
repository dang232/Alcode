/**
 * LIVE manager-level repair acceptance harness.
 *
 * This is the missing proof recorded in .omo/ulw/p231c-report.md section 6b:
 * the repair engine was proven live only when driven DIRECTLY (repair-e2e.mjs),
 * while the manager path was proven only with a scripted invoker
 * (manager/repair-wiring.test.ts). This script drives the REAL
 * createTaskManager from packages/omo-engine/senpi-task/src/manager/manager.ts
 * and lets its ordinary completion path start the repair attempt.
 *
 * What is real:
 *   - the manager (createTaskManager) with its real options and real store;
 *   - the ordinary completion gate (evaluateOrdinaryCompletion);
 *   - the spawn-time approved catalogue and the host-owned approval authority;
 *   - the worker verification tool the manager installs on the child spec, so
 *     the failing evidence comes from the REAL check command through the REAL
 *     ordinary capture path (not a hand-written evidence file);
 *   - the repair attempt store, plan validator and reverification runner;
 *   - the PRODUCTION diagnosis invoker: createHostDiagnosisInvoker
 *     (repair/model-diagnosis.ts) over the host's real InProcessRunner and the
 *     live registry/model resolved from the Senpi settings.
 *
 * What is deliberately a deterministic stub, and labelled as such in the trace:
 *   - the ordinary worker itself (an in-process stub that calls the host
 *     verification tool once and then settles "completed");
 *   - the edit executor (the manager's own default no-op behaviour, injected
 *     only so the harness can observe the repair_planned state). No production
 *     patch executor can be built from a validated RepairPlan: applyRepairEdits
 *     needs explicit oldText/newText edits the plan does not carry.
 *
 * Because the edit executor makes no change, reverification re-runs the same
 * failing check: the attempt settles repair_failed and the task stays blocked.
 * That is the correct terminal for this proof - the live model path is what is
 * measured, not a fabricated repair success. A "verified" word is never written.
 *
 * No credential is read, printed, copied or passed on a command line. The model
 * response is recorded only as length + SHA-256, never as text.
 *
 * Exit codes:
 *   0  every assertion held (trace written)
 *   1  an assertion failed (trace written when the run reached completion)
 *   2  LIVE: BLOCKED <reason> - provider/model unavailable; no scripted fallback
 *
 * Usage:
 *   node scripts/qa/repair-manager-live.mjs
 *   bun scripts/qa/repair-manager-live.mjs
 *
 * Trace: .omo/ulw/p231c/manager-live-trace.json
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
const TRACE_PATH = path.join(ROOT, ".omo", "ulw", "p231c", "manager-live-trace.json");
const CHECK_ID = "sum-check";
const CHECK_FILE = "src/sum.js";
const PARENT_SESSION_ID = "repair-manager-live-parent";

const LIVE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.REPAIR_MANAGER_LIVE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();
const REPAIR_WAIT_MS = LIVE_TIMEOUT_MS + 60_000;

// All harness output is buffered so a BLOCKED exit prints exactly one line.
const output = [];
function say(line) {
  output.push(line);
}
function flushOutput() {
  for (const line of output) console.log(line);
  output.length = 0;
}

// ---------------------------------------------------------------------------
// Dual-runtime entry: the real chain is imported from extensionless
// TypeScript sources, which needs Bun. Plain `node` re-execs under bun.
// ---------------------------------------------------------------------------
const isBun = Object.prototype.toString.call(process.versions.bun) === "[object String]";
if (!isBun && !process.argv.includes("--no-reexec") && !process.env.REPAIR_MANAGER_LIVE_VIA_BUN) {
  const candidates = process.platform === "win32" ? ["bun", "bun.exe"] : ["bun"];
  let done = false;
  for (const candidate of candidates) {
    let res;
    try {
      res = spawnSync(candidate, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
        stdio: "inherit",
        env: { ...process.env, REPAIR_MANAGER_LIVE_VIA_BUN: "1" },
      });
    } catch {
      continue;
    }
    if (res.error && res.error.code === "ENOENT") continue;
    done = true;
    process.exit(res.status ?? 1);
  }
  if (!done) {
    console.log("RESULT: FAIL (bun runtime not found; repair-manager-live needs bun to import the real TS chain)");
    process.exit(1);
  }
}

// Real modules, imported dynamically so the bun re-exec runs first.
const { createTaskRecordStore } = await import(path.join(SRC, "store", "index.ts"));
const { createTaskManager } = await import(path.join(SRC, "manager", "manager.ts"));
const { OmoTaskSettingsSchema } = await import(
  path.join(ROOT, "packages", "omo-engine", "omo-config-core", "src", "index.ts")
);
const { approvalAuthorityFor } = await import(path.join(SRC, "verification", "approval-authority.ts"));
const { approveCandidate } = await import(path.join(SRC, "verification", "approval-store.ts"));
const { readApprovals } = await import(path.join(SRC, "verification", "approval-store.ts"));
const { VERIFICATION_CONFIG_VERSION } = await import(path.join(SRC, "verification", "config.ts"));
const { candidateForApproval, resolveCatalogue, WORKSPACE_ID } = await import(
  path.join(SRC, "verification", "resolution.ts")
);
const { workspaceRevision } = await import(path.join(SRC, "verification", "evidence-store.ts"));
const { evaluateOrdinaryCompletion } = await import(path.join(SRC, "verification", "completion-gate.ts"));
const { buildCompletionDetails } = await import(path.join(SRC, "completion", "notification.ts"));
const { createRepairAttemptStore } = await import(path.join(SRC, "repair", "store.ts"));
const { runVerificationCommand } = await import(path.join(SRC, "dag", "verification.ts"));

// ---------------------------------------------------------------------------
// Fixture: a tiny git repo with a genuine defect. The committed source adds by
// subtracting; the committed check fails until it is fixed.
// ---------------------------------------------------------------------------
const DEFECTIVE_SUM_JS = `// Adds two numbers. (Defect: subtracts instead of adding.)
export function add(a, b) {
  return a - b;
}
`;

const SUM_CHECK_MJS = `import { add } from "../src/sum.js";
const got = add(2, 3);
if (got !== 5) {
  console.error(\`sum-check: add(2, 3) = \${got}, want 5\`);
  process.exit(1);
}
console.log("sum-check: add(2, 3) = 5 ok");
`;

function git(workspaceDir, ...args) {
  execFileSync("git", ["-C", workspaceDir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

function buildFixture(workspaceDir) {
  mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
  mkdirSync(path.join(workspaceDir, "checks"), { recursive: true });
  mkdirSync(path.join(workspaceDir, ".alcode"), { recursive: true });
  writeFileSync(path.join(workspaceDir, "src", "sum.js"), DEFECTIVE_SUM_JS);
  writeFileSync(path.join(workspaceDir, "checks", "sum-check.mjs"), SUM_CHECK_MJS);
  writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify({ name: "repair-manager-live-fixture", private: true, type: "module" }, null, 2) + "\n",
  );
  writeFileSync(
    path.join(workspaceDir, ".alcode", "verification.json"),
    JSON.stringify({
      version: VERIFICATION_CONFIG_VERSION,
      checks: [
        {
          id: CHECK_ID,
          name: "sum-check",
          category: "unit",
          command: ["node", "checks/sum-check.mjs"],
        },
      ],
    }),
  );
  git(workspaceDir, "init", "-q");
  git(workspaceDir, "add", "-A");
  git(
    workspaceDir,
    "-c",
    "user.email=repair-manager-live@example.com",
    "-c",
    "user.name=repair-manager-live",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture: defective add() plus a check that detects it",
  );
}

function approveFixtureCheck(workspaceDir, authorityRoot) {
  const authority = approvalAuthorityFor(workspaceDir, authorityRoot);
  const candidate = candidateForApproval({
    projectRoot: workspaceDir,
    workspaceId: WORKSPACE_ID,
    changedFiles: [],
    checkId: CHECK_ID,
  });
  if (candidate === null) throw new Error("expected a config candidate for the fixture check");
  approveCandidate({
    authority,
    candidate: {
      fingerprint: candidate.fingerprint,
      checkId: candidate.checkId,
      command: candidate.command,
      cwd: candidate.cwd,
      packageScope: candidate.packageScope,
      timeoutMs: candidate.timeoutMs,
    },
    workspaceId: WORKSPACE_ID,
    configVersion: VERIFICATION_CONFIG_VERSION,
    approvedBy: "repair-manager-live",
  });
}

// ---------------------------------------------------------------------------
// The ordinary worker stub. It is the only non-live piece of the task path: it
// calls the production worker verification tool the manager installed on the
// spec (real check command, real evidence), then settles "completed".
// ---------------------------------------------------------------------------
function makeInProcessStub() {
  const handles = new Map();
  const specs = [];
  const runner = {
    async start(spec) {
      specs.push(spec);
      const listeners = new Set();
      let resolveOutcome = () => {};
      let outcome = new Promise((resolve) => {
        resolveOutcome = resolve;
      });
      const handle = {
        task_id: spec.taskId,
        sessionId: `stub-${spec.taskId}`,
        steer: async () => {},
        followUp: async () => {},
        abort: async () => {},
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        onParked: () => () => {},
        waitForOutcome: () => outcome,
        onSelfResumed: () => () => {},
        lastAssistantText: () => undefined,
        dispose: async () => {},
      };
      const settle = (value) => {
        const resolveCurrent = resolveOutcome;
        outcome = new Promise((resolve) => {
          resolveOutcome = resolve;
        });
        resolveCurrent(value);
      };
      handles.set(spec.taskId, { handle, settle });
      return handle;
    },
  };
  return { runner, handles, specs };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// Live model boundary: the production adapter over the host's real runner.
// ---------------------------------------------------------------------------
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

function redactSensitive(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)\b\s*[:=]\s*["']?[^\s"',;}]+/gi,
      "$1=[redacted]",
    );
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

const PROVIDER_AUTH_PATTERN =
  /\b401\b|\b403\b|unauthori[sz]ed|unauthenticated|authenticat|forbidden|api[\s_-]?key|credential|expired|invalid token|no api key/i;
const PROVIDER_TRANSPORT_PATTERN =
  /fetch failed|econnrefused|econnreset|econnaborted|enotfound|etimedout|eai_again|network|socket|timed out|timeout|connection/i;

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
  if (
    asNonBlankString(defaultProvider) !== null &&
    asNonBlankString(defaultModelId) !== null
  ) {
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
  if (!isStringArrayValue(candidate.addressedCheckIds) || candidate.addressedCheckIds.length === 0) {
    problems.push("addressedCheckIds");
  }
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

// One live invoker. Its `invoke` is the orchestrator-seam wrapper the manager
// calls; inside it the PRODUCTION adapter makes the model call.
function createLiveInvoker({ boundary, workspaceDir, sessionRoot }) {
  const calls = [];
  const handles = new Set();
  let sequence = 0;
  let lastTurnModel = null;
  let blocked = null;
  let noteState = () => {};

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
    const childTaskId = `repair-manager-live-${sequence}`;
    return {
      taskId: childTaskId,
      cwd: workspaceDir,
      sessionDir: path.join(sessionRoot, childTaskId, "sessions", childTaskId),
      agentDir: boundary.agentDir,
      depth: 1,
      parentSessionId: PARENT_SESSION_ID,
      rootSessionId: PARENT_SESSION_ID,
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
    noteState();
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
    calls.push({ length: raw.length, sha256, correctionRound: request.correctionRound });
    say(
      `[LIVE model] attempt=${request.attemptId} correctionRound=${request.correctionRound} responseChars=${raw.length} sha256=${sha256.slice(0, 12)}...`,
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
    return { status: "proposed", plan: extracted.plan };
  };

  return {
    invoke,
    setStateObserver: (observer) => {
      noteState = observer;
    },
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
        responseHashes: calls.map((call) => call.sha256),
        correctionRounds: calls.map((call) => call.correctionRound),
        turnReportedModel: lastTurnModel,
        scriptedInvoker: false,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Evidence + assertions.
// ---------------------------------------------------------------------------
const failures = [];

function check(id, cond, detail) {
  const mark = cond ? "PASS" : "FAIL";
  say(`${mark} ${id} ${detail}`);
  if (!cond) failures.push(id);
  return cond;
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readEvents(store, taskId) {
  try {
    const text = readFileSync(path.join(store.stateDir, "logs", `${taskId}.jsonl`), "utf8");
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function blockAndExit(error) {
  const blocked = error instanceof LiveBlocked ? error : new LiveBlocked("engine", errorMessage(error));
  const message = oneLine(redactSensitive(errorMessage(blocked)));
  const bounded = message.length > 600 ? `${message.slice(0, 600)}...` : message;
  writeSync(1, `LIVE: BLOCKED ${blocked.layer} ${bounded || "unknown provider error"}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "repair-manager-live-"));
const workspace = path.join(fixtureRoot, "work");
const stateRoot = path.join(fixtureRoot, "state");
const authorityRoot = path.join(fixtureRoot, "authority");
const sessionRoot = path.join(fixtureRoot, "live-sessions");

let liveInvoker = null;
let store = null;
let manager = null;
let stub = null;
let traceWritten = false;

try {
  buildFixture(workspace);
  approveFixtureCheck(workspace, authorityRoot);
  mkdirSync(sessionRoot, { recursive: true });

  store = createTaskRecordStore({ project_dir: fixtureRoot, task: { state_dir: stateRoot } });
  const repairRoot = path.join(store.stateDir, "repairs");
  const evidenceRoot = path.join(store.stateDir, "verifications");

  const boundary = await createLiveModelBoundary();
  say(
    `[LIVE] provider=${boundary.modelInfo.provider} providerName=${boundary.modelInfo.providerName} model=${boundary.modelInfo.modelId} resolution=${boundary.modelInfo.resolution}`,
  );

  liveInvoker = createLiveInvoker({ boundary, workspaceDir: workspace, sessionRoot });
  stub = makeInProcessStub();

  // Deterministic observation of the repair states reachable at an injected
  // manager seam. `repairing` is a synchronous edge between repair_planned and
  // reverifying inside runRepairAttempt and has no injection point.
  const repairStore = createRepairAttemptStore({ root: repairRoot });
  let observedTaskId = null;
  const statesVisited = [];
  const noteState = () => {
    if (observedTaskId === null) return;
    let attempts = [];
    try {
      attempts = repairStore.list(observedTaskId);
    } catch {
      return;
    }
    const state = attempts[attempts.length - 1]?.state;
    if (state !== undefined && !statesVisited.includes(state)) statesVisited.push(state);
  };
  liveInvoker.setStateObserver(noteState);

  const observedEditExecutor = async () => {
    noteState();
    // Identical to the manager's default edit executor: no production patch
    // executor can be built from a validated RepairPlan (no oldText/newText).
    return { changedFiles: [] };
  };
  const observedRunner = async (input) => {
    noteState();
    return runVerificationCommand(input);
  };

  manager = createTaskManager({
    store,
    runners: { "in-process": stub.runner, process: stub.runner },
    planner: () => ({ kind: "resolved", plan: { model: "stub/ordinary-worker" } }),
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
    cwd: workspace,
    verificationAuthorityRoot: authorityRoot,
    repair: { invoker: liveInvoker.invoke, editExecutor: observedEditExecutor, runner: observedRunner },
  });

  const started = await manager.start({
    prompt: "Fix the failing sum check.",
    parent_session_id: PARENT_SESSION_ID,
    depth: 1,
    cwd: workspace,
    execution_mode: "in-process",
    run_in_background: true,
  });
  if (started.kind !== "started") throw new Error(`expected started: ${JSON.stringify(started)}`);
  const taskId = started.task_id;
  observedTaskId = taskId;

  const runningRecord = store.load(taskId);
  if (runningRecord === null) throw new Error("task record missing right after start");
  const runEpoch = runningRecord.notification.run_epoch;

  // The ordinary worker asks the host to verify through the production tool the
  // manager installed; the REAL check command runs and writes failing evidence.
  const spec = stub.specs.find((entry) => entry.taskId === taskId);
  if (spec === undefined) throw new Error("the stub runner never received the managed start spec");
  if (spec.verificationTool === undefined) throw new Error("the manager did not install a verification tool on the spec");
  const originalRevision = workspaceRevision(workspace);
  const verifyResult = await spec.verificationTool.execute();
  const executed = verifyResult?.details?.executed ?? [];
  const persistedEvidence = verifyResult?.details?.persisted ?? 0;

  // Subscribe to the exact manager event before triggering the completion.
  const events = [];
  let resolveFinished = () => {};
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });
  const originalAppend = store.appendEvent.bind(store);
  store.appendEvent = (id, event) => {
    const result = originalAppend(id, event);
    if (id === taskId) {
      events.push(event);
      if (event.type === "repair_finished") resolveFinished();
    }
    return result;
  };

  const waiter = manager.waitFor(taskId);
  stub.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" });
  const terminal = await withTimeout(waiter, 15_000, "ordinary terminal");
  const finishedEvent = await withTimeout(finished, REPAIR_WAIT_MS, "repair_finished");

  // A provider/model failure is the ONLY live-BLOCKED path. It never falls back
  // to a scripted invoker; the orchestrator records repair_failed and we exit 2.
  if (liveInvoker.blocked() !== null) blockAndExit(liveInvoker.blocked());

  const resultingRevision = workspaceRevision(workspace);
  const attempts = repairStore.list(taskId);
  const attempt = attempts[attempts.length - 1];
  if (attempt !== undefined && !statesVisited.includes(attempt.state)) statesVisited.push(attempt.state);

  const persistedRecord = readJsonFile(path.join(store.stateDir, "tasks", `${taskId}.json`));
  const persistedVerdict = persistedRecord?.verification_status ?? null;
  const logEvents = readEvents(store, taskId);
  const blockedEvent = logEvents.find((event) => event.type === "verification_blocked");
  const repairFinished = logEvents.find((event) => event.type === "repair_finished");

  // The production completion-details builder, applied to the persisted terminal
  // record (the raw record is the carrier of the stamped verification_status).
  let notification = null;
  if (persistedRecord !== null) {
    const details = buildCompletionDetails(persistedRecord, { stateDir: store.stateDir });
    notification = {
      taskId: details.task_id,
      status: details.status,
      verificationStatus: details.verification_status ?? null,
      finalResponse: details.final_response,
    };
  }

  const authority = approvalAuthorityFor(workspace, authorityRoot);
  const approvals = readApprovals(authority, WORKSPACE_ID);
  const catalogue = resolveCatalogue({
    projectRoot: workspace,
    workspaceId: WORKSPACE_ID,
    changedFiles: null,
    authority,
    approvals,
  });
  const independentGate = evaluateOrdinaryCompletion({
    taskId,
    catalogue,
    evidenceRoot,
    workspaceDir: workspace,
    epoch: runEpoch,
  });

  const model = liveInvoker.traceModel();
  const changedFiles = Array.isArray(repairFinished?.payload?.changed_files)
    ? [...repairFinished.payload.changed_files]
    : [];
  const gateVerdict = repairFinished?.payload?.gate_verdict ?? null;

  const trace = {
    version: 1,
    createdAt: new Date().toISOString(),
    liveModel: true,
    scriptedInvoker: false,
    invocation: {
      entrypoint: "createTaskManager(...).start -> ordinary completion gate -> manager repair wiring -> runRepairAttempt",
      manager: "packages/omo-engine/senpi-task/src/manager/manager.ts",
      ordinaryWorker: "in-process stub that calls the manager-installed worker verification tool, then settles completed",
      editExecutor: "no-op identical to the manager default (a validated RepairPlan carries no patch text)",
      verifier: "real runVerificationCommand over the fixture check",
    },
    taskId,
    runEpoch,
    repairAttemptId: attempt?.attemptId ?? repairFinished?.payload?.attempt_id ?? null,
    repairAttemptsPersisted: attempts.length,
    repairStatesVisited: statesVisited,
    repairStatesNote:
      "states observed at injected manager seams; `repairing` is a synchronous internal edge between repair_planned and reverifying with no injection point",
    finalRepairState: attempt?.state ?? repairFinished?.payload?.final_state ?? null,
    originalRevision,
    resultingRevision,
    changedFiles,
    gateVerdict,
    independentGateVerdict: independentGate.verification,
    independentGateCode: independentGate.code ?? null,
    terminalStatus: terminal.status,
    terminalErrorMessage: terminal.error_message ?? null,
    terminalVerificationStatus: persistedVerdict,
    verificationBlockedEvent: blockedEvent?.payload ?? null,
    repairFinishedEvent: repairFinished?.payload ?? null,
    parentNotification: notification,
    model,
    ordinaryWorker: {
      verificationToolExecuted: executed.length > 0,
      executed,
      persistedEvidence,
      verifyIsError: verifyResult?.isError ?? null,
    },
    eventTypes: logEvents.map((event) => event.type),
  };

  mkdirSync(path.dirname(TRACE_PATH), { recursive: true });
  writeFileSync(TRACE_PATH, JSON.stringify(trace, null, 2) + "\n");
  traceWritten = true;

  // ---- assertions -------------------------------------------------------
  check(
    "M01",
    asString(taskId) !== null && taskId.length > 0 && runEpoch === 0,
    `ordinary task started (${taskId}, run_epoch=${runEpoch})`,
  );
  check(
    "M02",
    executed.length === 1 &&
      executed[0].checkId === CHECK_ID &&
      executed[0].status !== "passed" &&
      persistedEvidence > 0,
    `worker verification tool ran ${CHECK_ID} for real (status=${executed[0]?.status ?? "none"}, evidence=${persistedEvidence})`,
  );
  check(
    "M03",
    terminal.status === "error" && String(terminal.error_message ?? "").includes("completion blocked"),
    `ordinary completion blocked its terminal (${terminal.status}: ${terminal.error_message ?? ""})`,
  );
  check(
    "M04",
    attempts.length === 1 &&
      attempt !== undefined &&
      attempt.taskId === taskId &&
      attempt.runEpoch === runEpoch &&
      attempt.attemptId === `${taskId}.e${runEpoch}.r1` &&
      attempt.failedCheckIds.includes(CHECK_ID),
    `exactly one durable repair attempt (${attempt?.attemptId ?? "none"})`,
  );
  check(
    "M05",
    model.calls >= 1 &&
      /^[0-9a-f]{64}$/.test(model.responseTextSha256) &&
      model.provider.length > 0 &&
      model.modelId.length > 0,
    `production diagnosis invoker made ${model.calls} live call(s), last sha256 ${String(model.responseTextSha256).slice(0, 12)}... (${model.provider}/${model.modelId})`,
  );
  check(
    "M06",
    asString(model.turnReportedModel) !== null && model.turnReportedModel.includes(model.modelId),
    `the in-process turn reported the live model (${model.turnReportedModel ?? "none"})`,
  );
  check(
    "M07",
    statesVisited.includes("diagnosing") && statesVisited.includes("repair_planned") && attempt?.plan !== undefined,
    `repair states observed: ${statesVisited.join(" -> ")}; the live plan was durably accepted`,
  );
  check(
    "M08",
    gateVerdict === "blocked" &&
      independentGate.verification === "blocked" &&
      independentGate.code === "verification_failed",
    `gate verdict is blocked (manager=${gateVerdict}, independent=${independentGate.verification}/${independentGate.code ?? "none"})`,
  );
  check(
    "M09",
    persistedVerdict === "blocked" && blockedEvent?.payload?.verification_status === "blocked",
    `terminal record and verification_blocked event carry verification_status=blocked (record=${persistedVerdict})`,
  );
  check(
    "M10",
    notification !== null && notification.verificationStatus === "blocked",
    `parent notification built from the persisted terminal record says verification_status=${notification?.verificationStatus ?? "none"}`,
  );
  check(
    "M11",
    attempt?.state === "repair_failed" && repairFinished?.payload?.final_state === "repair_failed",
    `repair settled repair_failed and published no success (${attempt?.state ?? "none"})`,
  );
  check(
    "M12",
    attempts.length === 1 && model.scriptedInvoker === false,
    "one attempt only; the model boundary is the production adapter, not a scripted invoker",
  );

  say(`repairAttemptId=${trace.repairAttemptId}`);
  say(`originalRevision=${trace.originalRevision}`);
  say(`resultingRevision=${trace.resultingRevision}`);
  say(
    `model=${model.provider}/${model.modelId} calls=${model.calls} responseChars=${model.responseTextLength} sha256=${model.responseTextSha256}`,
  );
  say(`trace: ${TRACE_PATH}`);
  say(`RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ${failures.length === 0 ? "(all assertions held)" : `(failed: ${failures.join(", ")})`}`);
  flushOutput();
  process.exit(failures.length === 0 ? 0 : 1);
} catch (error) {
  flushOutput();
  console.log(`RESULT: FAIL (${oneLine(redactSensitive(errorMessage(error)))})`);
  if (traceWritten) console.log(`trace: ${TRACE_PATH}`);
  process.exit(1);
} finally {
  try {
    rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    // Best effort; a temp fixture never blocks the verdict.
  }
}
