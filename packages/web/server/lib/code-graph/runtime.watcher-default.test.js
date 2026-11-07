import { execFile as realExecFile, execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWatcherEnv } from './host.js';
import { createCodeGraphRuntime } from './runtime.js';

/**
 * Every env value is set per test and restored afterwards: the runtime reads the
 * environment at call time, so a value set at import would leak between tests.
 */

const WATCHER_ENV_KEYS = [
  'ALCODE_CODE_GRAPH_WATCHER',
  'CODEGRAPH_WATCHER_ENABLED',
  'CODEGRAPH_NO_WATCHER',
  'CODEGRAPH_NO_DAEMON',
  'CODEGRAPH_SYNC_DISABLED',
];

const root = mkdtempSync(join(tmpdir(), 'code-graph-watcher-default-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let saved = {};
beforeEach(() => {
  saved = {};
  for (const key of WATCHER_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of WATCHER_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

let seq = 0;
const makeRepo = (files) => {
  const dir = join(root, `scope-${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  return dir;
};

const makeWatcherSeam = () => {
  const calls = { started: 0, closed: 0 };
  const watchFactory = () => {
    calls.started += 1;
    return {
      close: () => {
        calls.closed += 1;
      },
    };
  };
  return { calls, watchFactory };
};

const makeRuntime = (options = {}) => createCodeGraphRuntime({ fsPromises, path, execFile: realExecFile }, options);

describe('production host asks for watching', () => {
  it('the server constructs the code-graph host with watcherEnabled enabled', () => {
    // The production wiring itself: index.js is what starts the real host, so
    // this reads that call rather than trusting a default that is not there.
    const serverEntry = readFileSync(new URL('../../index.js', import.meta.url), 'utf8');
    const call = serverEntry.slice(serverEntry.indexOf('createCodeGraphHost('));
    const head = call.slice(0, call.indexOf(');') + 2);
    expect(head).toContain('watcherEnabled: true');
  });

  it('defaults the worker env to watching when the host asks and nothing is set', () => {
    expect(resolveWatcherEnv({ watcherEnabled: true }, {})).toEqual({ ALCODE_CODE_GRAPH_WATCHER: '1' });
  });

  it('never overwrites a watcher flag the operator set explicitly', () => {
    expect(resolveWatcherEnv({ watcherEnabled: true }, { ALCODE_CODE_GRAPH_WATCHER: '0' })).toEqual({});
    expect(resolveWatcherEnv({ watcherEnabled: true }, { ALCODE_CODE_GRAPH_WATCHER: '1' })).toEqual({});
  });

  it('carries an explicit disable down as the kill switch', () => {
    expect(resolveWatcherEnv({ watcherEnabled: false }, {})).toEqual({ CODEGRAPH_NO_WATCHER: '1' });
  });

  it('passes a finite debounce through and ignores a non-finite one', () => {
    expect(resolveWatcherEnv({ watcherEnabled: true, watcherDebounceMs: 250 }, {})).toEqual({
      ALCODE_CODE_GRAPH_WATCHER: '1',
      ALCODE_CODE_GRAPH_WATCH_DEBOUNCE_MS: '250',
    });
    expect(resolveWatcherEnv({ watcherEnabled: true, watcherDebounceMs: Number.NaN }, {})).toEqual({
      ALCODE_CODE_GRAPH_WATCHER: '1',
    });
  });
});

describe('watcher enable/disable precedence', () => {
  it('an explicit =0 flag beats a host that enables watching by default', async () => {
    process.env.ALCODE_CODE_GRAPH_WATCHER = '0';
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const runtime = makeRuntime({ watcherEnabled: true, watchFactory: () => ({ close: () => {} }) });
    await runtime.readIndex(dir);
    expect(runtime.watcherState().enabled).toBe(false);
    expect(runtime.watcherState().watchedScopes).toEqual([]);
    runtime.close();
  });

  it('an explicit =1 flag enables a runtime that was not asked to watch', async () => {
    process.env.ALCODE_CODE_GRAPH_WATCHER = '1';
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const seam = makeWatcherSeam();
    const runtime = makeRuntime({ watchFactory: seam.watchFactory });
    await runtime.readIndex(dir);
    expect(runtime.watcherState().enabled).toBe(true);
    expect(seam.calls.started).toBe(1);
    runtime.close();
  });

  it('stays disabled when nothing asks: the revision gate remains the default', async () => {
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const seam = makeWatcherSeam();
    const runtime = makeRuntime({ watchFactory: seam.watchFactory });
    await runtime.readIndex(dir);
    expect(runtime.watcherState().enabled).toBe(false);
    expect(seam.calls.started).toBe(0);
    runtime.close();
  });

  it('the settings sync gate beats a host that enables watching', async () => {
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const seam = makeWatcherSeam();
    const runtime = makeRuntime({ watcherEnabled: true, syncDisabled: true, watchFactory: seam.watchFactory });
    await runtime.readIndex(dir);
    expect(runtime.watcherState().enabled).toBe(false);
    expect(seam.calls.started).toBe(0);
    runtime.close();
  });

  it('the kill switch beats a host that enables watching', async () => {
    process.env.CODEGRAPH_NO_WATCHER = '1';
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const seam = makeWatcherSeam();
    const runtime = makeRuntime({ watcherEnabled: true, watchFactory: seam.watchFactory });
    await runtime.readIndex(dir);
    expect(runtime.watcherState().enabled).toBe(false);
    expect(seam.calls.started).toBe(0);
    runtime.close();
  });
});

describe('watcher lifecycle', () => {
  it('repeated reads on one scope start exactly one watcher', async () => {
    process.env.ALCODE_CODE_GRAPH_WATCHER = '1';
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n', 'b.ts': 'export const beta = 2;\n' });
    const seam = makeWatcherSeam();
    const runtime = makeRuntime({ watchFactory: seam.watchFactory });
    await runtime.readIndex(dir);
    await runtime.readIndex(dir, { refresh: true });
    await runtime.readIndex(dir);
    expect(seam.calls.started).toBe(1);
    expect(runtime.watcherState().watchedScopes.length).toBe(1);
    runtime.close();
  });

  it('close() disposes every watcher and its timers', async () => {
    process.env.ALCODE_CODE_GRAPH_WATCHER = '1';
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const seam = makeWatcherSeam();
    const runtime = makeRuntime({ watchFactory: seam.watchFactory });
    await runtime.readIndex(dir);
    expect(runtime.watcherState().watchedScopes.length).toBe(1);
    runtime.close();
    expect(seam.calls.closed).toBe(1);
    expect(runtime.watcherState().watchedScopes).toEqual([]);
  });

  it('a watcher that cannot start leaves the revision gate instead of throwing', async () => {
    process.env.ALCODE_CODE_GRAPH_WATCHER = '1';
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const runtime = makeRuntime({
      watchFactory: () => {
        throw new Error('EMFILE: too many open files');
      },
    });
    const summary = await runtime.readIndex(dir, { block: true });
    expect(summary.ready).toBe(true);
    expect(summary.entryCount).toBeGreaterThan(0);
    expect(runtime.watcherState().watchedScopes).toEqual([]);
    runtime.close();
  });

  it('a factory that returns no usable handle is ignored', async () => {
    process.env.ALCODE_CODE_GRAPH_WATCHER = '1';
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const runtime = makeRuntime({ watchFactory: () => null });
    const summary = await runtime.readIndex(dir, { block: true });
    expect(summary.ready).toBe(true);
    expect(summary.entryCount).toBeGreaterThan(0);
    expect(runtime.watcherState().watchedScopes).toEqual([]);
    runtime.close();
  });
});

describe('watcher state is published truthfully', () => {
  it('the index summary carries the resolved watcher state', async () => {
    process.env.ALCODE_CODE_GRAPH_WATCHER = '1';
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const seam = makeWatcherSeam();
    const runtime = makeRuntime({ watchFactory: seam.watchFactory });
    const summary = await runtime.readIndex(dir, { block: true });
    expect(summary.watcher).toEqual({ enabled: true, watchedScopes: 1, debounceMs: expect.any(Number) });
    runtime.close();
  });

  it('reports watching off when it is off, so the panel cannot claim otherwise', async () => {
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const runtime = makeRuntime({ watchFactory: makeWatcherSeam().watchFactory });
    const summary = await runtime.readIndex(dir, { block: true });
    expect(summary.watcher.enabled).toBe(false);
    expect(summary.watcher.watchedScopes).toBe(0);
    runtime.close();
  });
});
