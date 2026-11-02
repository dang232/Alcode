import { mkdtempSync, promises as fsPromises, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphHost } from './host.js';

/**
 * Cancellation with teeth, proven without timing: a worker that never
 * answers (the synchronous engine holding its loop) is killed outright
 * through the production host API, and the run reports a truthful
 * terminal state instead of hanging on a phase boundary.
 */

const root = mkdtempSync(join(tmpdir(), 'code-graph-host-kill-'));
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
    // Never answers: the "build" holds the worker loop indefinitely.
  }

  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
  }
}

const flushing = () => new Promise((resolve) => setImmediate(resolve));

describe('host worker kill during an active build', () => {
  it('kills a blocked worker, rejects the pending call, and reports cancelled', async () => {
    let worker = null;
    const host = createCodeGraphHost({
      spawnWorker: () => {
        worker = new FakeWorker();
        queueMicrotask(() => worker.emit('message', { event: 'ready', pid: 4242 }));
        return worker;
      },
      storeDir: '',
    });
    const directory = (await host.normalizeDirectory(join(root, 'project'))).directory
      ?? join(root, 'project');
    await fsPromises.mkdir(directory, { recursive: true });
    const normalized = (await host.normalizeDirectory(directory)).directory;

    // A read starts the build; the worker never answers (engines holds its loop).
    const pending = host.readIndex(normalized).catch((error) => error);
    await flushing();
    expect(worker.sent.some((message) => message.op === 'readIndex')).toBe(true);

    // The worker reports an in-flight analyzing phase through its own channel.
    worker.emit('message', {
      event: 'progress',
      progress: { directory: normalized, state: 'analyzing', phase: 'projects', files: 100, projectsDone: 1, projectsTotal: 4 },
    });

    // Cancellation through the production host API kills the blocked worker.
    const cancelled = await host.cancelIndex(normalized);
    expect(cancelled).toMatchObject({ cancelled: true, killed: true, state: 'cancelled' });
    expect(worker.killed).toBe(true);

    // No orphan and no hang: the pending call rejects and the host is idle.
    const settled = await pending;
    expect(settled).toBeInstanceOf(Error);
    expect(host.hostState().running).toBe(false);

    // The UI reads a truthful terminal state, not a stuck spinner.
    const state = await host.indexState(normalized);
    expect(state.state).toBe('cancelled');
  });
});
