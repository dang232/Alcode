import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { createCapabilityAuthorizer } from './authorization.js';
import { CAPABILITY_MOUNT_PATH, registerCapabilityRoutes } from './index.js';

const TOKEN = 'configured-secret';

const makeClient = (sessions) => async ({ directory }) => ({
  session: {
    get: async ({ path }) => {
      const found = sessions.find((session) => session.id === path.id);
      return found ? { data: found } : { error: 'not found' };
    },
    create: async () => ({ data: { id: 'ses_new', parentID: 'ses_parent' } }),
    promptAsync: async () => ({ data: {} }),
  },
  directory,
});

const listening = async (app) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((resolve) => server.close(resolve)) };
};

const open = [];
afterEach(async () => {
  while (open.length > 0) await open.pop().stop();
});

describe('capability authorizer', () => {
  const authorizer = (sessions, token = TOKEN) => createCapabilityAuthorizer({ token, createClient: makeClient(sessions) });

  it('denies every call when no token is configured', async () => {
    const deny = authorizer([{ id: 'ses_parent' }], '');
    expect(await deny({ token: '', parentID: 'ses_parent' })).toBe(false);
  });

  it('denies a wrong token even when the session exists', async () => {
    expect(await authorizer([{ id: 'ses_parent' }])({ token: 'wrong', parentID: 'ses_parent' })).toBe(false);
    expect(await authorizer([{ id: 'ses_parent' }])({ token: 'wrong-but-same-length-x', parentID: 'ses_parent' })).toBe(false);
  });

  it('denies a correct token naming a session that does not exist', async () => {
    expect(await authorizer([{ id: 'ses_parent' }])({ token: TOKEN, parentID: 'ses_absent' })).toBe(false);
  });

  it('allows a correct token naming an existing session', async () => {
    expect(await authorizer([{ id: 'ses_parent' }])({ token: TOKEN, parentID: 'ses_parent', directory: '/workspace' })).toBe(true);
    expect(await authorizer([{ id: 'ses_child' }])({ token: TOKEN, sessionID: 'ses_child', directory: '/workspace' })).toBe(true);
  });

  it('denies when the client cannot answer', async () => {
    const broken = createCapabilityAuthorizer({ token: TOKEN, createClient: async () => ({ session: { get: async () => { throw new Error('down'); } } }) });
    expect(await broken({ token: TOKEN, parentID: 'ses_parent' })).toBe(false);
  });
});

describe('capability mount', () => {
  it('stays dark when no token is configured', async () => {
    const app = express();
    expect(registerCapabilityRoutes(app, { createClient: makeClient([]) })).toBe(false);
    const served = await listening(app);
    open.push(served);
    const response = await fetch(`${served.base}${CAPABILITY_MOUNT_PATH}/session`, { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('mounts the three endpoints when a token is configured', async () => {
    const app = express();
    const mounted = registerCapabilityRoutes(app, { token: TOKEN, createClient: makeClient([{ id: 'ses_parent' }]) });
    expect(mounted).toBe(true);
    const served = await listening(app);
    open.push(served);
    const unauthenticated = await fetch(`${served.base}${CAPABILITY_MOUNT_PATH}/session`, { method: 'POST' });
    expect(unauthenticated.status).toBe(401);
    const authorized = await fetch(`${served.base}${CAPABILITY_MOUNT_PATH}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ parentID: 'ses_parent', title: 'child', directory: '/workspace' }),
    });
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ sessionID: 'ses_new', parentID: 'ses_parent' });
  });
});
