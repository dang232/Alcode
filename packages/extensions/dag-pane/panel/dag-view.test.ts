// View-model tests for the alcode-builtin-dag-pane guest (project-ide todo 13).
// bun:test, no DOM: the pure helpers only. The happy path consumes the
// real todo-6 fixture through the real bridge writer shape, so the test
// proves the pane renders what the adapter actually writes.
import { describe, expect, test } from 'bun:test';

import { keepStoredRunModel, mergeRunModelPost, parseSnapshotDoc, resolveSelectedSession } from './dag-view.ts';
import { DAG_PANE_LOCALES, stringsFor } from './strings.ts';
import fixture from '../../../web/server/lib/opencode/omo-bridge-fixture.json';

const snapshotDoc = (sessionId: string) => {
  const writer = {
    dag: sessionId === fixture.sessionId ? fixture.dagUpdated : fixture.dagUpdatedOtherSession,
    tasks: sessionId === fixture.sessionId ? fixture.taskUpdated : null,
  };
  return {
    schemaVersion: 1,
    sessionId,
    updatedAt: '2026-10-08T08:01:00.000Z',
    dag: writer.dag,
    tasks: writer.tasks,
  };
};

describe('parseSnapshotDoc', () => {
  test('renders the todo-6 fixture as runs with node details', () => {
    const outcome = parseSnapshotDoc(snapshotDoc(fixture.sessionId));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.view.sessionId).toBe('ses_fixture01');
    expect(outcome.view.runs).toHaveLength(1);
    const run = outcome.view.runs[0];
    expect(run.runKey).toBe('fixture-a');
    expect(run.status).toBe('running');
    expect(run.nodes.map((node) => node.label)).toEqual(['plan', 'build', 'verify']);
    expect(run.nodes.map((node) => node.state)).toEqual(['completed', 'running', 'pending']);
    const build = run.nodes.find((node) => node.id === 'node_build');
    expect(build?.prompt).toBe('Build the fixture bridge');
    expect(build?.dependsOn).toEqual(['node_plan']);
    expect(run.edges).toEqual([
      { from: 'node_plan', to: 'node_build' },
      { from: 'node_build', to: 'node_verify' },
    ]);
    expect(outcome.view.tasks.map((task) => task.taskId)).toEqual(['st_fixture0000000000000001']);
  });

  test('a null dag is an empty view, not malformed', () => {
    const outcome = parseSnapshotDoc({
      schemaVersion: 1,
      sessionId: 'ses_fixture01',
      updatedAt: '2026-10-08T08:01:00.000Z',
      dag: null,
      tasks: null,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.view.runs).toEqual([]);
    }
  });

  test.each([
    ['not json{', 'snapshot'],
    ['[1,2,3]', 'snapshot'],
    ['{"type":"omo.dag.updated"}', 'sessionId'],
    ['{"type":"omo.unknown.event","data":{"parent_session_id":"ses_fixture01"}}', 'sessionId'],
    ['{"type":"omo.task.updated","data":{"parent_session_id":"ses_other02","tasks":[]}}', 'sessionId'],
  ])('malformed fixture line %p degrades to an error naming %p', (line, field) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      raw = line;
    }
    const outcome = parseSnapshotDoc(raw);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('DAG_SNAPSHOT_MALFORMED');
      expect(outcome.error.field).toBe(field);
    }
  });

  test.each([
    [{}, 'sessionId'],
    [{ schemaVersion: 1 }, 'sessionId'],
    [{ schemaVersion: 2, sessionId: 's' }, 'schemaVersion'],
    [{ schemaVersion: 1, sessionId: 's', dag: { runs: 'nope' } }, 'dag.runs'],
    [{ schemaVersion: 1, sessionId: 's', dag: { runs: [null] } }, 'dag.runs[0]'],
    [{ schemaVersion: 1, sessionId: 's', dag: { runs: [{ run_id: 'r' }] } }, 'dag.runs[0]'],
    [{
      schemaVersion: 1,
      sessionId: 's',
      dag: { runs: [{ run_id: 'r', run_key: 'k', name: 'n', status: 'running', nodes: [{ id: 'a' }] }] },
    }, 'dag.runs[0]'],
    [{ schemaVersion: 1, sessionId: 's', dag: null, tasks: { tasks: 'nope' } }, 'tasks'],
  ])('shape violation %p names field %p', (raw, field) => {
    const outcome = parseSnapshotDoc(raw);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toEqual({ code: 'DAG_SNAPSHOT_MALFORMED', field });
    }
  });
});

