import { describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import {
  fetchAccountQuotaStatus,
  formatQuotaMoney,
  parseAccountQuota,
  parseAccountQuotaStatus,
  quotaAvailableMajor,
  quotaBalanceShares,
  quotaCostMajor,
  useAccountQuota,
  type AccountQuotaPayload,
  type AccountQuotaPayloadObject,
  type AccountQuotaStatus,
} from './accountQuota';

// Focused coverage for the header quota states beside the tier badge.
// The status API owns the link state: the client renders the payload's
// `link` verbatim and never infers one from an HTTP status. A 200 carrying
// link 'upstream_error' is the error state; the /api gate's own 401/403 is
// "no status" (null), never 'unlinked'. The embedded quota body still
// parses live vs stale-cached vs unavailable, and malformed bodies are
// unavailable — never a blank crash, never a fabricated quota.

const liveBody = {
  authUserId: 'auth_user_1',
  customerId: '507f1f77bcf86cd799439011',
  balance: { amountMicros: 2_000_000, reservedMicros: 750_000, availableMicros: 1_250_000, currency: 'USD' },
  usage: { totalRequests: 42, totalTokens: 1200, totalCostMicros: 300_000, totalPriceMicros: 500_000, currency: 'USD' },
  source: 'live',
  stale: false,
};

const linkedPayload = (overrides: AccountQuotaPayloadObject = {}): AccountQuotaPayloadObject => ({
  link: 'linked',
  persistence: 'durable',
  quota: { ...liveBody },
  ...overrides,
});

describe('parseAccountQuota', () => {
  test('live body parses to the live state with values', () => {
    const quota = parseAccountQuota(liveBody);
    expect(quota).toMatchObject({ state: 'live' });
    if (quota.state === 'live') {
      expect(quota.balance.availableMicros).toBe(1_250_000);
      expect(quota.usage.totalTokens).toBe(1200);
      expect(quotaAvailableMajor(quota.balance)).toBe(1.25);
    }
  });

  test('stale flag maps to stale-cached, keeping the values', () => {
    const quota = parseAccountQuota({ ...liveBody, source: 'cache', stale: true });
    expect(quota).toMatchObject({ state: 'stale-cached' });
    if (quota.state === 'stale-cached') {
      expect(quota.balance.availableMicros).toBe(1_250_000);
    }
  });

  test('malformed bodies are unavailable, never a crash', () => {
    for (const corrupt of [null, undefined, '', 'oops', 42, [], {}, { authenticated: true }, { ...liveBody, balance: null }, { ...liveBody, usage: { totalTokens: 'lots' } }, { ...liveBody, stale: 'yes' }]) {
      expect(parseAccountQuota(corrupt)).toEqual({ state: 'unavailable' });
    }
  });
});

describe('parseAccountQuotaStatus', () => {
  test('linked with a live quota parses to linked with values', () => {
    const status = parseAccountQuotaStatus(linkedPayload());
    expect(status).toMatchObject({ link: 'linked', persistence: 'durable' });
    if (status?.link === 'linked') {
      expect(status.quota.state).toBe('live');
      expect(status.quota.balance.availableMicros).toBe(1_250_000);
      expect(status.quota.usage.totalTokens).toBe(1200);
    } else {
      throw new Error('Expected a linked status');
    }
  });

  test('a stale embedded quota stays linked as stale-cached', () => {
    const status = parseAccountQuotaStatus(
      linkedPayload({ quota: { ...liveBody, source: 'cache', stale: true } }),
    );
    expect(status?.link).toBe('linked');
    if (status?.link === 'linked') {
      expect(status.quota.state).toBe('stale-cached');
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
      expect(parseAccountQuotaStatus({ link, persistence: 'ephemeral', action })).toEqual({
        link,
        persistence: 'ephemeral',
        action,
      });
    }
  });

  test('a smuggled transport code never overrides the payload link', () => {
    // Even if the body carried an HTTP status field, the link wins: state
    // comes from the payload, not from any status code.
    const status = parseAccountQuotaStatus({ ...linkedPayload(), status: 401 });
    expect(status?.link).toBe('linked');
    const upstream = parseAccountQuotaStatus({
      link: 'upstream_error',
      persistence: 'durable',
      action: 'retry',
      status: 200,
    });
    expect(upstream?.link).toBe('upstream_error');
  });

  test('malformed envelopes are null, never a fabricated link', () => {
    const corrupts: AccountQuotaPayload[] = [
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
      { link: 'linked', persistence: 'durable', quota: null },
      { link: 'linked', persistence: 'durable', quota: { ...liveBody, balance: null } },
      { link: 'bogus', persistence: 'durable' },
      { link: 'linked', persistence: 'bogus', quota: { ...liveBody } },
    ];
    for (const corrupt of corrupts) {
      expect(parseAccountQuotaStatus(corrupt)).toBeNull();
    }
  });
});

describe('quotaBalanceShares', () => {
  test('splits a balance into available and reserved percents', () => {
    expect(
      quotaBalanceShares({ amountMicros: 2_000_000, reservedMicros: 750_000, availableMicros: 1_250_000, currency: 'USD' }),
    ).toEqual({ availablePercent: 63, usedPercent: 38 });
  });

  test('a zero or negative total has no share to show (value row without a bar)', () => {
    for (const amountMicros of [0, -100]) {
      expect(
        quotaBalanceShares({ amountMicros, reservedMicros: 0, availableMicros: 0, currency: 'USD' }),
      ).toEqual({ availablePercent: null, usedPercent: null });
    }
  });

  test('non-finite inputs are missing shares, never NaN widths', () => {
    for (const balance of [
      { amountMicros: Number.NaN, reservedMicros: 0, availableMicros: 0, currency: 'USD' },
      { amountMicros: 100, reservedMicros: Number.POSITIVE_INFINITY, availableMicros: 0, currency: 'USD' },
      { amountMicros: 100, reservedMicros: 0, availableMicros: Number.NaN, currency: 'USD' },
    ]) {
      expect(quotaBalanceShares(balance)).toEqual({ availablePercent: null, usedPercent: null });
    }
  });

  test('clamps over-reserved balances instead of overflowing the bar', () => {
    expect(
      quotaBalanceShares({ amountMicros: 100, reservedMicros: 250, availableMicros: -150, currency: 'USD' }),
    ).toEqual({ availablePercent: 0, usedPercent: 100 });
  });
});

describe('quotaCostMajor', () => {
  test('converts usage cost micros to major units', () => {
    expect(
      quotaCostMajor({ totalRequests: 42, totalTokens: 1200, totalCostMicros: 300_000, totalPriceMicros: 500_000, currency: 'USD' }),
    ).toBe(0.3);
  });
});

describe('formatQuotaMoney', () => {
  test('formats known currencies with Intl', () => {
    expect(formatQuotaMoney(1_250_000, 'USD')).toContain('1.25');
  });

  test('an unexpected currency code falls back instead of throwing', () => {
    expect(formatQuotaMoney(1_250_000, '!!!')).toBe('1.25 !!!');
  });
});

describe('fetchAccountQuotaStatus', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalFetch = globalThis.fetch;

  const installWindow = (fetchImpl: (input: string) => Promise<Response>) => {
    const requests: string[] = [];
    // SAFETY: fetchAccountQuotaStatus only calls fetch(input, init); Bun's extra
    // `preconnect` member is never read.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
      // The auth-expiry classifier may confirm a 401 with one /auth/session
      // probe; answer it as healthy so the shared store stays untouched.
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

  const json = (status: number, data: AccountQuotaPayload) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  test('reads the status route for the subject', async () => {
    const w = installWindow(async () => json(200, linkedPayload()));
    try {
      const status = await fetchAccountQuotaStatus('auth_user_1', new AbortController().signal);
      expect(status?.link).toBe('linked');
      expect(w.requests.some((entry) => entry.includes('/api/tokenpanel/status'))).toBe(true);
      expect(w.requests.some((entry) => entry.includes('authUserId=auth_user_1'))).toBe(true);
      expect(w.requests.some((entry) => entry.includes('/api/tokenpanel/quota'))).toBe(false);
    } finally {
      w.restore();
    }
  });

  test('a 200 carrying upstream_error is the error state despite the 200', async () => {
    const w = installWindow(async () =>
      json(200, { link: 'upstream_error', persistence: 'durable', action: 'retry' }),
    );
    try {
      expect(await fetchAccountQuotaStatus('auth_user_1', new AbortController().signal)).toEqual({
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
        expect(await fetchAccountQuotaStatus('auth_user_1', new AbortController().signal)).toBeNull();
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
      expect(await fetchAccountQuotaStatus('auth_user_1', new AbortController().signal)).toBeNull();
    } finally {
      failing.restore();
    }
    const malformed = installWindow(async () => json(200, { unexpected: true }));
    try {
      expect(await fetchAccountQuotaStatus('auth_user_1', new AbortController().signal)).toBeNull();
    } finally {
      malformed.restore();
    }
  });

  test('empty subject never reaches the network', async () => {
    const w = installWindow(async () => json(200, linkedPayload()));
    try {
      expect(await fetchAccountQuotaStatus('', new AbortController().signal)).toBeNull();
      expect(w.requests).toHaveLength(0);
    } finally {
      w.restore();
    }
  });
});

describe('useAccountQuota readiness', () => {
  let win: Window;
  let restoreGlobals: () => void;
  let requests: string[];
  let respondWith: (input: string) => Promise<Response>;
  let originalFetch: typeof fetch;

  const json = (status: number, data: AccountQuotaPayload) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const tick = async (ms = 20): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  const seen: Array<AccountQuotaStatus | null> = [];
  let latestRefresh: () => void = () => {};

  const Probe: React.FC<{ subject: string | null; ready: boolean }> = ({ subject, ready }) => {
    const { status, refresh } = useAccountQuota(subject, ready);
    seen.push(status);
    latestRefresh = refresh;
    return null;
  };

  const setup = async (): Promise<{ root: import('react-dom/client').Root; renderProbe: (subject: string | null, ready: boolean) => Promise<void> }> => {
    win = new Window({ url: 'http://localhost' });
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
    restoreGlobals = () => {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    };
    originalFetch = globalThis.fetch;
    requests = [];
    respondWith = async () => json(200, linkedPayload());
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (String(input).includes('/auth/session')) return json(200, { authenticated: true });
      return respondWith(String(input));
    }) as typeof fetch;
    seen.length = 0;
    latestRefresh = () => {};
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderProbe = async (subject: string | null, ready: boolean): Promise<void> => {
      await act(async () => {
        root.render(React.createElement(Probe, { subject, ready }));
        await tick();
      });
    };
    return { root, renderProbe };
  };

  const teardown = async (root: import('react-dom/client').Root): Promise<void> => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    await win.happyDOM.close();
    restoreGlobals();
  };

  test('no fetch while not ready', async () => {
    const { root, renderProbe } = await setup();
    try {
      await renderProbe('auth_user_1', false);
      expect(requests).toHaveLength(0);
      expect(seen.at(-1)).toBeNull();
    } finally {
      await teardown(root);
    }
  });

  test('exactly one fetch when readiness turns true', async () => {
    const { root, renderProbe } = await setup();
    try {
      await renderProbe('auth_user_1', false);
      expect(requests).toHaveLength(0);
      await renderProbe('auth_user_1', true);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain('/api/tokenpanel/status');
      expect(seen.at(-1)?.link).toBe('linked');
    } finally {
      await teardown(root);
    }
  });

  test('one fetch per Refresh', async () => {
    const { root, renderProbe } = await setup();
    try {
      await renderProbe('auth_user_1', true);
      expect(requests).toHaveLength(1);
      await act(async () => {
        latestRefresh();
        await tick();
      });
      expect(requests).toHaveLength(2);
      await act(async () => {
        latestRefresh();
        await tick();
      });
      expect(requests).toHaveLength(3);
    } finally {
      await teardown(root);
    }
  });

  test('Refresh while not ready never fetches', async () => {
    const { root, renderProbe } = await setup();
    try {
      await renderProbe('auth_user_1', false);
      await act(async () => {
        latestRefresh();
        await tick();
      });
      expect(requests).toHaveLength(0);
    } finally {
      await teardown(root);
    }
  });

  test('a 401 while ready keeps no status — never unlinked', async () => {
    const { root, renderProbe } = await setup();
    respondWith = async () => json(401, { error: 'gate_rejected' });
    try {
      await renderProbe('auth_user_1', true);
      expect(requests).toHaveLength(1);
      expect(seen.at(-1)).toBeNull();
    } finally {
      await teardown(root);
    }
  });
});

