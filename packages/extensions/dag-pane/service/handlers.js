// DAG pane local service handlers (project-ide todo 13).
//
// The panel iframe stays sandboxed: every privileged step runs here, in the
// host-spawned service process, behind the host's loopback proxy. These
// handlers wrap the adapter-A bridge from todo 6
// (`packages/web/server/lib/opencode/omo-bridge-runtime.js`): probe for
// engine presence, steer by invoking a run attached to the live session,
// cancel through the bridge's provisional kill-with-reason, and read the
// snapshot files the bridge writer produces.
//
// `service/main.js` maps HTTP onto `handleRequest`; the unit tests call it
// directly with a stub bridge, so no server or engine is needed to prove
// the steer/cancel wiring.
import { tmpdir as osTmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import nodeFs from 'node:fs';

import {
  createOmoBridgeRuntime,
  defaultSnapshotPath,
} from '../../../web/server/lib/opencode/omo-bridge-runtime.js';

export const DAG_SERVICE_NAME = 'openchamber-builtin-dag-pane';
export const DAG_SERVICE_DEFAULT_SNAPSHOT_PREFIX = 'omo-dag-snapshots';
export const DAG_SERVICE_MAX_BODY_BYTES = 1_000_000;

// Flow-trace debugger (dag-diagnostics): the composer route decision the UI
// last reported plus per-stage engine-side evidence, all machine values.
export const DAG_DEBUG_ROUTE_DECISIONS = ['captured-to-/ulw', 'plain-prompt', 'shell', 'slash-command'];
export const DAG_DEBUG_SAMPLE_MAX = 60;
export const DAG_DEBUG_MESSAGE_MAX = 140;
export const DAG_DEBUG_MAX_LEDGER_BYTES = 1_048_576;
// Mirrors ULTRAWORK_CURRENT_PROMPT_PATTERN in
// packages/omo-engine/omo-codex/plugin/components/ulw-loop/src/ultrawork-directive.ts.
// The service ships plain JS, so the literal is duplicated, not imported.
export const DAG_DEBUG_HOOK_PATTERN = '(?:ultrawork|ulw)';

export const defaultServiceSnapshotDir = (tmpdir = osTmpdir, join = joinPath) => (
  join(tmpdir(), DAG_SERVICE_DEFAULT_SNAPSHOT_PREFIX)
);

const isNonEmptyString = (value) => (value?.trim?.() ?? '').length > 0;

// String-valued field read without a typeof test: non-strings degrade to
// ''. Callers treat '' as absent, so untrusted shapes fail closed.
const asString = (value) => value?.trim?.() ?? '';

// Plain-record test without a typeof test: only a real object passes, and
// arrays never do (mirrors the panel parser's isWireRecord idiom).
const isRecord = (value) => Object(value) === value && !Array.isArray(value);

const DAG_LOOP_RUNS_MAX = 50;
const DAG_LOOP_PLAN_MAX_BYTES = 262_144;

const isSafeSessionId = (value) => {
  const text = asString(value);
  return text.length > 0 && !/[\\/]/.test(text) && !text.includes('..');
};

// Durable chat-run storage: project-scoped `.omo/dag-runs/` instead of the
// OS-temp snapshot dir, so a conversation's runs survive Electron, Vite, and
// backend restarts. One mutable live file per parent conversation plus capped
// immutable terminal records per conversation (explicit retention: newest 20).
const DAG_RUNS_DIRNAME = 'dag-runs';
const DAG_RUN_HISTORY_DIRNAME = 'history';
const DAG_RUN_HISTORY_MAX = 20;

const isSafeDirectory = (value) => {
  const text = asString(value);
  if (text.length === 0) return false;
  if (text.split(/[\\/]+/).includes('..')) return false;
  return text.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(text) || text.startsWith('\\\\');
};

const projectRunsDir = (directory) => (
  `${directory.trim().replace(/[/\\]+$/, '')}/.omo/${DAG_RUNS_DIRNAME}`
);

const projectLiveRunPath = (directory, sessionId) => (
  `${projectRunsDir(directory)}/${sessionId}.snapshot.json`
);

const projectRunHistoryDir = (directory, sessionId) => (
  `${projectRunsDir(directory)}/${DAG_RUN_HISTORY_DIRNAME}/${sessionId}`
);

// Posted-doc validation mirrors the panel parser (panel/dag-view.ts): schema
// version, string session id, and a first run record with its required
// strings. An empty run list is a rejection, never a write: a valid
// persisted run must never be replaced by an empty snapshot.
const readPostedRunDoc = (doc) => {
  if (!isRecord(doc)) return null;
  if (doc.schemaVersion !== 1) return null;
  const sessionId = asString(doc.sessionId);
  if (!isSafeSessionId(sessionId)) return null;
  const dag = isRecord(doc.dag) ? doc.dag : null;
  if (!dag || !Array.isArray(dag.runs) || dag.runs.length === 0) return null;
  const run = isRecord(dag.runs[0]) ? dag.runs[0] : null;
  if (!run) return null;
  if (!isNonEmptyString(run.run_id) || !isNonEmptyString(run.run_key)
    || !isNonEmptyString(run.name) || !isNonEmptyString(run.status)) return null;
  return { sessionId, status: run.status.trim(), updatedAt: asString(doc.updatedAt) || null };
};

const writeFileAtomic = (fs, path, text) => {
  fs.mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  fs.writeFileSync(temporaryPath, text, 'utf8');
  fs.renameSync(temporaryPath, path);
};

const readFileOrNull = (fs, path) => {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const updatedAtMs = (updatedAt, now) => {
  const parsed = Date.parse(updatedAt ?? '');
  return Number.isFinite(parsed) ? parsed : now();
};

const existsFile = (fs, path) => {
  try {
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
};

// Engine-side loop evidence for GET /debug: which state files exist under
// .omo/ulw-loop/<session> plus the ledger event count. Never throws: every
// read degrades to a false/zero value the pane renders as-is.
const readLoopState = (fs, directory, sessionId) => {
  if (!isNonEmptyString(directory)) {
    return { dir: null, plan: false, goals: false, ledger: false, events: 0 };
  }
  const root = directory.trim().replace(/[/\\]+$/, '');
  const dir = `${root}/.omo/ulw-loop/${sessionId}`;
  const plan = existsFile(fs, `${dir}/plan.json`);
  const goals = existsFile(fs, `${dir}/goals.json`);
  const ledgerPath = `${dir}/ledger.jsonl`;
  const ledger = existsFile(fs, ledgerPath);
  let events = 0;
  if (ledger) {
    try {
      const text = fs.readFileSync(ledgerPath, 'utf8').slice(0, DAG_DEBUG_MAX_LEDGER_BYTES);
      events = text.split('\n').filter((line) => line.trim().length > 0).length;
    } catch {
      events = 0;
    }
  }
  return { dir, plan, goals, ledger, events };
};

// Bridge-snapshot evidence for GET /debug: file presence, mtime, and
// whether the stored session matches the requested one. Never throws.
const readSnapshotState = (fs, snapshotPathFor, sessionId) => {
  let snapshotPath;
  try {
    snapshotPath = snapshotPathFor(sessionId);
  } catch {
    return { path: null, exists: false, updatedAt: null, sessionMatch: false };
  }
  let mtime = null;
  try {
    mtime = fs.statSync(snapshotPath).mtime;
  } catch {
    return { path: snapshotPath, exists: false, updatedAt: null, sessionMatch: false };
  }
  let sessionMatch = false;
  try {
    sessionMatch = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))?.sessionId === sessionId;
  } catch {
    sessionMatch = false;
  }
  let updatedAt = null;
  try {
    updatedAt = mtime instanceof Date ? mtime.toISOString() : new Date(mtime).toISOString();
  } catch {
    updatedAt = null;
  }
  return { path: snapshotPath, exists: true, updatedAt, sessionMatch };};

const snapshotSessions = (fs, snapshotDir) => {
  let entries;
  try {
    entries = fs.readdirSync(snapshotDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.snapshot.json'))
    .map((name) => name.slice(0, -'.snapshot.json'.length))
    .sort();
};

const mtimeOf = (fs, path) => {
  try {
    const mtime = fs.statSync(path).mtime;
    return mtime instanceof Date ? mtime.toISOString() : new Date(mtime).toISOString();
  } catch {
    return null;
  }
};

const listLoopSessionIds = (fs, directory) => {
  if (!isNonEmptyString(directory)) return [];
  const root = directory.trim().replace(/[/\\]+$/, '');
  let entries;
  try {
    entries = fs.readdirSync(`${root}/.omo/ulw-loop`, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      try {
        return entry.isDirectory() && isSafeSessionId(entry.name);
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort()
    .slice(0, DAG_LOOP_RUNS_MAX);
};

const readLoopPlan = (fs, directory, sessionId) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  const planPath = `${root}/.omo/ulw-loop/${sessionId}/plan.json`;
  let stat;
  try {
    stat = fs.statSync(planPath);
  } catch {
    return null;
  }
  try {
    if (!stat.isFile() || stat.size > DAG_LOOP_PLAN_MAX_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    if (!isRecord(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const readLoopEventNames = (fs, directory, sessionId) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  const ledgerPath = `${root}/.omo/ulw-loop/${sessionId}/ledger.jsonl`;
  let text;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8').slice(0, DAG_DEBUG_MAX_LEDGER_BYTES);
  } catch {
    return [];
  }
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  return lines.slice(-50).map((line, index) => {
    const marker = `entry-${index + 1}`;
    try {
      const parsed = JSON.parse(line);
      // Host-driver ledgers name the event in `.event`; CLI ledgers use
      // `.kind` (plan_created, evidence_captured, ...). Either names the row;
      // lines with neither stay markers so they never pass as real runs.
      const name = parsed?.event?.trim?.() || parsed?.kind?.trim?.() || '';
      return name.length > 0 ? name.slice(0, 64) : marker;
    } catch {
      return marker;
    }
  });
};

// CLI ledger vocabulary (constants.ts ULW_LOOP_LEDGER_EVENT_KINDS): ledgers
// speak `kind` (plan_created, evidence_captured, goal_started, ...) while the
// host driver speaks `event` (started, advanced, ...). Both name real
// progress; anything unrecognized stays pending so the pane never invents
// motion.
const loopNodeStateForEvent = (event) => {
  if (event === 'completed' || event === 'goal_completed' || event === 'aggregate_completed' || event === 'batch_closed' || event === 'child_completed') return 'completed';
  if (event === 'failed' || event === 'error' || event === 'goal_failed' || event === 'final_review_failed' || event === 'criterion_failed' || event === 'child_failed') return 'failed';
  if (event === 'started' || event === 'advanced' || event === 'resumed' || event === 'goal_started' || event === 'goal_resumed' || event === 'goal_retried' || event === 'goal_dispatched' || event === 'plan_created' || event === 'evidence_captured' || event === 'goal_added' || event === 'steering_accepted' || event === 'batch_updated' || event === 'criteria_revised') return 'running';
  return 'pending';
};

// Goal states (domain-types.ts UlwLoopItem.status) onto pane states.
// Blocked-ish states (blocked, review_blocked, needs_user_decision,
// superseded) stay pending: they need attention, not a terminal verdict the
// loop itself has not recorded.
const loopNodeStateForGoal = (status) => {
  if (status === 'complete') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'in_progress') return 'running';
  return 'pending';
};

// Real delegation graph source: goals.json holds the UlwLoopPlan (goals
// array with id/title/objective/status). plan.json is the host-driver plan
// and carries no goals; it is only a fallback shape check.
const readLoopGoalsPlan = (fs, directory, sessionId) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  for (const name of ['goals.json', 'plan.json']) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(`${root}/.omo/ulw-loop/${sessionId}/${name}`, 'utf8'));
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.goals)) continue;
    return parsed;
  }
  return null;
};

const projectLoopSnapshot = (fs, directory, sessionId, isLiveRun = false) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  const dir = `${root}/.omo/ulw-loop/${sessionId}`;
  const plan = readLoopPlan(fs, directory, sessionId);
  const state = readLoopState(fs, directory, sessionId);
  if (!state.plan && !state.goals && !state.ledger && plan === null) return null;
  const events = readLoopEventNames(fs, directory, sessionId);
  // Placeholder rows are honest only for a live run or real events: a dead
  // session whose ledger has no event names must not paint entry-N markers.
  const hasRealEvents = events.some((event) => !event.startsWith('entry-'));
  if (!hasRealEvents && !isLiveRun) return null;
  const planComplete = plan?.status === 'complete';
  const completedEvent = events.includes('completed') || events.includes('goal_completed') || events.includes('aggregate_completed') || events.includes('batch_closed') || events.includes('child_completed');
  const failedEvent = events.includes('failed') || events.includes('error') || events.includes('goal_failed') || events.includes('final_review_failed') || events.includes('criterion_failed') || events.includes('child_failed');
  const status = planComplete || completedEvent
    ? 'completed'
    : failedEvent
      ? 'failed'
      : events.length > 0 || state.plan || state.goals
        ? 'running'
        : 'pending';
  const goalsPlanForTitle = readLoopGoalsPlan(fs, directory, sessionId);
  const goalsBriefTitle = Array.isArray(goalsPlanForTitle?.goals) ? asString(goalsPlanForTitle.brief).split('\n')[0] : '';
  const title = (asString(plan?.title) || asString(plan?.goal).split('\n')[0] || goalsBriefTitle || sessionId).slice(0, 120);
  // Orca-like delegation graph from real loop state: when goals.json names
  // actual goals, project parent -> goal children (parallel wave) ->
  // synthesis (fan-in), the same shape the orca run renders. Every node
  // comes from the plan/ledger; nothing is synthesized.
  const goalsPlan = readLoopGoalsPlan(fs, directory, sessionId);
  const goalRecords = Array.isArray(goalsPlan?.goals) ? goalsPlan.goals.filter(isRecord) : [];
  if (goalRecords.length > 0) {
    const childNodes = goalRecords.map((goal, index) => {
      const id = asString(goal.id) || `goal-${index + 1}`;
      const label = (asString(goal.title) || id).slice(0, 80);
      return {
        id,
        label,
        state: loopNodeStateForGoal(asString(goal.status)),
        attempt: Number.isInteger(goal.attempt) && goal.attempt > 0 ? goal.attempt : 1,
        prompt: (asString(goal.objective) || label).slice(0, 512),
        depends_on: ['parent'],
        started_at: asString(goal.startedAt) || null,
        completed_at: asString(goal.completedAt) || null,
      };
    });
    const aggregateDone = isRecord(goalsPlan?.aggregateCompletion) && goalsPlan.aggregateCompletion.status === 'complete';
    const allChildrenComplete = childNodes.every((node) => node.state === 'completed');
    const anyChildFailed = childNodes.some((node) => node.state === 'failed');
    const anyChildRunning = childNodes.some((node) => node.state === 'running');
    const synthesisState = (aggregateDone || allChildrenComplete)
      ? 'completed'
      : anyChildFailed
        ? 'failed'
        : (anyChildRunning || planComplete || completedEvent)
          ? 'running'
          : 'pending';
    const graphStatus = synthesisState === 'completed'
      ? 'completed'
      : synthesisState === 'failed'
        ? 'failed'
        : (anyChildRunning || anyChildFailed || events.length > 0 || state.plan || state.goals)
          ? 'running'
          : 'pending';
    const parentNode = {
      id: 'parent',
      label: title,
      state: graphStatus === 'completed' ? 'completed' : graphStatus === 'failed' ? 'failed' : graphStatus === 'running' ? 'running' : 'pending',
      attempt: 1,
      prompt: title,
      depends_on: [],
      started_at: null,
      completed_at: null,
    };
    const synthesisNode = {
      id: 'synthesis',
      label: 'Synthesis',
      state: synthesisState,
      attempt: 1,
      prompt: 'Synthesis waits for all goal children and reflects their real results.',
      depends_on: childNodes.map((node) => node.id),
      started_at: null,
      completed_at: null,
    };
    const graphNodes = [parentNode, ...childNodes, synthesisNode];
    const graphEdges = [
      ...childNodes.map((node) => ({ from: 'parent', to: node.id })),
      ...childNodes.map((node) => ({ from: node.id, to: 'synthesis' })),
    ];
    const graphCounts = { pending: 0, running: 0, completed: 0 };
    for (const node of graphNodes) {
      if (node.state === 'completed') graphCounts.completed += 1;
      else if (node.state === 'running') graphCounts.running += 1;
      else graphCounts.pending += 1;
    }
    const graphUpdatedAt = mtimeOf(fs, `${dir}/ledger.jsonl`)
      ?? mtimeOf(fs, `${dir}/goals.json`)
      ?? mtimeOf(fs, `${dir}/plan.json`)
      ?? new Date().toISOString();
    return {
      schemaVersion: 1,
      sessionId,
      updatedAt: graphUpdatedAt,
      dag: {
        runs: [{
          run_id: sessionId,
          run_key: `loop:${sessionId}`,
          name: title,
          status: graphStatus,
          counts: graphCounts,
          nodes: graphNodes,
          edges: graphEdges,
          waves: [{ index: 0, node_ids: ['parent'] }, { index: 1, node_ids: childNodes.map((node) => node.id) }, { index: 2, node_ids: ['synthesis'] }],
        }],
      },
      tasks: null,
    };
  }
  const nodes = events.length > 0
    ? events.map((event, index) => ({
      id: `step-${index + 1}`,
      label: event,
      state: loopNodeStateForEvent(event),
      attempt: 1,
      prompt: event,
      depends_on: index === 0 ? [] : [`step-${index}`],
      started_at: null,
      completed_at: null,
    }))
    : [{
      id: 'step-1',
      label: title,
      state: status === 'completed' ? 'completed' : 'pending',
      attempt: 1,
      prompt: title,
      depends_on: [],
      started_at: null,
      completed_at: null,
    }];
  const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id }));
  const counts = { pending: 0, running: 0, completed: 0 };
  for (const node of nodes) {
    if (node.state === 'completed') counts.completed += 1;
    else if (node.state === 'running') counts.running += 1;
    else counts.pending += 1;
  }
  const updatedAt = mtimeOf(fs, `${dir}/ledger.jsonl`)
    ?? mtimeOf(fs, `${dir}/plan.json`)
    ?? mtimeOf(fs, `${dir}/goals.json`)
    ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    sessionId,
    updatedAt,
    dag: {
      runs: [{
        run_id: sessionId,
        run_key: `loop:${sessionId}`,
        name: title,
        status,
        counts,
        nodes,
        edges,
        waves: [{ index: 0, node_ids: nodes.map((node) => node.id) }],
      }],
    },
    tasks: null,
  };
};

