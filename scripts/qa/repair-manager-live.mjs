/**
 * LIVE manager-level repair acceptance harness.
 *
 * POSITIVE (default): proves a live model repair succeeds end to end through the
 * REAL ordinary Manager - no scripted invoker, no scripted edit executor.
 *
 * What is real:
 *   - createTaskManager (packages/omo-engine/senpi-task/src/manager/manager.ts)
 *     with its real store, real ordinary completion gate, real approval
 *     authority, and real verification catalogue;
 *   - the PRODUCTION diagnosis invoker: createHostDiagnosisInvoker
 *     (repair/model-diagnosis.ts) over the host's real InProcessRunner and the
 *     live registry/model resolved from the Senpi settings;
 *   - the manager DEFAULT edit executor: applyRepairEdits
 *     (repair/edit-executor.ts) over the run's workspace and the pre-repair
 *     revision baseline - the same authorized edit tool ordinary workers use;
 *   - the manager DEFAULT verification runner: runVerificationCommand, so the
 *     pre-repair failure and the post-repair rerun are genuine command runs
 *     with genuine evidence records;
 *   - the durable repair attempt store, plan validator, and reverification
 *     runner.
 *
 * The only stub is the ordinary worker itself: an in-process child handle that
 * calls the manager-installed worker verification tool once (real check, real
 * evidence) and then settles "completed". That is what puts the task in front
 * of the ordinary completion gate, which is what starts the repair.
 *
 * NEGATIVE (--negative): keeps the fail-closed proof. The live model path and
 * the real Manager are unchanged; after the model answers, the harness moves
 * the workspace (one untracked file) so the manager's pre-repair revision
 * baseline no longer matches. The real executor must refuse (revision
 * conflict), the attempt must settle repair_failed, the file must stay
 * defective, and nothing may say "verified".
 *
 * The model answer is recorded as length + SHA-256 (never the raw text). The
 * parsed repairPlan and the parser-converted fileOperations are recorded as
 * structured evidence; credentials are never read, printed, copied or passed
 * on a command line.
 *
 * Exit codes:
 *   0  every assertion held (trace written)
 *   1  an assertion failed (trace written when the run reached completion)
 *   2  LIVE: BLOCKED <reason> - provider/model unavailable; no scripted fallback
 *
 * Usage:
 *   node scripts/qa/repair-manager-live.mjs
 *   node scripts/qa/repair-manager-live.mjs --negative
 *
 * Traces:
 *   .omo/ulw/p232/manager-live-trace.json
 *   .omo/ulw/p232/manager-live-negative-trace.json
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
const TRACE_DIR = path.join(ROOT, ".omo", "ulw", "p232");
const TRACE_PATH = path.join(TRACE_DIR, "manager-live-trace.json");
const NEGATIVE_TRACE_PATH = path.join(TRACE_DIR, "manager-live-negative-trace.json");
const CHECK_ID = "sum-check";
const CHECK_FILE = "src/sum.js";
const PARENT_SESSION_ID = "repair-manager-live-parent";

const MODE = process.argv.includes("--negative") ? "negative" : "positive";

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
const { ORDINARY_VERIFICATION_NODE } = await import(path.join(SRC, "verification", "ordinary-capture.ts"));
const { parseVerificationRecord } = await import(path.join(SRC, "dag", "verification.ts"));

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
  "Answer with exactly one JSON object that satisfies the required output contract. When correctionRound is greater than 0, revise the previous repairPlan and fileOperations so every previousViolations message is satisfied.",
  "The repairPlan is a proposal. A separate verification gate decides whether the repair worked, so never claim completion.",
].join(" ");

// The answer carries BOTH halves the production chain consumes: the structured
// diagnosis (observedFacts/hypotheses/... + top-level fileOperations, parsed by
// repair/model-diagnosis.ts) and the repair plan (extracted by this harness and
// validated by repair/plan.ts). fileOperations MUST carry the exact change text
// or nothing can be applied.
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
  "fileOperations": [
    {
      "path": "<repo-relative path exactly as it appears in workspaceContext>",
      "operation": "modify",
      "find": "<verbatim substring of that file's current content; must occur exactly once>",
      "replace": "<the replacement text>"
    }
  ],
  "repairPlan": {
    "addressedCheckIds": ["<failed check id named in the diagnosis context>"],
    "suspectedRootCause": "<root cause>",
    "supportingEvidence": ["<evidence from the context>"],
    "filesToChange": ["<the same repo-relative path named in fileOperations>"],
    "expectedBehaviourChange": "<observable behaviour change>",
    "risks": ["<risk, or a single 'none observed' entry>"],
    "checksToRerun": ["<failed check id named in the diagnosis context>"],
    "checksToRemainUnchanged": [],
    "rollbackPlan": "<how to revert the change>"
  }
}
Rules: supportingFactIndexes index observedFacts. Use the exact check ids and file paths the context names. The find string must be copied verbatim from workspaceContext[].content. The plan is a proposal, never a completion claim.`;

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
// calls; inside it the PRODUCTION adapter makes the model call. The proposal it
// returns carries the parser-owned fileOperations, so the manager's DEFAULT
// edit executor receives real change text.
function createLiveInvoker({ boundary, workspaceDir, sessionRoot, repairStoreRoot, mode }) {
  const calls = [];
  const handles = new Set();
  const statesSeen = [];
  let sequence = 0;
  let lastTurnModel = null;
  let blocked = null;
  let lastPlan = null;
  let lastFileOperations = [];
  let lastViolations = [];
  let perturbation = null;

  const noteAttemptState = (attemptId) => {
    let state = null;
    try {
      state = createRepairAttemptStore({ root: repairStoreRoot }).load(attemptId)?.state ?? null;
    } catch {
      state = null;
    }
    if (state !== null && !statesSeen.includes(state)) statesSeen.push(state);
    return state;
  };

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
    noteAttemptState(request.attemptId);
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
    if (request.previousViolations !== undefined) lastViolations = [...request.previousViolations];
    let raw;
    try {
      raw = await invokeHostModel(diagnosisRequest);
    } catch (error) {
      blocked = classifyLiveFailure(error);
      throw blocked;
    }
    const sha256 = createHash("sha256").update(raw, "utf8").digest("hex");
    calls.push({
      length: raw.length,
      sha256,
      correctionRound: request.correctionRound,
      previousViolations: [...(request.previousViolations ?? [])],
    });
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
    lastPlan = extracted.plan;
    lastFileOperations = [...parsed.diagnosis.fileOperations];
    if (mode === "negative" && perturbation === null) {
      // Fail-closed probe: a concurrent write lands AFTER the manager snapshotted
      // the pre-repair revision baseline, so the real executor must refuse.
      const probePath = "tracked.txt";
      const probeContent = "repair-manager-live negative: concurrent write after baseline\n";
      writeFileSync(path.join(workspaceDir, probePath), probeContent);
      perturbation = { path: probePath, content: probeContent };
      say(`[negative] perturbed ${probePath} after the manager's repair baseline snapshot`);
    }
    return { status: "proposed", plan: extracted.plan, fileOperations: [...parsed.diagnosis.fileOperations] };
  };

  return {
    invoke,
    blocked: () => blocked,
    statesSeen: () => [...statesSeen],
    perturbation: () => (perturbation === null ? null : { path: perturbation.path, contentLength: perturbation.content.length }),
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
        previousViolationsPerRound: calls.map((call) => call.previousViolations),
        turnReportedModel: lastTurnModel,
        scriptedInvoker: false,
      };
    },
    lastPlan: () => lastPlan,
    lastFileOperations: () => [...lastFileOperations],
    lastViolations: () => [...lastViolations],
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

function readEvidenceRecord(file) {
  try {
    return parseVerificationRecord(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// The highest evidence attempt for one check. The ordinary run writes attempt 1; a verified
// repair's rerun writes the next attempt and keeps attempt 1 on disk as history.
function highestEvidenceFile(directory, prefix) {
  let best = null;
  let bestAttempt = -1;
  try {
    for (const name of readdirSync(directory)) {
      if (!name.startsWith(`${prefix}.`) || !name.endsWith(".json")) continue;
      const attempt = Number(name.slice(prefix.length + 1, -".json".length));
      if (Number.isSafeInteger(attempt) && attempt > bestAttempt) {
        bestAttempt = attempt;
        best = path.join(directory, name);
      }
    }
  } catch {
    return null;
  }
  return best;
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

function evidenceSummary(record) {
  if (record === null) return null;
  return {
    checkId: record.checkId,
    status: record.status,
    started: record.started,
    exitCode: record.exitCode ?? null,
    sourceRevision: record.sourceRevision,
    workerAttempt: record.workerAttempt ?? null,
    outputSummary: record.outputSummary,
  };
}

// The exact evidence a failed/unproven acceptance must print: the gate, the
// repair state, the model hashes and the rejection reasons. Never a secret.
function printFailureEvidence(trace) {
  say("");
  say("FAILURE EVIDENCE");
  say(
    `  gate: manager=${trace.gateVerdict ?? "none"} independent=${trace.independentGateVerdict ?? "none"}/${trace.independentGateCode ?? "none"}`,
  );
  say(
    `  repair: state=${trace.finalRepairState ?? "none"} reason=${trace.repairFinishedEvent?.reason ?? "none"} code=${trace.repairFinishedEvent?.gate_code ?? "none"}`,
  );
  say(`  repair.detail: ${oneLine(redactSensitive(trace.repairFinishedEvent?.detail ?? "none"))}`);
  say(`  terminal: status=${trace.terminalStatus ?? "none"} error=${oneLine(redactSensitive(trace.terminalErrorMessage ?? ""))}`);
  say(`  notification: verification=${trace.parentNotification?.verificationStatus ?? "none"}`);
  say(
    `  model: ${trace.model?.provider ?? "?"}/${trace.model?.modelId ?? "?"} calls=${trace.model?.calls ?? 0} hashes=${(trace.model?.responseHashes ?? []).join(",") || "none"}`,
  );
  say(`  proposedPlan: ${oneLine(redactSensitive(JSON.stringify(trace.proposedPlan ?? null)))}`);
  say(`  proposedFileOperations: ${oneLine(redactSensitive(JSON.stringify(trace.proposedFileOperations ?? [])))}`);
  if (trace.planRejections.length > 0) {
    say(`  planRejections: ${oneLine(redactSensitive(JSON.stringify(trace.planRejections)))}`);
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const tracePath = MODE === "negative" ? NEGATIVE_TRACE_PATH : TRACE_PATH;
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "repair-manager-live-"));
const workspace = path.join(fixtureRoot, "work");
const stateRoot = path.join(fixtureRoot, "state");
const authorityRoot = path.join(fixtureRoot, "authority");
const sessionRoot = path.join(fixtureRoot, "live-sessions");

let liveInvoker = null;
let store = null;
let traceWritten = false;

try {
  say(`[mode] ${MODE}`);
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

  liveInvoker = createLiveInvoker({
    boundary,
    workspaceDir: workspace,
    sessionRoot,
    repairStoreRoot: repairRoot,
    mode: MODE,
  });
  const stub = makeInProcessStub();

  // Deliberately NO editExecutor and NO runner injection: the manager must use
  // the real applyRepairEdits and the real runVerificationCommand.
  const manager = createTaskManager({
    store,
    runners: { "in-process": stub.runner, process: stub.runner },
    planner: () => ({ kind: "resolved", plan: { model: "stub/ordinary-worker" } }),
    config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }),
    cwd: workspace,
    verificationAuthorityRoot: authorityRoot,
    repair: { invoker: liveInvoker.invoke },
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

  const runningRecord = store.load(taskId);
  if (runningRecord === null) throw new Error("task record missing right after start");
  const runEpoch = runningRecord.notification.run_epoch;

  // The ordinary worker asks the host to verify through the production tool the
  // manager installed; the REAL check command runs and writes failing evidence.
  const spec = stub.specs.find((entry) => entry.taskId === taskId);
  if (spec === undefined) throw new Error("the stub runner never received the managed start spec");
  if (spec.verificationTool === undefined) throw new Error("the manager did not install a verification tool on the spec");

  const evidenceDir = path.join(evidenceRoot, taskId);
  const evidenceFile = path.join(evidenceDir, `${ORDINARY_VERIFICATION_NODE}.${CHECK_ID}.1.json`);
  const originalRevision = workspaceRevision(workspace);
  const verifyResult = await spec.verificationTool.execute();
  const executed = verifyResult?.details?.executed ?? [];
  const persistedEvidence = verifyResult?.details?.persisted ?? 0;
  const preRepairRecord = readEvidenceRecord(evidenceFile);
  const preRepairEvidence = evidenceSummary(preRepairRecord);

  // Subscribe to the exact manager event before triggering the completion.
  let resolveFinished = () => {};
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });
  const originalAppend = store.appendEvent.bind(store);
  store.appendEvent = (id, event) => {
    const result = originalAppend(id, event);
    if (id === taskId && event.type === "repair_finished") resolveFinished();
    return result;
  };

  const waiter = manager.waitFor(taskId);
  stub.handles.get(taskId)?.settle({ status: "completed", finalResponse: "done" });
  const terminal = await withTimeout(waiter, 15_000, "ordinary terminal");
  await withTimeout(finished, REPAIR_WAIT_MS, "repair_finished");

  // A provider/model failure is the ONLY live-BLOCKED path. It never falls back
  // to a scripted invoker; the orchestrator records repair_failed and we exit 2.
  if (liveInvoker.blocked() !== null) blockAndExit(liveInvoker.blocked());

  const resultingRevision = workspaceRevision(workspace);
  const fixtureContent = readFileSync(path.join(workspace, CHECK_FILE), "utf8");
  // The repair rerun writes the NEXT evidence attempt; attempt 1 stays on disk as history.
  const postRepairEvidenceFile = highestEvidenceFile(evidenceDir, `${ORDINARY_VERIFICATION_NODE}.${CHECK_ID}`) ?? evidenceFile;
  const postRepairRecord = readEvidenceRecord(postRepairEvidenceFile);
  const postRepairEvidence = evidenceSummary(postRepairRecord);

  const attempts = createRepairAttemptStore({ root: repairRoot }).list(taskId);
  const attempt = attempts[attempts.length - 1];
  const statesSeen = liveInvoker.statesSeen();
  if (attempt !== undefined && !statesSeen.includes(attempt.state)) statesSeen.push(attempt.state);

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
  const gateCode = repairFinished?.payload?.gate_code ?? null;
  const fileContainsFix = fixtureContent.includes("a + b") && !fixtureContent.includes("a - b");
  const freshEvidence =
    postRepairRecord !== null &&
    postRepairRecord.checkId === CHECK_ID &&
    postRepairRecord.status === "passed" &&
    postRepairRecord.started === true &&
    postRepairRecord.sourceRevision === resultingRevision &&
    postRepairRecord.workerAttempt === runEpoch;

  const trace = {
    version: 2,
    mode: MODE,
    createdAt: new Date().toISOString(),
    liveModel: true,
    scriptedInvoker: false,
    scriptedEditExecutor: false,
    invocation: {
      entrypoint:
        "createTaskManager(...).start -> ordinary completion gate -> manager repair wiring -> runRepairAttempt",
      manager: "packages/omo-engine/senpi-task/src/manager/manager.ts",
      ordinaryWorker:
        "in-process stub that calls the manager-installed worker verification tool, then settles completed",
      editExecutor: "manager default: repair/edit-executor.ts applyRepairEdits over the run workspace",
      verifier: "manager default: runVerificationCommand over the fixture check",
      negativeProbe:
        MODE === "negative"
          ? "one untracked file written inside the invoker after the manager snapshotted the repair baseline"
          : null,
    },
    taskId,
    runEpoch,
    repairAttemptId: attempt?.attemptId ?? repairFinished?.payload?.attempt_id ?? null,
    repairAttemptsPersisted: attempts.length,
    repairStatesObserved: statesSeen,
    repairStatesNote:
      "observed at the model seam (the attempt is already diagnosing) and after repair_finished; the manager's default executor and runner are not instrumented",
    finalRepairState: attempt?.state ?? repairFinished?.payload?.final_state ?? null,
    originalRevision,
    resultingRevision,
    changedFiles,
    gateVerdict,
    gateCode,
    independentGateVerdict: independentGate.verification,
    independentGateCode: independentGate.code ?? null,
    terminalStatus: persistedRecord?.status ?? terminal.status,
    // The persisted record is the authority for its OWN fields. Never fall back to the waiter
    // snapshot here: that snapshot is taken when the terminal lands, BEFORE an asynchronous repair
    // corrects the record, so a clean record with no error_message key would otherwise be reported
    // with the pre-repair text it no longer carries.
    terminalErrorMessage:
      persistedRecord !== null && Object.hasOwn(persistedRecord, "error_message")
        ? persistedRecord.error_message
        : null,
    terminalVerificationStatus: persistedVerdict,
    verificationBlockedEvent: blockedEvent?.payload ?? null,
    repairFinishedEvent: repairFinished?.payload ?? null,
    parentNotification: notification,
    fixture: {
      checkId: CHECK_ID,
      file: CHECK_FILE,
      content: fixtureContent,
      contentSha256: createHash("sha256").update(fixtureContent, "utf8").digest("hex"),
      containsFix: fixtureContent.includes("a + b"),
      containsDefect: fixtureContent.includes("a - b"),
    },
    evidence: {
      file: evidenceFile,
      postRepairFile: postRepairEvidenceFile,
      preRepair: preRepairEvidence,
      postRepair: postRepairEvidence,
      freshForResultingRevision: freshEvidence,
    },
    proposedPlan: liveInvoker.lastPlan(),
    proposedFileOperations: liveInvoker.lastFileOperations(),
    planRejections: liveInvoker.lastViolations(),
    perturbation: liveInvoker.perturbation(),
    model,
    ordinaryWorker: {
      verificationToolExecuted: executed.length > 0,
      executed,
      persistedEvidence,
      verifyIsError: verifyResult?.isError ?? null,
    },
    eventTypes: logEvents.map((event) => event.type),
  };

  mkdirSync(path.dirname(tracePath), { recursive: true });
  writeFileSync(tracePath, JSON.stringify(trace, null, 2) + "\n");
  traceWritten = true;

  if (MODE === "negative") {
    // ---- fail-closed assertions ------------------------------------------
    check(
      "N01",
      asString(taskId) !== null && taskId.length > 0 && runEpoch === 0,
      `ordinary task started (${taskId}, run_epoch=${runEpoch})`,
    );
    check(
      "N02",
      model.calls >= 1 &&
        /^[0-9a-f]{64}$/.test(model.responseTextSha256) &&
        model.provider.length > 0 &&
        model.modelId.length > 0 &&
        model.scriptedInvoker === false,
      `live model path used (${model.calls} call(s), ${model.provider}/${model.modelId}, sha256 ${String(model.responseTextSha256).slice(0, 12)}...)`,
    );
    check(
      "N03",
      attempts.length === 1 &&
        attempt !== undefined &&
        attempt.taskId === taskId &&
        attempt.runEpoch === runEpoch &&
        attempt.failedCheckIds.includes(CHECK_ID),
      `exactly one durable repair attempt (${attempt?.attemptId ?? "none"})`,
    );
    check(
      "N04",
      attempt?.state === "repair_failed" && repairFinished?.payload?.final_state === "repair_failed",
      `repair settled repair_failed (${attempt?.state ?? "none"})`,
    );
    check(
      "N05",
      repairFinished?.payload?.reason === "edit_error" &&
        String(repairFinished?.payload?.detail ?? "").includes("revision_conflict"),
      `the executor refused the stale-baseline write (reason=${repairFinished?.payload?.reason ?? "none"}, detail=${oneLine(String(repairFinished?.payload?.detail ?? "none"))})`,
    );
    check(
      "N06",
      changedFiles.length === 0,
      `no changed files were reported (${JSON.stringify(changedFiles)})`,
    );
    check(
      "N07",
      fixtureContent.includes("a - b") && !fixtureContent.includes("a + b"),
      "the fixture file on disk is still defective and was never rewritten",
    );
    check(
      "N08",
      gateVerdict === "blocked" &&
        independentGate.verification === "blocked" &&
        independentGate.code === "verification_failed",
      `gate stays blocked (manager=${gateVerdict}, independent=${independentGate.verification}/${independentGate.code ?? "none"})`,
    );
    check(
      "N09",
      (persistedRecord?.status ?? terminal.status) === "error" &&
        Object.hasOwn(persistedRecord ?? {}, "error_message") &&
        String(persistedRecord?.error_message).includes("completion blocked"),
      `terminal stays error/completion blocked (${persistedRecord?.status ?? terminal.status}: ${oneLine(String(persistedRecord?.error_message ?? ""))})`,
    );
    check(
      "N10",
      notification !== null && notification.verificationStatus === "blocked",
      `parent notification says verification_status=${notification?.verificationStatus ?? "none"}`,
    );
    const finishedText = JSON.stringify(repairFinished?.payload ?? {});
    check(
      "N11",
      !finishedText.includes('"verified"') && attempt?.outcome?.result === "failed",
      `no verified word and the durable attempt outcome is failed (result=${attempt?.outcome?.result ?? "none"})`,
    );
  } else {
    // ---- positive acceptance assertions ----------------------------------
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
        persistedEvidence > 0 &&
        preRepairRecord !== null &&
        preRepairRecord.status !== "passed" &&
        preRepairRecord.sourceRevision === originalRevision,
      `worker verification tool ran ${CHECK_ID} for real and failed at ${originalRevision.slice(0, 12)}... (evidence=${persistedEvidence}, status=${preRepairRecord?.status ?? "none"})`,
    );
    check(
      "M03",
      trace.liveModel === true &&
        trace.scriptedInvoker === false &&
        trace.scriptedEditExecutor === false &&
        model.calls >= 1 &&
        /^[0-9a-f]{64}$/.test(model.responseTextSha256) &&
        model.provider.length > 0 &&
        model.modelId.length > 0 &&
        (model.turnReportedModel === null || model.turnReportedModel.includes(model.modelId)),
      `live model via the production invoker (${model.provider}/${model.modelId}, ${model.calls} call(s), sha256 ${String(model.responseTextSha256).slice(0, 12)}...)`,
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
      attempt?.plan !== undefined,
      `the live plan passed validation and was durably recorded (${attempt?.plan?.summary ?? "none"})`,
    );
    check(
      "M06",
      attempt?.state === "repaired" && repairFinished?.payload?.final_state === "repaired",
      `repair settled repaired (${attempt?.state ?? "none"})`,
    );
    check(
      "M07",
      changedFiles.includes(CHECK_FILE),
      `changedFiles names ${CHECK_FILE} (${JSON.stringify(changedFiles)})`,
    );
    check(
      "M08",
      originalRevision !== resultingRevision,
      `workspace revision moved (${originalRevision.slice(0, 8)}...+${originalRevision.slice(-16)} -> ${resultingRevision.slice(0, 8)}...+${resultingRevision.slice(-16)})`,
    );
    check(
      "M09",
      fileContainsFix,
      "the fixture file on disk now contains the fix (return a + b;) and not the defect",
    );
    check(
      "M10",
      freshEvidence,
      `fresh ${CHECK_ID} evidence exists for the resulting revision (status=${postRepairRecord?.status ?? "none"}, revision=${String(postRepairRecord?.sourceRevision ?? "none").slice(0, 12)}..., attempt=${postRepairRecord?.workerAttempt ?? "none"})`,
    );
    check(
      "M11",
      gateVerdict === "verified",
      `manager gate verdict is verified (${gateVerdict ?? "none"}${gateCode === null ? "" : `/${gateCode}`})`,
    );
    check(
      "M12",
      independentGate.verification === "verified",
      `independent completion-gate read is verified (${independentGate.verification}${independentGate.code === undefined ? "" : `/${independentGate.code}`})`,
    );
    check(
      "M13",
      (persistedRecord?.status ?? terminal.status) === "completed" &&
        !Object.hasOwn(persistedRecord ?? {}, "error_message"),
      `terminal status is completed with no stale error_message (${persistedRecord?.status ?? terminal.status}: ${oneLine(String(trace.terminalErrorMessage ?? ""))})`,
    );
    check(
      "M14",
      notification !== null && notification.verificationStatus === "verified",
      `parent notification says verification_status=${notification?.verificationStatus ?? "none"}`,
    );
  }

  say(`repairAttemptId=${trace.repairAttemptId}`);
  say(`originalRevision=${trace.originalRevision}`);
  say(`resultingRevision=${trace.resultingRevision}`);
  say(
    `model=${model.provider}/${model.modelId} calls=${model.calls} responseChars=${model.responseTextLength} sha256=${model.responseTextSha256}`,
  );
  if (failures.length > 0) printFailureEvidence(trace);
  say(`trace: ${tracePath}`);
  say(
    `RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ${failures.length === 0 ? "(all assertions held)" : `(failed: ${failures.join(", ")})`}`,
  );
  flushOutput();
  process.exit(failures.length === 0 ? 0 : 1);
} catch (error) {
  flushOutput();
  console.log(`RESULT: FAIL (${oneLine(redactSensitive(errorMessage(error)))})`);
  if (traceWritten) console.log(`trace: ${tracePath}`);
  process.exit(1);
} finally {
  try {
    rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    // Best effort; a temp fixture never blocks the verdict.
  }
}
