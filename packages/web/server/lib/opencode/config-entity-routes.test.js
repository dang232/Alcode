import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerConfigEntityRoutes } from './config-entity-routes.js';

const createApp = () => {
  const calls = [];
  const record = (action) => (name) => {
    calls.push({ action, name });
    return {};
  };
  const app = express();
  app.use(express.json());
  registerConfigEntityRoutes(app, {
    resolveProjectDirectory: async () => ({ directory: '/work/project' }),
    resolveOptionalProjectDirectory: async () => ({ directory: '/work/project' }),
    getAgentSources: () => ({ md: { exists: false }, json: { exists: false } }),
    createAgent: record('createAgent'),
    deleteAgent: record('deleteAgent'),
    createCommand: record('createCommand'),
    deleteCommand: record('deleteCommand'),
  });
  return { app, calls };
};

describe('config entity names', () => {
  it.each([
    ['post', '/api/config/agents/..%2F..%2Fescape'],
    ['delete', '/api/config/agents/%2Ftmp%2Fescape'],
    ['post', '/api/config/commands/group%2F..%2F..%2Fescape'],
    ['delete', '/api/config/commands/..%5Cescape'],
  ])('refuses %s %s before it reaches the filesystem', async (method, url) => {
    const { app, calls } = createApp();
    const response = await request(app)[method](url).send({});
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('serves the OmO agent catalog without shadowing agent names', async () => {
    const { app } = createApp();
    const response = await request(app).get('/api/config/agents/catalog');
    expect(response.status).toBe(200);
    expect(response.body.version).toBe(1);
    const ids = response.body.items.map((item) => item.id);
    expect(ids).toContain('explore');
    expect(ids).toContain('quick');
    for (const item of response.body.items) {
      expect(item.source).toBe('omo-compatible');
    }
  });

  it('accepts plain and nested names', async () => {
    const { app, calls } = createApp();
    expect((await request(app).post('/api/config/agents/reviewer').send({})).status).toBe(200);
    expect((await request(app).post('/api/config/commands/git%2Fcommit').send({})).status).toBe(200);
    expect(calls).toEqual([
      { action: 'createAgent', name: 'reviewer' },
      { action: 'createCommand', name: 'git/commit' },
    ]);
  });

  it('refreshes the managed child config after agent writes, except project scope', async () => {
    const refreshed = [];
    const app = express();
    app.use(express.json());
    registerConfigEntityRoutes(app, {
      resolveProjectDirectory: async () => ({ directory: '/work/project' }),
      resolveOptionalProjectDirectory: async () => ({ directory: '/work/project' }),
      createAgent: () => ({ source: 'md', scope: 'user', path: '/home/user/.config/opencode/agents/x.md' }),
      updateAgent: (name) => ({ source: 'md', scope: 'user', path: '/home/user/.config/opencode/agents/x.md' }),
      deleteAgent: () => {},
      refreshManagedAgentsForChild: async () => { refreshed.push(true); },
    });

    // PATCH has no scope: the write may have landed in user files.
    expect((await request(app).patch('/api/config/agents/x').send({ mode: 'primary' })).status).toBe(200);
    // POST/DELETE with an explicit project scope leave the managed file alone.
    expect((await request(app).post('/api/config/agents/y').send({ scope: 'project' })).status).toBe(200);
    expect((await request(app).delete('/api/config/agents/y').send({ scope: 'project' })).status).toBe(200);
    expect(refreshed).toEqual([true]);
  });
});
