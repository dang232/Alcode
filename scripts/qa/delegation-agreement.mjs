/**
 * C5 agreement harness: one REAL delegation run compared across four surfaces.
 *
 *   1. manager child records, read from the persisted JSONL/JSON task store
 *      (`<stateDir>/tasks/<taskId>.json`) - task id, status, parent ref, and
 *      the durable `owner` marker that names the DAG run + node;
 *   2. the DAG snapshot, read from the persisted checkpoint
 *      (`<stateDir>/dag/runs/<runId>.json`) and from `DagManager.snapshot`
 *      - node id -> state plus the node's `taskId` attribution;
 *   3. the panel payload. Its producer is OUTSIDE this repo: the bridge
 *      fixture names `dag-snapshot-payload.ts dagUpdatedPayload` and
 *      `task-rpc-bridge.ts taskUpdatedPayload`
 *      (packages/web/server/lib/opencode/omo-bridge-fixture.json:2), and
 *      neither module exists here. The bridge itself only stores the
 *      `omo.dag.updated` / `omo.task.updated` documents it receives
 *      (packages/web/server/lib/opencode/omo-bridge-runtime.js:58-60).
 *      Because that producer cannot be run from this repository, this harness
 *      replays the documented wire shape field-for-field from the REAL
 *      persisted DAG checkpoint - no node, state, edge, or wave is invented -
 *      and clearly labels the replay. The in-repo host chat producer
 *      (`buildDagRunModel` -> `dagRunModelToSnapshotDoc`) is also executed
 *      against the real store slices so its result is recorded, not assumed;
 *      for an engine run it has no OpenCode child sessions and answers null,
 *      so the panel falls back to the service snapshot for this run.
 *   4. the panel rows, through the panel's own exported modules:
 *      `parseSnapshotDoc` (panel/dag-view.ts) and `buildActivityTimeline`
 *      (panel/activity-view.ts). The details card has no exported formatter;
 *      its exact row list is replicated from panel/main.ts:552-562 and that
 *      fact is recorded, because the iframe cannot be driven headlessly
 *      without a DOM.
 *
 * Assertions, node by node:
 *   - the node id set is identical across manager owner markers, the DAG
 *     snapshot, and the panel payload (no fabricated node, no missing node);
 *   - the terminal state agrees across manager status, DAG node state, and the
 *     panel node state;
 *   - wherever a manager record carries a child task id, the DAG snapshot and
 *     the panel payload attribute that task id to the same node.
 *
 * A missing field is a DISAGREE, never a skip. The harness prints a per-node
 * table and exactly one `RESULT: AGREE|DISAGREE <detail>` line, and writes
 * `.omo/ulw/p24/delegation-agreement.json`.
 *
 * Usage:
 *   node scripts/qa/delegation-agreement.mjs
 *   node scripts/qa/delegation-agreement.mjs --no-reexec
 *
 * Exit codes:
 *   0  RESULT: AGREE
 *   1  RESULT: DISAGREE (every mismatch named)
 *   2  LIVE: BLOCKED <reason> - the live provider could not run the children
 *   3  harness failure (the run never produced persisted records)
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
const UI_MODULE = path.join(ROOT, "packages", "ui", "src", "lib", "dagRunModel.ts");
const PANEL_VIEW = path.join(ROOT, "packages", "extensions", "dag-pane", "panel", "dag-view.ts");
const PANEL_ACTIVITY = path.join(ROOT, "packages", "extensions", "dag-pane", "panel", "activity-view.ts");
const PANEL_SERVICE = path.join(ROOT, "packages", "extensions", "dag-pane", "service", "handlers.js");
const EVIDENCE_PATH = path.join(ROOT, ".omo", "ulw", "p24", "delegation-agreement.json");

const PARENT_SESSION_ID = "delegation-agreement-parent";
const ROOT_SESSION_ID = "delegation-agreement-root";
const FIXTURE_FILE = "fixture.txt";
const FIXTURE_KEY = "checksum-hint";
const FIXTURE_VALUE = "7F3A";
const PREVIEW_CHARS = 600;

const LIVE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.DELEGATION_AGREEMENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 420_000;
})();

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
if (!isBun && !process.argv.includes("--no-reexec") && !process.env.DELEGATION_AGREEMENT_VIA_BUN) {
  const candidates = process.platform === "win32" ? ["bun", "bun.exe"] : ["bun"];
  let done = false;
  for (const candidate of candidates) {
    let res;
    try {
      res = spawnSync(candidate, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
        stdio: "inherit",
        env: { ...process.env, DELEGATION_AGREEMENT_VIA_BUN: "1" },
      });
    } catch {
      continue;
    }
    if (res.error && res.error.code === "ENOENT") continue;
    done = true;
    process.exit(res.status ?? 1);
  }
  if (!done) {
    console.log("RESULT: FAIL (bun runtime not found; delegation-agreement needs bun to import the real TS chain)");
    process.exit(3);
  }
}

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
const { buildDagRunModel, dagRunModelToSnapshotDoc } = await import(UI_MODULE);
const { parseSnapshotDoc } = await import(PANEL_VIEW);
const { buildActivityTimeline } = await import(PANEL_ACTIVITY);
const { createDagServiceHandlers } = await import(PANEL_SERVICE);

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
  writeEvidence();
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
// Fixture and plan: two real read-only roles over one tiny file.
// ---------------------------------------------------------------------------
function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "delegation-agreement-"));
  const content = [
    "fleet-id: kestrel-42",
    `${FIXTURE_KEY}: ${FIXTURE_VALUE}`,
    "operator-note: delegation-agreement fixture",
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
// Persisted-source readers. These read the files the engine wrote, not the
// in-memory objects the harness already holds.
// ---------------------------------------------------------------------------
function readJsonRecord(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return asRecord(parsed);
}

function readPersistedTaskRecords(stateDir) {
  const tasksDir = path.join(stateDir, "tasks");
  const files = [];
  const records = [];
  const diagnostics = [];
  let names = [];
  try {
    names = readdirSync(tasksDir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const file = path.join(tasksDir, name);
    files.push(file);
    try {
      const record = readJsonRecord(file);
      if (record === null) {
        diagnostics.push({ file, error: "not a JSON record" });
        continue;
      }
      records.push({ file, record });
    } catch (error) {
      diagnostics.push({ file, error: bounded(redactSensitive(errorMessage(error)), 300) });
    }
  }
  return { dir: tasksDir, files, records, diagnostics };
}

function readPersistedDagCheckpoint(stateDir, runId) {
  const file = path.join(stateDir, "dag", "runs", `${runId}.json`);
  if (!existsSync(file)) {
    return { file, record: null, error: "checkpoint not found" };
  }
  try {
    return { file, record: readJsonRecord(file), error: null };
  } catch (error) {
    return { file, record: null, error: bounded(redactSensitive(errorMessage(error)), 300) };
  }
}

function taskProjection(entry) {
  const record = entry.record;
  const owner = asRecord(record.owner);
  return {
    file: entry.file,
    taskId: asString(record.task_id),
    status: asString(record.status),
    parentSessionId: asString(record.parent_session_id),
    rootSessionId: asString(record.root_session_id),
    name: asString(record.name),
    updatedAt: asString(record.updated_at),
    owner:
      owner === null
        ? null
        : {
            kind: asString(owner.kind),
            runId: asString(owner.runId),
            nodeId: asString(owner.nodeId),
            fingerprint: asString(owner.fingerprint),
          },
  };
}

function snapshotNodeProjection(node) {
  return {
    id: asString(node.id),
    label: asString(node.label),
    state: asString(node.state),
    taskId: asString(node.taskId),
    attempt: Number.isFinite(node.attempt) ? node.attempt : null,
    prompt: asString(node.prompt) ?? "",
    dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn.map((entry) => String(entry)) : [],
    startedAt: asString(node.startedAt),
    completedAt: asString(node.completedAt),
  };
}

function snapshotProjection(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    runId: asString(snapshot.runId),
    runKey: asString(snapshot.runKey),
    name: asString(snapshot.name),
    parentSessionId: asString(snapshot.parentSessionId),
    rootSessionId: asString(snapshot.rootSessionId),
    status: asString(snapshot.status),
    terminal: isTerminalDagRunStatus(snapshot.status),
    createdAt: asString(snapshot.createdAt),
    completedAt: asString(snapshot.completedAt),
    counts: asRecord(snapshot.counts),
    nodes: snapshot.nodes.map(snapshotNodeProjection),
    edges: snapshot.edges.map((edge) => ({ from: asString(edge.from), to: asString(edge.to) })),
    waves: snapshot.waves.map((wave) => ({
      index: Number.isFinite(wave.index) ? wave.index : null,
      nodeIds: Array.isArray(wave.nodeIds) ? wave.nodeIds.map((entry) => String(entry)) : [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Panel payload. The producer is outside this repo; the replay maps only
// fields the persisted DAG checkpoint actually holds onto the documented
// snake_case wire shape consumed by panel/dag-view.ts. No node is invented,
// and no task_id is added to a node because the documented wire node carries
// none (see omo-bridge-fixture.json:2-5 and dag-view.ts:272-295).
// ---------------------------------------------------------------------------
function bridgePayloadFromSnapshot(snapshot, taskProjections) {
  const counts = asRecord(snapshot.counts) ?? {};
  const countOf = (key) => (Number.isFinite(counts[key]) ? counts[key] : 0);
  return {
    schemaVersion: 1,
    sessionId: snapshot.parentSessionId,
    updatedAt: snapshot.completedAt ?? snapshot.createdAt,
    dag: {
      runs: [
        {
          run_id: snapshot.runId,
          run_key: snapshot.runKey,
          name: snapshot.name,
          status: snapshot.status,
          counts: {
            pending: countOf("pending"),
            running: countOf("running"),
            completed: countOf("completed"),
            failed: countOf("failed"),
            cancelled: countOf("cancelled"),
          },
          nodes: snapshot.nodes.map((node) => ({
            id: node.id,
            label: node.label ?? node.id,
            state: node.state,
            attempt: node.attempt,
            prompt: node.prompt,
            depends_on: [...node.dependsOn],
            started_at: node.startedAt ?? null,
            completed_at: node.completedAt ?? null,
          })),
          edges: snapshot.edges.map((edge) => ({ from: edge.from, to: edge.to })),
          waves: snapshot.waves.map((wave) => ({ index: wave.index, node_ids: [...wave.nodeIds] })),
        },
      ],
    },
    tasks: {
      parent_session_id: snapshot.parentSessionId,
      tasks: taskProjections.map((task) => ({
        task_id: task.taskId,
        status: task.status,
        name: task.name ?? task.taskId,
        task_summary: "",
      })),
    },
  };
}

/**
 * The details card's exact row list. There is no exported formatter for this
 * card; the list below is copied from panel/main.ts:552-562 and the harness
 * records that provenance. Everything else (parse + activity rows) comes from
 * the panel's own exported modules.
 */
