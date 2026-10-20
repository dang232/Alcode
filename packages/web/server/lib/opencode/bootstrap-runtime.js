import { registerNotificationEmitRoutes } from '../notifications/emit-route.js';
import { registerHttpResponseDiagnostics } from './core-routes.js';
import { createStartupReadinessRuntime } from './startup-readiness-runtime.js';
import { createStartupReadinessWiring } from './startup-readiness-wiring.js';

export const createBootstrapRuntime = (dependencies) => {
  const {
    createUiAuth,
    registerServerStatusRoutes,
    registerCommonRequestMiddleware,
    registerAuthAndAccessRoutes,
    registerTtsRoutes,
    registerNotificationRoutes,
    registerOpenChamberRoutes,
    registerAgentToolRoutes = () => {},
    express,
  } = dependencies;

  const setupBaseRoutes = (app, options) => {
    const {
      process,
      openchamberVersion,
      runtimeName,
      serverStartedAt,
      gracefulShutdown,
      getHealthSnapshot,
      getServerPort,
      getTunnelUrl,
      verboseRequestLogs,
      uiPassword,
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
      openchamberDataDir,
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
      password: uiPassword,
      readSettingsFromDiskMigrated,
      clientAuthController: remoteClientAuthRuntime,
    });
    if (uiAuthController.enabled) {
      console.log('UI password protection enabled for browser sessions');
    }

    registerServerStatusRoutes(app, {
      express,
      process,
      openchamberVersion,
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

    registerAuthAndAccessRoutes(app, {
      express,
      tunnelAuthController,
      uiAuthController,
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
    const openCodeWired = buildOpenCodeUrl !== null && buildOpenCodeUrl !== undefined
      && getOpenCodeAuthHeaders !== null && getOpenCodeAuthHeaders !== undefined;
    {
      const { runProbes, repairStep } = createStartupReadinessWiring({
        getOpenCodeBaseUrl: openCodeWired ? () => buildOpenCodeUrl('', '').replace(/\/+$/, '') : null,
        getOpenCodeHeaders: openCodeWired ? () => ({ ...getOpenCodeAuthHeaders() }) : null,
        defaultDirectory: openchamberDataDir,
        omoNativeRuntime,
        managedDataDir: openchamberDataDir,
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

    registerOpenChamberRoutes(app, {
      fs,
      os,
      path,
      process,
      server,
      __dirname,
      openchamberDataDir,
      modelsDevApiUrl,
      modelsMetadataCacheTtl,
      readSettingsFromDiskMigrated,
      fetchFreeZenModels,
      getCachedZenModels,
      desktopUpdater,
    });

    return {
      uiAuthController,
    };
  };

  return {
    setupBaseRoutes,
  };
};
