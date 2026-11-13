// Panel honesty regression tests: the DAG view never states what it does
// not know.
//
// (1) A Code graph node with no edges and no evidence must render an
// explicit unknown/unproven marker in the inspector, never confidence 1.
// (2) A details card opened on a panel guess (no user selection) must be
// badged auto-selected, so it never looks identical to a user selection.
//
// main.ts is the guest iframe entry: it boots on import (guarded here with
// a minimal document stub) and talks to the host through @alcode/sdk, which
// is stubbed at the module boundary — the honesty helpers under test are
// pure and never touch the SDK.

import { describe, expect, mock, test } from 'bun:test';
import type { JsonValue } from '@alcode/sdk';
import { parseSnapshotDoc, type DagSnapshotView } from './dag-view.ts';

const noop = () => ({ dispose: () => {} });

mock.module('@alcode/sdk', () => ({
  connectHost: () => ({}),
}));

mock.module('@alcode/sdk/ui', () => ({
  applyHostReady: () => {},
  mountBadge: noop,
  mountBanner: noop,
  mountButton: noop,
  mountEmpty: noop,
  mountSpinner: noop,
  mountTextField: noop,
}));

// SAFETY: the guest boot guard reads global document.getElementById; the stub
// provides exactly that and nothing else, and the harness never navigates.
const testGlobals = globalThis as Record<string, { getElementById: (id: string) => null } | undefined>;
if (testGlobals.document === undefined) {
  testGlobals.document = { getElementById: () => null };
}

const panel = await import('./main.ts');
const { buildActivityTimeline } = await import('./activity-view.ts');

describe('inspector confidence honesty', () => {
  test('#given a node with no edges and no evidence #when formatted #then it renders an unknown marker, never 100 percent', () => {
    expect(panel.formatCodeConfidence(undefined)).toBe(panel.CODE_CONFIDENCE_UNKNOWN);
    expect(panel.formatCodeConfidence(undefined)).not.toBe('1');
  });

  test('#given measured edge confidence #when formatted #then the measured value renders as-is', () => {
    expect(panel.formatCodeConfidence(0.8)).toBe('0.8');
    expect(panel.formatCodeConfidence(1)).toBe('1');
  });
});

describe('details attribution rows', () => {
  const nodeView = (nodeId: string | null, taskId: string | null, delivery: { status: string | null; verificationStatus: 'verified' | 'unverified' | 'blocked' | null } | null = null) => ({
    id: 'node_build',
    taskId,
    nodeId,
    label: 'build',
    state: 'running',
    attempt: 1,
    prompt: 'build it',
    dependsOn: [],
    startedAt: null,
    completedAt: null,
    delivery,
  });

  test('#given a node with an owning DAG node id #when formatted #then the rendered node_id row shows it beside task_id', () => {
    const rows = panel.formatDetailsRows(nodeView('node_alpha', 'st_child01'));
    const terms = rows.map(([term]) => term);
    const row = rows.find(([term]) => term === 'node_id');
    expect(row).toEqual(['node_id', 'node_alpha']);
    expect(terms.indexOf('node_id')).toBe(terms.indexOf('task_id') + 1);
  });

  test('#given a node with no owning DAG node id #when formatted #then the node_id row renders an em dash, never an empty string', () => {
    const rows = panel.formatDetailsRows(nodeView(null, 'st_child01'));
    expect(rows.find(([term]) => term === 'node_id')).toEqual(['node_id', '\u2014']);
    expect(rows.find(([term]) => term === 'node_id')?.[1]).not.toBe('');
  });

  test('#given a node with no attribution at all #when formatted #then both attribution rows are explicit em dashes', () => {
    const rows = panel.formatDetailsRows(nodeView(null, null));
    expect(rows.find(([term]) => term === 'task_id')).toEqual(['task_id', '\u2014']);
    expect(rows.find(([term]) => term === 'node_id')).toEqual(['node_id', '\u2014']);
  });
});

const activityView = (): DagSnapshotView => ({
  sessionId: 'ses_activity',
  updatedAt: '2026-11-08T10:00:06.000Z',
  runs: [{
    runId: 'run-1',
    runKey: 'chat:ses_activity',
    name: 'run',
    status: 'running',
    counts: { pending: 0, running: 2, completed: 0, failed: 0, cancelled: 0 },
    nodes: [
      {
        id: 'node_alpha',
        taskId: null,
        nodeId: null,
        label: 'build',
        state: 'running',
        attempt: 1,
        prompt: 'build it',
        dependsOn: [],
        startedAt: '2026-11-08T10:00:00.000Z',
        completedAt: null,
      },
      {
        id: 'node_beta',
        taskId: null,
        nodeId: null,
        label: 'test',
        state: 'running',
        attempt: 1,
        prompt: 'test it',
        dependsOn: [],
        startedAt: '2026-11-08T10:00:01.000Z',
        completedAt: null,
      },
    ],
    edges: [],
    waves: [{ index: 0, nodeIds: ['node_alpha', 'node_beta'] }],
    repair: {
      attemptId: 'st_child01.e1.r1',
      taskId: 'st_child01',
      epoch: 1,
      state: 'diagnosing',
      failedChecks: [],
      rerunChecks: [],
      changedFiles: [],
      verificationStatus: null,
      hostFacts: [],
      modelHypotheses: [],
      updatedAt: Date.parse('2026-11-08T10:00:05.000Z'),
    },
  }],
  tasks: [],
});

