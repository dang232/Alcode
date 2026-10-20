// Run-model builder proofs: real delegation records in, renderable run out.
// Fixtures mirror the opencode shapes (parent/child sessions, subagent tool
// calls, synthetic reports); no mocks, every node traces to a fixture row.
import { describe, expect, test } from 'bun:test';

import type { AssistantMessage, Message, Part, Session, SyntheticMessage, TextPart, ToolInput, ToolPart } from '@/lib/opencode/model';
import { buildDagRunModel, dagRunModelToSnapshotDoc, dagRunSnapshotStatus, isUlwBookkeepingShellCommand, isUlwOrchestrationPart, isUlwTool, readNativeRunId, type DagRunModelInput } from './dagRunModel';
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

const errorCall = (id: string, messageId: string, input: ToolInput, childId: string, sessionId = 'ses_parent01'): ToolPart => (
  {
    id, sessionID: sessionId, messageID: messageId, type: 'tool', callID: `call_${id}`, tool: 'subagent',
    state: { status: 'error', input, error: 'provider 400 tool_choice', metadata: { sessionID: childId }, time: { start: 2000, end: 8000 } },
  }
);

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

  test('an errored tool call with no report is a failed child, never completed', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_a')],
      statuses: { ses_parent01: { type: 'idle' }, ses_a: { type: 'idle' } },
      messages: [assistantMessage('m2')],
      parts: partsOf([['m2', [errorCall('t1', 'm2', { description: 'Analyze alpha' }, 'ses_a')]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children[0]?.state).toBe('failed');
  });

  test('a child session outcome of failed or interrupted settles the node', () => {
    const failed = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_a', { outcome: 'failed' })],
      statuses: { ses_parent01: { type: 'idle' }, ses_a: { type: 'idle' } },
      messages: [assistantMessage('m2')],
      parts: partsOf([['m2', [toolCall('t1', 'm2', { description: 'Analyze alpha' }, 'completed', 'ses_a')]]]),
    }));
    if (failed === null) throw new Error('fixture must build a run');
    expect(failed.children[0]?.state).toBe('failed');
    const interrupted = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_b', { outcome: 'interrupted' })],
      statuses: { ses_parent01: { type: 'idle' }, ses_b: { type: 'idle' } },
      messages: [assistantMessage('m2')],
      parts: partsOf([['m2', [toolCall('t1', 'm2', { description: 'Analyze beta' }, 'completed', 'ses_b')]]]),
    }));
    if (interrupted === null) throw new Error('fixture must build a run');
    expect(interrupted.children[0]?.state).toBe('cancelled');
  });

  test('an errored call on a busy child still reads running until it settles', () => {
    const model = buildDagRunModel(inputOf({
      sessions: [parent(), child('ses_a')],
      statuses: { ses_parent01: { type: 'busy' }, ses_a: { type: 'busy' } },
      messages: [assistantMessage('m2')],
      parts: partsOf([['m2', [errorCall('t1', 'm2', { description: 'Analyze alpha' }, 'ses_a')]]]),
    }));
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children[0]?.state).toBe('running');
    expect(model.state).toBe('running');
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

// --- Native ULW runs ---------------------------------------------------------
//
// Fixtures mirror the native runtime's own records: the run id in session
// metadata, the run record/roster/receipts as `ulw_*` tool inputs and JSON
// outputs, worker sessions from native dispatch, and completion text from
// the dispatched-session reports. Nothing is parsed out of CLI output.

const ULW_RUN_ID = 'ulw-1';

const nativeParentSession = (overrides: Partial<Session> = {}): Session => (
  parent({
    id: 'ses_run1',
    title: 'ulw: analyze repo',
    metadata: { alcode: { ulwRunId: ULW_RUN_ID } },
    ...overrides,
  })
);

const worker = (id: string, overrides: Partial<Session> = {}): Session => (
  child(id, { parentID: 'ses_run1', ...overrides })
);

const ulwCall = (
  id: string,
  messageId: string,
  tool: string,
  input: ToolInput,
  output: string | null,
  sessionId = 'ses_run1',
): ToolPart => ({
  id, sessionID: sessionId, messageID: messageId, type: 'tool', callID: `call_${id}`, tool,
  state: output === null
    ? { status: 'running', input, time: { start: 100 } }
    : { status: 'completed', input, output, time: { start: 100, end: 200 } },
});

const shellCall = (id: string, messageId: string, command: string, sessionId = 'ses_run1'): ToolPart => (
  ulwCall(id, messageId, 'shell', { command }, 'done', sessionId)
);

const dispatchedReport = (
  id: string,
  workerId: string,
  output: string,
  state: 'completed' | 'error' = 'completed',
  sessionId = 'ses_run1',
): SyntheticMessage => ({
  id, sessionID: sessionId, role: 'synthetic', time: { created: 8500 },
  text: `<alcode-session sessionID="${workerId}" state="${state}">\n${output}\n</alcode-session>`,
  metadata: { source: 'alcode-session', sessionID: workerId, state },
});

const runRecord = (status: string): string => JSON.stringify({
  id: ULW_RUN_ID, brief: 'Analyze the tiny repo', sessionScope: 'ses_run1', status,
  createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T02:00:00.000Z',
});

const receiptJson = (goalId: string, workerId: string, status: string, extra: Record<string, string> = {}): string => (
  JSON.stringify({
    goalId, childSessionId: workerId, status,
    recordedAt: '2026-10-19T01:00:00.000Z',
    ...extra,
  })
);

describe('nativeRunId', () => {
  test('reads the run id from session metadata, never a default', () => {
    expect(readNativeRunId(nativeParentSession())).toBe(ULW_RUN_ID);
    expect(readNativeRunId(null)).toBeNull();
    expect(readNativeRunId(parent())).toBeNull();
    expect(readNativeRunId(nativeParentSession({ metadata: {} }))).toBeNull();
    expect(readNativeRunId(nativeParentSession({ metadata: { alcode: { ulwRunId: '  ' } } }))).toBeNull();
  });
});

describe('buildDagRunModel native runs', () => {
  test('metadata alone opens an active card before any dispatch', () => {
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: [nativeParentSession()],
      statuses: { ses_run1: { type: 'idle' } },
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.source).toBe('native');
    expect(model.runId).toBe(ULW_RUN_ID);
    expect(model.phase).toBe('active');
    expect(model.state).toBe('running');
    expect(model.progress).toEqual({ total: 0, settled: 0 });
    expect(model.children).toEqual([]);
    expect(model.missingGoalIds).toEqual([]);
    expect(model.synthesis).toEqual({ state: 'pending', text: null });
  });

  test('dispatch plus one receipt reads phase, progress, and worker detail', () => {
    const w1Read: ToolPart = {
      id: 'w1read', sessionID: 'ses_w1', messageID: 'wm1', type: 'tool', callID: 'call_w1read', tool: 'read',
      state: { status: 'completed', input: { path: 'src/a.ts' }, output: 'contents', time: { start: 100, end: 200 } },
    };
    const w1Shell: ToolPart = {
      id: 'w1shell', sessionID: 'ses_w1', messageID: 'wm1', type: 'tool', callID: 'call_w1shell', tool: 'shell',
      state: { status: 'completed', input: { command: 'bun test' }, output: '3 pass', time: { start: 100, end: 200 } },
    };
    const w1Assistant: AssistantMessage = {
      id: 'wm1', sessionID: 'ses_w1', role: 'assistant', time: { created: 3000, completed: 3100 },
      agent: 'explore', providerID: 'p', modelID: 'm',
    };
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      conversationTitle: 'Repo analysis',
      sessions: [nativeParentSession(), worker('ses_w1'), worker('ses_w2')],
      statuses: { ses_run1: { type: 'idle' } },
      messages: [
        userMessage('m1', 'ulw: analyze this tiny repo', 'ses_run1'),
        assistantMessage('m2', 'ses_run1'),
        assistantMessage('m3', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha: string utils'),
      ],
      parts: partsOf([
        ['m1', [userTextPart('p1', 'm1', 'ulw: analyze this tiny repo', 'ses_run1')]],
        ['m2', [
          ulwCall('u1', 'm2', 'ulw_goal_create', { brief: 'Analyze the tiny repo' }, runRecord('active')),
          ulwCall('u2', 'm2', 'ulw_dispatch', {
            runId: ULW_RUN_ID,
            goals: [
              { goalId: 'g-alpha', workerSessionId: 'ses_w1', agent: 'explore', prompt: 'Analyze alpha' },
              { goalId: 'g-beta', workerSessionId: 'ses_w2', agent: 'explore', prompt: 'Analyze beta' },
            ],
          }, JSON.stringify({
            runId: ULW_RUN_ID,
            dispatches: [
              { goalId: 'g-alpha', workerSessionId: 'ses_w1', workers: ['ses_w1'] },
              { goalId: 'g-beta', workerSessionId: 'ses_w2', workers: ['ses_w2'] },
            ],
          })),
        ]],
        ['m3', [
          ulwCall('u3', 'm3', 'ulw_evidence', {
            runId: ULW_RUN_ID, goalId: 'g-alpha', childSessionId: 'ses_w1', status: 'completed', resultRef: 'notes/alpha.md',
          }, receiptJson('g-alpha', 'ses_w1', 'completed', { resultRef: 'notes/alpha.md' })),
        ]],
        ['wm1', [w1Read, w1Shell]],
      ]),
      allMessages: { ses_w1: [w1Assistant] },
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.source).toBe('native');
    expect(model.runId).toBe(ULW_RUN_ID);
    expect(model.phase).toBe('active');
    expect(model.state).toBe('running');
    expect(model.progress).toEqual({ total: 2, settled: 1 });
    expect(model.missingGoalIds).toEqual(['g-beta']);
    expect(model.children.map((c) => c.sessionId)).toEqual(['ses_w1', 'ses_w2']);
    const [alpha, beta] = model.children;
    if (!alpha || !beta) throw new Error('fixture must carry two workers');
    expect(alpha.state).toBe('completed');
    expect(alpha.goalId).toBe('g-alpha');
    expect(alpha.agent).toBe('explore');
    expect(alpha.output).toContain('alpha: string utils');
    expect(alpha.resultRef).toBe('notes/alpha.md');
    expect(alpha.error).toBeNull();
    expect(alpha.toolCalls.map((call) => call.tool)).toEqual(['read', 'shell']);
    expect(alpha.toolCalls[1]?.title).toContain('bun test');
    expect(beta.state).toBe('pending');
    expect(beta.goalId).toBe('g-beta');
    expect(beta.output).toBeNull();
    expect(model.bookkeepingToolCallIds).toEqual(['u1', 'u2', 'u3']);
    expect(model.synthesis).toEqual({ state: 'pending', text: null });
  });

  test('failure closes the run without false completion or zombie children', () => {
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: [nativeParentSession(), worker('ses_w1'), worker('ses_w2'), worker('ses_w3')],
      statuses: { ses_run1: { type: 'idle' }, ses_w2: { type: 'busy' }, ses_w3: { type: 'busy' } },
      messages: [
        assistantMessage('m2', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha done'),
        dispatchedReport('r2', 'ses_w2', 'beta blew up', 'error'),
      ],
      parts: partsOf([
        ['m2', [
          ulwCall('u1', 'm2', 'ulw_goal_create', { brief: 'Analyze the tiny repo' }, runRecord('active')),
          ulwCall('u2', 'm2', 'ulw_dispatch', {
            runId: ULW_RUN_ID,
            goals: [
              { goalId: 'g-alpha', workerSessionId: 'ses_w1' },
              { goalId: 'g-beta', workerSessionId: 'ses_w2' },
              { goalId: 'g-gamma', workerSessionId: 'ses_w3' },
            ],
          }, JSON.stringify({
            runId: ULW_RUN_ID,
            dispatches: [
              { goalId: 'g-alpha', workerSessionId: 'ses_w1', workers: ['ses_w1'] },
              { goalId: 'g-beta', workerSessionId: 'ses_w2', workers: ['ses_w2'] },
              { goalId: 'g-gamma', workerSessionId: 'ses_w3', workers: ['ses_w3'] },
            ],
          })),
          ulwCall('u3', 'm2', 'ulw_evidence', {
            runId: ULW_RUN_ID, goalId: 'g-alpha', childSessionId: 'ses_w1', status: 'completed',
          }, receiptJson('g-alpha', 'ses_w1', 'completed')),
          ulwCall('u4', 'm2', 'ulw_evidence', {
            runId: ULW_RUN_ID, goalId: 'g-beta', childSessionId: 'ses_w2', status: 'failed', reason: 'worker crashed',
          }, receiptJson('g-beta', 'ses_w2', 'failed', { reason: 'worker crashed' })),
          ulwCall('u5', 'm2', 'ulw_complete', { runId: ULW_RUN_ID, status: 'failed' }, runRecord('failed')),
        ]],
      ]),
      allMessages: {},
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.phase).toBe('failed');
    expect(model.state).toBe('failed');
    expect(model.progress).toEqual({ total: 3, settled: 2 });
    expect(model.missingGoalIds).toEqual(['g-gamma']);
    const byId = new Map(model.children.map((c) => [c.sessionId, c]));
    expect(byId.get('ses_w1')?.state).toBe('completed');
    expect(byId.get('ses_w2')?.state).toBe('failed');
    expect(byId.get('ses_w2')?.error).toBe('worker crashed');
    // g-gamma never settled but the run is terminal: no zombie `running`.
    expect(byId.get('ses_w3')?.state).toBe('failed');
    expect(model.children.some((c) => c.state === 'running' || c.state === 'pending')).toBe(false);
    expect(model.synthesis.state).toBe('pending');
    const outcome = parseSnapshotDoc(dagRunModelToSnapshotDoc(model));
    if (!outcome.ok) throw new Error(`doc must parse: ${outcome.error.field}`);
    const run = outcome.view.runs[0];
    if (!run) throw new Error('doc must carry one run');
    expect(run.runId).toBe(ULW_RUN_ID);
    expect(run.status).toBe('failed');
    expect(run.nodes.map((n) => n.id)).toEqual(['ses_run1', 'ses_w1', 'ses_w2', 'ses_w3', 'synthesis']);
  });

  test('redispatch after failure recovers the run to completed', () => {
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: [nativeParentSession(), worker('ses_w1'), worker('ses_w2'), worker('ses_w2b')],
      statuses: { ses_run1: { type: 'idle' } },
      messages: [
        assistantMessage('m2', 'ses_run1'),
        assistantMessage('m3', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha done'),
        dispatchedReport('r2', 'ses_w2', 'beta blew up', 'error'),
        dispatchedReport('r3', 'ses_w2b', 'beta redone'),
      ],
      parts: partsOf([
        ['m2', [
          ulwCall('u1', 'm2', 'ulw_goal_create', { brief: 'Analyze the tiny repo' }, runRecord('active')),
          ulwCall('u2', 'm2', 'ulw_dispatch', {
            runId: ULW_RUN_ID,
            goals: [
              { goalId: 'g-alpha', workerSessionId: 'ses_w1' },
              { goalId: 'g-beta', workerSessionId: 'ses_w2' },
            ],
          }, JSON.stringify({
            runId: ULW_RUN_ID,
            dispatches: [
              { goalId: 'g-alpha', workerSessionId: 'ses_w1', workers: ['ses_w1'] },
              { goalId: 'g-beta', workerSessionId: 'ses_w2', workers: ['ses_w2'] },
            ],
          })),
          ulwCall('u3', 'm2', 'ulw_evidence', {
            runId: ULW_RUN_ID, goalId: 'g-alpha', childSessionId: 'ses_w1', status: 'completed',
          }, receiptJson('g-alpha', 'ses_w1', 'completed')),
          ulwCall('u4', 'm2', 'ulw_evidence', {
            runId: ULW_RUN_ID, goalId: 'g-beta', childSessionId: 'ses_w2', status: 'failed', reason: 'worker crashed',
          }, receiptJson('g-beta', 'ses_w2', 'failed', { reason: 'worker crashed' })),
        ]],
        ['m3', [
          ulwCall('u5', 'm3', 'ulw_dispatch', {
            runId: ULW_RUN_ID, goalId: 'g-beta', workerSessionId: 'ses_w2b',
          }, JSON.stringify({ runId: ULW_RUN_ID, goalId: 'g-beta', workerSessionId: 'ses_w2b', workers: ['ses_w2', 'ses_w2b'] })),
          ulwCall('u6', 'm3', 'ulw_evidence', {
            runId: ULW_RUN_ID, goalId: 'g-beta', childSessionId: 'ses_w2b', status: 'completed',
          }, receiptJson('g-beta', 'ses_w2b', 'completed')),
          ulwCall('u7', 'm3', 'ulw_complete', { runId: ULW_RUN_ID, status: 'complete' }, runRecord('complete')),
        ]],
      ]),
      allMessages: {},
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.phase).toBe('complete');
    expect(model.state).toBe('completed');
    expect(model.progress).toEqual({ total: 2, settled: 2 });
    expect(model.missingGoalIds).toEqual([]);
    const byId = new Map(model.children.map((c) => [c.sessionId, c]));
    expect(byId.get('ses_w1')?.state).toBe('completed');
    // The first beta attempt no longer owns the goal once it resettled.
    expect(byId.get('ses_w2')?.state).toBe('cancelled');
    expect(byId.get('ses_w2b')?.state).toBe('completed');
    expect(byId.get('ses_w2b')?.goalId).toBe('g-beta');
    expect(model.synthesis.state).toBe('ready');
  });

  test('a ulw_status snapshot carries the roster and receipts on its own', () => {
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: [nativeParentSession(), worker('ses_w1'), worker('ses_w2')],
      statuses: { ses_run1: { type: 'idle' } },
      messages: [
        assistantMessage('m2', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha done'),
      ],
      parts: partsOf([
        ['m2', [
          ulwCall('u1', 'm2', 'ulw_status', { runId: ULW_RUN_ID }, JSON.stringify({
            run: { id: ULW_RUN_ID, brief: 'Analyze the tiny repo', sessionScope: 'ses_run1', status: 'active' },
            roster: { 'g-alpha': ['ses_w1'], 'g-beta': ['ses_w2'] },
            receipts: {
              'g-alpha': { goalId: 'g-alpha', childSessionId: 'ses_w1', status: 'completed', recordedAt: '2026-10-19T01:00:00.000Z', resultRef: 'r.md' },
            },
            missingReceipts: ['g-beta'],
          })),
        ]],
      ]),
      allMessages: {},
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children.map((c) => c.sessionId)).toEqual(['ses_w1', 'ses_w2']);
    expect(model.children[0]?.state).toBe('completed');
    expect(model.children[0]?.resultRef).toBe('r.md');
    expect(model.children[0]?.endedAt).toBe(Date.parse('2026-10-19T01:00:00.000Z'));
    expect(model.children[1]?.state).toBe('pending');
    expect(model.progress).toEqual({ total: 2, settled: 1 });
    expect(model.missingGoalIds).toEqual(['g-beta']);
  });

  test('events naming another run never join the card', () => {
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: [nativeParentSession()],
      statuses: { ses_run1: { type: 'idle' } },
      messages: [assistantMessage('m2', 'ses_run1')],
      parts: partsOf([
        ['m2', [
          ulwCall('u1', 'm2', 'ulw_dispatch', { runId: 'ulw-9', goalId: 'gx', workerSessionId: 'ses_x' }, JSON.stringify({
            runId: 'ulw-9', goalId: 'gx', workerSessionId: 'ses_x', workers: ['ses_x'],
          })),
        ]],
      ]),
      allMessages: {},
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.children).toEqual([]);
    expect(model.progress).toEqual({ total: 0, settled: 0 });
    expect(model.bookkeepingToolCallIds).toEqual(['u1']);
  });

  test('bookkeeping hides orchestration rows while user shell stays visible', () => {
    expect(isUlwTool('ulw_dispatch')).toBe(true);
    expect(isUlwTool('ulw_evidence')).toBe(true);
    expect(isUlwTool('ulw_goal_create')).toBe(true);
    expect(isUlwTool('ulw_status')).toBe(true);
    expect(isUlwTool('ulw_checkpoint')).toBe(true);
    expect(isUlwTool('ulw_complete')).toBe(true);
    expect(isUlwTool('shell')).toBe(false);
    expect(isUlwTool('subagent')).toBe(false);
    expect(isUlwBookkeepingShellCommand('bun x ulw-loop dispatch --run ulw-1')).toBe(true);
    expect(isUlwBookkeepingShellCommand('ulw-loop status')).toBe(true);
    expect(isUlwBookkeepingShellCommand('bun test')).toBe(false);
    expect(isUlwBookkeepingShellCommand(null)).toBe(false);
    expect(isUlwOrchestrationPart(ulwCall('u1', 'm1', 'ulw_dispatch', { runId: ULW_RUN_ID }, null))).toBe(true);
    expect(isUlwOrchestrationPart(shellCall('s1', 'm1', 'bun x ulw-loop status'))).toBe(true);
    expect(isUlwOrchestrationPart(shellCall('s2', 'm1', 'bun test'))).toBe(false);
    const w1: AssistantMessage = {
      id: 'wm1', sessionID: 'ses_w1', role: 'assistant', time: { created: 3000, completed: 3100 },
      agent: 'explore', providerID: 'p', modelID: 'm',
    };
    const loopShell: ToolPart = {
      id: 'wloop', sessionID: 'ses_w1', messageID: 'wm1', type: 'tool', callID: 'call_wloop', tool: 'shell',
      state: { status: 'completed', input: { command: 'ulw-loop evidence --run ulw-1' }, output: 'ok', time: { start: 100, end: 200 } },
    };
    const userShell: ToolPart = {
      id: 'wtest', sessionID: 'ses_w1', messageID: 'wm1', type: 'tool', callID: 'call_wtest', tool: 'shell',
      state: { status: 'completed', input: { command: 'bun test' }, output: '3 pass', time: { start: 100, end: 200 } },
    };
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: [nativeParentSession(), worker('ses_w1')],
      statuses: { ses_run1: { type: 'idle' } },
      messages: [assistantMessage('m1', 'ses_run1')],
      parts: partsOf([
        ['m1', [
          ulwCall('u1', 'm1', 'ulw_dispatch', { runId: ULW_RUN_ID, goalId: 'g-alpha', workerSessionId: 'ses_w1' }, JSON.stringify({
            runId: ULW_RUN_ID, goalId: 'g-alpha', workerSessionId: 'ses_w1', workers: ['ses_w1'],
          })),
          shellCall('s1', 'm1', 'bun x ulw-loop dispatch --run ulw-1'),
          shellCall('s2', 'm1', 'bun test'),
        ]],
        ['wm1', [loopShell, userShell]],
      ]),
      allMessages: { ses_w1: [w1] },
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.bookkeepingToolCallIds).toEqual(['u1', 's1']);
    expect(model.children).toHaveLength(1);
    expect(model.children[0]?.toolCalls.map((call) => call.id)).toEqual(['wtest']);
    expect(model.children[0]?.toolCalls[0]?.title).toContain('bun test');
  });

  test('the native snapshot carries runtime ids, states, and expanded detail', () => {
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      conversationTitle: 'Repo analysis',
      sessions: [nativeParentSession(), worker('ses_w1'), worker('ses_w2')],
      statuses: { ses_run1: { type: 'idle' } },
      messages: [
        userMessage('m1', 'ulw: analyze this tiny repo', 'ses_run1'),
        assistantMessage('m2', 'ses_run1'),
        assistantMessage('m3', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha: string utils'),
      ],
      parts: partsOf([
        ['m1', [userTextPart('p1', 'm1', 'ulw: analyze this tiny repo', 'ses_run1')]],
        ['m2', [
          ulwCall('u1', 'm2', 'ulw_goal_create', { brief: 'Analyze the tiny repo' }, runRecord('active')),
          ulwCall('u2', 'm2', 'ulw_dispatch', {
            runId: ULW_RUN_ID,
            goals: [{ goalId: 'g-alpha', workerSessionId: 'ses_w1', agent: 'explore', prompt: 'Analyze alpha' }],
          }, JSON.stringify({ runId: ULW_RUN_ID, dispatches: [{ goalId: 'g-alpha', workerSessionId: 'ses_w1', workers: ['ses_w1'] }] })),
        ]],
        ['m3', [
          ulwCall('u3', 'm3', 'ulw_evidence', {
            runId: ULW_RUN_ID, goalId: 'g-alpha', childSessionId: 'ses_w1', status: 'completed',
          }, receiptJson('g-alpha', 'ses_w1', 'completed')),
        ]],
      ]),
      allMessages: {},
    });
    if (model === null) throw new Error('fixture must build a run');
    const outcome = parseSnapshotDoc(dagRunModelToSnapshotDoc(model));
    if (!outcome.ok) throw new Error(`doc must parse: ${outcome.error.field}`);
    const run = outcome.view.runs[0];
    if (!run) throw new Error('doc must carry one run');
    expect(run.runId).toBe(ULW_RUN_ID);
    expect(run.runKey).toBe(`ulw:${ULW_RUN_ID}`);
    expect(run.nodes.map((n) => n.id)).toEqual(['ses_run1', 'ses_w1', 'synthesis']);
    const hasEdge = (from: string, to: string) => run.edges.some((edge) => edge.from === from && edge.to === to);
    expect(hasEdge('ses_run1', 'ses_w1')).toBe(true);
    expect(hasEdge('ses_w1', 'synthesis')).toBe(true);
    expect(run.waves.map((w) => w.nodeIds)).toEqual([['ses_run1'], ['ses_w1'], ['synthesis']]);
    const parentNode = run.nodes.find((n) => n.id === 'ses_run1');
    expect(parentNode?.prompt).toContain('Progress: 1/1 goals settled');
    const childNode = run.nodes.find((n) => n.id === 'ses_w1');
    expect(childNode?.state).toBe('completed');
    expect(childNode?.label).toContain('explore');
    expect(childNode?.prompt).toContain('Task g-alpha');
    expect(childNode?.prompt).toContain('alpha: string utils');
  });
});

