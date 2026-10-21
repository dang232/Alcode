import * as React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import {
  createStartupReadinessTracker,
  decideReadinessBadge,
  parseReadinessSnapshot,
  STARTUP_READINESS_ROUTE,
  type StartupReadinessTrackerState,
} from '@/lib/readiness/startupReadiness';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { cn } from '@/lib/utils';

const toneClass = {
  ok: 'text-[var(--status-success-text)]',
  warn: 'text-[var(--status-warning-text)]',
  bad: 'text-[var(--status-error-text)]',
  idle: 'text-muted-foreground',
} as const;

/**
 * Startup readiness indicator: polls the Alcode-owned
 * `GET /api/startup-readiness` route and renders one status badge for the
 * whole contract (session → plugin → tools → model → child → events).
 *
 * Behaviour notes:
 * - Polling starts on mount and re-runs on `pollIntervalMs`. A generation
 *   ticket inside the tracker drops stale completions, so a slow repair
 *   re-poll can never overwrite newer state, and unmount cancels updates.
 * - The badge reads `ready`, one automatic repair attempt
 *   (`repairing`), then sticky `unavailable` — the repair-once then
 *   unavailable-marking contract the tracker owns. It never blanks on a
 *   dropped poll: the tracker keeps the last authoritative snapshot.
 * - Status colors use `status.*` tokens only (this surface IS status
 *   feedback); the dot is an Icon sprite glyph, never a hardcoded color.
 */
export const StartupReadinessIndicator: React.FC<{
  readonly pollIntervalMs?: number;
  readonly className?: string;
}> = ({ pollIntervalMs = 15_000, className }) => {
  const { t } = useI18n();
  const [state, setState] = React.useState<StartupReadinessTrackerState>(() => ({
    status: 'unknown',
    snapshot: null,
    failures: 0,
    repaired: false,
  }));

  const trackerRef = React.useRef<ReturnType<typeof createStartupReadinessTracker> | null>(null);
  if (trackerRef.current === null) {
    trackerRef.current = createStartupReadinessTracker({
      fetchSnapshot: async (fresh: boolean) => {
        const response = await runtimeFetch(STARTUP_READINESS_ROUTE, {
          query: fresh ? { fresh: '1' } : undefined,
        });
        // The route answers 503 with the last snapshot on probe failure:
        // the body is still authoritative data, so it is parsed by shape,
        // not by status code. Only an undecodable body counts as failure.
        return parseReadinessSnapshot(await response.json().catch(() => null));
      },
    });
  }

  React.useEffect(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    let mounted = true;
    const unsubscribe = tracker.subscribe((next) => {
      if (mounted) setState(next);
    });
    void tracker.refresh().catch(() => {});
    const timer = window.setInterval(() => {
      void tracker.refresh().catch(() => {});
    }, pollIntervalMs);
    return () => {
      mounted = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [pollIntervalMs]);

  const badge = decideReadinessBadge(state);
  const label = t(badge.labelKey);
  const failedStep = state.snapshot && !state.snapshot.ok ? state.snapshot.failedStep : null;

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', toneClass[badge.tone], className)}
      role="status"
      aria-live="polite"
      aria-label={failedStep ? `${label}: ${failedStep}` : label}
      title={failedStep ?? label}
    >
      <Icon name={badge.icon} className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
};
