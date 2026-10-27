import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React from 'react';
import { parseAccountQuotaStatus, type AccountQuotaStatus } from './accountQuota';
import { parseAccountEntitlementsStatus, type AccountEntitlementsStatus } from './accountEntitlements';
import { parseAccountPlanStatus, type AccountPlanStatus } from './accountPlan';

// This file installs a DOM onto globalThis so React can render, and leaves it in place like every other happy-dom test
// in this repo: restoring the globals in afterAll raced the component's in-flight work, which then threw
// "window is not defined" whenever a whole-suite run put the machine under load.
// A real URL, not about:blank: modules imported after this point (the OpenCode client through runtime-fetch) resolve
// request URLs against window.location, and an opaque base throws ERR_INVALID_URL before any assertion runs.
const dom = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Event: dom.Event, MouseEvent: dom.MouseEvent });
const { createRoot } = await import('react-dom/client');
const { flushSync } = await import('react-dom');
const { act } = await import('react');
const { AccountQuotaSection } = await import('./accountQuotaSection');
const { AccountProviderLimits } = await import('./accountProviderLimits');
const { I18nProvider } = await import('@/lib/i18n');
const { useQuotaStore } = await import('@/stores/useQuotaStore');

const DAY_MS = 86_400_000;

const linkedStatus = (overrides: Record<string, unknown> = {}): AccountQuotaStatus => ({
  link: 'linked',
  persistence: 'durable',
  quota: { state: 'live', balance: {}, usage: {} },
  ...overrides,
} as AccountQuotaStatus);

const entitlementsOf = (overrides: Record<string, unknown> = {}): AccountEntitlementsStatus => ({
  link: 'linked',
  persistence: 'durable',
  stale: false,
  plan: {
    id: '507f1f77bcf86cd799439011',
    name: 'Studio 2027',
    interval: 'month',
    intervalCount: 1,
    priceMicros: 2_500_000,
    currency: 'USD',
    includedTokens: 250_000,
  },
  subscription: { status: 'active', currentPeriodEnd: '2027-01-01T00:00:00.000Z' },
  metrics: [],
  balance: null,
  portalBase: 'https://alcore.test/portal/',
  ...overrides,
} as AccountEntitlementsStatus);

const tokensMetric = (overrides: Record<string, unknown> = {}) => ({
  dimension: 'tokens',
  used: 62_500,
  limit: 250_000,
  windowSeconds: 2_592_000,
  windowStart: new Date(Date.now() - 25 * DAY_MS).toISOString(),
  resetsAt: new Date(Date.now() + 5 * DAY_MS).toISOString(),
  ...overrides,
});

const requestsMetric = (overrides: Record<string, unknown> = {}) => ({
  dimension: 'requests',
  used: 10_000,
  limit: 50_000,
  windowSeconds: 86_400,
  windowStart: new Date(Date.now() - DAY_MS).toISOString(),
  resetsAt: new Date(Date.now() + DAY_MS).toISOString(),
  ...overrides,
});

const spendMetric = (overrides: Record<string, unknown> = {}) => ({
  dimension: 'spend_micros',
  used: 5_000_000,
  limit: 25_000_000,
  windowSeconds: 2_592_000,
  windowStart: new Date(Date.now() - 25 * DAY_MS).toISOString(),
  resetsAt: new Date(Date.now() + 5 * DAY_MS).toISOString(),
  ...overrides,
});

const fullEntitlements = (): AccountEntitlementsStatus =>
  entitlementsOf({
    metrics: [tokensMetric(), requestsMetric(), spendMetric()],
    balance: { amountMicros: 1_000_000, reservedMicros: 100_000, availableMicros: 900_000, currency: 'USD' },
  });

