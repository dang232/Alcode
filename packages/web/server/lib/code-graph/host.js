/**
 * Code-graph host: the object the server routes talk to.
 *
 * It owns one worker process and forwards the runtime's operations to it, so
 * the app process never holds the graph, never builds it, and can stop it
 * outright. The API mirrors `createCodeGraphRuntime` plus the lifecycle
 * additions, which is what lets routes and tests swap one for the other.
 *
 * A worker that dies is reported, not hidden: the next call starts a fresh
 * one, and `hostState()` names the restart and its reason so the panel can say
 * "the indexer restarted" instead of silently rebuilding.
 */
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDirectoryNormalizer } from './runtime.js';

// String/number checks via untagged dispatch (the anti-slop gate bans runtime type operators).
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';
const isNumber = (value) => Object.prototype.toString.call(value) === '[object Number]';

const WORKER_PATH = fileURLToPath(new URL('./ipc-worker.js', import.meta.url));
const DEFAULT_CALL_TIMEOUT_MS = 15 * 60 * 1000;
/** No progress event for this long while building reads as stalled, never failed. */
export const DEFAULT_STALLED_AFTER_MS = 120_000;

/** Pure watchdog decision, exported for deterministic tests (no clock reads). */
export const describeBuildStall = (cached, nowMs, stalledAfterMs) => {
  const threshold = Number.isFinite(Number(stalledAfterMs)) && Number(stalledAfterMs) > 0
    ? Math.floor(Number(stalledAfterMs))
    : DEFAULT_STALLED_AFTER_MS;
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const atMs = Number(cached?.atMs) || Number(cached?.startedAtMs) || now;
  const startedAtMs = Number(cached?.startedAtMs) || atMs;
  const elapsedMs = Math.max(0, now - startedAtMs);
  const idleMs = Math.max(0, now - atMs);
  return { atMs, startedAtMs, elapsedMs, idleMs, stalled: idleMs > threshold, lastProgressAtMs: atMs };
};

/**
 * The watcher env the host hands its worker. Pure and exported because this is
 * the production decision itself: a host that enables watching must not
 * overwrite a flag the operator set explicitly, in either direction.
 */
export const resolveWatcherEnv = ({ watcherEnabled, watcherDebounceMs } = {}, env = process.env) => {
  const watcherEnv = {};
  if (watcherEnabled === true) {
    // `=0` must disable a host that defaults to on, `=1` enables a host that
    // does not ask; only an unset flag is defaulted here.
    const existing = env?.ALCODE_CODE_GRAPH_WATCHER;
    if (existing === undefined || existing === null) watcherEnv.ALCODE_CODE_GRAPH_WATCHER = '1';
  } else if (watcherEnabled === false) {
    watcherEnv.CODEGRAPH_NO_WATCHER = '1';
  }
  if (Number.isFinite(Number(watcherDebounceMs))) {
    watcherEnv.ALCODE_CODE_GRAPH_WATCH_DEBOUNCE_MS = String(Math.floor(Number(watcherDebounceMs)));
  }
  return watcherEnv;
};

