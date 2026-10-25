import { describe, expect, test } from 'bun:test';

import {
  buildActivityTimeline,
  formatClock,
  formatDuration,
  rowIdentity,
  rowNodeId,
  type ActivityRow,
} from './activity-view.ts';
import type { DagNodeView, DagRunView, DagSnapshotView } from './dag-view.ts';

const node = (overrides: Partial<DagNodeView>): DagNodeView => ({
  id: 'a',
  label: 'a',
  state: 'pending',
  attempt: 1,
  prompt: 'do a',
  dependsOn: [],
  startedAt: null,
  completedAt: null,
  ...overrides,
});

const run = (overrides: Partial<DagRunView> = {}): DagRunView => ({
  runId: 'run-1',
  runKey: 'k',
  name: 'demo',
  status: 'running',
  counts: { pending: 0, running: 1, completed: 1 },
  nodes: [
    node({ id: 'a', label: 'a', state: 'completed', startedAt: '2026-10-24T00:00:01.000Z', completedAt: '2026-10-24T00:00:03.500Z' }),
    node({ id: 'b', label: 'b', state: 'running', startedAt: '2026-10-24T00:00:02.000Z' }),
    node({ id: 'c', label: 'c', state: 'pending' }),
  ],
  edges: [{ from: 'a', to: 'b' }],
  waves: [{ index: 0, nodeIds: ['a', 'b', 'c'] }],
  ...overrides,
});

const view = (runs: DagRunView[]): DagSnapshotView => ({ sessionId: 'ses-1', updatedAt: '2026-10-24T00:00:04.000Z', runs, tasks: [] });

describe('activity timeline', () => {
  test('#given a run with node timestamps #when built #then rows are chronological lifecycle facts of that run', () => {
    const timeline = buildActivityTimeline(view([run()]), 'run-1');

    expect(timeline.rows.map((entry) => entry.id)).toEqual([
      'run-1:a:started',
      'run-1:b:started',
      'run-1:a:finished',
    ]);
    expect(timeline.rows.at(-1)?.durationMs).toBe(2500);
    expect(timeline.withoutTimestamps).toBe(1);
  });

  test('#given a node without instants #when built #then it is counted and never turned into a row', () => {
    const timeline = buildActivityTimeline(view([run()]), 'run-1');

    expect(timeline.rows.some((entry) => entry.nodeId === 'c')).toBe(false);
    expect(timeline.withoutTimestamps).toBe(1);
  });

  test('#given facts the snapshot cannot carry #when built #then they are declared unavailable rather than implied', () => {
    const timeline = buildActivityTimeline(view([run()]), 'run-1');

    expect(timeline.unavailable).toEqual([
      'tool commands',
      'code-graph evidence reads',
      'project-knowledge reads',
      'file changes',
    ]);
  });

  test('#given an unknown run id #when built #then the timeline is empty, not another run', () => {
    const timeline = buildActivityTimeline(view([run(), run({ runId: 'run-2', name: 'other' })]), 'run-9');

    expect(timeline.rows).toEqual([]);
    expect(timeline.withoutTimestamps).toBe(0);
  });

  test('#given two runs in one snapshot #when a run is selected #then only that run contributes rows', () => {
    const other = run({
      runId: 'run-2',
      name: 'other',
      nodes: [node({ id: 'z', label: 'z', state: 'completed', startedAt: '2026-10-24T00:10:00.000Z', completedAt: '2026-10-24T00:10:01.000Z' })],
    });

    const timeline = buildActivityTimeline(view([run(), other]), 'run-2');

    expect(timeline.rows).toHaveLength(2);
    expect(new Set(timeline.rows.map((entry) => entry.runId))).toEqual(new Set(['run-2']));
  });

  test('#given a failed node #when built #then its rows carry the failure state for the timeline to surface', () => {
    const failed = run({
      nodes: [node({ id: 'a', label: 'a', state: 'failed', startedAt: '2026-10-24T00:00:01.000Z', completedAt: '2026-10-24T00:00:02.000Z' })],
    });

    const rows = buildActivityTimeline(view([failed]), 'run-1').rows;

    expect(rows.every((entry) => entry.state === 'failed')).toBe(true);
  });
});

describe('activity to DAG identity', () => {
  test('#given any activity row #when resolved #then its node id exists in the same run of the DAG view', () => {
    const dag = run();
    const timeline = buildActivityTimeline(view([dag]), 'run-1');
    const nodeIds = new Set(dag.nodes.map((entry) => entry.id));

    for (const entry of timeline.rows) {
      expect(nodeIds.has(rowNodeId(entry))).toBe(true);
      expect(entry.runId).toBe(dag.runId);
    }
  });

  test('#given two rows for one node #when identified #then run and node identity is shared, kinds differ', () => {
    const timeline = buildActivityTimeline(view([run()]), 'run-1');
    const [started, , finished] = timeline.rows as [ActivityRow, ActivityRow, ActivityRow];

    expect(rowIdentity(started)).toBe('run-1/a');
    expect(rowIdentity(finished)).toBe('run-1/a');
    expect(started.kind).not.toBe(finished.kind);
  });
});

describe('activity formatting', () => {
  test('#given ISO instants #when formatted #then the clock is stable UTC and non-finite input is passed through', () => {
    expect(formatClock('2026-10-24T00:00:01.000Z')).toBe('00:00:01');
    expect(formatClock('not-a-date')).toBe('not-a-date');
  });

  test('#given durations #when formatted #then sub-second, seconds and minutes read distinctly', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(2500)).toBe('2.5s');
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(null)).toBe('—');
  });
});
