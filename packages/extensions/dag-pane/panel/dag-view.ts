// Snapshot -> view parser for the alcode-builtin-dag-pane guest (project-ide todo 13).
//
// This module is the panel's I/O boundary: it reads the bridge snapshot
// document the adapter-A writer produces (`{ schemaVersion: 1, sessionId,
// updatedAt, dag, tasks }` where `dag` is the `omo.dag.updated` payload
// and `tasks` the `omo.task.updated` payload) and answers either a
// renderable view or a named malformed error. The panel turns the error
// into an error card, never a blank pane.
//
// Narrowing follows the repo's `isJsonValue` idiom (stringify-to-self for
// strings, `Object(value) === value` for records): no `typeof` operators,
// no `unknown` parameters, every input typed as the SDK's `JsonValue`
// owner contract. No DOM here: unit-tested in bun:test without a browser.
import type { JsonValue } from '@alcode/sdk';

export const DAG_SNAPSHOT_SCHEMA_VERSION = 1;

export type WireRecord = { [key: string]: JsonValue };

export const isWireRecord = (value: JsonValue | undefined): value is WireRecord => (
  Object(value) === value && !Array.isArray(value)
);

export const wireString = (value: JsonValue | undefined): string | null => {
  // SAFETY: only strings stringify to themselves; every other JSON value
  // stringifies to something unequal to itself under `===`.
  return String(value) === value ? (value as string) : null;
};

export const wireNumber = (value: JsonValue | undefined): number | null => {
  // SAFETY: `Number(value) === value` with finiteness holds only for
  // numbers; every other JSON value coerces to something unequal.
  return Number(value) === value && Number.isFinite(value) ? (value as number) : null;
};

const wireStringArray = (value: JsonValue | undefined): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: string[] = [];
  for (const entry of value) {
    const text = wireString(entry);
    if (text === null) {
      return null;
    }
    entries.push(text);
  }
  return entries;
};

/**
 * The repair lifecycle vocabulary, deliberately disjoint from the completion
 * gate's verdicts: what the attempt did is never what the gate decided.
 */
export const REPAIR_STATES = [
  'diagnosing',
  'repair_planned',
  'repairing',
  'reverifying',
  'repaired',
  'repair_failed',
  'repair_cancelled',
] as const;

export type RepairState = (typeof REPAIR_STATES)[number];

export type RepairVerificationStatus = 'verified' | 'unverified' | 'blocked';

const isRepairState = (value: string): value is RepairState => (
  value === 'diagnosing'
  || value === 'repair_planned'
  || value === 'repairing'
  || value === 'reverifying'
  || value === 'repaired'
  || value === 'repair_failed'
  || value === 'repair_cancelled'
);

const isRepairVerificationStatus = (value: string): value is RepairVerificationStatus => (
  value === 'verified' || value === 'unverified' || value === 'blocked'
);

/**
 * One repair attempt as the run/tasks payload projects it. `verificationStatus`
 * is read only from the persisted completion gate record; it is never derived
 * from `state`, so "repaired" alone can never mean "verified". It is null when
 * the gate recorded no claim, and callers render that as unverified (fail
 * closed), never verified.
 */
export type DagRepairView = {
  attemptId: string;
  taskId: string;
  epoch: number;
  state: RepairState;
  failedChecks: string[];
  rerunChecks: string[];
  changedFiles: string[];
  verificationStatus: RepairVerificationStatus | null;
  hostFacts: string[];
  modelHypotheses: string[];
  updatedAt: number;
};

type RepairRead = { repair?: DagRepairView; repairError?: string };