const containers: HTMLElement[] = [];
const renderSection = (
  status: AccountQuotaStatus | null,
  entitlements?: AccountEntitlementsStatus | null,
  extras: { onRefresh?: () => void; needsSession?: boolean; lastUpdated?: number | null; isRefreshing?: boolean; plan?: AccountPlanStatus | null } = {},
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  flushSync(() => createRoot(container).render(React.createElement(
    I18nProvider,
    null,
    React.createElement(AccountQuotaSection, {
      status,
      entitlements,
      plan: extras.plan ?? undefined,
      onRefresh: extras.onRefresh ?? (() => {}),
      needsSession: extras.needsSession ?? false,
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      lastUpdated: extras.lastUpdated ?? null,
      isRefreshing: extras.isRefreshing ?? false,
    }),
  )));
  return container;
};

// Live TokenPanel payloads captured from the running app. The status read
// owns cumulative usage, the plan read owns the subscription identity, and
// the entitlements route is missing on this deployment (upstream_error).
const liveStatusPayload = {
  link: 'linked',
  persistence: 'durable',
  quota: {
    authUserId: '<redacted>',
    customerId: '<redacted>',
    balance: { amountMicros: 0, reservedMicros: 0, availableMicros: 0, currency: 'VND' },
    usage: { totalRequests: 124, totalTokens: 935966, totalCostMicros: 0, totalPriceMicros: 0, currency: 'VND' },
    source: 'live',
    stale: false,
  },
} as const;

const livePlanPayload = {
  link: 'linked',
  persistence: 'durable',
  stale: false,
  plan: {
    id: '6aa2f7dc66236f136cf984d3',
    name: 'Unlimited Monthly',
    interval: 'month',
    intervalCount: 1,
    priceMicros: 899000000000,
    currency: 'VND',
    includedTokens: 0,
    limits: [],
    models: [],
  },
  subscription: { status: 'active', currentPeriodEnd: '2027-01-05T12:40:05.148Z' },
  portalBase: 'https://alcore.io.vn/portal/',
} as const;

const liveEntitlementsMissing = {
  link: 'upstream_error',
  persistence: 'durable',
  action: 'retry',
} as const;

const mustLinkedStatus = (payload: unknown): AccountQuotaStatus => {
  const parsed = parseAccountQuotaStatus(payload as never);
  if (parsed === null || parsed.link !== 'linked') throw new Error('Expected a linked quota status');
  return parsed;
};

const mustLinkedPlan = (payload: unknown): AccountPlanStatus => {
  const parsed = parseAccountPlanStatus(payload as never);
  if (parsed === null || parsed.link !== 'linked') throw new Error('Expected a linked plan status');
  return parsed;
};

const mustLinkedEntitlements = (payload: unknown): AccountEntitlementsStatus => {
  const parsed = parseAccountEntitlementsStatus(payload as never);
  if (parsed === null || parsed.link !== 'linked') throw new Error('Expected linked entitlements');
  return parsed;
};

const renderProviderBlock = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  flushSync(() => createRoot(container).render(React.createElement(I18nProvider, null, React.createElement(AccountProviderLimits, null))));
  return container;
};

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
  useQuotaStore.setState({ results: [] });
});

test('the header shows the identity with a plan pill and a renews line', () => {
  const container = renderSection(linkedStatus(), fullEntitlements());
  expect(container.querySelector('[data-quota-state]')?.getAttribute('data-quota-state')).toBe('linked');
  expect(container.textContent).toContain('Ada Lovelace');
  expect(container.textContent).toContain('ada@example.com');
  expect(container.querySelector('[data-testid="account-tier"]')?.textContent).toContain('Studio 2027');
  expect(container.textContent).toContain('Renews on');
  expect(container.textContent).toContain('2027');
});

test('the renews line renders only when the subscription reports a period end', () => {
  const withEnd = renderSection(linkedStatus(), fullEntitlements());
  expect(withEnd.textContent).toContain('Renews on');

  const withoutEnd = renderSection(
    linkedStatus(),
    entitlementsOf({ subscription: { status: 'active', currentPeriodEnd: null }, metrics: [], balance: null }),
  );
  expect(withoutEnd.textContent).not.toContain('Renews on');
  expect(withoutEnd.querySelector('[data-testid="account-tier"]')?.textContent).toContain('Studio 2027');
});

