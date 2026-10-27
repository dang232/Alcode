// IDE TokenPanel plan proxy.
//
// The account surface reads the customer's dynamic plan over
// `GET /api/tokenpanel/plan?authUserId=` (beside the quota route owned by
// `tokenpanel-quota.js`). This module owns the route: it re-reads the
// customer's own subscription over
// `GET {base}/public/customers/me/subscription` on every miss and answers
// the exact body shape the plan UI is built against.
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
// Upstream contract (Alcore `GET /public/customers/me/subscription`,
// `apps/api/src/routes/public/customers-public.ts:1405` via
// `getActiveSubscription`): 200 `{ subscription: SubscriptionDoc,
// plan: SubscriptionPlanDoc | null }`, 404 when there is no active
// subscription. The IDE user JWT is accepted there through
// `subscriptionIdeUserBypass`
// (`apps/api/src/middleware/subscription-ide-auth.ts`); the stored token
// already carries the `subscription:read` atom — no upstream change.
//
// Mapping (fixed wire — the client validates this shape, never infers):
// `plan.id` is the upstream plan `_id` as a hex string; `plan.name` is
// free text passed through verbatim (plan ids are Mongo ObjectIds and
// names are free text — see `SubscriptionPlanDoc` in
// `packages/db/src/schemas/effect/limit.ts` — so the client must never
// enumerate them). `limits` carries one entry per ACTIVE rateLimit rule
// (`active !== false`; a missing `active` reads as active, a missing
// `scope` reads as `customer` — both match the upstream schema defaults);
// a dimension with no rule simply has no entry — never render Unlimited
// from an absent rule. `subscription.status` comes from
// `SubscriptionDoc.status`; `subscription.currentPeriodEnd` comes from
// `SubscriptionDoc.periodEnd` (ISO string on the wire, null when absent).
//
// Read discipline mirrors the quota proxy: live wins; a transient outage
// (network/timeout/5xx/429) serves the last-known body within one TTL of
// grace (60 s) with `stale:true`; past grace (or a cold cache) answers
// 200 `upstream_error` — never a fabricated empty plan. A 404 (no active
// subscription) is a successful read: 200 `linked` with `plan:null` and
// `subscription:null`, cached like any live body. Upstream 401/403 reads
// as `expired`/`sign_in` directly (no refresh, no stale serve, no pair
// clearing — the quota route owns the refresh dance; this path only
// reuses its token acquisition seam `userTokenStore.get`). A caller with
// no stored pair answers 503 `tokenpanel_not_configured`, like quota.
//
// Surfaces (ui-api-decoupling): registered in
// `feature-routes-runtime.js` beside the quota runtime — behind the
// existing `/api` session gate, before the generic OpenCode proxy.
import { z } from 'zod';

import { hasTokenPersistFailed as defaultHasPersistFailed } from '../desktop-auth/desktop-auth.js';

export const TOKENPANEL_DEFAULT_BASE = 'https://alcore.io.vn';
export const TOKENPANEL_PLAN_PATH = '/public/customers/me/subscription';
export const TOKENPANEL_PLAN_CACHE_TTL_MS = 60_000;

const TOKENPANEL_SERVICE_TIMEOUT_MS = 15_000;

const HEX24 = /^[0-9a-fA-F]{24}$/;

// Upstream rateLimit rule (SubscriptionPlanDoc.rateLimits): extra keys
// (`id`, `scopeTarget`) ride along but are never mapped to the wire.
const upstreamRateLimitSchema = z.object({
  windowSeconds: z.number().int().positive().lte(31_536_000),
  dimension: z.enum(['tokens', 'requests', 'spend_units', 'spend_micros']),
  capValue: z.number().positive(),
  scope: z.enum(['customer', 'plan', 'model', 'apiKey']).optional(),
  active: z.boolean().optional(),
}).passthrough();

