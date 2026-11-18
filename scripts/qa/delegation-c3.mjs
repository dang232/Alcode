/**
 * LIVE C3 acceptance harness: two real children, a parent-applied edit, and the
 * existing completion gate as the only judge.
 *
 * What is real:
 *   - the REAL DAG engine (createDagManager + createDagScheduler +
 *     createDagWaitSurface) from src/dag;
 *   - runEngineeringDelegation (src/delegation/run.ts) builds the real
 *     investigate -> review plan;
 *   - the REAL ChildPlanner seam resolves the live provider/model from the
 *     Senpi settings, and each DAG node is a real InProcessRunner child that
 *     calls its own read tool. Nothing is scripted;
 *   - the parent applies only the edit both children agreed on, through the
 *     EXISTING authorized executor applyRepairEdits (src/repair/edit-executor.ts),
 *     the same path ordinary workers use;
 *   - the approved sum-check runs through the REAL runner inside
 *     createOrdinaryVerificationCapture (src/verification/ordinary-capture.ts),
 *     which writes the evidence record itself;
 *   - evaluateOrdinaryCompletion (src/verification/completion-gate.ts) is the
 *     only verdict. This script never decides that the work is verified.
 *
 * The two live children:
 *   investigate: read src/sum.js, report the exact defective line text and the
 *                exact corrected line text.
 *   review:      independently read src/sum.js, derive the same defect/fix, and
 *                confirm or reject the claim.
 *
 * Parent synthesis: the edit is accepted only when the reviewer confirms AND
 * both children name the same exact find/replace. A disagreement ends the run
 * BLOCKED with the contradiction recorded and no edit applied. There is no
 * retry loop and no model substitution.
 *
 * Exit codes:
 *   0  the completion gate returned verified AND both children are attributed
 *   1  a seam or assertion failed (the gate was not verified, or the run could
 *      not reach synthesis)
 *   2  LIVE: BLOCKED <reason> - the provider could not be reached
 *   3  the children disagreed; no edit was applied (a legitimate blocked result)
 *
 * Usage:
 *   node scripts/qa/delegation-c3.mjs
 *   node scripts/qa/delegation-c3.mjs --no-reexec
 *
 * Evidence:
 *   .omo/ulw/p24/delegation-c3.json
 */

import { execFileSync, spawnSync } from "node:child_process";
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

import { asNonBlankString, asRecord, asString } from "./wire-values.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(ROOT, "packages", "omo-engine", "senpi-task", "src");
const OMO_CONFIG = path.join(ROOT, "packages", "omo-engine", "omo-config-core", "src", "index.ts");
const EVIDENCE_PATH = path.join(ROOT, ".omo", "ulw", "p24", "delegation-c3.json");

const PARENT_SESSION_ID = "delegation-c3-parent";
const ROOT_SESSION_ID = "delegation-c3-root";
const CHECK_ID = "sum-check";
const CHECK_FILE = "src/sum.js";
const INVESTIGATE_NODE = "delegation-investigate-1";
const REVIEW_NODE = "delegation-review-1";
const EVIDENCE_EPOCH = 0;
const PREVIEW_CHARS = 900;

const LIVE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.DELEGATION_C3_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
})();

// All harness output is buffered so a BLOCKED exit can print exactly one line.
const output = [];
function say(line) {
  output.push(line);
}
function flushOutput() {
  for (const line of output) console.log(line);
  output.length = 0;
}

// ---------------------------------------------------------------------------
// Dual-runtime entry: the real chain is imported from TypeScript sources, which
// needs Bun. Plain `node` re-execs under bun and passes the exit code through.
// ---------------------------------------------------------------------------
const isBun = Object.prototype.toString.call(process.versions.bun) === "[object String]";
if (!isBun && !process.argv.includes("--no-reexec") && !process.env.DELEGATION_C3_VIA_BUN) {
  const candidates = process.platform === "win32" ? ["bun", "bun.exe"] : ["bun"];
  let done = false;
  for (const candidate of candidates) {
    let res;
    try {
      res = spawnSync(candidate, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
        stdio: "inherit",
        env: { ...process.env, DELEGATION_C3_VIA_BUN: "1" },
      });
    } catch {
      continue;
    }
    if (res.error && res.error.code === "ENOENT") continue;
    done = true;
    process.exit(res.status ?? 1);
  }
  if (!done) {
    console.log("RESULT: FAIL (bun runtime not found; delegation-c3 needs bun to import the real TS chain)");
    process.exit(1);
  }
}