test('a plan with tokens, requests, and spend limits renders three cards with the right percentages', () => {
  const container = renderSection(linkedStatus(), fullEntitlements());
  const cards = container.querySelectorAll('[data-testid="account-metric-card"]');
  // Three metric cards plus the balance card.
  expect(cards.length).toBe(4);
  const byDimension = new Map(
    [...cards].map((card) => [card.getAttribute('data-dimension'), card] as const),
  );
  expect(byDimension.get('tokens')?.textContent).toContain('62,500 / 250,000');
  expect(byDimension.get('requests')?.textContent).toContain('10,000 / 50,000');
  expect(byDimension.get('spend_micros')?.textContent).toContain('$5.00 / $25.00');
  const bars = [...container.querySelectorAll('[role="progressbar"]')].map((bar) =>
    bar.getAttribute('aria-valuenow'),
  );
  expect(bars).toEqual(['25', '20', '20']);
  expect(container.textContent).toContain('25% used');
  expect(container.querySelector('[data-testid="account-portal-cta"]')).not.toBeNull();
});

test('the plan banner names the plan with its billing interval and a Manage link', () => {
  const container = renderSection(linkedStatus(), fullEntitlements());
  expect(container.querySelector('[data-testid="account-plan-name"]')?.textContent).toBe('Studio 2027');
  expect(container.textContent).toContain('Billed monthly');
  const manage = container.querySelector('[data-testid="account-portal-cta"][data-destination="subscriptions"]');
  expect(manage?.getAttribute('href')).toBe('https://alcore.test/portal/subscriptions');
});

test('a multi-count interval renders its count', () => {
  const container = renderSection(
    linkedStatus(),
    entitlementsOf({
      plan: {
        id: '507f1f77bcf86cd799439011',
        name: 'Studio 2027',
        interval: 'year',
        intervalCount: 3,
        priceMicros: 2_500_000,
        currency: 'USD',
        includedTokens: 0,
      },
      metrics: [],
      balance: null,
    }),
  );
  expect(container.textContent).toContain('Billed every 3 years');
});

test('a plan with only one rule renders one card', () => {
  const container = renderSection(
    linkedStatus(),
    entitlementsOf({ metrics: [tokensMetric()], balance: null }),
  );
  const cards = container.querySelectorAll('[data-testid="account-metric-card"]');
  expect(cards.length).toBe(1);
  expect(cards[0]?.getAttribute('data-dimension')).toBe('tokens');
  expect(cards[0]?.textContent).toContain('62,500 / 250,000');
  expect(container.textContent).not.toContain('Requests');
  expect(container.textContent).not.toContain('Cost');
  expect(/unlimited/i.test(container.textContent ?? '')).toBe(false);
});

test('a metric without a usable limit renders the used value with no denominator, bar, or percent', () => {
  const container = renderSection(
    linkedStatus(),
    entitlementsOf({ metrics: [tokensMetric({ limit: 0 })], balance: null }),
  );
  const card = container.querySelector('[data-testid="account-metric-card"]');
  expect(card?.textContent).toContain('62,500');
  expect(card?.textContent).not.toContain('/');
  expect(card?.querySelector('[role="progressbar"]')).toBeNull();
  expect(card?.textContent).not.toContain('%');
});

test('plan:null renders no plan pill and no cards but keeps the account state', () => {
  const container = renderSection(
    linkedStatus(),
    entitlementsOf({ plan: null, subscription: null, metrics: [], balance: null }),
  );
  expect(container.querySelector('[data-quota-state]')?.getAttribute('data-quota-state')).toBe('linked');
  expect(container.querySelector('[data-testid="account-tier"]')).toBeNull();
  expect(container.querySelector('[data-testid="account-plan-name"]')).toBeNull();
  expect(container.querySelectorAll('[data-testid="account-metric-card"]').length).toBe(0);
  expect(container.textContent).toContain('Ada Lovelace');
  expect(container.textContent).not.toContain('Renews on');
  expect(/unlimited/i.test(container.textContent ?? '')).toBe(false);
});