describe('buildDagRunModel native gaps', () => {
  // Gap cover for the native run card: each case below asserts only what the
  // existing native block does not. Fixtures reuse the same runtime records
  // (run id metadata, `ulw_*` calls, receipts, dispatched-session reports).
  const gapSessions = () => [nativeParentSession(), worker('ses_w1'), worker('ses_w2')];
  const gapStatuses = () => ({ ses_run1: { type: 'idle' } });
  const gapDispatchEntries = (): [string, Part[]][] => [
    ['m1', [userTextPart('p1', 'm1', 'ulw: analyze this tiny repo', 'ses_run1')]],
    ['m2', [
      ulwCall('u1', 'm2', 'ulw_goal_create', { brief: 'Analyze the tiny repo' }, runRecord('active')),
      ulwCall('u2', 'm2', 'ulw_dispatch', {
        runId: ULW_RUN_ID,
        goals: [
          { goalId: 'g-alpha', workerSessionId: 'ses_w1', agent: 'explore', prompt: 'Analyze alpha' },
          { goalId: 'g-beta', workerSessionId: 'ses_w2', agent: 'explore', prompt: 'Analyze beta' },
        ],
      }, JSON.stringify({
        runId: ULW_RUN_ID,
        dispatches: [
          { goalId: 'g-alpha', workerSessionId: 'ses_w1', workers: ['ses_w1'] },
          { goalId: 'g-beta', workerSessionId: 'ses_w2', workers: ['ses_w2'] },
        ],
      })),
    ]],
  ];
  const alphaEvidence = () => ulwCall('u3', 'm3', 'ulw_evidence', {
    runId: ULW_RUN_ID, goalId: 'g-alpha', childSessionId: 'ses_w1', status: 'completed',
  }, receiptJson('g-alpha', 'ses_w1', 'completed'));
  const betaEvidence = (id: string, messageId: string) => ulwCall(id, messageId, 'ulw_evidence', {
    runId: ULW_RUN_ID, goalId: 'g-beta', childSessionId: 'ses_w2', status: 'completed',
  }, receiptJson('g-beta', 'ses_w2', 'completed'));

  test('(5) goal and child records move counts and shrink missing goals', () => {
    const base = {
      conversationId: 'ses_run1',
      sessions: gapSessions(),
      statuses: gapStatuses(),
    };
    const dispatched = buildDagRunModel({
      ...base,
      messages: [
        userMessage('m1', 'ulw: analyze this tiny repo', 'ses_run1'),
        assistantMessage('m2', 'ses_run1'),
      ],
      parts: partsOf(gapDispatchEntries()),
    });
    if (dispatched === null) throw new Error('fixture must build a run');
    expect(dispatched.progress).toEqual({ total: 2, settled: 0 });
    expect(dispatched.missingGoalIds).toEqual(['g-alpha', 'g-beta']);
    expect(dispatched.counts).toEqual({ pending: 2, running: 0, completed: 0 });
    expect(dispatched.state).toBe('running');

    const oneSettled = buildDagRunModel({
      ...base,
      messages: [
        userMessage('m1', 'ulw: analyze this tiny repo', 'ses_run1'),
        assistantMessage('m2', 'ses_run1'),
        assistantMessage('m3', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha: string utils'),
      ],
      parts: partsOf([...gapDispatchEntries(), ['m3', [alphaEvidence()]]]),
    });
    if (oneSettled === null) throw new Error('fixture must build a run');
    expect(oneSettled.progress).toEqual({ total: 2, settled: 1 });
    expect(oneSettled.missingGoalIds).toEqual(['g-beta']);
    expect(oneSettled.counts).toEqual({ pending: 1, running: 0, completed: 1 });
    expect(oneSettled.children.map((c) => c.sessionId)).toEqual(['ses_w1', 'ses_w2']);
    expect(oneSettled.children[0]?.state).toBe('completed');
    expect(oneSettled.children[1]?.state).toBe('pending');

    const allSettled = buildDagRunModel({
      ...base,
      messages: [
        userMessage('m1', 'ulw: analyze this tiny repo', 'ses_run1'),
        assistantMessage('m2', 'ses_run1'),
        assistantMessage('m3', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha: string utils'),
        assistantMessage('m4', 'ses_run1'),
        dispatchedReport('r2', 'ses_w2', 'beta: math utils'),
      ],
      parts: partsOf([
        ...gapDispatchEntries(),
        ['m3', [alphaEvidence()]],
        ['m4', [
          betaEvidence('u4', 'm4'),
          ulwCall('u5', 'm4', 'ulw_complete', { runId: ULW_RUN_ID, status: 'complete' }, runRecord('complete')),
        ]],
      ]),
    });
    if (allSettled === null) throw new Error('fixture must build a run');
    expect(allSettled.progress).toEqual({ total: 2, settled: 2 });
    expect(allSettled.missingGoalIds).toEqual([]);
    expect(allSettled.counts).toEqual({ pending: 0, running: 0, completed: 2 });
    expect(allSettled.state).toBe('completed');
    expect(allSettled.phase).toBe('complete');
  });

  test('(6) settled receipts without genuine completion never complete the run', () => {
    const settledMessages = [
      userMessage('m1', 'ulw: analyze this tiny repo', 'ses_run1'),
      assistantMessage('m2', 'ses_run1'),
      assistantMessage('m3', 'ses_run1'),
      dispatchedReport('r1', 'ses_w1', 'alpha: string utils'),
      dispatchedReport('r2', 'ses_w2', 'beta: math utils'),
      assistantMessage('m4', 'ses_run1'),
    ];
    const inferred = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: gapSessions(),
      statuses: gapStatuses(),
      messages: settledMessages,
      parts: partsOf([
        ...gapDispatchEntries(),
        ['m3', [alphaEvidence(), betaEvidence('u4', 'm3')]],
        ['m4', [userTextPart('p4', 'm4', 'All done: alpha and beta are complete.', 'ses_run1')]],
      ]),
    });
    if (inferred === null) throw new Error('fixture must build a run');
    expect(inferred.progress).toEqual({ total: 2, settled: 2 });
    expect(inferred.missingGoalIds).toEqual([]);
    // Every receipt settled and the transcript even summarizes the work, but
    // no `ulw_complete` closed the run: still running, synthesis pending.
    expect(inferred.state).toBe('running');
    expect(inferred.phase).toBe('active');
    expect(inferred.synthesis).toEqual({ state: 'pending', text: null });

    const closed = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: gapSessions(),
      statuses: gapStatuses(),
      messages: [...settledMessages, assistantMessage('m5', 'ses_run1')],
      parts: partsOf([
        ...gapDispatchEntries(),
        ['m3', [alphaEvidence(), betaEvidence('u4', 'm3')]],
        ['m4', [userTextPart('p4', 'm4', 'All done: alpha and beta are complete.', 'ses_run1')]],
        ['m5', [
          ulwCall('u5', 'm5', 'ulw_complete', { runId: ULW_RUN_ID, status: 'complete' }, runRecord('complete')),
        ]],
      ]),
    });
    if (closed === null) throw new Error('fixture must build a run');
    expect(closed.state).toBe('completed');
    expect(closed.phase).toBe('complete');
    expect(closed.synthesis.state).toBe('ready');
    expect(closed.synthesis.text).toContain('All done');
  });

  test('(7) failed receipts render failed nodes with the error attached', () => {
    const model = buildDagRunModel({
      conversationId: 'ses_run1',
      sessions: gapSessions(),
      statuses: gapStatuses(),
      messages: [
        userMessage('m1', 'ulw: analyze this tiny repo', 'ses_run1'),
        assistantMessage('m2', 'ses_run1'),
        assistantMessage('m3', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha: string utils'),
        dispatchedReport('r2', 'ses_w2', 'beta blew up', 'error'),
      ],
      parts: partsOf([
        ...gapDispatchEntries(),
        ['m3', [
          alphaEvidence(),
          ulwCall('u4', 'm3', 'ulw_evidence', {
            runId: ULW_RUN_ID, goalId: 'g-beta', childSessionId: 'ses_w2', status: 'failed',
          }, receiptJson('g-beta', 'ses_w2', 'failed', { reason: 'worker crashed' })),
          ulwCall('u5', 'm3', 'ulw_complete', { runId: ULW_RUN_ID, status: 'failed' }, runRecord('failed')),
        ]],
      ]),
    });
    if (model === null) throw new Error('fixture must build a run');
    expect(model.state).toBe('failed');
    expect(model.phase).toBe('failed');
    const byId = new Map(model.children.map((c) => [c.sessionId, c]));
    expect(byId.get('ses_w2')?.state).toBe('failed');
    expect(byId.get('ses_w2')?.error).toBe('worker crashed');
    // The failure settles one child without erasing the completed sibling.
    expect(byId.get('ses_w1')?.state).toBe('completed');
    const outcome = parseSnapshotDoc(dagRunModelToSnapshotDoc(model));
    if (!outcome.ok) throw new Error(`doc must parse: ${outcome.error.field}`);
    const run = outcome.view.runs[0];
    if (!run) throw new Error('doc must carry one run');
    expect(run.status).toBe('failed');
    const failedNode = run.nodes.find((n) => n.id === 'ses_w2');
    expect(failedNode?.state).toBe('failed');
    expect(failedNode?.prompt).toContain('Error:');
    expect(failedNode?.prompt).toContain('worker crashed');
    const okNode = run.nodes.find((n) => n.id === 'ses_w1');
    expect(okNode?.state).toBe('completed');
    expect(okNode?.prompt).toContain('alpha: string utils');
  });

  test('(9) reopening the same stored slices restores the graph without redispatch', () => {
    const input = {
      conversationId: 'ses_run1',
      conversationTitle: 'Repo analysis',
      sessions: gapSessions(),
      statuses: gapStatuses(),
      messages: [
        userMessage('m1', 'ulw: analyze this tiny repo', 'ses_run1'),
        assistantMessage('m2', 'ses_run1'),
        assistantMessage('m3', 'ses_run1'),
        dispatchedReport('r1', 'ses_w1', 'alpha: string utils'),
        dispatchedReport('r2', 'ses_w2', 'beta: math utils'),
      ],
      parts: partsOf([
        ...gapDispatchEntries(),
        ['m3', [
          alphaEvidence(),
          betaEvidence('u4', 'm3'),
          ulwCall('u5', 'm3', 'ulw_complete', { runId: ULW_RUN_ID, status: 'complete' }, runRecord('complete')),
        ]],
      ]),
    };
    const before = buildDagRunModel(input);
    if (before === null) throw new Error('fixture must build a run');
    // A reopen re-reads the same stored slices: rebuild from equal records.
    const after = buildDagRunModel({
      ...input,
      sessions: gapSessions(),
      statuses: gapStatuses(),
      messages: [...input.messages],
      parts: { ...input.parts },
    });
    if (after === null) throw new Error('reopen must restore the run');
    expect(after.runId).toBe(before.runId);
    expect(after.children.map((c) => c.sessionId)).toEqual(before.children.map((c) => c.sessionId));
    expect(after.children.map((c) => [c.goalId, c.state])).toEqual(before.children.map((c) => [c.goalId, c.state]));
    expect(after.progress).toEqual(before.progress);
    expect(after.missingGoalIds).toEqual(before.missingGoalIds);
    expect(after.counts).toEqual(before.counts);
    expect(after.state).toBe(before.state);
    expect(after.synthesis).toEqual(before.synthesis);
    // No redispatch: the same bookkeeping rows, no new dispatch, same graph.
    expect(after.bookkeepingToolCallIds).toEqual(before.bookkeepingToolCallIds);
    expect(after.children).toHaveLength(before.children.length);
    const beforeDoc = parseSnapshotDoc(dagRunModelToSnapshotDoc(before));
    const afterDoc = parseSnapshotDoc(dagRunModelToSnapshotDoc(after));
    if (!beforeDoc.ok || !afterDoc.ok) throw new Error('docs must parse');
    expect(afterDoc.view.runs[0]?.nodes).toEqual(beforeDoc.view.runs[0]?.nodes);
    expect(afterDoc.view.runs[0]?.edges).toEqual(beforeDoc.view.runs[0]?.edges);
    expect(afterDoc.view.runs[0]?.waves).toEqual(beforeDoc.view.runs[0]?.waves);
  });
});
