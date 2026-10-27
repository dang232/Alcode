import React from 'react';
import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

// Live TokenPanel quota beside the tier badge (task 35). The TokenPanel
// status API owns usage/balance/link state; this module only READS its shape
// over `runtimeFetch('/api/tokenpanel/status?authUserId=')` — the identity
// link is the alcore `sub` the session parser already carries (`subject`).
// Surfaces: web and desktop show the quota; hosted and Capacitor mobile
// inherit the same shared-UI behavior; VS Code hides the account surface
// entirely (AccountProfile returns null there, so this hook never runs).
//
// States come exclusively from the status payload's `link` — the server maps
// every upstream outcome to it (NOT_CONFIGURED -> 'unlinked', SESSION_EXPIRED
// or FORBIDDEN -> 'expired', REJECTED/unknown/5xx/429/network/malformed ->
// 'upstream_error', success -> 'linked' with quota present; stale:true
// bodies are still 'linked'). The client never infers a link from an HTTP
// status: a non-200, a network failure, or a malformed body is "no status"
// (null), never 'unlinked'/'expired'/'upstream_error'. In particular the
// /api gate's own 401 stays null — it must not render as 'unlinked'.
//
// Reads are readiness-gated: the hook takes an explicit `ready` flag and
// performs no fetch — not even the periodic one — while it is false, so the
// read cannot fire before the /api gate would accept it.

// Balance and usage fields are individually optional: the status payload may
// report only part of the quota (a missing section or counter), and the
// panel omits a row whose field is absent instead of zero-filling it. A
// present-but-wrong-typed field still fails the parse, so malformed bodies
// stay 'unavailable' instead of rendering fabricated numbers.
const quotaBalanceSchema = z.object({
  amountMicros: z.number().optional(),
  reservedMicros: z.number().optional(),
  availableMicros: z.number().optional(),
  currency: z.string().min(1).max(8).optional(),
});

const quotaUsageSchema = z.object({
  totalRequests: z.number().optional(),
  totalTokens: z.number().optional(),
  totalCostMicros: z.number().optional(),
  totalPriceMicros: z.number().optional(),
  currency: z.string().min(1).max(8).optional(),
});

const quotaPayloadSchema = z.object({
  authUserId: z.string().min(1).max(128),
  customerId: z.string().min(1).max(64),
  balance: quotaBalanceSchema.optional(),
  usage: quotaUsageSchema.optional(),
  source: z.union([z.literal('live'), z.literal('cache')]),
  stale: z.boolean(),
});

export type AccountQuotaBalance = z.infer<typeof quotaBalanceSchema>;
export type AccountQuotaUsage = z.infer<typeof quotaUsageSchema>;

// Unvalidated JSON as the status endpoint can answer it. The parsers below
// turn this into the trusted AccountQuota contracts (same boundary rule as
// accountSession.ts: network payloads enter only through this named type).
export interface AccountQuotaPayloadObject {
  [key: string]: AccountQuotaPayload;
}

export type AccountQuotaPayload =
  | string
  | number
  | boolean
  | null
  | undefined
  | AccountQuotaPayload[]
  | AccountQuotaPayloadObject;

export type AccountQuota =
  | { state: 'live'; balance: AccountQuotaBalance; usage: AccountQuotaUsage }
  | { state: 'stale-cached'; balance: AccountQuotaBalance; usage: AccountQuotaUsage }
  | { state: 'unavailable' };

export const parseAccountQuota = (payload: unknown): AccountQuota => {
  const parsed = quotaPayloadSchema.safeParse(payload);
  if (!parsed.success) return { state: 'unavailable' };
  // An omitted section parses to an empty read: the panel omits every row
  // whose field is absent instead of zero-filling it.
  const { balance = {}, usage = {}, stale } = parsed.data;
  if (stale) return { state: 'stale-cached', balance, usage };
  return { state: 'live', balance, usage };
};

// Discriminated status matching GET /api/tokenpanel/status?authUserId=<sub>:
// 200 { link, persistence, quota?, action? }. Only 'linked' carries quota
// (stale:true bodies are still 'linked'); every other link renders without
// numbers. Transport failures are null, never a link.
const statusLinkSchema = z.enum(['unlinked', 'linked', 'expired', 'upstream_error']);
const statusPersistenceSchema = z.enum(['durable', 'ephemeral']);
const statusActionSchema = z.enum(['sign_in', 'retry']);

