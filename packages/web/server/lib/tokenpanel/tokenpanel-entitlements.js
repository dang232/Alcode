// IDE TokenPanel entitlements proxy.
//
// The account surface reads the customer's per-metric entitlements over
// `GET /api/tokenpanel/entitlements?authUserId=` (beside the quota route
// owned by `tokenpanel-quota.js` and the plan route owned by
// `tokenpanel-plan.js`). This module owns the route: it re-reads the
// customer's own entitlements over
// `GET {base}/admin/ide/entitlements?authUserId=` on every miss and
// answers the exact body shape the entitlements UI is built against.
//
// Caller auth (no service keys anywhere on this path): the proxy presents
// the CALLER's own access Bearer — the keychained pair the desktop login
// captured at loopback completion (see
// `packages/web/server/lib/user-tokens/user-token-store.js`) — as
// `Authorization: Bearer` against `TOKENPANEL_API_URL` (default
// `https://alcore.io.vn`). No TokenPanel management key is read here:
// management keys must never appear in user-facing flows. Self-only is
// enforced before any upstream call (`authUserId` must equal the
// session's Alcore `sub`, resolved through the injected `resolveSubject`);
// a mismatch answers 403 without touching tokens or the network. The
// token is never logged, never placed in a URL, and never sent to the
// browser. Base and pair resolve per request, so rotation applies without
// a restart; tests inject them (plus `serviceFetch`/`now`).
//
// Upstream contract (Alcore `GET /admin/ide/entitlements`):
// 200 `{ authUserId, customerId, plan, subscription, metrics, balance,
// source, stale }`, 404 when there is no subscription. `plan.id` and
// `plan.name` are free text carried verbatim (never enumerated); each
// `metrics` entry carries the window's own `{ dimension, used, limit,
// windowSeconds, windowStart, resetsAt }` untouched; `balance` is the
// credit balance or null.
//
// Mapping (fixed wire — the client validates this shape, never infers):
// `plan` passes id/name/interval/intervalCount/priceMicros/currency/
// includedTokens through (`intervalCount` defaults to 1, `includedTokens`
// to 0 when absent); `subscription` is `{ status, currentPeriodEnd }`
// (ISO string on the wire, null when absent); `metrics` is one entry per
// upstream metric verbatim; `balance` passes through verbatim or null.
//
// Read discipline mirrors the plan proxy: live wins; a transient outage
// (network/timeout/5xx/429) serves the last-known body within one TTL of
// grace (60 s) with `stale:true`; past grace (or a cold cache) answers
// 200 `upstream_error` — never a fabricated empty metrics array or a
// null plan in place of cached data. A 404 (no subscription) is a
// successful read: 200 `linked` with `plan:null`, `subscription:null`,
// `metrics:[]` and `balance:null`, cached like any live body. Upstream
// 401/403 reads as `expired`/`sign_in` directly (no refresh, no stale
// serve, no pair clearing — the quota route owns the refresh dance; this
// path only reuses its token acquisition seam `userTokenStore.get`). A
// caller with no stored pair answers 503 `tokenpanel_not_configured`,
// like plan.
//
// Surfaces (ui-api-decoupling): registered in
// `feature-routes-runtime.js` beside the quota and plan runtimes —
// behind the existing `/api` session gate, before the generic OpenCode
// proxy.
import { z } from 'zod';

import { hasTokenPersistFailed as defaultHasPersistFailed } from '../desktop-auth/desktop-auth.js';

export const TOKENPANEL_DEFAULT_BASE = 'https://alcore.io.vn';
export const TOKENPANEL_ENTITLEMENTS_PATH = '/admin/ide/entitlements';
export const TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS = 60_000;

const TOKENPANEL_SERVICE_TIMEOUT_MS = 15_000;

// Upstream `plan.id` is free text (never enumerated by the client), so
// unlike the plan route's hex `_id` there is no id-shape gate here: any
// non-empty id passes through verbatim. A missing id is a malformed body.
const upstreamPlanSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  interval: z.enum(['day', 'week', 'month', 'year']),
  intervalCount: z.number().int().positive().optional(),
  priceMicros: z.number().nonnegative(),
  currency: z.string().min(1).max(16),
  includedTokens: z.number().int().nonnegative().optional(),
}).passthrough();

