/**
 * Startup readiness runtime: runs the probes in contract order and owns the
 * repair-once then unavailable-marking state the UI indicator consumes.
 *
 * State machine (per process, in memory — readiness is live state, never
 * persisted, so a restart re-proves it from scratch):
 *   - `unknown` before the first run.
 *   - `ready` when the last full contract run passed.
 *   - `repairing` while the single repair attempt for the current outage
 *     runs. Repair fires at most ONCE per outage: the first failed run of an
 *     outage runs `repairStep(failedStep, snapshot)` and re-probes once.
 *   - `unavailable` when the re-probe still fails, or when further runs
 *     fail while an outage is already open. No more repairs fire until a
 *     run passes, which closes the outage and re-arms repair.
 *
 * `repairStep` is injected and best-effort: it never fails the probe. The
 * production repair re-checks the failed layer only (re-materialize the
 * plugin, re-subscribe the hub, re-list the models) — a narrow, named fix,
 * never a process restart.
 *
 * Route contract: `registerStartupReadinessRoutes(app)` mounts
 * `GET /api/startup-readiness` (with `?fresh=1` to bypass the snapshot
 * cache). The mount MUST run before the generic OpenCode `/api/*` proxy
 * fallback (ui-api-decoupling: OpenChamber routes win over the proxy), and
 * 503s carry the last authoritative snapshot so a fetch failure never
 * masquerades as empty success — the indicator keeps rendering the last
 * known contract instead of blanking.
 *
 * Surface list (ui-api-decoupling: one line per runtime):
 *   - web: served by the loopback Alcode server; shared UI reads it through
 *     `runtimeFetch('/api/startup-readiness')` on the same origin.
 *   - Electron desktop: same loopback API backend; same `runtimeFetch` path.
 *   - VS Code: the webview reaches the connected Alcode server through its
 *     `RuntimeAPIs` `runtimeFetch` composition; no webview-local fallback.
 *   - hosted mobile: connects to an existing Alcode server; same route.
 *   - Capacitor mobile: connects to an existing Alcode server; same route.
 * No runtime carries its own probe logic; unsupported means the fetch
 * fails, which the indicator renders as `unavailable`, never as ready.
 */

import {
  STARTUP_READINESS_ROUTE,
  STARTUP_READINESS_SNAPSHOT_CACHE_TTL_MS,
  createReadinessSnapshot,
} from './startup-readiness-contract.js';

export const createStartupReadinessRuntime = (dependencies = {}) => {
  const {
    runProbes,
    repairStep = async () => ({}),
    clock = () => Date.now(),
    snapshotCacheTtlMs = STARTUP_READINESS_SNAPSHOT_CACHE_TTL_MS,
  } = dependencies;

  if (typeof runProbes !== 'function') {
    throw new Error('startup readiness runtime requires "runProbes"');
  }
  if (typeof repairStep !== 'function') {
    throw new Error('startup readiness runtime requires "repairStep" to be a function');
  }

  let status = 'unknown';
  let consecutiveFailures = 0;
  let repairedThisOutage = false;
  let lastRunAt = 0;
  let lastSnapshot = createReadinessSnapshot({ status, checkedAt: 0 });

  const settleReady = (snapshot) => {
    status = 'ready';
    consecutiveFailures = 0;
    repairedThisOutage = false;
    lastSnapshot = { ...snapshot, status, consecutiveFailures };
    lastRunAt = clock();
    return lastSnapshot;
  };

  const settleUnavailable = (snapshot) => {
    status = 'unavailable';
    lastSnapshot = { ...snapshot, status, consecutiveFailures };
    lastRunAt = clock();
    return lastSnapshot;
  };

  /**
   * One full contract run with repair-once. Returns the settled snapshot;
   * never throws for probe failures (a failed contract is data, not an
   * exception). Only a broken `runProbes` itself throws, and the route
   * turns that into a 503 carrying the last snapshot.
   */
  const runReadiness = async () => {
    const steps = await runProbes();
    const first = createReadinessSnapshot({
      status,
      steps,
      checkedAt: clock(),
      consecutiveFailures,
    });
    if (first.ok) return settleReady(first);

    consecutiveFailures += 1;
    if (repairedThisOutage) return settleUnavailable(first);

    // First failure of this outage: one repair attempt, then one re-probe.
    repairedThisOutage = true;
    status = 'repairing';
    try {
      await repairStep(first.failedStep, first);
    } catch {
      // Repair is best-effort by contract; the re-probe below is the
      // verdict either way.
    }
    const retrySteps = await runProbes();
    const retry = createReadinessSnapshot({
      status,
      steps: retrySteps,
      checkedAt: clock(),
      consecutiveFailures,
    });
    if (retry.ok) return settleReady(retry);
    return settleUnavailable(retry);
  };

  /**
   * The snapshot the indicator polls. Serves the cached verdict inside the
   * TTL so steady-state polling does not create/delete probe sessions on
   * every tick; `?fresh=1` forces a live run.
   */
  const getSnapshot = async ({ fresh = false } = {}) => {
    if (!fresh && lastRunAt > 0 && clock() - lastRunAt < snapshotCacheTtlMs) {
      return lastSnapshot;
    }
    return runReadiness();
  };

  const registerStartupReadinessRoutes = (app) => {
    app.get(STARTUP_READINESS_ROUTE, async (req, res) => {
      try {
        const fresh = req?.query?.fresh === '1' || req?.query?.fresh === 'true';
        res.json(await getSnapshot({ fresh }));
      } catch (error) {
        res.status(503).json({
          ...lastSnapshot,
          status: 'unavailable',
          ok: false,
          error: error?.message ?? 'startup readiness unavailable',
        });
      }
      return undefined;
    });
    return app;
  };

  const getState = () => ({
    status,
    consecutiveFailures,
    repairedThisOutage,
    lastRunAt,
    lastSnapshot,
  });

  return {
    runReadiness,
    getSnapshot,
    getState,
    registerStartupReadinessRoutes,
  };
};
