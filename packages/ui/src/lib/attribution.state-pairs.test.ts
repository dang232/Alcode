// (state, task_id) presence control for the chat-path snapshot document.
//
// A task id may legitimately be absent while a node has not settled: a fresh
// run has no task record yet, and the engine's pending, blocked, scheduled,
// and skipped nodes never launched a child. The same absence on a settled node
// is a lost attribution, so this control fails it.
//
// The document under test is the real producer output from
// buildDagRunModel + dagRunModelToSnapshotDoc, parsed through the panel's own
// parseSnapshotDoc. The attribution index is the child-session slice the
// run-graph route serves from the engine's task records.
import { describe, expect, test } from 'bun:test';
import type { JsonValue } from '@alcode/sdk';
import type { Session, SyntheticMessage } from '@/lib/opencode/model';
import {
  buildDagRunModel,
  dagRunModelToSnapshotDoc,
  type DagAttributionIndex,
  type DagRunModelInput,
} from './dagRunModel';
import { parseSnapshotDoc, type DagNodeView } from '../../../extensions/dag-pane/panel/dag-view.ts';

const PARENT_ID = 'ses_parent01';

// States whose attribution is required once the node is a child session.
const REQUIRED_TASK_ID_STATES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

// States that never launched a child, so absence is the honest answer. The
// engine skips a node when a dependency fails; a skipped node has no task.
const ABSENCE_TOLERATED_STATES: ReadonlySet<string> = new Set([
  'pending',
  'blocked',
  'scheduled',
  'skipped',
]);

type PresenceRow = {
  id: string;
  state: string;
  taskIdPresent: boolean;
  childSession: boolean;
};

type StatePairViolation = {
  id: string;
  state: string;
};

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  projectID: 'proj_1',
  directory: '/tmp/proj',
  title: id,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000, updated: 9000 },
  ...overrides,
});

const parent = (): Session => session(PARENT_ID, { title: 'Delegated run' });

const child = (id: string, created = 2000): Session => session(id, {
  parentID: PARENT_ID,
  agent: 'explore',
  time: { created, updated: 8000 },
});

const report = (
  id: string,
  childId: string,
  state: 'completed' | 'error' | 'cancelled',
): SyntheticMessage => ({
  id,
  sessionID: PARENT_ID,
  role: 'synthetic',
  time: { created: 8500 },
  text: `${childId} ${state}`,
  description: `Subagent ${childId} finished`,
  metadata: { source: 'subagent', childID: childId, agent: 'explore', state },
});

const modelOf = (input: DagRunModelInput) => {
  const model = buildDagRunModel(input);
  if (model === null) throw new Error('fixture must build a run');
  return model;
};

// One settled child per required state. The parent is idle, so the run and
// its synthesis node are completed too; neither is a child session.
const settledRun = () => modelOf({
  conversationId: PARENT_ID,
  conversationTitle: 'Delegated run',
  sessions: [parent(), child('ses_done'), child('ses_fail'), child('ses_cancel')],
  statuses: { [PARENT_ID]: { type: 'idle' } },
  messages: [
    report('r_done', 'ses_done', 'completed'),
    report('r_fail', 'ses_fail', 'error'),
    report('r_cancel', 'ses_cancel', 'cancelled'),
  ],
  parts: {},
});

// A run whose only child is still live: no task record exists yet.
const liveRun = () => modelOf({
  conversationId: PARENT_ID,
  conversationTitle: 'Delegated run',
  sessions: [parent(), child('ses_live')],
  statuses: { [PARENT_ID]: { type: 'busy' }, ses_live: { type: 'busy' } },
  messages: [],
  parts: {},
});

const knownIndex: DagAttributionIndex = {
  ses_done: { taskId: 'st_done', nodeId: 'node_done' },
  ses_fail: { taskId: 'st_fail', nodeId: 'node_fail' },
  ses_cancel: { taskId: 'st_cancel', nodeId: 'node_cancel' },
};

const nodesOf = (doc: JsonValue): DagNodeView[] => {
  const outcome = parseSnapshotDoc(doc);
  if (!outcome.ok) throw new Error(`snapshot must parse: ${outcome.error.field}`);
  const run = outcome.view.runs[0];
  if (!run) throw new Error('snapshot must carry one run');
  return run.nodes;
};

const rowsOf = (nodes: readonly DagNodeView[], childIds: ReadonlySet<string>): PresenceRow[] => (
  nodes.map((node) => ({
    id: node.id,
    state: node.state,
    taskIdPresent: node.taskId !== null,
    childSession: childIds.has(node.id),
  }))
);

