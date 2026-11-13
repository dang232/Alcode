// Topology pin for the chat-path projection (plan checkbox 12, OQ3 label-only).
//
// dagRunModelToSnapshotDoc synthesizes a three-wave layout for chat-path runs
// (parent, children, synthesis), with run_key `chat:<parent>`, `tasks: null`,
// and depends_on derived from parent/child session ids. The OQ3 decision is to
// keep that topology exactly as it is and pin it here: this file records the
// CURRENT shape so a later change cannot reshape the graph silently. It is a
// regression lock on existing behaviour, not an endorsement of fabricated
// topology.
import { describe, expect, test } from 'bun:test';

import type { JsonValue } from '@alcode/sdk';

import type { AssistantMessage, Message, Part, Session, SyntheticMessage, TextPart, ToolInput, ToolPart } from '@/lib/opencode/model';
import { buildDagRunModel, dagRunModelToSnapshotDoc, type DagRunModel, type DagRunModelInput } from './dagRunModel';

const parent = (): Session => ({
  id: 'ses_top_parent',
  projectID: 'proj_top',
  directory: '/tmp/topology',
  title: 'Topology fixture run',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000, updated: 9000 },
});

const child = (id: string, title: string, created: number): Session => ({
  id,
  parentID: 'ses_top_parent',
  projectID: 'proj_top',
  directory: '/tmp/topology',
  title,
  cost: 0.001,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created, updated: 8000 },
});

const userMessage = (id: string): Message => ({
  id, sessionID: 'ses_top_parent', role: 'user', time: { created: 1100 },
});

const userTextPart = (id: string, messageId: string, text: string): TextPart => (
  { id, sessionID: 'ses_top_parent', messageID: messageId, type: 'text', text }
);

const assistantMessage = (id: string): AssistantMessage => ({
  id, sessionID: 'ses_top_parent', role: 'assistant', time: { created: 1500, completed: 1600 },
  agent: 'a', providerID: 'p', modelID: 'm',
});

const toolCall = (id: string, messageId: string, input: ToolInput, childId: string): ToolPart => ({
  id, sessionID: 'ses_top_parent', messageID: messageId, type: 'tool', callID: `call_${id}`, tool: 'subagent',
  state: { status: 'completed', input, output: '', metadata: { sessionID: childId }, time: { start: 2000, end: 8000 } },
});

const report = (id: string, childId: string, output: string): SyntheticMessage => ({
  id, sessionID: 'ses_top_parent', role: 'synthetic', time: { created: 8500 }, text: output,
  description: `Subagent ${childId} finished`,
  metadata: { source: 'subagent', childID: childId, agent: 'explore', state: 'completed' },
});

const inputOf = (overrides: Partial<DagRunModelInput> = {}): DagRunModelInput => ({
  conversationId: 'ses_top_parent',
  conversationTitle: 'Topology fixture run',
  sessions: [parent()],
  statuses: { ses_top_parent: { type: 'idle' } },
  messages: [],
  parts: {},
  ...overrides,
});

const partsOf = (entries: [string, Part[]][]): Record<string, Part[]> => Object.fromEntries(entries);

const fixtureModel = (): DagRunModel => {
  const model = buildDagRunModel(inputOf({
    sessions: [
      parent(),
      child('ses_top_a', 'Analyze A', 2000),
      child('ses_top_b', 'Analyze B', 2100),
      child('ses_top_c', 'Analyze C', 2200),
    ],
    messages: [
      userMessage('m1'),
      assistantMessage('m2'),
      report('r1', 'ses_top_a', 'alpha done'),
      report('r2', 'ses_top_b', 'beta done'),
      report('r3', 'ses_top_c', 'gamma done'),
    ],
    parts: partsOf([
      ['m1', [userTextPart('p1', 'm1', 'ulw: topology fixture')]],
      ['m2', [
        toolCall('t1', 'm2', { description: 'Analyze alpha' }, 'ses_top_a'),
        toolCall('t2', 'm2', { description: 'Analyze beta' }, 'ses_top_b'),
        toolCall('t3', 'm2', { description: 'Analyze gamma' }, 'ses_top_c'),
      ]],
    ]),
  }));
  if (model === null) throw new Error('fixture must build a run');
  return model;
};

type WireNode = { id: string; depends_on: string[] };
type WireRun = {
  run_key: string;
  nodes: WireNode[];
  edges: { from: string; to: string }[];
  waves: { index: number; node_ids: string[] }[];
};

const runOf = (doc: JsonValue): WireRun => {
  // SAFETY: dagRunModelToSnapshotDoc emits exactly one run carrying this
  // envelope; this accessor only names the fields the pin reads.
  return (doc as { dag: { runs: [WireRun] } }).dag.runs[0];
};

