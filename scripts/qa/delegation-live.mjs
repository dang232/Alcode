/**
 * LIVE engineering-delegation acceptance harness (C3, first half).
 *
 * Proves a DAG run can drive TWO REAL child agents on the live model doing
 * distinct work. Nothing here is scripted or echoed:
 *   - createTaskManager (packages/omo-engine/senpi-task/src/manager/manager.ts)
 *     is the REAL manager with its real record store, depth policy, plan
 *     resolution, and runner seam;
 *   - createDagManager + createDagScheduler + createDagWaitSurface are the REAL
 *     DAG engine (journal, checkpoints, dependency frontier, result store);
 *   - runEngineeringDelegation (src/delegation/run.ts) builds the real
 *     investigate -> review plan;
 *   - the ChildPlanner resolves the live provider/model from the Senpi
 *     settings and the child is spawned through the REAL InProcessRunner, so
 *     each DAG node is a real agent session that calls its own tools.
 *
 * The plan asks two roles to do different work on one tiny fixture file:
 *   investigate: read the fixture and report the checksum-hint value;
 *   review: read the same fixture independently and state whether the claimed
 *           value is correct.
 *
 * The harness records observations only. It asserts NO verification verdict:
 * the script prints each node's child task id, child terminal status, asserted
 * model (when the record carries one), and a bounded output preview, then one
 * RESULT line saying how many real children ran.
 *
 * Exit codes:
 *   0  two real children ran with distinct output
 *   1  fewer than two real children ran, or the run/engine failed
 *   2  LIVE: BLOCKED <reason> - the live model could not be reached
 *
 * Usage:
 *   node scripts/qa/delegation-live.mjs
 *   node scripts/qa/delegation-live.mjs --no-reexec
 *
 * Evidence:
 *   .omo/ulw/p24/delegation-live.json
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
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
const EVIDENCE_PATH = path.join(ROOT, ".omo", "ulw", "p24", "delegation-live.json");

const PARENT_SESSION_ID = "delegation-live-parent";
const ROOT_SESSION_ID = "delegation-live-root";
const FIXTURE_FILE = "fixture.txt";
const FIXTURE_KEY = "checksum-hint";
const FIXTURE_VALUE = "7F3A";
const PREVIEW_CHARS = 800;

const LIVE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.DELEGATION_LIVE_TIMEOUT_MS);
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
if (!isBun && !process.argv.includes("--no-reexec") && !process.env.DELEGATION_LIVE_VIA_BUN) {
  const candidates = process.platform === "win32" ? ["bun", "bun.exe"] : ["bun"];
  let done = false;
  for (const candidate of candidates) {
    let res;
    try {
      res = spawnSync(candidate, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
        stdio: "inherit",
        env: { ...process.env, DELEGATION_LIVE_VIA_BUN: "1" },
      });
    } catch {
      continue;
    }
    if (res.error && res.error.code === "ENOENT") continue;
    done = true;
    process.exit(res.status ?? 1);
  }
  if (!done) {
    console.log("RESULT: FAIL (bun runtime not found; delegation-live needs bun to import the real TS chain)");
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

function blockAndExit(layer, message) {
  const reason = bounded(redactSensitive(oneLine(message)), 600) || "unknown provider error";
  writeSync(1, `LIVE: BLOCKED ${layer} ${reason}\n`);
  process.exit(2);
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
// Fixture and plan.
// ---------------------------------------------------------------------------
function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "delegation-live-"));
  const content = [
    "fleet-id: kestrel-42",
    `${FIXTURE_KEY}: ${FIXTURE_VALUE}`,
    "operator-note: delegation-live fixture",
    "",
  ].join("\n");
  writeFileSync(path.join(root, FIXTURE_FILE), content, "utf8");
  return { root, fixturePath: path.join(root, FIXTURE_FILE), content };
}

function rolesFor(fixturePath) {
  return [
    {
      key: "investigate",
      assignment:
        `Use the read tool to open ${JSON.stringify(fixturePath)} and report exactly one concrete fact: ` +
        `the verbatim value of the "${FIXTURE_KEY}" key. Quote the full line you observed. Do not edit anything.`,
    },
    {
      key: "review",
      assignment:
        `Use the read tool to open ${JSON.stringify(fixturePath)} yourself and state whether this claim is correct: ` +
        `"${FIXTURE_KEY} is ${FIXTURE_VALUE}". Quote the line you observed and say whether it confirms or contradicts the claim. ` +
        "Do not rely on another node's report and do not edit anything.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Real manager + real DAG wiring.
// ---------------------------------------------------------------------------
function createDelegationRuntime({ fixtureRoot, boundary }) {
  const stateDir = path.join(fixtureRoot, "state");
  const store = createTaskRecordStore({ project_dir: fixtureRoot, task: { state_dir: stateDir } });
  const dagStore = createDagFileStore({ project_dir: fixtureRoot, task: { state_dir: stateDir } });

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
    cwd: fixtureRoot,
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
      waitSurface.wait(runId, PARENT_SESSION_ID).then(result => ({ kind: "result", result })),
      new Promise(resolve => {
        const timer = setTimeout(() => resolve({ kind: "deadline" }), deadlineMs);
        timer.unref?.();
      }),
    ]);
    if (settled.kind === "result") {
      await runStarted.get(runId);
      return settled.result;
    }
    // The deadline elapsed: report the engine's current durable snapshot instead
    // of inventing a terminal result. The run itself is not cancelled - the
    // manager seam has no run cancel (dag/manager.ts:161-164).
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
      runStats: node.runStats ?? null,
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
// Main.
// ---------------------------------------------------------------------------
const fixture = createFixture();
let evidenceWritten = false;

try {
  say(`[fixture] ${fixture.fixturePath}`);

  let boundary;
  try {
    boundary = await createLiveModelBoundary();
  } catch (error) {
    if (error instanceof LiveBlocked) blockAndExit(error.layer, error.message);
    const classified = classifyBlockedText(errorMessage(error));
    if (classified !== null) blockAndExit(classified.layer, classified.message);
    throw error;
  }
  say(
    `[LIVE] provider=${boundary.modelInfo.provider} model=${boundary.modelInfo.modelId} ` +
      `resolution=${boundary.modelInfo.resolution}`,
  );

  const runtime = createDelegationRuntime({ fixtureRoot: fixture.root, boundary });
  const roles = rolesFor(fixture.fixturePath);

  let result;
  try {
    result = await withTimeout(
      runEngineeringDelegation(
        { dagManager: runtime.dagManager, wait: runtime.wait },
        {
          objective:
            "Prove two independent delegation roles can inspect one tiny fixture with the live model and produce distinct observations.",
          workingDirectory: fixture.root,
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
    say(`RESULT: PLAN_REJECTED ${result.rejection.code} ${oneLine(result.rejection.message)}`);
    flushOutput();
    process.exit(1);
  }

  const record = runtime.dagManager.record(result.runId, PARENT_SESSION_ID);
  const nodes = projectNodes({ record, dagStore: runtime.dagStore, taskManager: runtime.taskManager });
  const blocked = nodes
    .map((node) => classifyBlockedText(node.childErrorMessage ?? node.nodeErrorMessage ?? ""))
    .find((entry) => entry !== null);
  if (blocked !== undefined && blocked !== null) {
    blockAndExit(blocked.layer, blocked.message);
  }

  printNodes(nodes);

  const realChildren = nodes.filter((node) => node.childTaskId !== null && node.childStatus !== null);
  const terminalChildren = realChildren.filter((node) =>
    ["completed", "error", "cancelled", "interrupted", "lost"].includes(node.childStatus),
  );
  const completedChildren = realChildren.filter((node) => node.childStatus === "completed");
  const previews = completedChildren.map((node) => node.outputPreview);
  const distinctOutput = new Set(previews).size === completedChildren.length && completedChildren.length > 0;

  const evidence = {
    generatedAt: new Date().toISOString(),
    live: true,
    scriptedPlanner: false,
    scriptedChild: false,
    runId: result.runId,
    parentSessionId: PARENT_SESSION_ID,
    rootSessionId: ROOT_SESSION_ID,
    model: {
      provider: boundary.modelInfo.provider,
      modelId: boundary.modelInfo.modelId,
      resolution: boundary.modelInfo.resolution,
    },
    fixture: {
      path: fixture.fixturePath,
      file: FIXTURE_FILE,
      content: fixture.content,
    },
    run: {
      status: record.status,
      terminal: isTerminalDagRunStatus(record.status),
      unresolved: result.unresolved,
      deadlineExceeded: result.deadlineExceeded,
      deadlineCancellation: result.deadlineCancellation,
      outcomes: result.outcomes,
    },
    nodes,
    observation: {
      childCount: realChildren.length,
      terminalChildCount: terminalChildren.length,
      completedChildCount: completedChildren.length,
      distinctCompletedOutput: distinctOutput,
    },
  };

  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  evidenceWritten = true;

  say(`run=${result.runId} status=${record.status} unresolved=${String(result.unresolved)}`);
  say(`evidence: ${EVIDENCE_PATH}`);
  if (realChildren.length === 2 && distinctOutput) {
    say(`RESULT: 2 real children ran with distinct output (${completedChildren.length} completed)`);
    flushOutput();
    process.exit(0);
  }
  if (realChildren.length === 1) {
    say(`RESULT: 1 real child ran; the second did not run (completed=${completedChildren.length})`);
    flushOutput();
    process.exit(1);
  }
  if (realChildren.length > 1) {
    say(
      `RESULT: ${realChildren.length} real children ran; distinct completed output=${String(distinctOutput)} ` +
        `(completed=${completedChildren.length})`,
    );
    flushOutput();
    process.exit(distinctOutput ? 0 : 1);
  }
  say("RESULT: 0 real children ran");
  flushOutput();
  process.exit(1);
} catch (error) {
  const classified = classifyBlockedText(errorMessage(error));
  if (classified !== null) blockAndExit(classified.layer, classified.message);
  say(`RESULT: FAIL (${bounded(redactSensitive(errorMessage(error)), 600)})`);
  if (evidenceWritten) say(`evidence: ${EVIDENCE_PATH}`);
  flushOutput();
  process.exit(1);
} finally {
  try {
    rmSync(fixture.root, { recursive: true, force: true });
  } catch {
    // Best effort; a temp fixture never blocks the observation.
  }
}