const readRepair = (raw: JsonValue | undefined): DagRepairView | null => {
  if (!isWireRecord(raw)) {
    return null;
  }
  const attemptId = wireString(raw.attemptId);
  const taskId = wireString(raw.taskId);
  const epoch = wireNumber(raw.epoch);
  const state = wireString(raw.state);
  const failedChecks = wireStringArray(raw.failedChecks);
  const rerunChecks = wireStringArray(raw.rerunChecks);
  const changedFiles = wireStringArray(raw.changedFiles);
  const hostFacts = wireStringArray(raw.hostFacts);
  const modelHypotheses = wireStringArray(raw.modelHypotheses);
  const updatedAt = wireNumber(raw.updatedAt);
  const updatedDate = updatedAt === null ? null : new Date(updatedAt);
  const verificationClaim = raw.verificationStatus;
  let verificationStatus: RepairVerificationStatus | null | undefined;
  if (verificationClaim === null || verificationClaim === undefined) {
    verificationStatus = null;
  } else {
    const claim = wireString(verificationClaim);
    verificationStatus =
      claim !== null && isRepairVerificationStatus(claim) ? claim : undefined;
  }
  if (
    attemptId === null
    || attemptId.length === 0
    || taskId === null
    || taskId.length === 0
    || epoch === null
    || !Number.isInteger(epoch)
    || epoch < 0
    || state === null
    || !isRepairState(state)
    || failedChecks === null
    || rerunChecks === null
    || changedFiles === null
    || hostFacts === null
    || modelHypotheses === null
    || updatedAt === null
    || updatedDate === null
    || Number.isNaN(updatedDate.getTime())
    || verificationStatus === undefined
  ) {
    return null;
  }
  return {
    attemptId,
    taskId,
    epoch,
    state,
    failedChecks,
    rerunChecks,
    changedFiles,
    verificationStatus,
    hostFacts,
    modelHypotheses,
    updatedAt,
  };
};

/**
 * A malformed repair block is a read error, never "no repair": the caller must
 * be able to say the state exists but is unreadable. An absent block stays
 * absent so a record without repair renders exactly as it did before.
 */
const readRepairEntry = (raw: WireRecord, recordId: string): RepairRead => {
  if (raw.repair !== undefined) {
    const repair = readRepair(raw.repair);
    if (repair === null) {
      return { repairError: `repair state payload is malformed for ${recordId}` };
    }
    return { repair };
  }
  const repairError = wireString(raw.repairError);
  if (repairError !== null && repairError.length > 0) {
    return { repairError };
  }
  return {};
};

/**
 * Epoch-fenced merge for repeated observations of the same task. A lower
 * epoch never overwrites a higher one; for the same epoch the newer attempt
 * observation wins. Duplicate observations collapse to one entry, which is
 * what keeps a duplicate lifecycle event from adding or reordering a row.
 */
export const mergeRepairEntry = (
  current: DagRepairView | undefined,
  incoming: DagRepairView,
): DagRepairView => {
  if (current === undefined) {
    return incoming;
  }
  if (incoming.epoch !== current.epoch) {
    return incoming.epoch > current.epoch ? incoming : current;
  }
  if (incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt ? incoming : current;
  }
  return incoming.attemptId >= current.attemptId ? incoming : current;
};

export type DagNodeView = {
  id: string;
  label: string;
  state: string;
  attempt: number;
  prompt: string;
  dependsOn: string[];
  startedAt: string | null;
  completedAt: string | null;
};

export type DagRunWave = {
  index: number;
  nodeIds: string[];
};

export type DagRunView = {
  runId: string;
  runKey: string;
  name: string;
  status: string;
  counts: { pending: number; running: number; completed: number; failed: number; cancelled: number };
  nodes: DagNodeView[];
  edges: { from: string; to: string }[];
  waves: DagRunWave[];
  /** Current-epoch repair attempt; absent when the record carries none. */
  repair?: DagRepairView;
  /** The attempt store could not be read; never render this as "no repair". */
  repairError?: string;
};

export type DagTaskView = {
  taskId: string;
  status: string;
  name: string;
  summary: string;
  /** Current-epoch repair attempt; absent when the record carries none. */
  repair?: DagRepairView;
  /** The attempt store could not be read; never render this as "no repair". */
  repairError?: string;
};

