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
import { EngineUsageSection } from './EngineUsageSection';
import { useUIStore } from '@/stores/useUIStore';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { selectProvidersForDirectory, useConfigStore } from '@/stores/useConfigStore';
import { loadIntegrationCatalog, peekIntegrationCatalog, type IntegrationCatalog } from '@/lib/opencode/integration-catalog';
import { getProviderCardStatus, readProviderApiKeySetting, type ProviderCardStatus } from '@/components/sections/providers/providerAuth';

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
  const state = !status.available
    ? (status.builtin ? 'builtIn' : 'notInstalled')
    : !status.compatible ? 'needsUpdate' : 'ready';
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
        {state === 'builtIn' && status.entry === null ? null : (
          <SettingsFieldRow label={t('settings.engine.status.entry')}>
            <span className="min-w-0 truncate">{status.entry ?? t('settings.engine.status.notConfigured')}</span>
          </SettingsFieldRow>
        )}
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
        {state === 'builtIn' ? (
          <p className={SETTINGS_HELPER_CLASS}>{t('settings.engine.status.builtInHint')}</p>
        ) : null}
        {status.message !== null && state !== 'notInstalled' && state !== 'builtIn' ? (
          <p className={SETTINGS_HELPER_CLASS}>{status.message}</p>
        ) : null}
      </div>
    </SettingsSection>
  );
};

const RoutingStatusPill: React.FC<{ status: ProviderCardStatus }> = ({ status }) => {
  const { t } = useI18n();
  let label: string;
  switch (status.kind) {
    case 'reauthNeeded': label = t('settings.providers.card.status.reauthNeeded'); break;
    case 'accounts': label = t('settings.providers.card.status.accounts', { count: status.count }); break;
    case 'connected': label = t('settings.providers.card.status.connected'); break;
    case 'environment': label = t('settings.providers.card.status.environment'); break;
    case 'signInNeeded': label = t('settings.providers.card.status.signInNeeded'); break;
  }
  const tone = status.kind === 'signInNeeded' || status.kind === 'reauthNeeded'
    ? 'warning'
    : status.kind === 'environment'
      ? 'neutral'
      : 'success';
  return <SettingsCardPill tone={tone}>{label}</SettingsCardPill>;
};

// Live provider routing: every provider OpenCode reports for this project
// with its models and sign-in state — nothing hardcoded. Choosing a
// default engine model is a later step: it needs a persisted setting plus
// bridge wiring, and a selector that changes nothing would lie.
const RoutingSection: React.FC = () => {
  const { t } = useI18n();
  const setSettingsPage = useUIStore((state) => state.setSettingsPage);
  const directory = useSettingsDirectory();
  const providers = useConfigStore((state) => selectProvidersForDirectory(state, directory));
  const loadProviders = useConfigStore((state) => state.loadProviders);
  const [catalog, setCatalog] = React.useState<IntegrationCatalog | null>(() => peekIntegrationCatalog());
  React.useEffect(() => {
    let cancelled = false;
    void loadProviders({ directory, source: 'settings:engine' });
    if (peekIntegrationCatalog() === null) {
      loadIntegrationCatalog()
        .then((next) => { if (!cancelled) setCatalog(next); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [directory, loadProviders]);
  const integrations = catalog?.integrations ?? null;
  const alphabetical = [...providers].sort((a, b) =>
    (a.name || a.id).localeCompare(b.name || b.id, undefined, { sensitivity: 'base' }));
  return (
    <SettingsSection
      title={t('settings.engine.section.routing')}
      description={t('settings.engine.routing.description')}
      settingsItem="engine.routing"
    >
      {providers.length === 0 ? (
        <p className={SETTINGS_HELPER_CLASS}>{t('settings.engine.routing.empty')}</p>
      ) : (
        <div className={SETTINGS_FIELDS_STACK_CLASS}>
          {alphabetical.map((provider) => {
            const status = getProviderCardStatus({
              integrations,
              providerId: provider.id,
              optionsApiKey: readProviderApiKeySetting(provider),
            });
            return (
              <div key={provider.id}>
                <SettingsFieldRow label={provider.name || provider.id}>
                  {status ? <RoutingStatusPill status={status} /> : null}
                </SettingsFieldRow>
                {provider.models.map((model) => (
                  <div key={model.id} className="typography-meta text-muted-foreground pl-4">
                    {model.name || model.id}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <p className={SETTINGS_HELPER_CLASS}>{t('settings.engine.routing.othersNote')}</p>
      <div>
        <Button variant="outline" size="sm" onClick={() => setSettingsPage('providers')}>
          {t('settings.engine.action.manageProviders')}
        </Button>
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
      <EngineUsageSection />
      <RoutingSection />
    </SettingsPageLayout>
  );
};
