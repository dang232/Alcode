import { describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import {
  fetchAccountPlanStatus,
  formatPlanCap,
  parseAccountPlanStatus,
  planWindowUnit,
  useAccountPlan,
  type AccountPlanPayload,
  type AccountPlanPayloadObject,
  type AccountPlanStatus,
} from './accountPlan';

// Focused coverage for the header plan states beside the quota surface.
// The plan API owns the link state: the client renders the payload's
// `link` verbatim and never infers one from an HTTP status. A 200 carrying
// link 'upstream_error' is the error state; the /api gate's own 401/403 is
// "no status" (null), never 'unlinked'. A linked body resolves its plan
// detail: a well-formed object is `ready`, null is the upstream 404 (`none`,
// "No active plan"), and anything else is `unavailable` ("Plan unavailable")
// — a linked answer never leaves the panel on a loader.
//
// Plan identity is fully dynamic (ObjectId ids, free-text names): the
// contract accepts any id (1..64) and name (1..120) with no enum, no name
// mapping, and no fallback to "Free". Only the explicit capValue null
// marker renders as Unlimited — an absent limit row renders as nothing.

const planBody = (overrides: AccountPlanPayloadObject = {}): AccountPlanPayloadObject => ({
  id: '507f1f77bcf86cd799439011',
  name: 'Studio 2027',
  interval: 'month',
  intervalCount: 1,
  priceMicros: 2_400_000_000,
  currency: 'USD',
  includedTokens: 50000,
  limits: [
    { dimension: 'tokens', windowSeconds: 86400, capValue: 50000, scope: 'customer' },
    { dimension: 'requests', windowSeconds: 3600, capValue: 1000, scope: 'customer' },
    { dimension: 'spend_micros', windowSeconds: 2592000, capValue: 25_000_000, scope: 'customer' },
  ],
  models: [],
  ...overrides,
});

const linkedPayload = (
  subject: string = 'auth_user_1',
  overrides: AccountPlanPayloadObject = {},
): AccountPlanPayloadObject => ({
  link: 'linked',
  persistence: 'durable',
  stale: false,
  plan: planBody(),
  subscription: { status: 'active', currentPeriodEnd: '2027-01-01T00:00:00Z' },
  authUserId: subject,
  ...overrides,
});

const readyPlanOf = (status: AccountPlanStatus | null | undefined) => {
  if (status?.link !== 'linked' || status.detail.state !== 'ready') {
    throw new Error('Expected a linked status with a ready plan');
  }
  return status.detail.plan;
};

describe('parseAccountPlanStatus', () => {
  test('linked with a full plan parses to linked with a ready plan', () => {
    const plan = readyPlanOf(parseAccountPlanStatus(linkedPayload()));
    expect(plan.id).toBe('507f1f77bcf86cd799439011');
    expect(plan.name).toBe('Studio 2027');
    expect(plan.interval).toBe('month');
    expect(plan.intervalCount).toBe(1);
    expect(plan.currency).toBe('USD');
    expect(plan.limits).toHaveLength(3);
  });

  test('plan identity is open: ids and names outside any enum pass through verbatim', () => {
    for (const [id, name] of [
      ['not-in-any-enum-999', 'Studio 2027'],
      ['507f1f77bcf86cd799439011', 'A name with punctuation & symbols (2027)!'],
      ['x', 'y'],
    ] as const) {
      const plan = readyPlanOf(parseAccountPlanStatus(linkedPayload('auth_user_1', { plan: planBody({ id, name }) })));
      expect(plan.id).toBe(id);
      expect(plan.name).toBe(name);
    }
  });

  test('linked with plan null is the no-active-plan case, distinct from unknown', () => {
    const status = parseAccountPlanStatus(linkedPayload('auth_user_1', { plan: null }));
    expect(status?.link).toBe('linked');
    if (status?.link === 'linked') {
      expect(status.detail).toEqual({ state: 'none' });
    } else {
      throw new Error('Expected a linked status');
    }
  });

  test('unlinked, expired, and upstream_error pass through with persistence and action', () => {
    const cases: Array<{ link: 'unlinked' | 'expired' | 'upstream_error'; action: 'sign_in' | 'retry' }> = [
      { link: 'unlinked', action: 'sign_in' },
      { link: 'expired', action: 'sign_in' },
      { link: 'upstream_error', action: 'retry' },
    ];
    for (const { link, action } of cases) {
      expect(parseAccountPlanStatus({ link, persistence: 'ephemeral', action })).toEqual({
        link,
        persistence: 'ephemeral',
        action,
      });
    }
  });

  test('a smuggled transport code never overrides the payload link', () => {
    const status = parseAccountPlanStatus({ ...linkedPayload(), status: 401 });
    expect(status?.link).toBe('linked');
    const upstream = parseAccountPlanStatus({
      link: 'upstream_error',
      persistence: 'durable',
      action: 'retry',
      status: 200,
    });
    expect(upstream?.link).toBe('upstream_error');
  });

  test('malformed envelopes are null, never a fabricated link', () => {
    const corrupts: AccountPlanPayload[] = [
      null,
      undefined,
      '',
      'oops',
      42,
      [],
      {},
      { authenticated: true },
      { link: 'linked' },
      { link: 'linked', persistence: 'durable', plan: planBody(), stale: 'yes' },
      { link: 'bogus', persistence: 'durable' },
      { link: 'linked', persistence: 'bogus', plan: planBody() },
    ];
    for (const corrupt of corrupts) {
      expect(parseAccountPlanStatus(corrupt)).toBeNull();
    }
  });

  test('malformed entitlement data is linked-but-unavailable, never a loader', () => {
    const corrupts: AccountPlanPayload[] = [
      { ...linkedPayload(), plan: 'oops' },
      { ...linkedPayload(), plan: 42 },
      { ...linkedPayload(), plan: { ...planBody(), id: '' } },
      { ...linkedPayload(), plan: { ...planBody(), id: 42 } },
      { ...linkedPayload(), plan: { ...planBody(), id: 'x'.repeat(65) } },
      { ...linkedPayload(), plan: { ...planBody(), name: '' } },
      { ...linkedPayload(), plan: { ...planBody(), name: 'y'.repeat(121) } },
      { ...linkedPayload(), plan: { ...planBody(), interval: 'fortnight' } },
      { ...linkedPayload(), plan: { ...planBody(), intervalCount: 0 } },
      { ...linkedPayload(), plan: { ...planBody(), currency: '' } },
      { ...linkedPayload(), plan: { ...planBody(), limits: 'lots' } },
      {
        ...linkedPayload(),
        plan: planBody({ limits: [{ dimension: 'tokens', windowSeconds: 86400, capValue: 0, scope: 'customer' }] }),
      },
      {
        ...linkedPayload(),
        plan: planBody({ limits: [{ dimension: 'tokens', windowSeconds: 86400, capValue: -5, scope: 'customer' }] }),
      },
      {
        ...linkedPayload(),
        plan: planBody({ limits: [{ dimension: 'tokens', windowSeconds: 86400, capValue: 'lots', scope: 'customer' }] }),
      },
      {
        ...linkedPayload(),
        plan: planBody({ limits: [{ dimension: 'tokens', windowSeconds: 0, capValue: 7, scope: 'customer' }] }),
      },
      { ...linkedPayload(), plan: { ...planBody(), priceMicros: Number.NaN } },
    ];
    for (const corrupt of corrupts) {
      const status = parseAccountPlanStatus(corrupt);
      expect(status?.link).toBe('linked');
      if (status?.link === 'linked') {
        expect(status.detail).toEqual({ state: 'unavailable' });
      } else {
        throw new Error('Expected a linked status');
      }
    }
    // A missing plan key is malformed too: a linked body must carry one.
    const missing = parseAccountPlanStatus({ link: 'linked', persistence: 'durable', stale: false });
    expect(missing?.link).toBe('linked');
    if (missing?.link === 'linked') {
      expect(missing.detail).toEqual({ state: 'unavailable' });
    } else {
      throw new Error('Expected a linked status');
    }
  });

  test('a malformed subscription degrades to null while a good plan still renders', () => {
    const status = parseAccountPlanStatus(linkedPayload('auth_user_1', { subscription: 'oops' }));
    expect(status?.link).toBe('linked');
    if (status?.link === 'linked') {
      expect(status.detail.state).toBe('ready');
      expect(status.subscription).toBeNull();
    } else {
      throw new Error('Expected a linked status');
    }
    const good = parseAccountPlanStatus(linkedPayload());
    if (good?.link === 'linked') {
      expect(good.subscription).toMatchObject({ status: 'active' });
    } else {
      throw new Error('Expected a linked status');
    }
  });

  test('stale defaults to false and survives when true', () => {
    const fallback = parseAccountPlanStatus({
      link: 'linked',
      persistence: 'durable',
      plan: planBody(),
      subscription: { status: 'active', currentPeriodEnd: '2027-01-01T00:00:00Z' },
    });
    if (fallback?.link !== 'linked') throw new Error('Expected a linked status');
    expect(fallback.stale).toBe(false);
    const stale = parseAccountPlanStatus(linkedPayload('auth_user_1', { stale: true }));
    if (stale?.link !== 'linked') throw new Error('Expected a linked status');
    expect(stale.stale).toBe(true);
  });

  test('smuggled plan enums and free-tier markers never survive the parse', () => {
    const status = parseAccountPlanStatus({
      ...linkedPayload(),
      tier: 'free',
      unlimited: true,
      plan: { ...planBody(), tier: 'free', unlimited: true },
    });
    expect(status?.link).toBe('linked');
    expect(/unlimited/i.test(JSON.stringify(status))).toBe(false);
    expect(JSON.stringify(status)).not.toContain('Free');
    const plan = readyPlanOf(status);
    expect(plan).not.toHaveProperty('tier');
  });
});

describe('planWindowUnit', () => {
  test('humanizes validated windows to the largest whole unit', () => {
    expect(planWindowUnit(60)).toEqual({ unit: 'minute', count: 1 });
    expect(planWindowUnit(300)).toEqual({ unit: 'minute', count: 5 });
    expect(planWindowUnit(3600)).toEqual({ unit: 'hour', count: 1 });
    expect(planWindowUnit(86400)).toEqual({ unit: 'day', count: 1 });
    expect(planWindowUnit(604800)).toEqual({ unit: 'week', count: 1 });
    expect(planWindowUnit(2592000)).toEqual({ unit: 'day', count: 30 });
    expect(planWindowUnit(90)).toEqual({ unit: 'seconds', count: 90 });
  });
});

describe('formatPlanCap', () => {
  test('tokens and requests format as grouped counts', () => {
    expect(
      formatPlanCap({ dimension: 'tokens', windowSeconds: 86400, capValue: 50000 }, 'USD'),
    ).toBe('50,000');
    expect(
      formatPlanCap({ dimension: 'requests', windowSeconds: 3600, capValue: 1234567 }, 'USD'),
    ).toBe('1,234,567');
  });

  test('spend_micros formats as money in the plan currency', () => {
    const text = formatPlanCap({ dimension: 'spend_micros', windowSeconds: 2592000, capValue: 25_000_000 }, 'USD');
    expect(text).toContain('$');
    expect(text).toContain('25');
  });

  test('only the null marker formats as null (the Unlimited path)', () => {
    expect(formatPlanCap({ dimension: 'tokens', windowSeconds: 86400, capValue: null }, 'USD')).toBeNull();
    expect(formatPlanCap({ dimension: 'spend_micros', windowSeconds: 86400, capValue: null }, 'USD')).toBeNull();
  });
});

describe('fetchAccountPlanStatus', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalFetch = globalThis.fetch;

  const installWindow = (fetchImpl: (input: string) => Promise<Response>) => {
    const requests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (String(input).includes('/auth/session')) {
        return new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return fetchImpl(String(input));
    }) as typeof fetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        location: {
          origin: 'http://127.0.0.1:3001',
          href: 'http://127.0.0.1:3001/',
          protocol: 'http:',
          reload: () => {},
        },
      },
    });
    return {
      requests,
      restore: () => {
        globalThis.fetch = originalFetch;
        Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
      },
    };
  };

  const json = (status: number, data: AccountPlanPayload) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  test('reads the plan route for the subject', async () => {
    const w = installWindow(async () => json(200, linkedPayload()));
    try {
      const plan = await fetchAccountPlanStatus('auth_user_1', new AbortController().signal);
      expect(plan?.link).toBe('linked');
      expect(w.requests.some((entry) => entry.includes('/api/tokenpanel/plan'))).toBe(true);
      expect(w.requests.some((entry) => entry.includes('authUserId=auth_user_1'))).toBe(true);
      expect(w.requests.some((entry) => entry.includes('/api/tokenpanel/status'))).toBe(false);
    } finally {
      w.restore();
    }
  });

  test('a 200 carrying upstream_error is the error state despite the 200', async () => {
    const w = installWindow(async () =>
      json(200, { link: 'upstream_error', persistence: 'durable', action: 'retry' }),
    );
    try {
      expect(await fetchAccountPlanStatus('auth_user_1', new AbortController().signal)).toEqual({
        link: 'upstream_error',
        persistence: 'durable',
        action: 'retry',
      });
    } finally {
      w.restore();
    }
  });

  test('gate rejections carry no link — never unlinked, expired, or upstream_error', async () => {
    for (const gateStatus of [401, 403, 503]) {
      const w = installWindow(async () => json(gateStatus, { error: 'gate_rejected' }));
      try {
        expect(await fetchAccountPlanStatus('auth_user_1', new AbortController().signal)).toBeNull();
      } finally {
        w.restore();
      }
    }
  });

  test('network failures and malformed bodies are null', async () => {
    const failing = installWindow(async () => {
      throw new TypeError('network down');
    });
    try {
      expect(await fetchAccountPlanStatus('auth_user_1', new AbortController().signal)).toBeNull();
    } finally {
      failing.restore();
    }
    const malformed = installWindow(async () => json(200, { unexpected: true }));
    try {
      expect(await fetchAccountPlanStatus('auth_user_1', new AbortController().signal)).toBeNull();
    } finally {
      malformed.restore();
    }
  });

  test('empty subject never reaches the network', async () => {
    const w = installWindow(async () => json(200, linkedPayload()));
    try {
      expect(await fetchAccountPlanStatus('', new AbortController().signal)).toBeNull();
      expect(w.requests).toHaveLength(0);
    } finally {
      w.restore();
    }
  });
});

