import { describe, expect, test } from 'bun:test';
import { engineSnapshotToView } from './engineSnapshotModel';
import type { SnapshotDoc } from './snapshotDoc';

const doc = (): SnapshotDoc => ({
  sessionId: 'ses_parent01',
  runs: [{
    runId: 'ses_parent01',
    runKey: 'chat:ses_parent01',
    name: 'Repository analysis',
    status: 'running',
    nodes: [
      { id: 'parent', label: 'Repository analysis', state: 'running', prompt: 'Analyze the callers', dependsOn: [] },
      { id: 'ses_child01', label: 'explore — Analyze', state: 'completed', prompt: 'Analyze', dependsOn: ['parent'] },
      { id: 'ses_child02', label: 'quick — Survey', state: 'parked', prompt: 'Survey', dependsOn: ['parent'] },
      { id: 'synthesis', label: 'Synthesis', state: 'pending', prompt: '', dependsOn: ['ses_child01', 'ses_child02'] },
    ],
    edges: [
      { from: 'parent', to: 'ses_child01' },
      { from: 'parent', to: 'ses_child02' },
      { from: 'ses_child01', to: 'synthesis' },
      { from: 'ses_child02', to: 'synthesis' },
    ],
    waves: [
      { index: 0, nodeIds: ['parent'] },
      { index: 1, nodeIds: ['ses_child01', 'ses_child02'] },
      { index: 2, nodeIds: ['synthesis'] },
    ],
  }],
});

describe('engine snapshot view', () => {
  test('a missing snapshot answers null so the caller falls back', () => {
    expect(engineSnapshotToView({ doc: null, conversationId: 'ses_parent01' })).toBeNull();
  });

  test('nodes map states with parked shown as blocked', () => {
    const view = engineSnapshotToView({ doc: doc(), conversationId: 'ses_parent01' });
    const byId = new Map((view?.rows ?? []).map((row) => [row.id, row.state]));
    expect(byId.get('parent')).toBe('running');
    expect(byId.get('ses_child01')).toBe('completed');
    expect(byId.get('ses_child02')).toBe('blocked');
    expect(byId.get('synthesis')).toBe('pending');
  });

  test('graph places waves left to right with blocking edges into unsettled nodes', () => {
    const view = engineSnapshotToView({ doc: doc(), conversationId: 'ses_parent01' });
    const byId = new Map((view?.graph.nodes ?? []).map((node) => [node.id, node]));
    expect(byId.get('parent')?.wave).toBe(0);
    expect(byId.get('ses_child01')?.wave).toBe(1);
    expect(byId.get('synthesis')?.wave).toBe(2);
    expect(byId.get('ses_child02')?.x).toBe(byId.get('ses_child01')?.x);
    expect(byId.get('ses_child02')?.y).toBeGreaterThan(byId.get('ses_child01')?.y ?? 0);
    expect(view?.graph.edges.some((edge) => edge.from === 'ses_child02' && edge.to === 'synthesis' && edge.blocking)).toBe(true);
    expect(view?.graph.edges.some((edge) => edge.from === 'parent' && edge.to === 'ses_child01' && !edge.blocking)).toBe(true);
  });
});
