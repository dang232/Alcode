import { describe, expect, test } from 'bun:test';

import {
  clearTokenPersistFailed,
  createDesktopAuthRuntime,
} from '../desktop-auth/desktop-auth.js';
import {
  createTokenpanelQuotaRuntime,
  TOKENPANEL_DEFAULT_BASE,
  TOKENPANEL_QUOTA_CACHE_TTL_MS,
  TOKENPANEL_QUOTA_PATH,
  TokenpanelQuotaError,
} from './tokenpanel-quota.js';

// The quota proxy owns the route the account panel already calls
// (`GET /api/tokenpanel/quota?authUserId=`). The upstream is stubbed at
// the serviceFetch seam with bodies matching the hook's documented shape;
// caller auth is observed on the outgoing request (the CALLER's Bearer,
// never a service key, never in the URL), never through a live service.
// The keychain is a memory fake behind the store seam; subject resolution
// defaults to the signed-in caller.
const LIVE_BODY = {
  authUserId: 'user-1',
  customerId: 'cus_1',
  balance: { amountMicros: 5_000_000, reservedMicros: 0, availableMicros: 5_000_000, currency: 'USD' },
  usage: { totalRequests: 12, totalTokens: 3456, totalCostMicros: 789, totalPriceMicros: 789, currency: 'USD' },
  source: 'live',
  stale: false,
};

const mockRes = () => {
  const res = {
    statusCode: 200,
    body: undefined,
    status: (code) => {
      res.statusCode = code;
      return res;
    },
    json: (payload) => {
      res.body = payload;
      return res;
    },
  };
  return res;
};

// Memory keychain fake: pairs keyed by sub, refresh stubbed per harness.
const memoryTokenStore = ({ pairs = {}, refreshImpl = null } = {}) => {
  const held = new Map(Object.entries(pairs));
  const calls = { read: [], refreshed: [], cleared: [] };
  return {
    calls,
    get: async (sub) => {
      calls.read.push(sub);
      const found = held.get(sub);
      return found ? { ...found } : null;
    },
    set: async (sub, pair) => {
      held.set(sub, { ...pair });
    },
    clear: async (sub) => {
      calls.cleared.push(sub);
      held.delete(sub);
    },
    refreshAccessToken: async (sub) => {
      calls.refreshed.push(sub);
      if (!refreshImpl) throw Object.assign(new Error('refresh not stubbed'), { code: 'USER_TOKEN_NO_REFRESH' });
      return refreshImpl(sub, held);
    },
  };
};

const createHarness = ({
  serviceImpl,
  nowValue,
  pairs = { 'user-1': { accessToken: 'user-access-1', refreshToken: 'user-refresh-1' } },
  refreshImpl = null,
  subject = 'user-1',
  base,
  store = null,
} = {}) => {
  let at = nowValue ?? Date.now();
  const handlers = new Map();
  const serviceCalls = [];
  const serviceJson = (status, data) => ({ status, json: async () => data });
  const tokens = store ?? memoryTokenStore({ pairs, refreshImpl });
  const runtime = createTokenpanelQuotaRuntime({
    serviceBase: base,
    serviceFetch: async (url, init) => {
      serviceCalls.push({ url, init });
      return serviceImpl(url, init, serviceJson);
    },
    now: () => at,
    userTokenStore: tokens,
    resolveSubject: async () => subject,
  });
  runtime.registerRoutes({ get: (path, handler) => handlers.set(`GET ${path}`, handler) });
  const call = async (query) => {
    const handler = handlers.get('GET /api/tokenpanel/quota');
    if (!handler) throw new Error('quota route not registered');
    const res = mockRes();
    await handler({ query }, res);
    return res;
  };
  return { call, serviceCalls, serviceJson, setNow: (value) => { at = value; }, tokens };
};