interface PlanHarness {
  root: import('react-dom/client').Root;
  renderProbe: (subject: string | null, ready: boolean) => Promise<void>;
  requests: string[];
  respondWith: (input: string) => Promise<Response>;
  setResponder: (next: (input: string) => Promise<Response>) => void;
  seen: Array<AccountPlanStatus | null>;
  stamps: Array<number | null>;
  busyFlags: boolean[];
  refreshLatest: () => void;
  teardown: () => Promise<void>;
}

const tick = async (ms = 20): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const jsonBody = (status: number, data: AccountPlanPayload) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const setupHarness = async (): Promise<PlanHarness> => {
  const win = new Window({ url: 'http://localhost' });
  const values = {
    window: win,
    document: win.document,
    navigator: win.navigator,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    MutationObserver: win.MutationObserver,
    ResizeObserver: win.ResizeObserver,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(values).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const restoreGlobals = () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  };
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let responder: (input: string) => Promise<Response> = async () => jsonBody(200, linkedPayload());
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
    if (String(input).includes('/auth/session')) return jsonBody(200, { authenticated: true });
    return responder(String(input));
  }) as typeof fetch;
  const seen: Array<AccountPlanStatus | null> = [];
  const stamps: Array<number | null> = [];
  const busyFlags: boolean[] = [];
  let latestRefresh: () => void = () => {};
  const Probe: React.FC<{ subject: string | null; ready: boolean }> = ({ subject, ready }) => {
    const { plan, refresh, lastUpdated, isRefreshing } = useAccountPlan(subject, ready);
    seen.push(plan);
    stamps.push(lastUpdated);
    busyFlags.push(isRefreshing);
    latestRefresh = refresh;
    return null;
  };
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    root,
    renderProbe: async (subject, ready) => {
      await act(async () => {
        root.render(React.createElement(Probe, { subject, ready }));
        await tick();
      });
    },
    requests,
    respondWith: (input) => responder(input),
    setResponder: (next) => {
      responder = next;
    },
    seen,
    stamps,
    busyFlags,
    refreshLatest: () => latestRefresh(),
    teardown: async () => {
      await act(async () => root.unmount());
      globalThis.fetch = originalFetch;
      await win.happyDOM.close();
      restoreGlobals();
    },
  };
};

