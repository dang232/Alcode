/**
 * Local-only startup readiness probes, in contract order.
 *
 * Every dependency is injected so the contract stays hermetic and unit
 * provable without a running OpenCode; the production wiring (a one-line
 * call from the server bootstrap) binds each probe to the real local
 * surface, documented on each dependency below:
 *
 * - `createProbeSession({ title })` → the created session id (string) or
 *   `{ id }`. Production: `client.session.create({ location: { directory },
 *   title })` against the managed loopback OpenCode, where `directory` is
 *   the lifecycle's default directory — the ONE directory probes may touch.
 *   Directory-scoped reads start that location with its MCP fleet
 *   (opencode-v2: every directory-scoped read starts a location), so probes
 *   never fan out over projects or worktrees.
 * - `deleteProbeSession(id)` → void. Production: `client.session.delete`
 *   (or the archive fallback where delete is unavailable).
 * - `materializeNativePlugin()` → `{ directory, setupPayloadBytes,
 *   hasSetup }`. Production: `omoNativeRuntime.materializePlugin()` plus a
 *   stat/read of the materialized `index.js`: `hasSetup` is true only when
 *   the entrypoint carries the real engine setup payload (the native ULW
 *   operations registered by `setup()`), never an empty placeholder.
 * - `listUlwTools()` → `string[]` of tool names. Production: `tools/list`
 *   against the bundled `ulw` MCP server entry the managed config names.
 * - `resolveInitialModel()` → `{ providerID, modelID }` or `null`.
 *   Production: the same model-resolution read the session bootstrap uses
 *   (`listModelInfos` + fallback selection), proving model resolution is
 *   initialized without sending a prompt.
 * - `forkProbeChild(parentSessionId)` → the child session id (string) or
 *   `{ id }`. Production: `client.session.fork({ sessionID: parentId })`
 *   with no message, proving a child row can be created with a real id.
 * - `checkEventInterfaces()` → `{ hubSubscribed, upstreamReachable }`.
 *   Production: the global message-stream hub's subscriber state plus a
 *   `GET /api/session/active` round trip — global, so it starts no
 *   location — proving the event interfaces the UI indicator feeds on are
 *   connected.
 *
 * Local-only means: loopback OpenCode, local files, local MCP stdio. No
 * prompt text, no model invocation, no network. The probe session and its
 * child are always deleted afterwards, even when a later step fails.
 */

import {
  STARTUP_READINESS_CODES,
  STARTUP_READINESS_PROBE_SESSION_TITLE,
  assertTitleOnlySessionPayload,
  buildTitleOnlySessionPayload,
  createStepResult,
} from './startup-readiness-contract.js';

