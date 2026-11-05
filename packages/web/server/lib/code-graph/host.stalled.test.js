import { mkdtempSync, promises as fsPromises, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphHost, describeBuildStall, DEFAULT_STALLED_AFTER_MS } from './host.js';

/**
 * Watchdog honesty, proven without timing: the pure stall decision is
 * deterministic over fixed timestamps, and the host's fast-path answers
 * carry elapsed time and the last progress mark while preserving the phase.
 * A stall is reported, never failed, killed, or restarted.
 */

const root = mkdtempSync(join(tmpdir(), 'code-graph-host-stalled-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

class FakeWorker {
  constructor() {
    this.handlers = new Map();
    this.sent = [];
    this.killed = false;
  }

  on(event, listener) {
    const listeners = this.handlers.get(event) ?? [];
    listeners.push(listener);
    this.handlers.set(event, listeners);
    return this;
  }

  emit(event, ...args) {
    for (const listener of this.handlers.get(event) ?? []) listener(...args);
  }

  send(message) {
    this.sent.push(message);
  }

  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
  }
}

const flushing = () => new Promise((resolve) => setImmediate(resolve));

const spawnHost = (workerRef, options = {}) => createCodeGraphHost({
  spawnWorker: () => {
    workerRef.worker = new FakeWorker();
    queueMicrotask(() => workerRef.worker.emit('message', { event: 'ready', pid: 4242 }));
    return workerRef.worker;
  },
  storeDir: '',
  ...options,
});

describe('describeBuildStall', () => {
  it('reports slow-but-progressing while events arrive', () => {
    const now = 1_000_000;
    const cached = { state: 'analyzing', phase: 'program', files: 5000, startedAtMs: now - 60_000, atMs: now - 5_000 };
    const result = describeBuildStall(cached, now, DEFAULT_STALLED_AFTER_MS);
    expect(result.stalled).toBe(false);
    expect(result.elapsedMs).toBe(60_000);
    expect(result.lastProgressAtMs).toBe(now - 5_000);
  });

  it('reports the stalled phase with elapsed time and preserves no error', () => {
    const now = 2_000_000;
    const cached = { state: 'analyzing', phase: 'program', files: 5000, startedAtMs: now - 400_000, atMs: now - 300_000 };
    const result = describeBuildStall(cached, now, DEFAULT_STALLED_AFTER_MS);
    expect(result.stalled).toBe(true);
    expect(result.elapsedMs).toBe(400_000);
    expect(result.lastProgressAtMs).toBe(now - 300_000);
  });

  it('treats the threshold as a strict bound', () => {
    const now = 3_000_000;
    const cached = { state: 'discovering', startedAtMs: now - 1_000, atMs: now - 1_000 };
    expect(describeBuildStall(cached, now, 1_000).stalled).toBe(false);
    expect(describeBuildStall(cached, now + 1, 1_000).stalled).toBe(true);
  });
});

describe('host stall reporting on the fast path', () => {
  it('carries elapsed time and the last progress mark while preserving the phase', async () => {
    const workerRef = {};
    const host = spawnHost(workerRef);
    const directory = (await host.normalizeDirectory(join(root, 'project'))).directory
      ?? join(root, 'project');
    await fsPromises.mkdir(directory, { recursive: true });
    const normalized = (await host.normalizeDirectory(directory)).directory;

    const pending = host.readIndex(normalized).catch((error) => error);
    await flushing();
    expect(workerRef.worker.sent.some((message) => message.op === 'readIndex')).toBe(true);

    workerRef.worker.emit('message', {
      event: 'progress',
      progress: { directory: normalized, state: 'analyzing', phase: 'projects', files: 5000, projectsDone: 2, projectsTotal: 23, elapsedMs: 14_600, partial: { nodes: 120, edges: 90, modules: [{ module: 'a/b', count: 3 }], modulesTotal: 1 } },
    });

    const synthetic = await host.readIndex(normalized);
    expect(synthetic.ready).toBe(false);
    expect(synthetic.indexState.state).toBe('analyzing');
    expect(synthetic.indexState.phase).toBe('projects');
    expect(synthetic.indexState.files).toBe(5000);
    expect(synthetic.indexState.elapsedMs).toBe(14_600);
    expect(synthetic.indexState.partial).toEqual({ nodes: 120, edges: 90, modules: [{ module: 'a/b', count: 3 }], modulesTotal: 1 });
    expect(Number.isFinite(synthetic.indexState.lastProgressAtMs)).toBe(true);
    expect(synthetic.indexState.error ?? null).toBe(null);

    await host.cancelIndex(normalized);
    await pending.catch(() => undefined);
  });

  it('answers explore-during-build as honest unindexed with the partial modules attached', async () => {
    const workerRef = {};
    const host = spawnHost(workerRef);
    const directory = (await host.normalizeDirectory(join(root, 'explore-project'))).directory
      ?? join(root, 'explore-project');
    await fsPromises.mkdir(directory, { recursive: true });
    const normalized = (await host.normalizeDirectory(directory)).directory;

    const pending = host.readIndex(normalized).catch((error) => error);
    await flushing();
    workerRef.worker.emit('message', {
      event: 'progress',
      progress: {
        directory: normalized,
        state: 'analyzing',
        phase: 'projects',
        files: 100,
        projectsDone: 1,
        projectsTotal: 4,
        partial: { nodes: 10, edges: 5, modules: [{ module: 'a/b', count: 3 }], modulesTotal: 1 },
      },
    });

    const answer = await host.query(normalized, { kind: 'explore' });
    expect(answer.freshness).toBe('unindexed');
    expect(answer.coverage).toBe('unindexed');
    expect(Array.isArray(answer.modules)).toBe(true);
    expect(answer.modules).toEqual([{ module: 'a/b', count: 3 }]);
    expect(answer.indexState.state).toBe('analyzing');

    await host.cancelIndex(normalized);
    await pending.catch(() => undefined);
  });
});