describe('useAccountPlan readiness', () => {
  test('no fetch while not ready', async () => {
    const harness = await setupHarness();
    try {
      await harness.renderProbe('auth_user_1', false);
      expect(harness.requests).toHaveLength(0);
      expect(harness.seen.at(-1)).toBeNull();
    } finally {
      await harness.teardown();
    }
  });

  test('exactly one fetch when readiness turns true', async () => {
    const harness = await setupHarness();
    try {
      await harness.renderProbe('auth_user_1', false);
      expect(harness.requests).toHaveLength(0);
      await harness.renderProbe('auth_user_1', true);
      expect(harness.requests).toHaveLength(1);
      expect(harness.requests[0]).toContain('/api/tokenpanel/plan');
      expect(harness.seen.at(-1)?.link).toBe('linked');
    } finally {
      await harness.teardown();
    }
  });

  test('one fetch per refresh', async () => {
    const harness = await setupHarness();
    try {
      await harness.renderProbe('auth_user_1', true);
      expect(harness.requests).toHaveLength(1);
      await act(async () => {
        harness.refreshLatest();
        await tick();
      });
      expect(harness.requests).toHaveLength(2);
      await act(async () => {
        harness.refreshLatest();
        await tick();
      });
      expect(harness.requests).toHaveLength(3);
    } finally {
      await harness.teardown();
    }
  });

  test('refresh while not ready never fetches', async () => {
    const harness = await setupHarness();
    try {
      await harness.renderProbe('auth_user_1', false);
      await act(async () => {
        harness.refreshLatest();
        await tick();
      });
      expect(harness.requests).toHaveLength(0);
    } finally {
      await harness.teardown();
    }
  });

  test('a 401 while ready keeps no status — never unlinked', async () => {
    const harness = await setupHarness();
    harness.setResponder(async () => jsonBody(401, { error: 'gate_rejected' }));
    try {
      await harness.renderProbe('auth_user_1', true);
      expect(harness.requests).toHaveLength(1);
      expect(harness.seen.at(-1)).toBeNull();
    } finally {
      await harness.teardown();
    }
  });
});