// Real modules, imported dynamically so the bun re-exec runs first.
const { createTaskRecordStore } = await import(path.join(SRC, "store", "index.ts"));
const { createTaskManager } = await import(path.join(SRC, "manager", "manager.ts"));
const { createInProcessManagedRunner } = await import(path.join(SRC, "manager", "runner.ts"));
const { InProcessRunner } = await import(path.join(SRC, "runners", "in-process.ts"));
const { loadSenpiBarrel } = await import(path.join(SRC, "lazy", "senpi-barrel.ts"));
const { createDagManager } = await import(path.join(SRC, "dag", "manager.ts"));
const { createDagScheduler } = await import(path.join(SRC, "dag", "scheduler.ts"));
const { createDagFileStore } = await import(path.join(SRC, "dag", "store.ts"));
const { createDagWaitSurface } = await import(path.join(SRC, "dag", "handle.ts"));
const { isTerminalDagRunStatus } = await import(path.join(SRC, "dag", "types.ts"));
const { runEngineeringDelegation } = await import(path.join(SRC, "delegation", "run.ts"));
const { OmoTaskSettingsSchema } = await import(OMO_CONFIG);
const { approvalAuthorityFor } = await import(path.join(SRC, "verification", "approval-authority.ts"));
const { approveCandidate, readApprovals } = await import(path.join(SRC, "verification", "approval-store.ts"));
const { VERIFICATION_CONFIG_VERSION } = await import(path.join(SRC, "verification", "config.ts"));
const { candidateForApproval, resolveCatalogue, WORKSPACE_ID } = await import(
  path.join(SRC, "verification", "resolution.ts")
);
const { catalogueChecks } = await import(path.join(SRC, "verification", "catalogue.ts"));
const { createFileEvidenceStore, workspaceRevision } = await import(
  path.join(SRC, "verification", "evidence-store.ts")
);
const { createOrdinaryVerificationCapture } = await import(
  path.join(SRC, "verification", "ordinary-capture.ts")
);
const { evaluateOrdinaryCompletion } = await import(path.join(SRC, "verification", "completion-gate.ts"));
const { applyRepairEdits } = await import(path.join(SRC, "repair", "edit-executor.ts"));

// ---------------------------------------------------------------------------
// Small helpers.
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