export type DagSnapshotView = {
  sessionId: string;
  updatedAt: string;
  runs: DagRunView[];
  tasks: DagTaskView[];
};

export type DagSnapshotError = {
  code: 'DAG_SNAPSHOT_MALFORMED';
  /** Dotted field path naming the first shape violation, e.g. `dag.runs[0].nodes`. */
  field: string;
};

export type DagSnapshotOutcome =
  | { ok: true; view: DagSnapshotView }
  | { ok: false; error: DagSnapshotError };

const fail = (field: string): DagSnapshotOutcome => (
  { ok: false, error: { code: 'DAG_SNAPSHOT_MALFORMED', field } }
);

const readNode = (raw: JsonValue | undefined): DagNodeView | null => {
  if (!isWireRecord(raw)) {
    return null;
  }
  const id = wireString(raw.id);
  const label = wireString(raw.label);
  const state = wireString(raw.state);
  const prompt = wireString(raw.prompt);
  const dependsOn = wireStringArray(raw.depends_on);
  if (id === null || label === null || state === null || prompt === null || dependsOn === null) {
    return null;
  }
  return {
    id,
    label,
    state,
    attempt: wireNumber(raw.attempt) ?? 0,
    prompt,
    dependsOn,
    startedAt: wireString(raw.started_at),
    completedAt: wireString(raw.completed_at),
  };
};

const readWave = (raw: JsonValue | undefined): DagRunWave | null => {
  if (!isWireRecord(raw)) {
    return null;
  }
  const index = wireNumber(raw.index);
  const nodeIds = wireStringArray(raw.node_ids);
  if (index === null || !Number.isInteger(index) || nodeIds === null) {
    return null;
  }
  return { index, nodeIds };
};

const readRun = (raw: JsonValue | undefined): DagRunView | null => {
  if (!isWireRecord(raw)) {
    return null;
  }
  const runId = wireString(raw.run_id);
  const runKey = wireString(raw.run_key);
  const name = wireString(raw.name);
  const status = wireString(raw.status);
  if (runId === null || runKey === null || name === null || status === null) {
    return null;
  }
  if (!Array.isArray(raw.nodes)) {
    return null;
  }
  const nodes: DagNodeView[] = [];
  for (const entry of raw.nodes) {
    const node = readNode(entry);
    if (!node) {
      return null;
    }
    nodes.push(node);
  }
  const edges: DagRunView['edges'] = [];
  if (raw.edges !== undefined) {
    if (!Array.isArray(raw.edges)) {
      return null;
    }
    for (const entry of raw.edges) {
      if (!isWireRecord(entry)) {
        return null;
      }
      const from = wireString(entry.from);
      const to = wireString(entry.to);
      if (from === null || to === null) {
        return null;
      }
      edges.push({ from, to });
    }
  }
  // Waves only drive graph layout, so a broken wave list falls back to a
  // single column instead of failing the run.
  const waves: DagRunWave[] = [];
  if (Array.isArray(raw.waves)) {
    for (const entry of raw.waves) {
      const wave = readWave(entry);
      if (wave) {
        waves.push(wave);
      }
    }
  }
  const counts = isWireRecord(raw.counts) ? raw.counts : {};
  const countOf = (key: string): number => wireNumber(counts[key]) ?? 0;
  return {
    runId,
    runKey,
    name,
    status,
    counts: { pending: countOf('pending'), running: countOf('running'), completed: countOf('completed'), failed: countOf('failed'), cancelled: countOf('cancelled') },
    nodes,
    edges,
    waves,
    ...readRepairEntry(raw, runId),
  };
};

