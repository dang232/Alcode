import { OpenCode } from '@opencode/client';
import { registerNotificationEmitRoutes } from '../notifications/emit-route.js';
import { registerHttpResponseDiagnostics } from './core-routes.js';
import { createStartupReadinessRuntime } from './startup-readiness-runtime.js';
import { createStartupReadinessWiring } from './startup-readiness-wiring.js';
import { ALCORE_PROVIDER_ID, createAlcoreProviderRuntime } from '../alcore-provider/alcore-provider.js';
import { createFileKeyIdStore, createPersonalKeyRuntime } from '../alcore-provider/personal-key.js';
import { upsertProviderConfig, removeProviderConfig } from './providers.js';
import { sharedUserTokenStore } from '../user-tokens/user-token-store.js';

export const createBootstrapRuntime = (dependencies) => {
  const {
    createUiAuth,
    registerServerStatusRoutes,
    registerCommonRequestMiddleware,
    registerAuthAndAccessRoutes,
    registerTtsRoutes,
    registerNotificationRoutes,
    registerAlcodeRoutes,
    registerAgentToolRoutes = () => {},
    express,
  } = dependencies;

  const setupBaseRoutes = (app, options) => {
    const {
      process,
      alcodeVersion,
      runtimeName,
      serverStartedAt,
      gracefulShutdown,
      getHealthSnapshot,
      getServerPort,
      getTunnelUrl,
      verboseRequestLogs,
      alcoreSecret,
      alcorePreviousSecret,
      alcoreIssuer,
      tunnelAuthController,
      remoteClientAuthRuntime,
      clientPairingRuntime,
      getRelayPairingCandidate,
      reconcileRelay,
      getPairingTransports,
      getDirectCandidateUrls,
      getServerId,
      getServerLabel,
      readSettingsFromDiskMigrated,
      normalizeTunnelSessionTtlMs,
      sayTTSCapability,
      ensurePushInitialized,
      ensureGlobalWatcherStarted,
      getOrCreateVapidKeys,
      getUiSessionTokenFromRequest,
      writeSettingsToDisk,
      addOrUpdatePushSubscription,
      removePushSubscription,
      addOrUpdateApnsToken,
      removeApnsToken,
      updateUiVisibility,
      clearPendingPushBadge,
      isUiVisible,
      getUiNotificationClients,
      writeSseEvent,
      sessionRuntime,
      setPushInitialized,
      fs,
      os,
      path,
      server,
      __dirname,
      alcodeDataDir,
      modelsDevApiUrl,
      modelsMetadataCacheTtl,
      fetchFreeZenModels,
      getCachedZenModels,
      setAutoAcceptSession,
      agentToolRuntime,
      pluginNotificationEmitter,
      desktopUpdater,
      skipBodyParsing,
      // OpenCode credential provisioning for the Alcore badge flip.
      // Optional (tests + runtimes without a managed OpenCode omit them):
      // without both, the provider block still registers but no OpenCode
      // credential is stored. Read per call — the port and server password
      // both move across an OpenCode restart.
      buildOpenCodeUrl = null,
      getOpenCodeAuthHeaders = null,
      // Managed-vs-external OpenCode (task 55): an external server never
      // sees this process's config write, so the readiness poll would time
      // out by construction — the sync reports `needs_restart` instead.
      // Optional (tests omit it): without it the sync assumes managed.
      isExternalOpenCode = null,
      // Startup readiness contract (§7): production bindings for the
      // local-only probes. All optional: a missing binding fails its probe
      // step with an exact missing-dep message instead of breaking boot.
      omoNativeRuntime = null,
      getSmallModelClient = null,
      listModelInfos = null,
      resetOpenCodeRuntimeProviders = null,
      getMessageStreamHub = null,
    } = options;

    registerHttpResponseDiagnostics(app);

    const uiAuthController = createUiAuth({
      alcoreSecret,
      alcorePreviousSecret,
      alcoreIssuer,
      readSettingsFromDiskMigrated,
      clientAuthController: remoteClientAuthRuntime,
    });
    if (uiAuthController.enabled) {
      console.log('Alcore login required for browser sessions');
    }

    registerServerStatusRoutes(app, {
      express,
      process,
      alcodeVersion,
      runtimeName,
      serverStartedAt,
      gracefulShutdown,
      getHealthSnapshot,
      getServerId,
      getServerPort,
      getTunnelUrl,
      tunnelAuthController,
      uiAuthController,
    });

    registerCommonRequestMiddleware(app, { express, verboseRequestLogs, skipBodyParsing });

    registerAgentToolRoutes(app, { express, agentToolRuntime });

    const notificationEmitRoutes = registerNotificationEmitRoutes(app, {
      express,
      isAgentToolRequestAuthorized: (req) => agentToolRuntime?.authorizeRequest?.(req) === true,
      emitter: pluginNotificationEmitter,
    });
    notificationEmitRoutes.registerPluginRoute();

    // The Alcore provider card shares the desktop-login keychain: a pair
    // captured at loopback completion is the pair the catalog sync
    // presents, and global sign-out clears it beside the provider entry.
    // The OpenCode credential is the caller's personal API key for its own
    // link (never the rotating login Bearer, never a service key): minted
    // once, then reused across logins while its key-id ref + store entry
    // survive (one key per device, Codex-style). Stored via
    // `integration.connect.key` so the card reads Connected, revoked by
    // id plus removed on sign-out so no orphan survives. Unwired (no
    // OpenCode URL/auth) keeps the block-only behavior.
    const openCodeWired = buildOpenCodeUrl !== null && buildOpenCodeUrl !== undefined
      && getOpenCodeAuthHeaders !== null && getOpenCodeAuthHeaders !== undefined;
    const openCodeCredentials = openCodeWired
      ? {
        listCredentialIDs: async () => {
          const client = OpenCode.make({
            baseUrl: buildOpenCodeUrl('', '').replace(/\/+$/, ''),
            headers: { ...getOpenCodeAuthHeaders() },
          });
          const { data } = await client.integration.list();
          const integration = data.find((entry) => entry?.id === ALCORE_PROVIDER_ID);
          return (integration?.connections ?? [])
            .filter((connection) => connection?.type === 'credential')
            .map((connection) => connection.id);
        },
        connectKey: async (key) => {
          const client = OpenCode.make({
            baseUrl: buildOpenCodeUrl('', '').replace(/\/+$/, ''),
            headers: { ...getOpenCodeAuthHeaders() },
          });
          await client.integration.connect.key({ integrationID: ALCORE_PROVIDER_ID, key });
        },
        removeCredential: async (credentialID) => {
          const client = OpenCode.make({
            baseUrl: buildOpenCodeUrl('', '').replace(/\/+$/, ''),
            headers: { ...getOpenCodeAuthHeaders() },
          });
          await client.credential.remove({ credentialID });
        },
      }
      : null;
    // The personal API key behind the provider credential: minted with the
    // caller's own keychained Bearer at login, revoked by key id at
    // sign-out. The key-id ref file lives beside the other server stores so
    // a restart still knows which row to revoke; the secret itself is never
    // persisted here (OpenCode owns the credential, memory owns the ambient
    // value). An unwired data dir falls back to the module default.
    const personalKeys = createPersonalKeyRuntime({
      userTokenStore: sharedUserTokenStore(),
      keyIdStore: createFileKeyIdStore({
        filePath: alcodeDataDir && path
          ? path.join(alcodeDataDir, 'alcore-personal-keys.json')
          : undefined,
      }),
    });
    // Readiness probe (task 55 — the post-login race): the alcore models
    // the running OpenCode currently serves, read per call through the
    // same global client the credential calls use. Unwired keeps the
    // write-then-return behavior (no poll, readiness reports ready).
    const listAlcoreModels = openCodeWired
      ? async () => {
        const client = OpenCode.make({
          baseUrl: buildOpenCodeUrl('', '').replace(/\/+$/, ''),
          headers: { ...getOpenCodeAuthHeaders() },
        });
        const { data } = await client.model.list();
        return (Array.isArray(data) ? data : [])
          .filter((entry) => entry?.providerID === ALCORE_PROVIDER_ID);
      }
      : null;
    const alcoreProvider = createAlcoreProviderRuntime({
      userTokenStore: sharedUserTokenStore(),
      upsertProviderConfig,
      removeProviderConfig,
      openCodeCredentials,
      personalKeys,
      listAlcoreModels,
      // Null (tests, unwired runtimes) falls back to the runtime default:
      // the sync assumes a managed server and reports ready unwired.
      isExternalOpenCode: isExternalOpenCode ?? (() => false),
    });

    const authAndAccessRoutes = registerAuthAndAccessRoutes(app, {
      express,
      tunnelAuthController,
      uiAuthController,
      alcoreProvider,
      alcoreSecret,
      alcorePreviousSecret,
      alcoreIssuer,
      remoteClientAuthRuntime,
      clientPairingRuntime,
      getRelayPairingCandidate,
      reconcileRelay,
      getPairingTransports,
      getDirectCandidateUrls,
      getServerId,
      getServerLabel,
      readSettingsFromDiskMigrated,
      normalizeTunnelSessionTtlMs,
    });

    notificationEmitRoutes.registerApiRoute();

    registerTtsRoutes(app, { sayTTSCapability });

    registerNotificationRoutes(app, {
      uiAuthController,
      ensurePushInitialized,
      ensureGlobalWatcherStarted,
      getOrCreateVapidKeys,
      getUiSessionTokenFromRequest,
      readSettingsFromDiskMigrated,
      writeSettingsToDisk,
      addOrUpdatePushSubscription,
      removePushSubscription,
      addOrUpdateApnsToken,
      removeApnsToken,
      updateUiVisibility,
      clearPendingPushBadge,
      isUiVisible,
      getUiNotificationClients,
      writeSseEvent,
      getSessionActivitySnapshot: sessionRuntime.getSessionActivitySnapshot,
      getSessionStateSnapshot: sessionRuntime.getSessionStateSnapshot,
      getPendingBlockingRequestsSnapshot: sessionRuntime.getPendingBlockingRequestsSnapshot,
      getSessionAttentionSnapshot: sessionRuntime.getSessionAttentionSnapshot,
      getSessionState: sessionRuntime.getSessionState,
      getSessionAttentionState: sessionRuntime.getSessionAttentionState,
      markSessionViewed: sessionRuntime.markSessionViewed,
      markSessionUnviewed: sessionRuntime.markSessionUnviewed,
      markUserMessageSent: sessionRuntime.markUserMessageSent,
      setPushInitialized,
      setAutoAcceptSession,
    });

    // Startup readiness contract: local-only probes (session, plugin,
    // ULW tools, model resolution, child, events), zero model spend.
    // Mounted with the other routes, ahead of the OpenCode proxy,
    // so the indicator reads the contract instead of raw health. Missing
    // bindings fail their probe steps exactly; they never break boot.
    // Wired when the OpenCode URL/auth pair is available; otherwise the
    // probes that need them report a missing binding instead of failing boot.
    // `openCodeWired` is already bound above (the OpenCode credential block).
    {
      const { runProbes, repairStep } = createStartupReadinessWiring({
        getOpenCodeBaseUrl: openCodeWired ? () => buildOpenCodeUrl('', '').replace(/\/+$/, '') : null,
        getOpenCodeHeaders: openCodeWired ? () => ({ ...getOpenCodeAuthHeaders() }) : null,
        defaultDirectory: alcodeDataDir,
        omoNativeRuntime,
        managedDataDir: alcodeDataDir,
        fsPromises: fs?.promises ?? null,
        path,
        getSmallModelClient,
        listModelInfos,
        resetOpenCodeRuntimeProviders,
        getMessageStreamHub,
      });
      const startupReadinessRuntime = createStartupReadinessRuntime({ runProbes, repairStep });
      startupReadinessRuntime.registerStartupReadinessRoutes(app);
    }

    registerAlcodeRoutes(app, {
      fs,
      os,
      path,
      process,
      server,
      __dirname,
      alcodeDataDir,
      modelsDevApiUrl,
      modelsMetadataCacheTtl,
      readSettingsFromDiskMigrated,
      fetchFreeZenModels,
      getCachedZenModels,
      desktopUpdater,
    });

    return {
      uiAuthController,
      desktopAuthRuntime: authAndAccessRoutes?.desktopAuthRuntime ?? null,
    };
  };

  return {
    setupBaseRoutes,
  };
};
