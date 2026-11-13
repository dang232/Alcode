import { describe, expect, test } from 'bun:test';
import { parseSnapshotDoc } from './snapshotDoc';

describe('snapshot envelope', () => {
  test('off-shape input answers null, never a partial run', () => {
    expect(parseSnapshotDoc(null)).toBeNull();
    expect(parseSnapshotDoc({ nope: true })).toBeNull();
    expect(parseSnapshotDoc({ sessionId: 'ses_1', schemaVersion: 2, dag: { runs: [] } })).toBeNull();
  });

  test('recorded verification claims pass through on runs and nodes', () => {
    const parsed = parseSnapshotDoc({
      sessionId: 'ses_1',
      schemaVersion: 1,
      dag: {
        runs: [{
          run_id: 'ses_1',
          run_key: 'chat:ses_1',
          name: 'Work',
          status: 'completed',
          verification_status: 'verified',
          nodes: [{
            id: 'n1', label: 'Build', state: 'completed', prompt: 'Go',
            depends_on: [],
            verification_status: 'blocked',
          }],
          edges: [],
          waves: [{ index: 0, node_ids: ['n1'] }],
        }],
      },
    });
    expect(parsed?.runs[0]?.verificationStatus).toBe('verified');
    expect(parsed?.runs[0]?.nodes[0]?.verificationStatus).toBe('blocked');
  });

  test('absent or unreadable claims stay absent, never verified', () => {
    const parsed = parseSnapshotDoc({
      sessionId: 'ses_1',
      schemaVersion: 1,
      dag: {
        runs: [{
          run_id: 'ses_1',
          run_key: 'chat:ses_1',
          name: 'Work',
          status: 'completed',
          nodes: [
            { id: 'n1', label: 'Old', state: 'completed', prompt: 'Go', depends_on: [] },
            { id: 'n2', label: 'Odd', state: 'completed', prompt: 'Go', depends_on: [], verification_status: 'bogus' },
          ],
          edges: [],
          waves: [{ index: 0, node_ids: ['n1', 'n2'] }],
        }],
      },
    });
    expect(parsed?.runs[0]?.verificationStatus).toBeUndefined();
    expect(parsed?.runs[0]?.nodes[0]?.verificationStatus).toBeUndefined();
    expect(parsed?.runs[0]?.nodes[1]?.verificationStatus).toBeUndefined();
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

  test('child task attribution round-trips and absent stays absent', () => {
    const parsed = parseSnapshotDoc({
      sessionId: 'ses_1',
      schemaVersion: 1,
      dag: {
        runs: [{
          run_id: 'ses_1',
          run_key: 'chat:ses_1',
          name: 'Work',
          status: 'completed',
          nodes: [
            { id: 'n1', label: 'Build', state: 'completed', prompt: 'Go', depends_on: [], task_id: 'st_child01' },
            { id: 'n2', label: 'Plan', state: 'completed', prompt: 'Go', depends_on: [] },
          ],
          edges: [],
          waves: [{ index: 0, node_ids: ['n1', 'n2'] }],
        }],
      },
    });
    expect(parsed?.runs[0]?.nodes[0]?.taskId).toBe('st_child01');
    expect(parsed?.runs[0]?.nodes[1]?.taskId).toBeUndefined();
    expect(Object.hasOwn(parsed?.runs[0]?.nodes[1] ?? {}, 'taskId')).toBe(false);
  });

  test('DAG node attribution round-trips, and a legacy doc without it is unchanged', () => {
    const doc = (nodeId?: string) => {
      const node = { id: 'n1', label: 'Build', state: 'completed', prompt: 'Go', depends_on: [] };
      return {
        sessionId: 'ses_1',
        schemaVersion: 1,
        dag: {
          runs: [{
            run_id: 'ses_1',
            run_key: 'chat:ses_1',
            name: 'Work',
            status: 'completed',
            nodes: [nodeId === undefined ? node : { ...node, node_id: nodeId }],
            edges: [],
            waves: [{ index: 0, node_ids: ['n1'] }],
          }],
        },
      };
    };

    const withId = parseSnapshotDoc(doc('node_alpha'));
    expect(withId?.runs[0]?.nodes[0]?.nodeId).toBe('node_alpha');

    const legacy = parseSnapshotDoc(doc());
    expect(legacy?.runs[0]?.nodes[0]?.nodeId).toBeUndefined();
    expect(Object.hasOwn(legacy?.runs[0]?.nodes[0] ?? {}, 'nodeId')).toBe(false);
    expect(legacy).toEqual({
      sessionId: 'ses_1',
      runs: [{
        runId: 'ses_1',
        runKey: 'chat:ses_1',
        name: 'Work',
        status: 'completed',
        verificationStatus: undefined,
        nodes: [{
          id: 'n1',
          label: 'Build',
          state: 'completed',
          prompt: 'Go',
          dependsOn: [],
          verificationStatus: undefined,
        }],
        edges: [],
        waves: [{ index: 0, nodeIds: ['n1'] }],
      }],
    });
  });

  test('a non-string DAG node id makes the envelope unreadable, never a coerced string', () => {
    const parsed = parseSnapshotDoc({
      sessionId: 'ses_1',
      schemaVersion: 1,
      dag: {
        runs: [{
          run_id: 'ses_1',
          run_key: 'chat:ses_1',
          name: 'Work',
          status: 'completed',
          nodes: [{ id: 'n1', label: 'Build', state: 'completed', prompt: 'Go', depends_on: [], node_id: 7 }],
          edges: [],
        }],
      },
    });
    expect(parsed).toBeNull();
  });
});
