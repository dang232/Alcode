import { describe, expect, test } from 'bun:test';

import {
  createTokenpanelEntitlementsRuntime,
  TOKENPANEL_DEFAULT_BASE,
  TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS,
  TOKENPANEL_ENTITLEMENTS_PATH,
  TokenpanelEntitlementsError,
} from './tokenpanel-entitlements.js';

// The entitlements proxy owns the route the account panel reads
// (`GET /api/tokenpanel/entitlements?authUserId=`). The upstream is
// stubbed at the serviceFetch seam with bodies shaped like Alcore's
// `GET /admin/ide/entitlements`
// (`{ authUserId, customerId, plan, subscription, metrics, balance,
// source, stale }`); caller auth is observed on the outgoing request (the
// CALLER's Bearer, never a service key, never in the URL), never through
// a live service. The keychain is a memory fake behind the store seam;
// subject resolution defaults to the signed-in caller.
const LIVE_UPSTREAM = {
  authUserId: 'user-1',
  customerId: 'cust-9f2c',
  plan: {
    // Deliberately unlisted: this id and name exist in no enum — the
    // client must carry them verbatim, never map them.
    id: 'plan_sonar_overdrive_custom',
    name: 'Sonar Overdrive Custom ∞',
    interval: 'month',
    intervalCount: 1,
    priceMicros: 2_500_000,
    currency: 'USD',
    includedTokens: 250_000,
  },
  subscription: {
    status: 'active',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  },
  metrics: [
    {
      dimension: 'tokens',
      used: 12_345,
      limit: 250_000,
      windowSeconds: 2_592_000,
      windowStart: '2026-09-01T00:00:00.000Z',
      resetsAt: '2026-10-01T00:00:00.000Z',
    },
    {
      dimension: 'requests',
      used: 987,
      limit: 50_000,
      windowSeconds: 86_400,
      windowStart: '2026-10-25T00:00:00.000Z',
      resetsAt: '2026-10-26T00:00:00.000Z',
    },
  ],
  balance: {
    amountMicros: 1_000_000,
    reservedMicros: 100_000,
    availableMicros: 900_000,
    currency: 'USD',
  },
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

// Memory keychain fake: pairs keyed by sub. No refresh stub: this path
// never refreshes — upstream 401/403 maps straight to expired.
const memoryTokenStore = ({ pairs = {} } = {}) => {
  const held = new Map(Object.entries(pairs));
  const calls = { read: [] };
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
      held.delete(sub);
    },
  };
};

const createHarness = ({
  serviceImpl,
  nowValue,
  pairs = { 'user-1': { accessToken: 'user-access-1', refreshToken: 'user-refresh-1' } },
  subject = 'user-1',
  base,
  store = null,
  isDurable,
  hasPersistFailed,
} = {}) => {
  let at = nowValue ?? Date.now();
  const handlers = new Map();
  const serviceCalls = [];
  const serviceJson = (status, data) => ({ status, json: async () => data });
  const rawStore = store ?? memoryTokenStore({ pairs });
  const tokens = isDurable === undefined ? rawStore : { ...rawStore, isDurable };
  const runtime = createTokenpanelEntitlementsRuntime({
    serviceBase: base,
    serviceFetch: async (url, init) => {
      serviceCalls.push({ url, init });
      return serviceImpl(url, init, serviceJson);
    },
    now: () => at,
    userTokenStore: tokens,
    resolveSubject: async () => subject,
    ...(hasPersistFailed === undefined ? {} : { hasPersistFailed }),
  });
  runtime.registerRoutes({ get: (path, handler) => handlers.set(`GET ${path}`, handler) });
  const call = async (query) => {
    const handler = handlers.get('GET /api/tokenpanel/entitlements');
    if (!handler) throw new Error('entitlements route not registered');
    const res = mockRes();
    await handler({ query }, res);
    return res;
  };
  return { call, serviceCalls, serviceJson, setNow: (value) => { at = value; }, tokens };
};