function detailsCardRows(node) {
  return [
    ["id", node.id],
    ["label", node.label],
    ["state", node.state],
    ["attempt", String(node.attempt)],
    ["prompt", node.prompt],
    ["depends_on", node.dependsOn.join(", ") || "-"],
    ["started", node.startedAt ?? "-"],
    ["completed", node.completedAt ?? "-"],
  ];
}

const PRODUCER_EVIDENCE = {
  externalBuilder:
    "packages/web/server/lib/opencode/omo-bridge-fixture.json:2 names dag-snapshot-payload.ts dagUpdatedPayload and task-rpc-bridge.ts taskUpdatedPayload; neither file exists in this repository.",
  bridgeChannels: "packages/web/server/lib/opencode/omo-bridge-runtime.js:58-60",
  panelParser: "packages/extensions/dag-pane/panel/dag-view.ts:272-295 (readNode) and :373-395 (readTasks)",
  panelService: "packages/extensions/dag-pane/service/handlers.js:1098-1161 (GET/POST /snapshot)",
  detailsRows: "packages/extensions/dag-pane/panel/main.ts:552-562",
  activityRows: "packages/extensions/dag-pane/panel/activity-view.ts:152-187",
  hostChatProducer: "packages/ui/src/lib/dagRunModel.ts:169-175 (no parent session -> null)",
};

