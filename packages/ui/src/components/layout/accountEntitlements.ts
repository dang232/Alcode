import React from 'react';
import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';

// Live TokenPanel entitlements beside the quota status read. The
// entitlements API owns the customer's plan, per-metric usage windows, and
// credit balance; this module only READS its shape over
// `runtimeFetch('/api/tokenpanel/entitlements?authUserId=')` — the identity
// link is the alcore `sub` the session parser already carries (`subject`).
// Surfaces: the same account popover as the quota read (web and desktop
// show it; hosted and Capacitor mobile inherit the shared-UI behavior;
// VS Code hides the account surface entirely, so this hook never runs).
//
// States come exclusively from the entitlements payload's `link` — the
// server maps every upstream outcome to it (NOT_CONFIGURED -> 'unlinked',
// SESSION_EXPIRED or FORBIDDEN -> 'expired', REJECTED/unknown/5xx/429/
// network/malformed -> 'upstream_error', success -> 'linked' with the plan,
// metrics, and balance present; stale:true bodies are still 'linked'). The
// client never infers a link from an HTTP status: a non-200, a network
// failure, or a malformed body is "no status" (null), never
// 'unlinked'/'expired'/'upstream_error'. In particular the /api gate's own
// 401 stays null — it must not render as 'unlinked'.
//
// Plan identity stays fully open upstream (free-text ids and names, never
// enumerated), so `id` and `name` are open strings: rendered verbatim,
// never mapped, never defaulted. A dimension without a rule is
// unconfigured, not unlimited — there is no unlimited marker on this wire,
// so the panel never prints the word.
//
// Reads are readiness-gated: the hook takes an explicit `ready` flag and
// performs no fetch before it is true, so the read cannot fire before the
// /api gate would accept it.

const entitlementPlanSchema = z.object({
  // Open identity: plan ids are Mongo ObjectIds and names are free text.
  // Rendered verbatim — never trimmed, mapped, or defaulted.
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  interval: z.enum(['day', 'week', 'month', 'year']),
  intervalCount: z.number().int().positive().finite(),
  priceMicros: z.number().finite().nonnegative(),
  currency: z.string().min(1).max(16),
  includedTokens: z.number().int().finite().nonnegative(),
});

const entitlementSubscriptionSchema = z.object({
  status: z.string().min(1).max(64),
  currentPeriodEnd: z.string().datetime().nullable(),
});

const entitlementMetricSchema = z.object({
  // Open dimension label carried verbatim; the panel renders a card only
  // for a dimension the payload actually reports. Used/limit ride through
  // untouched — never recomputed, clamped, or defaulted here.
  dimension: z.string().min(1).max(64),
  used: z.number(),
  limit: z.number(),
  windowSeconds: z.number().int().positive().finite(),
  windowStart: z.string().min(1).max(64),
  resetsAt: z.string().min(1).max(64),
});

const entitlementBalanceSchema = z.object({
  amountMicros: z.number(),
  reservedMicros: z.number(),
  availableMicros: z.number(),
  currency: z.string().min(1).max(16),
});

export type AccountEntitlementsPlan = z.infer<typeof entitlementPlanSchema>;
export type AccountEntitlementsSubscription = z.infer<typeof entitlementSubscriptionSchema>;
export type AccountEntitlementsMetric = z.infer<typeof entitlementMetricSchema>;
export type AccountEntitlementsBalance = z.infer<typeof entitlementBalanceSchema>;

// Unvalidated JSON as the entitlements endpoint can answer it. The parsers
// below turn this into the trusted AccountEntitlements contracts (same
// boundary rule as accountSession.ts: network payloads enter only through
// this named type).
export interface AccountEntitlementsPayloadObject {
  [key: string]: AccountEntitlementsPayload;
}

export type AccountEntitlementsPayload =
  | string
  | number
  | boolean
  | null
  | undefined
  | AccountEntitlementsPayload[]
  | AccountEntitlementsPayloadObject;

// Discriminated status matching GET /api/tokenpanel/entitlements?authUserId=<sub>:
// 200 { link, persistence, stale?, plan?, subscription?, metrics?, balance?,
// portalBase?, action? }. Only 'linked' carries the entitlements body (a
// linked body with plan null is the no-subscription case from upstream
// 404); every other link renders without numbers. `portalBase` is the
// Alcore portal root (`{origin}/portal/`, null when the base is unusable)
// the client appends `subscriptions`/`billing`/`usage` to — never guessed.
// Transport failures are null, never a link.
const entitlementsLinkSchema = z.enum(['unlinked', 'linked', 'expired', 'upstream_error']);
const entitlementsPersistenceSchema = z.enum(['durable', 'ephemeral']);
const entitlementsActionSchema = z.enum(['sign_in', 'retry']);

