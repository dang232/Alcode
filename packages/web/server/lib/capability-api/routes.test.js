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

describe('agent allowlist', () => {
  it('refuses an agent outside the allowlist on both dispatch routes', async () => {
    const own = await startServer({
      authorize: async () => true,
      allowedAgents: ['explore'],
      createClient: () => ({ session: { promptAsync: async () => ({}) } }),
      taskStarter: async () => ({ taskID: 'st_1', state: 'accepted' }),
    });
    try {
      const started = await post(own.base, '/session/start', { sessionID: 'ses_1', prompt: 'p', directory: '/w', agent: 'sisyphus' });
      const task = await post(own.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_1', agent: 'sisyphus' });

      expect(started.status).toBe(403);
      expect((await started.json()).error).toBe('AGENT_NOT_ALLOWED');
      expect(task.status).toBe(403);
      expect((await task.json()).error).toBe('AGENT_NOT_ALLOWED');
    } finally {
      await own.stop();
    }
  });

  it('still accepts an allowlisted agent', async () => {
    const own = await startServer({
      authorize: async () => true,
      allowedAgents: ['explore'],
      createClient: () => ({ session: { promptAsync: async () => ({}) } }),
    });
    try {
      const started = await post(own.base, '/session/start', { sessionID: 'ses_1', prompt: 'p', directory: '/w', agent: 'explore' });
      expect(started.status).toBe(200);
    } finally {
      await own.stop();
    }
  });
});

describe('task start while the host is still starting', () => {
  it('answers a retryable 503 naming the lifecycle instead of a 403 refusal', async () => {
    let started = false
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      hostState: () => 'starting',
      taskStarter: async () => {
        started = true
        throw new Error('must not run')
      },
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_unknown', directory: '/workspace' })
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body.reason).toBe('host-starting')
      // The point of the fix: nothing is authorized against a parent that does not exist yet.
      expect(started).toBe(false)
    } finally {
      await server.stop()
    }
  })
})

