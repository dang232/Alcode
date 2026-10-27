import React from 'react';
import { useI18n } from '@/lib/i18n';
import { formatWindowLabel } from '@/lib/quota';
import { UsageProgressBar } from '@/components/sections/usage/UsageProgressBar';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { UsageWindow } from '@/types';

// Provider-limits block inside the account popover. It reads the EXISTING
// useQuotaStore only — no fetch, store, or polling of its own. For each
// configured provider with windows it renders one row per window: the
// window label, a progress bar from usedPercent when it is a finite number,
// and a 'resets …' line from resetAtFormatted/resetAfterFormatted when
// present. Renders nothing when no provider reports windows.

interface ProviderLimitRow {
  key: string;
  providerId: string;
  providerName: string;
  label: string;
  window: UsageWindow;
}

export const AccountProviderLimits: React.FC = () => {
  const { t } = useI18n();
  const results = useQuotaStore((state) => state.results);

  const rows: ProviderLimitRow[] = [];
  for (const result of results) {
    if (!result.configured) continue;
    const windows = result.usage?.windows;
    if (!windows) continue;
    for (const [label, window] of Object.entries(windows)) {
      rows.push({
        key: `${result.providerId}:${label}`,
        providerId: result.providerId,
        providerName: result.providerName,
        label,
        window,
      });
    }
  }
  if (rows.length === 0) return null;

  return (
    <div data-testid="account-provider-limits" className="mt-1.5 border-t border-border pt-1.5">
      <div className="typography-ui-label font-medium text-foreground">{t('header.account.providers.title')}</div>
      <div className="mt-1 flex flex-col gap-1.5">
        {rows.map((row) => {
          const used =
            typeof row.window.usedPercent === 'number' && Number.isFinite(row.window.usedPercent)
              ? row.window.usedPercent
              : null;
          const resetSource = row.window.resetAfterFormatted ?? row.window.resetAtFormatted;
          const resetWhen = typeof resetSource === 'string' && resetSource !== '' ? resetSource : null;
          return (
            <div
              key={row.key}
              data-testid="account-provider-limit-row"
              data-provider={row.providerId}
              data-window={row.label}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="typography-micro min-w-0 truncate text-muted-foreground">
                  {row.providerName} · {formatWindowLabel(row.label)}
                </span>
                {used !== null ? (
                  <span className="typography-micro shrink-0 tabular-nums text-foreground">
                    {t('header.account.providers.used', { percent: Math.round(used) })}
                  </span>
                ) : null}
              </div>
              {used !== null ? (
                <div className="mt-1.5">
                  <UsageProgressBar percent={used} tonePercent={used} className="h-1.5" />
                </div>
              ) : null}
              {resetWhen !== null ? (
                <div className="mt-1 typography-micro text-muted-foreground">
                  {t('header.account.providers.resets', { when: resetWhen })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
