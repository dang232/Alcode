import { describe, expect, test } from 'bun:test';
import { parseSnapshotDoc } from './snapshotDoc';

describe('snapshot envelope', () => {
  test('off-shape input answers null, never a partial run', () => {
    expect(parseSnapshotDoc(null)).toBeNull();
    expect(parseSnapshotDoc({ nope: true })).toBeNull();
    expect(parseSnapshotDoc({ sessionId: 'ses_1', schemaVersion: 2, dag: { runs: [] } })).toBeNull();
  });

  test('wire names map to the domain shape', () => {
    const parsed = parseSnapshotDoc({
      sessionId: 'ses_1',
      schemaVersion: 1,
      dag: {
        runs: [{
          run_id: 'ses_1',
          run_key: 'chat:ses_1',
          name: 'Work',
          status: 'running',
          nodes: [{
            id: 'parent', label: 'Work', state: 'running', prompt: 'Go',
            depends_on: [],
          }],
          edges: [],
          waves: [{ index: 0, node_ids: ['parent'] }],
        }],
      },
    });
    expect(parsed?.runs[0]?.runId).toBe('ses_1');
    expect(parsed?.runs[0]?.nodes[0]?.dependsOn).toEqual([]);
  });
});
