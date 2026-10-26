import { describe, expect, test } from 'bun:test';
import type { Message, Part, Session, SyntheticMessage, TextPart, ToolPart } from '@/lib/opencode/model';
import { buildDagRunModel, type DagRunModel } from '@/lib/dagRunModel';
import {
  buildActivityTree,
  buildExplanationCard,
  buildInspectorSummaries,
  buildInspectorTimeline,
  buildRunGraph,
  taskAssociatedFiles,
} from './activityModel';

const parent = (): Session => ({
  id: 'ses_parent01',
  projectID: 'proj_1',
  directory: '/tmp/proj',
  title: 'Repository analysis',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000, updated: 9000 },
});

const child = (id: string): Session => ({
  id,
  parentID: 'ses_parent01',
  projectID: 'proj_1',
  directory: '/tmp/proj',
  title: `Analyze ${id}`,
  agent: 'explore',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 2000, updated: 8000 },
});

const textPart = (id: string, messageId: string, text: string): TextPart => (
  { id, sessionID: 'ses_parent01', messageID: messageId, type: 'text', text }
);

const report = (id: string, childId: string, output: string): SyntheticMessage => ({
  id,
  sessionID: 'ses_parent01',
  role: 'synthetic',
  time: { created: 8500 },
  text: output,
  description: `Subagent ${childId} finished`,
  metadata: { source: 'subagent', childID: childId, agent: 'explore', state: 'completed' },
});

const toolCall = (id: string, messageId: string, tool: string, status: 'completed'): ToolPart => ({
  id,
  sessionID: 'ses_parent01',
  messageID: messageId,
  type: 'tool',
  callID: `call_${id}`,
  tool,
  state: { status, input: {}, output: '', metadata: {}, time: { start: 3000, end: 4000 } },
});

const modelOf = (): DagRunModel => {
  const messages: Message[] = [
    { id: 'm1', sessionID: 'ses_parent01', role: 'user', time: { created: 1100 } },
    {
      id: 'm2', sessionID: 'ses_parent01', role: 'assistant', time: { created: 1500, completed: 1600 },
      agent: 'a', providerID: 'p', modelID: 'm',
    },
    report('m3', 'ses_child01', 'Found three callers.'),
  ];
  const parts = {
    m1: [textPart('p1', 'm1', 'Analyze the callers')],
    m2: [textPart('p2', 'm2', 'Starting the analysis now')],
  } satisfies Record<string, Part[]>;
  const model = buildDagRunModel({
    conversationId: 'ses_parent01',
    sessions: [parent(), child('ses_child01')],
    statuses: {},
    messages,
    parts,
  });
  if (!model) throw new Error('fixture must build a model');
  return model;
};

describe('activity tree', () => {
  test('null model yields no rows, never a fabricated tree', () => {
    expect(buildActivityTree(null)).toEqual([]);
  });

  test('session, task, and synthesis rows trace to the model', () => {
    const rows = buildActivityTree(modelOf());
    expect(rows.map((row) => row.id)).toEqual(['ses_parent01', 'ses_child01', 'synthesis']);
    expect(rows[0]).toMatchObject({ kind: 'session', label: 'Repository analysis' });
    expect(rows[0]?.progress).toEqual({ settled: 1, total: 1 });
    expect(rows[1]).toMatchObject({ kind: 'task', agent: 'explore', state: 'completed' });
    expect(rows[2]).toMatchObject({ kind: 'task', label: 'Synthesis', state: 'completed' });
  });
});

describe('run graph', () => {
  test('null model yields null, not an empty graph', () => {
    expect(buildRunGraph(null)).toBeNull();
  });

  test('parent, task, and synthesis nodes with blocking synthesis edges', () => {
    const graph = buildRunGraph(modelOf());
    expect(graph?.nodes.map((node) => node.id)).toEqual(['parent', 'ses_child01', 'synthesis']);
    expect(graph?.nodes.map((node) => node.wave)).toEqual([0, 1, 2]);
    expect(graph?.edges.some((edge) => edge.from === 'parent' && edge.to === 'ses_child01' && edge.blocking === false)).toBe(true);
    expect(graph?.edges.some((edge) => edge.from === 'ses_child01' && edge.to === 'synthesis' && edge.blocking === true)).toBe(true);
  });
});

describe('inspector timeline', () => {
  test('child timeline carries spawn and settlement with receipt ids', () => {
    const model = modelOf();
    const messages: Message[] = [
      { id: 'm1', sessionID: 'ses_parent01', role: 'user', time: { created: 1100 } },
      report('m3', 'ses_child01', 'Found three callers.'),
    ];
    const events = buildInspectorTimeline({ model, messages, parts: {}, selectedId: 'ses_child01' });
    expect(events[0]).toMatchObject({ kind: 'dependency', receiptId: null });
    const settled = events.find((event) => event.kind === 'result');
    expect(settled?.receiptId).toBe('ses_child01');
    expect(settled?.detail).toContain('Found three callers.');
  });

  test('unsettled child reports its state instead of a result', () => {
    const model = modelOf();
    const events = buildInspectorTimeline({ model, messages: [], parts: {}, selectedId: 'ses_child01' });
    expect(events.some((event) => event.kind === 'state')).toBe(true);
    expect(events.some((event) => event.kind === 'result')).toBe(false);
  });
});