// Upstream subscription (only `status`/`currentPeriodEnd` are read;
// anything else passes through unchecked). `currentPeriodEnd` arrives as
// an ISO string on the wire and reads as null when absent.
const upstreamSubscriptionSchema = z.object({
  status: z.string().min(1).max(64),
  currentPeriodEnd: z.unknown().optional(),
}).passthrough();

// Upstream metric entry: every leaf is carried to the wire untouched, so
// the schema only checks the shape — never ranges. Extra keys ride along
// unchecked and are dropped by the mapping, never read.
const upstreamMetricSchema = z.object({
  dimension: z.string().min(1).max(64),
  used: z.number(),
  limit: z.number(),
  windowSeconds: z.number().int().positive(),
  windowStart: z.string().min(1).max(64),
  resetsAt: z.string().min(1).max(64),
}).passthrough();

const upstreamBalanceSchema = z.object({
  amountMicros: z.number(),
  reservedMicros: z.number(),
  availableMicros: z.number(),
  currency: z.string().min(1).max(16),
}).passthrough();

const upstreamBodySchema = z.object({
  // `plan`, `subscription` and `balance` are null when the customer has
  // no subscription row; `metrics` is empty on the 404-shaped 200.
  // `authUserId`, `customerId`, `source` and `stale` ride along unchecked
  // and are never mapped to the wire.
  plan: upstreamPlanSchema.nullable(),
  subscription: upstreamSubscriptionSchema.nullable(),
  metrics: z.array(upstreamMetricSchema),
  balance: upstreamBalanceSchema.nullable(),
}).passthrough();

// The exact client wire this route answers (UI-built contract — do not
// widen: the client validates `plan.id`/`plan.name` verbatim and reads
// every metric leaf untouched, never against an enum).
const metricSchema = z.object({
  dimension: z.string().min(1).max(64),
  used: z.number(),
  limit: z.number(),
  windowSeconds: z.number().int().positive(),
  windowStart: z.string().min(1).max(64),
  resetsAt: z.string().min(1).max(64),
});

const entitlementPlanSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  interval: z.enum(['day', 'week', 'month', 'year']),
  intervalCount: z.number().int().positive(),
  priceMicros: z.number().nonnegative(),
  currency: z.string().min(1).max(16),
  includedTokens: z.number().int().nonnegative(),
});

const entitlementSubscriptionSchema = z.object({
  status: z.string().min(1).max(64),
  currentPeriodEnd: z.string().datetime().nullable(),
});

const entitlementBalanceSchema = z.object({
  amountMicros: z.number(),
  reservedMicros: z.number(),
  availableMicros: z.number(),
  currency: z.string().min(1).max(16),
});

const authUserIdSchema = z.string().min(1).max(128);

export class TokenpanelEntitlementsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TokenpanelEntitlementsError';
    this.code = code;
  }
}

const readEnvBase = () => {
  const raw = (process.env.TOKENPANEL_API_URL ?? '').trim().replace(/\/+$/, '');
  return raw === '' ? TOKENPANEL_DEFAULT_BASE : raw;
};

// `currentPeriodEnd` arrives as an ISO string over JSON; accept
// Date/epoch shapes defensively, normalize to ISO, and read anything else
// as absent (null) — the subscription stays mapped, only the timestamp
// goes null.
const toIsoOrNull = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const at = Date.parse(value);
    return Number.isFinite(at) ? new Date(at).toISOString() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === 'object') {
    const nested = value.$date;
    if (nested !== undefined) return toIsoOrNull(nested);
  }
  return null;
};