test('a stale read keeps the previous numbers and says so', () => {
  const container = renderSection(linkedStatus(), entitlementsOf({
    stale: true,
    metrics: [tokensMetric(), requestsMetric(), spendMetric()],
    balance: { amountMicros: 1_000_000, reservedMicros: 100_000, availableMicros: 900_000, currency: 'USD' },
  }));
  expect(container.querySelectorAll('[data-testid="account-metric-card"]').length).toBe(4);
  expect(container.textContent).toContain('62,500 / 250,000');
  expect(container.textContent).toContain('Stale');
});

test('a zero balance renders the zero, never a limit and never a bar', () => {
  const container = renderSection(
    linkedStatus(),
    entitlementsOf({
      metrics: [],
      balance: { amountMicros: 0, reservedMicros: 0, availableMicros: 0, currency: 'USD' },
    }),
  );
  const card = container.querySelector('[data-testid="account-metric-card"][data-dimension="balance"]');
  expect(card).not.toBeNull();
  expect(card?.textContent).toContain('$0');
  expect(card?.textContent).not.toContain(' of ');
  expect(card?.querySelector('[role="progressbar"]')).toBeNull();
  expect(container.querySelectorAll('[role="progressbar"]').length).toBe(0);
});

test('a missing balance renders no balance card at all', () => {
  const container = renderSection(
    linkedStatus(),
    entitlementsOf({ metrics: [tokensMetric()], balance: null }),
  );
  expect(container.querySelector('[data-testid="account-metric-card"][data-dimension="balance"]')).toBeNull();
  expect(container.querySelectorAll('[data-testid="account-metric-card"]').length).toBe(1);
});

test('the balance card pairs the amount with the plan only when the plan funds it', () => {
  const included = renderSection(linkedStatus(), fullEntitlements());
  expect(
    included.querySelector('[data-testid="account-metric-card"][data-dimension="balance"]')?.textContent,
  ).toContain('250,000 included with Studio 2027');

  const credit = renderSection(
    linkedStatus(),
    entitlementsOf({
      plan: {
        id: '507f1f77bcf86cd799439011',
        name: 'Studio 2027',
        interval: 'month',
        intervalCount: 1,
        priceMicros: 2_500_000,
        currency: 'USD',
        includedTokens: 0,
      },
      metrics: [],
      balance: { amountMicros: 1_000_000, reservedMicros: 100_000, availableMicros: 900_000, currency: 'USD' },
    }),
  );
  expect(
    credit.querySelector('[data-testid="account-metric-card"][data-dimension="balance"]')?.textContent,
  ).toContain('Credit balance on Studio 2027');

  const bare = renderSection(
    linkedStatus(),
    entitlementsOf({
      plan: {
        id: '507f1f77bcf86cd799439011',
        name: 'Studio 2027',
        interval: 'month',
        intervalCount: 1,
        priceMicros: 2_500_000,
        currency: 'USD',
        includedTokens: 0,
      },
      metrics: [],
      balance: { amountMicros: 0, reservedMicros: 0, availableMicros: 0, currency: 'USD' },
    }),
  );
  expect(
    bare.querySelector('[data-testid="account-metric-card"][data-dimension="balance"]')?.textContent,
  ).not.toContain('Studio 2027');
});

test('no payload ever produces the word Unlimited', () => {
  const payloads: Array<AccountEntitlementsStatus | null> = [
    fullEntitlements(),
    entitlementsOf({ plan: null, subscription: null, metrics: [], balance: null }),
    entitlementsOf({
      metrics: [],
      balance: { amountMicros: 0, reservedMicros: 0, availableMicros: 0, currency: 'USD' },
    }),
    entitlementsOf({ metrics: [tokensMetric({ limit: 0 })], balance: null }),
  ];
  for (const entitlements of payloads) {
    const container = renderSection(linkedStatus(), entitlements);
    expect(/unlimited/i.test(container.textContent ?? '')).toBe(false);
  }
});

