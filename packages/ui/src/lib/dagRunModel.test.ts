// Run-model builder proofs: real delegation records in, renderable run out.
// Fixtures mirror the opencode shapes (parent/child sessions, subagent tool
// calls, synthetic reports); no mocks, every node traces to a fixture row.
import { describe, expect, test } from 'bun:test';

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
    expect(thin?.children[0]?.startedAt).toBe(0);
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
    expect(model.counts).toEqual({ pending: 0, running: 0, completed: 3 });
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
    expect(run.edges).toContainEqual({ from: 'parent', to: 'ses_a' });
    expect(run.edges).toContainEqual({ from: 'ses_c', to: 'synthesis' });
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