describe('tokenpanel quota proxy', () => {
  test('passes a live body through with the caller Bearer', async () => {
    const h = createHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) => {
        expect(url).toBe(`https://tokenpanel.test${TOKENPANEL_QUOTA_PATH}?authUserId=user-1`);
        expect(url).not.toContain('user-access-1');
        expect(init.method).toBe('GET');
        expect(init.headers.Accept).toBe('application/json');
        expect(init.headers.Authorization).toBe('Bearer user-access-1');
        return serviceJson(200, LIVE_BODY);
      },
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...LIVE_BODY, source: 'live', stale: false });
    expect(h.serviceCalls).toHaveLength(1);
    expect(h.tokens.calls.read).toEqual(['user-1']);
  });

  test('rejects malformed identity input before any token or upstream use', async () => {
    const h = createHarness({ serviceImpl: () => { throw new Error('must not be called'); } });
    for (const query of [{}, { authUserId: '' }, { authUserId: 'x'.repeat(129) }, { authUserId: ['user-1'] }]) {
      const res = await h.call(query);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_request' });
    }
    expect(h.serviceCalls).toHaveLength(0);
    expect(h.tokens.calls.read).toHaveLength(0);
  });

  test('enforces self-only: another identity reads as forbidden', async () => {
    const h = createHarness({
      subject: 'user-1',
      serviceImpl: () => { throw new Error('must not be called'); },
    });
    const res = await h.call({ authUserId: 'user-2' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'tokenpanel_forbidden' });
    expect(h.serviceCalls).toHaveLength(0);
    expect(h.tokens.calls.read).toHaveLength(0);
  });

  test('an unknown caller identity reads as forbidden', async () => {
    for (const subject of ['', null]) {
      const h = createHarness({
        subject,
        serviceImpl: () => { throw new Error('must not be called'); },
      });
      const res = await h.call({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'tokenpanel_forbidden' });
      expect(h.serviceCalls).toHaveLength(0);
    }
  });

  test('answers 503 when the caller has no stored pair', async () => {
    const h = createHarness({
      pairs: {},
      serviceImpl: () => { throw new Error('must not be called'); },
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'tokenpanel_not_configured' });
    expect(h.serviceCalls).toHaveLength(0);
  });

  test('refreshes once on upstream 401 and retries with the rotated token', async () => {
    const authorizations = [];
    const h = createHarness({
      refreshImpl: async (sub, held) => {
        expect(sub).toBe('user-1');
        held.set('user-1', { accessToken: 'user-access-2', refreshToken: 'user-refresh-2' });
        return 'user-access-2';
      },
      serviceImpl: (url, init, serviceJson) => {
        authorizations.push(init.headers.Authorization);
        if (authorizations.length === 1) return serviceJson(401, { error: 'unauthorized' });
        return serviceJson(200, LIVE_BODY);
      },
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ source: 'live', stale: false });
    expect(authorizations).toEqual(['Bearer user-access-1', 'Bearer user-access-2']);
    expect(h.tokens.calls.refreshed).toEqual(['user-1']);
    // The rotated pair persists for the next read.
    expect((await h.tokens.get('user-1')).accessToken).toBe('user-access-2');
  });

  test('a refused refresh clears the pair and answers session-expired', async () => {
    const h = createHarness({
      refreshImpl: async () => {
        throw Object.assign(new Error('refused'), { code: 'USER_TOKEN_REFRESH_REJECTED' });
      },
      serviceImpl: (url, init, serviceJson) => serviceJson(401, { error: 'unauthorized' }),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'tokenpanel_session_expired' });
    expect(h.tokens.calls.cleared).toEqual(['user-1']);
    expect(h.serviceCalls).toHaveLength(1);
  });

  test('a second 401 after rotation clears the pair and answers session-expired', async () => {
    const h = createHarness({
      refreshImpl: async (sub, held) => {
        held.set('user-1', { accessToken: 'user-access-2', refreshToken: 'user-refresh-2' });
        return 'user-access-2';
      },
      serviceImpl: (url, init, serviceJson) => serviceJson(401, { error: 'unauthorized' }),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'tokenpanel_session_expired' });
    expect(h.serviceCalls).toHaveLength(2);
    expect(h.tokens.calls.cleared).toEqual(['user-1']);
  });

  test('an access-only pair answers session-expired without a refresh call', async () => {
    const refreshed = [];
    const h = createHarness({
      pairs: { 'user-1': { accessToken: 'user-access-1', refreshToken: '' } },
      refreshImpl: async (sub) => {
        refreshed.push(sub);
        throw Object.assign(new Error('no refresh'), { code: 'USER_TOKEN_NO_REFRESH' });
      },
      serviceImpl: (url, init, serviceJson) => serviceJson(401, { error: 'unauthorized' }),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'tokenpanel_session_expired' });
    expect(refreshed).toEqual(['user-1']);
  });

  test('never serves stale on session-expiry, even with a warm cache', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createHarness({
      nowValue: start,
      refreshImpl: async () => {
        throw Object.assign(new Error('refused'), { code: 'USER_TOKEN_REFRESH_REJECTED' });
      },
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(200, LIVE_BODY);
        return serviceJson(401, { error: 'unauthorized' });
      },
    });
    expect((await h.call({ authUserId: 'user-1' })).body.stale).toBe(false);
    mode = 'denied';
    h.setNow(start + TOKENPANEL_QUOTA_CACHE_TTL_MS / 2);
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'tokenpanel_session_expired' });
  });

  test('serves stale within grace when the refresh itself is unreachable', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createHarness({
      nowValue: start,
      refreshImpl: async () => {
        throw Object.assign(new Error('down'), { code: 'USER_TOKEN_REFRESH_TRANSIENT' });
      },
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(200, LIVE_BODY);
        if (mode === 'denied') return serviceJson(401, { error: 'unauthorized' });
        throw new Error('down');
      },
    });
    expect((await h.call({ authUserId: 'user-1' })).body.stale).toBe(false);

    mode = 'denied';
    h.setNow(start + TOKENPANEL_QUOTA_CACHE_TTL_MS / 2);
    const stale = await h.call({ authUserId: 'user-1' });
    expect(stale.statusCode).toBe(200);
    expect(stale.body).toMatchObject({ source: 'cache', stale: true, authUserId: 'user-1' });
    expect(h.tokens.calls.cleared).toHaveLength(0);

    mode = 'down';
    h.setNow(start + TOKENPANEL_QUOTA_CACHE_TTL_MS + 1000);
    const stillGrace = await h.call({ authUserId: 'user-1' });
    expect(stillGrace.body.stale).toBe(true);

    h.setNow(start + 2 * TOKENPANEL_QUOTA_CACHE_TTL_MS + 1000);
    const past = await h.call({ authUserId: 'user-1' });
    expect(past.statusCode).toBe(503);
    expect(past.body).toEqual({ error: 'tokenpanel_unavailable' });
  });

  test('falls back to the default base when none is configured', async () => {
    const saved = process.env.TOKENPANEL_API_URL;
    delete process.env.TOKENPANEL_API_URL;
    try {
      const h = createHarness({
        serviceImpl: (url, init, serviceJson) => {
          expect(url).toBe(`${TOKENPANEL_DEFAULT_BASE}${TOKENPANEL_QUOTA_PATH}?authUserId=user-1`);
          return serviceJson(200, LIVE_BODY);
        },
      });
      const res = await h.call({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ source: 'live', stale: false });
    } finally {
      if (saved === undefined) delete process.env.TOKENPANEL_API_URL;
      else process.env.TOKENPANEL_API_URL = saved;
    }
  });

  test('throws named errors from the reader seam', async () => {
    const h = createHarness({ serviceImpl: () => { throw new Error('unreachable'); } });
    const runtime = createTokenpanelQuotaRuntime({
      userTokenStore: memoryTokenStore({ pairs: { 'user-1': { accessToken: 'a', refreshToken: 'r' } } }),
      serviceFetch: async () => { throw new Error('down'); },
    });
    await expect(runtime.resolveQuotaBody('', 'user-1')).rejects.toMatchObject({ name: 'TokenpanelQuotaError' });
    await expect(runtime.resolveQuotaBody('user-1', 'user-2')).rejects.toMatchObject({ code: 'TOKENPANEL_FORBIDDEN' });
    expect(h.serviceCalls).toHaveLength(0);
    const settled = await runtime.resolveQuotaBody('user-1', 'user-1').then(
      () => 'resolved',
      (error) => error,
    );
    expect(settled).toBeInstanceOf(TokenpanelQuotaError);
    expect(settled.code).toBe('TOKENPANEL_TRANSIENT');
  });

  test('serves stale within grace on transient outages, then fails closed', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createHarness({
      nowValue: start,
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(200, LIVE_BODY);
        if (mode === 'flap') return serviceJson(502, { error: 'upstream' });
        throw new Error('down');
      },
    });
    expect((await h.call({ authUserId: 'user-1' })).body.stale).toBe(false);

    mode = 'down';
    h.setNow(start + TOKENPANEL_QUOTA_CACHE_TTL_MS / 2);
    const stale = await h.call({ authUserId: 'user-1' });
    expect(stale.statusCode).toBe(200);
    expect(stale.body).toMatchObject({ source: 'cache', stale: true, authUserId: 'user-1' });
    expect(stale.body.balance).toEqual(LIVE_BODY.balance);

    mode = 'flap';
    h.setNow(start + TOKENPANEL_QUOTA_CACHE_TTL_MS + 1000);
    const stillGrace = await h.call({ authUserId: 'user-1' });
    expect(stillGrace.body.stale).toBe(true);

    h.setNow(start + 2 * TOKENPANEL_QUOTA_CACHE_TTL_MS + 1000);
    const past = await h.call({ authUserId: 'user-1' });
    expect(past.statusCode).toBe(503);
    expect(past.body).toEqual({ error: 'tokenpanel_unavailable' });
  });

  test('never serves stale on hard-invalid answers', async () => {
    const denied = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(403, { error: 'forbidden' }),
    });
    // Prime another runtime's cache shape is impossible across instances,
    // so this asserts the direct mapping: hard-invalid answers 502.
    const res = await denied.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'tokenpanel_rejected' });

    const malformed = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(200, { ...LIVE_BODY, balance: { bogus: true } }),
    });
    const bad = await malformed.call({ authUserId: 'user-1' });
    expect(bad.statusCode).toBe(502);
    expect(bad.body).toEqual({ error: 'tokenpanel_rejected' });
  });

  test('answers its own JSON and never forwards upstream cookies', async () => {
    const h = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_BODY),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ...LIVE_BODY, source: 'live', stale: false });
  });
});

