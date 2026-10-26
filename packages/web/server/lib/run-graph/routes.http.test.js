import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerRunGraphRoutes } from './routes.js';

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
});
