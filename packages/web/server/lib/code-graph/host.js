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

const WORKER_PATH = fileURLToPath(new URL('./ipc-worker.js', import.meta.url));
const DEFAULT_CALL_TIMEOUT_MS = 15 * 60 * 1000;

export const createCodeGraphHost = ({ spawnWorker, storeDir } = {}) => {
  const normalizeDirectoryOnHost = createDirectoryNormalizer({ fsPromises: fs, path });
  const workerEnv = typeof storeDir === 'string' && storeDir.length > 0
    ? { ...process.env, ALCODE_CODE_GRAPH_STORE: storeDir }
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
      if (!message || typeof message !== 'object') return;
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
      if (typeof message.id === 'number') settle(message.id, message);
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
    return cached;
  };

  const host = {
    normalizeDirectory: (directory) => normalizeDirectoryOnHost(directory),
    deriveScopeIds: (directory) => call('deriveScopeIds', { directory }),
    readIndex: async (directory, options = {}) => {
      const building = buildingState(directory);
      if (building) {
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
    query: (directory, input = {}) => call('query', { directory, input }),
    resolveFile: (directory, file) => call('resolveFile', { directory, file }),
    indexState: async (directory) => {
      const cached = stateByDirectory.get(keyOf(directory));
      if (cached && (BUILDING_STATES.has(cached.state) || cached.state === 'cancelled' || cached.state === 'failed') && Date.now() - cached.atMs < BUILD_STATE_TTL_MS) {
        return {
          state: cached.state,
          phase: cached.phase ?? null,
          files: cached.files ?? null,
          projectsDone: cached.projectsDone ?? null,
          projectsTotal: cached.projectsTotal ?? null,
          startedAtMs: cached.startedAtMs ?? cached.atMs,
          error: cached.error ?? null,
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