const entitlementsEnvelopeSchema = z.object({
  link: entitlementsLinkSchema,
  persistence: entitlementsPersistenceSchema,
  stale: z.boolean().optional(),
  plan: z.unknown().optional(),
  subscription: z.unknown().optional(),
  metrics: z.unknown().optional(),
  balance: z.unknown().optional(),
  portalBase: z.union([z.string().min(1).max(2048), z.null()]).optional(),
  action: entitlementsActionSchema.optional(),
});

export type AccountEntitlementsLink = z.infer<typeof entitlementsLinkSchema>;
export type AccountEntitlementsPersistence = z.infer<typeof entitlementsPersistenceSchema>;
export type AccountEntitlementsAction = z.infer<typeof entitlementsActionSchema>;

export type AccountEntitlementsStatus =
  | {
      link: 'linked';
      persistence: AccountEntitlementsPersistence;
      stale: boolean;
      plan: AccountEntitlementsPlan | null;
      subscription: AccountEntitlementsSubscription | null;
      metrics: AccountEntitlementsMetric[];
      balance: AccountEntitlementsBalance | null;
      portalBase: string | null;
      action?: AccountEntitlementsAction;
    }
  | {
      link: 'unlinked' | 'expired' | 'upstream_error';
      persistence: AccountEntitlementsPersistence;
      action?: AccountEntitlementsAction;
    };

