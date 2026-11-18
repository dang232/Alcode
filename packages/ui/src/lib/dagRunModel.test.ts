// Run-model builder proofs: real delegation records in, renderable run out.
// Fixtures mirror the opencode shapes (parent/child sessions, subagent tool
// calls, synthetic reports); no mocks, every node traces to a fixture row.
import { describe, expect, test } from 'bun:test';

import type { JsonValue } from '@alcode/sdk';

import type { AssistantMessage, Message, Part, Session, SyntheticMessage, TextPart, ToolInput, ToolPart } from '@/lib/opencode/model';
import { buildDagRunModel, dagRunModelToSnapshotDoc, dagRunSnapshotStatus, type DagRunModelInput } from './dagRunModel';
import { parseSnapshotDoc } from '../../../extensions/dag-pane/panel/dag-view.ts';

const parent = (overrides: Partial<Session> = {}): Session => ({
  id: 'ses_parent01',
  projectID: 'proj_1',
  directory: '/tmp/proj',
  title: 'Repository analysis with three independent investigations',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000, updated: 9000 },
  ...overrides,
});

const child = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  parentID: 'ses_parent01',
  projectID: 'proj_1',
  directory: '/tmp/proj',
  title: `Analyze ${id}`,
  agent: 'explore',
  cost: 0.001,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 2000, updated: 8000 },
  ...overrides,
});

const userMessage = (id: string, text: string, sessionId = 'ses_parent01'): Message => ({
  id, sessionID: sessionId, role: 'user', time: { created: 1100 },
});

const userTextPart = (id: string, messageId: string, text: string, sessionId = 'ses_parent01'): TextPart => (
  { id, sessionID: sessionId, messageID: messageId, type: 'text', text }
);

const assistantMessage = (id: string, sessionId = 'ses_parent01'): AssistantMessage => ({
  id, sessionID: sessionId, role: 'assistant', time: { created: 1500, completed: 1600 },
  agent: 'a', providerID: 'p', modelID: 'm',
});

const toolCall = (id: string, messageId: string, input: ToolInput, status: 'completed', childId: string, sessionId = 'ses_parent01'): ToolPart => (
  {
    id, sessionID: sessionId, messageID: messageId, type: 'tool', callID: `call_${id}`, tool: 'subagent',
    state: { status, input, output: '', metadata: { sessionID: childId }, time: { start: 2000, end: 8000 } },
  }
);

const errorToolCall = (id: string, messageId: string, input: ToolInput, childId: string, sessionId = 'ses_parent01'): ToolPart => (
  {
    id, sessionID: sessionId, messageID: messageId, type: 'tool', callID: `call_${id}`, tool: 'subagent',
    state: { status: 'error', input, error: 'Subagent failed', metadata: { sessionID: childId }, time: { start: 2000, end: 8000 } },
  }
);

const stateReport = (id: string, childId: string, output: string, state: 'completed' | 'error' | 'cancelled', sessionId = 'ses_parent01'): SyntheticMessage => ({
  id, sessionID: sessionId, role: 'synthetic', time: { created: 8500 }, text: output,
  description: `Subagent ${childId} finished`,
  metadata: { source: 'subagent', childID: childId, agent: 'explore', state },
});

const report = (id: string, childId: string, output: string, sessionId = 'ses_parent01'): SyntheticMessage => ({
  id, sessionID: sessionId, role: 'synthetic', time: { created: 8500 }, text: output,
  description: `Subagent ${childId} finished`,
  metadata: { source: 'subagent', childID: childId, agent: 'explore', state: 'completed' },
});

const inputOf = (overrides: Partial<DagRunModelInput> = {}): DagRunModelInput => ({
  conversationId: 'ses_parent01',
  conversationTitle: 'Repository analysis with three independent investigations',
  sessions: [parent()],
  statuses: { ses_parent01: { type: 'idle' } },
  messages: [],
  parts: {},
  ...overrides,
});

const partsOf = (entries: [string, Part[]][]): Record<string, Part[]> => Object.fromEntries(entries);