test('CTAs are absent when portalBase is null', () => {
  const container = renderSection(
    linkedStatus(),
    entitlementsOf({
      metrics: [tokensMetric(), requestsMetric(), spendMetric()],
      balance: { amountMicros: 1_000_000, reservedMicros: 100_000, availableMicros: 900_000, currency: 'USD' },
      portalBase: null,
    }),
  );
  expect(container.querySelectorAll('[data-testid="account-metric-card"]').length).toBe(4);
  expect(container.querySelectorAll('[data-testid="account-portal-cta"]').length).toBe(0);
  expect(container.textContent).not.toContain('Manage');
  expect(container.textContent).not.toContain('Upgrade');
  expect(container.textContent).not.toContain('Plan details');
  expect(container.textContent).not.toContain('Usage history');
});

test('CTAs are present with the exact hrefs when portalBase is set', () => {
  const container = renderSection(linkedStatus(), fullEntitlements());
  const ctas = [...container.querySelectorAll<HTMLAnchorElement>('[data-testid="account-portal-cta"]')];
  expect(ctas.length).toBe(4);
  const hrefs = ctas.map((cta) => cta.getAttribute('href'));
  expect(hrefs).toContain('https://alcore.test/portal/subscriptions');
  expect(hrefs).toContain('https://alcore.test/portal/billing');
  expect(hrefs).toContain('https://alcore.test/portal/usage');
  expect(ctas.every((cta) => (cta.getAttribute('href') ?? '').startsWith('https://alcore.test/portal/'))).toBe(true);
  const byDestination = new Map(ctas.map((cta) => [cta.getAttribute('data-destination'), cta.getAttribute('href')]));
  expect(byDestination.get('billing')).toBe('https://alcore.test/portal/billing');
  expect(byDestination.get('usage')).toBe('https://alcore.test/portal/usage');
  expect(byDestination.get('subscriptions')).toBe('https://alcore.test/portal/subscriptions');
});

test('the resets line follows the widest window', () => {
  const container = renderSection(linkedStatus(), fullEntitlements());
  // Tokens (30-day window, resets in 5 days) beats requests (1-day window).
  expect(container.textContent).toContain('Resets in 5 days');
});

test('each link state renders its own copy', () => {
  for (const link of ['unlinked', 'expired', 'upstream_error'] as const) {
    const container = renderSection({
      link,
      persistence: 'durable',
      action: link === 'upstream_error' ? 'retry' : 'sign_in',
    }, fullEntitlements());
    expect(container.querySelector('[data-quota-state]')?.getAttribute('data-quota-state')).toBe(link);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="account-metric-card"]').length).toBe(0);
  }
  const unlinked = renderSection({ link: 'unlinked', persistence: 'durable', action: 'sign_in' }, fullEntitlements());
  expect(unlinked.textContent).toContain('Sign in again to read quota');
  const upstream = renderSection({ link: 'upstream_error', persistence: 'durable', action: 'retry' }, fullEntitlements());
  expect(upstream.textContent).toContain('Alcore is unreachable');
});

test('an entitlements upstream_error with linked status but no plan names the plan as unavailable', () => {
  let calls = 0;
  const status = mustLinkedStatus(liveStatusPayload);
  const container = renderSection(status, {
    link: 'upstream_error',
    persistence: 'durable',
    action: 'retry',
  }, { onRefresh: () => { calls += 1; } });
  // The status link owns the account state, so a linked status with a
  // missing entitlements body keeps the section and names the missing plan
  // instead of hiding every number behind the upstream copy.
  expect(container.textContent).not.toContain('Alcore is unreachable');
  expect(container.textContent).toContain('Plan unavailable');
  expect(container.querySelectorAll('[data-testid="account-metric-card"]').length).toBe(4);
  const button = container.querySelector('[data-testid="account-quota-refresh"]');
  expect(button).not.toBeNull();
  act(() => {
    button?.dispatchEvent(new Event('click', { bubbles: true }));
  });
  expect(calls).toBe(1);
});

test('loading renders the loading notice with no refresh control', () => {
  const container = renderSection(null);
  expect(container.querySelector('[data-quota-state]')?.getAttribute('data-quota-state')).toBe('loading');
  expect(container.textContent).toContain('Quota…');
  expect(container.querySelector('[data-testid="account-quota-refresh"]')).toBeNull();
});

