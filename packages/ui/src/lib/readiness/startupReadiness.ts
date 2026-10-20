/**
 * Startup readiness indicator model — the UI side of the startup readiness
 * contract (`packages/web/server/lib/opencode/startup-readiness-contract.js`).
 *
 * The Alcode server owns the probes; this module owns how the indicator
 * reads them:
 *
 * - `parseReadinessSnapshot` validates the `GET /api/startup-readiness`
 *   payload at the boundary. It answers a trusted snapshot or `null`, and
 *   `null` exclusively means "the fetch failed or the payload was
 *   malformed" — never an empty success the indicator could clear state
 *   with (sync-state-invariants: failure is not empty).
 * - `createStartupReadinessTracker` polls through an injected fetcher and
 *   owns repair-once then unavailable-marking on the client: the first
 *   failed refresh triggers exactly one automatic fresh re-poll; when that
 *   still fails the indicator marks `unavailable` and stops re-trying until
 *   a later refresh passes, which closes the outage and re-arms repair.
 *   The last authoritative snapshot is preserved across transient failures
 *   so the badge never blanks to unknown on a single dropped poll.
 * - `decideReadinessBadge` maps tracker state to tone, icon, and label key.
 *   Labels reuse established i18n keys only — this change is write-scoped
 *   to new files, so it introduces no dictionary keys (a follow-up allowed
 *   to touch `lib/i18n/messages/*` should add dedicated
 *   `startupReadiness.status.*` keys and switch these over).
 *
 * Transport (ui-api-decoupling): callers fetch the Alcode-owned route with
 * `runtimeFetch('/api/startup-readiness')` — never the official OpenCode
 * SDK, never a hardcoded origin. The route is served by the connected
 * Alcode server on every runtime (web, desktop, VS Code, hosted mobile,
 * Capacitor mobile), so there is no runtime-specific branch here; where no
 * server is reachable the fetch fails and the badge reads `unavailable`.
 */

import { z } from 'zod';

import type { IconName } from '@/components/icon/icons';
import type { I18nKey } from '@/lib/i18n';

export const STARTUP_READINESS_ROUTE = '/api/startup-readiness';

export type StartupReadinessStatus = 'unknown' | 'ready' | 'repairing' | 'unavailable';

export interface StartupReadinessStepResult {
  readonly step: string;
  readonly ok: boolean;
  readonly code: string;
  readonly detail?: unknown;
  readonly durationMs?: number;
}

export interface StartupReadinessSnapshot {
  readonly status: StartupReadinessStatus;
  readonly ok: boolean;
  readonly steps: readonly StartupReadinessStepResult[];
  readonly failedStep: string | null;
  readonly checkedAt: number;
  readonly consecutiveFailures: number;
}

export interface StartupReadinessTrackerState {
  readonly status: StartupReadinessStatus;
  /** Last parseable server snapshot; kept across transient fetch failures. */
  readonly snapshot: StartupReadinessSnapshot | null;
  /** Consecutive client-observed failed refreshes for the current outage. */
  readonly failures: number;
  /** Whether the single repair re-poll already fired for this outage. */
  readonly repaired: boolean;
}

/**
 * One snapshot round trip. The adapter parses the wire body at its own
 * boundary and answers the trusted snapshot or `null`; the tracker only
 * ever sees domain values, never raw JSON.
 */
export type StartupReadinessFetcher = (fresh: boolean) => Promise<StartupReadinessSnapshot | null>;

const readinessStatusSchema = z.enum(['unknown', 'ready', 'repairing', 'unavailable']);

const readinessStepSchema = z.object({
  step: z.string(),
  ok: z.boolean(),
  code: z.string(),
  detail: z.unknown().optional(),
  durationMs: z.number().optional(),
});

// The `GET /api/startup-readiness` body, parsed at this boundary: anything
// the server answers that is not this shape reads as fetch failure
// (`null`), never as trusted state the badge could clear itself with.
const readinessSnapshotSchema = z.object({
  status: readinessStatusSchema,
  ok: z.boolean(),
  steps: z.array(readinessStepSchema),
  failedStep: z.string().nullable(),
  checkedAt: z.number(),
  consecutiveFailures: z.number(),
});

/**
 * Narrows the wire payload into the snapshot contract. Anything else
 * answers `null` so the caller takes the failure path instead of
 * rendering half a contract.
 */