function managerStatusesForDagState(state) {
  if (state === "completed") return ["completed"];
  if (state === "failed") return ["error", "interrupted", "lost"];
  if (state === "cancelled") return ["cancelled"];
  if (state === "skipped") return [];
  return null;
}

function addMismatch(mismatches, entry) {
  mismatches.push(entry);
}

function compareSources({
  snapshotView,
  checkpoint,
  taskEntries,
  panelOutcome,
  panelPayload,
  hostProducer,
  activityTimeline,
}) {
  const mismatches = [];
  const notes = [];
  const table = [];

  const dagNodes = new Map(snapshotView.nodes.map((node) => [node.id, node]));
  const checkpointRecords =
    checkpoint.record === null || !Array.isArray(checkpoint.record.nodes) ? [] : checkpoint.record.nodes;
  const checkpointNodes = new Map(
    checkpointRecords.map((node) => [asString(node.id), node]).filter(([id]) => id !== null),
  );
  const taskByTaskId = new Map();
  const taskByNodeId = new Map();
  for (const entry of taskEntries) {
    const task = taskProjection(entry);
    if (task.taskId !== null) taskByTaskId.set(task.taskId, { task, entry });
    if (task.owner !== null && task.owner.nodeId !== null) {
      if (task.owner.runId === null || task.owner.runId === snapshotView.runId) {
        taskByNodeId.set(task.owner.nodeId, { task, entry });
      }
    }
  }

  const dagIds = [...dagNodes.keys()].sort();
  const checkpointIds = [...checkpointNodes.keys()].sort();
  const managerIds = [...taskByNodeId.keys()].sort();
  const panelIds =
    panelOutcome.ok && panelOutcome.view.runs.length > 0
      ? panelOutcome.view.runs[0].nodes.map((node) => node.id).sort()
      : [];

  const compareIdSet = (source, observed) => {
    for (const id of dagIds) {
      if (!observed.includes(id)) {
        addMismatch(mismatches, {
          kind: "missing_node",
          nodeId: id,
          field: "id",
          source,
          detail: `DAG node ${id} is absent in ${source}`,
        });
      }
    }
    for (const id of observed) {
      if (!dagIds.includes(id)) {
        addMismatch(mismatches, {
          kind: "fabricated_node",
          nodeId: id,
          field: "id",
          source,
          detail: `${source} carries node ${id}, which the DAG snapshot does not`,
        });
      }
    }
  };
  compareIdSet("manager records (owner.nodeId)", managerIds);
  compareIdSet("persisted DAG checkpoint", checkpointIds);
  compareIdSet("panel payload", panelIds);
  if (!panelOutcome.ok) {
    addMismatch(mismatches, {
      kind: "payload_malformed",
      nodeId: null,
      field: panelOutcome.error.field,
      source: "panel payload",
      detail: `parseSnapshotDoc rejected the payload at ${panelOutcome.error.field}`,
      producer: PRODUCER_EVIDENCE.panelParser,
    });
  }

  const panelNodes = new Map();
  if (panelOutcome.ok && panelOutcome.view.runs.length > 0) {
    for (const node of panelOutcome.view.runs[0].nodes) panelNodes.set(node.id, node);
  }
  const activityByNode = new Map();
  for (const row of activityTimeline.rows) {
    const rows = activityByNode.get(row.nodeId) ?? [];
    rows.push(row);
    activityByNode.set(row.nodeId, rows);
  }

  for (const node of snapshotView.nodes) {
    const checkpointNode = checkpointNodes.get(node.id);
    const taskEntry = node.taskId === null ? undefined : taskByTaskId.get(node.taskId);
    const task = taskEntry === undefined ? null : taskEntry.task;
    const panelNode = panelNodes.get(node.id) ?? null;
    const activityRows = activityByNode.get(node.id) ?? [];
    const verdicts = [];

    if (checkpointNode === undefined) {
      addMismatch(mismatches, {
        kind: "missing_node",
        nodeId: node.id,
        field: "id",
        source: "persisted DAG checkpoint",
        detail: `node ${node.id} is absent in the persisted checkpoint (${checkpoint.file})`,
      });
    } else {
      const checkpointState = asString(checkpointNode.state);
      if (checkpointState !== node.state) {
        addMismatch(mismatches, {
          kind: "state_mismatch",
          nodeId: node.id,
          field: "state",
          source: "persisted DAG checkpoint",
          detail: `checkpoint state=${checkpointState ?? "absent"} but DagManager snapshot state=${node.state}`,
        });
      }
      const checkpointTaskId = asString(checkpointNode.taskId);
      if (checkpointTaskId !== node.taskId) {
        addMismatch(mismatches, {
          kind: "attribution_mismatch",
          nodeId: node.id,
          field: "taskId",
          source: "persisted DAG checkpoint",
          detail: `checkpoint taskId=${checkpointTaskId ?? "absent"} but snapshot taskId=${node.taskId ?? "absent"}`,
        });
      }
    }

    if (node.taskId === null) {
      addMismatch(mismatches, {
        kind: "missing_field",
        nodeId: node.id,
        field: "taskId",
        source: "DAG snapshot",
        detail: `field taskId absent in DAG snapshot node ${node.id}`,
        producer: "packages/omo-engine/senpi-task/src/dag/manager.ts:746-763 (projectSnapshot) and dag/scheduler.ts:459,475",
      });
    } else if (taskEntry === undefined) {
      addMismatch(mismatches, {
        kind: "missing_record",
        nodeId: node.id,
        field: "task_id",
        source: "manager records",
        detail: `field task_id ${node.taskId} absent in manager store (${checkpoint.file ? "tasks dir" : "tasks dir"})`,
        producer: "packages/omo-engine/senpi-task/src/store/record-store.ts",
      });
    } else {
      if (task.taskId !== node.taskId) {
        addMismatch(mismatches, {
          kind: "attribution_mismatch",
          nodeId: node.id,
          field: "task_id",
          source: "manager records",
          detail: `manager task_id=${task.taskId ?? "absent"} but DAG taskId=${node.taskId}`,
        });
      }
      if (task.parentSessionId !== snapshotView.parentSessionId) {
        addMismatch(mismatches, {
          kind: "parent_ref_mismatch",
          nodeId: node.id,
          field: "parent_session_id",
          source: "manager records",
          detail: `manager parent_session_id=${task.parentSessionId ?? "absent"} but run parent=${snapshotView.parentSessionId}`,
          producer: PRODUCER_EVIDENCE.detailsRows,
        });
      }
      if (task.rootSessionId !== snapshotView.rootSessionId) {
        addMismatch(mismatches, {
          kind: "parent_ref_mismatch",
          nodeId: node.id,
          field: "root_session_id",
          source: "manager records",
          detail: `manager root_session_id=${task.rootSessionId ?? "absent"} but run root=${snapshotView.rootSessionId}`,
        });
      }
      if (task.owner === null) {
        addMismatch(mismatches, {
          kind: "missing_field",
          nodeId: node.id,
          field: "owner",
          source: "manager records",
          detail: `field owner absent in manager record ${task.taskId}`,
          producer: "packages/omo-engine/senpi-task/src/manager/manager.ts:425",
        });
      } else {
        if (task.owner.runId !== snapshotView.runId) {
          addMismatch(mismatches, {
            kind: "attribution_mismatch",
            nodeId: node.id,
            field: "owner.runId",
            source: "manager records",
            detail: `manager owner.runId=${task.owner.runId ?? "absent"} but runId=${snapshotView.runId}`,
          });
        }
        if (task.owner.nodeId !== node.id) {
          addMismatch(mismatches, {
            kind: "attribution_mismatch",
            nodeId: node.id,
            field: "owner.nodeId",
            source: "manager records",
            detail: `manager owner.nodeId=${task.owner.nodeId ?? "absent"} but DAG node=${node.id}`,
          });
        }
      }
      const allowed = managerStatusesForDagState(node.state);
      if (allowed === null) {
        addMismatch(mismatches, {
          kind: "non_terminal_node",
          nodeId: node.id,
          field: "state",
          source: "DAG snapshot",
          detail: `node ${node.id} is ${node.state}; a terminal agreement check requires a terminal node`,
        });
      } else if (!allowed.includes(task.status)) {
        addMismatch(mismatches, {
          kind: "terminal_state_mismatch",
          nodeId: node.id,
          field: "status",
          source: "manager records",
          detail: `DAG state=${node.state} requires manager status in [${allowed.join(", ")}], observed ${task.status ?? "absent"}`,
        });
      }
    }

    if (panelNode === null) {
      addMismatch(mismatches, {
        kind: "missing_node",
        nodeId: node.id,
        field: "id",
        source: "panel payload",
        detail: `node ${node.id} is absent in the panel payload rows`,
        producer: PRODUCER_EVIDENCE.panelParser,
      });
    } else {
      if (panelNode.state !== node.state) {
        addMismatch(mismatches, {
          kind: "terminal_state_mismatch",
          nodeId: node.id,
          field: "state",
          source: "panel payload",
          detail: `panel state=${panelNode.state} but DAG state=${node.state}`,
          producer: PRODUCER_EVIDENCE.panelParser,
        });
      }
    }

    const rawNode =
      panelPayload !== null && panelPayload.dag !== undefined && Array.isArray(panelPayload.dag.runs)
        ? asRecord(panelPayload.dag.runs[0])?.nodes?.find((entry) => asRecord(entry)?.id === node.id)
        : undefined;
    const rawTaskId = asRecord(rawNode) === null ? null : asString(asRecord(rawNode).task_id);
    const panelAttributionPresent = rawTaskId !== null && rawTaskId === node.taskId;
    if (node.taskId !== null && !panelAttributionPresent) {
      addMismatch(mismatches, {
        kind: "missing_field",
        nodeId: node.id,
        field: "task_id",
        source: "panel payload",
        detail: `field task_id absent in panel payload node ${node.id}; the panel parser drops any node task id and the details rows never render one`,
        producer: PRODUCER_EVIDENCE.panelParser + "; " + PRODUCER_EVIDENCE.detailsRows,
      });
    }

    table.push({
      nodeId: node.id,
      managerTaskId: task?.taskId ?? null,
      managerStatus: task?.status ?? null,
      dagState: node.state,
      panelState: panelNode?.state ?? null,
      panelTaskAttribution: panelAttributionPresent ? rawTaskId : null,
      activityRowCount: activityRows.length,
      detailsRows: panelNode === null ? [] : detailsCardRows(panelNode),
      verdict:
        node.taskId !== null && !panelAttributionPresent
          ? "DISAGREE (attribution absent)"
          : "agree",
    });
  }

  const rawTaskRows =
    panelPayload !== null && asRecord(panelPayload.tasks) !== null && Array.isArray(asRecord(panelPayload.tasks).tasks)
      ? asRecord(panelPayload.tasks).tasks
      : [];
  const taskRowsWithNodeLink = rawTaskRows.filter((entry) => {
    const record = asRecord(entry);
    if (record === null) return false;
    return asString(record.node_id) !== null || asString(record.dag_node_id) !== null;
  });
  if (rawTaskRows.length > 0 && taskRowsWithNodeLink.length !== rawTaskRows.length) {
    addMismatch(mismatches, {
      kind: "missing_field",
      nodeId: null,
      field: "node_id/dag_node_id",
      source: "panel payload tasks list",
      detail: `field node_id absent in panel payload task rows (${rawTaskRows.length - taskRowsWithNodeLink.length} of ${rawTaskRows.length}); the panel parser keeps task_id but exposes no node mapping`,
      producer: PRODUCER_EVIDENCE.panelParser,
    });
  }

  if (!snapshotView.terminal) {
    addMismatch(mismatches, {
      kind: "non_terminal_run",
      nodeId: null,
      field: "status",
      source: "DAG snapshot",
      detail: `run status=${snapshotView.status} is not terminal; terminal state cannot agree`,
    });
  }

  if (hostProducer.model === null) {
    notes.push(
      "host chat producer buildDagRunModel returned null for this engine run: the OpenCode store holds no child sessions for these task ids, so the panel's primary chat-path source has no run and falls back to the service snapshot (dag-pane/DOCUMENTATION.md:50-56).",
    );
  } else {
    notes.push(
      "host chat producer buildDagRunModel returned a document; it was not used as the compared payload because the panel's service snapshot is the surface that carries engine runs.",
    );
  }

  return { mismatches, notes, table };
}

