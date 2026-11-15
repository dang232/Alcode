import express from 'express';
import { describe, expect, it } from 'vitest';

import { registerCapabilityRoutes } from './index.js';

const startApp = async (options) => {
  const app = express();
  const mounted = registerCapabilityRoutes(app, options);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/capability`;
  return { mounted, base, stop: () => new Promise((resolve) => server.close(resolve)) };
};

describe('capability surface mounting', () => {
  it('mounts with a token resolver and answers 401 instead of 404 without a bearer', async () => {
    const { mounted, base, stop } = await startApp({
      token: () => 'resolved-token',
      createClient: async () => ({ session: { get: async () => ({ data: { id: 'ses_parent_1' } }) } }),
      taskStarter: async () => ({ taskID: 'st_1', state: 'accepted' }),
    });
    try {
      const response = await fetch(`${base}/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'd', prompt: 'p', parentSessionID: 'ses_parent_1' }),
      });

      expect(mounted).toBe(true);
      expect(response.status).toBe(401);
    } finally {
      await stop();
    }
  });

  it('does not mount at all without a token, which is what made every route answer 404', async () => {
    const { mounted, base, stop } = await startApp({ createClient: async () => ({}) });
    try {
      const response = await fetch(`${base}/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(mounted).toBe(false);
      expect(response.status).toBe(404);
    } finally {
      await stop();
    }
  });
});

describe('allowlist at the composition boundary', () => {
  it('enforces the allowlist through registerCapabilityRoutes, not only the router', async () => {
    const { mounted, base, stop } = await startApp({
      token: () => 'resolved-token',
      allowedAgents: ['explore'],
      createClient: async () => ({ session: { get: async () => ({ data: { id: 'ses_parent_1' } }) } }),
      taskStarter: async () => ({ taskID: 'st_1', state: 'accepted' }),
    });
    try {
      const response = await fetch(`${base}/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer resolved-token' },
        body: JSON.stringify({ description: 'd', prompt: 'p', parentSessionID: 'ses_parent_1', agent: 'sisyphus' }),
      });

      expect(mounted).toBe(true);
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('AGENT_NOT_ALLOWED');
    } finally {
      await stop();
    }
  });
});