const violationsOf = (rows: readonly PresenceRow[]): StatePairViolation[] => (
  rows
    .filter((row) => row.childSession && REQUIRED_TASK_ID_STATES.has(row.state) && !row.taskIdPresent)
    .map((row) => ({ id: row.id, state: row.state }))
);

const tableOf = (rows: readonly PresenceRow[]): string => rows
  .map((row) => `${row.id} | ${row.state} | task_id: ${row.taskIdPresent ? 'present' : 'absent'} | child: ${row.childSession ? 'yes' : 'no'}`)
  .join('\n');

const QA = process.env.ATTRIBUTION_STATE_PAIRS_QA === '1';

const printTable = (label: string, rows: readonly PresenceRow[]): void => {
  if (QA) console.log(`${label}\n${tableOf(rows)}`);
};

describe('(state, task_id) presence pairs', () => {
  test('a fully-known index leaves no settled child without a task id', () => {
    const model = settledRun();
    const childIds = new Set(model.children.map((entry) => entry.sessionId));
    const rows = rowsOf(nodesOf(dagRunModelToSnapshotDoc(model, knownIndex)), childIds);

    printTable('known index', rows);
    expect(violationsOf(rows)).toEqual([]);

    for (const state of REQUIRED_TASK_ID_STATES) {
      const settled = rows.filter((row) => row.childSession && row.state === state);
      expect(settled.length).toBe(1);
      expect(settled.every((row) => row.taskIdPresent)).toBe(true);
    }

    // The parent and synthesis nodes are completed and carry no task id. They
    // are not child sessions, so the control must not count them.
    const completedNonChildren = rows
      .filter((row) => !row.childSession && row.state === 'completed')
      .map((row) => row.id)
      .sort();
    expect(completedNonChildren).toEqual(['parent', 'synthesis']);
  });

  test('an empty index reports every settled child as a violation', () => {
    const model = settledRun();
    const childIds = new Set(model.children.map((entry) => entry.sessionId));
    const rows = rowsOf(nodesOf(dagRunModelToSnapshotDoc(model, {})), childIds);
    const violations = violationsOf(rows);

    printTable('empty index', rows);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      { id: 'ses_cancel', state: 'cancelled' },
      { id: 'ses_done', state: 'completed' },
      { id: 'ses_fail', state: 'failed' },
    ]);
    // The two completed non-child nodes stay out of the violation list.
    expect(violations).toHaveLength(3);
  });

  test('a fresh run tolerates absent task ids while its child is live', () => {
    const model = liveRun();
    const childIds = new Set(model.children.map((entry) => entry.sessionId));
    const rows = rowsOf(nodesOf(dagRunModelToSnapshotDoc(model, {})), childIds);

    printTable('fresh run, empty index', rows);
    expect(violationsOf(rows)).toEqual([]);
    const live = rows.find((row) => row.id === 'ses_live');
    expect(live?.state).toBe('running');
    expect(live?.taskIdPresent).toBe(false);
  });

  test('engine states that never launched a child tolerate absence', () => {
    const rows: PresenceRow[] = [...ABSENCE_TOLERATED_STATES].map((state) => ({
      id: `ses_${state}`,
      state,
      taskIdPresent: false,
      childSession: true,
    }));

    expect(violationsOf(rows)).toEqual([]);
  });

  test('a stale index reports the settled child it no longer names', () => {
    const model = settledRun();
    const childIds = new Set(model.children.map((entry) => entry.sessionId));
    const stale: DagAttributionIndex = {
      ses_done: { taskId: 'st_done', nodeId: 'node_done' },
      ses_fail: { taskId: 'st_fail', nodeId: 'node_fail' },
      ses_gone: { taskId: 'st_gone', nodeId: 'node_gone' },
    };
    const rows = rowsOf(nodesOf(dagRunModelToSnapshotDoc(model, stale)), childIds);

    expect(violationsOf(rows)).toEqual([{ id: 'ses_cancel', state: 'cancelled' }]);
  });

  test('an empty task id reads as absence', () => {
    const model = settledRun();
    const childIds = new Set(model.children.map((entry) => entry.sessionId));
    const emptyId: DagAttributionIndex = {
      ...knownIndex,
      ses_done: { taskId: '', nodeId: 'node_done' },
    };
    const rows = rowsOf(nodesOf(dagRunModelToSnapshotDoc(model, emptyId)), childIds);

    expect(violationsOf(rows)).toEqual([{ id: 'ses_done', state: 'completed' }]);
  });
});
