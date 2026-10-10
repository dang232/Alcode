import React from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import {
  SettingsFieldRow,
  SettingsSection,
  SETTINGS_FIELDS_STACK_CLASS,
  SETTINGS_HELPER_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { SettingsCardPill } from '@/components/sections/shared/SettingsCards';
import { fetchEngineStatus, type EngineStatus } from '@/lib/engine/engineStatus';
import { useUIStore } from '@/stores/useUIStore';

/**
 * Settings → Engine: the user-installed OmO engine behind background runs,
 * and which models bill the Alcore login. Read-only with actions: the page
 * never writes config, it reports the probe and the binding rules and links
 * out to Providers for keys.
 */

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; status: EngineStatus }
  | { state: 'failed' };

const StatusSection: React.FC<{ load: LoadState; onRefresh: () => void; refreshing: boolean }> = ({
  load,
  onRefresh,
  refreshing,
}) => {
  const { t } = useI18n();

  if (load.state === 'loading') {
    return (
      <SettingsSection
        title={t('settings.engine.section.status')}
        divider={false}
        settingsItem="engine.status"
      >
        <p className={SETTINGS_HELPER_CLASS}>{t('settings.engine.status.loading')}</p>
      </SettingsSection>
    );
  }

  if (load.state === 'failed') {
    return (
      <SettingsSection
        title={t('settings.engine.section.status')}
        divider={false}
        settingsItem="engine.status"
        headerAction={(
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
            {t('settings.engine.action.refresh')}
          </Button>
        )}
      >
        <p className={SETTINGS_HELPER_CLASS}>{t('settings.engine.status.loadFailed')}</p>
      </SettingsSection>
    );
  }

  const { status } = load;
  const state = !status.available ? 'notInstalled' : !status.compatible ? 'needsUpdate' : 'ready';
  return (
    <SettingsSection
      title={t('settings.engine.section.status')}
      divider={false}
      settingsItem="engine.status"
      headerAction={(
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          {t('settings.engine.action.refresh')}
        </Button>
      )}
    >
      <div className={SETTINGS_FIELDS_STACK_CLASS}>
        <SettingsFieldRow label={t('settings.engine.status.state')}>
          <SettingsCardPill tone={state === 'ready' ? 'success' : 'warning'}>
            {t(`settings.engine.state.${state}`)}
          </SettingsCardPill>
        </SettingsFieldRow>
        <SettingsFieldRow label={t('settings.engine.status.entry')}>
          <span className="min-w-0 truncate">{status.entry ?? t('settings.engine.status.notConfigured')}</span>
        </SettingsFieldRow>
        {status.version !== null ? (
          <SettingsFieldRow label={t('settings.engine.status.version')}>
            <span className="tabular-nums">{status.version}</span>
          </SettingsFieldRow>
        ) : null}
        {state === 'needsUpdate' ? (
          <p className={SETTINGS_HELPER_CLASS}>
            {t('settings.engine.status.missingFlags', { flags: status.missingRunFlags.join(', ') })}
          </p>
        ) : null}
        {state === 'notInstalled' ? (
          <p className={SETTINGS_HELPER_CLASS}>{t('settings.engine.status.setupHint')}</p>
        ) : null}
        {status.message !== null && state !== 'notInstalled' ? (
          <p className={SETTINGS_HELPER_CLASS}>{status.message}</p>
        ) : null}
      </div>
    </SettingsSection>
  );
};

const RoutingSection: React.FC<{ status: EngineStatus }> = ({ status }) => {
  const { t } = useI18n();
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  return (
    <SettingsSection
      title={t('settings.engine.section.routing')}
      description={t('settings.engine.routing.description')}
      settingsItem="engine.routing"
    >
      <div className={SETTINGS_FIELDS_STACK_CLASS}>
        {status.binding.alcoreModels.map((modelId) => (
          <SettingsFieldRow key={modelId} label={modelId}>
            <SettingsCardPill tone="success">{t('settings.engine.routing.usesLogin')}</SettingsCardPill>
          </SettingsFieldRow>
        ))}
        <p className={SETTINGS_HELPER_CLASS}>{t('settings.engine.routing.othersNote')}</p>
        <div>
          <Button variant="outline" size="sm" onClick={() => setSettingsPage('providers')}>
            {t('settings.engine.action.manageProviders')}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
};

export const EnginePage: React.FC = () => {
  const { t } = useI18n();
  const [load, setLoad] = React.useState<LoadState>({ state: 'loading' });
  const [refreshing, setRefreshing] = React.useState(false);

  const loadStatus = React.useCallback(async () => {
    setRefreshing(true);
    const result = await fetchEngineStatus();
    setLoad(result.ok ? { state: 'ready', status: result.status } : { state: 'failed' });
    setRefreshing(false);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchEngineStatus();
      if (!cancelled) {
        setLoad(result.ok ? { state: 'ready', status: result.status } : { state: 'failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsPageLayout
      title={t('settings.page.engine.title')}
      description={t('settings.page.engine.description')}
      showSaveStatus={false}
    >
      <StatusSection load={load} onRefresh={() => void loadStatus()} refreshing={refreshing} />
      {load.state === 'ready' ? <RoutingSection status={load.status} /> : null}
    </SettingsPageLayout>
  );
};