const asSessionId = (value) => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (value && typeof value === 'object' && typeof value.id === 'string' && value.id.trim().length > 0) {
    return value.id.trim();
  }
  return null;
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export const createStartupReadinessProbes = (dependencies = {}) => {
  const {
    createProbeSession,
    deleteProbeSession,
    materializeNativePlugin,
    listUlwTools,
    resolveInitialModel,
    forkProbeChild,
    checkEventInterfaces,
    clock = () => Date.now(),
  } = dependencies;

  for (const [name, fn] of Object.entries({
    createProbeSession,
    deleteProbeSession,
    materializeNativePlugin,
    listUlwTools,
    resolveInitialModel,
    forkProbeChild,
    checkEventInterfaces,
  })) {
    if (typeof fn !== 'function') {
      throw new Error(`startup readiness probes require "${name}"`);
    }
  }

  const timed = async (step, code, run) => {
    const startedAt = clock();
    try {
      const { ok, detail } = await run();
      return createStepResult(step, ok === true, code, detail, clock() - startedAt);
    } catch (error) {
      return createStepResult(step, false, code, {
        error: error?.message ?? String(error),
      }, clock() - startedAt);
    }
  };

  /**
   * Step 1. Creates the probe session with `{ title }` only — the guard
   * runs on the exact payload about to be sent, so `message`/`prompt`/
   * `model` can never ride along. Returns the session id for the later
   * steps; deletion is owned by `run()`, not by this probe, so the session
   * is removed even when a later step short-circuits.
   */
  const probeSessionCreatable = async () => {
    const payload = buildTitleOnlySessionPayload(STARTUP_READINESS_PROBE_SESSION_TITLE);
    assertTitleOnlySessionPayload(payload);
    const created = await createProbeSession(payload);
    const sessionId = asSessionId(created);
    if (!sessionId) {
      return {
        ok: false,
        detail: { sessionId: null, reason: 'session creation answered no session id' },
      };
    }
    return { ok: true, detail: { sessionId } };
  };

  const probeNativePluginMaterialized = async () => timed(
    'native-plugin-materialized',
    STARTUP_READINESS_CODES.PLUGIN_FAILED,
    async () => {
      const materialized = await materializeNativePlugin();
      const directory = materialized?.directory;
      const bytes = Number(materialized?.setupPayloadBytes);
      const ok = isNonEmptyString(directory)
        && materialized?.hasSetup === true
        && Number.isFinite(bytes)
        && bytes > 0;
      return {
        ok,
        code: ok ? STARTUP_READINESS_CODES.PLUGIN_OK : STARTUP_READINESS_CODES.PLUGIN_FAILED,
        detail: {
          directory: isNonEmptyString(directory) ? directory : null,
          setupPayloadBytes: Number.isFinite(bytes) ? bytes : 0,
          hasSetup: materialized?.hasSetup === true,
        },
      };
    },
  ).then((result) => (result.ok
    ? { ...result, code: STARTUP_READINESS_CODES.PLUGIN_OK }
    : result));

  const probeUlwToolsDiscoverable = async () => timed(
    'ulw-tools-discoverable',
    STARTUP_READINESS_CODES.TOOLS_FAILED,
    async () => {
      const tools = await listUlwTools();
      const names = Array.isArray(tools) ? tools.filter((name) => isNonEmptyString(name)) : [];
      const ok = names.length > 0;
      return {
        ok,
        code: ok ? STARTUP_READINESS_CODES.TOOLS_OK : STARTUP_READINESS_CODES.TOOLS_FAILED,
        detail: { toolCount: names.length, tools: names.slice(0, 25) },
      };
    },
  ).then((result) => (result.ok
    ? { ...result, code: STARTUP_READINESS_CODES.TOOLS_OK }
    : result));

  const probeModelResolutionInitialized = async () => timed(
    'model-resolution-initialized',
    STARTUP_READINESS_CODES.MODEL_FAILED,
    async () => {
      const resolved = await resolveInitialModel();
      const ok = Boolean(resolved)
        && isNonEmptyString(resolved.providerID)
        && isNonEmptyString(resolved.modelID);
      return {
        ok,
        code: ok ? STARTUP_READINESS_CODES.MODEL_OK : STARTUP_READINESS_CODES.MODEL_FAILED,
        detail: ok
          ? { providerID: resolved.providerID, modelID: resolved.modelID }
          : { reason: 'no usable model reference resolved' },
      };
    },
  ).then((result) => (result.ok
    ? { ...result, code: STARTUP_READINESS_CODES.MODEL_OK }
    : result));

  /**
   * Step 5. Forks a child off the probe session and deletes it in the same
   * step: the contract proves a REAL child id comes back, and the delete in
   * `finally` proves no probe row survives the step either way.
   */
  const probeChildCreatable = async (parentSessionId) => timed(
    'child-creatable',
    STARTUP_READINESS_CODES.CHILD_FAILED,
    async () => {
      const created = await forkProbeChild(parentSessionId);
      const childSessionId = asSessionId(created);
      if (!childSessionId) {
        return {
          ok: false,
          code: STARTUP_READINESS_CODES.CHILD_FAILED,
          detail: { reason: 'child creation answered no session id' },
        };
      }
      try {
        return {
          ok: true,
          code: STARTUP_READINESS_CODES.CHILD_OK,
          detail: { childSessionId },
        };
      } finally {
        await deleteProbeSession(childSessionId).catch(() => {});
      }
    },
  ).then((result) => (result.ok
    ? { ...result, code: STARTUP_READINESS_CODES.CHILD_OK }
    : result));

  const probeEventInterfacesConnected = async () => timed(
    'event-interfaces-connected',
    STARTUP_READINESS_CODES.EVENTS_FAILED,
    async () => {
      const state = await checkEventInterfaces();
      const ok = state?.hubSubscribed === true && state?.upstreamReachable === true;
      return {
        ok,
        code: ok ? STARTUP_READINESS_CODES.EVENTS_OK : STARTUP_READINESS_CODES.EVENTS_FAILED,
        detail: {
          hubSubscribed: state?.hubSubscribed === true,
          upstreamReachable: state?.upstreamReachable === true,
        },
      };
    },
  ).then((result) => (result.ok
    ? { ...result, code: STARTUP_READINESS_CODES.EVENTS_OK }
    : result));

  /**
   * Runs the contract in order. The first failure short-circuits: later
   * steps depend on the earlier ones (no plugin without a session to scope
   * it, no child without a parent), and a failure already names the cause.
   * The probe session is deleted in `finally`, so a short-circuit never
   * strands it.
   */
  const run = async () => {
    const first = await timed(
      'session-creatable',
      STARTUP_READINESS_CODES.SESSION_FAILED,
      probeSessionCreatable,
    ).then((result) => (result.ok
      ? { ...result, code: STARTUP_READINESS_CODES.SESSION_OK }
      : result));
    if (!first.ok) return [first];

    const probeSessionId = first.detail?.sessionId;
    try {
      const results = [first];
      // Thunks, invoked one at a time: contract order is the diagnosis
      // order, and an eager array would start every probe at once.
      const rest = [
        () => probeNativePluginMaterialized(),
        () => probeUlwToolsDiscoverable(),
        () => probeModelResolutionInitialized(),
        () => probeChildCreatable(probeSessionId),
        () => probeEventInterfacesConnected(),
      ];
      for (const runNext of rest) {
        const result = await runNext();
        results.push(result);
        if (!result.ok) return results;
      }
      return results;
    } finally {
      await deleteProbeSession(probeSessionId).catch(() => {});
    }
  };

  return { run };
};