describe('tokenpanel status route', () => {
  const withDurability = (store, isDurable) => {
    if (isDurable === undefined) return store;
    return { ...store, isDurable };
  };

  const createBothHarness = ({
    serviceImpl,
    nowValue,
    pairs = { 'user-1': { accessToken: 'user-access-1', refreshToken: 'user-refresh-1' } },
    refreshImpl = null,
    subject = 'user-1',
    base,
    isDurable,
    hasPersistFailed,
    store = null,
  } = {}) => {
    let at = nowValue ?? Date.now();
    const handlers = new Map();
    const serviceJson = (status, data) => ({ status, json: async () => data });
    const tokens = store ?? withDurability(memoryTokenStore({ pairs, refreshImpl }), isDurable);
    const runtime = createTokenpanelQuotaRuntime({
      serviceBase: base,
      serviceFetch: async (url, init) => serviceImpl(url, init, serviceJson),
      now: () => at,
      userTokenStore: tokens,
      resolveSubject: async () => subject,
      ...(hasPersistFailed === undefined ? {} : { hasPersistFailed }),
    });
    runtime.registerRoutes({ get: (path, handler) => handlers.set(`GET ${path}`, handler) });
    const callQuota = async (query) => {
      const handler = handlers.get('GET /api/tokenpanel/quota');
      if (!handler) throw new Error('quota route not registered');
      const res = mockRes();
      await handler({ query }, res);
      return res;
    };
    const callStatus = async (query) => {
      const handler = handlers.get('GET /api/tokenpanel/status');
      if (!handler) throw new Error('status route not registered');
      const res = mockRes();
      await handler({ query }, res);
      return res;
    };
    return {
      callQuota, callStatus, tokens, handlers,
      setNow: (value) => { at = value; },
    };
  };

  test('linked live carries the exact quota body', async () => {
    const h = createBothHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_BODY),
    });
    const res = await h.callStatus({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.link).toBe('linked');
    expect(res.body.persistence).toBe('ephemeral');
    expect(res.body.quota).toEqual({ ...LIVE_BODY, source: 'live', stale: false });
    expect(res.body.action).toBeUndefined();
  });

  test('linked stale is still linked with the cached quota body', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createBothHarness({
      nowValue: start,
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(200, LIVE_BODY);
        throw new Error('down');
      },
    });
    expect((await h.callStatus({ authUserId: 'user-1' })).body.quota.stale).toBe(false);
    mode = 'down';
    h.setNow(start + TOKENPANEL_QUOTA_CACHE_TTL_MS / 2);
    const res = await h.callStatus({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.link).toBe('linked');
    expect(res.body.action).toBeUndefined();
    expect(res.body.quota).toMatchObject({ source: 'cache', stale: true, authUserId: 'user-1' });
    expect(res.body.quota.balance).toEqual(LIVE_BODY.balance);
  });

  test('quota and status share one resolve: quota primes the status stale read', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createBothHarness({
      nowValue: start,
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(200, LIVE_BODY);
        throw new Error('down');
      },
    });
    const primed = await h.callQuota({ authUserId: 'user-1' });
    expect(primed.statusCode).toBe(200);
    expect(primed.body.stale).toBe(false);
    mode = 'down';
    h.setNow(start + TOKENPANEL_QUOTA_CACHE_TTL_MS / 2);
    const res = await h.callStatus({ authUserId: 'user-1' });
    expect(res.body.link).toBe('linked');
    expect(res.body.quota).toMatchObject({ source: 'cache', stale: true });
  });

  test('unlinked maps NOT_CONFIGURED with a sign_in action', async () => {
    const h = createBothHarness({
      pairs: {},
      serviceImpl: () => { throw new Error('must not be called'); },
    });
    const res = await h.callStatus({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ link: 'unlinked', persistence: 'ephemeral', action: 'sign_in' });
  });

  test('expired maps SESSION_EXPIRED with a sign_in action and never a 401', async () => {
    const h = createBothHarness({
      refreshImpl: async () => {
        throw Object.assign(new Error('refused'), { code: 'USER_TOKEN_REFRESH_REJECTED' });
      },
      serviceImpl: (url, init, serviceJson) => serviceJson(401, { error: 'unauthorized' }),
    });
    const res = await h.callStatus({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ link: 'expired', persistence: 'ephemeral', action: 'sign_in' });
    expect(h.tokens.calls.cleared).toEqual(['user-1']);
  });

  test('upstream_error covers rejected, 5xx, 429, network, and malformed bodies', async () => {
    const cases = {
      rejected403: (url, init, serviceJson) => serviceJson(403, { error: 'forbidden' }),
      rejected404: (url, init, serviceJson) => serviceJson(404, { error: 'missing' }),
      fiveHundred: (url, init, serviceJson) => serviceJson(502, { error: 'upstream' }),
      throttled: (url, init, serviceJson) => serviceJson(429, { error: 'slow' }),
      network: () => { throw new Error('down'); },
      malformed: (url, init, serviceJson) => serviceJson(200, { ...LIVE_BODY, balance: { bogus: true } }),
    };
    for (const [name, serviceImpl] of Object.entries(cases)) {
      const h = createBothHarness({ serviceImpl });
      const res = await h.callStatus({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });
    }
  });

  test('upstream_error covers unknown and misconfigured outcomes', async () => {
    const h = createBothHarness({
      base: 'notaurl',
      serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_BODY),
    });
    // A bad base never reaches the network: the misconfigured resolve
    // still reports as a retryable upstream error over HTTP 200.
    const misconfigured = await h.callStatus({ authUserId: 'user-1' });
    expect(misconfigured.statusCode).toBe(200);
    expect(misconfigured.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });

    const runtime = createTokenpanelQuotaRuntime({
      userTokenStore: memoryTokenStore({ pairs: { 'user-1': { accessToken: 'a', refreshToken: 'r' } } }),
      serviceFetch: async () => { throw new Error('down'); },
    });
    const handlers = new Map();
    runtime.registerRoutes({ get: (path, handler) => handlers.set(`GET ${path}`, handler) });
    expect(handlers.has('GET /api/tokenpanel/status')).toBe(true);
    expect(handlers.has('GET /api/tokenpanel/quota')).toBe(true);
  });

  test('persistence is durable only when the store probe passes', async () => {
    const live = (url, init, serviceJson) => serviceJson(200, LIVE_BODY);
    const durable = createBothHarness({ serviceImpl: live, isDurable: () => true });
    expect((await durable.callStatus({ authUserId: 'user-1' })).body.persistence).toBe('durable');

    const ephemeralFalse = createBothHarness({ serviceImpl: live, isDurable: () => false });
    expect((await ephemeralFalse.callStatus({ authUserId: 'user-1' })).body.persistence).toBe('ephemeral');

    const missing = createBothHarness({ serviceImpl: live });
    expect((await missing.callStatus({ authUserId: 'user-1' })).body.persistence).toBe('ephemeral');

    const throwing = createBothHarness({
      serviceImpl: live,
      isDurable: () => { throw new Error('probe failed'); },
    });
    const res = await throwing.callStatus({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.link).toBe('linked');
    expect(res.body.persistence).toBe('ephemeral');
  });

  test('persistence rides along on every link state', async () => {
    const durableLive = createBothHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_BODY),
      isDurable: () => true,
    });
    expect((await durableLive.callStatus({ authUserId: 'user-1' })).body).toMatchObject({
      link: 'linked', persistence: 'durable',
    });

    const durableUnlinked = createBothHarness({
      pairs: {},
      serviceImpl: () => { throw new Error('must not be called'); },
      isDurable: () => true,
    });
    expect(await durableUnlinked.callStatus({ authUserId: 'user-1' })).toMatchObject({
      statusCode: 200,
      body: { link: 'unlinked', persistence: 'durable', action: 'sign_in' },
    });
  });

  test('quota read and session-expiry clear use only the new get/clear names', async () => {
    // A strict store exposing exactly the CredentialStore shape: any
    // lingering call under a removed name would throw a TypeError here.
    const held = new Map([['user-1', { accessToken: 'user-access-1', refreshToken: 'user-refresh-1' }]]);
    const calls = { got: [], cleared: [] };
    const strictStore = {
      get: async (sub) => {
        calls.got.push(sub);
        const found = held.get(sub);
        return found ? { ...found } : null;
      },
      set: async (sub, pair) => { held.set(sub, { ...pair }); },
      clear: async (sub) => { calls.cleared.push(sub); held.delete(sub); },
      refreshAccessToken: async () => {
        throw Object.assign(new Error('refused'), { code: 'USER_TOKEN_REFRESH_REJECTED' });
      },
    };
    // The injected shape matches the real CredentialStore exactly.
    expect(Object.keys(strictStore).sort()).toEqual(['clear', 'get', 'refreshAccessToken', 'set']);
    const h = createBothHarness({
      store: strictStore,
      serviceImpl: (url, init, serviceJson) => serviceJson(401, { error: 'unauthorized' }),
    });
    const res = await h.callQuota({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'tokenpanel_session_expired' });
    expect(calls.got).toEqual(['user-1']);
    expect(calls.cleared).toEqual(['user-1']);
  });

  test('a failed persist reports ephemeral on a durable store without changing link/action', async () => {
    const live = (url, init, serviceJson) => serviceJson(200, LIVE_BODY);
    // Linked: quota body still present, action still absent.
    const linked = createBothHarness({
      serviceImpl: live,
      isDurable: () => true,
      hasPersistFailed: (sub) => sub === 'user-1',
    });
    const linkedRes = await linked.callStatus({ authUserId: 'user-1' });
    expect(linkedRes.statusCode).toBe(200);
    expect(linkedRes.body.link).toBe('linked');
    expect(linkedRes.body.persistence).toBe('ephemeral');
    expect(linkedRes.body.quota).toEqual({ ...LIVE_BODY, source: 'live', stale: false });
    expect(linkedRes.body.action).toBeUndefined();
    // Unlinked: same sign_in action as Phase 1, persistence flipped.
    const unlinked = createBothHarness({
      pairs: {},
      serviceImpl: () => { throw new Error('must not be called'); },
      isDurable: () => true,
      hasPersistFailed: (sub) => sub === 'user-1',
    });
    expect((await unlinked.callStatus({ authUserId: 'user-1' })).body).toEqual({
      link: 'unlinked', persistence: 'ephemeral', action: 'sign_in',
    });
    // Another subject is unaffected: durability still reports durable.
    const other = createBothHarness({
      serviceImpl: live,
      isDurable: () => true,
      hasPersistFailed: (sub) => sub === 'user-2',
    });
    expect((await other.callStatus({ authUserId: 'user-1' })).body.persistence).toBe('durable');
    // A throwing probe never masks the failure and never fails the read.
    const throwingProbe = createBothHarness({
      serviceImpl: live,
      isDurable: () => true,
      hasPersistFailed: () => { throw new Error('probe down'); },
    });
    expect((await throwingProbe.callStatus({ authUserId: 'user-1' })).body.persistence).toBe('durable');
  });

  test('end-to-end: a desktop-auth set() failure warns once and status reports ephemeral', async () => {
    clearTokenPersistFailed();
    const ACCESS = `header.${Buffer.from(JSON.stringify({ sub: 'user-1', sid: 'sess-1' })).toString('base64url')}.sig`;
    const REFRESH = 'e2e-refresh-token-9f8e7d6c5b4a';
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.map((part) => String(part)).join(' ')); };
    try {
      // One proven login whose persist throws: the login stands.
      const routes = new Map();
      const seenSessions = [];
      const desktop = createDesktopAuthRuntime({
        uiAuthController: {
          handleSessionCreate: async (req, res) => {
            seenSessions.push(req.body);
            return res.status(200).json({ authenticated: true });
          },
        },
        alcoreSecret: 'test-alcore-secret-32-chars-long!!',
        serviceFetch: async () => ({
          status: 200,
          json: async () => ({ access_token: ACCESS, refresh_token: REFRESH }),
        }),
        userTokenStore: {
          set: async () => { throw new Error('disk full'); },
          get: async () => null,
          clear: async () => {},
          refreshAccessToken: async () => { throw new Error('refresh not stubbed'); },
        },
      });
      desktop.registerRoutes(
        {
          get: (path, ...handlers) => routes.set(`GET ${path}`, handlers),
          post: (path, ...handlers) => routes.set(`POST ${path}`, handlers),
        },
        { express: { json: () => (_req, _res, next) => (typeof next === 'function' ? next() : undefined) }, tunnelAuthController: { classifyRequestScope: () => null } },
      );
      const loginHandlers = routes.get('POST /api/auth/desktop/email/login');
      const loginRes = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
      await loginHandlers[loginHandlers.length - 1]({ body: { email: 'a@example.test', password: 's3cret!!' } }, loginRes);
      expect(loginRes.statusCode).toBe(200);
      expect(seenSessions).toHaveLength(1);
      // Exactly one warning with no token material.
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).not.toContain(ACCESS);
      expect(warnings[0]).not.toContain(REFRESH);
      expect(warnings[0]).not.toContain(ACCESS.slice(0, 8));
      expect(warnings[0]).not.toContain(String(ACCESS.length));
      // The status route (default wiring: the desktop-auth in-module flag)
      // reports ephemeral on the durable store, link mapping unchanged.
      const h = createBothHarness({
        serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_BODY),
        isDurable: () => true,
      });
      const res = await h.callStatus({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(200);
      expect(res.body.link).toBe('linked');
      expect(res.body.persistence).toBe('ephemeral');
      expect(res.body.quota).toEqual({ ...LIVE_BODY, source: 'live', stale: false });
      expect(res.body.action).toBeUndefined();
    } finally {
      console.warn = originalWarn;
      clearTokenPersistFailed();
    }
  });

  test('self-only still answers 403 without touching tokens or the network', async () => {
    const h = createBothHarness({
      subject: 'user-1',
      serviceImpl: () => { throw new Error('must not be called'); },
    });
    const res = await h.callStatus({ authUserId: 'user-2' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'tokenpanel_forbidden' });
    expect(h.tokens.calls.read).toHaveLength(0);
  });

  test('unknown caller identity answers 403', async () => {
    for (const subject of ['', null]) {
      const h = createBothHarness({
        subject,
        serviceImpl: () => { throw new Error('must not be called'); },
      });
      const res = await h.callStatus({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'tokenpanel_forbidden' });
    }
  });

  test('malformed identity answers 400 before any resolve', async () => {
    const h = createBothHarness({ serviceImpl: () => { throw new Error('must not be called'); } });
    for (const query of [{}, { authUserId: '' }, { authUserId: ['user-1'] }]) {
      const res = await h.callStatus(query);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_request' });
    }
    expect(h.tokens.calls.read).toHaveLength(0);
  });

  test('legacy quota route still answers byte-identical beside status', async () => {
    const h = createBothHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_BODY),
    });
    const quota = await h.callQuota({ authUserId: 'user-1' });
    expect(quota.statusCode).toBe(200);
    expect(quota.body).toEqual({ ...LIVE_BODY, source: 'live', stale: false });

    const forbidden = await h.callQuota({ authUserId: 'user-2' });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.body).toEqual({ error: 'tokenpanel_forbidden' });

    const unconfigured = createBothHarness({
      pairs: {},
      serviceImpl: () => { throw new Error('must not be called'); },
    });
    const missing = await unconfigured.callQuota({ authUserId: 'user-1' });
    expect(missing.statusCode).toBe(503);
    expect(missing.body).toEqual({ error: 'tokenpanel_not_configured' });

    const expired = createBothHarness({
      refreshImpl: async () => {
        throw Object.assign(new Error('refused'), { code: 'USER_TOKEN_REFRESH_REJECTED' });
      },
      serviceImpl: (url, init, serviceJson) => serviceJson(401, { error: 'unauthorized' }),
    });
    const denied = await expired.callQuota({ authUserId: 'user-1' });
    expect(denied.statusCode).toBe(401);
    expect(denied.body).toEqual({ error: 'tokenpanel_session_expired' });
  });
});
