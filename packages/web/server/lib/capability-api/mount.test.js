import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { createCapabilityAuthorizer } from './authorization.js';
import { CAPABILITY_MOUNT_PATH, registerCapabilityRoutes } from './index.js';

const TOKEN = 'configured-secret';

const makeClient = (sessions) => async ({ directory }) => ({
  session: {
    get: async ({ sessionID }) => {
      const found = sessions.find((session) => session.id === sessionID);
      if (!found) throw new Error('session not found');
      return found;
    },
    create: async () => ({ id: 'ses_new' }),
    prompt: async () => ({ data: {} }),
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

  it('looks the named parent up with the v2 input shape and authorizes a real id', async () => {
    const seen = [];
    const authorize = createCapabilityAuthorizer({
      token: TOKEN,
      // The supervisor binds a senpi id, so a ses_ parent only ever authorizes through this lookup.
      boundParent: '01a1f8df-050f-7431-a76e-fa881455a719',
      createClient: async () => ({
        session: {
          get: async (input) => {
            seen.push(input);
            return input.sessionID === 'ses_parent' ? { id: 'ses_parent' } : undefined;
          },
        },
      }),
    });

    await expect(authorize({ token: TOKEN, parentID: 'ses_parent', directory: '/workspace' })).resolves.toBe(true);
    expect(seen).toEqual([{ sessionID: 'ses_parent' }]);
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

describe('capability token resolver', () => {
  const authorizerOf = (resolveToken) =>
    createCapabilityAuthorizer({ token: resolveToken, createClient: makeClient([{ id: 'ses_parent' }]) });

  it('refuses every call until the resolver produces a secret, then accepts that secret', async () => {
    let secret;
    const authorize = authorizerOf(() => secret);

    expect(await authorize({ token: 'anything', parentID: 'ses_parent' })).toBe(false)

    secret = 'host-minted-secret';
    expect(await authorize({ token: 'host-minted-secret', parentID: 'ses_parent' })).toBe(true)
    expect(await authorize({ token: 'anything', parentID: 'ses_parent' })).toBe(false)
  })

  it('mounts the surface for a resolver even when no secret exists yet', () => {
    const app = express();
    const mounted = registerCapabilityRoutes(app, { token: () => undefined, createClient: makeClient([]) });

    expect(mounted).toBe(true)
  })
})