const statusEnvelopeSchema = z.object({
  link: statusLinkSchema,
  persistence: statusPersistenceSchema,
  quota: z.unknown().optional(),
  action: statusActionSchema.optional(),
});

export type AccountQuotaLink = z.infer<typeof statusLinkSchema>;
export type AccountQuotaPersistence = z.infer<typeof statusPersistenceSchema>;
export type AccountQuotaAction = z.infer<typeof statusActionSchema>;

export type AccountQuotaStatus =
  | {
      link: 'linked';
      persistence: AccountQuotaPersistence;
      quota: { state: 'live' | 'stale-cached'; balance: AccountQuotaBalance; usage: AccountQuotaUsage };
      action?: AccountQuotaAction;
    }
  | {
      link: 'unlinked' | 'expired' | 'upstream_error';
      persistence: AccountQuotaPersistence;
      action?: AccountQuotaAction;
    };

/**
 * Trusts only the payload's `link`: 'linked' requires a well-formed embedded
 * quota (a malformed one is "no status", never a fabricated quota), and every
 * other link passes through verbatim. Anything unparseable is null.
 */
export const parseAccountQuotaStatus = (payload: AccountQuotaPayload): AccountQuotaStatus | null => {
  const parsed = statusEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (parsed.data.link !== 'linked') {
    return {
      link: parsed.data.link,
      persistence: parsed.data.persistence,
      action: parsed.data.action,
    };
  }
  const embedded = parseAccountQuota(parsed.data.quota);
  if (embedded.state === 'unavailable') return null;
  return {
    link: 'linked',
    persistence: parsed.data.persistence,
    quota: { state: embedded.state, balance: embedded.balance, usage: embedded.usage },
    action: parsed.data.action,
  };
};

/** Micros (10^-6 major) to major units at the display boundary only. */
export const quotaAvailableMajor = (balance: AccountQuotaBalance): number =>
  (balance.availableMicros ?? Number.NaN) / 1_000_000;

/** Usage cost micros to major units at the display boundary only. */
export const quotaCostMajor = (usage: AccountQuotaUsage): number =>
  (usage.totalCostMicros ?? Number.NaN) / 1_000_000;

/**
 * Balance shares as 0–100 percents for the progress-bar rows. The only
 * percent the TokenPanel quota read API can support: no plan windows,
 * limits, or reset times exist server-side, so usage totals (tokens,
 * requests, cost) render as value rows without a bar. Nulls when there is
 * no positive total to share (a zero-amount balance shows its value
 * without a bar, like the usage panel's balance-only windows).
 */
export interface QuotaBalanceShare {
  availablePercent: number | null;
  usedPercent: number | null;
}

export const quotaBalanceShares = (balance: AccountQuotaBalance): QuotaBalanceShare => {
  const { amountMicros, availableMicros, reservedMicros } = balance;
  if (
    typeof amountMicros !== 'number' ||
    typeof availableMicros !== 'number' ||
    typeof reservedMicros !== 'number' ||
    !Number.isFinite(amountMicros) ||
    !Number.isFinite(availableMicros) ||
    !Number.isFinite(reservedMicros) ||
    amountMicros <= 0
  ) {
    return { availablePercent: null, usedPercent: null };
  }
  const toPercent = (micros: number): number =>
    Math.max(0, Math.min(100, Math.round((micros / amountMicros) * 100)));
  return { availablePercent: toPercent(availableMicros), usedPercent: toPercent(reservedMicros) };
};

/**
 * Currency formatting that never throws on an unexpected currency code.
 * The quota schema bounds the code's length, not its ISO validity, and a
 * panel must never blank-crash on it — so an unknown code falls back to a
 * plain major-units rendering instead of the Intl throw.
 */
export const formatQuotaMoney = (micros: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(micros / 1_000_000);
  } catch {
    return `${(micros / 1_000_000).toFixed(2)} ${currency}`;
  }
};

const QUOTA_REFRESH_MS = 3 * 60 * 1000;

