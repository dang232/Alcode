// Activity timeline for the dag-pane guest: turns the SAME run snapshot the DAG view renders into a
// chronological row list, and nothing else. Rows exist only for facts the snapshot actually records
// (per-node start/completion instants and current-epoch repair attempts). Tool executions, code-graph
// evidence and knowledge reads are NOT in the snapshot, so this module reports them as unavailable
// instead of inventing rows.
import { mergeRepairEntry } from './dag-view.ts';
import type {
  DagNodeView,
  DagRepairView,
  DagRunView,
  DagSnapshotView,
  DagTaskView,
  RepairVerificationStatus,
} from './dag-view.ts';

export type ActivityKind = 'node-started' | 'node-finished' | 'repair';

export type ActivityRow = {
  id: string;
  at: string;
  kind: ActivityKind;
  runId: string;
  runName: string;
  nodeId: string;
  nodeLabel: string;
  state: string;
  attempt: number;
  durationMs: number | null;
  /** Repair rows only: the gate's verdict, kept separate from the repair state. */
  verificationStatus?: RepairVerificationStatus | null;
  /** Repair rows only: the current-epoch attempt the row was built from. */
  repair?: DagRepairView;
};

export type ActivityTimeline = {
  rows: ActivityRow[];
  /** Nodes whose lifecycle produced no usable timestamp; counted, never fabricated into rows. */
  withoutTimestamps: number;
  /** Facts a run timeline would need but this snapshot does not carry. */
  unavailable: string[];
};

const FILE_CHANGES_FACT = 'file changes';

const UNRECORDED = [
  'tool commands',
  'code-graph evidence reads',
  'project-knowledge reads',
  FILE_CHANGES_FACT,
] as const;

const repairRowLabel = (repair: DagRepairView, run: DagRunView, tasks: DagTaskView[]): string => {
  const task = tasks.find((entry) => entry.taskId === repair.taskId);
  if (task !== undefined) {
    return task.name.length > 0 ? task.name : repair.taskId;
  }
  const node = run.nodes.find((entry) => entry.id === repair.taskId);
  return node?.label ?? repair.taskId;
};

/**
 * Repair rows for one run. A duplicated observation (the run record and the
 * task record carry the same attempt, or the same event lands twice) collapses
 * to one row under the epoch fence: a lower epoch never replaces the current
 * attempt, so stale events cannot add or reorder rows.
 */
const repairRowsFor = (run: DagRunView, tasks: DagTaskView[]): ActivityRow[] => {
  const belongsToRun = (taskId: string): boolean => (
    taskId === run.runId || run.nodes.some((node) => node.id === taskId)
  );
  const current = new Map<string, DagRepairView>();
  const observe = (repair: DagRepairView, scopedToRun: boolean): void => {
    if (!scopedToRun && !belongsToRun(repair.taskId)) {
      return;
    }
    current.set(repair.taskId, mergeRepairEntry(current.get(repair.taskId), repair));
  };
  // The run record's repair block is already scoped to that run, even when a
  // DAG run id and the repaired task id differ.
  if (run.repair !== undefined) {
    observe(run.repair, true);
  }
  for (const task of tasks) {
    if (task.repair !== undefined) {
      observe(task.repair, belongsToRun(task.taskId) || belongsToRun(task.repair.taskId));
    }
  }
  const rows: ActivityRow[] = [];
  for (const repair of current.values()) {
    rows.push({
      id: `${run.runId}:${repair.taskId}:repair`,
      at: new Date(repair.updatedAt).toISOString(),
      kind: 'repair',
      runId: run.runId,
      runName: run.name,
      nodeId: repair.taskId,
      nodeLabel: repairRowLabel(repair, run, tasks),
      state: repair.state,
      attempt: 0,
      durationMs: null,
      verificationStatus: repair.verificationStatus,
      repair,
    });
  }
  return rows;
};