function bounded(text, max = PREVIEW_CHARS) {
  const flat = oneLine(text);
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

const PROVIDER_AUTH_PATTERN =
  /\b401\b|\b403\b|unauthori[sz]ed|unauthenticated|authenticat|forbidden|api[\s_-]?key|credential|expired|invalid token|no api key/i;
const PROVIDER_TRANSPORT_PATTERN =
  /fetch failed|econnrefused|econnreset|econnaborted|enotfound|etimedout|eai_again|network|socket|timed out|timeout|connection/i;

function classifyBlockedText(text) {
  const message = String(text);
  if (PROVIDER_AUTH_PATTERN.test(message)) return { layer: "provider_auth", message };
  if (PROVIDER_TRANSPORT_PATTERN.test(message)) return { layer: "provider_transport", message };
  return null;
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
// Live model boundary: the host's real engine services and configured model.
// ---------------------------------------------------------------------------
async function createLiveModelBoundary() {
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
  const configuredProvider = asNonBlankString(defaultProvider);
  const configuredModelId = asNonBlankString(defaultModelId);
  if (configuredProvider !== null && configuredModelId !== null) {
    model = services.modelRegistry.find(configuredProvider, configuredModelId);
    if (model === undefined) {
      throw new LiveBlocked(
        "model_resolution",
        `configured model ${configuredProvider}/${configuredModelId} is not in the live registry`,
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
    modelInfo: {
      provider: model.provider,
      modelId: model.id,
      display: `${model.provider}/${model.id}`,
      model,
      resolution,
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture: a tiny git repo with a genuine defect, plus one approved check.
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
  writeFileSync(path.join(workspaceDir, CHECK_FILE), DEFECTIVE_SUM_JS);
  writeFileSync(path.join(workspaceDir, "checks", "sum-check.mjs"), SUM_CHECK_MJS);
  writeFileSync(
    path.join(workspaceDir, "package.json"),
    JSON.stringify({ name: "delegation-c3-fixture", private: true, type: "module" }, null, 2) + "\n",
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
    "user.email=delegation-c3@example.com",
    "-c",
    "user.name=delegation-c3",
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
    approvedBy: "delegation-c3",
  });
}

// ---------------------------------------------------------------------------
// The two live roles. The review role is given the claim, not the
// investigator's text: it must derive the exact edit itself.
// ---------------------------------------------------------------------------
function rolesFor(workspaceDir) {
  const absolute = path.join(workspaceDir, CHECK_FILE);
  return [
    {
      key: "investigate",
      assignment: [
        `Use the read tool to open ${JSON.stringify(absolute)}.`,
        "The add(a, b) function is supposed to return the sum, but its return line uses the wrong operator.",
        "Report (1) the exact current text of that defective return line, copied verbatim including any leading whitespace and the trailing semicolon, and (2) the exact text of the smallest corrected line.",
        "Do not edit any file.",
        "End your final answer with exactly one line of JSON and nothing after it:",
        'DELEGATION_INVESTIGATE {"path":"src/sum.js","find":"<exact current defective line>","replace":"<exact corrected line>","defect":"<one sentence>"}',
      ].join(" "),
    },
    {
      key: "review",
      assignment: [
        `Use the read tool to open ${JSON.stringify(absolute)} yourself; do not rely on another node's report.`,
        "Claim to evaluate: the file contains a return line that subtracts instead of adding, and replacing exactly that line with its addition equivalent repairs add(2, 3).",
        "Independently determine (1) the exact current text of the defective return line, copied verbatim including any leading whitespace and the trailing semicolon, and (2) the exact text of the smallest corrected line.",
        "Then confirm the claim only if the file really holds that defect and that replacement really makes the return line add.",
        "Do not edit any file.",
        "End your final answer with exactly one line of JSON and nothing after it:",
        'DELEGATION_REVIEW {"verdict":"confirm or reject","path":"src/sum.js","find":"<exact defective line you observed>","replace":"<exact corrected line you derived>","reason":"<one sentence>"}',
      ].join(" "),
    },
  ];
}

// ---------------------------------------------------------------------------
// Real manager + real DAG wiring (the same mechanism delegation-live uses).
// ---------------------------------------------------------------------------
function createDelegationRuntime({ workspaceDir, stateDir, boundary }) {
  const store = createTaskRecordStore({ project_dir: workspaceDir, task: { state_dir: stateDir } });
  const dagStore = createDagFileStore({ project_dir: workspaceDir, task: { state_dir: stateDir } });

  const context = () => ({
    agentDir: boundary.agentDir,
    authStorage: boundary.services.authStorage,
    modelRegistry: boundary.services.modelRegistry,
    modelRuntime: boundary.services.modelRuntime,
    model: boundary.modelInfo.model,
  });
  const managedRunner = createInProcessManagedRunner(new InProcessRunner({}), context);

  const planner = (spec) => {
    const plan = {
      model: boundary.modelInfo.display,
      resolved_model: {
        provider: boundary.modelInfo.provider,
        model_id: boundary.modelInfo.modelId,
        display: boundary.modelInfo.display,
        source: "explicit",
      },
      agentExecutionMode: "in-process",
    };
    if (spec.subagent_type !== undefined) plan.agentType = spec.subagent_type;
    if (spec.category !== undefined) plan.category = spec.category;
    return { kind: "resolved", plan };
  };

  const taskManager = createTaskManager({
    store,
    runners: { "in-process": managedRunner, process: managedRunner },
    planner,
    config: OmoTaskSettingsSchema.parse({
      default_concurrency: 4,
      max_depth: 2,
      default_execution_mode: "in-process",
    }),
    cwd: workspaceDir,
  });

  const dagManager = createDagManager({ store: dagStore });
  const schedulers = new Map();
  const runStarted = new Map();
  const waitSurface = createDagWaitSurface({
    store: dagStore,
    subscribe: (runId, listener) => {
      const scheduler = schedulers.get(runId);
      if (scheduler === undefined) throw new Error(`missing scheduler for dag run ${runId}`);
      return scheduler.subscribe(listener);
    },
  });

  const wait = async (runId, deadlineMs) => {
    if (!schedulers.has(runId)) {
      const scheduler = createDagScheduler({
        store: dagStore,
        taskManager,
        initialRecord: dagManager.record(runId, PARENT_SESSION_ID),
      });
      schedulers.set(runId, scheduler);
      runStarted.set(runId, scheduler.run());
    }
    if (!Number.isFinite(deadlineMs)) {
      const result = await waitSurface.wait(runId, PARENT_SESSION_ID);
      await runStarted.get(runId);
      return result;
    }
    const settled = await Promise.race([
      waitSurface.wait(runId, PARENT_SESSION_ID).then((result) => ({ kind: "result", result })),
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ kind: "deadline" }), deadlineMs);
        timer.unref?.();
      }),
    ]);
    if (settled.kind === "result") {
      await runStarted.get(runId);
      return settled.result;
    }
    // The manager seam has no run cancel (dag/manager.ts attach handle), so a
    // deadline reports the engine's durable snapshot instead of inventing one.
    return {
      runId,
      status: dagManager.record(runId, PARENT_SESSION_ID).status,
      snapshot: dagManager.attach(runId, PARENT_SESSION_ID).snapshot(),
      nodes: {},
    };
  };

  return { store, dagStore, taskManager, dagManager, wait };
}

