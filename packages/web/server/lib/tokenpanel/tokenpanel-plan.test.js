import { describe, expect, test } from 'bun:test';

import {
  createTokenpanelPlanRuntime,
  TOKENPANEL_DEFAULT_BASE,
  TOKENPANEL_PLAN_CACHE_TTL_MS,
  TOKENPANEL_PLAN_PATH,
  TokenpanelPlanError,
} from './tokenpanel-plan.js';

// The plan proxy owns the route the account panel reads
// (`GET /api/tokenpanel/plan?authUserId=`). The upstream is stubbed at
// the serviceFetch seam with bodies shaped like Alcore's
// `GET /public/customers/me/subscription`
// (`{ subscription: SubscriptionDoc, plan: SubscriptionPlanDoc | null }`);
// caller auth is observed on the outgoing request (the CALLER's Bearer,
// never a service key, never in the URL), never through a live service.
// The keychain is a memory fake behind the store seam; subject resolution
// defaults to the signed-in caller.
const LIVE_UPSTREAM = {
  subscription: {
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    organizationId: 'cccccccccccccccccccccccc',
    customerId: 'dddddddddddddddddddddddd',
    planId: 'abcdef0123456789abcdef01',
    status: 'active',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    canceledAt: null,
  },
  plan: {
    _id: 'abcdef0123456789abcdef01',
    organizationId: 'cccccccccccccccccccccccc',
    // Deliberately unlisted: this id and name exist in no enum — the
    // client must carry them verbatim, never map them.
    name: 'Aurora Overdrive Custom ∞',
    description: 'A plan no catalogue knows.',
    price: { amountMicros: 2_500_000, currency: 'USD' },
    interval: 'month',
    intervalCount: 1,
    includedCredit: { amountMicros: 0, currency: 'USD' },
    includedTokens: 250_000,
    rateLimits: [
      { id: 'r-tokens', windowSeconds: 60, dimension: 'tokens', capValue: 10_000, scope: 'plan', active: true },
      { id: 'r-requests', windowSeconds: 3600, dimension: 'requests', capValue: 500 },
      { id: 'r-off', windowSeconds: 86_400, dimension: 'spend_micros', capValue: 999, scope: 'customer', active: false },
    ],
    allowedModelAliases: ['opus', 'sonnet'],
    active: true,
  },
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
  const runtime = createTokenpanelPlanRuntime({
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
    const handler = handlers.get('GET /api/tokenpanel/plan');
    if (!handler) throw new Error('plan route not registered');
    const res = mockRes();
    await handler({ query }, res);
    return res;
  };
  return { call, serviceCalls, serviceJson, setNow: (value) => { at = value; }, tokens };
};

describe('tokenpanel plan proxy', () => {
  test('passes an unlisted plan id and name through verbatim with the caller Bearer', async () => {
    const h = createHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) => {
        expect(url).toBe(`https://tokenpanel.test${TOKENPANEL_PLAN_PATH}`);
        expect(url).not.toContain('authUserId');
        expect(url).not.toContain('user-access-1');
        expect(init.method).toBe('GET');
        expect(init.headers.Accept).toBe('application/json');
        expect(init.headers.Authorization).toBe('Bearer user-access-1');
        return serviceJson(200, LIVE_UPSTREAM);
      },
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      link: 'linked',
      persistence: 'ephemeral',
      stale: false,
      plan: {
        id: 'abcdef0123456789abcdef01',
        name: 'Aurora Overdrive Custom ∞',
        interval: 'month',
        intervalCount: 1,
        priceMicros: 2_500_000,
        currency: 'USD',
        includedTokens: 250_000,
        limits: [
          { dimension: 'tokens', windowSeconds: 60, capValue: 10_000, scope: 'plan' },
          { dimension: 'requests', windowSeconds: 3600, capValue: 500, scope: 'customer' },
        ],
        models: ['opus', 'sonnet'],
      },
      subscription: { status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' },
    });
    expect(h.serviceCalls).toHaveLength(1);
    expect(h.tokens.calls.read).toEqual(['user-1']);
  });

  test('maps limits per active rule: inactive dropped, missing scope/active defaulted', async () => {
    const h = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(200, LIVE_UPSTREAM),
    });
    const res = await h.call({ authUserId: 'user-1' });
    // r-off (active:false) carries no entry; r-requests (no scope, no
    // active) defaults to customer/active.
    expect(res.body.plan.limits).toEqual([
      { dimension: 'tokens', windowSeconds: 60, capValue: 10_000, scope: 'plan' },
      { dimension: 'requests', windowSeconds: 3600, capValue: 500, scope: 'customer' },
    ]);
  });

  test('maps subscription status and period end, null when absent', async () => {
    const pastDue = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(200, {
        subscription: { status: 'past_due', periodEnd: '2026-11-15T12:00:00.000Z' },
        plan: null,
      }),
    });
    expect((await pastDue.call({ authUserId: 'user-1' })).body.subscription).toEqual({
      status: 'past_due',
      currentPeriodEnd: '2026-11-15T12:00:00.000Z',
    });

    const noEnd = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(200, {
        subscription: { status: 'canceled' },
        plan: null,
      }),
    });
    expect((await noEnd.call({ authUserId: 'user-1' })).body.subscription).toEqual({
      status: 'canceled',
      currentPeriodEnd: null,
    });
  });

  test('upstream 404 reads as linked with plan:null and subscription:null', async () => {
    const h = createHarness({
      serviceImpl: (url, init, serviceJson) => serviceJson(404, { error: 'not_found' }),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      link: 'linked',
      persistence: 'ephemeral',
      plan: null,
      subscription: null,
    });
    expect(String(res.body.portalBase)).toMatch(/\/portal\/$/);
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
    h.setNow(start + TOKENPANEL_PLAN_CACHE_TTL_MS / 2);
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ link: 'expired', persistence: 'ephemeral', action: 'sign_in' });
  });

  test('a network failure yields upstream_error and never a zero plan', async () => {
    const h = createHarness({
      serviceImpl: () => { throw new Error('down'); },
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });
    expect(res.body.plan).toBeUndefined();
    expect(res.body.subscription).toBeUndefined();
  });

  test('5xx, 429, and malformed bodies yield upstream_error without stale', async () => {
    const cases = {
      fiveHundred: (url, init, serviceJson) => serviceJson(502, { error: 'upstream' }),
      throttled: (url, init, serviceJson) => serviceJson(429, { error: 'slow' }),
      malformed: (url, init, serviceJson) => serviceJson(200, { subscription: null, plan: { bogus: true } }),
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

  test('serves the cached body marked stale on failure, never an empty plan', async () => {
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
    h.setNow(start + TOKENPANEL_PLAN_CACHE_TTL_MS / 2);
    const stale = await h.call({ authUserId: 'user-1' });
    expect(stale.statusCode).toBe(200);
    expect(stale.body.link).toBe('linked');
    expect(stale.body.stale).toBe(true);
    // The cached plan rides along untouched — id and name verbatim.
    expect(stale.body.plan.id).toBe('abcdef0123456789abcdef01');
    expect(stale.body.plan.name).toBe('Aurora Overdrive Custom ∞');
    expect(stale.body.subscription).toEqual({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });

    h.setNow(start + TOKENPANEL_PLAN_CACHE_TTL_MS + 1000);
    const stillGrace = await h.call({ authUserId: 'user-1' });
    expect(stillGrace.body.stale).toBe(true);
    expect(stillGrace.body.plan.id).toBe('abcdef0123456789abcdef01');

    h.setNow(start + 2 * TOKENPANEL_PLAN_CACHE_TTL_MS + 1000);
    const past = await h.call({ authUserId: 'user-1' });
    expect(past.statusCode).toBe(200);
    expect(past.body).toEqual({ link: 'upstream_error', persistence: 'ephemeral', action: 'retry' });
    expect(past.body.plan).toBeUndefined();
  });

  test('a cached 404 still serves stale on failure', async () => {
    const start = Date.now();
    let mode = 'live';
    const h = createHarness({
      nowValue: start,
      serviceImpl: (url, init, serviceJson) => {
        if (mode === 'live') return serviceJson(404, { error: 'not_found' });
        throw new Error('down');
      },
    });
    expect(await h.call({ authUserId: 'user-1' })).toMatchObject({
      statusCode: 200,
      body: { link: 'linked', plan: null, subscription: null },
    });
    mode = 'down';
    h.setNow(start + TOKENPANEL_PLAN_CACHE_TTL_MS / 2);
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.body).toMatchObject({ link: 'linked', stale: true, plan: null, subscription: null });
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
    const runtime = createTokenpanelPlanRuntime({
      userTokenStore: memoryTokenStore({ pairs: { 'user-1': { accessToken: 'a', refreshToken: 'r' } } }),
      serviceFetch: async () => { throw new Error('down'); },
    });
    await expect(runtime.resolvePlanBody('', 'user-1')).rejects.toMatchObject({ name: 'TokenpanelPlanError' });
    await expect(runtime.resolvePlanBody('user-1', 'user-2')).rejects.toMatchObject({ code: 'TOKENPLAN_FORBIDDEN' });
    const settled = await runtime.resolvePlanBody('user-1', 'user-1').then(
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
          expect(url).toBe(`${TOKENPANEL_DEFAULT_BASE}${TOKENPANEL_PLAN_PATH}`);
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

  test('maps the plan rule array to client limits exactly as Alcore stores it (inactive rules dropped)', async () => {
    const upstream = {
      subscription: { status: 'active', periodEnd: '2027-01-05T12:40:05.148Z' },
      plan: {
        _id: '6aa2f7dc66236f136cf984d3',
        name: 'Capped Monthly',
        price: { amountMicros: 899000000000, currency: 'VND' },
        interval: 'month',
        intervalCount: 1,
        includedTokens: 0,
        allowedModelAliases: ['gpt-x'],
        rateLimits: [
          { id: 'r1', dimension: 'tokens', windowSeconds: 2592000, capValue: 1000000, scope: 'customer', active: true },
          { id: 'r2', dimension: 'requests', windowSeconds: 2592000, capValue: 250, scope: 'customer' },
          { id: 'r3', dimension: 'spend_micros', windowSeconds: 86400, capValue: 10000000, scope: 'model', active: false },
        ],
      },
    };
    const h = createHarness({
      base: 'https://tokenpanel.test/',
      serviceImpl: (url, init, serviceJson) => serviceJson(200, upstream),
    });
    const res = await h.call({ authUserId: 'user-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.plan).toEqual({
      id: '6aa2f7dc66236f136cf984d3',
      name: 'Capped Monthly',
      interval: 'month',
      intervalCount: 1,
      priceMicros: 899000000000,
      currency: 'VND',
      includedTokens: 0,
      limits: [
        { dimension: 'tokens', windowSeconds: 2592000, capValue: 1000000, scope: 'customer' },
        { dimension: 'requests', windowSeconds: 2592000, capValue: 250, scope: 'customer' },
      ],
      models: ['gpt-x'],
    });
  });
});