const parseEntitlementsPlan = (payload: unknown): AccountEntitlementsPlan | null => {
  if (payload === null || payload === undefined) return null;
  const parsed = entitlementPlanSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

const parseEntitlementsSubscription = (payload: unknown): AccountEntitlementsSubscription | null => {
  if (payload === null || payload === undefined) return null;
  const parsed = entitlementSubscriptionSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

const parseEntitlementsBalance = (payload: unknown): AccountEntitlementsBalance | null => {
  if (payload === null || payload === undefined) return null;
  const parsed = entitlementBalanceSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

/**
 * Trusts only the payload's `link`: every non-linked link passes through
 * verbatim, and a linked body resolves its plan (null stays the
 * no-subscription case, a well-formed object passes through, anything else
 * degrades the plan to null while the metrics and balance still render),
 * its subscription and balance (malformed degrades to null), and its
 * metrics (malformed degrades to []). A missing portalBase reads as null
 * (no usable base, so no CTAs). Anything with an unparseable envelope is
 * null.
 */
export const parseAccountEntitlementsStatus = (
  payload: AccountEntitlementsPayload,
): AccountEntitlementsStatus | null => {
  const parsed = entitlementsEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (parsed.data.link !== 'linked') {
    return {
      link: parsed.data.link,
      persistence: parsed.data.persistence,
      action: parsed.data.action,
    };
  }
  // A linked body missing any of the four entitlements leaves is malformed
  // (the server always answers the full shape): degrading it to an empty
  // success would masquerade a broken read as an authoritative one.
  const body = parsed.data as Record<string, unknown>;
  if (!('plan' in body) || !('subscription' in body) || !('metrics' in body) || !('balance' in body)) {
    return null;
  }
  const stale = parsed.data.stale ?? false;
  const plan = parseEntitlementsPlan(parsed.data.plan ?? null);
  const subscription = parseEntitlementsSubscription(parsed.data.subscription ?? null);
  const balance = parseEntitlementsBalance(parsed.data.balance ?? null);
  const metricsParsed = z.array(entitlementMetricSchema).safeParse(parsed.data.metrics ?? []);
  const metrics = metricsParsed.success ? metricsParsed.data : [];
  const portalBase = parsed.data.portalBase ?? null;
  return {
    link: 'linked',
    persistence: parsed.data.persistence,
    stale,
    plan,
    subscription,
    metrics,
    balance,
    portalBase,
    action: parsed.data.action,
  };
};

/**
 * Status read for one identity. The body alone decides the result: it is
 * parsed as an entitlements envelope whatever the transport outcome was, so
 * the /api gate's 401/403, a 5xx, or a network failure all land on null
 * through the same parser — no branch anywhere reads an HTTP status.
 */
export const fetchAccountEntitlementsStatus = async (
  authUserId: string,
  signal: AbortSignal,
): Promise<AccountEntitlementsStatus | null> => {
  if (authUserId === '') return null;
  let payload: AccountEntitlementsPayload;
  try {
    const response = await runtimeFetch(
      `/api/tokenpanel/entitlements?authUserId=${encodeURIComponent(authUserId)}`,
      { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal },
    );
    payload = await response.json().catch(() => null);
  } catch {
    return null;
  }
  return parseAccountEntitlementsStatus(payload);
};

/**
 * Share of one metric window as a 0–100 percent for the card progress bar.
 * Computed only from the two server numbers with a finite limit above zero;
 * anything else (missing, non-finite, or non-positive limit) is null — no
 * denominator, no bar, and no percent.
 */
export const entitlementMetricPercent = (metric: AccountEntitlementsMetric): number | null => {
  const { used, limit } = metric;
  if (
    typeof used !== 'number' ||
    typeof limit !== 'number' ||
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    limit <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
};

interface AccountEntitlementsStatusRead {
  entitlements: AccountEntitlementsStatus | null;
  refresh: () => void;
  /** Wall-clock time of the last successful entitlements read; null until one lands. Never advances on a failed refresh. */
  lastUpdated: number | null;
  /** True while an entitlements read is in flight (initial or manual). */
  isRefreshing: boolean;
}

/**
 * Live entitlements status for the signed-in identity. Fetches only while
 * `ready` is true (no fetch on mount or manual refresh before readiness),
 * fetches on mount/subject change once ready, and re-fetches on manual
 * refresh. Returns the status (null while the first read is in flight,
 * while not ready, or when the last read carried no status) plus a
 * `refresh` for panel-open and manual refreshes — a failed refresh keeps
 * the last-known linked body and marks it stale instead of flashing a
 * loader over the last-known numbers, and an upstream_error with a
 * previously linked body does the same. Responses are guarded by request
 * sequence: an out-of-order (stale) response never overwrites a newer one.
 */
export const useAccountEntitlements = (
  authUserId: string | null,
  ready: boolean,
): AccountEntitlementsStatusRead => {
  const [entitlements, setEntitlements] = React.useState<AccountEntitlementsStatus | null>(null);
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

  // A failed read (null) or an upstream_error over a previously linked
  // body keeps the last-known numbers and names them stale.
  const settleNext = React.useCallback((next: AccountEntitlementsStatus | null) => {
    if (next === null) {
      if (mountedRef.current) {
        setEntitlements((previous) =>
          previous !== null && previous.link === 'linked' ? { ...previous, stale: true } : previous,
        );
      }
      return;
    }
    if (next.link === 'upstream_error') {
      if (mountedRef.current) {
        setEntitlements((previous) => {
          if (previous !== null && previous.link === 'linked') {
            return { ...previous, stale: true };
          }
          return next;
        });
        setLastUpdated(Date.now());
      }
      return;
    }
    if (mountedRef.current) {
      setEntitlements(next);
      setLastUpdated(Date.now());
    }
  }, []);

  const refresh = React.useCallback(() => {
    if (!ready || authUserId === null || authUserId === '') return;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    const controller = new AbortController();
    if (mountedRef.current) setIsRefreshing(true);
    void fetchAccountEntitlementsStatus(authUserId, controller.signal)
      .then((next) => {
        // A stale (out-of-order) response never overwrites a newer one.
        if (sequence !== sequenceRef.current) return;
        settleNext(next);
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current && sequence === sequenceRef.current) setIsRefreshing(false);
      });
  }, [authUserId, ready, settleNext]);

  React.useEffect(() => {
    if (!ready || authUserId === null || authUserId === '') {
      setEntitlements(null);
      return;
    }
    let settled = false;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    const controller = new AbortController();
    setEntitlements(null);
    if (mountedRef.current) setIsRefreshing(true);
    void fetchAccountEntitlementsStatus(authUserId, controller.signal)
      .then((next) => {
        if (!settled && next !== null && sequence === sequenceRef.current) {
          settleNext(next);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!settled && mountedRef.current && sequence === sequenceRef.current) setIsRefreshing(false);
      });
    return () => {
      settled = true;
      controller.abort();
    };
  }, [authUserId, ready, settleNext]);

  return { entitlements, refresh, lastUpdated, isRefreshing };
};
