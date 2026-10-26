import { type SnapshotDoc } from './snapshotDoc';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type ActivityNodeState,
  type ActivityTreeRow,
  type RunGraph,
} from './activityModel';

export type EngineSnapshotSource = {
  /** Parsed engine snapshot, or null when no snapshot exists. */
  doc: SnapshotDoc | null;
  conversationId: string;
};

const toActivityState = (state: string): ActivityNodeState => {
  switch (state) {
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'blocked':
    case 'parked': return 'blocked';
    default: return 'unknown';
  }
};

const WAVE_GAP_X = 72;
const ROW_GAP_Y = 24;

export type EngineRunView = {
  rows: ActivityTreeRow[];
  graph: RunGraph;
  runLabel: string;
};

/**
 * Engine snapshot runs as activity rows plus a run graph. Node placement
 * follows the snapshot's own waves; engine states map to the activity union
 * with `parked` shown as `blocked` (the scheduler's reported equivalent).
 * Anything unparseable answers null: the caller falls back to the live
 * chat-path model instead of rendering a partial engine graph.
 */
export const engineSnapshotToView = (source: EngineSnapshotSource): EngineRunView | null => {
  if (!source.doc) return null;
  const run = source.doc.runs.find((entry) => entry.runId === source.conversationId) ?? source.doc.runs[0] ?? null;
  if (!run) return null;
  const stateOf = (id: string): ActivityNodeState => {
    const node = run.nodes.find((entry) => entry.id === id);
    return node ? toActivityState(node.state) : 'unknown';
  };
  const rows: ActivityTreeRow[] = run.nodes.map((node) => ({
    id: node.id,
    kind: node.id === run.runId ? 'session' : 'task',
    label: node.label,
    detail: node.prompt || null,
    state: toActivityState(node.state),
    agent: null,
    progress: null,
  }));
  const waveIndex = new Map<string, number>();
  for (const wave of run.waves) {
    wave.nodeIds.forEach((id: string) => {
      if (!waveIndex.has(id)) waveIndex.set(id, wave.index);
    });
  }
  run.nodes.forEach((node) => {
    if (!waveIndex.has(node.id)) waveIndex.set(node.id, 0);
  });
  const byWave = new Map<number, string[]>();
  for (const node of run.nodes) {
    const wave = waveIndex.get(node.id) ?? 0;
    byWave.set(wave, [...(byWave.get(wave) ?? []), node.id]);
  }
  const nodeIds = new Set(run.nodes.map((node) => node.id));
  const nodes = run.nodes.map((node) => {
    const wave = waveIndex.get(node.id) ?? 0;
    const order = (byWave.get(wave) ?? []).indexOf(node.id);
    return {
      id: node.id,
      label: node.label,
      state: toActivityState(node.state),
      wave,
      x: wave * (NODE_WIDTH + WAVE_GAP_X),
      y: Math.max(0, order) * (NODE_HEIGHT + ROW_GAP_Y),
    };
  });
  const edges = run.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      blocking: stateOf(edge.to) === 'blocked' || stateOf(edge.to) === 'pending',
    }));
  const maxWave = Math.max(0, ...waveIndex.values());
  const maxRows = Math.max(1, ...[...byWave.values()].map((ids) => ids.length));
  return {
    rows,
    graph: {
      nodes,
      edges,
      width: (maxWave + 1) * NODE_WIDTH + maxWave * WAVE_GAP_X,
      height: maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP_Y,
    },
    runLabel: run.name,
  };
};
