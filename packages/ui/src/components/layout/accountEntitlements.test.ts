import { describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import {
  entitlementMetricPercent,
  fetchAccountEntitlementsStatus,
  parseAccountEntitlementsStatus,
  useAccountEntitlements,
  type AccountEntitlementsPayload,
  type AccountEntitlementsStatus,
} from './accountEntitlements';

// Focused coverage for the header entitlements read beside the quota
// status. The entitlements API owns the plan/metrics/balance state; the
// client renders the payload's `link` verbatim and never infers one from
// an HTTP status. A 200 carrying link 'upstream_error' keeps the last good
// numbers marked stale; the /api gate's own 401/403 is "no status" (null),
// never 'unlinked'/'expired'/'upstream_error'. Plan ids are Mongo
// ObjectIds and names are free text: carried verbatim, never enumerated.

const linkedPayload = (overrides: Record<string, AccountEntitlementsPayload> = {}): Record<string, AccountEntitlementsPayload> => ({
  link: 'linked',
  persistence: 'durable',
  stale: false,
  plan: {
    id: '507f1f77bcf86cd799439011',
    name: 'Sonar Overdrive Custom \u221E',
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
  portalBase: 'https://alcore.test/portal/',
  ...overrides,
});

const mustLinked = (payload: AccountEntitlementsPayload): Extract<AccountEntitlementsStatus, { link: 'linked' }> => {
  const parsed = parseAccountEntitlementsStatus(payload);
  if (!parsed || parsed.link !== 'linked') throw new Error('Expected a linked status');
  return parsed;
};

describe('parseAccountEntitlementsStatus', () => {
  test('linked with a full body parses to linked with verbatim plan, metrics, and portalBase', () => {
    const status = mustLinked(linkedPayload());
    expect(status.persistence).toBe('durable');
    expect(status.stale).toBe(false);
    expect(status.plan?.id).toBe('507f1f77bcf86cd799439011');
    expect(status.plan?.name).toBe('Sonar Overdrive Custom \u221E');
    expect(status.metrics).toHaveLength(2);
    expect(status.metrics[0]).toMatchObject({ dimension: 'tokens', used: 12_345, limit: 250_000 });
    expect(status.balance?.availableMicros).toBe(900_000);
    expect(status.portalBase).toBe('https://alcore.test/portal/');
  });

  test('plan ids and names stay open strings, never mapped', () => {
    const status = mustLinked(linkedPayload({
      plan: {
        id: 'weird-id from upstream 42',
        name: 'Totally Custom \u2014 Tier \u221E',
        interval: 'year',
        intervalCount: 3,
        priceMicros: 0,
        currency: 'EUR',
        includedTokens: 0,
      },
    }));
    expect(status.plan?.id).toBe('weird-id from upstream 42');
    expect(status.plan?.name).toBe('Totally Custom \u2014 Tier \u221E');
  });

  test('upstream 404 shape (plan null, empty metrics, null balance) stays linked with portalBase', () => {
    const status = mustLinked(linkedPayload({ plan: null, subscription: null, metrics: [], balance: null }));
    expect(status.link).toBe('linked');
    expect(status.plan).toBeNull();
    expect(status.metrics).toEqual([]);
    expect(status.balance).toBeNull();
    expect(status.portalBase).toBe('https://alcore.test/portal/');
  });

  test('a missing portalBase reads as null (no usable base, so no CTAs)', () => {
    const { portalBase: _dropped, ...without } = linkedPayload();
    void _dropped;
    const status = mustLinked(without);
    expect(status.portalBase).toBeNull();
  });

  test('unlinked, expired, and upstream_error pass through with persistence and action', () => {
    const cases: Array<{ link: 'unlinked' | 'expired' | 'upstream_error'; action: 'sign_in' | 'retry' }> = [
      { link: 'unlinked', action: 'sign_in' },
      { link: 'expired', action: 'sign_in' },
      { link: 'upstream_error', action: 'retry' },
    ];
    for (const { link, action } of cases) {
      expect(parseAccountEntitlementsStatus({ link, persistence: 'ephemeral', action })).toEqual({
        link,
        persistence: 'ephemeral',
        action,
      });
    }
  });

  test('stale defaults to false and survives when true', () => {
    expect(mustLinked(linkedPayload()).stale).toBe(false);
    expect(mustLinked(linkedPayload({ stale: true })).stale).toBe(true);
  });

  test('malformed envelopes are null, never a fabricated link', () => {
    const corrupts: AccountEntitlementsPayload[] = [
      null,
      undefined,
      '',
      'oops',
      42,
      [],
      {},
      { authenticated: true },
      { link: 'linked' },
      { link: 'linked', persistence: 'durable' },
      { link: 'bogus', persistence: 'durable' },
      { link: 'linked', persistence: 'bogus' },
    ];
    for (const corrupt of corrupts) {
      expect(parseAccountEntitlementsStatus(corrupt)).toBeNull();
    }
  });

  test('malformed plan degrades to null while metrics and balance still render', () => {
    const status = mustLinked(linkedPayload({ plan: { bogus: true } }));
    expect(status.plan).toBeNull();
    expect(status.metrics).toHaveLength(2);
    expect(status.balance?.availableMicros).toBe(900_000);
  });

  test('malformed metrics degrade to [] while the plan still renders', () => {
    const status = mustLinked(linkedPayload({
      metrics: [{ dimension: 'tokens', used: 'many', limit: 1, windowSeconds: 60, windowStart: 'x', resetsAt: 'y' }],
    }));
    expect(status.metrics).toEqual([]);
    expect(status.plan?.name).toBe('Sonar Overdrive Custom \u221E');
  });

  test('smuggled plan, allowance, or unlimited markers never survive the parse', () => {
    const status = mustLinked({
      ...linkedPayload(),
      tier: 'free',
      unlimited: true,
      plan: { ...(linkedPayload().plan as Record<string, AccountEntitlementsPayload>), tier: 'free', unlimited: true },
    });
    expect(status.link).toBe('linked');
    expect(/unlimited/i.test(JSON.stringify(status))).toBe(false);
    expect(JSON.stringify(status)).not.toContain('allowance');
  });
});

describe('entitlementMetricPercent', () => {
  test('computes the share from the two server numbers', () => {
    expect(entitlementMetricPercent({
      dimension: 'tokens', used: 12_345, limit: 250_000, windowSeconds: 2_592_000, windowStart: 'x', resetsAt: 'y',
    })).toBe(5);
    expect(entitlementMetricPercent({
      dimension: 'requests', used: 25_000, limit: 50_000, windowSeconds: 86_400, windowStart: 'x', resetsAt: 'y',
    })).toBe(50);
  });

  test('clamps an overshoot instead of overflowing the bar', () => {
    expect(entitlementMetricPercent({
      dimension: 'tokens', used: 300_000, limit: 250_000, windowSeconds: 60, windowStart: 'x', resetsAt: 'y',
    })).toBe(100);
  });

  test('a missing, non-positive, or non-finite limit yields no percent', () => {
    for (const limit of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(entitlementMetricPercent({
        dimension: 'tokens', used: 10, limit, windowSeconds: 60, windowStart: 'x', resetsAt: 'y',
      })).toBeNull();
    }
  });

  test('a non-finite used yields no percent', () => {
    for (const used of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(entitlementMetricPercent({
        dimension: 'tokens', used, limit: 100, windowSeconds: 60, windowStart: 'x', resetsAt: 'y',
      })).toBeNull();
    }
  });
});

describe('fetchAccountEntitlementsStatus', () => {
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

  const json = (status: number, data: AccountEntitlementsPayload) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  test('reads the entitlements route for the subject', async () => {
    const w = installWindow(async () => json(200, linkedPayload()));
    try {
      const status = await fetchAccountEntitlementsStatus('auth_user_1', new AbortController().signal);
      expect(status?.link).toBe('linked');
      expect(w.requests.some((entry) => entry.includes('/api/tokenpanel/entitlements'))).toBe(true);
      expect(w.requests.some((entry) => entry.includes('authUserId=auth_user_1'))).toBe(true);
      expect(w.requests.some((entry) => entry.includes('/api/tokenpanel/quota'))).toBe(false);
    } finally {
      w.restore();
    }
  });

  test('a 200 carrying upstream_error parses to the error status', async () => {
    const w = installWindow(async () =>
      json(200, { link: 'upstream_error', persistence: 'durable', action: 'retry' }),
    );
    try {
      expect(await fetchAccountEntitlementsStatus('auth_user_1', new AbortController().signal)).toEqual({
        link: 'upstream_error',
        persistence: 'durable',
        action: 'retry',
      });
    } finally {
      w.restore();
    }
  });

  test('gate rejections carry no status — never unlinked, expired, or upstream_error', async () => {
    for (const gateStatus of [401, 403, 503]) {
      const w = installWindow(async () => json(gateStatus, { error: 'gate_rejected' }));
      try {
        expect(await fetchAccountEntitlementsStatus('auth_user_1', new AbortController().signal)).toBeNull();
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
      expect(await fetchAccountEntitlementsStatus('auth_user_1', new AbortController().signal)).toBeNull();
    } finally {
      failing.restore();
    }
    const malformed = installWindow(async () => json(200, { unexpected: true }));
    try {
      expect(await fetchAccountEntitlementsStatus('auth_user_1', new AbortController().signal)).toBeNull();
    } finally {
      malformed.restore();
    }
  });

  test('empty subject never reaches the network', async () => {
    const w = installWindow(async () => json(200, linkedPayload()));
    try {
      expect(await fetchAccountEntitlementsStatus('', new AbortController().signal)).toBeNull();
      expect(w.requests).toHaveLength(0);
    } finally {
      w.restore();
    }
  });
});

interface EntitlementsHarness {
  root: import('react-dom/client').Root;
  renderProbe: (subject: string | null, ready: boolean) => Promise<void>;
  requests: string[];
  setResponder: (next: (input: string) => Promise<Response>) => void;
  seen: Array<AccountEntitlementsStatus | null>;
  stamps: Array<number | null>;
  busyFlags: boolean[];
  refreshLatest: () => void;
  teardown: () => Promise<void>;
}

const tick = async (ms = 20): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const jsonBody = (status: number, data: AccountEntitlementsPayload) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const setupHarness = async (): Promise<EntitlementsHarness> => {
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
  const seen: Array<AccountEntitlementsStatus | null> = [];
  const stamps: Array<number | null> = [];
  const busyFlags: boolean[] = [];
  let latestRefresh: () => void = () => {};
  const Probe: React.FC<{ subject: string | null; ready: boolean }> = ({ subject, ready }) => {
    const { entitlements, refresh, lastUpdated, isRefreshing } = useAccountEntitlements(subject, ready);
    seen.push(entitlements);
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

const linkedNameOf = (status: AccountEntitlementsStatus | null): string => {
  if (status?.link !== 'linked' || status.plan === null) throw new Error('Expected a linked status with a plan');
  return status.plan.name;
};

describe('useAccountEntitlements readiness', () => {
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
      expect(harness.requests[0]).toContain('/api/tokenpanel/entitlements');
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

  test('subject change refetches for the new identity', async () => {
    const harness = await setupHarness();
    harness.setResponder(async (input) => {
      const subject = new URL(input, 'http://localhost').searchParams.get('authUserId') ?? 'unknown';
      return jsonBody(200, linkedPayload({
        plan: {
          id: `plan-for-${subject}`,
          name: `Plan ${subject}`,
          interval: 'month',
          intervalCount: 1,
          priceMicros: 100,
          currency: 'USD',
          includedTokens: 1,
        },
      }));
    });
    try {
      await harness.renderProbe('user_a', true);
      expect(linkedNameOf(harness.seen.at(-1) ?? null)).toBe('Plan user_a');
      await harness.renderProbe('user_b', true);
      expect(linkedNameOf(harness.seen.at(-1) ?? null)).toBe('Plan user_b');
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
      await act(async () => {
        resolvers.get('user_b')?.(
          jsonBody(200, linkedPayload({
            plan: {
              id: 'plan-b',
              name: 'Plan B',
              interval: 'month',
              intervalCount: 1,
              priceMicros: 100,
              currency: 'USD',
              includedTokens: 1,
            },
          })),
        );
        await tick(50);
      });
      expect(linkedNameOf(harness.seen.at(-1) ?? null)).toBe('Plan B');
      await act(async () => {
        resolvers.get('user_a')?.(
          jsonBody(200, linkedPayload({
            plan: {
              id: 'plan-a',
              name: 'Plan A',
              interval: 'month',
              intervalCount: 1,
              priceMicros: 100,
              currency: 'USD',
              includedTokens: 1,
            },
          })),
        );
        await tick(50);
      });
      expect(linkedNameOf(harness.seen.at(-1) ?? null)).toBe('Plan B');
      const latest = harness.seen.at(-1);
      if (latest?.link !== 'linked' || latest.plan === null) throw new Error('Expected a linked plan');
      expect(latest.plan.id).toBe('plan-b');
    } finally {
      await harness.teardown();
    }
  });

  test('a failed refresh keeps the last good body and marks it stale', async () => {
    const harness = await setupHarness();
    try {
      await harness.renderProbe('auth_user_1', true);
      expect(harness.seen.at(-1)?.link).toBe('linked');
      const goodStamp = harness.stamps.at(-1);
      expect(typeof goodStamp).toBe('number');
      harness.setResponder(async () => {
        throw new TypeError('network down');
      });
      await act(async () => {
        harness.refreshLatest();
        await tick(50);
      });
      const kept = harness.seen.at(-1);
      expect(kept?.link).toBe('linked');
      if (kept?.link !== 'linked') throw new Error('Expected the last good body to be kept');
      expect(kept.stale).toBe(true);
      expect(kept.plan?.name).toBe('Sonar Overdrive Custom \u221E');
      expect(kept.metrics).toHaveLength(2);
      expect(harness.stamps.at(-1)).toBe(goodStamp);
      expect(harness.busyFlags.at(-1)).toBe(false);
    } finally {
      await harness.teardown();
    }
  });

  test('an upstream_error keeps the last good values and marks stale', async () => {
    const harness = await setupHarness();
    try {
      await harness.renderProbe('auth_user_1', true);
      expect(harness.seen.at(-1)?.link).toBe('linked');
      harness.setResponder(async () =>
        jsonBody(200, { link: 'upstream_error', persistence: 'durable', action: 'retry' }),
      );
      await act(async () => {
        harness.refreshLatest();
        await tick(50);
      });
      const kept = harness.seen.at(-1);
      expect(kept?.link).toBe('linked');
      if (kept?.link !== 'linked') throw new Error('Expected the last good body to be kept');
      expect(kept.stale).toBe(true);
      expect(kept.metrics).toHaveLength(2);
      expect(kept.balance?.availableMicros).toBe(900_000);
    } finally {
      await harness.teardown();
    }
  });

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
});