describe('buildDagRunModel', () => {
  test('a conversation with no delegation evidence is no run, even when busy', () => {
    const idle = buildDagRunModel(inputOf());
    expect(idle).toBeNull();
    const busy = buildDagRunModel(inputOf({ statuses: { ses_parent01: { type: 'busy' } } }));
    expect(busy).toBeNull();
  });

  test('an unknown conversation is no run', () => {
    expect(buildDagRunModel(inputOf({ conversationId: 'ses_nope' }))).toBeNull();
  });

  test('partial store slices never throw: they read as empty', () => {
    const base = inputOf();
    expect(buildDagRunModel({ ...base, sessions: undefined })).toBeNull();
    expect(buildDagRunModel({ ...base, messages: undefined })).toBeNull();
    expect(buildDagRunModel({ ...base, parts: undefined })).toBeNull();
    expect(buildDagRunModel({ ...base, statuses: undefined })).toBeNull();
    const thinChild = child('ses_thin', { time: undefined });
    const thin = buildDagRunModel(inputOf({
      sessions: [parent(), thinChild],
      messages: [assistantMessage('m2'), report('r1', 'ses_thin', 'ok')],
      parts: {},
    }));
    expect(thin?.children[0]?.startedAt).toBeNull();
  });

  test('three reported children become three labeled nodes under the parent', () => {
    const kids = [child('ses_a'), child('ses_b'), child('ses_c')];
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), ...kids],
      statuses: { ses_parent01: { type: 'idle' } },
      messages: [
        userMessage('m1', 'ulw: analyze this repo, one child per file'),
        assistantMessage('m2'),
        report('r1', 'ses_a', 'alpha: string utils'),
        report('r2', 'ses_b', 'beta: math utils'),
        report('r3', 'ses_c', 'gamma: entry point'),
      ],
      parts: partsOf([
        ['m1', [userTextPart('p1', 'm1', 'ulw: analyze this repo, one child per file')]],
        ['m2', [
          toolCall('t1', 'm2', { description: 'Analyze alpha' }, 'completed', 'ses_a'),
          toolCall('t2', 'm2', { description: 'Analyze beta' }, 'completed', 'ses_b'),
          toolCall('t3', 'm2', { description: 'Analyze gamma' }, 'completed', 'ses_c'),
        ]],
      ]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.parentSessionId).toBe('ses_parent01');
    expect(model.children).toHaveLength(3);
    expect(model.children.map((c) => c.sessionId).sort()).toEqual(['ses_a', 'ses_b', 'ses_c']);
    expect(model.children.every((c) => c.state === 'completed')).toBe(true);
    expect(model.children.every((c) => c.agent === 'explore')).toBe(true);
    expect(model.state).toBe('completed');
    expect(model.synthesis.state).toBe('ready');
    expect(model.counts).toEqual({ pending: 0, running: 0, completed: 3, failed: 0, cancelled: 0 });
    expect(model.children[0]?.output).toContain('alpha: string utils');
  });

  test('labels prefer conversation title, then task description, never raw ids', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent({ title: '' }), child('ses_a')],
      conversationTitle: null,
      messages: [
        userMessage('m1', 'Repository analysis with three independent investigations'),
        assistantMessage('m2'),
        report('r1', 'ses_a', 'done'),
      ],
      parts: partsOf([
        ['m1', [userTextPart('p1', 'm1', 'Repository analysis with three independent investigations')]],
        ['m2', [toolCall('t1', 'm2', { description: 'Explore architecture' }, 'completed', 'ses_a')]],
      ]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.label).toBe('Repository analysis with three independent investigations');
    expect(model.children[0]?.label).toContain('Explore architecture');
    for (const label of [model.label, ...model.children.map((c) => c.label)]) {
      expect(label.startsWith('ses_')).toBe(false);
    }
  });

  test('a running child keeps the parent running and the synthesis pending', () => {
    const runningCall: ToolPart = {
      id: 't1', sessionID: 'ses_parent01', messageID: 'm2', type: 'tool', callID: 'call_t1', tool: 'subagent',
      state: { status: 'running', input: { description: 'Analyze alpha' }, time: { start: 2000 } },
    };
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_a')],
      statuses: { ses_parent01: { type: 'busy' }, ses_a: { type: 'busy' } },
      messages: [assistantMessage('m2')],
      parts: partsOf([['m2', [runningCall]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.state).toBe('running');
    expect(model.children[0]?.state).toBe('running');
    expect(model.synthesis).toEqual({ state: 'pending', text: null });
  });

  test('idle orphans with no call and no report are not the run’s delegation', () => {
    const withReport = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_orphan', { agent: undefined, title: 'Shared context' })],
      messages: [assistantMessage('m2'), report('r1', 'ses_orphan', 'unrelated')],
      parts: {},
    }));
    // A report alone still counts (the engine settled a delegation), but a
    // bare idle record with neither call nor report does not.
    expect(withReport?.children.map((c) => c.sessionId)).toContain('ses_orphan');
    const bare = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_orphan', { agent: undefined })],
      messages: [],
      parts: {},
    }));
    expect(bare).toBeNull();
  });

  test('revisiting another conversation yields only its own run', () => {
    const first = buildDagRunModel(inputOf());
    expect(first).toBeNull();
    const second = buildDagRunModel(inputOf({
      conversationId: 'ses_other',
      sessions: [parent({ id: 'ses_other', title: 'Other work' })],
      messages: [userMessage('m9', 'plain chat', 'ses_other')],
      parts: partsOf([['m9', [userTextPart('p9', 'm9', 'plain chat', 'ses_other')]]]),
    }));
    expect(second).toBeNull();
  });

  test('real fresh-run records keep their identities and readable titles', () => {
    // Values captured from the live 2026-10-13 delegation run
    // (parent ses_ecac0091, three explore children with engine titles).
    const pid = 'ses_ecac00918ffegnW8yWI3QytT0R';
    const kids = [
      'ses_ecabfa068ffeCCMcLRU8FRBhoZ',
      'ses_ecabfa05fffe0t1nCQ955rAdN1',
      'ses_ecabfa048ffeJuZJBuAMBrKSLj',
    ];
    const model = buildDagRunModel({
      conversationId: pid,
      conversationTitle: 'Repository analysis with three independent investigations',
      sessions: [
        parent({ id: pid, title: 'oh-my-openagent run' }),
        child(kids[0], { parentID: pid, title: 'Delegation: curious-azure-lynx' }),
        child(kids[1], { parentID: pid, title: 'Delegation: curious-azure-falcon' }),
        child(kids[2], { parentID: pid, title: 'Delegation: eager-azure-falcon' }),
      ],
      statuses: { [pid]: { type: 'idle' } },
      messages: [
        userMessage('m1', 'ulw: analyze this tiny repo', pid),
        assistantMessage('m2', pid),
        report('r1', kids[0], 'alpha done', pid),
        report('r2', kids[1], 'beta done', pid),
        report('r3', kids[2], 'gamma done', pid),
      ],
      parts: partsOf([
        ['m1', [userTextPart('p1', 'm1', 'ulw: analyze this tiny repo', pid)]],
        ['m2', [
          toolCall('t1', 'm2', { description: 'Analyze alpha' }, 'completed', kids[0], pid),
          toolCall('t2', 'm2', { description: 'Analyze beta' }, 'completed', kids[1], pid),
          toolCall('t3', 'm2', { description: 'Analyze gamma' }, 'completed', kids[2], pid),
        ]],
      ]),
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.parentSessionId).toBe(pid);
    expect(model.children.map((c) => c.sessionId).sort()).toEqual([...kids].sort());
    expect(model.label).toBe('Repository analysis with three independent investigations');
    expect(model.children[0]?.agent).toBe('explore');
  });
});