test('a missing UI session names the action instead of spinning forever', () => {
  const container = renderSection(null, undefined, { needsSession: true });
  expect(container.querySelector('[data-quota-state]')?.getAttribute('data-quota-state')).toBe('unlinked');
  expect(container.textContent).toContain('Sign in again to read quota');
  expect(container.textContent).not.toContain('Quota…');
});

test('the refresh control asks for a fresh read and reports its busy state', () => {
  let calls = 0;
  const idle = renderSection(linkedStatus(), fullEntitlements(), { onRefresh: () => { calls += 1; } });
  const button = idle.querySelector('[data-testid="account-quota-refresh"]');
  expect(button).not.toBeNull();
  expect(button?.getAttribute('aria-busy')).toBe('false');
  act(() => {
    button?.dispatchEvent(new Event('click', { bubbles: true }));
  });
  expect(calls).toBe(1);

  const busy = renderSection(linkedStatus(), fullEntitlements(), { isRefreshing: true });
  const busyButton = busy.querySelector('[data-testid="account-quota-refresh"]');
  expect(busyButton?.getAttribute('aria-busy')).toBe('true');
  expect(busyButton?.querySelector('.animate-spin')).not.toBeNull();
});

test('the last-updated line renders only from a real fetch timestamp', () => {
  const stamp = new Date('2026-03-04T05:06:07Z').getTime();
  const without = renderSection(linkedStatus(), fullEntitlements());
  expect(without.textContent).not.toContain('Updated');
  const withStamp = renderSection(linkedStatus(), fullEntitlements(), { lastUpdated: stamp });
  expect(withStamp.textContent).toContain('Updated');
  expect(withStamp.textContent).toContain('2026');
});

test('provider limits render while the plan is unknown and stay independent of the plan cards', () => {
  useQuotaStore.setState({
    results: [
      {
        providerId: 'claude',
        providerName: 'Claude',
        ok: true,
        configured: true,
        usage: {
          windows: {
            '5h': {
              usedPercent: 42,
              remainingPercent: 58,
              windowSeconds: 18000,
              resetAfterSeconds: 3600,
              resetAt: null,
              resetAtFormatted: null,
              resetAfterFormatted: 'in 1 hour',
            },
          },
        },
        fetchedAt: 1,
      },
    ],
  });
  const account = renderSection(linkedStatus(), entitlementsOf({ plan: null, subscription: null, metrics: [], balance: null }));
  expect(account.querySelector('[data-testid="account-tier"]')).toBeNull();
  expect(account.querySelectorAll('[data-testid="account-metric-card"]').length).toBe(0);
  expect(account.querySelector('[data-testid="account-provider-limits"]')).toBeNull();
  const providers = renderProviderBlock();
  const block = providers.querySelector('[data-testid="account-provider-limits"]');
  expect(block).not.toBeNull();
  expect(block?.textContent).toContain('42% used');
  expect(block?.textContent).not.toContain('Unlimited');
});

test('provider windows never change the entitlements cards', () => {
  useQuotaStore.setState({
    results: [
      {
        providerId: 'claude',
        providerName: 'Claude',
        ok: true,
        configured: true,
        usage: {
          windows: {
            '5h': {
              usedPercent: 90,
              remainingPercent: 10,
              windowSeconds: 18000,
              resetAfterSeconds: 3600,
              resetAt: null,
              resetAtFormatted: null,
              resetAfterFormatted: 'in 1 hour',
            },
          },
        },
        fetchedAt: 1,
      },
    ],
  });
  const account = renderSection(linkedStatus(), fullEntitlements());
  expect(account.querySelectorAll('[data-testid="account-metric-card"]').length).toBe(4);
  expect(account.querySelector('[data-testid="account-plan-name"]')?.textContent).toBe('Studio 2027');
  expect(account.textContent).not.toContain('90% used');
});

