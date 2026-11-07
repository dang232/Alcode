import { describe, expect, test } from 'bun:test';
import type { RepairBlock } from '@/lib/runGraphApi';
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

  test('recorded verification claims ride rows and graph nodes', () => {
    const fixture = doc();
    fixture.runs[0].verificationStatus = 'verified';
    const completed = fixture.runs[0].nodes.find((node) => node.id === 'ses_child01');
    if (!completed) throw new Error('fixture must hold the completed node');
    completed.verificationStatus = 'blocked';
    fixture.runs[0].nodes.push({ id: 'ses_parent01', label: 'Run anchor', state: 'completed', prompt: '', dependsOn: [] });
    const view = engineSnapshotToView({ doc: fixture, conversationId: 'ses_parent01' });
    const rows = new Map((view?.rows ?? []).map((row) => [row.id, row]));
    expect(rows.get('ses_parent01')?.verificationStatus).toBe('verified');
    expect(rows.get('ses_child01')?.verificationStatus).toBe('blocked');
    expect(rows.get('ses_child02')?.verificationStatus).toBeUndefined();
    const nodes = new Map((view?.graph.nodes ?? []).map((node) => [node.id, node]));
    expect(nodes.get('ses_parent01')?.verificationStatus).toBe('verified');
    expect(nodes.get('ses_child01')?.verificationStatus).toBe('blocked');
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

  test('current-epoch repair state rides rows and graph nodes', () => {
    const block: RepairBlock = {
      attemptId: 'st_a.e2.r1',
      taskId: 'ses_child01',
      epoch: 2,
      state: 'repaired',
      failedChecks: ['unit'],
      rerunChecks: ['unit'],
      changedFiles: ['src/a.ts'],
      verificationStatus: 'blocked',
      hostFacts: [],
      modelHypotheses: [],
      updatedAt: 2,
    };
    const view = engineSnapshotToView({
      doc: doc(),
      conversationId: 'ses_parent01',
      repairIndex: {
        runs: { ses_child01: { repair: block } },
        tasks: { ses_child01: { repair: block } },
      },
    });
    const row = view?.rows.find((entry) => entry.id === 'ses_child01');
    expect(row?.repair?.attemptId).toBe('st_a.e2.r1');
    expect(row?.repair?.verificationStatus).toBe('blocked');
    const node = view?.graph.nodes.find((entry) => entry.id === 'ses_child01');
    expect(node?.repair?.lifecycle.map((step) => step.state)).toEqual([
      'diagnosing',
      'repair_planned',
      'repairing',
      'reverifying',
      'repaired',
    ]);
  });

  test('unreadable repair state stays an explicit error on the row', () => {
    const view = engineSnapshotToView({
      doc: doc(),
      conversationId: 'ses_parent01',
      repairIndex: {
        runs: { ses_child01: { repairError: 'repair attempt store unreadable for ses_child01: boom' } },
        tasks: {},
      },
    });
    const row = view?.rows.find((entry) => entry.id === 'ses_child01');
    expect(row?.repair).toBeUndefined();
    expect(row?.repairError).toContain('unreadable');
  });
});