export const createTokenpanelEntitlementsRuntime = ({
  serviceBase,
  serviceFetch = (...args) => fetch(...args),
  now = () => Date.now(),
  cacheTtlMs = TOKENPANEL_ENTITLEMENTS_CACHE_TTL_MS,
  // Shared keychain store (production wiring passes the singleton; tests
  // inject a memory fake). Null reads as "no stored pairs". Only `get`
  // (and the `isDurable` probe below) are touched on this path — no
  // refresh, no clearing: upstream 401/403 maps straight to expired.
  userTokenStore = null,
  // Persist-failure signal (production default: the desktop-auth in-module
  // flag — shared module instance with the quota runtime, so no wiring
  // change is needed). Receives the subject only, never tokens; a throwing
  // probe reads as "no failure".
  hasPersistFailed = defaultHasPersistFailed,
  // Resolves the caller's own Alcore sub for the self-only check
  // (production: uiAuthController.resolveRequestAlcoreSub). A throwing or
  // non-string answer reads as unknown identity and fails closed.
  resolveSubject = async () => '',
} = {}) => {
  const cache = new Map();

  const optionalText = z.string().optional();

  const resolveBase = () => {
    const direct = (optionalText.safeParse(serviceBase).data ?? '').trim().replace(/\/+$/, '');
    return direct === '' ? readEnvBase() : direct;
  };

  const sweepCache = (at) => {
    for (const [id, entry] of cache) {
      if (!entry || entry.fetchedAt + 2 * cacheTtlMs <= at) cache.delete(id);
    }
    while (cache.size > 500) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  };

  const readStoredAccess = async (authUserId) => {
    if (userTokenStore === null || userTokenStore === undefined) return '';
    try {
      const pair = await userTokenStore.get(authUserId);
      return z.object({ accessToken: z.string() }).safeParse(pair).data?.accessToken ?? '';
    } catch {
      return '';
    }
  };

  // One live read with the caller's Bearer. 404 is a successful read
  // (no subscription → linked nulls with an empty metrics array).
  // 401/403 reports TOKENENT_EXPIRED (a direct mapping, never a refresh
  // trigger). 429/5xx report TOKENENT_TRANSIENT (stale cache may serve);
  // every other hard-invalid shape is TOKENENT_REJECTED (never stale).
  const readLiveEntitlements = async (base, authUserId, accessToken) => {
    let response;
    try {
      response = await serviceFetch(
        `${base}${TOKENPANEL_ENTITLEMENTS_PATH}?authUserId=${encodeURIComponent(authUserId)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(TOKENPANEL_SERVICE_TIMEOUT_MS),
        },
      );
    } catch {
      throw new TokenpanelEntitlementsError('TOKENENT_TRANSIENT', 'TokenPanel entitlements are unavailable.');
    }
    if (response.status === 404) {
      // A 404 is only "no subscription" when the body says so. A deployment that does not serve this route also
      // answers 404, and folding that into `plan:null, metrics:[]` reports a successful empty read for a route
      // that never ran — the client then hides the plan it can still read from /api/tokenpanel/plan. Distinguish
      // the two by the domain error shape and let anything else surface as an unavailable read.
      let parsedBody = null;
      let bodyText = '';
      try {
        parsedBody = await response.json();
        bodyText = JSON.stringify(parsedBody ?? '');
      } catch {
        try { bodyText = await response.text(); } catch { bodyText = ''; }
      }
      const noSubscription =
        /no active subscription/i.test(bodyText) ||
        (parsedBody !== null && typeof parsedBody === 'object' && parsedBody.resource === 'subscription');
      if (noSubscription) {
        return { link: 'linked', plan: null, subscription: null, metrics: [], balance: null, notFound: true };
      }
      throw new TokenpanelEntitlementsError(
        'TOKENENT_REJECTED',
        'TokenPanel does not serve the entitlements read (404).',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new TokenpanelEntitlementsError('TOKENENT_EXPIRED', 'TokenPanel entitlements session has expired.');
    }
    if (response.status === 429 || response.status >= 500) {
      throw new TokenpanelEntitlementsError('TOKENENT_TRANSIENT', `TokenPanel answered ${response.status}.`);
    }
    if (response.status !== 200) {
      throw new TokenpanelEntitlementsError('TOKENENT_REJECTED', `TokenPanel refused the entitlements read (${response.status}).`);
    }
    const raw = await response.json().catch(() => null);
    const bodyParsed = upstreamBodySchema.safeParse(raw);
    if (!bodyParsed.success) {
      throw new TokenpanelEntitlementsError('TOKENENT_REJECTED', 'TokenPanel answered a malformed entitlements body.');
    }
    const { plan = null, subscription = null, metrics = [], balance = null } = bodyParsed.data;
    const mappedPlan = plan === null || plan === undefined
      ? null
      : {
        id: plan.id,
        name: plan.name,
        interval: plan.interval,
        intervalCount: plan.intervalCount ?? 1,
        priceMicros: plan.priceMicros,
        currency: plan.currency,
        includedTokens: plan.includedTokens ?? 0,
      };
    const mappedSubscription = subscription === null || subscription === undefined
      ? null
      : { status: subscription.status, currentPeriodEnd: toIsoOrNull(subscription.currentPeriodEnd) };
    // Metric leaves ride to the wire untouched — used/limit are never
    // recomputed, clamped, or defaulted here.
    const mappedMetrics = metrics.map((metric) => ({
      dimension: metric.dimension,
      used: metric.used,
      limit: metric.limit,
      windowSeconds: metric.windowSeconds,
      windowStart: metric.windowStart,
      resetsAt: metric.resetsAt,
    }));
    const mappedBalance = balance === null || balance === undefined
      ? null
      : {
        amountMicros: balance.amountMicros,
        reservedMicros: balance.reservedMicros,
        availableMicros: balance.availableMicros,
        currency: balance.currency,
      };
    // The client schema is the contract gate: any constrained-leaf break
    // reads as a malformed upstream body (retry) — never half-mapped
    // numbers or a fabricated empty array.
    const planParsed = mappedPlan === null
      ? { success: true, data: null }
      : entitlementPlanSchema.safeParse(mappedPlan);
    const subscriptionParsed = mappedSubscription === null
      ? { success: true, data: null }
      : entitlementSubscriptionSchema.safeParse(mappedSubscription);
    const metricsParsed = z.array(metricSchema).safeParse(mappedMetrics);
    const balanceParsed = mappedBalance === null
      ? { success: true, data: null }
      : entitlementBalanceSchema.safeParse(mappedBalance);
    if (!planParsed.success || !subscriptionParsed.success || !metricsParsed.success || !balanceParsed.success) {
      throw new TokenpanelEntitlementsError('TOKENENT_REJECTED', 'TokenPanel answered a malformed entitlements body.');
    }
    return {
      link: 'linked',
      stale: false,
      plan: planParsed.data,
      subscription: subscriptionParsed.data,
      metrics: metricsParsed.data,
      balance: balanceParsed.data,
    };
  };

  // Persistence label, same seam as the plan and quota routes. 'ephemeral'
  // when a persist has failed for the current subject, else durable only
  // when the user-token store exposes a passing isDurable() probe; every
  // other shape reads as ephemeral. The label rides along on every link
  // state. Never throws.
  const resolvePersistence = (sub) => {
    try {
      if (typeof hasPersistFailed === 'function' && hasPersistFailed(sub) === true) {
        return 'ephemeral';
      }
    } catch {
      // Fall through to the tier check: a failing probe must never fail
      // a read and never mask a durable store.
    }
    try {
      if (userTokenStore !== null && userTokenStore !== undefined
        && typeof userTokenStore.isDurable === 'function'
        && userTokenStore.isDurable() === true) {
        return 'durable';
      }
    } catch {
      // Fall through to ephemeral: durability must never fail a read.
    }
    return 'ephemeral';
  };

  // Live read with the plan-style fallback discipline. Returns
  // `{ body, stale }` with the documented entitlements wire, or throws
  // TokenpanelEntitlementsError (`TOKENENT_INVALID_REQUEST` /
  // `TOKENENT_FORBIDDEN` / `TOKENENT_NOT_CONFIGURED`); every upstream
  // outcome already resolved to a 200 body below (linked / expired /
  // upstream_error) and never throws.
  const resolveEntitlementsBody = async (authUserId, subject) => {
    const idParsed = authUserIdSchema.safeParse(authUserId);
    if (!idParsed.success) {
      throw new TokenpanelEntitlementsError('TOKENENT_INVALID_REQUEST', 'Invalid authUserId.');
    }
    const id = idParsed.data;
    const caller = z.string().safeParse(subject).data ?? '';
    if (caller === '' || caller !== id) {
      throw new TokenpanelEntitlementsError('TOKENENT_FORBIDDEN', 'Entitlements reads are limited to the signed-in identity.');
    }
    let base;
    try {
      const parsed = new URL(resolveBase());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad protocol');
      base = parsed.origin;
    } catch {
      return {
        body: { link: 'upstream_error', persistence: resolvePersistence(id), action: 'retry' },
        stale: false,
      };
    }
    const at = now();
    sweepCache(at);
    const accessToken = await readStoredAccess(id);
    if (accessToken === '') {
      throw new TokenpanelEntitlementsError('TOKENENT_NOT_CONFIGURED', 'TokenPanel entitlements are not configured on this server.');
    }
    const persistence = resolvePersistence(id);
    // The client builds its three real destinations from this alone
    // (`${portalBase}subscriptions`, `${portalBase}billing`,
    // `${portalBase}usage`) instead of guessing the Alcore host. It rides
    // on every linked body (live, 404-shaped, and stale-from-cache via the
    // spread below); an unusable base never reaches here — it answers
    // upstream_error above, so the client sees no usable base and renders
    // no CTAs.
    const portalBase = `${base}/portal/`;
    try {
      const live = await readLiveEntitlements(base, id, accessToken);
      const { notFound: _notFound, ...liveBody } = live;
      void _notFound;
      const body = live.notFound === true
        ? { link: 'linked', persistence, stale: false, plan: null, subscription: null, metrics: [], balance: null, portalBase }
        : { ...liveBody, persistence, portalBase };
      cache.set(id, { body, fetchedAt: now() });
      return { body, stale: body.stale === true };
    } catch (error) {
      if (error instanceof TokenpanelEntitlementsError && error.code === 'TOKENENT_EXPIRED') {
        return { body: { link: 'expired', persistence, action: 'sign_in' }, stale: false };
      }
      if (error instanceof TokenpanelEntitlementsError && error.code !== 'TOKENENT_TRANSIENT') {
        return { body: { link: 'upstream_error', persistence, action: 'retry' }, stale: false };
      }
      if (!(error instanceof TokenpanelEntitlementsError)) {
        return { body: { link: 'upstream_error', persistence, action: 'retry' }, stale: false };
      }
      const cached = cache.get(id);
      if (cached && at - cached.fetchedAt <= 2 * cacheTtlMs) {
        // The cached body rides along untouched — never an empty metrics
        // array or a null plan in place of cached data.
        return { body: { ...cached.body, stale: true }, stale: true };
      }
      return { body: { link: 'upstream_error', persistence, action: 'retry' }, stale: false };
    }
  };

  const errorOf = (error) => {
    if (error instanceof TokenpanelEntitlementsError) {
      if (error.code === 'TOKENENT_NOT_CONFIGURED') return { status: 503, body: { error: 'tokenpanel_not_configured' } };
      if (error.code === 'TOKENENT_INVALID_REQUEST') return { status: 400, body: { error: 'invalid_request' } };
      if (error.code === 'TOKENENT_FORBIDDEN') return { status: 403, body: { error: 'tokenpanel_forbidden' } };
    }
    return { status: 503, body: { error: 'tokenpanel_unavailable' } };
  };

  const resolveRouteSubject = async (req) => {
    try {
      const resolved = await resolveSubject(req);
      return z.string().safeParse(resolved).data ?? '';
    } catch {
      return '';
    }
  };

  const registerRoutes = (app) => {
    app.get('/api/tokenpanel/entitlements', async (req, res) => {
      const candidate = authUserIdSchema.safeParse(req?.query?.authUserId);
      if (!candidate.success) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      const subject = await resolveRouteSubject(req);
      try {
        const resolved = await resolveEntitlementsBody(candidate.data, subject);
        return res.json(resolved.body);
      } catch (error) {
        const mapped = errorOf(error);
        return res.status(mapped.status).json(mapped.body);
      }
    });
  };

  return { registerRoutes, resolveEntitlementsBody };
};
