import React from 'react';
import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { formatQuotaMoney } from './accountQuota';

// Live TokenPanel plan beside the quota surface. The TokenPanel plan API
// owns the customer's subscription state; this module only READS its shape
// over `runtimeFetch('/api/tokenpanel/plan?authUserId=')` — the identity
// link is the alcore `sub` the session parser already carries (`subject`).
// Surfaces: the same account popover as the quota read (web and desktop
// show it; hosted and Capacitor mobile inherit the shared-UI behavior;
// VS Code hides the account surface entirely, so this hook never runs).
//
// Plan identity is fully dynamic upstream (SubscriptionPlanDoc: Mongo
// ObjectId ids, free-text names, no fixed plan enum), so the contract
// below treats `id` (1..64) and `name` (1..120) as open strings: there is
// no plan enum, no name mapping, and no fallback to "Free". The billing
// interval IS a fixed upstream union (day|week|month|year) and stays an
// enum; anything outside it is malformed.
//
// States come exclusively from the plan payload's `link` — the server maps
// every upstream outcome to it (NOT_CONFIGURED -> 'unlinked',
// SESSION_EXPIRED or FORBIDDEN -> 'expired', REJECTED/unknown/5xx/429/
// network/malformed -> 'upstream_error', success -> 'linked' with the plan
// body present). The client never infers a link from an HTTP status: a
// non-200, a network failure, or a malformed envelope is "no status"
// (null), never 'unlinked'/'expired'/'upstream_error'. In particular the
// /api gate's own 401 stays null — it must not render as 'unlinked'.
//
// A linked body carries the plan as `plan: <detail> | null`: null is the
// upstream 404 (no active subscription) and renders as "No active plan",
// distinct from unknown. A linked body whose plan fails validation is NOT
// null — it is `detail: { state: 'unavailable' }` so the panel can name
// the unknown instead of spinning on a read that already answered. The
// subscription companion is display-ancillary (the panel never renders
// it), so a malformed subscription degrades to null while a well-formed
// plan still renders; a malformed plan degrades the whole detail.
//
// Reads are readiness-gated: the hook takes an explicit `ready` flag and
// performs no fetch — not even the periodic one — while it is false, so the
// read cannot fire before the /api gate would accept it.

const planIntervalSchema = z.enum(['day', 'week', 'month', 'year']);

// One configured rate-limit rule. `capValue` is always a positive number
// today; `null` is the explicit marker a rule carries when the dimension
// is unlimited, and ONLY null renders as Unlimited — an absent rule (a
// dimension with no entry in `limits`) renders as nothing at all.
const planLimitSchema = z.object({
  dimension: z.string().min(1).max(64),
  windowSeconds: z.number().int().positive().finite(),
  capValue: z.union([z.number().finite().positive(), z.null()]),
  scope: z.string().min(1).max(64).optional(),
});

const planDataSchema = z.object({
  // Open identity: plan ids are Mongo ObjectIds and names are free text.
  // Rendered verbatim — never trimmed, mapped, or defaulted.
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  interval: planIntervalSchema,
  intervalCount: z.number().int().positive().finite(),
  priceMicros: z.number().finite().nonnegative(),
  currency: z.string().min(1).max(8),
  includedTokens: z.number().int().nonnegative().finite().optional(),
  limits: z.array(planLimitSchema).default([]),
  models: z.array(z.string().min(1).max(128)).default([]),
});

const planSubscriptionSchema = z.object({
  status: z.string().min(1).max(64),
  currentPeriodEnd: z.union([z.string().min(1).max(64), z.number().finite()]).nullish(),
});

export type AccountPlanInterval = z.infer<typeof planIntervalSchema>;
export type AccountPlanLimit = z.infer<typeof planLimitSchema>;
export type AccountPlanData = z.infer<typeof planDataSchema>;
export type AccountPlanSubscription = z.infer<typeof planSubscriptionSchema>;

/**
 * Plan detail inside a linked plan status: `ready` carries the validated
 * plan, `none` is the upstream 404 (no active subscription), and
 * `unavailable` is a linked body whose plan failed validation.
 */
export type AccountPlanDetail =
  | { state: 'ready'; plan: AccountPlanData }
  | { state: 'none' }
  | { state: 'unavailable' };

// Unvalidated JSON as the plan endpoint can answer it. The parsers below
// turn this into the trusted AccountPlan contracts (same boundary rule as
// accountSession.ts: network payloads enter only through this named type).
export interface AccountPlanPayloadObject {
  [key: string]: AccountPlanPayload;
}

export type AccountPlanPayload =
  | string
  | number
  | boolean
  | null
  | undefined
  | AccountPlanPayload[]
  | AccountPlanPayloadObject;