/**
 * Status read for one identity. The body alone decides the result: it is
 * parsed as a status envelope whatever the transport outcome was, so the
 * /api gate's 401/403, a 5xx, or a network failure all land on null through
 * the same parser — no branch anywhere reads an HTTP status.
 */
export const fetchAccountQuotaStatus = async (
  authUserId: string,
  signal: AbortSignal,
): Promise<AccountQuotaStatus | null> => {
  if (authUserId === '') return null;
  let payload: AccountQuotaPayload;
  try {
    const response = await runtimeFetch(
      `/api/tokenpanel/status?authUserId=${encodeURIComponent(authUserId)}`,
      { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, signal },
    );
    payload = await response.json().catch(() => null);
  } catch {
    return null;
  }
  return parseAccountQuotaStatus(payload);
};

/**
 * Live quota status for the signed-in identity. Fetches only while `ready`
 * is true (no fetch on mount, on the 3-minute timer, or on manual refresh
 * before readiness), fetches on mount/subject change once ready, refreshes
 * every 3 minutes while ready, and re-fetches on runtime endpoint switches.
 * Returns the status (null while the first read is in flight, while not
 * ready, or when the last read carried no status) plus a `refresh` for
 * panel-open and manual refreshes — the refresh silently replaces the value
 * when a status lands and keeps the last-known one when it does not, so
 * opening the panel never flashes a loader over the last-known numbers.
 */
interface AccountQuotaStatusRead {
  status: AccountQuotaStatus | null;
  refresh: () => void;
  /** Wall-clock time of the last successful status read; null until one lands. Never advances on a failed refresh. */
  lastUpdated: number | null;
  /** True while a quota read is in flight (initial, periodic, or manual). */
  isRefreshing: boolean;
  /**
   * True when the most recent read came back with nothing usable. Without it a
   * failed read is indistinguishable from one still in flight, and the panel
   * stays on its loading label forever instead of saying the read failed.
   */
  failed: boolean;
}

export const useAccountQuota = (authUserId: string | null, ready: boolean): AccountQuotaStatusRead => {
  const [status, setStatus] = React.useState<AccountQuotaStatus | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const refresh = React.useCallback(() => {
    if (!ready || authUserId === null || authUserId === '') return;
    const controller = new AbortController();
    if (mountedRef.current) setIsRefreshing(true);
    void fetchAccountQuotaStatus(authUserId, controller.signal)
      .then((next) => {
        // A failed refresh is null and must neither replace the last-known
        // values nor advance the success timestamp.
        if (next === null) return;
        if (mountedRef.current) {
          setStatus(next);
          setLastUpdated(Date.now());
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mountedRef.current) setIsRefreshing(false);
      });
  }, [authUserId, ready]);
  React.useEffect(() => {
    if (!ready || authUserId === null || authUserId === '') {
      setStatus(null);
      return;
    }
    let settled = false;
    const controller = new AbortController();
    setStatus(null);
    setFailed(false);
    if (mountedRef.current) setIsRefreshing(true);
    void fetchAccountQuotaStatus(authUserId, controller.signal)
      .then((next) => {
        if (settled) return;
        if (next !== null) {
          setStatus(next);
          setLastUpdated(Date.now());
        } else if (mountedRef.current) {
          // A read that answers nothing is a failure the panel must be able to
          // name; keeping status null alone reads exactly like "still loading".
          setFailed(true);
        }
      })
      .catch(() => {
        if (!settled && mountedRef.current) setFailed(true);
      })
      .finally(() => {
        if (!settled && mountedRef.current) setIsRefreshing(false);
      });
    const timer = window.setInterval(() => {
      const periodic = new AbortController();
      void fetchAccountQuotaStatus(authUserId, periodic.signal)
        .then((next) => {
          if (!settled && next !== null) {
            setStatus(next);
            setLastUpdated(Date.now());
          }
        })
        .catch(() => {});
    }, QUOTA_REFRESH_MS);
    const unsubscribe = subscribeRuntimeEndpointChanged(() => {
      if (settled) return;
      const retry = new AbortController();
      void fetchAccountQuotaStatus(authUserId, retry.signal)
        .then((next) => {
          if (!settled && next !== null) {
            setStatus(next);
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
  return { status, refresh, lastUpdated, isRefreshing, failed };
};