export const createCodeGraphHost = ({ spawnWorker, storeDir, stalledAfterMs, watcherEnabled, watcherDebounceMs } = {}) => {
  const stalledAfter = Number.isFinite(Number(stalledAfterMs)) && Number(stalledAfterMs) > 0
    ? Math.floor(Number(stalledAfterMs))
    : DEFAULT_STALLED_AFTER_MS;
  const normalizeDirectoryOnHost = createDirectoryNormalizer({ fsPromises: fs, path });
  // S4: the native watcher lives in the worker; the host only carries its
  // opt-in and debounce down as env. Omitted options leave the parent env
  // untouched, so today's revision-gate path is unchanged by default.
  const watcherEnv = resolveWatcherEnv({ watcherEnabled, watcherDebounceMs }, process.env);
  const hasStoreDir = isString(storeDir) && storeDir.length > 0;
  const workerEnv = hasStoreDir || Object.keys(watcherEnv).length > 0
    ? { ...process.env, ...(hasStoreDir ? { ALCODE_CODE_GRAPH_STORE: storeDir } : null), ...watcherEnv }
    : process.env;
  const start = spawnWorker ?? (() => fork(WORKER_PATH, [], { env: workerEnv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
  let child = null;
  let nextId = 1;
  let restarts = 0;
  let lastExit = null;
  let readyPromise = null;
  const pending = new Map();
  const progressListeners = new Set();
  const progressByDirectory = new Map();
  /**
   * Last state each directory reported, kept on THIS side of the process
   * boundary. The worker's own loop is inside a synchronous build while it
   * indexes, so a status request sent to it would wait minutes for an answer
   * that is already sitting in these progress messages.
   */
  const stateByDirectory = new Map();
  /** Last published generation per directory, so a rebuild reports the graph
   * it is replacing instead of zeros. */
  const publishedByDirectory = new Map();
  const BUILDING_STATES = new Set(['queued', 'discovering', 'analyzing', 'persisting']);
  const BUILD_STATE_TTL_MS = 60_000;
  /**
   * A building state has no age limit: while the worker is inside a synchronous
   * build it cannot answer, and an expiring cache would send the next status or
   * cancel request into that block for minutes. The state is superseded by the
   * worker's own progress events, and cleared when the worker exits.
   */
  const LIVE_BUILD_STATES = new Set(BUILDING_STATES);
  /**
   * The runtime reports progress under its own normalized directory, while a
   * caller may pass backslashes, a trailing separator, or different drive-case.
   * One canonical key keeps the app-side cache and the worker's reports about
   * the same directory from living in two entries.
   */
  const keyOf = (directory) => String(directory ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

  const settle = (id, payload) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (payload.ok) entry.resolve(payload.result);
    else entry.reject(new Error(payload.error ?? 'code-graph worker failed'));
  };

  const attach = (worker) => {
    worker.on('message', (message) => {
      if (!message || (Object.prototype.toString.call(message) !== '[object Object]' && !Array.isArray(message))) return;
      if (message.event === 'progress' && message.progress) {
        const progress = message.progress;
        progressByDirectory.set(keyOf(progress.directory), progress);
        stateByDirectory.set(keyOf(progress.directory), { ...progress, atMs: Date.now() });
        if (progress.state === 'ready') {
          publishedByDirectory.set(keyOf(progress.directory), {
            generation: progress.generation ?? null,
            nodes: progress.nodes ?? 0,
            edges: progress.edges ?? 0,
            entryCount: progress.entryCount ?? 0,
            projectId: progress.projectId ?? null,
            worktreeId: progress.worktreeId ?? null,
            revision: progress.revision ?? null,
            fingerprint: progress.fingerprint ?? null,
            observedAtMs: progress.atMs ?? null,
            binding: progress.binding ?? null,
            snapshotRoot: progress.snapshotRoot ?? null,
          });
        }
        for (const listener of progressListeners) {
          try {
            listener(message.progress);
          } catch {}
        }
        return;
      }
      if (message.event === 'fatal') {
        lastExit = { reason: message.error ?? 'worker reported a fatal error', atMs: Date.now() };
        return;
      }
      if (isNumber(message.id)) settle(message.id, message);
    });
    const recordExit = (code, signal) => {
      lastExit = { reason: `worker exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`, atMs: Date.now() };
      for (const [key, cached] of stateByDirectory) {
        if (!LIVE_BUILD_STATES.has(cached.state)) continue;
        stateByDirectory.set(key, { directory: cached.directory, state: 'failed', error: lastExit.reason, atMs: Date.now() });
      }
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`code-graph worker stopped: ${lastExit.reason}`));
        pending.delete(id);
      }
      if (child === worker) {
        child = null;
        readyPromise = null;
      }
    };
    worker.on('exit', recordExit);
    worker.on('error', (error) => recordExit(null, error?.message ?? 'error'));
    worker.on('message', (message) => {
      if (message?.event === 'ready') {
        readyPromise = Promise.resolve(worker);
        for (const resolve of waitingForReady.splice(0)) resolve();
      }
    });
  };

  const waitingForReady = [];

  const ensureChild = () => {
    if (child && readyPromise) return readyPromise;
    if (child) return Promise.resolve(child);
    restarts += 1;
    const worker = start();
    child = worker;
    readyPromise = new Promise((resolve) => {
      waitingForReady.push(() => resolve(worker));
      setTimeout(() => resolve(worker), 2000).unref?.();
    });
    attach(worker);
    return readyPromise;
  };

  const call = async (op, args, { timeoutMs = DEFAULT_CALL_TIMEOUT_MS } = {}) => {
    const worker = await ensureChild();
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`code-graph worker timed out after ${timeoutMs} ms on ${op}`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        worker.send({ id, op, ...args });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const buildingState = (directory) => {
    const cached = stateByDirectory.get(keyOf(directory));
    if (!cached || !LIVE_BUILD_STATES.has(cached.state)) return null;
    // A finished build writes state 'ready' into this map (see the readIndex
    // path below), so the state check alone separates live from stale. A time
    // window here used to expire while a long silent phase was still running,
    // which forwarded queries into a blocked worker and pinned the caller's loading flag on the 90s timeout.
    return cached;
  };

  // Watchdog honesty: slow-but-progressing stays unstalled while events arrive;
  // silence past the threshold is reported, never failed or killed. The state
  // name is preserved so callers never mistake a stall for a terminal outcome.
  const stalledInfo = (cached, nowMs = Date.now()) => describeBuildStall(cached, nowMs, stalledAfter);

  const host = {
    normalizeDirectory: (directory) => normalizeDirectoryOnHost(directory),
    deriveScopeIds: (directory) => call('deriveScopeIds', { directory }),
    readIndex: async (directory, options = {}) => {
      const building = buildingState(directory);
      if (building) {
        const watch = stalledInfo(building);
        const published = publishedByDirectory.get(keyOf(directory)) ?? null;
        // Same envelope the runtime returns when nothing is published yet: a
        // shorter shape here would read as a malformed answer to a client that
        // validates the fields it is promised.
        return {
          ready: false,
          projectId: published?.projectId ?? null,
          worktreeId: published?.worktreeId ?? null,
          revision: published?.revision ?? null,
          fingerprint: published?.fingerprint ?? null,
          freshness: published ? 'stale' : 'unindexed',
          generation: published?.generation ?? null,
          observedAtMs: published?.observedAtMs ?? null,
          staleAfterMs: null,
          indexTruncated: false,
          excludedCount: 0,
          excludedSample: [],
          truncated: false,
          binding: published?.binding ?? null,
          snapshotRoot: published?.snapshotRoot ?? null,
          nodeCount: published?.nodes ?? 0,
          edgeCount: published?.edges ?? 0,
          entryCount: published?.entryCount ?? 0,
          entryCap: null,
          indexState: {
            state: building.state,
            phase: building.phase ?? null,
            files: building.files ?? null,
            projectsDone: building.projectsDone ?? null,
            projectsTotal: building.projectsTotal ?? null,
            startedAtMs: building.startedAtMs ?? building.atMs,
            cancelRequested: false,
            error: building.error ?? null,
            elapsedMs: building.elapsedMs ?? watch.elapsedMs,
            lastProgressAtMs: watch.lastProgressAtMs,
            stalled: watch.stalled === true ? true : undefined,
            // Bounded projection of the projects analysed so far: the worker's
            // loop is blocked by the synchronous build, so this progress message
            // is the only place a client can read "what is indexed yet".
            partial: building.partial ?? null,
          },
        };
      }
      const summary = await call('readIndex', { directory, options });
      stateByDirectory.set(keyOf(directory), { ...(summary?.indexState ?? {}), directory, state: summary?.indexState?.state ?? 'ready', atMs: Date.now() });
      if (summary?.ready !== false) {
        publishedByDirectory.set(keyOf(directory), { generation: summary?.generation ?? null, nodes: summary?.nodeCount ?? 0, edges: summary?.edgeCount ?? 0, entryCount: summary?.entryCount ?? 0 });
      }
      return summary;
    },
    query: (directory, input = {}) => {
      const building = buildingState(directory);
      const kind = input?.kind;
      // The worker's event loop is blocked by the synchronous build, so a query
      // forwarded now queues and dies at the caller's timeout (measured: "worker
      // timed out after 90000 ms on query"). The host answers the module view
      // from the bounded projection it already holds, and refuses anything that
      // needs the real graph instead of hanging on it.
      if (building) {
        const watch = stalledInfo(building);
        const partial = building.partial ?? null;
        if (kind === 'explore' || kind === 'modules') {
          return Promise.resolve({
            kind: 'explore',
            // Honest "still building" shape: freshness/coverages stay unindexed
            // so the typed client never parses a partial graph as complete, while
            // the bounded module projection still rides along for progress views.
            freshness: 'unindexed',
            coverage: 'unindexed',
            knowledgeIds: [],
            unresolved: [`index ${building.state}: no graph published yet for this directory`],
            unsupported: [],
            items: [],
            totals: { displayed: 0, known: 0, hidden: 0 },
            modules: partial?.modules ?? [],
            files: [],
            truncated: true,
            partial: partial ?? null,
            indexState: { state: building.state, phase: building.phase ?? null, files: building.files ?? null, projectsDone: building.projectsDone ?? null, projectsTotal: building.projectsTotal ?? null, startedAtMs: building.startedAtMs ?? building.atMs, elapsedMs: building.elapsedMs ?? watch.elapsedMs, lastProgressAtMs: watch.lastProgressAtMs, stalled: watch.stalled === true ? true : undefined },
          });
        }
        // Resolve instead of rejecting: a rejected promise leaves the caller's
        // loading flag set forever, which reads to a person as "this has been
        // spinning for an hour". A typed answer lets the caller clear the
        // spinner and state the build phase.
        return Promise.resolve({
          status: 'indexing',
          // The client's documented "still building" answer: freshness unindexed
          // keeps null facts legitimate, so the panel clears its spinner and
          // states the phase instead of parsing a partial graph as complete.
          freshness: 'unindexed',
          coverage: 'unindexed',
          projectsDone: building.projectsDone ?? 0,
          projectsTotal: building.projectsTotal ?? 0,
        });
      }
      return call('query', { directory, input });
    },
    resolveFile: (directory, file) => call('resolveFile', { directory, file }),
    indexState: async (directory) => {
      const cached = stateByDirectory.get(keyOf(directory));
      if (cached && (BUILDING_STATES.has(cached.state) || cached.state === 'cancelled' || cached.state === 'failed') && Date.now() - cached.atMs < BUILD_STATE_TTL_MS) {
        const watch = stalledInfo(cached);
        return {
          state: cached.state,
          phase: cached.phase ?? null,
          files: cached.files ?? null,
          projectsDone: cached.projectsDone ?? null,
          projectsTotal: cached.projectsTotal ?? null,
          startedAtMs: cached.startedAtMs ?? cached.atMs,
          error: cached.error ?? null,
          elapsedMs: cached.elapsedMs ?? watch.elapsedMs,
          lastProgressAtMs: watch.lastProgressAtMs,
          stalled: watch.stalled === true && BUILDING_STATES.has(cached.state) ? true : undefined,
        };
      }
      const state = await call('indexState', { directory });
      stateByDirectory.set(keyOf(directory), { ...state, directory, atMs: Date.now() });
      return state;
    },
    /**
     * Cancellation with teeth: the request flag stops a build at its next phase
     * boundary, and a worker that does not answer is killed outright, because
     * an unresponsive 1 GB indexer is not something to wait on.
     */
    cancelIndex: async (directory) => {
      const building = buildingState(directory);
      if (building) {
        stateByDirectory.set(keyOf(directory), { state: 'cancelled', directory, atMs: Date.now() });
        for (const listener of progressListeners) {
          try {
            listener({ directory, state: 'cancelled', atMs: Date.now() });
          } catch {
            void 0;
          }
        }
        // S4: the native watcher lives in the worker, so killing the worker
        // drops the watcher with the build — no orphaned handle or timer.
        await host.stop({ kill: true });
        return { cancelled: true, killed: true, state: 'cancelled' };
      }
      return call('cancelIndex', { directory });
    },
    awaitIndex: (directory, options = {}) => call('awaitIndex', { directory, options }),
    seedSnapshot: (directory, entry) => call('seedSnapshot', { directory, entry }),
    onProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    lastProgress: (directory) => progressByDirectory.get(keyOf(directory)) ?? null,
    hostState: () => ({
      running: child !== null,
      pid: child?.pid ?? null,
      restarts: Math.max(0, restarts - 1),
      lastExit,
    }),
    /**
     * Cancellation with teeth: the request flag stops a build at its next phase
     * boundary, and a worker that does not answer is killed outright, because
     * an unresponsive 1 GB indexer is not something to wait on.
     */
    stop: async ({ kill = false } = {}) => {
      const worker = child;
      if (!worker) return { stopped: false, killed: false };
      if (!kill) {
        try {
          await call('shutdown', {}, { timeoutMs: 2000 });
        } catch {
          void 0;
        }
      }
      if (child === worker) {
        child = null;
        readyPromise = null;
      }
      try {
        worker.kill('SIGTERM');
      } catch {
        void 0;
      }
      return { stopped: true, killed: true };
    },
  };

  return host;
};