// The exact document the fixture produced when this pin was recorded. Any
// topology, ordering, id, wave, edge, label, or timestamp change fails the
// baseline test loudly instead of drifting through review unnoticed.
const RECORDED_DOC = String.raw`{"schemaVersion":1,"sessionId":"ses_top_parent","updatedAt":"1970-01-01T00:00:09.000Z","dag":{"runs":[{"run_id":"ses_top_parent","run_key":"chat:ses_top_parent","name":"Topology fixture run","status":"completed","counts":{"pending":0,"running":0,"completed":3,"failed":0,"cancelled":0},"nodes":[{"id":"parent","label":"Topology fixture run","state":"completed","attempt":1,"prompt":"ulw: topology fixture","depends_on":[],"started_at":"1970-01-01T00:00:01.000Z","completed_at":"1970-01-01T00:00:09.000Z"},{"id":"ses_top_a","label":"Analyze alpha","state":"completed","attempt":1,"prompt":"Analyze alpha\n\nResult:\nalpha done","depends_on":["parent"],"started_at":"1970-01-01T00:00:02.000Z","completed_at":"1970-01-01T00:00:08.500Z"},{"id":"ses_top_b","label":"Analyze beta","state":"completed","attempt":1,"prompt":"Analyze beta\n\nResult:\nbeta done","depends_on":["parent"],"started_at":"1970-01-01T00:00:02.100Z","completed_at":"1970-01-01T00:00:08.500Z"},{"id":"ses_top_c","label":"Analyze gamma","state":"completed","attempt":1,"prompt":"Analyze gamma\n\nResult:\ngamma done","depends_on":["parent"],"started_at":"1970-01-01T00:00:02.200Z","completed_at":"1970-01-01T00:00:08.500Z"},{"id":"synthesis","label":"Synthesis","state":"completed","attempt":1,"prompt":"","depends_on":["ses_top_a","ses_top_b","ses_top_c"],"started_at":null,"completed_at":null}],"edges":[{"from":"parent","to":"ses_top_a"},{"from":"parent","to":"ses_top_b"},{"from":"parent","to":"ses_top_c"},{"from":"ses_top_a","to":"synthesis"},{"from":"ses_top_b","to":"synthesis"},{"from":"ses_top_c","to":"synthesis"}],"waves":[{"index":0,"node_ids":["parent"]},{"index":1,"node_ids":["ses_top_a","ses_top_b","ses_top_c"]},{"index":2,"node_ids":["synthesis"]}]}]},"tasks":null}`;

describe('chat-path topology pin (OQ3 label-only)', () => {
  test('a chat model serializes under the chat: run key with no engine tasks', () => {
    const doc = dagRunModelToSnapshotDoc(fixtureModel());
    const run = runOf(doc);
    expect(/^chat:/.test(run.run_key)).toBe(true);
    expect(run.run_key).toBe('chat:ses_top_parent');
    // SAFETY: the projection envelope always carries `tasks`; the pin is that
    // it stays null for chat-path runs.
    expect((doc as { tasks: JsonValue }).tasks).toBeNull();
  });

  test('node ids are parent + child session ids + synthesis, in that order', () => {
    const model = fixtureModel();
    const run = runOf(dagRunModelToSnapshotDoc(model));
    expect(run.nodes.map((node) => node.id)).toEqual([
      'parent',
      ...model.children.map((child) => child.sessionId),
      'synthesis',
    ]);
    expect(run.nodes.map((node) => node.id)).toEqual([
      'parent', 'ses_top_a', 'ses_top_b', 'ses_top_c', 'synthesis',
    ]);
  });

  test('depends_on encodes only parent -> child -> synthesis', () => {
    const run = runOf(dagRunModelToSnapshotDoc(fixtureModel()));
    const dependsOn = (id: string) => run.nodes.find((node) => node.id === id)?.depends_on;
    expect(dependsOn('parent')).toEqual([]);
    for (const childId of ['ses_top_a', 'ses_top_b', 'ses_top_c']) {
      expect(dependsOn(childId)).toEqual(['parent']);
    }
    expect(dependsOn('synthesis')).toEqual(['ses_top_a', 'ses_top_b', 'ses_top_c']);
  });

  test('waves stay the declared three groups: parent, children, synthesis', () => {
    // Pinned existing behaviour under OQ3 label-only. This records the
    // synthetic three-wave layout exactly as the producer emits it today; it
    // does not endorse the fabricated topology, it only forbids silent edits.
    const run = runOf(dagRunModelToSnapshotDoc(fixtureModel()));
    expect(run.waves).toEqual([
      { index: 0, node_ids: ['parent'] },
      { index: 1, node_ids: ['ses_top_a', 'ses_top_b', 'ses_top_c'] },
      { index: 2, node_ids: ['synthesis'] },
    ]);
  });

  test('the serialized chat doc matches the recorded baseline byte for byte', () => {
    const first = JSON.stringify(dagRunModelToSnapshotDoc(fixtureModel()));
    const second = JSON.stringify(dagRunModelToSnapshotDoc(fixtureModel()));
    // Same input, same bytes: the pin below can only be stable if this holds.
    expect(second).toBe(first);
    expect(first).toBe(RECORDED_DOC);
  });
});
