import express from 'express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createRecordTaskReader } from './record-tasks.js';
import { createRunGraphRuntime } from './runtime.js';
import { registerRunGraphRoutes } from './routes.js';

const roots = [];

const createApp = (overrides = {}) => {
  const received = {};
  const runtime = {
    normalizeDirectory: async (directory) => {
      received.directory = directory;
      if (!directory) {
        return { error: 'directory is required' };
      }
      return { directory: `/projects/${directory}` };
    },
    readSnapshot: async (directory, conversationId) => {
      received.snapshot = { directory, conversationId };
      if (!conversationId) {
        return { error: 'conversationId is required', status: 400 };
      }
      if (conversationId === 'missing') {
        return { error: 'no run snapshot for conversation: missing', status: 404 };
      }
      return { sessionId: conversationId, dag: { runs: [] } };
    },
    ...overrides.runtime,
  };

  const app = express();
  registerRunGraphRoutes(app, { runGraphRuntime: runtime });
  return { app, received };
};

describe('directory scope', () => {
  it('refuses a request with no directory rather than reading the server cwd', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/run-graph/snapshot?conversationId=ses_1');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('directory is required');
  });
});

describe('directory safety', () => {
  it('refuses a UNC path before any filesystem call, so a request cannot dial a host', async () => {
    const app = express();
    registerRunGraphRoutes(app, {
      runGraphRuntime: createRunGraphRuntime({
        readRecordTasks: () => ({ tasks: [], absent: true }),
        readRepairState: () => ({}),
        readAttributionState: () => ({ absent: true, entries: [], byChildSessionId: {}, byTaskId: {}, collisions: [] }),
        readDeliveryState: (input) => input,
      }),
    });

    const response = await request(app).get('/api/run-graph/snapshot?directory=' + encodeURIComponent('\\\\attacker.example\\share') + '&conversationId=ses_1');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'DAG_DIRECTORY_UNSUPPORTED' });
  });
});

describe('machine-readable failure codes', () => {
  it('carries the code beside the message, so a client branches on the reason and not on the wording', async () => {
    const { app } = createApp({
      runtime: {
        readSnapshot: async () => ({ error: 'run snapshot is malformed: ses_1', status: 422, code: 'DAG_SNAPSHOT_MALFORMED' }),
      },
    });

    const response = await request(app).get('/api/run-graph/snapshot?directory=p&conversationId=ses_1');

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'run snapshot is malformed: ses_1', code: 'DAG_SNAPSHOT_MALFORMED' });
  });

  it('agrees with the pane service on a missing conversation', async () => {
    const { app } = createApp({
      runtime: {
        readSnapshot: async () => ({ error: 'no run snapshot for conversation: gone', status: 404, code: 'DAG_SNAPSHOT_MISSING' }),
      },
    });

    const response = await request(app).get('/api/run-graph/snapshot?directory=p&conversationId=gone');

    expect(response.body.code).toBe('DAG_SNAPSHOT_MISSING');
    expect(response.status).toBe(404);
  });

  it('omits the code rather than inventing one when the runtime gives none', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/run-graph/snapshot?directory=p&conversationId=missing');

    expect(response.body).toEqual({ error: 'no run snapshot for conversation: missing' });
    expect(response.body.code).toBeUndefined();
  });
});

describe('conversation scope', () => {
  it('answers 400 without a conversation id', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/run-graph/snapshot?directory=proj');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('conversationId is required');
  });

  it('answers 404 for a conversation with no snapshot', async () => {
    const { app } = createApp();

    const response = await request(app).get('/api/run-graph/snapshot?directory=proj&conversationId=missing');

    expect(response.status).toBe(404);
  });

  it('serves the persisted snapshot for a known conversation', async () => {
    const { app, received } = createApp();

    const response = await request(app).get('/api/run-graph/snapshot?directory=proj&conversationId=ses_1');

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe('ses_1');
    expect(received.snapshot).toEqual({ directory: '/projects/proj', conversationId: 'ses_1' });
  });

  it('passes a recorded verification_status through unchanged', async () => {
    const snapshot = {
      sessionId: 'ses_1',
      dag: {
        runs: [{
          run_id: 'ses_1',
          status: 'completed',
          verification_status: 'blocked',
          nodes: [{ id: 'n1', state: 'completed', verification_status: 'verified' }],
        }],
      },
    };
    const { app } = createApp({ runtime: { readSnapshot: async () => snapshot } });

    const response = await request(app).get('/api/run-graph/snapshot?directory=proj&conversationId=ses_1');

    expect(response.status).toBe(200);
    expect(response.body.dag.runs[0].verification_status).toBe('blocked');
    expect(response.body.dag.runs[0].nodes[0].verification_status).toBe('verified');
  });
});

describe('project isolation through the real route', () => {
  const makeProject = (tasks) => {
    const root = mkdtempSync(join(tmpdir(), 'r1-12-http-iso-'));
    roots.push(root);
    const dir = join(root, 'state', 'tasks');
    mkdirSync(dir, { recursive: true });
    for (const task of tasks) writeFileSync(join(dir, `${task.task_id}.json`), JSON.stringify(task), 'utf8');
    return root;
  };

  it('serves project A only, even when project B holds a task for the same conversation', async () => {
    const projectA = makeProject([{ task_id: 'st_a', status: 'completed', parent_session_id: 'ses_shared', root_session_id: 'ses_shared' }]);
    const projectB = makeProject([{ task_id: 'st_b', status: 'completed', parent_session_id: 'ses_shared', root_session_id: 'ses_shared' }]);

    const runtimeFor = (root) =>
      createRunGraphRuntime({
        readRecordTasks: createRecordTaskReader({ stateDirOf: () => join(root, 'state'), cache: false }),
        readRepairState: () => ({}),
        readAttributionState: () => ({ absent: true, entries: [], byChildSessionId: {}, byTaskId: {}, collisions: [] }),
        readDeliveryState: (input) => input,
      });

    const appA = express();
    registerRunGraphRoutes(appA, { runGraphRuntime: runtimeFor(projectA) });
    const appB = express();
    registerRunGraphRoutes(appB, { runGraphRuntime: runtimeFor(projectB) });

    const answerA = await request(appA).get('/api/run-graph/snapshot?directory=' + encodeURIComponent(projectA) + '&conversationId=ses_shared');
    const answerB = await request(appB).get('/api/run-graph/snapshot?directory=' + encodeURIComponent(projectB) + '&conversationId=ses_shared');

    expect(answerA.status).toBe(200);
    expect(answerA.body.tasks.tasks.map((task) => task.task_id)).toEqual(['st_a']);
    expect(answerB.body.tasks.tasks.map((task) => task.task_id)).toEqual(['st_b']);
  });

  it('ignores a state directory the caller tries to name', async () => {
    const projectA = makeProject([{ task_id: 'st_a', status: 'running', parent_session_id: 'ses_1' }]);
    const projectB = makeProject([{ task_id: 'st_b', status: 'running', parent_session_id: 'ses_1' }]);
    const read = createRecordTaskReader({ stateDirOf: () => join(projectA, 'state'), cache: false });

    const result = read({ directory: projectA, stateDir: join(projectB, 'state') });

    expect(result.tasks.map((task) => task.task_id)).toEqual(['st_a']);
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