describe('task start when the host lost its listener', () => {
  it('answers 503 host-unreachable instead of handing the task to a dead URL', async () => {
    let started = false
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      boundParent: () => 'ses_host',
      hostState: () => 'ready',
      ensureHostLive: async () => false,
      taskStarter: async () => {
        started = true
        throw new Error('must not run')
      },
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace' })
      expect(response.status).toBe(503)
      expect((await response.json()).reason).toBe('host-unreachable')
      expect(started).toBe(false)
    } finally {
      await server.stop()
    }
  })

  it('supplies the configured model when the caller names no target', async () => {
    const seen = []
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      boundParent: () => 'ses_host',
      hostState: () => 'ready',
      authorize: async () => true,
      resolveDefaultModel: async () => 'local-8317/al-1.4',
      taskStarter: async (request) => {
        seen.push(request)
        return { taskID: 'st_default', state: 'running' }
      },
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace' })
      expect(response.status).toBe(200)
      // Without this the host answers TASK_START_REFUSED: "requires a category, subagent_type, or model".
      expect(seen[0].model).toBe('local-8317/al-1.4')
    } finally {
      await server.stop()
    }
  })

  it('leaves an explicitly targeted task alone', async () => {
    const seen = []
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      boundParent: () => 'ses_host',
      hostState: () => 'ready',
      authorize: async () => true,
      resolveDefaultModel: async () => 'local-8317/al-1.4',
      taskStarter: async (request) => {
        seen.push(request)
        return { taskID: 'st_explicit', state: 'running' }
      },
    })
    try {
      await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace', model: 'other/model' })
      await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace', subagent_type: 'explore' })
      expect(seen[0].model).toBe('other/model')
      expect(seen[1].model).toBeUndefined()
    } finally {
      await server.stop()
    }
  })

  it('never authorizes a rebinding host with the stale caller parent', async () => {
    const seen = []
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      // The relaunched host reports ready a moment before its session is bound: exactly the window in which the
      // caller's own (stale) parent session id was used and the request refused.
      boundParent: () => undefined,
      hostState: () => 'ready',
      authorize: async () => false,
      taskStarter: async (request) => {
        seen.push(request)
        return { taskID: 'st_stale', state: 'running' }
      },
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_stale_from_previous_host', directory: '/workspace' })
      expect(response.status).toBe(503)
      expect((await response.json()).reason).toBe('host-rebinding')
      expect(seen).toHaveLength(0)
    } finally {
      await server.stop()
    }
  })

  it('waits for its own host instead of handing the caller a 503', async () => {
    const seen = []
    let waited = 0
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      boundParent: () => 'ses_host',
      // The host reports starting when the task arrives; the gateway waits and then serves it.
      hostState: () => 'starting',
      waitReady: async () => {
        waited += 1
        return true
      },
      authorize: async () => true,
      taskStarter: async (request) => {
        seen.push(request)
        return { taskID: 'st_waited', state: 'running' }
      },
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace' })
      expect(response.status).toBe(200)
      expect((await response.json()).taskID).toBe('st_waited')
      expect(waited).toBe(1)
      expect(seen[0].model).toBeUndefined()
    } finally {
      await server.stop()
    }
  })

  it('answers 503 only after the wait for its host runs out, and says so', async () => {
    const warnings = []
    const original = console.warn
    console.warn = (message, meta) => warnings.push({ message, meta })
    let started = false
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      hostState: () => 'starting',
      waitReady: async () => false,
      authorize: async () => true,
      taskStarter: async () => {
        started = true
        throw new Error('must not run')
      },
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace' })
      expect(response.status).toBe(503)
      expect((await response.json()).reason).toBe('host-starting')
      expect(started).toBe(false)
      expect(warnings.some((entry) => entry.message === '[capability] task deferred')).toBe(true)
    } finally {
      console.warn = original
      await server.stop()
    }
  })

  it('answers a rebinding host with a retryable 503, not a refusal', async () => {
    let started = false
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      boundParent: () => undefined,
      hostState: () => 'ready',
      authorize: async () => false,
      taskStarter: async () => {
        started = true
        throw new Error('must not run')
      },
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_caller', directory: '/workspace' })
      expect(response.status).toBe(503)
      expect((await response.json()).reason).toBe('host-rebinding')
      expect(started).toBe(false)
    } finally {
      await server.stop()
    }
  })

  it('proceeds when the host reports no lifecycle at all', async () => {
    // asNonEmptyString answers null, not undefined: a "no lifecycle" answer must not be read as "not ready".
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      boundParent: () => 'ses_host',
      hostState: () => undefined,
      ensureHostLive: async () => undefined,
      authorize: async () => true,
      taskStarter: async () => ({ taskID: 'st_nolifecycle', state: 'running' }),
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace' })
      expect(response.status).toBe(200)
      expect((await response.json()).taskID).toBe('st_nolifecycle')
    } finally {
      await server.stop()
    }
  })

  it('does not block a task when no liveness hook is wired', async () => {
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      boundParent: () => 'ses_host',
      hostState: () => 'ready',
      ensureHostLive: async () => undefined,
      authorize: async () => true,
      taskStarter: async () => ({ taskID: 'st_unchecked', state: 'running' }),
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace' })
      expect(response.status).toBe(200)
      expect((await response.json()).taskID).toBe('st_unchecked')
    } finally {
      await server.stop()
    }
  })

  it('starts the task when the host proves it is live', async () => {
    let recovered = 0
    const server = await startServer({
      token: TOKEN,
      createClient: clientFactory([]),
      boundParent: () => 'ses_host',
      hostState: () => 'ready',
      ensureHostLive: async () => {
        recovered += 1
        return true
      },
      authorize: async () => true,
      taskStarter: async () => ({ taskID: 'st_live', state: 'running' }),
    })
    try {
      const response = await post(server.base, '/task', { description: 'd', prompt: 'p', parentSessionID: 'ses_host', directory: '/workspace' })
      expect(response.status).toBe(200)
      expect((await response.json()).taskID).toBe('st_live')
      expect(recovered).toBe(1)
    } finally {
      await server.stop()
    }
  })
})