// ---------------------------------------------------------------------------
// Observation projection.
// ---------------------------------------------------------------------------
function readNodeOutput(dagStore, runId, node) {
  try {
    const persisted = asString(dagStore.readResult(runId, node.id));
    if (persisted !== null) return persisted;
  } catch {
    // Fall through to the checkpoint preview.
  }
  return asString(node.output) ?? "";
}

function assertedModelOf(record) {
  const resolved = asRecord(record?.resolved_model);
  if (resolved === null) return null;
  const provider = asNonBlankString(resolved.provider);
  const modelId = asNonBlankString(resolved.model_id);
  return provider === null || modelId === null ? null : `${provider}/${modelId}`;
}

function projectNodes({ record, dagStore, taskManager }) {
  return record.nodes.map((node) => {
    const taskId = node.taskId;
    const task = taskId === undefined ? undefined : taskManager.get(taskId);
    const output = readNodeOutput(dagStore, record.runId, node);
    return {
      nodeId: node.id,
      dependsOn: [...node.dependsOn],
      nodeState: node.state,
      childTaskId: taskId ?? null,
      childStatus: task?.status ?? null,
      assertedModel: task === undefined ? null : assertedModelOf(task),
      planModel: task?.model ?? null,
      childErrorMessage:
        task?.error_message === undefined ? null : bounded(redactSensitive(task.error_message), 600),
      nodeErrorMessage:
        node.error?.message === undefined ? null : bounded(redactSensitive(node.error.message), 600),
      outputBytes: node.outputBytes ?? Buffer.byteLength(output, "utf8"),
      outputPreview: bounded(redactSensitive(output), PREVIEW_CHARS),
    };
  });
}

function printNodes(nodes) {
  for (const node of nodes) {
    say(
      `[node] id=${node.nodeId} child=${node.childTaskId ?? "none"} nodeState=${node.nodeState} ` +
        `childStatus=${node.childStatus ?? "none"} model=${node.assertedModel ?? "not-recorded"} ` +
        `outputBytes=${node.outputBytes}`,
    );
    say(`       output="${node.outputPreview}"`);
    if (node.nodeErrorMessage !== null) say(`       error="${node.nodeErrorMessage}"`);
  }
}

// ---------------------------------------------------------------------------
// Bounded JSON extraction from a live child answer.
// ---------------------------------------------------------------------------
function jsonObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function parseJsonRecord(slice) {
  if (slice === null) return null;
  try {
    return asRecord(JSON.parse(slice));
  } catch {
    return null;
  }
}

function extractJsonObjects(text) {
  const objects = [];
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{", index);
    if (open < 0) break;
    const slice = jsonObjectAt(text, open);
    const parsed = parseJsonRecord(slice);
    if (parsed !== null) objects.push(parsed);
    index = slice === null ? open + 1 : open + slice.length;
  }
  return objects;
}

function extractMarkedJson(text, marker) {
  const at = text.lastIndexOf(marker);
  if (at < 0) return null;
  const open = text.indexOf("{", at + marker.length);
  if (open < 0) return null;
  return parseJsonRecord(jsonObjectAt(text, open));
}

function hasFindReplace(record) {
  return asString(record.find) !== null && asString(record.replace) !== null;
}

