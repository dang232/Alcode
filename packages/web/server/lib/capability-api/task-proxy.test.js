import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { createTaskHostProxy } from './task-proxy.js';
import { CAPABILITY_MOUNT_PATH, registerCapabilityRoutes } from './index.js';

const TOKEN = 'configured-secret';
const BODY = { description: 'audit', prompt: 'do it', parentSessionID: 'ses_parent_1', directory: '/workspace' };
const open = [];
afterEach(async () => {
  while (open.length > 0) await open.pop().stop();
});

const stubHost = (handler) => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.post('/capability/task', (request, response) => {
    calls.push({ url: request.path, authorization: request.get('authorization'), body: request.body });
    handler(request.body, response);
  });
  const server = app.listen(0);
  open.push({ stop: () => new Promise((resolve) => server.close(resolve)) });
  return { url: `http://127.0.0.1:${server.address().port}`, calls };
};

const jsonHost = (payload) => stubHost((_body, response) => response.json(payload));
const failingHost = (status) => stubHost((_body, response) => response.status(status).send('nope'));

const existingSessionClient = async () => ({ session: { get: async ({ path }) => ({ data: { id: path.id } }) } });

const listeningApp = async (taskStarter) => {
  const app = express();
  registerCapabilityRoutes(app, { token: TOKEN, createClient: existingSessionClient, taskStarter });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  open.push({ stop: () => new Promise((resolve) => server.close(resolve)) });
  return `http://127.0.0.1:${server.address().port}`;
};

const postTask = (base) =>
  fetch(`${base}${CAPABILITY_MOUNT_PATH}/task`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(BODY),
  });

describe('task host proxy', () => {
  it('forwards the authenticated parent verbatim and returns the host task', async () => {
    const host = jsonHost({ taskID: 'task_host_1', state: 'accepted' });
    const starter = createTaskHostProxy({ url: host.url, token: 'host-secret' });
    expect(await starter(BODY)).toEqual({ taskID: 'task_host_1', state: 'accepted' });
    expect(host.calls[0].url).toBe('/capability/task');
    expect(host.calls[0].authorization).toBe('Bearer host-secret');
    expect(host.calls[0].body.parentSessionID).toBe('ses_parent_1');
  });

  it('refuses an unconfigured host', async () => {
    await expect(createTaskHostProxy({})(BODY)).rejects.toThrow(/TASK_MANAGER_UNAVAILABLE/);
  });

  it('refuses when the host is unreachable', async () => {
    const starter = createTaskHostProxy({ url: 'http://127.0.0.1:1', token: 't' });
    await expect(starter(BODY)).rejects.toThrow(/TASK_MANAGER_UNAVAILABLE/);
  });

  it('refuses a host error status and a body without a task id', async () => {
    // A host that answers with its own error code is reported as such: the caller must be able to tell a refusal from
    // an outage. A 200 body that carries no task id is still an unavailable manager.
    const failing = failingHost(500);
    await expect(createTaskHostProxy({ url: failing.url, token: 't' })(BODY)).rejects.toThrow(/TASK_HOST_500/);
    const empty = jsonHost({ state: 'accepted' });
    await expect(createTaskHostProxy({ url: empty.url, token: 't' })(BODY)).rejects.toThrow(/TASK_MANAGER_UNAVAILABLE/);
  });

  it('returns the host task through the real express route', async () => {
    const host = jsonHost({ taskID: 'task_host_2', state: 'running' });
    const base = await listeningApp(createTaskHostProxy({ url: host.url, token: 'host-secret' }));
    const response = await postTask(base);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ taskID: 'task_host_2', state: 'running' });
    expect(host.calls[0].body.parentSessionID).toBe('ses_parent_1');
  });

  it('answers the exact 503 body when the host is down', async () => {
    const base = await listeningApp(createTaskHostProxy({ url: 'http://127.0.0.1:1', token: 't' }));
    const response = await postTask(base);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'TASK_MANAGER_UNAVAILABLE',
      reason: 'no-manager',
      message: 'This server process hosts no canonical senpi-task manager, so no task was started.',
    });
  });
});
describe('host-bound parent', () => {
  it('uses the supervisor session as the parent and keeps the caller id out of it', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ taskID: 'task_1', state: 'accepted' }) }; };
    const starter = createTaskHostProxy({ url: 'http://127.0.0.1:1', token: 'host-secret', parentSessionID: 'ses_host_root', fetchImpl });
    await starter({ description: 'd', prompt: 'p', parentSessionID: 'ses_caller_unknown' });
    expect(seen[0].parentSessionID).toBe('ses_host_root');
  });

  it('keeps the caller parent when the supervisor bound none', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ taskID: 'task_1', state: 'accepted' }) }; };
    const starter = createTaskHostProxy({ url: 'http://127.0.0.1:1', token: 'host-secret', fetchImpl });
    await starter({ description: 'd', prompt: 'p', parentSessionID: 'ses_caller' });
    expect(seen[0].parentSessionID).toBe('ses_caller');
  });
});