// Upstream SubscriptionPlanDoc (only the mapped leaves are constrained;
// display fields — badge, tagline, features, ... — pass validation
// through `.passthrough()` and are dropped by the mapping, never read).
const upstreamPlanSchema = z.object({
  _id: z.unknown(),
  name: z.string().min(1).max(120),
  price: z.object({
    amountMicros: z.number().nonnegative(),
    currency: z.string().min(1).max(16),
  }).passthrough(),
  interval: z.enum(['day', 'week', 'month', 'year']),
  intervalCount: z.number().int().positive().optional(),
  includedTokens: z.number().int().nonnegative().optional(),
  rateLimits: z.array(upstreamRateLimitSchema).optional(),
  allowedModelAliases: z.array(z.string()).optional(),
}).passthrough();

// Upstream SubscriptionDoc (only `status`/`periodEnd` are read; `_id`,
// `planId`, `periodStart`, `canceledAt`, ... pass through unchecked).
const upstreamSubscriptionSchema = z.object({
  status: z.string().min(1).max(64),
  periodEnd: z.unknown().optional(),
}).passthrough();

const upstreamBodySchema = z.object({
  // Both keys are always present on an upstream 200 (plan is null when
  // the customer has no plan row); a missing key is a malformed body.
  subscription: upstreamSubscriptionSchema.nullable(),
  plan: upstreamPlanSchema.nullable(),
}).passthrough();

// The exact client wire this route answers (UI-built contract — do not
// widen: the client validates `plan.id`/`plan.name` verbatim, never
// against an enum).
const planLimitSchema = z.object({
  dimension: z.enum(['tokens', 'requests', 'spend_units', 'spend_micros']),
  windowSeconds: z.number().int().positive(),
  capValue: z.number().positive(),
  scope: z.string().min(1).max(32),
});

const planSchema = z.object({
  id: z.string().regex(HEX24),
  name: z.string().min(1).max(120),
  interval: z.enum(['day', 'week', 'month', 'year']),
  intervalCount: z.number().int().positive(),
  priceMicros: z.number().nonnegative(),
  currency: z.string().min(1).max(16),
  includedTokens: z.number().int().nonnegative(),
  limits: z.array(planLimitSchema),
  models: z.array(z.string()),
});

const subscriptionSchema = z.object({
  status: z.string().min(1).max(64),
  currentPeriodEnd: z.string().datetime().nullable(),
});

const authUserIdSchema = z.string().min(1).max(128);

export class TokenpanelPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TokenpanelPlanError';
    this.code = code;
  }
}

const readEnvBase = () => {
  const raw = (process.env.TOKENPANEL_API_URL ?? '').trim().replace(/\/+$/, '');
  return raw === '' ? TOKENPANEL_DEFAULT_BASE : raw;
};

// Upstream `_id` arrives as a 24-hex string over JSON (Hono `c.json`
// serializes ObjectId via `toJSON`); accept the common BSON-JSON shapes
// defensively and hand back '' when the value is not an id at all — the
// client schema then rejects the body as malformed (retry, never a
// fabricated plan).
const toHexId = (value) => {
  if (typeof value === 'string' && HEX24.test(value)) return value;
  if (value !== null && typeof value === 'object') {
    const oid = value.$oid;
    if (typeof oid === 'string' && HEX24.test(oid)) return oid;
    const hexer = value.toHexString;
    if (typeof hexer === 'function') {
      try {
        const hexed = hexer.call(value);
        if (typeof hexed === 'string' && HEX24.test(hexed)) return hexed;
      } catch {
        // Fall through to '' — a non-id _id is a malformed body.
      }
    }
  }
  return '';
};

// `SubscriptionDoc.periodEnd` arrives as an ISO string over JSON; accept
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

