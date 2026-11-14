import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCapabilityRouter } from './routes.js';

const TOKEN = 'test-bearer-token';

const startServer = async (options) => {
  const app = express();
  app.use('/capability', createCapabilityRouter(options));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/capability`;
  return { base, stop: () => new Promise((resolve) => server.close(resolve)) };
};

const post = (base, path, body, { token = TOKEN } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
};

const SESSION_BODY = { parentID: 'ses_parent_1', title: 'child', directory: '/workspace' };

const clientFactory = (calls, { failCreate = false, failPrompt = false, throwPrompt = false } = {}) => async ({ directory }) => ({
  session: {
    create: async (input) => {
      calls.push({ op: 'create', input, directory });
      return failCreate ? { error: 'engine said no' } : { data: { id: 'ses_child_1', parentID: input.body.parentID } };
    },
    promptAsync: async (input) => {
      calls.push({ op: 'prompt', input, directory });
      if (throwPrompt) throw new Error('socket hang up');
      return failPrompt ? { error: 'rejected' } : { data: {} };
    },
  },
});

describe('capability routes', () => {
  let server;
  beforeAll(async () => {
    server = await startServer({ createClient: clientFactory([]), authorize: async () => true });
  });
  afterAll(async () => {
    await server.stop();
  });

  it('rejects a request with no bearer token', async () => {
    const response = await post(server.base, '/session', SESSION_BODY, { token: null });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('UNAUTHORIZED');
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('rejects a malformed body with 400', async () => {
    const response = await post(server.base, '/session', { parentID: 'ses_parent_1' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('INVALID_ARGUMENT');
  });

  it('echoes the parent it created the child under', async () => {
    const calls = [];
    const own = await startServer({ createClient: clientFactory(calls), authorize: async () => true });
    try {
      const response = await post(own.base, '/session', SESSION_BODY);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ sessionID: 'ses_child_1', parentID: 'ses_parent_1' });
      expect(calls[0].input.body.parentID).toBe('ses_parent_1');
      expect(calls[0].directory).toBe('/workspace');
    } finally {
      await own.stop();
    }
  });
});

describe('parent scoping', () => {
  it('refuses a token that may not mint a child under the named parent', async () => {
    const own = await startServer({
      createClient: clientFactory([]),
      authorize: async ({ parentID }) => parentID === 'ses_allowed',
    });
    try {
      const denied = await post(own.base, '/session', SESSION_BODY);
      expect(denied.status).toBe(403);
      const granted = await post(own.base, '/session', { ...SESSION_BODY, parentID: 'ses_allowed' });
      expect(granted.status).toBe(200);
    } finally {
      await own.stop();
    }
  });

  it('denies by default when no authorizer is supplied', async () => {
    const own = await startServer({ createClient: clientFactory([]) });
    try {
      expect((await post(own.base, '/session', SESSION_BODY)).status).toBe(403);
    } finally {
      await own.stop();
    }
  });
});

describe('session start outcomes', () => {
  const start = async (client) => {
    const own = await startServer({ createClient: client, authorize: async () => true });
    try {
      return await post(own.base, '/session/start', { sessionID: 'ses_child_1', prompt: 'do it', directory: '/workspace' });
    } finally {
      await own.stop();
    }
  };

  it('reports accepted when the host accepted the prompt', async () => {
    expect(await (await start(clientFactory([]))).json()).toEqual({ outcome: 'accepted' });
  });

  it('reports refused when the host rejected the prompt', async () => {
    expect(await (await start(clientFactory([], { failPrompt: true }))).json()).toEqual({ outcome: 'refused' });
  });

  it('reports unknown when the dispatch throws', async () => {
    expect(await (await start(clientFactory([], { throwPrompt: true }))).json()).toEqual({ outcome: 'unknown' });
  });
});

describe('task capability', () => {
  it('answers the exact 503 body when no manager is reachable', async () => {
    const own = await startServer({ authorize: async () => true });
    try {
      const response = await post(own.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_parent_1' });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'TASK_MANAGER_UNAVAILABLE',
        reason: 'no-manager',
        message: 'This server process hosts no canonical senpi-task manager, so no task was started.',
      });
    } finally {
      await own.stop();
    }
  });

  it('never answers 200 without a real task identity', async () => {
    const own = await startServer({ authorize: async () => true, taskStarter: async () => ({ state: 'accepted' }) });
    try {
      const response = await post(own.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_parent_1' });
      expect(response.status).toBe(502);
    } finally {
      await own.stop();
    }
  });

  it('returns the manager task identity and state verbatim', async () => {
    const seen = [];
    const own = await startServer({
      authorize: async () => true,
      taskStarter: async (request) => {
        seen.push(request);
        return { taskID: 'task_1', state: 'running' };
      },
    });
    try {
      const response = await post(own.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_parent_1' });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ taskID: 'task_1', state: 'running' });
      expect(seen[0].parentSessionID).toBe('ses_parent_1');
    } finally {
      await own.stop();
    }
  });
});
