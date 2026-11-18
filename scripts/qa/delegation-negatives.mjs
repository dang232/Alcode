/**
 * C4 negative-control matrix for engineering delegation.
 *
 * Every control must fail closed: none of them may produce a parent claim of
 * completed + verified. Controls 1-4 drive the REAL DAG manager, scheduler,
 * journal, wait surface, task manager, and record store with a scripted child
 * runner (the same seam run.integration.test.ts uses). Control 6 writes real
 * verification evidence through the REAL capture path and asks the REAL gate.
 * Controls 5, 7, 9 are pure seam checks. No live model is called.
 *
 * The parent synthesis decision is exercised directly with a rejecting review
 * payload (control 8). That is the same accept/reject guard delegation-c3.mjs
 * applies to the parsed investigator/reviewer answers; no live review call is
 * made, and the control says so in its observation.
 *
 * Output: one `[control]` line per control, then one RESULT line.
 * Evidence: .omo/ulw/p24/delegation-negatives.json
 *
 * Usage:
 *   bun scripts/qa/delegation-negatives.mjs
 *   node scripts/qa/delegation-negatives.mjs
 *
 * Exit codes:
 *   0  all nine controls passed
 *   1  a control failed or was blocked
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

import { asNonBlankString, asRecord, asString } from "./wire-values.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(ROOT, "packages", "omo-engine", "senpi-task", "src");
const OMO_CONFIG = path.join(ROOT, "packages", "omo-engine", "omo-config-core", "src", "index.ts");
const EVIDENCE_RELATIVE = path.join(".omo", "ulw", "p24", "delegation-negatives.json");
const EVIDENCE_PATH = path.join(ROOT, EVIDENCE_RELATIVE);

const PARENT_SESSION_ID = "delegation-negatives-parent";
const ROOT_SESSION_ID = "delegation-negatives-root";
const CHECK_ID = "sum-check";
const CHECK_FILE = "src/sum.js";
const PREVIEW_CHARS = 600;
const DEADLINE_MS = 2000;

// All harness output is buffered so a blocked control can print one exact line.
const output = [];
function say(line) {
  output.push(line);
}
function flushOutput() {
  for (const line of output) writeSync(1, `${line}\n`);
  output.length = 0;
}

// ---------------------------------------------------------------------------
// Dual-runtime entry: the real chain is imported from TypeScript sources, which
// needs Bun. Plain `node` re-execs under bun and passes the exit code through.
// ---------------------------------------------------------------------------
const isBun = Object.prototype.toString.call(process.versions.bun) === "[object String]";
if (!isBun && !process.argv.includes("--no-reexec") && !process.env.DELEGATION_NEGATIVES_VIA_BUN) {
  const candidates = process.platform === "win32" ? ["bun", "bun.exe"] : ["bun"];
  let done = false;
  for (const candidate of candidates) {
    let res;
    try {
      res = spawnSync(candidate, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
        stdio: "inherit",
        env: { ...process.env, DELEGATION_NEGATIVES_VIA_BUN: "1" },
      });
    } catch {
      continue;
    }
    if (res.error && res.error.code === "ENOENT") continue;
    done = true;
    process.exit(res.status ?? 1);
  }
  if (!done) {
    say("RESULT: FAIL (bun runtime not found; delegation-negatives needs bun to import the real TS chain)");
    flushOutput();
    process.exit(1);
  }
}

// Real modules, imported dynamically so the bun re-exec runs first.
const { createTaskRecordStore } = await import(path.join(SRC, "store", "index.ts"));
const { createTaskManager } = await import(path.join(SRC, "manager", "manager.ts"));
const { createDagManager } = await import(path.join(SRC, "dag", "manager.ts"));
const { createDagScheduler } = await import(path.join(SRC, "dag", "scheduler.ts"));
const { createDagFileStore } = await import(path.join(SRC, "dag", "store.ts"));
const { createDagWaitSurface } = await import(path.join(SRC, "dag", "handle.ts"));
const { collectDelegationResults, delegationNodeId } = await import(path.join(SRC, "delegation", "plan.ts"));
const { runEngineeringDelegation } = await import(path.join(SRC, "delegation", "run.ts"));
const { OmoTaskSettingsSchema } = await import(OMO_CONFIG);
const { catalogueFrom } = await import(path.join(SRC, "verification", "catalogue.ts"));
const { createFileEvidenceStore, workspaceRevision } = await import(
  path.join(SRC, "verification", "evidence-store.ts")
);
const { createOrdinaryVerificationCapture } = await import(
  path.join(SRC, "verification", "ordinary-capture.ts")
);
const { evaluateOrdinaryCompletion } = await import(path.join(SRC, "verification", "completion-gate.ts"));

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------
class ControlFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "ControlFailure";
  }
}

class ControlBlocked extends Error {
  constructor(reason, location) {
    super(reason);
    this.name = "ControlBlocked";
    this.location = location;
  }
}

function requireTrue(condition, message) {
  if (!condition) throw new ControlFailure(`assertion failed: ${message}`);
}

function errorMessage(error) {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

function locationOf(error) {
  const stack = error instanceof Error && error.stack !== undefined ? error.stack : "";
  const lines = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("delegation-negatives.mjs:"));
  const chosen =
    lines.find((line) => !line.includes("requireTrue") && !line.includes("locationOf")) ?? lines[0];
  if (chosen === undefined) return `${path.join("scripts", "qa", "delegation-negatives.mjs").replace(/\\/g, "/")}:1`;
  return chosen.replace(/^at\s+/, "");
}

function redactSensitive(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
}

function bounded(text, max = PREVIEW_CHARS) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    timer.unref?.();
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function nodeFixture(role, state, text) {
  return {
    id: delegationNodeId(role),
    prompt: "fixture prompt",
    route: { kind: "agent", agent: "explore" },
    dependsOn: [],
    writeScopes: [],
    state,
    attempt: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    output: text,
    outputBytes: Buffer.byteLength(text, "utf8"),
  };
}

// ---------------------------------------------------------------------------
// Fixture: a real git workspace with one approved-style check.
// ---------------------------------------------------------------------------
const CORRECT_SUM_JS = `// Adds two numbers.
export function add(a, b) {
  return a + b;
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

const FIXTURE_CHECK = {
  checkId: CHECK_ID,
  category: "unit",
  command: ["node", "checks/sum-check.mjs"],
  timeoutMs: 30_000,
  criteria: ["add(2, 3) returns 5"],
  coveredPaths: [],
};

const FIXTURE_CATALOGUE = catalogueFrom([
  {
    check: FIXTURE_CHECK,
    provenance: {
      source: "config",
      location: ".alcode/verification.json",
      reason: "delegation-negatives fixture",
    },
  },
]);

function git(workspaceDir, ...args) {
  execFileSync("git", ["-C", workspaceDir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

function setupFixture() {
  let root = null;
  try {
    root = mkdtempSync(path.join(tmpdir(), "delegation-negatives-"));
    const workspace = path.join(root, "work");
    mkdirSync(path.join(workspace, "src"), { recursive: true });
    mkdirSync(path.join(workspace, "checks"), { recursive: true });
    writeFileSync(path.join(workspace, CHECK_FILE), CORRECT_SUM_JS);
    writeFileSync(path.join(workspace, "checks", "sum-check.mjs"), SUM_CHECK_MJS);
    writeFileSync(
      path.join(workspace, "package.json"),
      `${JSON.stringify({ name: "delegation-negatives-fixture", private: true, type: "module" }, null, 2)}\n`,
    );
    git(workspace, "init", "-q");
    git(workspace, "add", "-A");
    git(
      workspace,
      "-c",
      "user.email=delegation-negatives@example.com",
      "-c",
      "user.name=delegation-negatives",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture: correct add() plus a passing check",
    );
    return { root, workspace, error: null, location: null };
  } catch (error) {
    if (root !== null) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // Best effort; the fixture failure is the observation that matters.
      }
    }
    return { root: null, workspace: null, error: errorMessage(error), location: locationOf(error) };
  }
}

const fixture = setupFixture();

function requireFixture() {
  if (fixture.error !== null) {
    throw new ControlBlocked(`fixture workspace unavailable: ${fixture.error}`, fixture.location);
  }
  return fixture;
}

// ---------------------------------------------------------------------------
// Scripted child runner over the REAL manager and DAG engine.
// ---------------------------------------------------------------------------
const NODE_ID_LINE = /^Node: (\S+)$/m;

function nodeIdOf(spec) {
  const match = NODE_ID_LINE.exec(spec.prompt);
  return match?.[1] ?? spec.taskId;
}

class ScriptedRunner {
  constructor(outcomes) {
    this.outcomes = outcomes;
    this.starts = [];
    this.startedNodeIds = [];
    this.liveTaskIds = new Set();
    this.stoppedTaskIds = new Set();
    this.settlers = new Map();
    this.firstStart = deferred();
  }

  start(spec) {
    const nodeId = nodeIdOf(spec);
    const taskId = spec.taskId;
    this.startedNodeIds.push(nodeId);
    this.starts.push({ nodeId, taskId });
    this.liveTaskIds.add(taskId);

    const scripted = this.outcomes.get(nodeId) ?? {
      kind: "completed",
      text: `${nodeId} scripted result`,
    };
    let settled = false;
    let lastText;
    let resolveOutcome;
    const outcome = new Promise((resolve) => {
      resolveOutcome = resolve;
    });
    const settle = (value) => {
      if (settled) return;
      settled = true;
      this.liveTaskIds.delete(taskId);
      resolveOutcome(value);
    };
    this.settlers.set(taskId, settle);

    if (scripted.kind === "completed") {
      lastText = scripted.text;
      settle({ status: "completed", finalResponse: scripted.text });
    } else if (scripted.kind === "failed") {
      settle({
        status: "error",
        killed: false,
        failure: { kind: "child-prompt-failed", message: scripted.message },
      });
    }

    this.firstStart.resolve();
    return Promise.resolve({
      task_id: taskId,
      kind: "in-process",
      sessionId: `child-${taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => {
        this.stoppedTaskIds.add(taskId);
        settle({ status: "cancelled" });
        return Promise.resolve();
      },
      subscribe: () => () => undefined,
      waitForOutcome: () => outcome,
      lastAssistantText: () => lastText,
      terminate: () => {
        this.stoppedTaskIds.add(taskId);
        settle({ status: "cancelled" });
        return Promise.resolve();
      },
      dispose: () => {
        this.stoppedTaskIds.add(taskId);
        settle({ status: "cancelled" });
        return Promise.resolve();
      },
    });
  }

  stop(taskId) {
    this.stoppedTaskIds.add(taskId);
    this.settlers.get(taskId)?.();
  }
}

function planner(spec) {
  const target = spec.category ?? spec.subagent_type ?? "default";
  const plan = { model: spec.model ?? `scripted/${target}` };
  if (spec.category !== undefined) {
    return { kind: "resolved", plan: { ...plan, category: spec.category } };
  }
  if (spec.subagent_type !== undefined) {
    return { kind: "resolved", plan: { ...plan, agentType: spec.subagent_type } };
  }
  return { kind: "resolved", plan };
}

function createRuntime(projectDir, stateDir, outcomes) {
  const dagStore = createDagFileStore({ project_dir: projectDir, task: { state_dir: stateDir } });
  const taskStore = createTaskRecordStore({ project_dir: projectDir, task: { state_dir: stateDir } });
  const runner = new ScriptedRunner(outcomes);
  const taskManager = createTaskManager({
    store: taskStore,
    runners: { "in-process": runner, process: runner },
    planner,
    config: OmoTaskSettingsSchema.parse({
      default_concurrency: 4,
      max_depth: 2,
      default_execution_mode: "in-process",
    }),
    cwd: projectDir,
    destruction: {
      destroyResidentTask: async (taskId) => {
        runner.stop(taskId);
      },
    },
  });
  const dagManager = createDagManager({ store: dagStore });
  const schedulers = new Map();
  const runStarted = new Map();
  const surface = createDagWaitSurface({
    store: dagStore,
    subscribe: (runId, listener) => {
      const scheduler = schedulers.get(runId);
      if (scheduler === undefined) throw new Error(`missing scheduler for dag run ${runId}`);
      return scheduler.subscribe(listener);
    },
    cancel: (runId, reason) => {
      const scheduler = schedulers.get(runId);
      if (scheduler === undefined) throw new Error(`missing scheduler for dag run ${runId}`);
      return scheduler.cancel(runId, reason);
    },
  });

  const ensureScheduler = (runId) => {
    const existing = schedulers.get(runId);
    if (existing !== undefined) return existing;
    const scheduler = createDagScheduler({
      store: dagStore,
      taskManager,
      initialRecord: dagManager.record(runId, PARENT_SESSION_ID),
    });
    schedulers.set(runId, scheduler);
    const started = scheduler.run();
    started.catch(() => undefined);
    runStarted.set(runId, started);
    return scheduler;
  };

  const wait = async (runId, deadlineMs) => {
    ensureScheduler(runId);
    if (!Number.isFinite(deadlineMs)) {
      const result = await surface.wait(runId, PARENT_SESSION_ID);
      await runStarted.get(runId);
      return result;
    }
    const deadline = delay(deadlineMs);
    const pending = surface.wait(runId, PARENT_SESSION_ID);
    const settled = await Promise.race([
      pending.then((result) => ({ kind: "result", result })),
      deadline.then(() => ({ kind: "deadline" })),
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

  return {
    dagManager,
    taskManager,
    runner,
    wait,
    runIds: () => [...schedulers.keys()],
    async cancel(runId, reason) {
      await surface.attach(runId, PARENT_SESSION_ID).cancel(reason);
    },
    async settle(runId) {
      try {
        await runStarted.get(runId);
      } catch {
        // The control observed the run-layer result; a rejected scheduler promise
        // after cancellation is reported by the control's own assertions.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Plan requests and completion-gate helpers.
// ---------------------------------------------------------------------------
const ROLES_TWO = [
  { key: "investigate", assignment: "Locate the defect and report the exact repair." },
  { key: "review", assignment: "Independently confirm or reject the repair." },
];

const ROLES_WITH_VERIFY = [
  { key: "investigate", assignment: "Locate the defect and report the exact repair." },
  { key: "review", assignment: "Independently confirm or reject the repair." },
  { key: "verify", assignment: "Run the check and report observed evidence.", dependsOn: ["review"] },
];

const COMPLETION_KEYS = [
  "ok",
  "outcomes",
  "runId",
  "unresolved",
];

function delegationRequest(workspaceDir, roles, deadlineMs) {
  const request = {
    objective: "Prove that an incomplete delegation cannot publish a verified claim.",
    workingDirectory: workspaceDir,
    roles,
    parentSessionId: PARENT_SESSION_ID,
    rootSessionId: ROOT_SESSION_ID,
  };
  if (deadlineMs !== undefined) request.deadlineMs = deadlineMs;
  return request;
}

function completionOf(result) {
  requireTrue(
    result.ok === true,
    `the run returned ${result.kind ?? "a plan rejection"}: ${result.reason ?? result.rejection?.code ?? "unknown"}`,
  );
  return result;
}

function deadlineFailureOf(result) {
  requireTrue(result.ok === false, "a deadline returned a success-shaped result");
  requireTrue(
    result.kind === "deadline_unavailable_at_manager_seam",
    `deadline kind is ${result.kind ?? "missing"}`,
  );
  // The deadline result's reason is a non-empty string by contract; an absent one reports itself
  // here instead of throwing on `.length`.
  requireTrue((result.reason?.length ?? 0) > 0, "the deadline reason is empty");
  requireTrue(result.unresolved === true, "a deadline result must be unresolved");
  for (const forbidden of ["accepted", "approved", "success", "verified", "verdict"]) {
    requireTrue(!(forbidden in result), `deadline result carried a forbidden "${forbidden}" key`);
  }
  return result;
}

function expectNoVerdict(result) {
  const keys = Object.keys(result).sort();
  requireTrue(
    keys.join(",") === [...COMPLETION_KEYS].sort().join(","),
    `completion carried unexpected keys: ${keys.join(",")}`,
  );
  for (const forbidden of ["accepted", "approved", "success", "verified", "verdict"]) {
    requireTrue(!(forbidden in result), `completion carried a forbidden "${forbidden}" key`);
  }
}

function gateFor(taskId, evidenceRoot) {
  return evaluateOrdinaryCompletion({
    taskId,
    catalogue: FIXTURE_CATALOGUE,
    evidenceRoot,
    workspaceDir: fixture.workspace,
    epoch: 0,
  });
}

function isTerminalDagStatus(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// ---------------------------------------------------------------------------
// Parent synthesis: the same accept/reject guard the live harness applies.
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

function extractMarkedJson(text, marker) {
  const at = text.lastIndexOf(marker);
  if (at < 0) return null;
  const open = text.indexOf("{", at + marker.length);
  if (open < 0) return null;
  return parseJsonRecord(jsonObjectAt(text, open));
}

function parseInvestigation(text) {
  const record = extractMarkedJson(text, "DELEGATION_INVESTIGATE");
  if (record === null) return null;
  const find = asString(record.find);
  const replace = asString(record.replace);
  if (find === null || find.trim().length === 0) return null;
  if (replace === null || replace.trim().length === 0) return null;
  return {
    path: asString(record.path),
    find,
    replace,
    defect: asString(record.defect),
  };
}

function parseReview(text) {
  const record = extractMarkedJson(text, "DELEGATION_REVIEW");
  if (record === null) return null;
  const raw = asNonBlankString(record.verdict);
  if (raw === null) return null;
  const verdict = raw.toLowerCase();
  if (/^(confirm|confirmed|approve|approved|accept|accepted)\b/.test(verdict)) {
    return {
      verdict: "confirm",
      find: asString(record.find),
      replace: asString(record.replace),
      reason: asString(record.reason),
    };
  }
  if (/^(reject|rejected|deny|denied|contradict|contradicted|disagree|disagreed)\b/.test(verdict)) {
    return {
      verdict: "reject",
      find: asString(record.find),
      replace: asString(record.replace),
      reason: asString(record.reason),
    };
  }
  return null;
}

function normalizeEditText(value) {
  const text = asString(value);
  return text === null ? null : text.replace(/\r\n/g, "\n").trim();
}

function usableEdit(payload) {
  const record = asRecord(payload);
  if (record === null) return null;
  const find = asString(record.find);
  const replace = asString(record.replace);
  if (find === null || find.trim().length === 0) return null;
  if (replace === null || replace.trim().length === 0) return null;
  return { find, replace };
}

function synthesizeDelegation(investigation, review) {
  const finding = usableEdit(investigation);
  if (finding === null) {
    return {
      accepted: false,
      agreement: null,
      contradiction: {
        kind: "unusable_child_output",
        detail: "the investigator answer carried no usable find/replace pair",
      },
    };
  }
  const reviewer = asRecord(review);
  if (reviewer === null) {
    return {
      accepted: false,
      agreement: null,
      contradiction: {
        kind: "unusable_child_output",
        detail: "the reviewer answer carried no verdict",
      },
    };
  }
  const verdict = asNonBlankString(reviewer.verdict);
  if (verdict === null) {
    return {
      accepted: false,
      agreement: null,
      contradiction: {
        kind: "unusable_child_output",
        detail: "the reviewer answer carried no verdict",
      },
    };
  }
  const sameFind = normalizeEditText(finding.find) === normalizeEditText(reviewer.find);
  const sameReplace = normalizeEditText(finding.replace) === normalizeEditText(reviewer.replace);
  const agreement = { sameFind, sameReplace };
  if (verdict !== "confirm") {
    return {
      accepted: false,
      agreement,
      contradiction: {
        kind: "reviewer_rejected",
        detail: `reviewer verdict=${verdict}: ${asString(reviewer.reason) ?? "no reason given"}`,
        investigator: finding,
        reviewer,
      },
    };
  }
  if (!sameFind || !sameReplace) {
    return {
      accepted: false,
      agreement,
      contradiction: {
        kind: "edit_text_mismatch",
        detail: `sameFind=${sameFind} sameReplace=${sameReplace}`,
        investigator: finding,
        reviewer,
      },
    };
  }
  return { accepted: true, agreement, contradiction: null };
}

// ---------------------------------------------------------------------------
// Controls.
// ---------------------------------------------------------------------------
async function controlChildFailure() {
  const workspace = requireFixture();
  const runtime = createRuntime(
    workspace.workspace,
    path.join(workspace.root, "state-control-1"),
    new Map([[delegationNodeId("review"), { kind: "failed", message: "review child failed" }]]),
  );
  const result = completionOf(
    await runEngineeringDelegation(
      { dagManager: runtime.dagManager, wait: runtime.wait },
      delegationRequest(workspace.workspace, ROLES_WITH_VERIFY),
    ),
  );
  expectNoVerdict(result);
  const record = runtime.dagManager.record(result.runId, PARENT_SESSION_ID);
  requireTrue(record.status === "failed", `run status is ${record.status}, want failed`);
  const byRole = new Map(result.outcomes.map((outcome) => [outcome.role, outcome.outcome]));
  requireTrue(byRole.get("investigate") === "completed", `investigate outcome is ${byRole.get("investigate")}`);
  requireTrue(byRole.get("review") === "failed", `review outcome is ${byRole.get("review")}`);
  requireTrue(byRole.get("verify") === "skipped", `verify outcome is ${byRole.get("verify")}`);
  const gate = gateFor(result.runId, path.join(workspace.root, "evidence-control-1"));
  requireTrue(gate.verification !== "verified", `gate returned ${gate.verification}`);
  return `status=${record.status} review=failed verify=skipped gate=${gate.verification}/${gate.code ?? "none"}`;
}

async function controlChildTimeout() {
  const workspace = requireFixture();
  const runtime = createRuntime(
    workspace.workspace,
    path.join(workspace.root, "state-control-2"),
    new Map([[delegationNodeId("investigate"), { kind: "hang" }]]),
  );
  const result = deadlineFailureOf(
    await runEngineeringDelegation(
      { dagManager: runtime.dagManager, wait: runtime.wait },
      delegationRequest(workspace.workspace, ROLES_TWO, DEADLINE_MS),
    ),
  );
  requireTrue(runtime.runner.startedNodeIds.length >= 1, "no child started before the deadline elapsed");
  const record = runtime.dagManager.record(result.runId, PARENT_SESSION_ID);
  requireTrue(!isTerminalDagStatus(record.status), `deadline status ${record.status} is terminal`);
  const gate = gateFor(result.runId, path.join(workspace.root, "evidence-control-2"));
  requireTrue(gate.verification !== "verified", `gate returned ${gate.verification}`);
  const liveBefore = runtime.runner.liveTaskIds.size;
  await runtime.cancel(result.runId, "control-2 cleanup");
  await runtime.settle(result.runId);
  requireTrue(runtime.runner.liveTaskIds.size === 0, "a child kept running after the deadline cleanup cancel");
  return `kind=${result.kind} status=${record.status} unresolved=true liveChildren=${liveBefore}->0 gate=${gate.verification}/${gate.code ?? "none"}`;
}

async function controlParentCancellation() {
  const workspace = requireFixture();
  const runtime = createRuntime(
    workspace.workspace,
    path.join(workspace.root, "state-control-3"),
    new Map([[delegationNodeId("investigate"), { kind: "hang" }]]),
  );
  const runPromise = runEngineeringDelegation(
    { dagManager: runtime.dagManager, wait: runtime.wait },
    delegationRequest(workspace.workspace, ROLES_TWO),
  );
  await runtime.runner.firstStart.promise;
  const runIds = runtime.runIds();
  requireTrue(runIds.length === 1, `expected one started run, saw ${runIds.length}`);
  const liveBefore = runtime.runner.liveTaskIds.size;
  await runtime.cancel(runIds[0], "control-3 parent cancellation");
  const result = completionOf(await runPromise);
  await runtime.settle(result.runId);
  expectNoVerdict(result);
  const record = runtime.dagManager.record(result.runId, PARENT_SESSION_ID);
  requireTrue(record.status === "cancelled", `run status is ${record.status}, want cancelled`);
  requireTrue(
    record.nodes.every((node) => node.state === "cancelled"),
    `non-cancelled nodes: ${record.nodes.filter((node) => node.state !== "cancelled").map((node) => `${node.id}:${node.state}`).join(",")}`,
  );
  requireTrue(
    result.outcomes.length === record.nodes.length && result.outcomes.every((outcome) => outcome.outcome === "cancelled"),
    `outcomes are ${result.outcomes.map((outcome) => outcome.outcome).join(",")}`,
  );
  requireTrue(runtime.runner.liveTaskIds.size === 0, "a child kept running after parent cancellation");
  requireTrue(runtime.runner.stoppedTaskIds.size >= 1, "no child was stopped by parent cancellation");
  const gate = gateFor(result.runId, path.join(workspace.root, "evidence-control-3"));
  requireTrue(gate.verification !== "verified", `gate returned ${gate.verification}`);
  return `status=cancelled nodesCancelled=${record.nodes.length} liveChildren=${liveBefore}->0 stopped=${runtime.runner.stoppedTaskIds.size} gate=${gate.verification}/${gate.code ?? "none"}`;
}

async function controlDuplicateDispatch() {
  const workspace = requireFixture();
  const runtime = createRuntime(workspace.workspace, path.join(workspace.root, "state-control-4"), new Map());
  const deps = { dagManager: runtime.dagManager, wait: runtime.wait };
  const first = completionOf(
    await runEngineeringDelegation(deps, delegationRequest(workspace.workspace, ROLES_TWO)),
  );
  const firstStarts = runtime.runner.starts.length;
  const firstRecord = runtime.dagManager.record(first.runId, PARENT_SESSION_ID);
  const firstTaskIds = new Map(firstRecord.nodes.map((node) => [node.id, node.taskId]));
  requireTrue(firstTaskIds.size === 2, `first dispatch produced ${firstTaskIds.size} node task ids`);
  requireTrue(new Set(firstTaskIds.values()).size === 2, "first dispatch reused a child task id across nodes");

  const second = completionOf(
    await runEngineeringDelegation(deps, delegationRequest(workspace.workspace, ROLES_TWO)),
  );
  requireTrue(second.runId === first.runId, `second dispatch started run ${second.runId}, want ${first.runId}`);
  requireTrue(
    runtime.runner.starts.length === firstStarts,
    `second dispatch spawned ${runtime.runner.starts.length - firstStarts} new child(ren)`,
  );
  const secondRecord = runtime.dagManager.record(second.runId, PARENT_SESSION_ID);
  const secondTaskIds = new Map(secondRecord.nodes.map((node) => [node.id, node.taskId]));
  for (const [nodeId, taskId] of firstTaskIds) {
    requireTrue(
      secondTaskIds.get(nodeId) === taskId,
      `node ${nodeId} task id changed from ${taskId} to ${secondTaskIds.get(nodeId)}`,
    );
  }
  return `runIdReused=true starts=${runtime.runner.starts.length} distinctTaskIds=${new Set(secondTaskIds.values()).size} secondDispatchStarts=0`;
}

async function controlDuplicateResultDelivery() {
  const first = nodeFixture("review", "completed", "found it");
  const second = nodeFixture("review", "completed", "found it again");
  const collection = collectDelegationResults([first, second]);
  requireTrue(collection.results.length === 1, `collection produced ${collection.results.length} outcomes`);
  requireTrue(collection.duplicatesIgnored === 1, `duplicatesIgnored is ${collection.duplicatesIgnored}`);
  const expectedBytes = Buffer.byteLength("found it again", "utf8");
  requireTrue(
    collection.results[0]?.outputBytes === expectedBytes,
    `outcome bytes are ${collection.results[0]?.outputBytes}, want ${expectedBytes}`,
  );
  return `outcomes=${collection.results.length} duplicatesIgnored=${collection.duplicatesIgnored} bytes=${expectedBytes}`;
}

async function controlStaleEpoch() {
  const workspace = requireFixture();
  const evidenceRoot = path.join(workspace.root, "evidence-control-6");
  const runId = "delegation-negatives-stale-epoch";
  const capture = createOrdinaryVerificationCapture({
    store: createFileEvidenceStore(evidenceRoot),
    projectDir: workspace.workspace,
    currentRevision: () => workspaceRevision(workspace.workspace),
  });
  const captured = await capture.capture({
    binding: { runId, sessionId: PARENT_SESSION_ID, epoch: 0 },
    changedFiles: [],
    available: [FIXTURE_CHECK],
    attempt: 1,
  });
  requireTrue(captured.selection.required.length === 1, `capture required ${captured.selection.required.length} checks`);
  const record = captured.records[0];
  requireTrue(record !== undefined, "capture wrote no verification record");
  requireTrue(record.status === "passed", `check status is ${record.status}, want passed`);

  const currentGate = evaluateOrdinaryCompletion({
    taskId: runId,
    catalogue: FIXTURE_CATALOGUE,
    evidenceRoot,
    workspaceDir: workspace.workspace,
    epoch: 0,
  });
  requireTrue(currentGate.verification === "verified", `same-epoch gate returned ${currentGate.verification}`);
  const staleGate = evaluateOrdinaryCompletion({
    taskId: runId,
    catalogue: FIXTURE_CATALOGUE,
    evidenceRoot,
    workspaceDir: workspace.workspace,
    epoch: 1,
  });
  requireTrue(staleGate.verification === "blocked", `older-epoch gate returned ${staleGate.verification}`);
  requireTrue(staleGate.code === "verification_stale", `older-epoch code is ${staleGate.code}`);
  return `epoch0=verified epoch1=${staleGate.verification}/${staleGate.code} check=${record.status} workerAttempt=${record.workerAttempt}`;
}

async function controlMalformedChildOutput() {
  const garbage = "I opened the file but could not produce the requested JSON.";
  const emptyNode = nodeFixture("investigate", "completed", "");
  const garbageNode = nodeFixture("review", "completed", garbage);
  const collection = collectDelegationResults([emptyNode, garbageNode]);
  const emptyOutcome = collection.results.find((outcome) => outcome.role === "investigate");
  const garbageOutcome = collection.results.find((outcome) => outcome.role === "review");
  requireTrue(emptyOutcome?.outcome === "unusable", `empty output classified ${emptyOutcome?.outcome}`);
  requireTrue(garbageOutcome?.outcome === "completed", `garbage output classified ${garbageOutcome?.outcome}`);
  requireTrue((garbageOutcome?.outputBytes ?? 0) > 0, "garbage output carried no bytes");

  const parsedInvestigation = parseInvestigation(garbage);
  const parsedReview = parseReview(garbage);
  requireTrue(parsedInvestigation === null, "garbage was parsed as an investigation payload");
  requireTrue(parsedReview === null, "garbage was parsed as a review payload");
  const synthesis = synthesizeDelegation(parsedInvestigation, parsedReview);
  requireTrue(synthesis.accepted === false, "synthesis accepted a garbage child answer");
  requireTrue(
    synthesis.contradiction?.kind === "unusable_child_output",
    `synthesis contradiction is ${synthesis.contradiction?.kind}`,
  );
  const emptySynthesis = synthesizeDelegation(
    { path: CHECK_FILE, find: "", replace: "" },
    { verdict: "confirm", find: "", replace: "" },
  );
  requireTrue(emptySynthesis.accepted === false, "synthesis accepted an empty find/replace pair");
  return `empty=unusable garbage=completed(${garbageOutcome?.outputBytes}B) parsed=null synthesis=refused/${synthesis.contradiction?.kind}`;
}

async function controlConflictingRecommendations() {
  const workspace = requireFixture();
  const synthesisDir = path.join(workspace.root, "synthesis-workspace");
  mkdirSync(synthesisDir, { recursive: true });
  const target = path.join(synthesisDir, "sum.js");
  writeFileSync(target, `export function add(a, b) {\n  return a - b;\n}\n`);
  const beforeHash = sha256File(target);

  const investigationText = `DELEGATION_INVESTIGATE ${JSON.stringify({
    path: CHECK_FILE,
    find: "  return a - b;",
    replace: "  return a + b;",
    defect: "add subtracts instead of adding",
  })}`;
  const reviewText = `DELEGATION_REVIEW ${JSON.stringify({
    verdict: "reject",
    path: CHECK_FILE,
    find: "  return a - b;",
    replace: "  return a + b;",
    reason: "the defect is in the caller, not this line",
  })}`;
  const investigation = parseInvestigation(investigationText);
  const review = parseReview(reviewText);
  requireTrue(investigation !== null, "the investigator payload did not parse");
  requireTrue(review !== null && review.verdict === "reject", "the rejecting review did not parse as reject");

  const synthesis = synthesizeDelegation(investigation, review);
  requireTrue(synthesis.accepted === false, "synthesis accepted a rejecting review");
  requireTrue(
    synthesis.contradiction?.kind === "reviewer_rejected",
    `contradiction is ${synthesis.contradiction?.kind}, want reviewer_rejected`,
  );
  requireTrue(
    String(synthesis.contradiction?.detail ?? "").includes("the defect is in the caller"),
    "the reviewer's reason was not recorded in the contradiction",
  );
  const afterHash = sha256File(target);
  requireTrue(afterHash === beforeHash, "the synthesis path modified the target file");
  const parentOutcome = synthesis.accepted ? "completed" : "blocked_contradiction";
  requireTrue(parentOutcome === "blocked_contradiction", `parent outcome is ${parentOutcome}`);
  return `synthesis=refused/${synthesis.contradiction?.kind} parent=${parentOutcome} fileUnchanged=true note=synthesis-driven-no-live-model-call`;
}

async function controlMissingCatalogue() {
  const workspace = requireFixture();
  const evidenceRoot = path.join(workspace.root, "evidence-control-9");
  const noneGate = evaluateOrdinaryCompletion({
    taskId: "delegation-negatives-missing-catalogue",
    catalogue: { status: "none", reason: "no approved verification checks apply" },
    evidenceRoot,
    workspaceDir: workspace.workspace,
    epoch: 0,
  });
  requireTrue(noneGate.verification !== "verified", `no-catalogue gate returned ${noneGate.verification}`);
  requireTrue(noneGate.verification === "unverified", `no-catalogue gate returned ${noneGate.verification}`);
  const pendingGate = evaluateOrdinaryCompletion({
    taskId: "delegation-negatives-missing-catalogue",
    catalogue: {
      status: "approval_required",
      pending: [CHECK_ID],
      reason: "candidate checks exist but none is approved",
    },
    evidenceRoot,
    workspaceDir: workspace.workspace,
    epoch: 0,
  });
  requireTrue(pendingGate.verification === "unverified", `unapproved-catalogue gate returned ${pendingGate.verification}`);
  return `catalogue=none->${noneGate.verification} approval_required->${pendingGate.verification}`;
}

const CONTROLS = [
  {
    name: "child-failure",
    expected: "no verified claim; run failed with review failed and verify skipped",
    run: controlChildFailure,
  },
  {
    name: "child-timeout",
    expected: "typed deadline_unavailable_at_manager_seam failure, never completed or verified",
    run: controlChildTimeout,
  },
  {
    name: "parent-cancellation",
    expected: "run cancelled, no verdict, no child still running",
    run: controlParentCancellation,
  },
  {
    name: "duplicate-dispatch",
    expected: "same role/assignment reuses one run and one child task id per node",
    run: controlDuplicateDispatch,
  },
  {
    name: "duplicate-result-delivery",
    expected: "one outcome for the node and duplicatesIgnored=1",
    run: controlDuplicateResultDelivery,
  },
  {
    name: "stale-epoch",
    expected: "an older-epoch record is blocked as stale and cannot verify",
    run: controlStaleEpoch,
  },
  {
    name: "malformed-child-output",
    expected: "empty output is unusable; garbage is refused by synthesis",
    run: controlMalformedChildOutput,
  },
  {
    name: "conflicting-recommendations",
    expected: "rejecting review refuses synthesis, parent blocked, no edit applied",
    run: controlConflictingRecommendations,
  },
  {
    name: "missing-catalogue",
    expected: "no approved checks returns unverified, never verified",
    run: controlMissingCatalogue,
  },
];

// ---------------------------------------------------------------------------
// Matrix run.
// ---------------------------------------------------------------------------
const evidence = {
  generatedAt: new Date().toISOString(),
  script: "scripts/qa/delegation-negatives.mjs",
  liveModelCalls: 0,
  controls: [],
  counts: { passed: 0, failed: 0, blocked: 0 },
  result: "FAIL",
};

function writeEvidence() {
  try {
    mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  } catch {
    // Evidence writing must never change the verdict.
  }
}

function cleanup() {
  if (fixture.root === null) return;
  try {
    rmSync(fixture.root, { recursive: true, force: true });
  } catch {
    // Best effort; a temp fixture never blocks the observation.
  }
}

let passed = 0;
let failed = 0;
let blocked = 0;

for (const control of CONTROLS) {
  try {
    const observed = await control.run();
    passed += 1;
    evidence.controls.push({
      name: control.name,
      expected: control.expected,
      observed,
      status: "PASS",
    });
    say(`[control] ${control.name} expected=${control.expected} observed=${observed} PASS`);
  } catch (error) {
    const reason = bounded(redactSensitive(errorMessage(error)), 900);
    if (error instanceof ControlFailure) {
      failed += 1;
      const location = locationOf(error);
      evidence.controls.push({
        name: control.name,
        expected: control.expected,
        observed: `FAIL ${reason}`,
        status: "FAIL",
        location,
      });
      say(`[control] ${control.name} expected=${control.expected} observed=${reason} FAIL at ${location}`);
    } else {
      blocked += 1;
      const location = error instanceof ControlBlocked && error.location !== undefined
        ? error.location
        : locationOf(error);
      evidence.controls.push({
        name: control.name,
        expected: control.expected,
        observed: `BLOCKED ${reason}`,
        status: "BLOCKED",
        location,
      });
      say(`[control] ${control.name} expected=${control.expected} observed=BLOCKED ${reason} at ${location} BLOCKED`);
    }
  }
}

evidence.counts = { passed, failed, blocked };
evidence.result = failed === 0 && blocked === 0 ? "PASS" : "FAIL";
writeEvidence();

say(
  `RESULT: ${evidence.result} (${passed} passed, ${failed} failed, ${blocked} blocked; ${CONTROLS.length} controls; 0 live model calls; evidence ${EVIDENCE_RELATIVE.replace(/\\/g, "/")})`,
);
flushOutput();
cleanup();
process.exit(evidence.result === "PASS" ? 0 : 1);