describe('dagRunModelToSnapshotDoc', () => {
  test('a completed run becomes one parent, three children, and synthesis with edges', () => {
    const kids = [child('ses_a'), child('ses_b'), child('ses_c')];
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), ...kids],
      messages: [
        userMessage('m1', 'analyze'),
        assistantMessage('m2'),
        report('r1', 'ses_a', 'a'), report('r2', 'ses_b', 'b'), report('r3', 'ses_c', 'c'),
      ],
      parts: partsOf([
        ['m1', [userTextPart('p1', 'm1', 'analyze')]],
        ['m2', [
          toolCall('t1', 'm2', { description: 'A' }, 'completed', 'ses_a'),
          toolCall('t2', 'm2', { description: 'B' }, 'completed', 'ses_b'),
          toolCall('t3', 'm2', { description: 'C' }, 'completed', 'ses_c'),
        ]],
      ]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    const outcome = parseSnapshotDoc(dagRunModelToSnapshotDoc(model));
    if (!outcome.ok) throw new Error(`doc must parse: ${outcome.error.field}`);
    const run = outcome.view.runs[0];
    if (!run) throw new Error('doc must carry one run');
    expect(run.nodes.map((n) => n.id)).toEqual(['parent', 'ses_a', 'ses_b', 'ses_c', 'synthesis']);
    // bun:test has no toContainEqual type: same deep-contains check via some().
    const hasEdge = (from: string, to: string) => run.edges.some((edge) => edge.from === from && edge.to === to);
    expect(hasEdge('parent', 'ses_a')).toBe(true);
    expect(hasEdge('ses_c', 'synthesis')).toBe(true);
    expect(run.waves.map((w) => w.nodeIds)).toEqual([['parent'], ['ses_a', 'ses_b', 'ses_c'], ['synthesis']]);
    const childNode = run.nodes.find((n) => n.id === 'ses_a');
    expect(childNode?.prompt).toBe('A\n\nResult:\na');
  });
});