// ---------------------------------------------------------------------------
// Real panel service round-trip: POST /snapshot then GET /snapshot is the
// exact API the panel uses (service/handlers.js:1098-1161). The service
// preserves every field it is given; the forward probe below adds task
// attribution to prove the loss happens in the panel parser, not in the
// transport.
// ---------------------------------------------------------------------------
async function roundTripPanelPayload({ directory, conversationId, snapshotDoc, serviceRoot }) {
  const service = createDagServiceHandlers({
    snapshotDir: serviceRoot,
    createBridge: () => {
      throw new Error("the dag service bridge is not used by the snapshot round-trip");
    },
    codeGraphRuntime: {
      normalizeDirectory: async () => ({ error: "unused", status: 400 }),
      readIndex: async () => ({}),
      query: async () => ({}),
    },
  });
  const posted = await service.handleRequest({
    method: "POST",
    path: "/snapshot",
    body: { directory, conversationId, snapshot: snapshotDoc },
  });
  const received = await service.handleRequest({
    method: "GET",
    path: "/snapshot",
    query: { sessionId: conversationId, directory },
  });
  return { posted, received };
}

function attributionProbe(snapshotDoc, snapshotView) {
  const probe = JSON.parse(JSON.stringify(snapshotDoc));
  const run = Array.isArray(probe?.dag?.runs) ? probe.dag.runs[0] : null;
  const nodes = run !== null && Array.isArray(run.nodes) ? run.nodes : [];
  for (const node of nodes) {
    const sourceNode = snapshotView.nodes.find((entry) => entry.id === node.id);
    if (sourceNode?.taskId) node.task_id = sourceNode.taskId;
  }
  const tasksRecord = asRecord(probe.tasks);
  const tasks = tasksRecord !== null && Array.isArray(tasksRecord.tasks) ? tasksRecord.tasks : [];
  for (const task of tasks) {
    const sourceNode = snapshotView.nodes.find((entry) => entry.taskId === task.task_id);
    if (sourceNode) task.node_id = sourceNode.id;
  }
  return probe;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const fixture = createFixture();
const stateDir = path.join(fixture.root, "state");
mkdirSync(stateDir, { recursive: true });

const evidence = {
  generatedAt: new Date().toISOString(),
  script: "scripts/qa/delegation-agreement.mjs",
  live: true,
  model: null,
  fixture: {
    root: fixture.root,
    file: FIXTURE_FILE,
    path: fixture.fixturePath,
    content: fixture.content,
  },
  run: null,
  sources: {
    manager: null,
    dag: null,
    panelPayload: {
      producer: PRODUCER_EVIDENCE,
      replayDocument: null,
      receivedDocument: null,
      api: null,
      forwardProbe: null,
      parse: null,
    },
    panelRows: null,
    hostChatProducer: null,
  },
  nodes: [],
  mismatches: [],
  notes: [],
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
    rmSync(fixture.root, { recursive: true, force: true });
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

function printTable(table) {
  const columns = [
    ["node", (row) => row.nodeId],
    ["manager task", (row) => row.managerTaskId ?? "-"],
    ["mgr status", (row) => row.managerStatus ?? "-"],
    ["dag state", (row) => row.dagState ?? "-"],
    ["panel state", (row) => row.panelState ?? "-"],
    ["panel attr", (row) => row.panelTaskAttribution ?? "ABSENT"],
    ["activity rows", (row) => String(row.activityRowCount)],
  ];
  const widths = columns.map(([header, read]) => ({
    header,
    read,
    width: Math.max(header.length, ...table.map((row) => String(read(row)).length)),
  }));
  say(widths.map((entry) => entry.header.padEnd(entry.width)).join(" | "));
  say(widths.map((entry) => "-".repeat(entry.width)).join("-+-"));
  for (const row of table) {
    say(widths.map((entry) => String(entry.read(row)).padEnd(entry.width)).join(" | "));
  }
}

try {
  let boundary;
  try {
    boundary = await createLiveModelBoundary();
  } catch (error) {
    if (error instanceof LiveBlocked) {
      evidence.result = "blocked";
      evidence.blocked = { layer: error.layer, reason: bounded(redactSensitive(error.message), 600) };
      blockAndExit(error.layer, error.message);
    }
    const classified = classifyBlockedText(errorMessage(error));
    if (classified !== null) {
      evidence.result = "blocked";
      evidence.blocked = { layer: classified.layer, reason: bounded(redactSensitive(classified.message), 600) };
      blockAndExit(classified.layer, classified.message);
    }
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
  say(`[fixture] ${fixture.fixturePath}`);
  say(`[state] ${stateDir}`);

  const runtime = createDelegationRuntime({ workspaceDir: fixture.root, stateDir, boundary });
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
    if (classified !== null) {
      evidence.result = "blocked";
      evidence.blocked = { layer: classified.layer, reason: bounded(redactSensitive(classified.message), 600) };
      blockAndExit(classified.layer, classified.message);
    }
    throw error;
  }

  if (!result.ok) {
    evidence.run = { rejection: result.rejection };
    evidence.result = "plan_rejected";
    say(`RESULT: FAIL (plan rejected: ${result.rejection.code} ${oneLine(result.rejection.message)})`);
    finish(3);
  }

  const runId = result.runId;
  const record = runtime.dagManager.record(runId, PARENT_SESSION_ID);
  const snapshot = runtime.dagManager.snapshot(runId, PARENT_SESSION_ID);
  const snapshotView = snapshotProjection(snapshot);
  const checkpoint = readPersistedDagCheckpoint(stateDir, runId);
  const persistedTasks = readPersistedTaskRecords(stateDir);
  const taskEntries = persistedTasks.records.filter((entry) => {
    const parent = asString(entry.record.parent_session_id);
    const owner = asRecord(entry.record.owner);
    const ownerRun = owner === null ? null : asString(owner.runId);
    return parent === PARENT_SESSION_ID || ownerRun === runId;
  });
  const taskProjections = taskEntries.map(taskProjection);

  evidence.run = {
    runId,
    status: record.status,
    terminal: isTerminalDagRunStatus(record.status),
    unresolved: result.unresolved,
    deadlineExceeded: result.deadlineExceeded,
    deadlineCancellation: result.deadlineCancellation,
    outcomes: result.outcomes,
    parentSessionId: PARENT_SESSION_ID,
    rootSessionId: ROOT_SESSION_ID,
  };
  evidence.sources.manager = {
    dir: persistedTasks.dir,
    allFiles: persistedTasks.files,
    diagnostics: persistedTasks.diagnostics,
    childCount: taskProjections.length,
    records: taskProjections,
  };
  evidence.sources.dag = {
    checkpointPath: checkpoint.file,
    checkpointError: checkpoint.error,
    checkpointSeq: checkpoint.record === null ? null : checkpoint.record.checkpointSeq,
    snapshot: snapshotView,
  };

  const replayPayload = bridgePayloadFromSnapshot(snapshotView, taskProjections);
  const serviceRoot = path.join(fixture.root, "panel-service-snapshots");
  mkdirSync(serviceRoot, { recursive: true });
  const roundTrip = await roundTripPanelPayload({
    directory: fixture.root,
    conversationId: PARENT_SESSION_ID,
    snapshotDoc: replayPayload,
    serviceRoot,
  });
  const receivedPayload =
    roundTrip.received.status === 200 && asRecord(roundTrip.received.body) !== null
      ? roundTrip.received.body
      : replayPayload;
  const probeConversationId = `${PARENT_SESSION_ID}-probe`;
  const probeDoc = attributionProbe(replayPayload, snapshotView);
  probeDoc.sessionId = probeConversationId;
  const probeRoundTrip = await roundTripPanelPayload({
    directory: fixture.root,
    conversationId: probeConversationId,
    snapshotDoc: probeDoc,
    serviceRoot,
  });
  const probeReceived =
    probeRoundTrip.received.status === 200 && asRecord(probeRoundTrip.received.body) !== null
      ? probeRoundTrip.received.body
      : probeDoc;
  const probeOutcome = parseSnapshotDoc(probeReceived);
  const probeRawRun =
    asRecord(probeReceived.dag) !== null && Array.isArray(asRecord(probeReceived.dag).runs)
      ? asRecord(asRecord(probeReceived.dag).runs[0])
      : null;
  const probeRawNode =
    probeRawRun !== null && Array.isArray(probeRawRun.nodes) ? asRecord(probeRawRun.nodes[0]) : null;
  const probeRawTasks = asRecord(probeReceived.tasks);
  const probeRawTask =
    probeRawTasks !== null && Array.isArray(probeRawTasks.tasks) ? asRecord(probeRawTasks.tasks[0]) : null;
  const probeParsedNode =
    probeOutcome.ok && probeOutcome.view.runs.length > 0 ? probeOutcome.view.runs[0].nodes[0] : null;
  const probeParsedTask = probeOutcome.ok ? probeOutcome.view.tasks[0] ?? null : null;
  const forwardProbe = {
    purpose:
      "The wire producer is outside this repo. This probe adds task_id/node_id to the SAME real snapshot, sends it through the real dag-pane service, and shows the service preserves both while the panel parser drops both.",
    servicePostStatus: probeRoundTrip.posted.status,
    serviceGetStatus: probeRoundTrip.received.status,
    rawNodeCarriedTaskId: probeRawNode === null ? null : asString(probeRawNode.task_id),
    rawTaskCarriedNodeId: probeRawTask === null ? null : asString(probeRawTask.node_id),
    parsedNodeHasTaskId:
      probeParsedNode === null ? null : Object.prototype.hasOwnProperty.call(probeParsedNode, "taskId"),
    parsedTaskHasNodeId:
      probeParsedTask === null ? null : Object.prototype.hasOwnProperty.call(probeParsedTask, "nodeId"),
    parseFailed: probeOutcome.ok ? null : { code: probeOutcome.error.code, field: probeOutcome.error.field },
  };

  const panelOutcome = parseSnapshotDoc(receivedPayload);
  const activityTimeline = panelOutcome.ok
    ? buildActivityTimeline(panelOutcome.view, runId)
    : { rows: [], withoutTimestamps: 0, unavailable: [] };
  const hostProducer = {
    model: buildDagRunModel({
      conversationId: PARENT_SESSION_ID,
      conversationTitle: "delegation-agreement",
      sessions: [],
      statuses: {},
      messages: [],
      parts: {},
    }),
    doc: null,
    source: PRODUCER_EVIDENCE.hostChatProducer,
  };
  hostProducer.doc = hostProducer.model === null ? null : dagRunModelToSnapshotDoc(hostProducer.model);

  evidence.sources.panelPayload.replayDocument = replayPayload;
  evidence.sources.panelPayload.receivedDocument = receivedPayload;
  evidence.sources.panelPayload.api = {
    source: PRODUCER_EVIDENCE.panelService,
    directory: fixture.root,
    sessionId: PARENT_SESSION_ID,
    postStatus: roundTrip.posted.status,
    getStatus: roundTrip.received.status,
  };
  evidence.sources.panelPayload.forwardProbe = forwardProbe;
  evidence.sources.panelPayload.parse =
    panelOutcome.ok
      ? {
          ok: true,
          sessionId: panelOutcome.view.sessionId,
          runCount: panelOutcome.view.runs.length,
          nodes:
            panelOutcome.view.runs.length > 0
              ? panelOutcome.view.runs[0].nodes.map((node) => ({
                  id: node.id,
                  label: node.label,
                  state: node.state,
                  attempt: node.attempt,
                  dependsOn: node.dependsOn,
                  startedAt: node.startedAt,
                  completedAt: node.completedAt,
                }))
              : [],
          tasks: panelOutcome.view.tasks.map((task) => ({
            taskId: task.taskId,
            status: task.status,
            name: task.name,
          })),
        }
      : { ok: false, code: panelOutcome.error.code, field: panelOutcome.error.field };
  evidence.sources.panelRows = {
    source:
      "parseSnapshotDoc (panel/dag-view.ts) + buildActivityTimeline (panel/activity-view.ts); details-card rows copied from panel/main.ts:552-562 because the iframe cannot be driven headlessly here",
    activityRows: activityTimeline.rows.map((row) => ({
      id: row.id,
      nodeId: row.nodeId,
      nodeLabel: row.nodeLabel,
      kind: row.kind,
      state: row.state,
      at: row.at,
    })),
    withoutTimestamps: activityTimeline.withoutTimestamps,
    unavailable: activityTimeline.unavailable,
  };
  evidence.sources.hostChatProducer = {
    source: hostProducer.source,
    result: hostProducer.model === null ? null : "run-model-doc",
    conversationId: PARENT_SESSION_ID,
  };

  const comparison = compareSources({
    snapshotView,
    checkpoint,
    taskEntries,
    panelOutcome,
    panelPayload: receivedPayload,
    hostProducer,
    activityTimeline,
  });

  comparison.notes.push(
    "panel payload producer is outside this repo; the compared document is the real dag-pane service GET response for a field-for-field replay of the persisted DAG checkpoint. Node-set and terminal-state agreement are therefore conditional on that replay. The attribution finding is independent: the forward probe sends task_id/node_id through the same service, the service preserves both, and parseSnapshotDoc drops both.",
  );
  evidence.nodes = comparison.table;
  evidence.mismatches = comparison.mismatches;
  evidence.notes = comparison.notes;
  evidence.result = comparison.mismatches.length === 0 ? "agree" : "disagree";

  printTable(comparison.table);
  if (comparison.notes.length > 0) {
    for (const note of comparison.notes) say(`[note] ${note}`);
  }
  for (const mismatch of comparison.mismatches) {
    say(
      `[mismatch] node=${mismatch.nodeId ?? "-"} field=${mismatch.field} source=${mismatch.source} ` +
        `kind=${mismatch.kind}: ${mismatch.detail}` +
        (mismatch.producer === undefined ? "" : ` (producer: ${mismatch.producer})`),
    );
  }
  if (comparison.mismatches.length === 0) {
    say(`RESULT: AGREE (${comparison.table.length} nodes, manager + DAG + panel payload agree)`);
  } else {
    say(`RESULT: DISAGREE (${comparison.mismatches.length} mismatches)`);
  }
  finish(comparison.mismatches.length === 0 ? 0 : 1);
} catch (error) {
  const classified = classifyBlockedText(errorMessage(error));
  if (classified !== null) {
    evidence.result = "blocked";
    evidence.blocked = { layer: classified.layer, reason: bounded(redactSensitive(classified.message), 600) };
    blockAndExit(classified.layer, classified.message);
  }
  evidence.result = "failed";
  evidence.error = bounded(redactSensitive(errorMessage(error)), 900);
  say(`RESULT: FAIL (${evidence.error})`);
  finish(3);
}
