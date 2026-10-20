import React from 'react';
import { Button } from '@/components/ui/button';
import { getCurrentIntlLocale, useI18n } from '@/lib/i18n';
import {
  SettingsFieldRow,
  SettingsSection,
  SETTINGS_FIELDS_STACK_CLASS,
  SETTINGS_HELPER_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { fetchEngineSessionStats, type EngineSessionSummary } from '@/lib/engine/engineSessionStats';

/**
 * Settings → Engine usage placement: the compact 7-day session summary.
 * Reads through `fetchEngineSessionStats` only — the full report (models,
 * tools, activity) stays on the usage page, so this section can never grow
 * into a second session panel. Every state carries a `data-state` marker
 * (`loading` | `degraded` | `populated`) plus a `data-error` marker on the
 * degraded branch, so tests assert machine values, never copy.
 */

export type EngineUsageLoad =
  | { state: 'loading' }
  | { state: 'unreachable' }
  | { state: 'malformed' }
  | { state: 'populated'; summary: EngineSessionSummary };

export const EngineUsageSectionView: React.FC<{
  load: EngineUsageLoad;
  onRefresh: () => void;
  refreshing: boolean;
}> = ({ load, onRefresh, refreshing }) => {
  const { t } = useI18n();
  // Same formatters as the usage page: locale integers for counts, compact
  // for tokens, USD for cost.
  const formatters = React.useMemo(() => {
    const locale = getCurrentIntlLocale();
    return {
      integer: new Intl.NumberFormat(locale),
      compact: new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
      cost: new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }),
    };
  }, []);

  if (load.state === 'loading') {
    return (
      <SettingsSection
        title={t('usageStats.title')}
        settingsItem="engine.usage"
      >
        <div data-testid="engine-usage" data-state="loading">
          <p className={SETTINGS_HELPER_CLASS}>{t('usageStats.loading')}</p>
        </div>
      </SettingsSection>
    );
  }

  if (load.state === 'unreachable' || load.state === 'malformed') {
    return (
      <SettingsSection
        title={t('usageStats.title')}
        settingsItem="engine.usage"
        headerAction={(
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {t('usageStats.error.retry')}
          </Button>
        )}
      >
        <div data-testid="engine-usage" data-state="degraded" data-error={load.state}>
          <p className={SETTINGS_HELPER_CLASS}>{t('usageStats.error.title')}</p>
        </div>
      </SettingsSection>
    );
  }

  const { summary } = load;
  return (
    <SettingsSection
      title={t('usageStats.title')}
      settingsItem="engine.usage"
      headerAction={(
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          {t('usageStats.error.retry')}
        </Button>
      )}
    >
      <div data-testid="engine-usage" data-state="populated" className={SETTINGS_FIELDS_STACK_CLASS}>
        <SettingsFieldRow label={t('usageStats.metric.sessions')}>
          <span className="tabular-nums" data-sessions={summary.sessions}>
            {formatters.integer.format(summary.sessions)}
          </span>
        </SettingsFieldRow>
        <SettingsFieldRow label={t('usageStats.metric.prompts')}>
          <span className="tabular-nums" data-prompts={summary.prompts}>
            {formatters.integer.format(summary.prompts)}
          </span>
        </SettingsFieldRow>
        <SettingsFieldRow label={t('usageStats.metric.tokens')}>
          <span className="tabular-nums" data-tokens={summary.tokens.total}>
            {formatters.compact.format(summary.tokens.total)}
          </span>
        </SettingsFieldRow>
        <SettingsFieldRow label={t('usageStats.metric.cost')}>
          <span className="tabular-nums" data-cost={summary.cost}>
            {formatters.cost.format(summary.cost)}
          </span>
        </SettingsFieldRow>
      </div>
    </SettingsSection>
  );
};

export const EngineUsageSection: React.FC = () => {
  const [load, setLoad] = React.useState<EngineUsageLoad>({ state: 'loading' });
  const [refreshing, setRefreshing] = React.useState(false);

  const loadStats = React.useCallback(async () => {
    setRefreshing(true);
    const result = await fetchEngineSessionStats();
    setLoad(result.ok ? { state: 'populated', summary: result.summary } : { state: result.error });
    setRefreshing(false);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchEngineSessionStats();
      if (!cancelled) {
        setLoad(result.ok ? { state: 'populated', summary: result.summary } : { state: result.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <EngineUsageSectionView load={load} onRefresh={() => void loadStats()} refreshing={refreshing} />;
};