// Discriminated status matching GET /api/tokenpanel/plan?authUserId=<sub>:
// 200 { link, persistence, stale?, plan?, subscription?, action? }. Only
// 'linked' carries a plan detail (a linked body with plan null is the
// no-active-subscription case); every other link renders without a plan.
// Transport failures are null, never a link.
const planLinkSchema = z.enum(['unlinked', 'linked', 'expired', 'upstream_error']);
const planPersistenceSchema = z.enum(['durable', 'ephemeral']);
const planActionSchema = z.enum(['sign_in', 'retry']);

const planEnvelopeSchema = z.object({
  link: planLinkSchema,
  persistence: planPersistenceSchema,
  stale: z.boolean().optional(),
  plan: z.unknown().optional(),
  subscription: z.unknown().optional(),
  portalBase: z.union([z.string().min(1).max(2048), z.null()]).optional(),
  action: planActionSchema.optional(),
});

export type AccountPlanLink = z.infer<typeof planLinkSchema>;
export type AccountPlanPersistence = z.infer<typeof planPersistenceSchema>;
export type AccountPlanAction = z.infer<typeof planActionSchema>;

export type AccountPlanStatus =
  | {
      link: 'linked';
      persistence: AccountPlanPersistence;
      stale: boolean;
      detail: AccountPlanDetail;
      subscription: AccountPlanSubscription | null;
      portalBase: string | null;
      action?: AccountPlanAction;
    }
  | {
      link: 'unlinked' | 'expired' | 'upstream_error';
      persistence: AccountPlanPersistence;
      action?: AccountPlanAction;
    };