describe('activity row identity visibility', () => {
  const built = buildActivityTimeline(activityView(), 'run-1');
  const nodeRows = built.rows.filter((row) => row.kind === 'node-started');
  const repairRow = built.rows.find((row) => row.kind === 'repair');

  test('#given builder-produced node lifecycle rows #when formatted #then each row shows its own node_id', () => {
    expect(nodeRows).toHaveLength(2);
    const ids = nodeRows.map((row) => (
      panel.formatActivityRowTexts(row).find((entry) => entry.className === 'dag-activity-node-id')?.text
    ));
    expect(ids).toEqual(['node_id node_alpha', 'node_id node_beta']);
  });

  test('#given a builder-produced repair row #when formatted #then its task id renders as task_id, never node_id', () => {
    expect(repairRow).toBeDefined();
    if (repairRow === undefined) return;
    const parts = panel.formatActivityRowTexts(repairRow);
    const idPart = parts.find((entry) => entry.className === 'dag-activity-node-id');
    expect(idPart?.text).toBe('task_id st_child01');
    expect(parts.map((entry) => entry.text)).not.toContain('node_id st_child01');
  });
});

const taskDoc = (tasks: JsonValue[]): JsonValue => ({
  schemaVersion: 1,
  sessionId: 'ses_tasks',
  updatedAt: '2026-11-08T10:00:06.000Z',
  dag: null,
  tasks: { tasks },
});

describe('task row node attribution', () => {
  test('#given a served task row carrying node_id #when parsed and rendered #then the row shows exactly that node beside its task id', () => {
    const servedNodeId = 'node_served_alpha';
    const outcome = parseSnapshotDoc(taskDoc([
      { task_id: 'st_child01', node_id: servedNodeId, status: 'running', name: 'build' },
    ]));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const task = outcome.view.tasks[0];
    expect(task).toBeDefined();
    if (task === undefined) return;
    const parts = panel.formatTaskRowTexts(task);
    expect(parts.find((part) => part.className === 'dag-task-id')?.text).toBe('task_id st_child01');
    const rendered = parts.find((part) => part.className === 'dag-task-node')?.text;
    expect(rendered).toBe(`node ${servedNodeId}`);
    expect(rendered).toBe(`node ${task.nodeId}`);
  });

  test('#given served task rows with no node_id or an empty one #when parsed and rendered #then the node cell is an explicit em dash, never a fabricated id', () => {
    const outcome = parseSnapshotDoc(taskDoc([
      { task_id: 'st_child02', status: 'running', name: 'test' },
      { task_id: 'st_child03', node_id: '', status: 'running', name: 'lint' },
    ]));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.view.tasks).toHaveLength(2);
    for (const task of outcome.view.tasks) {
      expect(task.nodeId).toBeNull();
      const nodePart = panel.formatTaskRowTexts(task).find((part) => part.className === 'dag-task-node')?.text;
      expect(nodePart).toBe('\u2014');
      expect(nodePart).not.toContain(task.taskId);
    }
  });
});

describe('details auto-selection honesty', () => {
  test('#given no user selection and a running node #when resolved #then the panel guess is badged auto-selected', () => {
    expect(panel.resolveDetailsSelection(['a', 'b'], 'b', null)).toEqual({ id: 'b', autoSelected: true });
  });

  test('#given no user selection and no running node #when resolved #then the first node is an auto-selected guess', () => {
    expect(panel.resolveDetailsSelection(['a', 'b'], null, null)).toEqual({ id: 'a', autoSelected: true });
  });

  test('#given an explicit user selection #when resolved #then it is never marked auto-selected', () => {
    expect(panel.resolveDetailsSelection(['a', 'b'], 'b', 'a')).toEqual({ id: 'a', autoSelected: false });
  });

  test('#given an empty run #when resolved #then there is no selection to badge', () => {
    expect(panel.resolveDetailsSelection([], null, null)).toEqual({ id: null, autoSelected: true });
  });
});

describe('delivery verification row', () => {
  const nodeWith = (verificationStatus: 'verified' | 'unverified' | 'blocked' | null) => ({
    id: 'node_build',
    taskId: 'st_child01',
    nodeId: null,
    label: 'build',
    state: 'completed',
    attempt: 1,
    prompt: 'build it',
    dependsOn: [],
    startedAt: null,
    completedAt: null,
    delivery: { status: 'completed', verificationStatus },
  });

  test('#given a verified delivery #when formatted #then the row states verified', () => {
    const rows = panel.formatDetailsRows(nodeWith('verified'));
    expect(rows).toContainEqual(['verification', 'verified']);
    expect(rows.find(([key]) => key === 'state')?.[1]).toBe('completed');
  });

  test('#given an unknown verification value #when formatted #then the row says unknown, never verified', () => {
    const rows = panel.formatDetailsRows(nodeWith(null));
    expect(rows).toContainEqual(['verification', 'unknown']);
    expect(rows.some(([, value]) => value === 'verified')).toBe(false);
  });

  test('#given a legacy node with no delivery block #when formatted #then no verification row is invented', () => {
    const legacy = { id: 'n', taskId: null, nodeId: null, label: 'l', state: 'completed', attempt: 1, prompt: 'p', dependsOn: [], startedAt: null, completedAt: null };
    expect(panel.formatDetailsRows(legacy).some(([key]) => key === 'verification')).toBe(false);
  });
});