describe('dagRunSnapshotStatus', () => {
  const docOf = (status: string) => ({
    schemaVersion: 1,
    sessionId: 'ses_parent01',
    updatedAt: '2026-10-14T00:00:00.000Z',
    dag: { runs: [{ run_id: 'ses_parent01', run_key: 'chat:ses_parent01', name: 'n', status, nodes: [], edges: [] }] },
    tasks: null,
  });
  test('reads the first-run status for the persist throttle', () => {
    expect(dagRunSnapshotStatus(docOf('running'))).toBe('running');
    expect(dagRunSnapshotStatus(docOf('completed'))).toBe('completed');
    expect(dagRunSnapshotStatus(docOf('failed'))).toBe('failed');
  });
  test('unreadable docs answer null, never a default status', () => {
    expect(dagRunSnapshotStatus(null)).toBeNull();
    expect(dagRunSnapshotStatus({ schemaVersion: 1, sessionId: 's', dag: { runs: [] } })).toBeNull();
    expect(dagRunSnapshotStatus({ schemaVersion: 1, sessionId: 's', dag: null, tasks: null })).toBeNull();
  });
});

describe('dag truthfulness regressions (audit-fixes-b)', () => {
  test('an errored subagent call classifies the child failed, never completed', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_err')],
      messages: [assistantMessage('m2')],
      parts: partsOf([['m2', [errorToolCall('t1', 'm2', { description: 'Analyze alpha' }, 'ses_err')]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children.map((c) => c.sessionId)).toEqual(['ses_err']);
    expect(model.children[0]?.state).toBe('failed');
  });

  test('failed plus cancelled children are counted, not vanished', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_f'), child('ses_c')],
      messages: [
        assistantMessage('m2'),
        stateReport('r1', 'ses_f', 'boom', 'error'),
        stateReport('r2', 'ses_c', 'stopped', 'cancelled'),
      ],
      parts: partsOf([['m2', [
        errorToolCall('t1', 'm2', { description: 'F' }, 'ses_f'),
        toolCall('t2', 'm2', { description: 'C' }, 'completed', 'ses_c'),
      ]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children.find((c) => c.sessionId === 'ses_f')?.state).toBe('failed');
    expect(model.children.find((c) => c.sessionId === 'ses_c')?.state).toBe('cancelled');
    expect(model.counts).toEqual({ pending: 0, running: 0, completed: 0, failed: 1, cancelled: 1 });
    expect(model.progress).toEqual({ total: 2, settled: 2 });
  });

  test('a parent whose every child failed is failed', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_a'), child('ses_b')],
      messages: [
        assistantMessage('m2'),
        stateReport('r1', 'ses_a', 'boom-a', 'error'),
        stateReport('r2', 'ses_b', 'boom-b', 'error'),
      ],
      parts: partsOf([['m2', [
        errorToolCall('t1', 'm2', { description: 'A' }, 'ses_a'),
        errorToolCall('t2', 'm2', { description: 'B' }, 'ses_b'),
      ]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children.every((c) => c.state === 'failed')).toBe(true);
    expect(model.state).toBe('failed');
  });

  test('an interrupted parent is cancelled, never completed', () => {
    // The ladder used to end in an unconditional completed, so an interrupted run persisted as a green run and the
    // next read showed it that way. Cancelled is a lifecycle answer of its own, not a success.
    const model = buildDagRunModel(inputOf({
      sessions: [parent({ outcome: 'interrupted' }), child('ses_a')],
      messages: [assistantMessage('m2'), stateReport('r1', 'ses_a', 'done', 'completed')],
      parts: partsOf([['m2', [toolCall('t1', 'm2', { description: 'A' }, 'completed', 'ses_a')]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children[0]?.state).toBe('completed');
    expect(model.state).toBe('cancelled');
    const doc = dagRunModelToSnapshotDoc(model);
    expect(dagRunSnapshotStatus(doc)).toBe('cancelled');
  });

  test('a parent whose every child was cancelled is cancelled', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_a'), child('ses_b')],
      messages: [
        assistantMessage('m2'),
        stateReport('r1', 'ses_a', 'stopped', 'cancelled'),
        stateReport('r2', 'ses_b', 'stopped', 'cancelled'),
      ],
      parts: partsOf([['m2', [
        toolCall('t1', 'm2', { description: 'A' }, 'completed', 'ses_a'),
        toolCall('t2', 'm2', { description: 'B' }, 'completed', 'ses_b'),
      ]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.counts.cancelled).toBe(2);
    expect(model.state).toBe('cancelled');
  });

  test('a cancelled run still renders a lifecycle the pane can paint', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent({ outcome: 'interrupted' }), child('ses_a')],
      messages: [assistantMessage('m2'), stateReport('r1', 'ses_a', 'done', 'completed')],
      parts: partsOf([['m2', [toolCall('t1', 'm2', { description: 'A' }, 'completed', 'ses_a')]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    const outcome = parseSnapshotDoc(dagRunModelToSnapshotDoc(model));
    if (!outcome.ok) throw new Error(`doc must parse: ${outcome.error.field}`);
    expect(outcome.view.runs[0]?.status).toBe('cancelled');
    expect(outcome.view.tasks).toEqual([]);
  });

  test('an explicit succeeded outcome keeps the parent completed even when every child failed', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent({ outcome: 'succeeded' }), child('ses_a')],
      messages: [assistantMessage('m2'), stateReport('r1', 'ses_a', 'boom', 'error')],
      parts: partsOf([['m2', [errorToolCall('t1', 'm2', { description: 'A' }, 'ses_a')]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children[0]?.state).toBe('failed');
    expect(model.state).toBe('completed');
  });

  test('a child with no creation time keeps startedAt null and serializes null, never epoch zero', () => {
    const thinChild = child('ses_thin', { time: undefined });
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), thinChild],
      messages: [assistantMessage('m2'), report('r1', 'ses_thin', 'ok')],
      parts: {},
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children[0]?.startedAt).toBeNull();
    // SAFETY: the doc is built by dagRunModelToSnapshotDoc from the thin
    // fixture above, so runs[0].nodes carries string ids with nullable
    // started_at; the assertion only names the fields this test reads.
    const doc = dagRunModelToSnapshotDoc(model) as {
      dag: { runs: [{ nodes: [{ id: string; started_at: string | null }] }] };
    };
    const node = doc.dag.runs[0]?.nodes.find((n) => n.id === 'ses_thin');
    expect(node?.started_at).toBeNull();
  });
});

describe('chat-path attribution from the task-record index', () => {
  type WireNode = { id: string; task_id?: string; node_id?: string };
  type WireRun = {
    run_key: string;
    nodes: WireNode[];
    edges: { from: string; to: string }[];
    waves: { index: number; node_ids: string[] }[];
  };

  const runOf = (doc: JsonValue): WireRun => {
    // SAFETY: every doc in this block comes from dagRunModelToSnapshotDoc,
    // which emits exactly one run carrying this envelope.
    return (doc as { dag: { runs: [WireRun] } }).dag.runs[0];
  };

  const nodeOf = (doc: JsonValue, id: string): WireNode => {
    const node = runOf(doc).nodes.find((candidate) => candidate.id === id);
    if (!node) throw new Error(`fixture must serialize node ${id}`);
    return node;
  };

  const twoChildModel = () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_a'), child('ses_b')],
      messages: [assistantMessage('m2'), report('r1', 'ses_a', 'a'), report('r2', 'ses_b', 'b')],
      parts: partsOf([['m2', [
        toolCall('t1', 'm2', { description: 'A' }, 'completed', 'ses_a'),
        toolCall('t2', 'm2', { description: 'B' }, 'completed', 'ses_b'),
      ]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    return model;
  };

  test('a known child session carries its persisted task and node ids', () => {
    const doc = dagRunModelToSnapshotDoc(twoChildModel(), {
      ses_a: { taskId: 'st_a', nodeId: 'node_alpha' },
    });

    const node = nodeOf(doc, 'ses_a');
    expect(node.task_id).toBe('st_a');
    expect(node.node_id).toBe('node_alpha');
  });

  test('an unknown session keeps both fields absent, never empty strings', () => {
    const doc = dagRunModelToSnapshotDoc(twoChildModel(), {
      ses_a: { taskId: 'st_a', nodeId: 'node_alpha' },
    });

    const known = nodeOf(doc, 'ses_a');
    const unknown = nodeOf(doc, 'ses_b');
    expect(known.task_id).toBe('st_a');
    expect(Object.hasOwn(unknown, 'task_id')).toBe(false);
    expect(Object.hasOwn(unknown, 'node_id')).toBe(false);
    expect(JSON.stringify(unknown)).not.toContain('task_id');
  });

  test('a record without a DAG owner contributes task_id but no node_id', () => {
    const doc = dagRunModelToSnapshotDoc(twoChildModel(), { ses_b: { taskId: 'st_b' } });

    const node = nodeOf(doc, 'ses_b');
    expect(node.task_id).toBe('st_b');
    expect(Object.hasOwn(node, 'node_id')).toBe(false);
  });

  test('an absent or empty index leaves the whole document byte-identical', () => {
    const model = twoChildModel();
    const baseline = JSON.stringify(dagRunModelToSnapshotDoc(model));

    expect(JSON.stringify(dagRunModelToSnapshotDoc(model, null))).toBe(baseline);
    expect(JSON.stringify(dagRunModelToSnapshotDoc(model, {}))).toBe(baseline);
  });

  test('a stale index naming no child of this run leaves the document untouched', () => {
    const model = twoChildModel();
    const baseline = JSON.stringify(dagRunModelToSnapshotDoc(model));

    expect(JSON.stringify(dagRunModelToSnapshotDoc(model, {
      ses_old: { taskId: 'st_old', nodeId: 'node_old' },
    }))).toBe(baseline);
  });

  test('attribution adds node fields without changing ids, edges, or waves', () => {
    const model = twoChildModel();
    const baseline = runOf(dagRunModelToSnapshotDoc(model));
    const attributed = runOf(dagRunModelToSnapshotDoc(model, {
      ses_a: { taskId: 'st_a', nodeId: 'node_alpha' },
    }));

    expect(attributed.run_key).toBe(baseline.run_key);
    expect(attributed.nodes.map((node) => node.id)).toEqual(baseline.nodes.map((node) => node.id));
    expect(attributed.edges).toEqual(baseline.edges);
    expect(attributed.waves).toEqual(baseline.waves);
  });
});
