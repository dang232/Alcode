import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { createTaskStarter } from './task-starter.js';
import { CAPABILITY_MOUNT_PATH, registerCapabilityRoutes } from './index.js';

const TOKEN = 'configured-secret';
const open = [];
afterEach(async () => {
  while (open.length > 0) await open.pop().stop();
});

const listening = async (app) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  open.push({ stop: () => new Promise((resolve) => server.close(resolve)) });
  return base;
};

const TASK_BODY = { description: 'audit', prompt: 'do it', parentSessionID: 'ses_parent_1', directory: '/workspace' };

describe('task starter seam', () => {
  it('forwards the authenticated parent verbatim and returns the manager task', async () => {
    const seen = [];
    const starter = createTaskStarter({
      start: async (request) => {
        seen.push(request);
        return { taskID: 'task_1', state: 'running' };
      },
    });
    expect(await starter(TASK_BODY)).toEqual({ taskID: 'task_1', state: 'running' });
    expect(seen[0].parentSessionID).toBe('ses_parent_1');
  });

  it('refuses when no manager is supplied', async () => {
    await expect(createTaskStarter(undefined)(TASK_BODY)).rejects.toThrow(/TASK_MANAGER_UNAVAILABLE/);
  });

  it('refuses a manager without a start operation', async () => {
    await expect(createTaskStarter({})(TASK_BODY)).rejects.toThrow(/TASK_MANAGER_UNAVAILABLE/);
  });

  it('refuses a request with no authenticated parent', async () => {
    const starter = createTaskStarter({ start: async () => ({ taskID: 't', state: 'accepted' }) });
    await expect(starter({ ...TASK_BODY, parentSessionID: '   ' })).rejects.toThrow(/TASK_MANAGER_UNAVAILABLE/);
  });

  it('never invents a task identity', async () => {
    const starter = createTaskStarter({ start: async () => ({ state: 'accepted' }) });
    await expect(starter(TASK_BODY)).rejects.toThrow(/TASK_MANAGER_UNAVAILABLE/);
  });
});

const existingSessionClient = async () => ({ session: { get: async ({ sessionID }) => ({ id: sessionID }) } });

describe('route wired to the seam', () => {
  const post = (base) =>
    fetch(`${base}${CAPABILITY_MOUNT_PATH}/task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(TASK_BODY),
    });

  it('answers the exact 503 body while no manager exists', async () => {
    const app = express();
    registerCapabilityRoutes(app, { token: TOKEN, createClient: existingSessionClient, taskStarter: createTaskStarter(undefined) });
    const base = await listening(app);
    const response = await post(base);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'TASK_MANAGER_UNAVAILABLE',
      reason: 'no-manager',
      message: 'This server process hosts no canonical senpi-task manager, so no task was started.',
    });
  });

  it('returns the manager task when one is supplied', async () => {
    const app = express();
    registerCapabilityRoutes(app, {
      token: TOKEN,
      createClient: existingSessionClient,
      taskStarter: createTaskStarter({ start: async () => ({ taskID: 'task_9', state: 'accepted' }) }),
    });
    const base = await listening(app);
    const response = await post(base);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ taskID: 'task_9', state: 'accepted' });
  });
});
