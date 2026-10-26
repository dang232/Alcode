// Activity timeline for the dag-pane guest: turns the SAME run snapshot the DAG view renders into a
// chronological row list, and nothing else. Rows exist only for facts the snapshot actually records
// (per-node start/completion instants). Tool executions, code-graph evidence and knowledge reads are
// NOT in the snapshot, so this module reports them as unavailable instead of inventing rows.
import type { DagNodeView, DagRunView, DagSnapshotView } from './dag-view.ts';

export type ActivityKind = 'node-started' | 'node-finished';

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
};

export type ActivityTimeline = {
  rows: ActivityRow[];
  /** Nodes whose lifecycle produced no usable timestamp; counted, never fabricated into rows. */
  withoutTimestamps: number;
  /** Facts a run timeline would need but this snapshot does not carry. */
  unavailable: string[];
};

const UNRECORDED = [
  'tool commands',
  'code-graph evidence reads',
  'project-knowledge reads',
  'file changes',
] as const;

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
 * completion instant, a finish row; a node with neither is counted in `withoutTimestamps`.
 */
export const buildActivityTimeline = (view: Pick<DagSnapshotView, 'runs'>, runId: string | null): ActivityTimeline => {
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
  rows.sort((left, right) => {
    const delta = Date.parse(left.at) - Date.parse(right.at);
    return delta === 0 ? left.id.localeCompare(right.id) : delta;
  });
  return { rows, withoutTimestamps, unavailable: [...UNRECORDED] };
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