describe('inspector summaries', () => {
  test('every summary names its source; nothing else qualifies', () => {
    const model = modelOf();
    const messages: Message[] = [
      {
        id: 'm2', sessionID: 'ses_parent01', role: 'assistant', time: { created: 1500, completed: 1600 },
        agent: 'a', providerID: 'p', modelID: 'm',
      },
      report('m3', 'ses_child01', 'Found three callers.'),
    ];
    const parts = {
      m2: [textPart('p2', 'm2', 'Starting the analysis now'), toolCall('t1', 'm2', 'read', 'completed')],
    } satisfies Record<string, Part[]>;
    const summaries = buildInspectorSummaries({ model, messages, parts, selectedId: 'synthesis' });
    expect(summaries.map((summary) => summary.source)).toEqual(['model', 'subagent']);
    expect(summaries[0]?.receiptId).toBe('m2');
    expect(summaries[1]?.receiptId).toBe('m3');
  });
});

describe('taskAssociatedFiles', () => {
  const fileCall = (id: string, messageId: string, sessionId: string, tool: string, input: Record<string, string>): ToolPart => ({
    id,
    sessionID: sessionId,
    messageID: messageId,
    type: 'tool',
    callID: `call_${id}`,
    tool,
    state: { status: 'completed', input, output: '', metadata: {}, time: { start: 3000, end: 4000 } },
  });

  const childMessages: Message[] = [
    {
      id: 'cm1', sessionID: 'ses_child01', role: 'assistant', time: { created: 3100, completed: 3200 },
      agent: 'explore', providerID: 'p', modelID: 'm',
    },
  ];

  test('collects file-tool paths in first-seen order without duplicates', () => {
    const parts = {
      cm1: [
        fileCall('t1', 'cm1', 'ses_child01', 'read', { path: 'src/a.ts' }),
        fileCall('t2', 'cm1', 'ses_child01', 'edit', { path: 'src/b.ts' }),
        fileCall('t3', 'cm1', 'ses_child01', 'read', { path: 'src/a.ts' }),
      ],
    } satisfies Record<string, Part[]>;
    expect(taskAssociatedFiles(childMessages, parts, 'ses_child01')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('ignores patterns, subagent calls, other sessions, and report text', () => {
    const messages: Message[] = [
      ...childMessages,
      {
        id: 'm9', sessionID: 'ses_other', role: 'assistant', time: { created: 3100 },
        agent: 'a', providerID: 'p', modelID: 'm',
      },
    ];
    const parts = {
      cm1: [
        fileCall('t1', 'cm1', 'ses_child01', 'grep', { pattern: 'src/**/*.ts' }),
        fileCall('t2', 'cm1', 'ses_child01', 'subagent', { path: 'src/spawned.ts' }),
      ],
      m9: [fileCall('t3', 'm9', 'ses_other', 'read', { path: 'src/other.ts' })],
    } satisfies Record<string, Part[]>;
    expect(taskAssociatedFiles(messages, parts, 'ses_child01')).toEqual([]);
  });

  test('reads patch headers and caps the list', () => {
    const calls = Array.from({ length: 12 }, (_, index) =>
      fileCall(`t${index}`, 'cm1', 'ses_child01', 'patch', {
        path: `src/f${index}.ts`,
        patchText: `*** Begin Patch\n*** Update File: src/p${index}.ts\n@@\n`,
      }));
    const parts = { cm1: calls } satisfies Record<string, Part[]>;
    const files = taskAssociatedFiles(childMessages, parts, 'ses_child01');
    expect(files).toHaveLength(10);
    expect(files[0]).toBe('src/f0.ts');
    expect(files).toContain('src/p0.ts');
    expect(files).not.toContain('src/f10.ts');
  });
});

describe('buildExplanationCard', () => {
  test('null model yields no card, never a fabricated one', () => {
    expect(buildExplanationCard({ model: null, messages: [], parts: {}, selectedId: 'ses_child01' })).toBeNull();
  });

  test('settled child answers all five questions with receipts', () => {
    const model = modelOf();
    const messages: Message[] = [
      {
        id: 'm2', sessionID: 'ses_parent01', role: 'assistant', time: { created: 1500, completed: 1600 },
        agent: 'a', providerID: 'p', modelID: 'm',
      },
      report('m3', 'ses_child01', 'Found three callers.'),
    ];
    const parts = {
      m2: [textPart('p2', 'm2', 'Starting the analysis now')],
    } satisfies Record<string, Part[]>;
    const card = buildExplanationCard({ model, messages, parts, selectedId: 'ses_child01' });
    expect(card?.objective?.text).toBeTruthy();
    expect(card?.outcome?.text).toContain('Settled');
    expect(card?.outcome?.receiptId).toBe('ses_child01');
    expect(card?.evidence).toEqual([]);
    expect(card?.next).toBe('settled');
    expect(card?.rationale).toBeNull();
  });

  test('child tool calls become evidence with their receipts', () => {
    const model = modelOf();
    const messages: Message[] = [
      {
        id: 'cm1', sessionID: 'ses_child01', role: 'assistant', time: { created: 3100, completed: 3200 },
        agent: 'explore', providerID: 'p', modelID: 'm',
      },
    ];
    const parts = {
      cm1: [{
        id: 't1', sessionID: 'ses_child01', messageID: 'cm1', type: 'tool', callID: 'call_t1',
        tool: 'read',
        state: { status: 'completed', input: { path: 'src/a.ts' }, output: '', metadata: {}, time: { start: 3100, end: 3200 } },
      }],
    } satisfies Record<string, Part[]>;
    const card = buildExplanationCard({ model, messages, parts, selectedId: 'ses_child01' });
    expect(card?.evidence).toHaveLength(1);
    expect(card?.evidence[0]?.receiptId).toBe('t1');
  });
});