test('live deployment without entitlements still renders plan, renewal, balance, and usage with no percents', () => {
  const status = mustLinkedStatus(liveStatusPayload);
  const plan = mustLinkedPlan(livePlanPayload);
  const entitlements = parseAccountEntitlementsStatus(liveEntitlementsMissing as never);
  expect(entitlements?.link).toBe('upstream_error');
  const container = renderSection(status, entitlements, { plan });
  expect(container.querySelector('[data-quota-state]')?.getAttribute('data-quota-state')).toBe('linked');
  // Plan name renders verbatim from the plan read.
  expect(container.querySelector('[data-testid="account-plan-name"]')?.textContent).toBe('Unlimited Monthly');
  expect(container.querySelector('[data-testid="account-tier"]')?.textContent).toContain('Unlimited Monthly');
  expect(container.textContent).toContain('Renews on');
  expect(container.textContent).toContain('2027');
  // Balance and cumulative usage come from the status read.
  const cards = container.querySelectorAll('[data-testid="account-metric-card"]');
  expect(cards.length).toBe(4);
  const byDimension = new Map(
    [...cards].map((card) => [card.getAttribute('data-dimension'), card] as const),
  );
  expect(byDimension.get('tokens')?.textContent).toContain('935,966');
  expect(byDimension.get('requests')?.textContent).toContain('124');
  expect(byDimension.get('balance')?.textContent).toContain('₫0');
  // Used-only cards carry no denominator, bar, or percent, and the section
  // explains the missing limits exactly once.
  expect(container.querySelectorAll('[role="progressbar"]').length).toBe(0);
  expect(container.textContent).not.toContain('%');
  expect(container.textContent).not.toContain('/');
  // The word in the plan NAME is data, never a quota state.
  expect(container.querySelectorAll('[data-testid="account-plan-limit"]').length).toBe(0);
});

test('linked entitlements with metric windows render percentages and retire the used-only cards', () => {
  const status = mustLinkedStatus(liveStatusPayload);
  const plan = mustLinkedPlan(livePlanPayload);
  const entitlements = mustLinkedEntitlements({
    link: 'linked',
    persistence: 'durable',
    stale: false,
    plan: {
      id: '6aa2f7dc66236f136cf984d3',
      name: 'Unlimited Monthly',
      interval: 'month',
      intervalCount: 1,
      priceMicros: 899000000000,
      currency: 'VND',
      includedTokens: 0,
    },
    subscription: { status: 'active', currentPeriodEnd: '2027-01-05T12:40:05.148Z' },
    metrics: [
      { dimension: 'tokens', used: 467983, limit: 935966, windowSeconds: 2592000, windowStart: '2025-12-06T12:40:05.148Z', resetsAt: '2026-01-05T12:40:05.148Z' },
      { dimension: 'requests', used: 62, limit: 124, windowSeconds: 2592000, windowStart: '2025-12-06T12:40:05.148Z', resetsAt: '2026-01-05T12:40:05.148Z' },
      { dimension: 'spend_micros', used: 0, limit: 899000000000, windowSeconds: 2592000, windowStart: '2025-12-06T12:40:05.148Z', resetsAt: '2026-01-05T12:40:05.148Z' },
    ],
    balance: { amountMicros: 0, reservedMicros: 0, availableMicros: 0, currency: 'VND' },
    portalBase: 'https://alcore.io.vn/portal/',
  });
  const container = renderSection(status, entitlements, { plan });
  expect(container.querySelector('[data-testid="account-plan-name"]')?.textContent).toBe('Unlimited Monthly');
  const cards = container.querySelectorAll('[data-testid="account-metric-card"]');
  const byDimension = new Map(
    [...cards].map((card) => [card.getAttribute('data-dimension'), card] as const),
  );
  expect(byDimension.get('tokens')?.textContent).toContain('/');
  expect(byDimension.get('requests')?.textContent).toContain('/');
  expect(container.querySelectorAll('[role="progressbar"]').length).toBeGreaterThan(0);
  expect(container.textContent).toContain('50% used');
  // The missing-limits note belongs to the fallback only.
  expect(container.textContent).not.toContain('no account limit is defined');
});