const parseInstant = (value: string | null): number | null => {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const rowsForNode = (run: DagRunView, node: DagNodeView): ActivityRow[] => {
  const started = parseInstant(node.startedAt);
  const completed = parseInstant(node.completedAt);
  const base = {
    runId: run.runId,
    runName: run.name,
    nodeId: node.id,
    nodeLabel: node.label,
    state: node.state,
    attempt: node.attempt,
  };
  const rows: ActivityRow[] = [];
  if (started !== null && node.startedAt !== null) {
    rows.push({
      ...base,
      id: `${run.runId}:${node.id}:started`,
      at: node.startedAt,
      kind: 'node-started',
      durationMs: null,
    });
  }
  if (completed !== null && node.completedAt !== null) {
    rows.push({
      ...base,
      id: `${run.runId}:${node.id}:finished`,
      at: node.completedAt,
      kind: 'node-finished',
      durationMs: started === null ? null : completed - started,
    });
  }
  return rows;
};

/**
 * Chronological rows for one run, oldest first. A node contributes a start row and, once it has a
 * completion instant, a finish row; a node with neither is counted in `withoutTimestamps`. A
 * current-epoch repair attempt contributes one row whose state line and gate verdict stay separate.
 */
export const buildActivityTimeline = (
  view: Pick<DagSnapshotView, 'runs'> & Partial<Pick<DagSnapshotView, 'tasks'>>,
  runId: string | null,
): ActivityTimeline => {
  const run = runId === null ? view.runs[0] : view.runs.find((entry) => entry.runId === runId);
  if (run === undefined) {
    return { rows: [], withoutTimestamps: 0, unavailable: [...UNRECORDED] };
  }
  const rows: ActivityRow[] = [];
  let withoutTimestamps = 0;
  for (const node of run.nodes) {
    const nodeRows = rowsForNode(run, node);
    if (nodeRows.length === 0) withoutTimestamps += 1;
    rows.push(...nodeRows);
  }
  const repairRows = repairRowsFor(run, view.tasks ?? []);
  rows.push(...repairRows);
  rows.sort((left, right) => {
    const delta = Date.parse(left.at) - Date.parse(right.at);
    return delta === 0 ? left.id.localeCompare(right.id) : delta;
  });
  // A repair attempt records the files it actually changed, so "file changes"
  // is no longer an unavailable fact once one such row is present.
  const unavailable = repairRows.some((row) => (row.repair?.changedFiles.length ?? 0) > 0)
    ? UNRECORDED.filter((fact) => fact !== FILE_CHANGES_FACT)
    : [...UNRECORDED];
  return { rows, withoutTimestamps, unavailable };
};

/** The node an activity row points at, for cross-view selection. */
export const rowNodeId = (row: ActivityRow): string => row.nodeId;

/** Stable key for "this row belongs to this run and node", used by the shared selection. */
export const rowIdentity = (row: ActivityRow): string => `${row.runId}/${row.nodeId}`;

export const formatClock = (iso: string): string => {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed).toISOString().slice(11, 19);
};

export const formatDuration = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

/**
 * The repair line and the gate line are separate on purpose: a repaired
 * attempt never rewrites what the completion gate decided. A missing gate
 * claim reads as unverified (fail closed), never verified.
 */
export const formatRepairState = (state: string): string => `repair: ${state}`;

export const formatVerificationStatus = (
  status: RepairVerificationStatus | null | undefined,
): RepairVerificationStatus => status ?? 'unverified';

/** Detail lines keep failed checks, rerun checks and changed files distinct. */
export const repairDetailLines = (repair: DagRepairView): string[] => {
  const lines: string[] = [];
  if (repair.failedChecks.length > 0) {
    lines.push(`failed: ${repair.failedChecks.join(', ')}`);
  }
  if (repair.rerunChecks.length > 0) {
    lines.push(`rerun: ${repair.rerunChecks.join(', ')}`);
  }
  if (repair.changedFiles.length > 0) {
    lines.push(`changed: ${repair.changedFiles.join(', ')}`);
  }
  return lines;
};