export const createTokenpanelPlanRuntime = ({
  serviceBase,
  serviceFetch = (...args) => fetch(...args),
  now = () => Date.now(),
  cacheTtlMs = TOKENPANEL_PLAN_CACHE_TTL_MS,
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
  // True when the request carries a valid UI session or Alcore token. The
  // subject fallback below only completes such a session; it never
  // authenticates one (a fake or absent seam reads as unauthenticated).
  isAuthenticatedRequest = async () => false,
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
  // (no active subscription → linked nulls). 401/403 reports
  // TOKENPLAN_EXPIRED (a direct mapping, never a refresh trigger).
  // 429/5xx report TOKENPLAN_TRANSIENT (stale cache may serve);
  // every other hard-invalid shape is TOKENPLAN_REJECTED (never stale).
  const readLivePlan = async (base, accessToken) => {
    let response;
    try {
      response = await serviceFetch(
        `${base}${TOKENPANEL_PLAN_PATH}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(TOKENPANEL_SERVICE_TIMEOUT_MS),
        },
      );
    } catch {
      throw new TokenpanelPlanError('TOKENPLAN_TRANSIENT', 'TokenPanel plan is unavailable.');
    }
    if (response.status === 404) {
      // No active subscription: a successful read of "none". The
      // `notFound` marker is stripped before answering so the 404 wire
      // stays exactly { link, persistence, plan:null, subscription:null }.
      return { link: 'linked', plan: null, subscription: null, notFound: true };
    }
    if (response.status === 401 || response.status === 403) {
      throw new TokenpanelPlanError('TOKENPLAN_EXPIRED', 'TokenPanel plan session has expired.');
    }
    if (response.status === 429 || response.status >= 500) {
      throw new TokenpanelPlanError('TOKENPLAN_TRANSIENT', `TokenPanel answered ${response.status}.`);
    }
    if (response.status !== 200) {
      throw new TokenpanelPlanError('TOKENPLAN_REJECTED', `TokenPanel refused the plan read (${response.status}).`);
    }
    const raw = await response.json().catch(() => null);
    const bodyParsed = upstreamBodySchema.safeParse(raw);
    if (!bodyParsed.success) {
      throw new TokenpanelPlanError('TOKENPLAN_REJECTED', 'TokenPanel answered a malformed plan body.');
    }
    const { subscription = null, plan = null } = bodyParsed.data;
    const mappedSubscription = subscription === null || subscription === undefined
      ? null
      : { status: subscription.status, currentPeriodEnd: toIsoOrNull(subscription.periodEnd) };
    const mappedPlan = plan === null || plan === undefined
      ? null
      : {
        id: toHexId(plan._id),
        name: plan.name,
        interval: plan.interval,
        intervalCount: plan.intervalCount ?? 1,
        priceMicros: plan.price.amountMicros,
        currency: plan.price.currency,
        includedTokens: plan.includedTokens ?? 0,
        limits: (plan.rateLimits ?? [])
          .filter((rule) => rule.active !== false)
          .map((rule) => ({
            dimension: rule.dimension,
            windowSeconds: rule.windowSeconds,
            capValue: rule.capValue,
            scope: rule.scope ?? 'customer',
          })),
        models: [...(plan.allowedModelAliases ?? [])],
      };
    // The client schema is the contract gate: an id that is not a hex
    // string, a constrained name, or any other contract break reads as a
    // malformed upstream body (retry) — never a half-mapped plan.
    const planParsed = mappedPlan === null
      ? { success: true, data: null }
      : planSchema.safeParse(mappedPlan);
    const subscriptionParsed = mappedSubscription === null
      ? { success: true, data: null }
      : subscriptionSchema.safeParse(mappedSubscription);
    if (!planParsed.success || !subscriptionParsed.success) {
      throw new TokenpanelPlanError('TOKENPLAN_REJECTED', 'TokenPanel answered a malformed plan body.');
    }
    return {
      link: 'linked',
      stale: false,
      plan: planParsed.data,
      subscription: subscriptionParsed.data,
    };
  };

  // Persistence label, same seam as the quota route. 'ephemeral' when a
  // persist has failed for the current subject, else durable only when
  // the user-token store exposes a passing isDurable() probe; every other
  // shape reads as ephemeral. The label rides along on every link state.
  // Never throws.
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

  // Live read with the quota-style fallback discipline. Returns
  // `{ body, stale }` with the documented plan wire, or throws
  // TokenpanelPlanError (`TOKENPLAN_INVALID_REQUEST` /
  // `TOKENPLAN_FORBIDDEN` / `TOKENPLAN_NOT_CONFIGURED`); every upstream
  // outcome already resolved to a 200 body below (linked / expired /
  // upstream_error) and never throws.
  const resolvePlanBody = async (authUserId, subject) => {
    const idParsed = authUserIdSchema.safeParse(authUserId);
    if (!idParsed.success) {
      throw new TokenpanelPlanError('TOKENPLAN_INVALID_REQUEST', 'Invalid authUserId.');
    }
    const id = idParsed.data;
    const caller = z.string().safeParse(subject).data ?? '';
    if (caller === '' || caller !== id) {
      throw new TokenpanelPlanError('TOKENPLAN_FORBIDDEN', 'Plan reads are limited to the signed-in identity.');
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
      throw new TokenpanelPlanError('TOKENPLAN_NOT_CONFIGURED', 'TokenPanel plan is not configured on this server.');
    }
    const persistence = resolvePersistence(id);
    try {
      const live = await readLivePlan(base, accessToken);
      const { notFound: _notFound, ...liveBody } = live;
      void _notFound;
      // The client builds its portal destinations from this alone; the plan read is the one that always answers for a
      // signed-in account, so it carries the base even when the richer entitlements read is unavailable upstream.
      const portalBase = `${base}/portal/`;
      const body = live.notFound === true
        ? { link: 'linked', persistence, plan: null, subscription: null, portalBase }
        : { ...liveBody, persistence, portalBase };
      cache.set(id, { body, fetchedAt: now() });
      return { body, stale: body.stale === true };
    } catch (error) {
      if (error instanceof TokenpanelPlanError && error.code === 'TOKENPLAN_EXPIRED') {
        return { body: { link: 'expired', persistence, action: 'sign_in' }, stale: false };
      }
      if (error instanceof TokenpanelPlanError && error.code !== 'TOKENPLAN_TRANSIENT') {
        return { body: { link: 'upstream_error', persistence, action: 'retry' }, stale: false };
      }
      if (!(error instanceof TokenpanelPlanError)) {
        return { body: { link: 'upstream_error', persistence, action: 'retry' }, stale: false };
      }
      const cached = cache.get(id);
      if (cached && at - cached.fetchedAt <= 2 * cacheTtlMs) {
        return { body: { ...cached.body, stale: true }, stale: true };
      }
      return { body: { link: 'upstream_error', persistence, action: 'retry' }, stale: false };
    }
  };

  const errorOf = (error) => {
    if (error instanceof TokenpanelPlanError) {
      if (error.code === 'TOKENPLAN_NOT_CONFIGURED') return { status: 503, body: { error: 'tokenpanel_not_configured' } };
      if (error.code === 'TOKENPLAN_INVALID_REQUEST') return { status: 400, body: { error: 'invalid_request' } };
      if (error.code === 'TOKENPLAN_FORBIDDEN') return { status: 403, body: { error: 'tokenpanel_forbidden' } };
    }
    return { status: 503, body: { error: 'tokenpanel_unavailable' } };
  };

  const resolveRouteSubject = async (req, requestedAuthUserId) => {
    try {
      const resolved = await resolveSubject(req);
      const parsed = z.string().safeParse(resolved).data ?? '';
      if (parsed !== '') return parsed;
      // A session minted before the identity was bound into the token answers no
      // subject; the plan card then read as forbidden. Accept the requested
      // identity only when this machine holds its credential.
      const requested = z.string().safeParse(requestedAuthUserId).data ?? '';
      if (requested === '' || userTokenStore === null || userTokenStore === undefined) return '';
      // Only an already-authenticated session may be completed this way: the
      // fallback fills a missing subject, it never authenticates a caller.
      if (!(await isAuthenticatedRequest(req))) return '';
      const pair = await userTokenStore.get(requested);
      const accessToken = pair === null || pair === undefined ? '' : z.string().safeParse(pair.accessToken).data ?? '';
      return accessToken === '' ? '' : requested;
    } catch {
      return '';
    }
  };

  const registerRoutes = (app) => {
    app.get('/api/tokenpanel/plan', async (req, res) => {
      const candidate = authUserIdSchema.safeParse(req?.query?.authUserId);
      if (!candidate.success) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      const subject = await resolveRouteSubject(req, candidate.data);
      try {
        const resolved = await resolvePlanBody(candidate.data, subject);
        return res.json(resolved.body);
      } catch (error) {
        const mapped = errorOf(error);
        return res.status(mapped.status).json(mapped.body);
      }
    });
  };

  return { registerRoutes, resolvePlanBody };
};