test('a failing plan read keeps balance and usage and names the plan as unavailable', () => {
  const status = mustLinkedStatus(liveStatusPayload);
  const failingPlan = parseAccountPlanStatus({ link: 'upstream_error', persistence: 'durable', action: 'retry' } as never);
  expect(failingPlan?.link).toBe('upstream_error');
  const entitlements = parseAccountEntitlementsStatus(liveEntitlementsMissing as never);
  const container = renderSection(status, entitlements, { plan: failingPlan });
  expect(container.querySelector('[data-quota-state]')?.getAttribute('data-quota-state')).toBe('linked');
  expect(container.textContent).toContain('Plan unavailable');
  expect(container.querySelector('[data-testid="account-plan-name"]')).toBeNull();
  const cards = container.querySelectorAll('[data-testid="account-metric-card"]');
  expect(cards.length).toBe(4);
  const byDimension = new Map(
    [...cards].map((card) => [card.getAttribute('data-dimension'), card] as const),
  );
  expect(byDimension.get('tokens')?.textContent).toContain('935,966');
  expect(byDimension.get('balance')?.textContent).toContain('₫0');
  expect(container.querySelectorAll('[role="progressbar"]').length).toBe(0);
});

test('the live plan name survives a locale switch without translation', async () => {
  const { useI18nStore } = await import('@/lib/i18n/store');
  const status = mustLinkedStatus(liveStatusPayload);
  const plan = mustLinkedPlan(livePlanPayload);
  const entitlements = parseAccountEntitlementsStatus(liveEntitlementsMissing as never);
  const before = renderSection(status, entitlements, { plan });
  expect(before.querySelector('[data-testid="account-plan-name"]')?.textContent).toBe('Unlimited Monthly');
  const previousLocale = useI18nStore.getState().locale;
  try {
    useI18nStore.getState().setLocale('de');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (useI18nStore.getState().loadingLocale !== 'de') break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const after = renderSection(status, entitlements, { plan });
    // The name is data: it renders byte-identical in every locale and is
    // never passed through a translation lookup.
    expect(after.querySelector('[data-testid="account-plan-name"]')?.textContent).toBe('Unlimited Monthly');
    expect(after.querySelector('[data-testid="account-tier"]')?.textContent).toContain('Unlimited Monthly');
  } finally {
    useI18nStore.getState().setLocale(previousLocale);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (useI18nStore.getState().loadingLocale !== previousLocale) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
});

test('plan limit rows keep their own markers and only a null cap renders Unlimited', () => {
  const status = mustLinkedStatus({
    link: 'linked',
    persistence: 'durable',
    quota: {
      authUserId: 'u',
      customerId: 'c',
      balance: { amountMicros: 0, reservedMicros: 0, availableMicros: 0, currency: 'VND' },
      usage: { totalRequests: 1, totalTokens: 2, totalCostMicros: 0, currency: 'VND' },
      source: 'live',
      stale: false,
    },
  });
  const plan = mustLinkedPlan({
    link: 'linked',
    persistence: 'durable',
    stale: false,
    plan: {
      id: '6aa2f7dc66236f136cf984d3',
      name: 'Unlimited Monthly',
      interval: 'month',
      intervalCount: 1,
      priceMicros: 899000000000,
      currency: 'VND',
      includedTokens: 0,
      limits: [
        { dimension: 'tokens', windowSeconds: 86400, capValue: 50000 },
        { dimension: 'spend_micros', windowSeconds: 2592000, capValue: null },
      ],
      models: [],
    },
    subscription: { status: 'active', currentPeriodEnd: '2027-01-05T12:40:05.148Z' },
    portalBase: 'https://alcore.io.vn/portal/',
  });
  const entitlements = parseAccountEntitlementsStatus(liveEntitlementsMissing as never);
  const container = renderSection(status, entitlements, { plan });
  expect(container.querySelector('[data-testid="account-plan-name"]')?.textContent).toBe('Unlimited Monthly');
  const limits = container.querySelectorAll('[data-testid="account-plan-limit"]');
  expect(limits.length).toBe(2);
  expect(limits[0]?.getAttribute('data-dimension')).toBe('tokens');
  expect(limits[0]?.textContent).toContain('50,000');
  // Only the explicit null marker renders the Unlimited copy; the plan NAME
  // never invents one.
  expect(limits[1]?.textContent).toContain('Unlimited');
  expect(container.textContent).toContain('Unlimited Monthly');
});