const readTasks = (raw: JsonValue | undefined): DagTaskView[] | null => {
  if (raw === null || raw === undefined) {
    return [];
  }
  if (!isWireRecord(raw) || !Array.isArray(raw.tasks)) {
    return null;
  }
  const tasks: DagTaskView[] = [];
  for (const entry of raw.tasks) {
    if (!isWireRecord(entry)) {
      return null;
    }
    const taskId = wireString(entry.task_id);
    const status = wireString(entry.status);
    if (taskId === null || status === null) {
      return null;
    }
    tasks.push({
      taskId,
      status,
      name: wireString(entry.name) ?? taskId,
      summary: wireString(entry.task_summary) ?? '',
      ...readRepairEntry(entry, taskId),
    });
  }
  return tasks;
};

/**
 * Parse one bridge snapshot document into a renderable view. A `null` dag
 * means no event has landed yet: that is an empty view, not malformed.
 * Anything else that breaks the wire shape is malformed with the field
 * named, so the panel can render an error card instead of blank output.
 */
export const parseSnapshotDoc = (raw: JsonValue | undefined): DagSnapshotOutcome => {
  if (!isWireRecord(raw)) {
    return fail('snapshot');
  }
  const sessionId = wireString(raw.sessionId);
  if (sessionId === null) {
    return fail('sessionId');
  }
  if (raw.schemaVersion !== DAG_SNAPSHOT_SCHEMA_VERSION) {
    return fail('schemaVersion');
  }
  const updatedAt = wireString(raw.updatedAt) ?? '';
  if (raw.dag !== null && raw.dag !== undefined) {
    if (!isWireRecord(raw.dag) || !Array.isArray(raw.dag.runs)) {
      return fail('dag.runs');
    }
    const runs: DagRunView[] = [];
    for (let index = 0; index < raw.dag.runs.length; index += 1) {
      const run = readRun(raw.dag.runs[index]);
      if (!run) {
        return fail(`dag.runs[${index}]`);
      }
      runs.push(run);
    }
    const tasks = readTasks(raw.tasks);
    if (!tasks) {
      return fail('tasks');
    }
    return { ok: true, view: { sessionId, updatedAt, runs, tasks } };
  }
  const tasks = readTasks(raw.tasks);
  if (!tasks) {
    return fail('tasks');
  }
  return { ok: true, view: { sessionId, updatedAt, runs: [], tasks } };
};

// Per-session selection: the host chat session owns the view (one session,
// one DAG). The host id wins even when it has no runs yet (unlisted): that
// session's view is correctly empty. With no host session there is no view
// to own, so selection stays empty instead of borrowing a foreign DAG.
// The dropdown stays a manual override; polls must not disturb it.
export const resolveSelectedSession = ({ hostSessionId, current, sessions }: {
  hostSessionId: string | null;
  current: string | null;
  sessions: readonly string[];
}): string | null => {
  if (hostSessionId !== null) {
    return hostSessionId;
  }
  if (current !== null && sessions.includes(current)) {
    return current;
  }
  return null;
};

// Run-model retention across conversation switches: the host posts the run
// model from its own effect, so a post can arrive before onSession binds its
// conversation. The panel holds the stored post and paints it only when its
// conversation is the active one, so an early post survives the bind; a
// switch to a different conversation still clears a stale post.
/**
 * A run-model post carries a snapshot or a null for its conversation. A null
 * post for the conversation already stored means "no update right now" — the
 * host's derived document is momentarily empty while the engine streams — so
 * the stored doc is kept and a visible run never blanks. A post for a
 * different conversation replaces both fields, null included.
 */
export const mergeRunModelPost = (
  stored: { conversationId: string | null; snapshot: JsonValue | null },
  post: { conversationId: string; snapshot: JsonValue | null },
): { conversationId: string | null; snapshot: JsonValue | null } => (
  post.snapshot !== null || post.conversationId !== stored.conversationId
    ? { conversationId: post.conversationId, snapshot: post.snapshot }
    : stored
);

export const keepStoredRunModel = (
  storedConversationId: string | null,
  sessionId: string | null,
): boolean => storedConversationId !== null && storedConversationId === sessionId;