describe('stringsFor', () => {
  test('covers every shipped locale with real text', () => {
    expect(DAG_PANE_LOCALES).toHaveLength(13);
    for (const locale of DAG_PANE_LOCALES) {
      const strings = stringsFor(locale);
      expect(strings.title.length).toBeGreaterThan(0);
      expect(strings.cancel.length).toBeGreaterThan(0);
    }
  });

  test('unknown locales fall back to English, prefixes resolve', () => {
    expect(stringsFor('xx-YY').title).toBe('DAG runs');
    expect(stringsFor('pt').title).toBe('Execuções DAG');
    expect(stringsFor('pt-BR').cancel).toBe('Cancelar');
    expect(stringsFor('zh_TW').title).toBe('DAG 執行');
  });
});

describe('resolveSelectedSession', () => {
  const sessions = ['ses_a', 'ses_b'];
  test('host session wins over list order (never sessions[0] by default)', () => {
    expect(resolveSelectedSession({ hostSessionId: 'ses_b', current: null, sessions })).toBe('ses_b');
  });
  test('manual pick survives while listed and host is absent', () => {
    expect(resolveSelectedSession({ hostSessionId: null, current: 'ses_b', sessions })).toBe('ses_b');
  });
  test('gone selection falls back to host, never the list head', () => {
    expect(resolveSelectedSession({ hostSessionId: 'ses_b', current: 'ses_gone', sessions })).toBe('ses_b');
    expect(resolveSelectedSession({ hostSessionId: null, current: 'ses_gone', sessions })).toBeNull();
  });
  test('runless host session selects itself (empty view, not a foreign DAG)', () => {
    expect(resolveSelectedSession({ hostSessionId: 'ses_new', current: 'ses_a', sessions })).toBe('ses_new');
    expect(resolveSelectedSession({ hostSessionId: 'ses_new', current: null, sessions: [] })).toBe('ses_new');
  });
  test('empty list selects the host session, else nothing', () => {
    expect(resolveSelectedSession({ hostSessionId: 'ses_b', current: 'ses_a', sessions: [] })).toBe('ses_b');
    expect(resolveSelectedSession({ hostSessionId: null, current: null, sessions: [] })).toBeNull();
  });
});

describe('keepStoredRunModel', () => {
  test('early post for the bound conversation survives the bind', () => {
    expect(keepStoredRunModel('ses_b', 'ses_b')).toBe(true);
  });
  test('switch to another conversation clears the stale post', () => {
    expect(keepStoredRunModel('ses_a', 'ses_b')).toBe(false);
  });
  test('no stored post and no session keep nothing', () => {
    expect(keepStoredRunModel(null, 'ses_b')).toBe(false);
    expect(keepStoredRunModel('ses_a', null)).toBe(false);
    expect(keepStoredRunModel(null, null)).toBe(false);
  });
});

describe('mergeRunModelPost', () => {
  const doc = { schemaVersion: 1, sessionId: 'ses_a', runs: [] };

  test('a null post for the stored conversation keeps the visible run', () => {
    const stored = { conversationId: 'ses_a', snapshot: doc };
    expect(mergeRunModelPost(stored, { conversationId: 'ses_a', snapshot: null })).toBe(stored);
  });

  test('a null post for another conversation replaces the stored doc', () => {
    const merged = mergeRunModelPost(
      { conversationId: 'ses_a', snapshot: doc },
      { conversationId: 'ses_b', snapshot: null },
    );
    expect(merged).toEqual({ conversationId: 'ses_b', snapshot: null });
  });

  test('a real post always replaces what was stored', () => {
    const next = { schemaVersion: 1, sessionId: 'ses_a', runs: [{ run_id: 'r2' }] };
    const merged = mergeRunModelPost(
      { conversationId: 'ses_a', snapshot: doc },
      { conversationId: 'ses_a', snapshot: next },
    );
    expect(merged.snapshot).toEqual(next);
  });
});

describe('run counts truthfulness (audit-fixes-b)', () => {
  const runDoc = (counts: Record<string, number>) => ({
    schemaVersion: 1,
    sessionId: 'ses_a',
    updatedAt: '2026-10-24T00:00:00.000Z',
    dag: {
      runs: [{
        run_id: 'r1', run_key: 'k', name: 'n', status: 'failed',
        nodes: [{ id: 'a', label: 'a', state: 'failed', attempt: 1, prompt: 'do a', depends_on: [], started_at: null, completed_at: null }],
        edges: [],
        counts,
      }],
    },
    tasks: null,
  });
  test('failed plus cancelled counts survive the parse instead of vanishing', () => {
    const outcome = parseSnapshotDoc(runDoc({ pending: 0, running: 0, completed: 0, failed: 1, cancelled: 1 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.view.runs[0]?.counts).toEqual({ pending: 0, running: 0, completed: 0, failed: 1, cancelled: 1 });
  });
  test('missing failed/cancelled counts read as zero for old snapshots', () => {
    const outcome = parseSnapshotDoc(runDoc({ pending: 1, running: 0, completed: 2 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.view.runs[0]?.counts).toEqual({ pending: 1, running: 0, completed: 2, failed: 0, cancelled: 0 });
  });
});