function parseInvestigation(text) {
  const marked = extractMarkedJson(text, "DELEGATION_INVESTIGATE");
  const fallback = [...extractJsonObjects(text)].reverse().find(hasFindReplace);
  const record = marked !== null && hasFindReplace(marked) ? marked : fallback;
  if (record === undefined || record === null) {
    return { ok: false, detail: "the investigator answer carried no JSON object with find/replace" };
  }
  const find = asString(record.find);
  const replace = asString(record.replace);
  if (find === null || find.trim().length === 0) {
    return { ok: false, detail: "the investigator JSON carried no non-empty find text" };
  }
  if (replace === null || replace.trim().length === 0) {
    return { ok: false, detail: "the investigator JSON carried no non-empty replace text" };
  }
  return {
    ok: true,
    value: {
      path: asString(record.path),
      find,
      replace,
      defect: asString(record.defect),
    },
  };
}

function parseReview(text) {
  const marked = extractMarkedJson(text, "DELEGATION_REVIEW");
  const fallback = [...extractJsonObjects(text)]
    .reverse()
    .find((record) => asString(record.verdict) !== null && hasFindReplace(record));
  const record = marked !== null && asString(marked.verdict) !== null ? marked : fallback;
  if (record === undefined || record === null) {
    return { ok: false, detail: "the reviewer answer carried no JSON object with a verdict" };
  }
  const rawVerdict = asNonBlankString(record.verdict);
  if (rawVerdict === null) return { ok: false, detail: "the reviewer JSON carried no verdict text" };
  const verdict = rawVerdict.toLowerCase();
  if (/^(confirm|confirmed|approve|approved|accept|accepted)\b/.test(verdict)) {
    return { ok: true, value: { verdict: "confirm", find: asString(record.find), replace: asString(record.replace), reason: asString(record.reason) } };
  }
  if (/^(reject|rejected|deny|denied|contradict|contradicted|disagree|disagreed)\b/.test(verdict)) {
    return { ok: true, value: { verdict: "reject", find: asString(record.find), replace: asString(record.replace), reason: asString(record.reason) } };
  }
  return { ok: false, detail: `the reviewer verdict is neither confirm nor reject: ${bounded(rawVerdict, 120)}` };
}

function normalizeEditText(value) {
  return asString(value) === null ? null : value.replace(/\r\n/g, "\n").trim();
}

function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Parent synthesis + real executor + real runner + existing gate.
// ---------------------------------------------------------------------------
function repairPlanFor({ edit, defect, reason }) {
  return {
    addressedCheckIds: [CHECK_ID],
    suspectedRootCause: defect ?? "add() subtracts instead of adding",
    supportingEvidence: [defect ?? "add() subtracts instead of adding", reason ?? "reviewer confirmed the claim"],
    filesToChange: [CHECK_FILE],
    expectedBehaviourChange: "add(2, 3) returns the sum 5",
    risks: ["none observed"],
    checksToRerun: [CHECK_ID],
    checksToRemainUnchanged: [],
    rollbackPlan: "replace the new text with the original find text",
  };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "delegation-c3-"));
const workspace = path.join(fixtureRoot, "work");
const stateDir = path.join(fixtureRoot, "state");
const authorityRoot = path.join(fixtureRoot, "authority");

const evidence = {
  generatedAt: new Date().toISOString(),
  live: true,
  scriptedPlanner: false,
  scriptedChild: false,
  parentSessionId: PARENT_SESSION_ID,
  rootSessionId: ROOT_SESSION_ID,
  fixture: { file: CHECK_FILE, checkId: CHECK_ID, workspace },
  model: null,
  run: null,
  children: [],
  attribution: null,
  synthesis: null,
  edit: null,
  check: null,
  gate: null,
  result: null,
  error: null,
  blocked: null,
};

function writeEvidence() {
  try {
    mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  } catch {
    // Evidence writing must never change the verdict.
  }
}

function cleanup() {
  try {
    rmSync(fixtureRoot, { recursive: true, force: true });
  } catch {
    // Best effort; a temp fixture never blocks the observation.
  }
}

function finish(code) {
  writeEvidence();
  flushOutput();
  cleanup();
  process.exit(code);
}