describe('useAccountPlan identity switching and ordering', () => {
  test('a session switch replaces the plan', async () => {
    const harness = await setupHarness();
    harness.setResponder(async (input) => {
      const subject = new URL(input, 'http://localhost').searchParams.get('authUserId');
      return jsonBody(
        200,
        linkedPayload(subject ?? 'unknown', {
          plan: planBody({ id: `plan-for-${subject}`, name: subject === 'user_b' ? 'Plan B' : 'Plan A' }),
        }),
      );
    });
    try {
      await harness.renderProbe('user_a', true);
      expect(readyPlanOf(harness.seen.at(-1)).name).toBe('Plan A');
      await harness.renderProbe('user_b', true);
      expect(harness.requests).toHaveLength(2);
      expect(readyPlanOf(harness.seen.at(-1)).name).toBe('Plan B');
      expect(readyPlanOf(harness.seen.at(-1)).id).toBe('plan-for-user_b');
    } finally {
      await harness.teardown();
    }
  });

  test('an out-of-order stale response never overwrites a newer one', async () => {
    const harness = await setupHarness();
    const resolvers = new Map<string, (response: Response) => void>();
    harness.setResponder(
      (input) =>
        new Promise<Response>((resolve) => {
          const subject = new URL(input, 'http://localhost').searchParams.get('authUserId') ?? 'unknown';
          resolvers.set(subject, resolve);
        }),
    );
    try {
      await harness.renderProbe('user_a', true);
      expect(resolvers.has('user_a')).toBe(true);
      await harness.renderProbe('user_b', true);
      expect(resolvers.has('user_b')).toBe(true);
      // The newer read lands first; the older read lands after it.
      await act(async () => {
        resolvers.get('user_b')?.(
          jsonBody(200, linkedPayload('user_b', { plan: planBody({ id: 'plan-b', name: 'Plan B' }) })),
        );
        await tick(50);
      });
      expect(readyPlanOf(harness.seen.at(-1)).name).toBe('Plan B');
      await act(async () => {
        resolvers.get('user_a')?.(
          jsonBody(200, linkedPayload('user_a', { plan: planBody({ id: 'plan-a', name: 'Plan A' }) })),
        );
        await tick(50);
      });
      expect(readyPlanOf(harness.seen.at(-1)).name).toBe('Plan B');
      expect(readyPlanOf(harness.seen.at(-1)).id).toBe('plan-b');
    } finally {
      await harness.teardown();
    }
  });
});

