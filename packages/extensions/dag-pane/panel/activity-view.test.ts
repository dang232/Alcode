import { describe, expect, test } from 'bun:test';

import {
  buildActivityTimeline,
  formatClock,
  formatDuration,
  formatRepairState,
  formatVerificationStatus,
  repairDetailLines,
  rowIdentity,
  rowNodeId,
  type ActivityRow,
} from './activity-view.ts';
import type { DagNodeView, DagRepairView, DagRunView, DagSnapshotView, DagTaskView } from './dag-view.ts';

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
  counts: { pending: 0, running: 1, completed: 1, failed: 0, cancelled: 0 },
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

const viewWithTasks = (runs: DagRunView[], tasks: DagTaskView[]): DagSnapshotView => ({ ...view(runs), tasks });

const task = (overrides: Partial<DagTaskView> = {}): DagTaskView => ({
  taskId: 'a',
  status: 'error',
  name: 'a',
  summary: '',
  ...overrides,
});

const repair = (overrides: Partial<DagRepairView> = {}): DagRepairView => ({
  attemptId: 'st_a.e1.r1',
  taskId: 'st_a',
  epoch: 1,
  state: 'diagnosing',
  failedChecks: [],
  rerunChecks: [],
  changedFiles: [],
  verificationStatus: null,
  hostFacts: [],
  modelHypotheses: [],
  updatedAt: 1000,
  ...overrides,
});

const repairRun = (overrides: Partial<DagRunView> = {}): DagRunView => run({
  runId: 'run-r',
  name: 'repair demo',
  nodes: [
    node({ id: 'st_a', label: 'a' }),
    node({ id: 'st_b', label: 'b' }),
    node({ id: 'st_c', label: 'c' }),
  ],
  edges: [],
  waves: [],
  ...overrides,
});

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

describe('repair lifecycle in the activity timeline', () => {
  test('#given repair attempts with increasing update instants #when built #then states render in update order and the gate verdict is a separate field', () => {
    const timeline = buildActivityTimeline(
      viewWithTasks([repairRun()], [
        task({ taskId: 'st_a', name: 'a', repair: repair({ taskId: 'st_a', state: 'diagnosing', epoch: 1, updatedAt: 1000, verificationStatus: null }) }),
        task({ taskId: 'st_b', name: 'b', repair: repair({ taskId: 'st_b', state: 'repairing', epoch: 1, updatedAt: 2000, verificationStatus: 'unverified' }) }),
        task({ taskId: 'st_c', name: 'c', repair: repair({ taskId: 'st_c', state: 'repaired', epoch: 1, updatedAt: 3000, verificationStatus: 'blocked' }) }),
      ]),
      'run-r',
    );

    const rows = timeline.rows.filter((entry) => entry.kind === 'repair');
    expect(rows).toHaveLength(3);
    expect(rows.map((entry) => entry.repair?.state)).toEqual(['diagnosing', 'repairing', 'repaired']);
    expect(rows.map((entry) => entry.verificationStatus)).toEqual([null, 'unverified', 'blocked']);
    expect(rows[2]?.state).toBe('repaired');
    expect(rows[2]?.verificationStatus).toBe('blocked');
  });

  test('#given a repaired attempt whose gate blocked #when built #then the entry shows repaired and blocked separately and never verified', () => {
    const block = repair({
      taskId: 'st_a',
      state: 'repaired',
      verificationStatus: 'blocked',
      failedChecks: ['unit'],
      rerunChecks: ['unit', 'lint'],
      changedFiles: ['src/a.ts', 'src/b.ts'],
    });
    const timeline = buildActivityTimeline(
      viewWithTasks([repairRun()], [task({ taskId: 'st_a', name: 'repair-me', repair: block })]),
      'run-r',
    );

    const entry = timeline.rows.find((row) => row.kind === 'repair');
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.state).toBe('repaired');
    expect(entry.verificationStatus).toBe('blocked');
    expect(formatRepairState(entry.state)).toBe('repair: repaired');
    expect(formatVerificationStatus(entry.verificationStatus)).toBe('blocked');
    expect(JSON.stringify(entry)).not.toContain('verified');
    expect(entry.repair?.failedChecks).toEqual(['unit']);
    expect(entry.repair?.rerunChecks).toEqual(['unit', 'lint']);
    expect(entry.repair?.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(timeline.unavailable).not.toContain('file changes');
    expect(entry.repair === undefined ? [] : repairDetailLines(entry.repair)).toEqual([
      'failed: unit',
      'rerun: unit, lint',
      'changed: src/a.ts, src/b.ts',
    ]);
  });

  test('#given a stale-epoch observation beside the current attempt #when built #then the current entry survives once', () => {
    const current = repair({ taskId: 'st_a', epoch: 2, state: 'repaired', updatedAt: 2000, verificationStatus: 'blocked' });
    const stale = repair({ taskId: 'st_a', epoch: 1, state: 'diagnosing', updatedAt: 3000, verificationStatus: 'verified' });

    const timeline = buildActivityTimeline(
      viewWithTasks([repairRun({ repair: current })], [task({ taskId: 'st_a', repair: stale })]),
      'run-r',
    );

    const rows = timeline.rows.filter((entry) => entry.kind === 'repair');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repair?.epoch).toBe(2);
    expect(rows[0]?.state).toBe('repaired');
    expect(rows[0]?.verificationStatus).toBe('blocked');
    expect(JSON.stringify(rows[0])).not.toContain('verified');
  });

  test('#given the same repair event on the run and twice on its task #when built #then one activity entry renders', () => {
    const block = repair({ taskId: 'st_a', epoch: 2, state: 'repairing', updatedAt: 2000, verificationStatus: 'unverified' });

    const timeline = buildActivityTimeline(
      viewWithTasks([repairRun({ repair: block })], [
        task({ taskId: 'st_a', repair: block }),
        task({ taskId: 'st_a', repair: { ...block } }),
      ]),
      'run-r',
    );

    const rows = timeline.rows.filter((entry) => entry.kind === 'repair');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('run-r:st_a:repair');
  });

  test('#given a repair block on the run record alone #when built #then its state line renders without task records', () => {
    const block = repair({ taskId: 'st_a', state: 'reverifying', updatedAt: 1000, verificationStatus: 'unverified' });

    const timeline = buildActivityTimeline(view([repairRun({ repair: block })]), 'run-r');

    const rows = timeline.rows.filter((entry) => entry.kind === 'repair');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('reverifying');
  });

  test('#given no repair block #when built #then the timeline is exactly the node lifecycle it always was', () => {
    const timeline = buildActivityTimeline(view([run()]), 'run-1');

    expect(timeline.rows.map((entry) => entry.id)).toEqual([
      'run-1:a:started',
      'run-1:b:started',
      'run-1:a:finished',
    ]);
    expect(timeline.rows.some((entry) => entry.kind === 'repair')).toBe(false);
    expect(timeline.rows.every((entry) => !Object.hasOwn(entry, 'repair'))).toBe(true);
    expect(timeline.rows.every((entry) => !Object.hasOwn(entry, 'verificationStatus'))).toBe(true);
    expect(timeline.withoutTimestamps).toBe(1);
    expect(timeline.unavailable).toContain('file changes');
  });
});