export const parseReadinessSnapshot = (raw: unknown): StartupReadinessSnapshot | null => {
  const parsed = readinessSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    status: parsed.data.status,
    ok: parsed.data.ok,
    steps: parsed.data.steps.map((entry) => ({
      step: entry.step,
      ok: entry.ok,
      code: entry.code,
      detail: entry.detail,
      durationMs: entry.durationMs,
    })),
    failedStep: parsed.data.failedStep,
    checkedAt: parsed.data.checkedAt,
    consecutiveFailures: parsed.data.consecutiveFailures,
  };
};

export interface StartupReadinessBadge {
  readonly tone: 'ok' | 'warn' | 'bad' | 'idle';
  readonly icon: IconName;
  /** Established i18n key (see module doc: no new dictionary keys in this change). */
  readonly labelKey: I18nKey;
}

export const decideReadinessBadge = (state: StartupReadinessTrackerState): StartupReadinessBadge => {
  switch (state.status) {
    case 'ready':
      return { tone: 'ok', icon: 'check', labelKey: 'desktopHostSwitcher.sshPhase.ready' };
    case 'repairing':
      return { tone: 'warn', icon: 'loader', labelKey: 'opencodeCompatibility.reconnecting' };
    case 'unavailable':
      return { tone: 'bad', icon: 'alert', labelKey: 'common.unavailable' };
    default:
      return { tone: 'idle', icon: 'circle', labelKey: 'common.loading' };
  }
};

const initialState = (): StartupReadinessTrackerState => ({
  status: 'unknown',
  snapshot: null,
  failures: 0,
  repaired: false,
});

/**
 * Poll driver for the indicator. `fetchSnapshot(fresh)` performs one
 * `runtimeFetch(STARTUP_READINESS_ROUTE)` round trip and resolves the
 * decoded JSON (or rejects/`null` on transport failure). Stale completions
 * lose to newer refreshes via the generation ticket, so a slow repair
 * re-poll can never overwrite a newer authoritative state.
 */
export const createStartupReadinessTracker = ({
  fetchSnapshot,
}: {
  readonly fetchSnapshot: StartupReadinessFetcher;
}) => {
  let state: StartupReadinessTrackerState = initialState();
  let generation = 0;
  const listeners = new Set<(state: StartupReadinessTrackerState) => void>();

  const publish = (next: StartupReadinessTrackerState): StartupReadinessTrackerState => {
    state = next;
    for (const listener of Array.from(listeners)) {
      try {
        listener(state);
      } catch {
        // A throwing subscriber must not break the tracker or its siblings.
      }
    }
    return state;
  };

  const settleSuccess = (snapshot: StartupReadinessSnapshot): StartupReadinessTrackerState =>
    publish({ status: 'ready', snapshot, failures: 0, repaired: false });

  const settleFailure = (snapshot: StartupReadinessSnapshot | null, failures: number): StartupReadinessTrackerState =>
    publish({
      status: 'unavailable',
      snapshot: snapshot ?? state.snapshot,
      failures,
      repaired: true,
    });

  const attempt = async (ticket: number, fresh: boolean): Promise<StartupReadinessSnapshot | null> => {
    const parsed = await fetchSnapshot(fresh).catch(() => null);
    if (ticket !== generation) return null;
    return parsed;
  };

  const refresh = async (): Promise<StartupReadinessTrackerState> => {
    const ticket = ++generation;
    const parsed = await attempt(ticket, false);
    if (ticket !== generation) return state;
    if (parsed !== null && parsed.ok) return settleSuccess(parsed);

    // First failed refresh of the outage: one automatic fresh re-poll
    // (the repair), then unavailable-marking when it still fails. One
    // refresh call counts exactly one failure, repair re-poll included.
    const failures = state.failures + 1;
    if (!state.repaired) {
      publish({ status: 'repairing', snapshot: parsed ?? state.snapshot, failures, repaired: true });
      const retry = await attempt(ticket, true);
      if (ticket !== generation) return state;
      if (retry !== null && retry.ok) return settleSuccess(retry);
      return settleFailure(retry, failures);
    }
    return settleFailure(parsed, failures);
  };

  const subscribe = (listener: (state: StartupReadinessTrackerState) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getState = (): StartupReadinessTrackerState => state;

  return { refresh, subscribe, getState };
};

export type StartupReadinessTracker = ReturnType<typeof createStartupReadinessTracker>;