describe('AccountQuotaSection states', () => {
  let win: Window;
  let restoreGlobals: () => void;
  let originalFetch: typeof fetch;

  const setup = async (): Promise<{
    root: import('react-dom/client').Root;
    renderStatus: (status: AccountQuotaStatus | null) => Promise<HTMLElement>;
  }> => {
    win = new Window({ url: 'http://localhost' });
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
    restoreGlobals = () => {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    };
    originalFetch = globalThis.fetch;
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('@/lib/i18n');
    const { AccountQuotaSection } = await import('./accountQuotaSection');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    // The reference panel is fed by the entitlements body with the status
    // body kept for the account link state: these state tests pair each
    // status with a minimal linked entitlements body (no plan, no metrics,
    // no balance, no portal base), so the status copy under test is what
    // renders.
    const { parseAccountEntitlementsStatus } = await import('./accountEntitlements');
    const minimalEntitlements = parseAccountEntitlementsStatus({
      link: 'linked',
      persistence: 'durable',
      stale: false,
      plan: null,
      subscription: null,
      metrics: [],
      balance: null,
      portalBase: null,
    });
    const renderStatus = async (status: AccountQuotaStatus | null): Promise<HTMLElement> => {
      await act(async () => {
        root.render(
          React.createElement(I18nProvider, null, React.createElement(AccountQuotaSection, {
            status,
            entitlements: minimalEntitlements,
            onRefresh: () => {},
            displayName: 'Ada Lovelace',
          })),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const panel = document.querySelector<HTMLElement>('[data-testid="account-quota"]');
      if (!panel) throw new Error('Expected the quota panel to render');
      return panel;
    };
    return { root, renderStatus };
  };

  const teardown = async (root: import('react-dom/client').Root): Promise<void> => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    await win.happyDOM.close();
    restoreGlobals();
  };

  test('a 200 with upstream_error renders the error copy plus Refresh', async () => {
    const { root, renderStatus } = await setup();
    try {
      const status = parseAccountQuotaStatus({ link: 'upstream_error', persistence: 'durable', action: 'retry' });
      if (!status) throw new Error('Expected an upstream_error status');
      const panel = await renderStatus(status);
      expect(panel.dataset.quotaState).toBe('upstream_error');
      expect(panel.textContent).toContain('Alcore is unreachable');
      expect(panel.querySelector('[data-testid="account-quota-refresh"]')).not.toBeNull();
      expect(panel.textContent).not.toContain('Tokens');
    } finally {
      await teardown(root);
    }
  });

  test('unlinked and expired render the sign-in copy', async () => {
    const { root, renderStatus } = await setup();
    try {
      for (const link of ['unlinked', 'expired'] as const) {
        const status = parseAccountQuotaStatus({ link, persistence: 'durable', action: 'sign_in' });
        if (!status) throw new Error(`Expected a ${link} status`);
        const panel = await renderStatus(status);
        expect(panel.dataset.quotaState).toBe(link);
        expect(panel.textContent).toContain('Sign in again to read quota');
        expect(panel.textContent).not.toContain('Tokens');
      }
    } finally {
      await teardown(root);
    }
  });

  test('ephemeral persistence adds the session-only note', async () => {
    const { root, renderStatus } = await setup();
    try {
      const linked = parseAccountQuotaStatus(linkedPayload({ persistence: 'ephemeral' }));
      if (!linked) throw new Error('Expected a linked status');
      expect((await renderStatus(linked)).textContent).toContain('Signed in for this session only');
      const unlinked = parseAccountQuotaStatus({ link: 'unlinked', persistence: 'ephemeral', action: 'sign_in' });
      if (!unlinked) throw new Error('Expected an unlinked status');
      expect((await renderStatus(unlinked)).textContent).toContain('Signed in for this session only');
      const durable = parseAccountQuotaStatus(linkedPayload({ persistence: 'durable' }));
      if (!durable) throw new Error('Expected a linked status');
      expect((await renderStatus(durable)).textContent).not.toContain('Signed in for this session only');
    } finally {
      await teardown(root);
    }
  });

  test('no status (the 401 gate outcome) renders loading — never unlinked', async () => {
    const { root, renderStatus } = await setup();
    try {
      const panel = await renderStatus(null);
      expect(panel.dataset.quotaState).toBe('loading');
      expect(panel.textContent).not.toContain('Sign in again to read quota');
      expect(panel.textContent).not.toContain('Alcore is unreachable');
    } finally {
      await teardown(root);
    }
  });
});

describe('quota semantics: zero vs missing vs unlimited vs no-limit', () => {
  test('a missing balance never fabricates a currency zero total', () => {
    const missing = parseAccountQuota({ ...liveBody, balance: undefined });
    expect(missing.state).toBe('live');
    if (missing.state === 'live') {
      expect(missing.balance.amountMicros).toBeUndefined();
      expect(missing.balance.availableMicros).toBeUndefined();
      // No total exists, so there is no share and no zero-valued major.
      expect(quotaBalanceShares(missing.balance)).toEqual({ availablePercent: null, usedPercent: null });
      expect(Number.isNaN(quotaAvailableMajor(missing.balance))).toBe(true);
    } else {
      throw new Error('Expected a live quota');
    }
  });

  test('a genuine zero balance is a real zero, distinct from missing data', () => {
    const zero = parseAccountQuota({
      ...liveBody,
      balance: { amountMicros: 0, reservedMicros: 0, availableMicros: 0, currency: 'USD' },
    });
    expect(zero.state).toBe('live');
    if (zero.state === 'live') {
      expect(zero.balance.amountMicros).toBe(0);
      expect(quotaAvailableMajor(zero.balance)).toBe(0);
      // A zero total is not a limit: no share to show.
      expect(quotaBalanceShares(zero.balance)).toEqual({ availablePercent: null, usedPercent: null });
    } else {
      throw new Error('Expected a live quota');
    }
    const missing = parseAccountQuota({ ...liveBody, balance: undefined });
    if (missing.state === 'live' && zero.state === 'live') {
      expect(Number.isNaN(quotaAvailableMajor(missing.balance))).toBe(true);
      expect(Number.isNaN(quotaAvailableMajor(zero.balance))).toBe(false);
    }
  });

  test('smuggled plan, allowance, or unlimited markers never survive the parse', () => {
    const smuggled = {
      ...liveBody,
      plan: 'pro',
      allowance: 999,
      unlimited: true,
      balance: { ...liveBody.balance, plan: 'pro', allowance: 999, unlimited: true },
      usage: { ...liveBody.usage, limit: 999 },
    };
    const status = parseAccountQuotaStatus({ link: 'linked', persistence: 'durable', quota: smuggled });
    expect(status?.link).toBe('linked');
    expect(/unlimited/i.test(JSON.stringify(status))).toBe(false);
    expect(JSON.stringify(status)).not.toContain('allowance');
    if (status?.link === 'linked') {
      expect(status.quota.balance).not.toHaveProperty('plan');
      expect(status.quota.balance).not.toHaveProperty('unlimited');
    } else {
      throw new Error('Expected a linked status');
    }
  });

  test('provider windows live in a different domain and never touch account data', () => {
    const withProviders = linkedPayload({
      providerWindows: { claude: { '5h': { usedPercent: 90 } } },
      planLabel: 'Pro',
    });
    const status = parseAccountQuotaStatus(withProviders);
    expect(status?.link).toBe('linked');
    if (status?.link === 'linked') {
      expect(status.quota.balance.availableMicros).toBe(1_250_000);
      expect(status.quota.usage.totalTokens).toBe(1200);
      expect(JSON.stringify(status.quota)).not.toContain('providerWindows');
    } else {
      throw new Error('Expected a linked status');
    }
  });

  test('money formatting keeps grouping, symbol, and micros units', () => {
    expect(formatQuotaMoney(1_250_000_000, 'USD')).toContain('1,250');
    expect(formatQuotaMoney(300_000, 'USD')).toContain('$');
    expect(formatQuotaMoney(300_000, 'USD')).toContain('0.3');
    expect(quotaCostMajor({ totalCostMicros: 300_000 })).toBe(0.3);
  });
});

describe('useAccountQuota success timestamp', () => {
  let win: Window;
  let restoreGlobals: () => void;
  let requests: string[];
  let respondWith: (input: string) => Promise<Response>;
  let originalFetch: typeof fetch;

  const json = (status: number, data: AccountQuotaPayload) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  const tick = async (ms = 20): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  const seen: Array<AccountQuotaStatus | null> = [];
  const stamps: Array<number | null> = [];
  const busyFlags: boolean[] = [];
  let latestRefresh: () => void = () => {};

  const Probe: React.FC<{ subject: string | null; ready: boolean }> = ({ subject, ready }) => {
    const { status, refresh, lastUpdated, isRefreshing } = useAccountQuota(subject, ready);
    seen.push(status);
    stamps.push(lastUpdated);
    busyFlags.push(isRefreshing);
    latestRefresh = refresh;
    return null;
  };

  const setup = async (): Promise<{ root: import('react-dom/client').Root; renderProbe: (subject: string | null, ready: boolean) => Promise<void> }> => {
    win = new Window({ url: 'http://localhost' });
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
    restoreGlobals = () => {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    };
    originalFetch = globalThis.fetch;
    requests = [];
    respondWith = async () => json(200, linkedPayload());
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (String(input).includes('/auth/session')) return json(200, { authenticated: true });
      return respondWith(String(input));
    }) as typeof fetch;
    seen.length = 0;
    stamps.length = 0;
    busyFlags.length = 0;
    latestRefresh = () => {};
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const renderProbe = async (subject: string | null, ready: boolean): Promise<void> => {
      await act(async () => {
        root.render(React.createElement(Probe, { subject, ready }));
        await tick();
      });
    };
    return { root, renderProbe };
  };

  const teardown = async (root: import('react-dom/client').Root): Promise<void> => {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    await win.happyDOM.close();
    restoreGlobals();
  };

  test('a successful read stamps the time and settles the refresh flag', async () => {
    const { root, renderProbe } = await setup();
    try {
      const before = Date.now();
      await renderProbe('auth_user_1', true);
      expect(seen.at(-1)?.link).toBe('linked');
      const stamp = stamps.at(-1);
      expect(typeof stamp).toBe('number');
      expect((stamp as number) >= before).toBe(true);
      expect(busyFlags.at(-1)).toBe(false);
    } finally {
      await teardown(root);
    }
  });

  test('a failed refresh keeps the previous values and its timestamp', async () => {
    const { root, renderProbe } = await setup();
    try {
      await renderProbe('auth_user_1', true);
      const goodStatus = seen.at(-1);
      const goodStamp = stamps.at(-1);
      expect(goodStatus?.link).toBe('linked');
      expect(typeof goodStamp).toBe('number');
      respondWith = async () => json(401, { error: 'gate_rejected' });
      await act(async () => {
        latestRefresh();
        await tick(50);
      });
      expect(seen.at(-1)).toEqual(goodStatus);
      expect(stamps.at(-1)).toBe(goodStamp);
      expect(busyFlags.at(-1)).toBe(false);
    } finally {
      await teardown(root);
    }
  });
});