export const createDagServiceHandlers = (dependencies = {}) => {
  const {
    fs = nodeFs,
    snapshotDir = defaultServiceSnapshotDir(),
    now = Date.now,
    createBridge = (entry) => createOmoBridgeRuntime({
      fs,
      snapshotDir,
      resolveEngineEntry: () => entry ?? process.env.OMO_WRAPPER_PATH ?? null,
    }),
  } = dependencies;

  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
  } catch {
    // Reads degrade to NOT_FOUND and steer reports the write failure; a
    // missing directory must never crash the service process.
  }

  // sessionId -> { cancel, startedAt }: runs this service started that have
  // not reported their child closing yet. Cancel targets the latest steer
  // per session; a closed child removes its own entry.
  const live = new Map();

  // Latest composer route decision reported via POST /debug/route, merged
  // per report: { decision, sample, command, arguments, sessionId, at }.
  // Bounded by construction (one record); a service restart clears it.
  let lastRoute = null;

  // Per-session route registry feeding the /status loop-run listing: a bare
  // `ulw` send reports `captured-to-/ulw` before any loop state or snapshot
  // exists, so the pane can row that session within one refresh. Bounded
  // (50 sessions, oldest-inserted evicted); restart clears it, like `live`.
  const routeBySession = new Map();
  const recordRouteBySession = (report) => {
    const id = asString(report?.sessionId);
    if (!isSafeSessionId(id)) return;
    if (!routeBySession.has(id) && routeBySession.size >= DAG_LOOP_RUNS_MAX) {
      routeBySession.delete(routeBySession.keys().next().value);
    }
    routeBySession.delete(id);
    routeBySession.set(id, report);
  };

  // Read-only merge for GET /status: snapshot sessions keep their ids;
  // loopRuns adds sessions with loop state and/or a captured-to-/ulw route
  // report. Snapshot data always wins in the panel; this list never writes.
  const loopRunsForStatus = (directory) => {
    const seen = new Set();
    const runs = [];
    for (const sessionId of listLoopSessionIds(fs, directory)) {
      seen.add(sessionId);
      const state = readLoopState(fs, directory, sessionId);
      const route = routeBySession.get(sessionId) ?? null;
      runs.push({
        sessionId,
        source: 'loop',
        decision: asString(route?.decision) || null,
        plan: state.plan,
        goals: state.goals,
        ledger: state.ledger,
        events: state.events,
        updatedAt: mtimeOf(fs, `${directory.trim().replace(/[/\\]+$/, '')}/.omo/ulw-loop/${sessionId}/ledger.jsonl`),
      });    }
    for (const [sessionId, route] of routeBySession) {
      if (seen.has(sessionId)) continue;
      if (route?.decision !== 'captured-to-/ulw') continue;
      seen.add(sessionId);
      runs.push({
        sessionId,
        source: 'route',
        decision: route.decision,
        plan: false,
        goals: false,
        ledger: false,
        events: 0,
        updatedAt: asString(route?.at) || null,
      });
    }
    return runs.slice(0, DAG_LOOP_RUNS_MAX);
  };

  // Read-only History for GET /history: completed snapshots plus terminal
  // loop rows, newest first. Malformed snapshots are skipped (counted),
  // live/pending runs stay in the live view and never appear here. When a
  // directory filter is given, snapshot docs recorded for another
  // directory stay out; docs without a directory predate the filter and
  // show only unfiltered. Never writes.
  const historyFor = (directory) => {
    const trimmedDirectory = isNonEmptyString(directory) ? directory.trim() : null;
    const entries = [];
    let skipped = 0;
    const withMtime = [];
    for (const sessionId of snapshotSessions(fs, snapshotDir)) {
      const path = snapshotPathFor(sessionId);
      withMtime.push({ sessionId, path, mtime: mtimeOf(fs, path) });
    }
    withMtime.sort((a, b) => String(b.mtime ?? '').localeCompare(String(a.mtime ?? '')));
    for (const { sessionId, path } of withMtime.slice(0, DAG_LOOP_RUNS_MAX)) {
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(path, 'utf8'));
      } catch {
        skipped += 1;
        continue;
      }
      const runs = Array.isArray(doc?.dag?.runs) ? doc.dag.runs : [];
      const run = runs[0] ?? null;
      if (!isRecord(run)) {
        skipped += 1;
        continue;
      }
      const status = asString(run.status);
      if (status !== 'completed' && status !== 'failed') continue;
      const docDirectory = asString(doc?.directory);
      if (trimmedDirectory !== null && docDirectory !== null && docDirectory !== trimmedDirectory) continue;
      if (trimmedDirectory !== null && docDirectory === null) continue;
      entries.push({
        sessionId,
        source: 'snapshot',
        label: (asString(run.name) || sessionId).slice(0, 80),
        status,
        updatedAt: asString(doc?.updatedAt) || mtimeOf(fs, path),
      });
    }
    if (trimmedDirectory !== null) {
      // Terminal loop rows reuse the exact projection the live view
      // renders, so History never disagrees with it.
      for (const sessionId of listLoopSessionIds(fs, trimmedDirectory)) {
        const projected = projectLoopSnapshot(fs, trimmedDirectory, sessionId, false);
        const run = projected?.dag?.runs?.[0] ?? null;
        if (!isRecord(run)) continue;
        const status = asString(run.status);
        if (status !== 'completed' && status !== 'failed') continue;
        entries.push({
          sessionId,
          source: 'loop',
          label: (asString(run.name) || sessionId).slice(0, 80),
          status,
          updatedAt: asString(projected.updatedAt) || null,
        });
      }
    }
    if (trimmedDirectory !== null) {
      const seen = new Set(entries.map((entry) => `${entry.sessionId} ${entry.updatedAt ?? ''} ${entry.status}`));
      for (const projectEntry of projectHistoryFor(trimmedDirectory)) {
        const key = `${projectEntry.sessionId} ${projectEntry.updatedAt ?? ''} ${projectEntry.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(projectEntry);
      }
    }
    entries.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    return { entries: entries.slice(0, DAG_LOOP_RUNS_MAX), skipped };
  };

  const bridgeError = (error, fallbackCode) => {
    const code = error?.code ?? fallbackCode;
    if (code === 'OMO_ENGINE_ABSENT') {
      return { status: 503, body: { ok: false, code, message: error.message } };
    }
    if (code === 'OMO_INVOKE_ARGS_INVALID' || code === 'OMO_SESSION_ID_INVALID' || code === 'OMO_SNAPSHOT_DIR_INVALID') {
      return { status: 400, body: { ok: false, code, message: error.message } };
    }
    if (code === 'OMO_PROVIDER_NOT_SIGNED_IN') {
      return { status: 409, body: { ok: false, code, message: error.message } };
    }
    return { status: 500, body: { ok: false, code, message: error?.message ?? 'The DAG service failed.' } };
  };

  const snapshotPathFor = (sessionId) => defaultSnapshotPath(snapshotDir, sessionId);

  const readSnapshot = (sessionId, directory) => {
    let snapshotPath;
    try {
      snapshotPath = snapshotPathFor(sessionId);
    } catch (error) {
      return { status: 400, body: { ok: false, code: error.code ?? 'OMO_SESSION_ID_INVALID', message: error.message } };
    }
    let text;
    try {
      text = fs.readFileSync(snapshotPath, 'utf8');
    } catch {
      text = null;
    }
    // Temp-dir file first (existing steer/loop behavior unchanged); then the
    // project-scoped live file when the caller names its directory.
    if (text === null && isSafeDirectory(directory ?? '')) {
      text = readFileOrNull(fs, projectLiveRunPath(directory, sessionId));
      if (text !== null) snapshotPath = projectLiveRunPath(directory, sessionId);
    }
    if (text === null) {
      return { status: 404, body: { ok: false, code: 'OMO_DAG_SNAPSHOT_MISSING', sessionId } };
    }
    try {
      return { status: 200, body: JSON.parse(text) };
    } catch {
      return { status: 422, body: { ok: false, code: 'DAG_SNAPSHOT_MALFORMED', field: 'snapshot', sessionId } };
    }
  };

  // Project-scoped History for GET /history with a directory filter: the live
  // file plus immutable terminal records for that directory only. Without a
  // directory filter there is no project scope to list, so only the temp-dir
  // sources above apply. Entries stay display-only; the live view never binds
  // them. Never writes.
  const projectHistoryFor = (directory) => {
    const entries = [];
    const runsDir = projectRunsDir(directory);
    let names;
    try {
      names = fs.readdirSync(runsDir);
    } catch {
      return entries;
    }
    const seen = new Set();
    for (const name of names) {
      if (!name.endsWith('.snapshot.json')) continue;
      const sessionId = name.slice(0, -'.snapshot.json'.length);
      if (!isSafeSessionId(sessionId)) continue;
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(`${runsDir}/${name}`, 'utf8'));
      } catch {
        continue;
      }
      const parsed = readPostedRunDoc(doc);
      if (!parsed || (parsed.status !== 'completed' && parsed.status !== 'failed')) continue;
      const key = `${sessionId} ${parsed.updatedAt ?? ''} ${parsed.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        sessionId,
        source: 'project',
        label: (asString(doc?.dag?.runs?.[0]?.name) || sessionId).slice(0, 80),
        status: parsed.status,
        updatedAt: parsed.updatedAt,
      });
    }
    let sessionDirs;
    try {
      sessionDirs = fs.readdirSync(`${runsDir}/${DAG_RUN_HISTORY_DIRNAME}`, { withFileTypes: true });
    } catch {
      return entries;
    }
    for (const entry of sessionDirs) {
      let sessionId;
      try {
        if (!entry.isDirectory() || !isSafeSessionId(entry.name)) continue;
        sessionId = entry.name;
      } catch {
        continue;
      }
      let records;
      try {
        records = fs.readdirSync(`${runsDir}/${DAG_RUN_HISTORY_DIRNAME}/${sessionId}`);
      } catch {
        continue;
      }
      for (const record of records) {
        if (!/^\d+\.json$/.test(record)) continue;
        let doc;
        try {
          doc = JSON.parse(fs.readFileSync(`${runsDir}/${DAG_RUN_HISTORY_DIRNAME}/${sessionId}/${record}`, 'utf8'));
        } catch {
          continue;
        }
        const parsed = readPostedRunDoc(doc);
        if (!parsed || (parsed.status !== 'completed' && parsed.status !== 'failed')) continue;
        const key = `${sessionId} ${parsed.updatedAt ?? ''} ${parsed.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          sessionId,
          source: 'project-history',
          label: (asString(doc?.dag?.runs?.[0]?.name) || sessionId).slice(0, 80),
          status: parsed.status,
          updatedAt: parsed.updatedAt,
        });
      }
    }
    return entries;
  };

  const handleRequest = async ({ method, path, query = {}, body = {} } = {}) => {
    if (method === 'GET' && path === '/health') {
      return { status: 200, body: { ok: true, service: DAG_SERVICE_NAME } };
    }
    if (method === 'GET' && path === '/status') {
      const entry = isNonEmptyString(query?.entry) ? query.entry.trim() : undefined;
      const bridge = createBridge(entry);
      const probe = await bridge.probe({ includeToolkit: true });
      return {
        status: 200,
        body: {
          ok: true,
          probe,
          sessions: snapshotSessions(fs, snapshotDir),
          loopRuns: loopRunsForStatus(isNonEmptyString(query?.directory) ? query.directory : ''),
          // Live steers this service started and still tracks: engine runs
          // emit no snapshot events, so without this list a running steer
          // is invisible to the pane until (and unless) state lands.
          liveRuns: [...live.entries()].map(([liveSessionId, record]) => ({
            sessionId: liveSessionId,
            startedAt: record?.startedAt ?? null,
          })),
          snapshotDir,
          now: new Date(now()).toISOString(),
        },
      };
    }
    if (method === 'POST' && path === '/debug/route') {
      const decision = body?.decision;
      if (!DAG_DEBUG_ROUTE_DECISIONS.includes(decision)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_ROUTE_INVALID', message: 'Route reports one decision: captured-to-/ulw, plain-prompt, shell, or slash-command.' } };
      }
      const sample = typeof body?.sample === 'string' ? body.sample.slice(0, DAG_DEBUG_SAMPLE_MAX) : '';
      const command = isNonEmptyString(body?.command) ? body.command.trim().slice(0, 128) : null;
      const args = typeof body?.arguments === 'string' ? body.arguments.slice(0, 512) : null;
      const routeSessionId = isNonEmptyString(body?.sessionId) ? body.sessionId.trim() : null;
      lastRoute = {
        decision,
        sample,
        command,
        arguments: args,
        sessionId: routeSessionId,
        at: new Date(now()).toISOString(),
      };
      recordRouteBySession(lastRoute);
      return { status: 200, body: { ok: true, route: lastRoute } };
    }
    if (method === 'GET' && path === '/debug') {
      const sessionId = query?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass ?sessionId=<run session>.' } };
      }
      const trimmedSession = sessionId.trim();
      if (trimmedSession.includes('/') || trimmedSession.includes('\\') || trimmedSession.includes('..')) {
        return { status: 400, body: { ok: false, code: 'OMO_SESSION_ID_INVALID', message: 'Session ids stay inside one directory.' } };
      }
      const hookSample = lastRoute?.sample
        ?? (typeof query?.sample === 'string' ? query.sample.slice(0, DAG_DEBUG_SAMPLE_MAX) : '');
      let hookHit = false;
      try {
        hookHit = new RegExp(DAG_DEBUG_HOOK_PATTERN, 'i').test(hookSample);
      } catch {
        hookHit = false;
      }
      const loop = readLoopState(fs, query?.directory, trimmedSession);
      const snapshot = readSnapshotState(fs, snapshotPathFor, trimmedSession);
      let probe;
      try {
        const entry = isNonEmptyString(query?.entry) ? query.entry.trim() : undefined;
        probe = await createBridge(entry).probe({ includeToolkit: true });
      } catch (error) {
        probe = { available: false, compatible: false, code: 'OMO_DEBUG_PROBE_THROW', message: String(error?.message ?? error).slice(0, DAG_DEBUG_MESSAGE_MAX) };
      }
      const probeRecord = probe !== null && typeof probe === 'object' ? probe : {};
      return {
        status: 200,
        body: {
          ok: true,
          route: lastRoute,
          hook: { pattern: DAG_DEBUG_HOOK_PATTERN, hit: hookHit, sample: hookSample },
          loop,
          snapshot,
          probe: {
            code: typeof probeRecord.code === 'string' ? probeRecord.code : null,
            available: probeRecord.available === true,
            compatible: probeRecord.compatible === true,
            entry: typeof probeRecord.entry === 'string' || probeRecord.entry === null ? probeRecord.entry ?? null : null,
            message: typeof probeRecord.message === 'string' ? probeRecord.message.slice(0, DAG_DEBUG_MESSAGE_MAX) : null,
          },
          sessions: snapshotSessions(fs, snapshotDir),
          snapshotDir,
          now: new Date(now()).toISOString(),
        },
      };
    }
    if (method === 'GET' && path === '/loop') {
      const sessionId = query?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass ?sessionId=<run session>.' } };
      }
      const trimmedSession = sessionId.trim();
      if (!isSafeSessionId(trimmedSession)) {
        return { status: 400, body: { ok: false, code: 'OMO_SESSION_ID_INVALID', message: 'Session ids stay inside one directory.' } };
      }
      const directory = isNonEmptyString(query?.directory) ? query.directory : '';
      if (isNonEmptyString(directory)) {
        const projected = projectLoopSnapshot(fs, directory, trimmedSession, live.has(trimmedSession));
        if (projected !== null) {
          return { status: 200, body: projected };
        }
      }
      // Live-run fallback: a live run with no loop state yet still rows as
      // pending, so the run is visible within one refresh and upgrades as
      // state arrives. Liveness itself is the freshness evidence (the
      // service started this run and still tracks it); the route report
      // only refines the label when present. A dead session 404s like
      // missing state. Reads the registry only; writes nothing.
      const route = routeBySession.get(trimmedSession) ?? null;
      const liveLabel = live.get(trimmedSession)?.label;
      if (live.has(trimmedSession)) {
        return {
          status: 200,
          body: {
            schemaVersion: 1,
            sessionId: trimmedSession,
            updatedAt: asString(route?.at) || new Date(now()).toISOString(),
            dag: {
              runs: [{
                run_id: trimmedSession,
                run_key: `loop:${trimmedSession}`,
                name: trimmedSession,
                status: 'pending',
                counts: { pending: 1, running: 0, completed: 0 },
                nodes: [{
                  id: 'step-1',
                  label: (asString(route?.arguments) || asString(liveLabel) || trimmedSession).slice(0, 64),
                  state: 'pending',
                  attempt: 1,
                  prompt: asString(route?.sample) || asString(liveLabel) || trimmedSession,
                  depends_on: [],
                  started_at: null,
                  completed_at: null,
                }],
                edges: [],
                waves: [{ index: 0, node_ids: ['step-1'] }],
              }],
            },
            tasks: null,
          },
        };
      }
      return { status: 404, body: { ok: false, code: 'OMO_DAG_NO_LOOP', sessionId: trimmedSession } };
    }
    if (method === 'GET' && path === '/snapshot') {
      const sessionId = query?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass ?sessionId=<run session>.' } };
      }
      const directory = isNonEmptyString(query?.directory) ? query.directory.trim() : null;
      if (directory !== null && !isSafeDirectory(directory)) {
        return { status: 400, body: { ok: false, code: 'OMO_INVOKE_ARGS_INVALID', message: 'directory must be an absolute path without .. segments when given.' } };
      }
      return readSnapshot(sessionId.trim(), directory);
    }
    // Durable chat-run record: the host posts the run model it built from
    // engine session data, and the service persists it project-scoped. A run
    // belongs to exactly one parent conversation: conversationId must equal
    // the doc's sessionId, and empty-run docs are rejected so a valid
    // persisted run is never replaced by an empty snapshot.
    if (method === 'POST' && path === '/snapshot') {
      const directory = body?.directory;
      const conversationId = body?.conversationId;
      if (!isSafeDirectory(directory ?? '')) {
        return { status: 400, body: { ok: false, code: 'OMO_INVOKE_ARGS_INVALID', message: 'directory must be an absolute project path without .. segments.' } };
      }
      if (!isSafeSessionId(conversationId ?? '')) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass conversationId=<parent conversation>.' } };
      }
      const parsed = readPostedRunDoc(body?.snapshot);
      if (!parsed) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SNAPSHOT_INVALID', message: 'snapshot must carry schemaVersion 1, a sessionId, and a non-empty dag.runs record.' } };
      }
      if (parsed.sessionId !== asString(conversationId).trim()) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_CONVERSATION_MISMATCH', message: 'A run belongs to exactly one parent conversation.' } };
      }
      const livePath = projectLiveRunPath(directory, parsed.sessionId);
      const stamped = { ...body.snapshot, directory: directory.trim() };
      const serialized = `${JSON.stringify(stamped)}\n`;
      if (readFileOrNull(fs, livePath) === serialized) {
        return { status: 200, body: { ok: true, sessionId: parsed.sessionId, written: false, historyRecorded: false, reason: 'unchanged' } };
      }
      try {
        writeFileAtomic(fs, livePath, serialized);
      } catch (error) {
        return { status: 500, body: { ok: false, code: 'OMO_DAG_SNAPSHOT_WRITE_FAILED', message: String(error?.message ?? error).slice(0, 140) } };
      }
      let historyRecorded = false;
      if (parsed.status === 'completed' || parsed.status === 'failed') {
        const historyDir = projectRunHistoryDir(directory, parsed.sessionId);
        const recordPath = `${historyDir}/${updatedAtMs(parsed.updatedAt, now)}.json`;
        try {
          if (readFileOrNull(fs, recordPath) === null) {
            writeFileAtomic(fs, recordPath, serialized);
          }
          historyRecorded = true;
          const records = fs.readdirSync(historyDir).filter((name) => /^\d+\.json$/.test(name))
            .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
          for (const stale of records.slice(0, Math.max(0, records.length - DAG_RUN_HISTORY_MAX))) {
            try {
              fs.unlinkSync(`${historyDir}/${stale}`);
            } catch {
              // Retention stays best-effort; the record itself is durable.
            }
          }
        } catch {
          // A history-record failure must never fail the live write.
          historyRecorded = false;
        }
      }
      return { status: 200, body: { ok: true, sessionId: parsed.sessionId, written: true, historyRecorded } };
    }
    if (method === 'GET' && path === '/history') {
      const directory = isNonEmptyString(query?.directory) ? query.directory.trim() : null;
      return { status: 200, body: { ok: true, ...historyFor(directory) } };
    }
    if (method === 'POST' && path === '/steer') {
      const message = body?.message;
      const sessionId = body?.sessionId;
      const entry = isNonEmptyString(body?.entry) ? body.entry.trim() : undefined;
      if (!isNonEmptyString(message)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_MESSAGE_REQUIRED', message: 'Steering needs a non-empty message.' } };
      }
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Steering attaches to a live session: pass sessionId.' } };
      }
      let snapshotPath;
      try {
        snapshotPath = snapshotPathFor(sessionId.trim());
      } catch (error) {
        return { status: 400, body: { ok: false, code: error.code ?? 'OMO_SESSION_ID_INVALID', message: error.message } };
      }
      const model = isNonEmptyString(body?.model) ? body.model.trim() : undefined;
      const agent = isNonEmptyString(body?.agent) ? body.agent.trim() : undefined;
      // Project scope for the History filter. Optional; a wrong-typed value
      // is rejected so a caller cannot silently mis-scope its own record.
      if (body?.directory !== undefined && !isNonEmptyString(body.directory)) {
        return { status: 400, body: { ok: false, code: 'OMO_INVOKE_ARGS_INVALID', message: 'directory must be a non-empty string when given.' } };
      }
      const steerDirectory = isNonEmptyString(body?.directory) ? body.directory.trim() : null;
      const bridge = createBridge(entry);
      let handle;
      try {
        handle = bridge.invoke({
          message: message.trim(),
          sessionId: sessionId.trim(),
          snapshotPath,
          model,
          agent,
        });
      } catch (error) {
        return bridgeError(error, 'OMO_SPAWN_FAILED');
      }
      const startedAt = new Date(now()).toISOString();
      const steerLabel = message.trim().slice(0, 128);
      live.set(sessionId.trim(), { cancel: handle.cancel, startedAt, label: steerLabel, directory: steerDirectory });
      // Completion snapshot for steer runs: engine runs emit no snapshot
      // events, so without this record a finished steer vanishes from the
      // pane the moment its live entry clears. Records only what the
      // service observed (start, end, outcome); never invents child nodes.
      // Skipped when a richer snapshot already landed, and never throws.
      // A canceled run writes nothing: cancel clears the live entry first,
      // so the ownership check below refuses the settled child.
      const settleSteer = (completion) => {
        const record = live.get(sessionId.trim());
        if (record?.cancel !== handle.cancel) return;
        const recordDirectory = record.directory ?? null;
        live.delete(sessionId.trim());
        let existing;
        try {
          existing = fs.readFileSync(snapshotPathFor(sessionId.trim()), 'utf8');
        } catch {
          existing = null;
        }
        if (existing !== null) return;
        const failed = completion?.exitCode !== 0 || completion?.result?.success === false;
        const state = failed ? 'failed' : 'completed';
        const doc = {
          schemaVersion: 1,
          sessionId: sessionId.trim(),
          updatedAt: new Date(now()).toISOString(),
          directory: recordDirectory,
          dag: {
            runs: [{
              run_id: sessionId.trim(),
              run_key: `steer:${sessionId.trim()}`,
              name: sessionId.trim(),
              status: state,
              counts: state === 'failed'
                ? { pending: 0, running: 0, completed: 0 }
                : { pending: 0, running: 0, completed: 1 },
              nodes: [{
                id: 'step-1',
                label: steerLabel.slice(0, 64),
                state,
                attempt: 1,
                prompt: steerLabel,
                depends_on: [],
                started_at: startedAt,
                completed_at: new Date(now()).toISOString(),
              }],
              edges: [],
              waves: [{ index: 0, node_ids: ['step-1'] }],
            }],
          },
          tasks: null,
        };
        try {
          fs.writeFileSync(snapshotPathFor(sessionId.trim()), `${JSON.stringify(doc)}\n`, 'utf8');
        } catch {
          // A missing directory must never fail the settle path.
        }
      };
      handle.wait().then(settleSteer, () => settleSteer(undefined));
      return {
        status: 200,
        body: {
          ok: true, sessionId: sessionId.trim(), entry: handle.entry, argv: handle.argv, startedAt,
          native: handle.native === true,
        },
      };
    }
    if (method === 'POST' && path === '/cancel') {
      const sessionId = body?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Cancel targets a live session: pass sessionId.' } };
      }
      const running = live.get(sessionId.trim());
      if (!running) {
        return { status: 404, body: { ok: false, code: 'OMO_DAG_NO_RUN', sessionId: sessionId.trim() } };
      }
      let receipt;
      try {
        receipt = await running.cancel(isNonEmptyString(body?.reason) ? body.reason.trim() : 'pane cancel');
      } catch (error) {
        return bridgeError(error, 'OMO_CANCEL_FAILED');
      }
      live.delete(sessionId.trim());
      return { status: 200, body: { ok: true, sessionId: sessionId.trim(), receipt } };
    }
    return { status: 404, body: { ok: false, code: 'OMO_DAG_UNKNOWN_PATH', path } };
  };

  return { handleRequest, live };
};