function blockAndExit(layer, message) {
  const reason = bounded(redactSensitive(oneLine(message)), 600) || "unknown provider error";
  evidence.result = "blocked";
  evidence.blocked = { layer, reason };
  writeEvidence();
  flushOutput();
  writeSync(1, `LIVE: BLOCKED ${layer} ${reason}\n`);
  cleanup();
  process.exit(2);
}

function contradictionAndExit(synthesis) {
  evidence.result = "blocked_contradiction";
  evidence.synthesis = synthesis;
  say(`[synthesis] accepted=false contradiction=${bounded(synthesis.contradiction.kind, 500)}`);
  say(`RESULT: BLOCKED (children disagreed; no edit applied; ${bounded(synthesis.contradiction.detail, 600)})`);
  finish(3);
}

try {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(authorityRoot, { recursive: true });
  buildFixture(workspace);
  approveFixtureCheck(workspace, authorityRoot);
  say(`[fixture] ${workspace} (git repo, approved ${CHECK_ID})`);

  const authority = approvalAuthorityFor(workspace, authorityRoot);
  const approvals = readApprovals(authority, WORKSPACE_ID);
  const catalogue = resolveCatalogue({
    projectRoot: workspace,
    workspaceId: WORKSPACE_ID,
    changedFiles: null,
    authority,
    approvals,
  });
  if (catalogue.status !== "configured") {
    throw new Error(`expected a configured catalogue for ${CHECK_ID}, received ${catalogue.status}`);
  }

  let boundary;
  try {
    boundary = await createLiveModelBoundary();
  } catch (error) {
    if (error instanceof LiveBlocked) blockAndExit(error.layer, error.message);
    const classified = classifyBlockedText(errorMessage(error));
    if (classified !== null) blockAndExit(classified.layer, classified.message);
    throw error;
  }
  evidence.model = {
    provider: boundary.modelInfo.provider,
    modelId: boundary.modelInfo.modelId,
    resolution: boundary.modelInfo.resolution,
  };
  say(
    `[LIVE] provider=${boundary.modelInfo.provider} model=${boundary.modelInfo.modelId} ` +
      `resolution=${boundary.modelInfo.resolution}`,
  );

  const runtime = createDelegationRuntime({ workspaceDir: workspace, stateDir, boundary });
  const roles = rolesFor(workspace);

  let result;
  try {
    result = await withTimeout(
      runEngineeringDelegation(
        { dagManager: runtime.dagManager, wait: runtime.wait },
        {
          objective:
            "Find the defect in src/sum.js, agree on the exact find/replace that repairs add(), and report it. Do not edit.",
          workingDirectory: workspace,
          roles,
          parentSessionId: PARENT_SESSION_ID,
          rootSessionId: ROOT_SESSION_ID,
          deadlineMs: LIVE_TIMEOUT_MS,
        },
      ),
      LIVE_TIMEOUT_MS + 60_000,
      "engineering delegation run",
    );
  } catch (error) {
    const classified = classifyBlockedText(errorMessage(error));
    if (classified !== null) blockAndExit(classified.layer, classified.message);
    throw error;
  }

  if (!result.ok) {
    if (result.kind === "deadline_unavailable_at_manager_seam") {
      evidence.result = "deadline_unavailable";
      evidence.run = {
        kind: result.kind,
        reason: result.reason,
        runId: result.runId,
        unresolved: result.unresolved,
        outcomes: result.outcomes,
      };
      say(`RESULT: DEADLINE_UNAVAILABLE ${result.kind} ${oneLine(result.reason)}`);
      finish(1);
    }
    evidence.result = "plan_rejected";
    evidence.run = { rejection: result.rejection };
    say(`RESULT: PLAN_REJECTED ${result.rejection.code} ${oneLine(result.rejection.message)}`);
    finish(1);
  }

  const record = runtime.dagManager.record(result.runId, PARENT_SESSION_ID);
  const nodes = projectNodes({ record, dagStore: runtime.dagStore, taskManager: runtime.taskManager });
  evidence.run = {
    runId: result.runId,
    status: record.status,
    terminal: isTerminalDagRunStatus(record.status),
    unresolved: result.unresolved,
    outcomes: result.outcomes,
  };
  evidence.children = nodes;

  const blocked = nodes
    .map((node) => classifyBlockedText(node.childErrorMessage ?? node.nodeErrorMessage ?? ""))
    .find((entry) => entry !== null);
  if (blocked !== undefined && blocked !== null) blockAndExit(blocked.layer, blocked.message);

  printNodes(nodes);

  const attributedNodes = nodes.filter(
    (node) => node.childTaskId !== null && node.childStatus === "completed" && node.assertedModel !== null,
  );
  const distinctTaskIds = new Set(attributedNodes.map((node) => node.childTaskId));
  const bothAttributed =
    nodes.length === 2 &&
    attributedNodes.length === 2 &&
    distinctTaskIds.size === 2 &&
    nodes.every((node) => node.nodeState === "completed");
  evidence.attribution = {
    childCount: nodes.length,
    attributedCount: attributedNodes.length,
    distinctTaskIds: distinctTaskIds.size,
    allAttributed: bothAttributed,
  };

  if (record.status !== "completed" || result.unresolved || !bothAttributed) {
    say(
      `RESULT: FAIL (run status=${record.status} unresolved=${String(result.unresolved)} ` +
        `attributed=${attributedNodes.length}/${nodes.length})`,
    );
    finish(1);
  }

  const fullOutputs = new Map();
  for (const node of record.nodes) {
    fullOutputs.set(node.id, readNodeOutput(runtime.dagStore, result.runId, node));
  }
  const investigation = parseInvestigation(fullOutputs.get(INVESTIGATE_NODE) ?? "");
  const review = parseReview(fullOutputs.get(REVIEW_NODE) ?? "");

  if (!investigation.ok || !review.ok) {
    evidence.synthesis = {
      accepted: false,
      investigation: investigation.ok ? investigation.value : { error: investigation.detail },
      review: review.ok ? review.value : { error: review.detail },
    };
    say(
      `RESULT: FAIL (child answer unusable: ${bounded(
        [investigation.ok ? null : `investigate: ${investigation.detail}`, review.ok ? null : `review: ${review.detail}`]
          .filter((entry) => entry !== null)
          .join("; "),
        600,
      )})`,
    );
    finish(1);
  }

  const investigationValue = investigation.value;
  const reviewValue = review.value;
  const sameFind = normalizeEditText(investigationValue.find) === normalizeEditText(reviewValue.find);
  const sameReplace = normalizeEditText(investigationValue.replace) === normalizeEditText(reviewValue.replace);
  const synthesis = {
    accepted: reviewValue.verdict === "confirm" && sameFind && sameReplace,
    investigator: investigationValue,
    reviewer: reviewValue,
    agreement: { sameFind, sameReplace },
    contradiction: null,
  };

  if (reviewValue.verdict !== "confirm") {
    synthesis.contradiction = {
      kind: "reviewer_rejected",
      detail: `reviewer verdict=${reviewValue.verdict}: ${reviewValue.reason ?? "no reason given"}`,
      investigator: investigationValue,
      reviewer: reviewValue,
    };
    contradictionAndExit(synthesis);
  }
  if (!sameFind || !sameReplace) {
    synthesis.contradiction = {
      kind: "edit_text_mismatch",
      detail: `sameFind=${String(sameFind)} sameReplace=${String(sameReplace)}; investigator=${JSON.stringify({
        find: investigationValue.find,
        replace: investigationValue.replace,
      })} reviewer=${JSON.stringify({ find: reviewValue.find, replace: reviewValue.replace })}`,
      investigator: investigationValue,
      reviewer: reviewValue,
    };
    contradictionAndExit(synthesis);
  }

  evidence.synthesis = synthesis;
  say(
    `[synthesis] accepted=true reviewer=confirm find=${JSON.stringify(investigationValue.find)} ` +
      `replace=${JSON.stringify(investigationValue.replace)}`,
  );

  const beforeContent = readFileSync(path.join(workspace, CHECK_FILE), "utf8");
  const beforeRevision = workspaceRevision(workspace);
  evidence.edit = { beforeContent, beforeRevision, applied: false };
  const occurrences = countOccurrences(beforeContent, investigationValue.find);
  if (occurrences !== 1) {
    evidence.edit.failure = `the agreed find text occurs ${occurrences} times in ${CHECK_FILE}; the executor needs exactly one`;
    say(`RESULT: FAIL (${evidence.edit.failure})`);
    finish(1);
  }

  const receipt = await applyRepairEdits({
    plan: repairPlanFor({
      edit: investigationValue,
      defect: investigationValue.defect,
      reason: reviewValue.reason,
    }),
    workspaceDir: workspace,
    baselineRevision: beforeRevision,
    edits: [{ path: CHECK_FILE, oldText: investigationValue.find, newText: investigationValue.replace }],
  });

  evidence.edit = {
    beforeContent,
    beforeRevision,
    applied: receipt.status === "applied",
    status: receipt.status,
    files: receipt.files,
    receiptRevision: receipt.revision,
    failures: receipt.failures,
    find: investigationValue.find,
    replace: investigationValue.replace,
  };
  if (receipt.status !== "applied") {
    const failures = receipt.failures
      .map((failure) => `${failure.code}: ${failure.message}`)
      .join("; ");
    say(`RESULT: FAIL (executor rejected the agreed edit: ${bounded(failures, 600)})`);
    finish(1);
  }

  const afterContent = readFileSync(path.join(workspace, CHECK_FILE), "utf8");
  const afterRevision = workspaceRevision(workspace);
  evidence.edit.afterContent = afterContent;
  evidence.edit.afterRevision = afterRevision;

  const evidenceRoot = path.join(stateDir, "verifications");
  const capture = createOrdinaryVerificationCapture({
    store: createFileEvidenceStore(evidenceRoot),
    projectDir: workspace,
    currentRevision: () => workspaceRevision(workspace),
  });
  const captured = await capture.capture({
    binding: { runId: result.runId, sessionId: PARENT_SESSION_ID, epoch: EVIDENCE_EPOCH },
    changedFiles: [CHECK_FILE],
    available: catalogueChecks(catalogue),
    attempt: 1,
  });
  const checkRecord = captured.records[0] ?? null;

  evidence.check = {
    checkId: checkRecord?.checkId ?? CHECK_ID,
    forwardedToRunner: captured.selection.required.map((check) => check.checkId),
    omitted: captured.selection.omitted.map((entry) => ({ checkId: entry.check.checkId, reason: entry.reason })),
    status: checkRecord?.status ?? null,
    started: checkRecord?.started ?? null,
    exitCode: checkRecord?.exitCode ?? null,
    sourceRevision: checkRecord?.sourceRevision ?? null,
    durationMs: checkRecord?.durationMs ?? null,
    outputSummary: checkRecord === null ? null : bounded(redactSensitive(checkRecord.outputSummary), 1200),
    persisted: captured.persistedPaths,
    freshForAfterRevision: checkRecord !== null && checkRecord.sourceRevision === afterRevision,
  };

  const gate = evaluateOrdinaryCompletion({
    taskId: result.runId,
    catalogue,
    evidenceRoot,
    workspaceDir: workspace,
    epoch: EVIDENCE_EPOCH,
  });
  evidence.gate = gate;

  say(`[revision] before=${beforeRevision}`);
  say(`[revision] after=${afterRevision}`);
  say(
    `[edit] applied ${receipt.files.map((file) => file.path).join(",")} find=${JSON.stringify(investigationValue.find)} ` +
      `replace=${JSON.stringify(investigationValue.replace)}`,
  );
  say(
    `[check] ${evidence.check.checkId} status=${evidence.check.status ?? "none"} exit=${String(evidence.check.exitCode)} ` +
      `started=${String(evidence.check.started)} revision=${evidence.check.sourceRevision ?? "none"} ` +
      `fresh=${String(evidence.check.freshForAfterRevision)}`,
  );
  say(`[check.output] "${evidence.check.outputSummary ?? ""}"`);
  say(
    `[gate] verification=${gate.verification} code=${gate.code ?? "none"} reason=${bounded(redactSensitive(gate.reason ?? ""), 600)}`,
  );

  if (gate.verification === "verified" && bothAttributed) {
    evidence.result = "verified";
    say(`RESULT: VERIFIED (2 live children attributed, gate verified ${CHECK_ID} at the resulting revision)`);
    finish(0);
  }

  evidence.result = "not_verified";
  say(
    `RESULT: FAIL (gate=${gate.verification}${gate.code === undefined ? "" : `/${gate.code}`}; ` +
      `attributed=${attributedNodes.length}/${nodes.length})`,
  );
  finish(1);
} catch (error) {
  const classified = classifyBlockedText(errorMessage(error));
  if (classified !== null) blockAndExit(classified.layer, classified.message);
  evidence.result = "failed";
  evidence.error = bounded(redactSensitive(errorMessage(error)), 900);
  say(`RESULT: FAIL (${evidence.error})`);
  finish(1);
}