describe('tokenpanel entitlements proxy', () => {
  test('passes an unlisted plan id and name through verbatim with the caller Bearer', async () => {
    const h = createHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) => {
        expect(url).toBe(`https://tokenpanel.test${TOKENPANEL_ENTITLEMENTS_PATH}?authUserId=user-1`);
        expect(url).not.toContain('user-access-1');
        expect(init.method).toBe('GET');
        expect(init.headers.Accept).toBe('application/json');
        expect(init.headers.Authorization).toBe('Bearer user-access-1');
        return serviceJson(200, LIVE_UPSTREAM);
      },
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      link: 'linked',
      persistence: 'ephemeral',
      stale: false,
      plan: {
        id: 'plan_sonar_overdrive_custom',
        name: 'Sonar Overdrive Custom ∞',
        interval: 'month',
        intervalCount: 1,
        priceMicros: 2_500_000,
        currency: 'USD',
        includedTokens: 250_000,
      },
      subscription: { status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' },
      metrics: [
        {
          dimension: 'tokens',
          used: 12_345,
          limit: 250_000,
          windowSeconds: 2_592_000,
          windowStart: '2026-09-01T00:00:00.000Z',
          resetsAt: '2026-10-01T00:00:00.000Z',
        },
        {
          dimension: 'requests',
          used: 987,
          limit: 50_000,
          windowSeconds: 86_400,
          windowStart: '2026-10-25T00:00:00.000Z',
          resetsAt: '2026-10-26T00:00:00.000Z',
        },
      ],
      balance: {
        amountMicros: 1_000_000,
        reservedMicros: 100_000,
        availableMicros: 900_000,
        currency: 'USD',
      },
      portalBase: 'https://tokenpanel.test/portal/',
    });
    expect(h.serviceCalls).toHaveLength(1);
    expect(h.tokens.calls.read).toEqual(['user-1']);
  });

  test('maps every metric leaf untouched: used, limit, windowSeconds, windowStart, resetsAt', async () => {
    const h = createHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_UPSTREAM),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.body.metrics).toEqual(LIVE_UPSTREAM.metrics);
    expect(res.body.metrics[0]).toEqual({
      dimension: 'tokens',
      used: 12_345,
      limit: 250_000,
      windowSeconds: 2_592_000,
      windowStart: '2026-09-01T00:00:00.000Z',
      resetsAt: '2026-10-01T00:00:00.000Z',
    });
  });

  test('upstream 404 without a subscription body reads as upstream_error, never an empty plan', async () => {
    // A deployment that does not serve this route also answers 404. Folding that into
    // `plan:null, metrics:[]` would report a successful empty read for a route that never ran.
    const h = createHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) => serviceJson(404, { error: 'not_found' }),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.body).toMatchObject({ link: 'upstream_error', action: 'retry' });
  });

  test('upstream 404 that names the missing subscription reads as linked with plan:null', async () => {
    const h = createHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) =>
        serviceJson(404, { code: 'not_found', resource: 'subscription', message: 'No active subscription' }),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      link: 'linked',
      persistence: 'ephemeral',
      stale: false,
      plan: null,
      subscription: null,
      metrics: [],
      balance: null,
      portalBase: 'https://tokenpanel.test/portal/',
    });
  });

  test('linked bodies carry portalBase from the upstream origin, stale keeps it, unusable base yields no linked body', async () => {
    // Trailing slashes and subpaths collapse to the origin: the client
    // appends `subscriptions`/`billing`/`usage` without guessing the host.
    for (const [base, expected] of [
      ['https://tokenpanel.test/', 'https://tokenpanel.test/portal/'],
      ['https://tokenpanel.test///', 'https://tokenpanel.test/portal/'],
      ['https://alcore.example:8443/prefix', 'https://alcore.example:8443/portal/'],
    ]) {
      const h = createHarness({
        base,
        serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_UPSTREAM),
      });
      const res = await h.call({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(200);
      expect(res.body.link).toBe('linked');
      expect(res.body.portalBase).toBe(expected);
    }
    // A 404-shaped "no subscription" body carries it too.
    const notFound = createHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) =>
        serviceJson(404, { code: 'not_found', resource: 'subscription', message: 'No active subscription' }),
    });
    expect((await notFound.call({ authUserId: 'user-1' })).body.portalBase).toBe(
      'https://tokenpanel.test/portal/',
    );
    // Stale-from-cache keeps the primed portalBase instead of recomputing.
    const start = Date.now();
    let mode = 'live';
    const cached = createHarness({
      nowValue: start,
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(200, LIVE_UPSTREAM);
        throw new Error('down');
      },
    });
    expect((await cached.call({ authUserId: 'user-1' })).body.portalBase).toBe(
      'https://tokenpanel.test/portal/',
    );
    mode = 'down';
    cached.setNow(start + TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS / 2);
    const stale = await cached.call({ authUserId: 'user-1' });
    expect(stale.body.link).toBe('linked');
    expect(stale.body.stale).toBe(true);
    expect(stale.body.portalBase).toBe('https://tokenpanel.test/portal/');
    // An unusable base never answers linked, so the client sees no usable
    // base and renders no CTAs (portalBase null-equivalent: absent).
    const broken = createHarness({
      base: '::not-a-url::',
      serviceImpl: () => { throw new Error('must not be called'); },
    });
    const brokenRes = await broken.call({ authUserId: 'user-1' });
    expect(brokenRes.statusCode).toBe(200);
    expect(brokenRes.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });
    expect(brokenRes.body.portalBase ?? null).toBeNull();
  });

  test('upstream 401 and 403 read as expired with sign_in', async () => {
    for (const status of [401, 403]) {
      const h = createHarness({
        serviceImpl: (url, init, serviceJson) => serviceJson(status, { error: 'denied' }),
      });
      const res = await h.call({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ link: 'expired', persistence: 'ephemeral', action: 'sign_in' });
    }
  });

  test('never serves stale on expired, even with a warm cache', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createHarness({
      nowValue: start,
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(200, LIVE_UPSTREAM);
        return serviceJson(401, { error: 'unauthorized' });
      },
    });
    expect((await h.call({ authUserId: 'user-1' })).body.stale).toBe(false);
    mode = 'denied';
    h.setNow(start + TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS / 2);
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ link: 'expired', persistence: 'ephemeral', action: 'sign_in' });
  });

  test('a network failure yields upstream_error and never fabricated numbers', async () => {
    const h = createHarness({
      serviceImpl: () => { throw new Error('down'); },
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });
    expect(res.body.plan).toBeUndefined();
    expect(res.body.metrics).toBeUndefined();
    expect(res.body.balance).toBeUndefined();
  });

  test('5xx, 429, and malformed bodies yield upstream_error without stale', async () => {
    const cases = {
      fiveHundred: (url, init, serviceJson) => serviceJson(502, { error: 'upstream' }),
      throttled: (url, init, serviceJson) => serviceJson(429, { error: 'slow' }),
      malformedPlan: (url, init, serviceJson) => serviceJson(200, { ...LIVE_UPSTREAM, plan: { bogus: true } }),
      malformedMetrics: (url, init, serviceJson) => serviceJson(200, {
        ...LIVE_UPSTREAM,
        metrics: [{ dimension: 'tokens', used: 'many', limit: 1, windowSeconds: 60, windowStart: 'x', resetsAt: 'y' }],
      }),
      wrongShape: (url, init, serviceJson) => serviceJson(200, { nope: 1 }),
    };
    for (const [name, serviceImpl] of Object.entries(cases)) {
      const h = createHarness({ serviceImpl });
      const res = await h.call({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });
    }
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

  test('serves the cached body marked stale on failure, never empty metrics or a null plan', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createHarness({
      nowValue: start,
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(200, LIVE_UPSTREAM);
        throw new Error('down');
      },
    });
    const primed = await h.call({ authUserId: 'user-1' });
    expect(primed.body.stale).toBe(false);

    mode = 'down';
    h.setNow(start + TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS / 2);
    const stale = await h.call({ authUserId: 'user-1' });
    expect(stale.statusCode).toBe(200);
    expect(stale.body.link).toBe('linked');
    expect(stale.body.stale).toBe(true);
    // The cached entitlements ride along untouched — id and name verbatim,
    // every metric leaf intact, never an empty array or a nulled plan.
    expect(stale.body.plan.id).toBe('plan_sonar_overdrive_custom');
    expect(stale.body.plan.name).toBe('Sonar Overdrive Custom ∞');
    expect(stale.body.metrics).toEqual(LIVE_UPSTREAM.metrics);
    expect(stale.body.metrics).not.toEqual([]);
    expect(stale.body.balance).toEqual(LIVE_UPSTREAM.balance);
    expect(stale.body.subscription).toEqual({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });

    h.setNow(start + TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS + 1000);
    const stillGrace = await h.call({ authUserId: 'user-1' });
    expect(stillGrace.body.stale).toBe(true);
    expect(stillGrace.body.metrics).toEqual(LIVE_UPSTREAM.metrics);

    h.setNow(start + 2 * TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS + 1000);
    const past = await h.call({ authUserId: 'user-1' });
    expect(past.statusCode).toBe(200);
    expect(past.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });
    expect(past.body.plan).toBeUndefined();
    expect(past.body.metrics).toBeUndefined();
  });

  test('a cached no-subscription read still serves stale on failure', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createHarness({
      nowValue: start,
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live')
          return serviceJson(404, { code: 'not_found', resource: 'subscription', message: 'No active subscription' });
        throw new Error('down');
      },
    });
    expect(await h.call({ authUserId: 'user-1' })).toMatchObject({
      statusCode: 200,
      body: { link: 'linked', plan: null, subscription: null, metrics: [] },
    });
    mode = 'down';
    h.setNow(start + TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS / 2);
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.body).toMatchObject({ link: 'linked', stale: true, plan: null, subscription: null, metrics: [] });
  });

  test('persistence rides along on every link state', async () => {
    const durable = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_UPSTREAM),
      isDurable: () => true,
    });
    expect((await durable.call({ authUserId: 'user-1' })).body).toMatchObject({
      link: 'linked', persistence: 'durable', stale: false,
    });

    const expired = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(401, { error: 'unauthorized' }),
      isDurable: () => true,
    });
    expect((await expired.call({ authUserId: 'user-1' })).body).toEqual({
      link: 'expired', persistence: 'durable', action: 'sign_in',
    });

    const failed = createHarness({
      serviceImpl: () => { throw new Error('down'); },
      isDurable: () => true,
    });
    expect((await failed.call({ authUserId: 'user-1' })).body).toEqual({
      link: 'upstream_error', persistence: 'durable', action: 'retry',
    });
  });

  test('throws named errors from the reader seam', async () => {
    const runtime = createTokenpanelEntitlementsRuntime({
      userTokenStore: memoryTokenStore({ pairs: { 'user-1': { accessToken: 'a', refreshToken: 'r' } } }),
      serviceFetch: async () => { throw new Error('down'); },
    });
    await expect(runtime.resolveEntitlementsBody('', 'user-1')).rejects.toMatchObject({ name: 'TokenpanelEntitlementsError' });
    await expect(runtime.resolveEntitlementsBody('user-1', 'user-2')).rejects.toMatchObject({ code: 'TOKENENT_FORBIDDEN' });
    const settled = await runtime.resolveEntitlementsBody('user-1', 'user-1').then(
      (resolved) => resolved,
      (error) => error,
    );
    // A cold-cache network failure resolves to a 200 body, never throws.
    expect(settled.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });
  });

  test('falls back to the default base when none is configured', async () => {
    const saved = process.env.TOKENPANEL_API_URL;
    delete process.env.TOKENPANEL_API_URL;
    try {
      const h = createHarness({
        serviceImpl: (url, init, serviceJson) => {
          expect(url).toBe(`${TOKENPANEL_DEFAULT_BASE}${TOKENPANEL_ENTITLEMENTS_PATH}?authUserId=user-1`);
          return serviceJson(200, LIVE_UPSTREAM);
        },
      });
      const res = await h.call({ authUserId: 'user-1' });
      expect(res.statusCode).toBe(200);
      expect(res.body.link).toBe('linked');
    } finally {
      if (saved === undefined) delete process.env.TOKENPANEL_API_URL;
      else process.env.TOKENPANEL_API_URL = saved;
    }
  });
});