const parsePlanSubscription = (payload: unknown): AccountPlanSubscription | null => {
  const parsed = planSubscriptionSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

/**
 * Trusts only the payload's `link`: every non-linked link passes through
 * verbatim, and a linked body resolves its plan detail — null stays the
 * no-active-plan case, a well-formed object becomes `ready`, and anything
 * else (including a missing plan) becomes `unavailable`. Anything with an
 * unparseable envelope is null.
 */
export const parseAccountPlanStatus = (payload: AccountPlanPayload): AccountPlanStatus | null => {
  const parsed = planEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (parsed.data.link !== 'linked') {
    return {
      link: parsed.data.link,
      persistence: parsed.data.persistence,
      action: parsed.data.action,
    };
  }
  const stale = parsed.data.stale ?? false;
  const subscription = parsePlanSubscription(parsed.data.subscription);
  const portalBase = parsed.data.portalBase ?? null;
  const rawPlan = parsed.data.plan;
  if (rawPlan === null) {
    return { link: 'linked', persistence: parsed.data.persistence, stale, detail: { state: 'none' }, subscription, portalBase, action: parsed.data.action };
  }
  const plan = planDataSchema.safeParse(rawPlan);
  if (!plan.success) {
    return { link: 'linked', persistence: parsed.data.persistence, stale, detail: { state: 'unavailable' }, subscription, portalBase, action: parsed.data.action };
  }
  return { link: 'linked', persistence: parsed.data.persistence, stale, detail: { state: 'ready', plan: plan.data }, subscription, portalBase, action: parsed.data.action };
};

/**
 * Status read for one identity. The body alone decides the result: it is
 * parsed as a plan envelope whatever the transport outcome was, so the
 * /api gate's 401/403, a 5xx, or a network failure all land on null through
 * the same parser — no branch anywhere reads an HTTP status.
 */
export const fetchAccountPlanStatus = async (
  authUserId: string,
  signal: AbortSignal,
): Promise<AccountPlanStatus | null> => {
  if (authUserId === '') return null;
  let payload: AccountPlanPayload;
  try {
    const response = await runtimeFetch(
      `/api/tokenpanel/plan?authUserId=${encodeURIComponent(authUserId)}`,
      { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal },
    );
    payload = await response.json().catch(() => null);
  } catch {
    return null;
  }
  return parseAccountPlanStatus(payload);
};

export type PlanWindowUnit = 'minute' | 'hour' | 'day' | 'week' | 'seconds';

/**
 * Humanizes a validated rate-limit window (positive integer seconds) to
 * the largest whole unit: 300 -> 5 minutes, 3600 -> 1 hour, 86400 ->
 * 1 day, 604800 -> 1 week, 2592000 -> 30 days, 90 -> 90 seconds.
 * Callers pass schema-validated windows only.
 */
export const planWindowUnit = (windowSeconds: number): { unit: PlanWindowUnit; count: number } => {
  const WEEK_SECONDS = 604800;
  const DAY_SECONDS = 86400;
  const HOUR_SECONDS = 3600;
  const MINUTE_SECONDS = 60;
  if (windowSeconds % WEEK_SECONDS === 0) return { unit: 'week', count: windowSeconds / WEEK_SECONDS };
  if (windowSeconds % DAY_SECONDS === 0) return { unit: 'day', count: windowSeconds / DAY_SECONDS };
  if (windowSeconds % HOUR_SECONDS === 0) return { unit: 'hour', count: windowSeconds / HOUR_SECONDS };
  if (windowSeconds % MINUTE_SECONDS === 0) return { unit: 'minute', count: windowSeconds / MINUTE_SECONDS };
  return { unit: 'seconds', count: windowSeconds };
};

/**
 * Formats a limit cap for display, by dimension: tokens, requests, and any
 * other count dimension render as grouped counts; spend_micros renders as
 * money in the plan currency. Returns null for the explicit unlimited
 * marker (capValue === null) so the caller renders Unlimited itself —
 * null is the ONLY path to that copy.
 */
export const formatPlanCap = (limit: AccountPlanLimit, currency: string): string | null => {
  if (limit.capValue === null) return null;
  if (limit.dimension === 'spend_micros') return formatQuotaMoney(limit.capValue, currency);
  return new Intl.NumberFormat(undefined).format(limit.capValue);
};

const PLAN_REFRESH_MS = 3 * 60 * 1000;

/**
 * Live plan status for the signed-in identity. Fetches only while `ready`
 * is true (no fetch on mount, on the 3-minute timer, or on manual refresh
 * before readiness), fetches on mount/subject change once ready, refreshes
 * every 3 minutes while ready, and re-fetches on runtime endpoint switches.
 * Returns the status (null while the first read is in flight, while not
 * ready, or when the last read carried no status) plus a `refresh` for
 * panel-open and manual refreshes — the refresh silently replaces the value
 * when a status lands and keeps the last-known one when it does not, so
 * opening the panel never flashes a loader over the last-known plan.
 * Responses are guarded by request sequence: an out-of-order (stale)
 * response never overwrites a newer one.
 */
interface AccountPlanStatusRead {
  plan: AccountPlanStatus | null;
  refresh: () => void;
  /** Wall-clock time of the last successful plan read; null until one lands. Never advances on a failed refresh. */
  lastUpdated: number | null;
  /** True while a plan read is in flight (initial or manual). */
  isRefreshing: boolean;
}

export const useAccountPlan = (authUserId: string | null, ready: boolean): AccountPlanStatusRead => {
  const [plan, setPlan] = React.useState<AccountPlanStatus | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const mountedRef = React.useRef(true);
  const sequenceRef = React.useRef(0);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const refresh = React.useCallback(() => {
    if (!ready || authUserId === null || authUserId === '') return;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    const controller = new AbortController();
    if (mountedRef.current) setIsRefreshing(true);
    void fetchAccountPlanStatus(authUserId, controller.signal)
      .then((next) => {
        // A failed refresh is null and must neither replace the last-known
        // values nor advance the success timestamp; a stale (out-of-order)
        // response must never overwrite a newer one.
        if (next === null || sequence !== sequenceRef.current) return;
        if (mountedRef.current) {
          setPlan(next);
          setLastUpdated(Date.now());
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current && sequence === sequenceRef.current) setIsRefreshing(false);
      });
  }, [authUserId, ready]);
  React.useEffect(() => {
    if (!ready || authUserId === null || authUserId === '') {
      setPlan(null);
      return;
    }
    let settled = false;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    const controller = new AbortController();
    setPlan(null);
    if (mountedRef.current) setIsRefreshing(true);
    void fetchAccountPlanStatus(authUserId, controller.signal)
      .then((next) => {
        if (!settled && next !== null && sequence === sequenceRef.current) {
          setPlan(next);
          setLastUpdated(Date.now());
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!settled && mountedRef.current && sequence === sequenceRef.current) setIsRefreshing(false);
      });
    const timer = window.setInterval(() => {
      sequenceRef.current += 1;
      const periodicSequence = sequenceRef.current;
      const periodic = new AbortController();
      void fetchAccountPlanStatus(authUserId, periodic.signal)
        .then((next) => {
          if (!settled && next !== null && periodicSequence === sequenceRef.current) {
            setPlan(next);
            setLastUpdated(Date.now());
          }
        })
        .catch(() => {});
    }, PLAN_REFRESH_MS);
    const unsubscribe = subscribeRuntimeEndpointChanged(() => {
      if (settled) return;
      sequenceRef.current += 1;
      const retrySequence = sequenceRef.current;
      const retry = new AbortController();
      void fetchAccountPlanStatus(authUserId, retry.signal)
        .then((next) => {
          if (!settled && next !== null && retrySequence === sequenceRef.current) {
            setPlan(next);
            setLastUpdated(Date.now());
          }
        })
        .catch(() => {});
    });
    return () => {
      settled = true;
      controller.abort();
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [authUserId, ready]);
  return { plan, refresh, lastUpdated, isRefreshing };
};