describe('useAccountPlan success timestamp', () => {
  test('a successful read stamps the time and settles the refresh flag', async () => {
    const harness = await setupHarness();
    try {
      const before = Date.now();
      await harness.renderProbe('auth_user_1', true);
      expect(harness.seen.at(-1)?.link).toBe('linked');
      const stamp = harness.stamps.at(-1);
      expect(typeof stamp).toBe('number');
      expect((stamp as number) >= before).toBe(true);
      expect(harness.busyFlags.at(-1)).toBe(false);
    } finally {
      await harness.teardown();
    }
  });

  test('a failed refresh keeps the previous values and its timestamp', async () => {
    const harness = await setupHarness();
    try {
      await harness.renderProbe('auth_user_1', true);
      const goodPlan = harness.seen.at(-1);
      const goodStamp = harness.stamps.at(-1);
      expect(goodPlan?.link).toBe('linked');
      expect(typeof goodStamp).toBe('number');
      harness.setResponder(async () => jsonBody(401, { error: 'gate_rejected' }));
      await act(async () => {
        harness.refreshLatest();
        await tick(50);
      });
      expect(harness.seen.at(-1)).toEqual(goodPlan);
      expect(harness.stamps.at(-1)).toBe(goodStamp);
      expect(harness.busyFlags.at(-1)).toBe(false);
    } finally {
      await harness.teardown();
    }
  });
});
