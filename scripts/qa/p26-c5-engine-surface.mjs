/**
 * C5 document-surface evidence only; not C3 evidence.
 *
 * Proves ONE thing and nothing more: an ENGINE-produced DAG snapshot document
 * (`tasks` is a record with a non-empty `tasks` array) reaches the shipped
 * dag-pane panel surface unchanged, and its identities are the engine's own.
 *
 * What is real here:
 *   - the engine run: `createTaskManager` + `createDagManager` +
 *     `createDagScheduler` + `createDagWaitSurface` +
 *     `runEngineeringDelegation` from `packages/omo-engine/senpi-task/src`;
 *   - the engine persistence: the DAG checkpoint the engine wrote under
 *     `<stateDir>/dag/runs/<runId>.json` and the child records it wrote under
 *     `<stateDir>/tasks/<taskId>.json`;
 *   - the snapshot writer: `createSnapshotWriter`
 *     (`packages/web/server/lib/opencode/omo-bridge-runtime.js:747-848`), fed
 *     the engine's own `omo.dag.updated` / `omo.task.updated` payloads, which
 *     writes `{ schemaVersion, sessionId, updatedAt, dag, tasks }`;
 *   - the surface: the COMMITTED service bundle
 *     `packages/extensions/dag-pane/service/main.js` started as its real
 *     loopback HTTP process, read through the panel's real route
 *     `GET /snapshot?sessionId=<parent>&directory=<workspace>`;
 *   - the panel parser: `parseSnapshotDoc` from
 *     `packages/extensions/dag-pane/panel/dag-view.ts`.
 *
 * The child agents are deterministic stand-ins at the manager's runner seam so
 * this capture is rerunnable with no live model. That is a statement about the
 * READER/WRITER surface only: the engine still creates the run, generates the
 * task ids, spawns the children, writes the records, and writes the snapshot.
 * This is NOT live-model evidence and NOT C3 evidence.
 *
 * The wire producer (`dag-snapshot-payload.ts` / `task-rpc-bridge.ts`) lives
 * outside this repository. The payloads below are a documented mechanical
 * FIELD COPY from the persisted engine records - every id is taken verbatim
 * from a record the engine wrote; nothing is keyed by a name, title, timestamp,
 * or array position. The script re-reads the records from disk and asserts
 * every id in the served document is traceable back to them.
 *
 * Assertions:
 *   - `tasks !== null`, `tasks.tasks.length > 0` (an engine document, not the
 *     synthetic `tasks: null` steer fallback and not a chat document);
 *   - `run_key` equals the engine checkpoint's `runKey`
 *     (`delegation-<sha256>`), never `steer:`;
 *   - parent and child identities in the served document equal the engine's
 *     persisted records (`sessionId`, `run_id`, node ids, `task_id`,
 *     `node_id`, `parent_session_id`);
 *   - the raw writer document and the first served body are equal; after a
 *     service stop/start cycle the second served body is equal to the first.
 *
 * Negative controls executed by the script itself:
 *   - a synthetic `steer:` document served with HTTP 200 is classified as NOT
 *     an engine document (misleading-success guard);
 *   - any id that is not present in an engine record is a failure.
 *
 * Deliberately out of scope (recorded, never claimed):
 *   `alcode_run_graph_surface: "NOT_PROVEN"` - the `.omo/dag-runs/` project
 *   file served by `GET /api/run-graph/snapshot` is a different surface and
 *   this script does not exercise it.
 *
 * Usage:
 *   bun scripts/qa/p26-c5-engine-surface.mjs
 *   node scripts/qa/p26-c5-engine-surface.mjs   (re-execs under bun)
 *
 * Exit codes:
 *   0  PASS - engine document served, identities traceable, restart equal
 *   1  FAIL - one or more assertions failed (every failure named on stdout)
 *   2  setup failure before assertions could run
 *
 * Evidence:
 *   .omo/ulw/p26/task-7-c5-engine-surface.json
 *   .omo/ulw/p26/p26-c5-engine-document.json          (raw writer document)
 *   .omo/ulw/p26/p26-c5-engine-records/...            (engine record copies)
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(ROOT, "packages", "omo-engine", "senpi-task", "src");
const OMO_CONFIG = path.join(ROOT, "packages", "omo-engine", "omo-config-core", "src", "index.ts");
const BRIDGE_RUNTIME = path.join(ROOT, "packages", "web", "server", "lib", "opencode", "omo-bridge-runtime.js");
const PANEL_VIEW = path.join(ROOT, "packages", "extensions", "dag-pane", "panel", "dag-view.ts");
const PANEL_SERVICE = path.join(ROOT, "packages", "extensions", "dag-pane", "service", "main.js");
const PACKAGED_SERVICE = path.join(ROOT, "packages", "web", "server", "built-in-extensions", "dag-pane", "service", "main.js");
const EVIDENCE_DIR = path.join(ROOT, ".omo", "ulw", "p26");
const ARTIFACT_PATH = path.join(EVIDENCE_DIR, "task-7-c5-engine-surface.json");
const RAW_DOCUMENT_PATH = path.join(EVIDENCE_DIR, "p26-c5-engine-document.json");
const RECORD_COPY_DIR = path.join(EVIDENCE_DIR, "p26-c5-engine-records");

const PARENT_SESSION_ID = "p26-c5-engine-surface";
const WORKSPACE_FIXTURE = "c5-fixture.txt";
const SERVICE_READY_TIMEOUT_MS = 20_000;
const SERVICE_STOP_TIMEOUT_MS = 10_000;
const PORT_FREE_TIMEOUT_MS = 10_000;
const RUN_DEADLINE_MS = 60_000;

const TASK_ID_PATTERN = /^st_[0-9a-f]{8}$/;
const RUN_KEY_PATTERN = /^delegation-[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Dual-runtime entry: the real chain is imported from TypeScript sources, which
// needs Bun. Plain `node` re-execs under bun and passes the exit code through.
// ---------------------------------------------------------------------------
const isBun = Object.prototype.toString.call(process.versions.bun) === "[object String]";
if (!isBun && !process.argv.includes("--no-reexec") && !process.env.P26_C5_VIA_BUN) {
  const candidates = process.platform === "win32" ? ["bun", "bun.exe"] : ["bun"];
  let ran = false;
  for (const candidate of candidates) {
    let result;
    try {
      result = spawnSync(candidate, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
        stdio: "inherit",
        env: { ...process.env, P26_C5_VIA_BUN: "1" },
      });
    } catch {
      continue;
    }
    if (result.error && result.error.code === "ENOENT") continue;
    ran = true;
    process.exit(result.status ?? 1);
  }
  if (!ran) {
    console.log("RESULT: FAIL (bun runtime not found; p26-c5-engine-surface imports the real TS engine)");
    process.exit(2);
  }
}

const { parseSnapshotDoc } = await import(pathToFileURL(PANEL_VIEW).href);
const { createSnapshotWriter, OMO_BRIDGE_EVENT_DAG_UPDATED, OMO_BRIDGE_EVENT_TASK_UPDATED } =
  await import(pathToFileURL(BRIDGE_RUNTIME).href);
const { createTaskRecordStore } = await import(pathToFileURL(path.join(SRC, "store", "index.ts")).href);
const { createTaskManager } = await import(pathToFileURL(path.join(SRC, "manager", "manager.ts")).href);
const { createDagManager } = await import(pathToFileURL(path.join(SRC, "dag", "manager.ts")).href);
const { createDagScheduler } = await import(pathToFileURL(path.join(SRC, "dag", "scheduler.ts")).href);
const { createDagFileStore } = await import(pathToFileURL(path.join(SRC, "dag", "store.ts")).href);
const { createDagWaitSurface } = await import(pathToFileURL(path.join(SRC, "dag", "handle.ts")).href);
const { runEngineeringDelegation } = await import(pathToFileURL(path.join(SRC, "delegation", "run.ts")).href);
const { OmoTaskSettingsSchema } = await import(pathToFileURL(OMO_CONFIG).href);

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------
const output = [];
function say(line) {
  output.push(line);
  console.log(line);
}
function flushOutput() {
  for (const line of output) console.log(line);
  output.length = 0;
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function bounded(text, max = 400) {
  const flat = oneLine(text);
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function errorMessage(error) {
  return bounded(error instanceof Error ? error.message : String(error ?? "unknown error"), 600);
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fileBytes(filePath) {
  return readFileSync(filePath).byteLength;
}

function readJsonRecord(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${filePath} is not a JSON record`);
  }
  return parsed;
}

function isRecord(value) {
  return Object(value) === value && !Array.isArray(value);
}

// String-valued read without a typeof test: only a real string primitive
// stringifies to itself, so every other JSON value reads as absent.
function asString(value) {
  return String(value) === value ? value : null;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return canonical(left) === canonical(right);
}

const assertions = [];
const failures = [];

function check(id, ok, detail) {
  const passed = ok === true;
  assertions.push({ id, ok: passed, detail: bounded(detail, 600) });
  if (!passed) failures.push(id);
  return passed;
}

// ---------------------------------------------------------------------------
// Port helpers. Readiness and release are observed, never assumed: the service
// announces itself on stdout, and a listener proves the port is free.
// ---------------------------------------------------------------------------
async function requestFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Engine run: real manager, real DAG manager/scheduler, deterministic children.
// ---------------------------------------------------------------------------
function createDeterministicRunner() {
  return {
    start(spec) {
      const outputText = `scripted-child ${spec.taskId} ${spec.agentType ?? spec.category ?? "default"}`;
      return Promise.resolve({
        task_id: spec.taskId,
        kind: "in-process",
        sessionId: `child-${spec.taskId}`,
        pid: undefined,
        steer: async () => undefined,
        followUp: async () => undefined,
        abort: async () => undefined,
        subscribe: () => () => undefined,
        waitForOutcome: async () => ({ status: "completed", finalResponse: outputText }),
        lastAssistantText: () => outputText,
        dispose: async () => undefined,
      });
    },
  };
}

function deterministicPlanner(spec) {
  const target = spec.category ?? spec.subagent_type ?? "default";
  const plan = { model: `scripted/${target}` };
  if (spec.category !== undefined) plan.category = spec.category;
  if (spec.subagent_type !== undefined) plan.agentType = spec.subagent_type;
  return { kind: "resolved", plan };
}

async function runEngineDelegation({ workspaceDir, stateDir, authorityRoot }) {
  const store = createTaskRecordStore({ project_dir: workspaceDir, task: { state_dir: stateDir } });
  const dagStore = createDagFileStore({ project_dir: workspaceDir, task: { state_dir: stateDir } });
  const runner = createDeterministicRunner();
  const taskManager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: deterministicPlanner,
    config: OmoTaskSettingsSchema.parse({
      default_concurrency: 4,
      max_depth: 2,
      default_execution_mode: "in-process",
    }),
    cwd: workspaceDir,
    verificationAuthorityRoot: authorityRoot,
  });
  const dagManager = createDagManager({ store: dagStore });
  const schedulers = new Map();
  const startedRuns = new Map();
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
      startedRuns.set(runId, scheduler.run());
    }
    const waitPromise = waitSurface.wait(runId, PARENT_SESSION_ID).then((result) => ({ kind: "result", result }));
    const settled = Number.isFinite(deadlineMs)
      ? await Promise.race([
          waitPromise,
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve({ kind: "deadline" }), Math.max(1, deadlineMs));
            timer.unref?.();
          }),
        ])
      : await waitPromise;
    if (settled.kind === "result") {
      await startedRuns.get(runId);
      return settled.result;
    }
    return {
      runId,
      status: dagManager.record(runId, PARENT_SESSION_ID).status,
      snapshot: dagManager.attach(runId, PARENT_SESSION_ID).snapshot(),
      nodes: {},
    };
  };

  const result = await runEngineeringDelegation(
    { dagManager, wait },
    {
      objective: "C5 capture: produce an engine run whose snapshot document carries real task attribution.",
      workingDirectory: workspaceDir,
      roles: [
        { key: "investigate", assignment: `Read ${WORKSPACE_FIXTURE} and report its checksum-hint value.` },
        { key: "review", assignment: `Independently confirm the checksum-hint claim from ${WORKSPACE_FIXTURE}.` },
      ],
      parentSessionId: PARENT_SESSION_ID,
      rootSessionId: PARENT_SESSION_ID,
      deadlineMs: RUN_DEADLINE_MS,
    },
  );

  return { result, dagManager };
}

// ---------------------------------------------------------------------------
// Persisted engine records. Everything is re-read from disk, never from the
// in-memory objects the run already holds.
// ---------------------------------------------------------------------------
function readPersistedEngineRecords({ stateDir, runId }) {
  const checkpointPath = path.join(stateDir, "dag", "runs", `${runId}.json`);
  const checkpoint = readJsonRecord(checkpointPath);
  const tasksDir = path.join(stateDir, "tasks");
  const taskFiles = readdirSync(tasksDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(tasksDir, name));
  const records = taskFiles.map((file) => ({ file, record: readJsonRecord(file) }));
  const children = records.filter(({ record }) => {
    const sameParent = record.parent_session_id === PARENT_SESSION_ID;
    const ownerRun = isRecord(record.owner) ? record.owner.runId : undefined;
    return sameParent || ownerRun === runId;
  });
  return { checkpointPath, checkpoint, taskFiles, records, children };
}

// ---------------------------------------------------------------------------
// Wire projection: a mechanical FIELD COPY from the persisted records. Each
// generated id is copied from exactly one record field; the provenance map
// records which field, so the assertion below can prove none was invented.
// ---------------------------------------------------------------------------
function projectDagPayload(checkpoint) {
  const nodes = checkpoint.nodes.map((node) => {
    const projected = {
      id: node.id,
      label: node.label ?? node.id,
      prompt: node.prompt ?? "",
      depends_on: [...(node.dependsOn ?? [])],
      state: node.state,
      attempt: node.attempt ?? 0,
      created_at: node.createdAt,
    };
    if (node.startedAt !== undefined) projected.started_at = node.startedAt;
    if (node.completedAt !== undefined) projected.completed_at = node.completedAt;
    if (node.taskId !== undefined) projected.task_id = node.taskId;
    return projected;
  });
  const counts = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const node of checkpoint.nodes) {
    if (Object.prototype.hasOwnProperty.call(counts, node.state)) counts[node.state] += 1;
  }
  return {
    parent_session_id: checkpoint.parentSessionId,
    runs: [{
      run_id: checkpoint.runId,
      run_key: checkpoint.runKey,
      name: checkpoint.name,
      status: checkpoint.status,
      created_at: checkpoint.createdAt,
      updated_at: checkpoint.updatedAt,
      counts,
      nodes,
      edges: (checkpoint.edges ?? []).map((edge) => ({ from: edge.from, to: edge.to })),
      waves: (checkpoint.waves ?? []).map((wave) => ({ index: wave.index, node_ids: [...wave.nodeIds] })),
    }],
  };
}

function projectTaskEntry(record) {
  const entry = {
    task_id: record.task_id,
    status: record.status,
    name: record.name ?? record.task_id,
    parent_session_id: record.parent_session_id,
  };
  if (record.task_summary !== undefined) entry.task_summary = record.task_summary;
  if (record.description !== undefined) entry.description = record.description;
  if (record.agent_type !== undefined) entry.agent_type = record.agent_type;
  if (record.category !== undefined) entry.category = record.category;
  if (record.model !== undefined) entry.model = record.model;
  if (isRecord(record.owner) && record.owner.kind === "dag") entry.node_id = record.owner.nodeId;
  return entry;
}

function projectTaskPayload(children) {
  return {
    parent_session_id: PARENT_SESSION_ID,
    tasks: children.map(({ record }) => projectTaskEntry(record)),
  };
}

// ---------------------------------------------------------------------------
// Service lifecycle: the committed bundle, started as its real loopback server.
// ---------------------------------------------------------------------------
function startService({ port, token, tempRoot }) {
  const child = spawn(process.execPath, [PANEL_SERVICE], {
    cwd: path.dirname(PANEL_SERVICE),
    env: {
      ...process.env,
      ALCODE_SERVICE_PORT: String(port),
      ALCODE_SERVICE_TOKEN: token,
      TEMP: tempRoot,
      TMP: tempRoot,
      TMPDIR: tempRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const record = {
    pid: child.pid ?? null,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    stopped: false,
    exitCode: null,
    signal: null,
  };
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`service did not become ready: stdout=${bounded(stdout, 300)} stderr=${bounded(stderr, 300)}`));
    }, SERVICE_READY_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on("data", () => {
      if (stdout.includes("service ready on 127.0.0.1")) {
        clearTimeout(timer);
        resolve(undefined);
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`service exited before ready: code=${code} signal=${signal} stderr=${bounded(stderr, 300)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      record.stopped = true;
      record.exitCode = Number.isInteger(code) ? code : null;
      record.signal = signal ?? null;
      record.stoppedAt = new Date().toISOString();
      resolve(record);
    });
  });
  return { child, record, ready, exited, stdout: () => stdout, stderr: () => stderr };
}

async function stopService(service) {
  if (service === null) return null;
  if (service.record.stopped === true) return service.record;
  service.child.kill();
  const timer = setTimeout(() => {
    // Last resort: a Windows tree kill. Still observed through the exit event.
    service.child.kill("SIGKILL");
  }, SERVICE_STOP_TIMEOUT_MS);
  timer.unref?.();
  await service.exited;
  clearTimeout(timer);
  return service.record;
}

async function getSnapshot({ port, token, sessionId, directory }) {
  const url = new URL(`http://127.0.0.1:${port}/snapshot`);
  url.searchParams.set("sessionId", sessionId);
  if (directory !== undefined) url.searchParams.set("directory", directory);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, text, body, sha256: sha256Text(text), bytes: Buffer.byteLength(text, "utf8") };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
const evidence = {
  unit: "p26 todo 7 - C5 capture through the dag-pane panel surface",
  c5_scope: "C5 document-surface evidence only; not C3 evidence.",
  generatedAt: new Date().toISOString(),
  command: "bun scripts/qa/p26-c5-engine-surface.mjs",
  surface: "dag-pane panel",
  route: "GET /snapshot",
  alcode_run_graph_surface: "NOT_PROVEN",
  alcode_run_graph_reason:
    "The Alcode run-graph route (/api/run-graph/snapshot over <directory>/.omo/dag-runs/<conversationId>.snapshot.json) is a different surface and is out of scope for this capture (scope ledger).",
  verdict: "FAIL",
  errors: [],
  assertions,
};

let tempRoot = null;
let service = null;
let serviceRestart = null;
let port = null;
const stoppedProcessRecords = [];
const token = `c5_${createHash("sha256").update(`${Date.now()}_${process.pid}`).digest("hex").slice(0, 24)}`;

function writeArtifact() {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  evidence.assertions = assertions;
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function cleanupAndExit(code) {
  const cleanup = {
    temp_dir: tempRoot,
    temp_dir_present: tempRoot === null ? null : false,
    temp_dir_removed: false,
    port,
    port_free: null,
    processes: [],
    receipt: "",
  };
  try {
    cleanup.processes.push(...stoppedProcessRecords);
    if (service !== null) {
      const stopped = await stopService(service);
      if (stopped !== null) cleanup.processes.push(stopped);
      service = null;
    }
    if (serviceRestart !== null) {
      const stopped = await stopService(serviceRestart);
      if (stopped !== null) cleanup.processes.push(stopped);
      serviceRestart = null;
    }
  } catch (error) {
    cleanup.stop_error = errorMessage(error);
    check("cleanup.service_stopped", false, `service stop failed: ${errorMessage(error)}`);
  }
  if (tempRoot !== null) {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      cleanup.remove_error = errorMessage(error);
    }
    cleanup.temp_dir_present = existsSync(tempRoot);
    cleanup.temp_dir_removed = cleanup.temp_dir_present === false;
    check("cleanup.temp_dir_removed", cleanup.temp_dir_removed, `TEMP_DIR_PRESENT=${cleanup.temp_dir_present}`);
  }
  if (port !== null) {
    cleanup.port_free = await waitForPortFree(port, PORT_FREE_TIMEOUT_MS);
    check("cleanup.port_free", cleanup.port_free, `port ${port} free=${cleanup.port_free}`);
  }
  const processStates = cleanup.processes
    .map((entry) => `${entry.pid}:exit=${entry.exitCode}:signal=${entry.signal}`)
    .join(",");
  cleanup.receipt = [
    `TEMP_DIR_PRESENT=${cleanup.temp_dir_present === null ? "n/a" : cleanup.temp_dir_present === false ? "false" : "true"}`,
    `processes_gone=${cleanup.processes.every((entry) => entry.stopped === true)}`,
    `processes=[${processStates}]`,
    `port=${cleanup.port ?? "none"}`,
    `port_free=${cleanup.port_free === null ? "n/a" : cleanup.port_free === true ? "true" : "false"}`,
  ].join("; ");
  evidence.cleanup = cleanup;
  if (failures.length > 0) evidence.verdict = "FAIL";
  writeArtifact();
  say(`CLEANUP: ${cleanup.receipt}`);
  const finalCode = failures.length === 0 ? code : (code === 0 ? 1 : code);
  say(`RESULT: ${finalCode === 0 ? "PASS" : "FAIL"}`);
  process.exit(finalCode);
}

try {
  tempRoot = mkdtempSync(path.join(tmpdir(), "p26-c5-"));
  const workspaceDir = path.join(tempRoot, "workspace");
  const stateDir = path.join(tempRoot, "state");
  const authorityRoot = path.join(tempRoot, "authority");
  const snapshotDir = path.join(tempRoot, "omo-dag-snapshots");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(authorityRoot, { recursive: true });
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(
    path.join(workspaceDir, WORKSPACE_FIXTURE),
    "checksum-hint: 7F3A\n",
    "utf8",
  );
  evidence.workspace_fixture = path.join(workspaceDir, WORKSPACE_FIXTURE);
  say(`[temp] ${tempRoot}`);

  // 1. Real engine run -> real persisted checkpoint + task records.
  const { result } = await runEngineDelegation({ workspaceDir, stateDir, authorityRoot });
  if (result.ok !== true) {
    evidence.errors.push(`engine run did not complete: ${bounded(JSON.stringify(result), 800)}`);
    throw new Error("engine run did not complete");
  }
  const runId = result.runId;
  say(`[engine] run=${runId} outcomes=${result.outcomes.map((outcome) => `${outcome.nodeId}:${outcome.outcome}`).join(",")}`);

  const records = readPersistedEngineRecords({ stateDir, runId });
  const { checkpoint, checkpointPath, children } = records;
  if (children.length === 0) {
    evidence.errors.push("engine wrote no child task records for the run");
    throw new Error("engine wrote no child task records");
  }
  evidence.engine_run = {
    engine: "packages/omo-engine/senpi-task/src (createTaskManager + createDagManager + createDagScheduler + runEngineeringDelegation)",
    persistence: "DagFileStore checkpoint + TaskRecordStore records",
    runner: "deterministic in-process runner at the manager runner seam (rerunnable; no live-model claim, no C3 claim)",
    run_id: runId,
    run_key: checkpoint.runKey,
    parent_session_id: checkpoint.parentSessionId,
    root_session_id: checkpoint.rootSessionId,
    status: checkpoint.status,
    node_count: Array.isArray(checkpoint.nodes) ? checkpoint.nodes.length : null,
    child_task_ids: children.map(({ record }) => record.task_id),
    outcomes: result.outcomes,
  };

  // 2. Engine's real snapshot writer -> the raw document.
  const rawDocumentPath = path.join(snapshotDir, `${PARENT_SESSION_ID}.snapshot.json`);
  const writer = createSnapshotWriter({
    sessionId: PARENT_SESSION_ID,
    snapshotPath: rawDocumentPath,
    fs: { writeFileSync, renameSync },
  });
  const dagProjection = projectDagPayload(checkpoint);
  const taskProjection = projectTaskPayload(children);
  const dagWrite = writer.handleEvent(OMO_BRIDGE_EVENT_DAG_UPDATED, dagProjection);
  const taskWrite = writer.handleEvent(OMO_BRIDGE_EVENT_TASK_UPDATED, taskProjection);
  const rawText = readFileSync(rawDocumentPath, "utf8");
  const rawDocument = JSON.parse(rawText);
  const rawRun = isRecord(rawDocument.dag) && Array.isArray(rawDocument.dag.runs) ? rawDocument.dag.runs[0] : null;
  const rawTasks = isRecord(rawDocument.tasks) ? rawDocument.tasks : null;

  evidence.document = {
    producer: "packages/web/server/lib/opencode/omo-bridge-runtime.js createSnapshotWriter (engine snapshot writer)",
    producer_events: [OMO_BRIDGE_EVENT_DAG_UPDATED, OMO_BRIDGE_EVENT_TASK_UPDATED],
    writer_outcomes: { dag: dagWrite, tasks: taskWrite },
    writer_stats: writer.stats,
    path: rawDocumentPath,
    artifact_copy: path.relative(ROOT, RAW_DOCUMENT_PATH).replaceAll("\\", "/"),
    sha256: sha256Text(rawText),
    bytes: Buffer.byteLength(rawText, "utf8"),
    tasks_non_null: rawDocument.tasks !== null && rawDocument.tasks !== undefined,
    tasks_count: rawTasks !== null && Array.isArray(rawTasks.tasks) ? rawTasks.tasks.length : 0,
    run_key: rawRun === null ? null : rawRun.run_key,
    provenance: {
      checkpoint_path: checkpointPath,
      checkpoint_sha256: sha256File(checkpointPath),
      task_record_files: records.taskFiles,
      task_record_sha256: Object.fromEntries(records.taskFiles.map((file) => [path.basename(file), sha256File(file)])),
      projection:
        "Mechanical field copy from the persisted DAG checkpoint and TaskRecord files; every id in the wire payload is copied from a named record field (see id_provenance).",
    },
  };

  // Persist copies before the temp tree is removed, so a verifier can re-check
  // every identity after cleanup.
  writeFileSync(RAW_DOCUMENT_PATH, rawText, "utf8");
  rmSync(RECORD_COPY_DIR, { recursive: true, force: true });
  mkdirSync(path.join(RECORD_COPY_DIR, "tasks"), { recursive: true });
  writeFileSync(path.join(RECORD_COPY_DIR, "checkpoint.json"), readFileSync(checkpointPath), { flag: "w" });
  for (const { file, record } of children) {
    writeFileSync(path.join(RECORD_COPY_DIR, "tasks", `${record.task_id}.json`), readFileSync(file), { flag: "w" });
  }
  evidence.document.provenance.record_copy_dir = path.relative(ROOT, RECORD_COPY_DIR).replaceAll("\\", "/");

  // 3. Serve through the committed bundle's real HTTP entry.
  port = await requestFreePort();
  service = startService({ port, token, tempRoot });
  await service.ready;
  const servedFirst = await getSnapshot({ port, token, sessionId: PARENT_SESSION_ID, directory: workspaceDir });
  say(`[service] pid=${service.record.pid} GET /snapshot -> ${servedFirst.status} (${servedFirst.bytes} bytes)`);
  service.record.endpoint = `http://127.0.0.1:${port}/snapshot?sessionId=${PARENT_SESSION_ID}&directory=${workspaceDir}`;
  evidence.service = {
    exercise: "committed service bundle started as its real loopback HTTP process",
    committed_bundle: {
      path: path.relative(ROOT, PANEL_SERVICE).replaceAll("\\", "/"),
      bytes: fileBytes(PANEL_SERVICE),
      sha256: sha256File(PANEL_SERVICE),
      exercised: true,
    },
    packaged_app_entry: {
      path: path.relative(ROOT, PACKAGED_SERVICE).replaceAll("\\", "/"),
      bytes: existsSync(PACKAGED_SERVICE) ? fileBytes(PACKAGED_SERVICE) : null,
      sha256: existsSync(PACKAGED_SERVICE) ? sha256File(PACKAGED_SERVICE) : null,
      exercised: false,
      loaded_by: "packages/web/server/lib/guests/builtins.js (DEFAULT_BUILTIN_ROOT) + packages/extensions/registry.json build entry service/main.js",
      identical_to_exercised: existsSync(PACKAGED_SERVICE)
        ? sha256File(PACKAGED_SERVICE) === sha256File(PANEL_SERVICE)
        : null,
      note: existsSync(PACKAGED_SERVICE)
        ? "The packaged app loads this staged copy. This script exercises the committed bundle named above; the staged copy is recorded, not exercised as evidence."
        : "Staged copy absent in this worktree; the packaged app would load it after `bun run extensions:build`.",
    },
    source: "packages/extensions/dag-pane/service/server.js -> handlers.js (committed bundle inlines handlers.js)",
    shell: "packages/extensions/dag-pane/service/main.js",
    route: "GET /snapshot",
    process: null,
  };

  // 4. Assertions over the served document.
  const servedBody = servedFirst.body;
  const servedRun = isRecord(servedBody?.dag) && Array.isArray(servedBody.dag.runs) ? servedBody.dag.runs[0] : null;
  const servedTasksRecord = isRecord(servedBody?.tasks) ? servedBody.tasks : null;
  const servedTasks = servedTasksRecord !== null && Array.isArray(servedTasksRecord.tasks) ? servedTasksRecord.tasks : null;
  const checkpointNodes = Array.isArray(checkpoint.nodes) ? checkpoint.nodes : [];
  const checkpointNodeById = new Map(checkpointNodes.map((node) => [node.id, node]));
  const recordByTaskId = new Map(children.map(({ record }) => [record.task_id, record]));

  const judgeEngineDocument = (status, body) => {
    const run = isRecord(body?.dag) && Array.isArray(body.dag.runs) ? body.dag.runs[0] : null;
    const tasksRecord = isRecord(body?.tasks) ? body.tasks : null;
    const tasks = tasksRecord !== null && Array.isArray(tasksRecord.tasks) ? tasksRecord.tasks : null;
    return status === 200
      && tasks !== null
      && tasks.length > 0
      && run !== null
      && asString(run.run_key) !== null
      && !run.run_key.startsWith("steer:")
      && run.run_key === checkpoint.runKey;
  };

  const servedIsEngineDocument = judgeEngineDocument(servedFirst.status, servedBody);

  check("surface.route", evidence.surface === "dag-pane panel" && evidence.route === "GET /snapshot", "dag-pane panel GET /snapshot");
  check("service.status", servedFirst.status === 200, `GET /snapshot status=${servedFirst.status}`);
  check("engine_doc_judged", servedIsEngineDocument, "served body is the engine document (tasks record with a non-empty tasks array, engine run_key)");
  check("document.equals_raw", sameJson(servedBody, rawDocument), "served body equals the document written by the engine snapshot writer");
  check("tasks_non_null", servedTasks !== null, "served tasks is not null");
  check("tasks_non_empty", (servedTasks?.length ?? 0) > 0, `served tasks length=${servedTasks?.length ?? "null"}`);
  check("run_key.engine_derived", servedRun !== null && servedRun.run_key === checkpoint.runKey, `served run_key=${servedRun?.run_key ?? "null"} checkpoint=${checkpoint.runKey}`);
  check("run_key.not_steer", servedRun !== null && !String(servedRun.run_key).startsWith("steer:"), "run_key is not the synthetic steer marker");
  check("run_key.format", servedRun !== null && RUN_KEY_PATTERN.test(String(servedRun.run_key)), "run_key is the engine definition key (delegation-<sha256>)");
  check("parent.session_id", servedBody?.sessionId === PARENT_SESSION_ID && servedBody?.sessionId === checkpoint.parentSessionId, `sessionId=${servedBody?.sessionId}`);
  check("parent.run_id", servedRun !== null && servedRun.run_id === checkpoint.runId, "run_id equals the engine checkpoint runId");
  check("parent.run_status", servedRun !== null && servedRun.status === checkpoint.status, "run status equals the engine checkpoint status");

  const servedNodeIds = servedRun !== null && Array.isArray(servedRun.nodes) ? servedRun.nodes.map((node) => node.id) : [];
  const checkpointNodeIds = checkpointNodes.map((node) => node.id);
  check(
    "dag.node_ids_equal_checkpoint",
    sameJson([...servedNodeIds].sort(), [...checkpointNodeIds].sort()),
    `served=${servedNodeIds.join(",")} checkpoint=${checkpointNodeIds.join(",")}`,
  );

  const nodeIdentityChecks = [];
  for (const node of servedRun !== null && Array.isArray(servedRun.nodes) ? servedRun.nodes : []) {
    const checkpointNode = checkpointNodeById.get(node.id);
    const checkpointTaskId = checkpointNode?.taskId;
    const record = checkpointTaskId === undefined ? undefined : recordByTaskId.get(checkpointTaskId);
    const ok = checkpointNode !== undefined
      && node.state === checkpointNode.state
      && (checkpointTaskId === undefined || node.task_id === checkpointTaskId)
      && (checkpointTaskId === undefined || record !== undefined)
      && (record === undefined || (isRecord(record.owner) && record.owner.nodeId === node.id));
    nodeIdentityChecks.push({
      node_id: node.id,
      checkpoint_state: checkpointNode?.state ?? null,
      served_state: node.state,
      checkpoint_task_id: checkpointTaskId ?? null,
      served_task_id: node.task_id ?? null,
      task_record_found: record !== undefined,
      ok,
    });
    if (!ok) check(`identity.node.${node.id}`, false, "node identity does not match the engine checkpoint/record");
  }
  check("identity.nodes_traceable", nodeIdentityChecks.length === checkpointNodes.length && nodeIdentityChecks.every((entry) => entry.ok), `${nodeIdentityChecks.length}/${checkpointNodes.length} nodes traceable`);

  const taskIdentityChecks = [];
  for (const entry of servedTasks ?? []) {
    if (!isRecord(entry)) {
      taskIdentityChecks.push({ task_id: null, ok: false, reason: "not a record" });
      continue;
    }
    const record = recordByTaskId.get(entry.task_id);
    const ownerNodeId = isRecord(record?.owner) ? record.owner.nodeId : null;
    const ok = record !== undefined
      && entry.status === record.status
      && entry.node_id === ownerNodeId
      && record.parent_session_id === PARENT_SESSION_ID
      && isRecord(record.owner)
      && record.owner.runId === runId
      && TASK_ID_PATTERN.test(entry.task_id)
      && checkpointNodeById.has(entry.node_id);
    taskIdentityChecks.push({
      task_id: entry.task_id,
      status: entry.status,
      node_id: entry.node_id ?? null,
      parent_session_id: record?.parent_session_id ?? null,
      owner_run_id: isRecord(record?.owner) ? record.owner.runId : null,
      task_id_format_ok: TASK_ID_PATTERN.test(String(entry.task_id)),
      ok,
    });
    if (!ok) check(`identity.task.${entry.task_id}`, false, "task identity does not match the engine record");
  }
  check(
    "identity.tasks_equal_records",
    taskIdentityChecks.length === children.length
      && taskIdentityChecks.length > 0
      && taskIdentityChecks.every((entry) => entry.ok)
      && sameJson(
        (servedTasks ?? []).map((entry) => entry.task_id).sort(),
        children.map(({ record }) => record.task_id).sort(),
      ),
    `${taskIdentityChecks.length} served task rows vs ${children.length} engine records`,
  );
  check(
    "identity.node_id_present",
    (servedTasks ?? []).length > 0 && (servedTasks ?? []).every((entry) => isRecord(entry) && (asString(entry.node_id) ?? "").length > 0),
    "every served task row carries the engine record's node_id",
  );

  // No id may be fabricated from a name/title/timestamp/array position: every
  // id in the document must appear verbatim in an engine record.
  const idProvenance = [];
  const untraceableIds = [];
  const collectId = (value, source, matchingIds) => {
    const ok = asString(value) !== null && matchingIds.has(value);
    idProvenance.push({ id: value, source, traceable: ok });
    if (!ok) untraceableIds.push({ id: value, source });
  };
  const nodeIdSet = new Set(checkpointNodeIds);
  const taskIdSet = new Set(children.map(({ record }) => record.task_id));
  collectId(servedBody?.sessionId, "checkpoint.parentSessionId", new Set([checkpoint.parentSessionId]));
  collectId(servedRun?.run_id, "checkpoint.runId", new Set([checkpoint.runId]));
  collectId(servedRun?.run_key, "checkpoint.runKey", new Set([checkpoint.runKey]));
  for (const node of servedRun?.nodes ?? []) collectId(node.id, "checkpoint.nodes[].id", nodeIdSet);
  for (const entry of servedTasks ?? []) {
    collectId(entry.task_id, "TaskRecord.task_id", taskIdSet);
    collectId(entry.node_id, "TaskRecord.owner.nodeId", nodeIdSet);
  }
  evidence.identity = {
    parent: {
      sessionId: servedBody?.sessionId ?? null,
      run_id: servedRun?.run_id ?? null,
      run_key: servedRun?.run_key ?? null,
      checkpoint_parent_session_id: checkpoint.parentSessionId,
      checkpoint_run_id: checkpoint.runId,
      checkpoint_run_key: checkpoint.runKey,
    },
    children: taskIdentityChecks,
    nodes: nodeIdentityChecks,
    id_provenance: idProvenance,
    untraceable_ids: untraceableIds,
  };
  check("identity.no_fabricated_ids", untraceableIds.length === 0 && idProvenance.length > 0, `${idProvenance.length} ids checked; untraceable=${untraceableIds.length}`);

  const parsed = parseSnapshotDoc(servedBody);
  const parsedTaskIds = parsed.ok ? parsed.view.tasks.map((task) => task.taskId) : null;
  const parsedNodeTaskIds = parsed.ok && parsed.view.runs.length > 0
    ? parsed.view.runs[0].nodes.map((node) => ({ id: node.id, taskId: node.taskId }))
    : null;
  evidence.panel_parse = {
    ok: parsed.ok,
    error: parsed.ok ? null : parsed.error,
    taskIds: parsedTaskIds,
    nodeTaskIds: parsedNodeTaskIds,
    rendersEngineTaskIds:
      parsed.ok
      && parsedTaskIds !== null
      && parsedTaskIds.length > 0
      && parsedTaskIds.every((taskId) => taskIdSet.has(taskId)),
  };
  check("panel.parses_engine_document", parsed.ok === true, parsed.ok ? "parseSnapshotDoc ok" : `parseSnapshotDoc failed: ${parsed.error.code} ${parsed.error.field}`);
  check("panel.renders_engine_task_ids", evidence.panel_parse.rendersEngineTaskIds === true, `panel task ids=${JSON.stringify(parsedTaskIds)}`);

  // 5. Negative controls (adversarial). A 200 response is not evidence by
  // itself: a steer document, a chat document, and a steer document placed at
  // the ENGINE session's own path must all be judged NOT the engine document.
  const writeSyntheticDocument = (sessionId, runKey, tasks, nodeId) => {
    const filePath = path.join(snapshotDir, `${sessionId}.snapshot.json`);
    writeFileSync(
      filePath,
      `${JSON.stringify({
        schemaVersion: 1,
        sessionId,
        updatedAt: new Date().toISOString(),
        dag: {
          runs: [{
            run_id: sessionId,
            run_key: runKey,
            name: sessionId,
            status: "completed",
            counts: { pending: 0, running: 0, completed: 1, failed: 0, cancelled: 0 },
            nodes: [{ id: nodeId, label: nodeId, state: "completed", attempt: 1, prompt: nodeId, depends_on: [] }],
            edges: [],
            waves: [{ index: 0, node_ids: [nodeId] }],
          }],
        },
        tasks,
      })}\n`,
      "utf8",
    );
    return filePath;
  };

  const steerSessionId = `${PARENT_SESSION_ID}-steer`;
  const steerPath = writeSyntheticDocument(steerSessionId, `steer:${steerSessionId}`, null, "step-1");
  const steerServed = await getSnapshot({ port, token, sessionId: steerSessionId, directory: workspaceDir });
  const steerClassifiedEngine = judgeEngineDocument(steerServed.status, steerServed.body);

  const chatSessionId = `${PARENT_SESSION_ID}-chat`;
  const chatPath = writeSyntheticDocument(
    chatSessionId,
    `chat:${chatSessionId}`,
    { parent_session_id: chatSessionId, tasks: [{ task_id: "st_00000000", status: "completed", name: "chat row" }] },
    "chat-node",
  );
  const chatServed = await getSnapshot({ port, token, sessionId: chatSessionId, directory: workspaceDir });
  const chatClassifiedEngine = judgeEngineDocument(chatServed.status, chatServed.body);

  // Strongest probe: replace the ENGINE session's document with a steer shape
  // and re-read the same route. The response stays 200, so only the document
  // judgment can reject it. The real raw document is restored immediately.
  writeFileSync(rawDocumentPath, readFileSync(steerPath), "utf8");
  const replacedServed = await getSnapshot({ port, token, sessionId: PARENT_SESSION_ID, directory: workspaceDir });
  const replacedClassifiedEngine = judgeEngineDocument(replacedServed.status, replacedServed.body);
  writeFileSync(rawDocumentPath, rawText, "utf8");
  const restoredServed = await getSnapshot({ port, token, sessionId: PARENT_SESSION_ID, directory: workspaceDir });
  const restoredClassifiedEngine = judgeEngineDocument(restoredServed.status, restoredServed.body);

  for (const probePath of [steerPath, chatPath]) rmSync(probePath, { force: true });

  evidence.adversarial = {
    misleading_success_output: {
      steer_document: {
        probe: "A synthetic steer document (tasks: null, run_key: steer:<session>) served with HTTP 200 must be judged NOT an engine document.",
        served_status: steerServed.status,
        served_run_key: isRecord(steerServed.body?.dag) && Array.isArray(steerServed.body.dag.runs) ? steerServed.body.dag.runs[0]?.run_key ?? null : null,
        served_tasks_null: steerServed.body?.tasks === null || steerServed.body?.tasks === undefined,
        classified_engine: steerClassifiedEngine,
        pass: steerServed.status === 200 && steerClassifiedEngine === false,
      },
      chat_document: {
        probe: "A host chat document (run_key: chat:<session>, non-empty tasks) served with HTTP 200 must be judged NOT an engine document.",
        served_status: chatServed.status,
        served_run_key: isRecord(chatServed.body?.dag) && Array.isArray(chatServed.body.dag.runs) ? chatServed.body.dag.runs[0]?.run_key ?? null : null,
        tasks_non_empty: (chatServed.body?.tasks?.tasks?.length ?? 0) > 0,
        classified_engine: chatClassifiedEngine,
        pass: chatServed.status === 200 && chatClassifiedEngine === false,
      },
      engine_path_replaced: {
        probe: "Overwrite the engine session's own snapshot path with a steer shape, re-read GET /snapshot, then restore: the 200 response must still be rejected, and the restored document must pass.",
        served_status: replacedServed.status,
        classified_engine_while_replaced: replacedClassifiedEngine,
        restored_status: restoredServed.status,
        restored_classified_engine: restoredClassifiedEngine,
        restored_equals_raw: sameJson(restoredServed.body, rawDocument),
        pass:
          replacedServed.status === 200
          && replacedClassifiedEngine === false
          && restoredServed.status === 200
          && restoredClassifiedEngine === true
          && sameJson(restoredServed.body, rawDocument),
      },
      pass:
        steerServed.status === 200
        && steerClassifiedEngine === false
        && chatServed.status === 200
        && chatClassifiedEngine === false
        && replacedServed.status === 200
        && replacedClassifiedEngine === false
        && restoredClassifiedEngine === true,
    },
    fabricated_identity: {
      ids_checked: idProvenance.length,
      untraceable: untraceableIds,
      pass: untraceableIds.length === 0,
    },
  };
  check("adversarial.steer_not_engine", evidence.adversarial.misleading_success_output.steer_document.pass === true, "a 200 steer document is not accepted as the engine document");
  check("adversarial.chat_not_engine", evidence.adversarial.misleading_success_output.chat_document.pass === true, "a 200 chat document is not accepted as the engine document");
  check("adversarial.engine_path_replacement_rejected", evidence.adversarial.misleading_success_output.engine_path_replaced.pass === true, "a steer document at the engine path is rejected; the restored engine document passes");
  check("adversarial.no_fabricated_identity", evidence.adversarial.fabricated_identity.pass === true, `${untraceableIds.length} untraceable ids`);

  // 6. Restart check: stop the service, start it again, re-read.
  const stopped = await stopService(service);
  if (stopped !== null) stoppedProcessRecords.push(stopped);
  service = null;
  const portReleased = await waitForPortFree(port, PORT_FREE_TIMEOUT_MS);
  check("restart.port_released", portReleased, `port ${port} free after stop=${portReleased}`);
  serviceRestart = startService({ port, token, tempRoot });
  await serviceRestart.ready;
  const servedRestart = await getSnapshot({ port, token, sessionId: PARENT_SESSION_ID, directory: workspaceDir });
  say(`[restart] pid=${serviceRestart.record.pid} GET /snapshot -> ${servedRestart.status} (${servedRestart.bytes} bytes)`);
  check("restart.status", servedRestart.status === 200, `restarted GET /snapshot status=${servedRestart.status}`);
  check("restart.equal_to_first", sameJson(servedRestart.body, servedFirst.body), "restarted served body equals the first served body");
  check("restart.equal_to_raw", sameJson(servedRestart.body, rawDocument), "restarted served body equals the raw engine document");
  const restartRun = isRecord(servedRestart.body?.dag) && Array.isArray(servedRestart.body.dag.runs) ? servedRestart.body.dag.runs[0] : null;
  check("restart.attribution_survives", restartRun !== null && restartRun.run_key === checkpoint.runKey && (servedRestart.body?.tasks?.tasks?.length ?? 0) > 0, "run_key + non-empty tasks survive the service restart");

  evidence.served = {
    first: {
      status: servedFirst.status,
      sha256: servedFirst.sha256,
      body: servedFirst.body,
    },
    restart: {
      status: servedRestart.status,
      sha256: servedRestart.sha256,
      body: servedRestart.body,
    },
    restart_check: {
      stopped_process: stopped,
      port_released: portReleased,
      restarted_process_pid: serviceRestart.record.pid,
      equal_to_first: sameJson(servedRestart.body, servedFirst.body),
      equal_to_raw: sameJson(servedRestart.body, rawDocument),
    },
  };
  evidence.service.process = stopped;

  // Top-level fields named by the p26 plan, derived from the assertions above.
  const assertionOk = (id) => assertions.find((entry) => entry.id === id)?.ok === true;
  evidence.document_path = rawDocumentPath;
  evidence.engine_doc_judged = assertionOk("engine_doc_judged");
  evidence.tasks_non_null = assertionOk("tasks_non_null");
  evidence.task_id_present = taskIdentityChecks.length > 0 && taskIdentityChecks.every((entry) => entry.ok && entry.task_id_format_ok === true);
  evidence.node_id_present = assertionOk("identity.node_id_present");
  evidence.run_key_engine_derived = assertionOk("run_key.engine_derived") && assertionOk("run_key.format");
  evidence.run_key_not_steer = assertionOk("run_key.not_steer");
  evidence.chat_doc_judged = false;
  evidence.chat_doc_judged_reason =
    "This capture judges the engine document only. The host chat document (buildDagRunModel -> dagRunModelToSnapshotDoc) is not used, not served, and not judged here.";
  evidence.id_derivation = {
    run_id: "checkpoint.runId (DAG manager generated)",
    run_key: "checkpoint.runKey (definition key: delegation-<sha256 of the submitted definition>)",
    task_id: "TaskRecord.task_id (manager allocator, st_[0-9a-f]{8})",
    node_id: "TaskRecord.owner.nodeId (the DAG node that owns the child)",
    session_id: "checkpoint.parentSessionId",
    derived_from_name_title_timestamp_or_index: false,
  };

  evidence.verdict = failures.length === 0 ? "PASS" : "FAIL";
  if (failures.length > 0) {
    evidence.errors.push(...failures.map((id) => `assertion failed: ${id}`));
    say(`FAILED ASSERTIONS: ${failures.join(", ")}`);
  }
  say(`engine_doc_judged: ${evidence.assertions.find((entry) => entry.id === "engine_doc_judged")?.ok === true}`);
  say(`tasks_non_null: ${evidence.assertions.find((entry) => entry.id === "tasks_non_null")?.ok === true}`);
  say(`restart_equal: ${evidence.assertions.find((entry) => entry.id === "restart.equal_to_first")?.ok === true}`);
  say(`alcode_run_graph_surface: NOT_PROVEN`);
  await cleanupAndExit(failures.length === 0 ? 0 : 1);
} catch (error) {
  evidence.errors.push(errorMessage(error));
  say(`ERROR: ${errorMessage(error)}`);
  try {
    await cleanupAndExit(2);
  } catch (cleanupError) {
    say(`CLEANUP ERROR: ${errorMessage(cleanupError)}`);
    process.exit(2);
  }
}
