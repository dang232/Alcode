// Fixture-driven tests for the OmO adapter-A runtime bridge. No engine is
// installed: the fixture snapshot JSON drives render/snapshot cases, scripted
// stub spawn/spawnSync stand in for the single worker spawn (the stub
// captures the stdin job, so kind selection is asserted without a runtime),
// and two tests use the real node binary / real child processes to prove
// the probe and kill paths.
import { describe, expect, it, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { spawn as realSpawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  OMO_BRIDGE_DEFAULT_ALCORE_MODELS,
  OMO_NATIVE_OK,
  OmoBridgeError,
  buildRunArgv,
  bunUnavailableMessage,
  cancelRun,
  checkNativeParity,
  createOmoBridgeRuntime,
  createSnapshotWriter,
  defaultSnapshotPath,
  defaultWorkerEntry,
  engineAbsentMessage,
  parseEventLine,
  providerForModel,
  resolveBunCommand,
  resolveEngineRoot,
  resolveNativeRunner,
  resolveRunModel,
  resolveWorkerRunner,
  splitModelRef,
} from './omo-bridge-runtime.js';

const fixture = JSON.parse(readFileSync(new URL('./omo-bridge-fixture.json', import.meta.url), 'utf8'));

const createMemoryFs = () => {
  const files = new Map();
  return {
    files,
    writeFileSync: (path, content) => {
      files.set(path, String(content));
    },
    renameSync: (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
};

const liveChildren = [];
afterEach(() => {
  for (const child of liveChildren.splice(0)) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited; nothing to clean up.
    }
  }
});

// Scripted stand-in for the wrapper entry: answers --version and run --help
// from canned text so probe tests never touch a real engine.
const stubSpawnSync = ({ versionText = 'omo-fixture 9.9.9', helpText = 'run <message> --port <port> --attach <url> --session-id <id> --json' } = {}) => {
  const calls = [];
  const spawnSync = (entry, args, options) => {
    calls.push({ entry, args, options });
    if (args[0] === '--version') {
      return { status: 0, stdout: `${versionText}\n`, error: undefined };
    }
    return { status: 0, stdout: `${helpText}\n`, error: undefined };
  };
  return { spawnSync, calls };
};

class FakeStdout extends EventEmitter {}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new FakeStdout();
    this.stderr = new FakeStdout();
    this.exitCode = null;
    this.signalCode = null;
    this.killedWith = [];
  }
  kill(signal = 'SIGTERM') {
    this.killedWith.push(signal);
    if (this.exitCode !== null) {
      return false;
    }
    this.exitCode = null;
    this.signalCode = signal;
    this.emit('exit', null, signal);
    this.emit('close', null, signal);
    return true;
  }
}

// Scripted stand-in for the single worker spawn: records entry/argv, captures
// the stdin job (kind selection is asserted off this, never off a real
// runtime), and lets each test script stdout lines plus the exit.
const stubSpawn = ({ lines = [], exitCode = 0 } = {}) => {
  const calls = [];
  let child;
  const spawn = (entry, argv, options) => {
    calls.push({ entry, argv, options });
    child = new FakeChild();
    child.stdinText = '';
    child.stdin = {
      write: (text) => { child.stdinText += String(text); },
      end: () => {},
    };
    setImmediate(() => {
      for (const line of lines) {
        child.stdout.emit('data', `${line}\n`);
      }
      child.exitCode = exitCode;
      child.emit('exit', exitCode, null);
      child.emit('close', exitCode, null);
    });
    return child;
  };
  return { spawn, calls, getChild: () => child };
};

// The stdin job one worker spawn carried (the bridge writes exactly one
// JSON line per run).
const stdinJob = (stub) => JSON.parse(stub.getChild().stdinText);

describe('probe (version/capability handshake)', () => {
  it('engine-absent yields the documented degraded message and never hangs', async () => {
    const startedAt = Date.now();
    // Hermetic no-engine-anywhere deps: a bare entry path plus stubs that
    // resolve nothing, so neither the wrapper nor the native/vendored
    // fallback can answer (the default real env/fs would find the vendored
    // in-tree engine and take the native path instead).
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/nonexistent/oh-my-opencode.js',
      existsSync: () => false,
      env: {},
    });
    const result = await bridge.probe({ timeoutMs: 1000 });
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(result.available).toBe(false);
    expect(result.code).toBe('OMO_ENGINE_ABSENT');
    expect(result.message).toContain('stays empty');
    expect(result.message).toContain('nothing is fetched automatically');
  });

  it('unresolved entry degrades the same way', async () => {
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => null,
      existsSync: () => false,
      env: {},
    });
    const result = await bridge.probe({ timeoutMs: 1000 });
    expect(result.available).toBe(false);
    expect(result.code).toBe('OMO_ENGINE_ABSENT');
  });

  it('missing entry with a resolvable native engine probes available over native', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omo-probe-native-'));
    try {
      const barrel = join(root, 'packages', 'omo-engine', 'omo-opencode', 'src', 'cli', 'run', 'index.ts');
      mkdirSync(dirname(barrel), { recursive: true });
      writeFileSync(barrel, '// fixture vendored barrel');
      const worker = join(root, 'omo-invoker-worker.ts');
      writeFileSync(worker, '// fixture worker');
      const bun = join(root, 'bun');
      writeFileSync(bun, '#!/bin/sh\n');
      const bridge = createOmoBridgeRuntime({
        resolveEngineEntry: () => null,
        env: { OMO_BUN_PATH: bun },
      });
      const result = await bridge.probe({ workerEntry: worker, bridgeDir: join(root, 'packages', 'web', 'server', 'lib', 'opencode') });
      expect(result.available).toBe(true);
      expect(result.code).toBe('OMO_PROBE_OK');
      expect(result.native).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compatible stub answers version plus all four run flags', async () => {
    const { spawnSync } = stubSpawnSync();
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      spawnSync,
    });
    const result = await bridge.probe();
    expect(result.available).toBe(true);
    expect(result.compatible).toBe(true);
    expect(result.code).toBe('OMO_PROBE_OK');
    expect(result.version).toBe('9.9.9');
    expect(result.runFlags).toEqual(['--port', '--attach', '--session-id', '--json']);
    expect(result.missingRunFlags).toEqual([]);
  });

  it('stub missing flags reports incompatible with the missing names', async () => {
    const { spawnSync } = stubSpawnSync({ helpText: 'run <message> --port <port>' });
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      spawnSync,
    });
    const result = await bridge.probe();
    expect(result.available).toBe(true);
    expect(result.compatible).toBe(false);
    expect(result.code).toBe('OMO_PROBE_INCOMPATIBLE');
    expect(result.missingRunFlags).toEqual(['--attach', '--session-id', '--json']);
  });

  it('wedged engine hits the bounded timeout instead of hanging', async () => {
    const spawnSync = () => {
      const error = new Error('timed out');
      error.code = 'ETIMEDOUT';
      return { status: null, stdout: '', error };
    };
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      spawnSync,
    });
    const startedAt = Date.now();
    const result = await bridge.probe({ timeoutMs: 300 });
    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(result.available).toBe(false);
    expect(result.code).toBe('OMO_PROBE_TIMEOUT');
  });

  it('real node binary answers --version through the real spawnSync path', async () => {
    const bridge = createOmoBridgeRuntime({ resolveEngineEntry: () => process.execPath });
    const result = await bridge.probe({ timeoutMs: 10000 });
    expect(result.available).toBe(true);
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
    // Neither node nor bun has a `run` subcommand: the flag check honestly
    // reports incompatibility. Assert the stable subset: bun's own help text
    // mentions --port, so exact equality would couple the test to the runner.
    expect(result.compatible).toBe(false);
    expect(result.missingRunFlags).toEqual(expect.arrayContaining(['--attach', '--session-id', '--json']));
  });

  it('includeToolkit carries the toolkit record only when opted in', async () => {
    const { spawnSync } = stubSpawnSync();
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      spawnSync,
    });
    const withToolkit = await bridge.probe({ includeToolkit: true });
    expect(withToolkit.available).toBe(true);
    expect(withToolkit.code).toBe('OMO_PROBE_OK');
    expect('toolkit' in withToolkit).toBe(true);
    const plain = await bridge.probe();
    expect('toolkit' in plain).toBe(false);
  });
});

describe('invoke (wrapper-kind jobs through the worker)', () => {
  it('port variant sends a wrapper-kind job and keeps the wrapper argv on the handle', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      env: { OMO_NATIVE_RUN: '0', OMO_BUN_PATH: '/x/bun' },
      spawn: stub.spawn,
    });
    const handle = bridge.invoke({ message: 'Fix the bug', port: 4321 });
    expect(handle.entry).toBe('/user/engine/bin/oh-my-opencode.js');
    expect(handle.native).toBe(false);
    expect(handle.argv).toEqual(['run', 'Fix the bug', '--port', '4321', '--json']);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].entry).toBe('/x/bun');
    expect(stub.calls[0].argv[0].endsWith('omo-invoker-worker.ts')).toBe(true);
    expect(stub.calls[0].argv).not.toContain('--engine-root');
    expect(stdinJob(stub)).toEqual({
      kind: 'wrapper',
      message: 'Fix the bug',
      port: 4321,
      wrapperEntry: '/user/engine/bin/oh-my-opencode.js',
      wrapperArgv: ['run', 'Fix the bug', '--port', '4321', '--json'],
    });
  });

  it('attach plus session-id variant keeps the documented order in the job', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      env: { OMO_NATIVE_RUN: '0', OMO_BUN_PATH: '/x/bun' },
      spawn: stub.spawn,
    });
    const handle = bridge.invoke({ message: 'Continue', attachUrl: 'http://127.0.0.1:4321', sessionId: 'ses_abc123' });
    expect(handle.argv).toEqual(['run', 'Continue', '--attach', 'http://127.0.0.1:4321', '--session-id', 'ses_abc123', '--json']);
    expect(stdinJob(stub)).toMatchObject({
      kind: 'wrapper',
      message: 'Continue',
      attach: 'http://127.0.0.1:4321',
      sessionId: 'ses_abc123',
      wrapperEntry: '/user/engine/bin/oh-my-opencode.js',
      wrapperArgv: ['run', 'Continue', '--attach', 'http://127.0.0.1:4321', '--session-id', 'ses_abc123', '--json'],
    });
  });

  it('port plus attach together is rejected (Gap 2 mutual exclusivity)', () => {
    expect(() => buildRunArgv({ message: 'x', port: 1, attachUrl: 'http://127.0.0.1:1' }))
      .toThrow(/mutually exclusive/);
  });

  it('out-of-range ports are rejected (Gap 4 range 1..65535)', () => {
    for (const port of [0, -1, 99999, 1.5]) {
      expect(() => buildRunArgv({ message: 'x', port })).toThrow(/Port must be between 1 and 65535/);
    }
  });

  it('empty message is rejected', () => {
    expect(() => buildRunArgv({ message: '   ' })).toThrow(/non-empty message/);
  });

  it('engine-absent throws the degraded message instead of spawning', () => {
    const { spawn, calls } = stubSpawn();
    // Hermetic no-engine-anywhere deps (see the probe cases above): with
    // nothing resolvable the absent error still throws before any spawn.
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => null,
      existsSync: () => false,
      env: {},
      spawn,
    });
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_ENGINE_ABSENT');
    expect(thrown.message).toContain('stays empty');
    expect(calls).toEqual([]);
  });

  it('missing entry invokes native through the default path instead of throwing absent', () => {
    const { spawn, calls } = stubSpawn();
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => null,
      // Deterministic native setup: the runner's own binary answers
      // OMO_BUN_PATH (existence is all the gate checks; spawn is stubbed),
      // while the worker and the vendored engine resolve from this checkout.
      env: { OMO_BUN_PATH: process.execPath },
      spawn,
    });
    let handle = null;
    expect(() => { handle = bridge.invoke({ message: 'hi', sessionId: 'ses_n1' }); }).not.toThrow();
    expect(handle.native).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].entry).toBe(process.execPath);
    expect(calls[0].argv[0].endsWith('omo-invoker-worker.ts')).toBe(true);
    expect(calls[0].argv).toContain('--engine-root');
  });

  it('wait resolves the --json final result relayed through the worker', async () => {
    const stub = stubSpawn({ lines: [JSON.stringify(fixture.runResult)], exitCode: 0 });
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      env: { OMO_BUN_PATH: '/x/bun' },
      spawn: stub.spawn,
    });
    const handle = bridge.invoke({ message: 'hi', native: false });
    expect(handle.native).toBe(false);
    expect(stdinJob(stub)).toMatchObject({ kind: 'wrapper', message: 'hi' });
    const settled = await handle.wait();
    expect(settled.exitCode).toBe(0);
    expect(settled.result).toMatchObject({ sessionId: 'ses_fixture01', success: true });
    expect(settled.sessionId).toBe('ses_fixture01');
  });

  it('worker spawn failure throws the exact degraded message', () => {
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      env: { OMO_BUN_PATH: '/x/bun' },
      spawn: () => { throw new Error('spawn ENOENT'); },
    });
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi', native: false });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(thrown.message).toContain('Omo run worker could not start via "/x/bun"');
  });
});

describe('model binding (Slice E: catalog role to provider gate)', () => {
  const engine = (extra = {}) => ({
    resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
    existsSync: () => true,
    // Pin the wrapper kind: these tests assert Slice-E argv on the wrapper
    // contract, and the T9 default would otherwise take the native kind
    // (existsSync stubs everything resolvable). The rollback itself is
    // covered by the kind-selection describe below.
    env: { OMO_NATIVE_RUN: '0', OMO_BUN_PATH: '/x/bun' },
    ...extra,
  });

  it('explicit model wins over catalog role and current', () => {
    expect(resolveRunModel({
      model: 'alcore/al-1-2',
      catalog: { current: { model: 'gpt-6-astra' }, roles: { default: { model: 'gpt-5' } } },
    })).toBe('alcore/al-1-2');
  });

  it('role model wins over current, current is the fallback', () => {
    expect(resolveRunModel({
      catalog: { current: { model: 'gpt-6-astra' }, roles: { default: { model: 'al-1-2-flash' } } },
    })).toBe('al-1-2-flash');
    expect(resolveRunModel({ catalog: { current: { model: 'gpt-6-astra' } } })).toBe('gpt-6-astra');
    expect(resolveRunModel({ role: 'worker', catalog: { roles: { worker: { model: 'al-1-2' } } } }))
      .toBe('al-1-2');
  });

  it('malformed catalogs resolve to null (run proceeds ungated)', () => {
    expect(resolveRunModel({})).toBeNull();
    expect(resolveRunModel({ catalog: null })).toBeNull();
    expect(resolveRunModel({ catalog: { roles: { default: {} } } })).toBeNull();
    expect(resolveRunModel({ model: '   ' })).toBeNull();
  });

  it('alcore ids map to alcore bare or prefixed, case-insensitively', () => {
    expect(providerForModel('al-1-3-max')).toBe('alcore');
    expect(providerForModel('alcore/al-1-2')).toBe('alcore');
    expect(providerForModel('ALCORE/AL-1-2-FLASH')).toBe('alcore');
    expect(OMO_BRIDGE_DEFAULT_ALCORE_MODELS.length).toBeGreaterThan(0);
  });

  it('explicit map hits by full ref then bare id, unknown reads null', () => {
    const map = { 'openai/gpt-6-astra': 'openai', 'gpt-5': 'openai' };
    expect(providerForModel('openai/gpt-6-astra', { modelProviders: map })).toBe('openai');
    expect(providerForModel('gpt-5', { modelProviders: map })).toBe('openai');
    expect(providerForModel('gpt-9', { modelProviders: map })).toBeNull();
    expect(providerForModel('   ', { modelProviders: map })).toBeNull();
  });

  it('splitModelRef separates provider and bare id', () => {
    expect(splitModelRef('openai/gpt-5')).toEqual({ provider: 'openai', name: 'gpt-5' });
    expect(splitModelRef('al-1-2')).toEqual({ provider: null, name: 'al-1-2' });
    expect(splitModelRef('  ')).toBeNull();
  });

  it('--model builds into argv, blank or whitespacey models are rejected', () => {
    expect(buildRunArgv({ message: 'x', model: 'alcore/al-1-2' }))
      .toEqual(['run', 'x', '--model', 'alcore/al-1-2', '--json']);
    expect(() => buildRunArgv({ message: 'x', model: '  ' })).toThrow(/model must be/);
    expect(() => buildRunArgv({ message: 'x', model: 'openai/gpt 5' })).toThrow(/model must be/);
  });

  it('--agent builds into argv between session-id and model, blanks rejected', () => {
    expect(buildRunArgv({ message: 'x', sessionId: 's1', agent: 'atlas', model: 'alcore/al-1-2' }))
      .toEqual(['run', 'x', '--session-id', 's1', '--agent', 'atlas', '--model', 'alcore/al-1-2', '--json']);
    expect(() => buildRunArgv({ message: 'x', agent: '  ' })).toThrow(/agent must be/);
    expect(() => buildRunArgv({ message: 'x', agent: 'my agent' })).toThrow(/agent must be/);
  });

  it('invoke passes an explicit agent into the wrapper-kind job', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(engine({ spawn: stub.spawn }));
    const handle = bridge.invoke({ message: 'hi', agent: 'atlas' });
    expect(handle.argv).toEqual(['run', 'hi', '--agent', 'atlas', '--json']);
    expect(stdinJob(stub)).toMatchObject({ kind: 'wrapper', message: 'hi', agent: 'atlas' });
  });

  it('unsigned provider fails fast naming model and provider before any spawn', () => {
    const { spawn, calls } = stubSpawn();
    const bridge = createOmoBridgeRuntime(engine({
      spawn,
      modelProviders: { 'gpt-6-astra': 'openai' },
      isProviderReady: () => false,
    }));
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi', model: 'gpt-6-astra' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_PROVIDER_NOT_SIGNED_IN');
    expect(thrown.message).toContain('gpt-6-astra');
    expect(thrown.message).toContain('openai');
    expect(thrown.details).toMatchObject({ model: 'gpt-6-astra', provider: 'openai' });
    expect(calls).toEqual([]);
  });

  it('alcore-bound run pins --model alcore/<id> in the job', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(engine({
      spawn: stub.spawn,
      isProviderReady: (provider) => provider === 'alcore',
    }));
    const handle = bridge.invoke({ message: 'hi', model: 'al-1-3-max' });
    expect(handle.argv).toEqual(['run', 'hi', '--model', 'alcore/al-1-3-max', '--json']);
    expect(stdinJob(stub)).toMatchObject({ kind: 'wrapper', model: 'alcore/al-1-3-max' });
  });

  it('catalog role resolving to alcore pins --model from the role', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(engine({
      spawn: stub.spawn,
      isProviderReady: () => true,
      modelCatalog: { current: { model: 'gpt-6-astra' }, roles: { default: { model: 'al-1-2-flash' } } },
    }));
    const handle = bridge.invoke({ message: 'hi' });
    expect(handle.argv).toEqual(['run', 'hi', '--model', 'alcore/al-1-2-flash', '--json']);
    expect(stdinJob(stub)).toMatchObject({ kind: 'wrapper', model: 'alcore/al-1-2-flash' });
  });

  it('explicit non-alcore model with a ready provider travels as-given', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(engine({
      spawn: stub.spawn,
      modelProviders: { 'openai/gpt-5': 'openai' },
      isProviderReady: () => true,
    }));
    const handle = bridge.invoke({ message: 'hi', model: 'openai/gpt-5' });
    expect(handle.argv).toEqual(['run', 'hi', '--model', 'openai/gpt-5', '--json']);
    expect(stdinJob(stub)).toMatchObject({ kind: 'wrapper', model: 'openai/gpt-5' });
  });

  it('unknown provider proceeds ungated without --model', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(engine({ spawn: stub.spawn, isProviderReady: () => false }));
    const handle = bridge.invoke({
      message: 'hi',
      catalog: { current: { model: 'gpt-9' } },
    });
    expect(stub.calls).toHaveLength(1);
    expect(handle.argv).toEqual(['run', 'hi', '--json']);
    expect(stdinJob(stub)).toMatchObject({ kind: 'wrapper', message: 'hi' });
    expect(stdinJob(stub).model).toBeUndefined();
  });

  it('a broken checker never wedges runs (gate skipped)', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(engine({
      spawn: stub.spawn,
      isProviderReady: () => { throw new Error('checker down'); },
    }));
    const handle = bridge.invoke({ message: 'hi', model: 'al-1-2' });
    expect(stub.calls).toHaveLength(1);
    expect(handle.argv).toEqual(['run', 'hi', '--model', 'alcore/al-1-2', '--json']);
    expect(stdinJob(stub)).toMatchObject({ kind: 'wrapper', model: 'alcore/al-1-2' });
  });

  it('unwired gate keeps the exact legacy argv on the handle and in the job', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(engine({ spawn: stub.spawn }));
    const handle = bridge.invoke({ message: 'hi', port: 4321 });
    expect(handle.argv).toEqual(['run', 'hi', '--port', '4321', '--json']);
    expect(stdinJob(stub)).toMatchObject({
      kind: 'wrapper',
      message: 'hi',
      port: 4321,
      wrapperArgv: ['run', 'hi', '--port', '4321', '--json'],
    });
  });
});

describe('one run path (worker serves both kinds)', () => {
  const nativeEngine = (extra = {}) => ({
    resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
    existsSync: () => true,
    ...extra,
  });

  it('explicit engine root wins, derived root needs the run barrel', () => {
    expect(resolveEngineRoot('/user/engine/bin/oh-my-opencode.js', {
      env: { OMO_ENGINE_ROOT: '/custom/root' },
      existsSync: () => { throw new Error('must not probe'); },
    })).toEqual({ root: '/custom/root', vendored: false });
    const seen = [];
    expect(resolveEngineRoot('/user/engine/bin/oh-my-opencode.js', {
      env: {},
      existsSync: (p) => { seen.push(p); return true; },
    })).toEqual({ root: '/user/engine', vendored: false });
    expect(seen.some((p) => String(p).includes('run') && String(p).includes('index.ts'))).toBe(true);
    let thrown = null;
    try {
      resolveEngineRoot('/user/engine/bin/oh-my-opencode.js', { env: {}, existsSync: () => false });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
  });

  it('missing wrapper falls back to the vendored in-tree engine, else refuses', () => {
    expect(resolveEngineRoot(null, {
      env: {},
      existsSync: (p) => String(p).includes('omo-engine'),
    })).toEqual(expect.objectContaining({ vendored: true }));
    let thrown = null;
    try {
      resolveEngineRoot(null, { env: {}, existsSync: () => false });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
  });

  it('missing worker file refuses before any spawn', () => {
    let thrown = null;
    try {
      resolveNativeRunner({
        wrapperEntry: '/user/engine/bin/oh-my-opencode.js',
        env: {},
        existsSync: (p) => !String(p).endsWith('.ts'),
        workerEntry: '/user/worker/omo-invoker-worker.ts',
        bunPath: 'bun',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
  });

  it('default worker entry is the module sibling', () => {
    expect(defaultWorkerEntry().endsWith('omo-invoker-worker.ts')).toBe(true);
  });

  it('native-kind invoke spawns bun with the job on stdin and the same handle shape', async () => {
    const calls = [];
    let stdinText = '';
    let stdinEnded = false;
    const child = new FakeChild();
    child.stdin = {
      write: (text) => { stdinText += String(text); },
      end: () => { stdinEnded = true; },
    };
    const spawn = (entry, argv, options) => {
      calls.push({ entry, argv, options });
      setImmediate(() => {
        child.stdout.emit('data', `${JSON.stringify(fixture.runResult)}\n`);
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      });
      return child;
    };
    const bridge = createOmoBridgeRuntime(nativeEngine({
      spawn,
      nativeRunner: {
        workerEntry: '/user/worker/omo-invoker-worker.ts',
        bunPath: 'bun',
        engineRoot: '/user/engine',
      },
    }));
    const handle = bridge.invoke({ message: 'hi', sessionId: 'ses_n1' });
    expect(handle.native).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].entry).toBe('bun');
    expect(calls[0].argv).toEqual(['/user/worker/omo-invoker-worker.ts', '--engine-root', '/user/engine']);
    expect(calls[0].options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(JSON.parse(stdinText)).toMatchObject({ kind: 'native', message: 'hi' });
    expect(stdinEnded).toBe(true);
    const settled = await handle.wait();
    expect(settled.exitCode).toBe(0);
    expect(settled.result).toMatchObject({ sessionId: 'ses_fixture01', success: true });
  });

  it('opt-in flag with unresolvable setup fails fast naming native, never downgrades', () => {
    const { spawn, calls } = stubSpawn();
    const bridge = createOmoBridgeRuntime(nativeEngine({
      spawn,
      env: { OMO_NATIVE_RUN: '1' },
      existsSync: (p) => !String(p).endsWith('.ts'),
    }));
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(calls).toEqual([]);
  });

  it('vendored runner passes --barrel-path to the worker', async () => {
    const calls = [];
    const child = new FakeChild();
    child.stdin = { write: () => {}, end: () => {} };
    const spawn = (entry, argv) => {
      calls.push({ entry, argv });
      setImmediate(() => {
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      });
      return child;
    };
    const bridge = createOmoBridgeRuntime(nativeEngine({
      spawn,
      nativeRunner: {
        workerEntry: '/user/worker/omo-invoker-worker.ts',
        bunPath: 'bun',
        engineRoot: '/user/tree/packages/omo-engine',
        barrelPath: '/user/tree/packages/omo-engine/omo-opencode/src/cli/run/index.ts',
      },
    }));
    const handle = bridge.invoke({ message: 'hi' });
    expect(handle.native).toBe(true);
    expect(calls[0].argv).toEqual([
      '/user/worker/omo-invoker-worker.ts',
      '--engine-root', '/user/tree/packages/omo-engine',
      '--barrel-path', '/user/tree/packages/omo-engine/omo-opencode/src/cli/run/index.ts',
    ]);
    await handle.wait();
  });

  it('env rollback runs the wrapper kind through the worker, not a direct spawn', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(nativeEngine({
      spawn: stub.spawn,
      env: { OMO_NATIVE_RUN: '0', OMO_BUN_PATH: '/x/bun' },
    }));
    const handle = bridge.invoke({ message: 'hi', port: 4321 });
    expect(handle.native).toBe(false);
    expect(handle.argv).toEqual(['run', 'hi', '--port', '4321', '--json']);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].entry).toBe('/x/bun');
    expect(stdinJob(stub)).toEqual({
      kind: 'wrapper',
      message: 'hi',
      port: 4321,
      wrapperEntry: '/user/engine/bin/oh-my-opencode.js',
      wrapperArgv: ['run', 'hi', '--port', '4321', '--json'],
    });
  });

  it('resolveWorkerRunner answers bun plus worker with no engine checkout', () => {
    expect(resolveWorkerRunner({
      env: { OMO_BUN_PATH: '/x/bun' },
      existsSync: (p) => p === '/x/bun' || String(p).endsWith('omo-invoker-worker.ts'),
      workerEntry: '/user/worker/omo-invoker-worker.ts',
    })).toEqual({ workerEntry: '/user/worker/omo-invoker-worker.ts', bunPath: '/x/bun' });
  });

  it('resolveWorkerRunner refuses with the exact gate messages before any spawn', () => {
    let missing = null;
    try {
      resolveWorkerRunner({ env: {}, existsSync: () => false, workerEntry: '/user/worker/omo-invoker-worker.ts' });
    } catch (error) {
      missing = error;
    }
    expect(missing).toBeInstanceOf(OmoBridgeError);
    expect(missing.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(missing.message).toBe(
      'Native runner unavailable: native worker missing at "/user/worker/omo-invoker-worker.ts". The wrapper path is kept.',
    );
    let bunless = null;
    try {
      resolveWorkerRunner({
        env: {},
        existsSync: (p) => String(p).endsWith('omo-invoker-worker.ts'),
        workerEntry: '/user/worker/omo-invoker-worker.ts',
      });
    } catch (error) {
      bunless = error;
    }
    expect(bunless).toBeInstanceOf(OmoBridgeError);
    expect(bunless.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(bunless.message).toBe(bunUnavailableMessage({ source: 'path', path: 'bun' }));
  });
});

describe('native parity gate (structured, carried forward from T1)', () => {
  const BUN_ABSENT_MESSAGE = 'Native runner unavailable: bun was not found on PATH and OMO_BUN_PATH is unset. The wrapper path is kept; install bun or set OMO_BUN_PATH to run natively.';
  const noBunScrubbedPath = { env: {}, pathValue: '', platform: 'linux' };

  it('bun-absent yields wrapper path plus the exact degraded message', () => {
    const result = checkNativeParity({
      ...noBunScrubbedPath,
      existsSync: () => true,
      workerEntry: '/user/worker/omo-invoker-worker.ts',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(result.path).toBe('wrapper');
    expect(result.message).toBe(BUN_ABSENT_MESSAGE);
    expect(result.details).toMatchObject({ bunFound: false, bunSource: 'path' });
  });

  it('gate passes with a fixture engine root (derived wrapper layout)', () => {
    const root = mkdtempSync(join(tmpdir(), 'omo-gate-derived-'));
    try {
      const barrel = join(root, 'packages', 'omo-opencode', 'src', 'cli', 'run', 'index.ts');
      mkdirSync(dirname(barrel), { recursive: true });
      writeFileSync(barrel, '// fixture barrel');
      const worker = join(root, 'omo-invoker-worker.ts');
      writeFileSync(worker, '// fixture worker');
      const bun = join(root, 'bun');
      writeFileSync(bun, '#!/bin/sh\n');
      const result = checkNativeParity({
        wrapperEntry: join(root, 'bin', 'oh-my-opencode.js'),
        env: { OMO_BUN_PATH: bun },
        workerEntry: worker,
      });
      expect(result.ok).toBe(true);
      expect(result.code).toBe(OMO_NATIVE_OK);
      expect(result.path).toBe('native');
      expect(result.message).toBeNull();
      expect(result.details).toMatchObject({
        bunSource: 'env',
        bunFound: true,
        workerFound: true,
        engineRoot: root,
        vendored: false,
        engineFound: true,
        barrelPath: barrel,
        barrelFound: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('vendored layout resolves its own barrel', () => {
    const root = mkdtempSync(join(tmpdir(), 'omo-gate-vendored-'));
    try {
      const barrel = join(root, 'packages', 'omo-engine', 'omo-opencode', 'src', 'cli', 'run', 'index.ts');
      mkdirSync(dirname(barrel), { recursive: true });
      writeFileSync(barrel, '// fixture vendored barrel');
      const worker = join(root, 'worker.ts');
      writeFileSync(worker, '// fixture worker');
      const bun = join(root, 'bun');
      writeFileSync(bun, '#!/bin/sh\n');
      const result = checkNativeParity({
        wrapperEntry: null,
        env: { OMO_BUN_PATH: bun },
        workerEntry: worker,
        bridgeDir: join(root, 'packages', 'web', 'server', 'lib', 'opencode'),
      });
      expect(result.ok).toBe(true);
      expect(result.path).toBe('native');
      expect(result.details).toMatchObject({ vendored: true, barrelPath: barrel, barrelFound: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bun found by scanning PATH resolves with source path', () => {
    const wanted = join('/nothing-here', 'bun');
    const result = checkNativeParity({
      env: {},
      pathValue: ['/nothing-here', '/also-nothing'].join(':'),
      platform: 'linux',
      workerEntry: '/user/worker/omo-invoker-worker.ts',
      wrapperEntry: '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
    });
    expect(result.ok).toBe(true);
    expect(result.path).toBe('native');
    expect(result.details).toMatchObject({ bunSource: 'path', bunPath: wanted, bunFound: true });
  });

  it('empty OMO_BUN_PATH fails closed as unset, never crashes', () => {
    let result = null;
    expect(() => {
      result = checkNativeParity({
        env: { OMO_BUN_PATH: '   ' },
        existsSync: () => true,
        workerEntry: '/user/worker/omo-invoker-worker.ts',
      });
    }).not.toThrow();
    expect(result.path).toBe('wrapper');
    expect(result.message).toBe(BUN_ABSENT_MESSAGE);
  });

  it('unresolvable OMO_BUN_PATH names the path exactly', () => {
    const result = checkNativeParity({
      env: { OMO_BUN_PATH: '/nope/bun' },
      existsSync: () => false,
      workerEntry: '/user/worker/omo-invoker-worker.ts',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(result.path).toBe('wrapper');
    expect(result.message).toBe(
      'Native runner unavailable: OMO_BUN_PATH points at "/nope/bun" which does not resolve. '
      + 'The wrapper path is kept; fix OMO_BUN_PATH or install bun on PATH to run natively.',
    );
    expect(result.details).toMatchObject({ bunSource: 'env', bunFound: false });
  });

  it('missing worker file fails closed with the exact message', () => {
    const result = checkNativeParity({
      env: { OMO_BUN_PATH: '/x/bun' },
      existsSync: (p) => p === '/x/bun',
      workerEntry: '/user/worker/omo-invoker-worker.ts',
    });
    expect(result.ok).toBe(false);
    expect(result.path).toBe('wrapper');
    expect(result.message).toBe(
      'Native runner unavailable: native worker missing at "/user/worker/omo-invoker-worker.ts". The wrapper path is kept.',
    );
    expect(result.details).toMatchObject({ bunFound: true, workerFound: false });
  });

  it('nonexistent engine root fails closed on the barrel probe', () => {
    let result = null;
    expect(() => {
      result = checkNativeParity({
        env: { OMO_BUN_PATH: '/x/bun', OMO_ENGINE_ROOT: '/nope/root' },
        existsSync: (p) => p === '/x/bun' || p === '/user/worker/omo-invoker-worker.ts',
        workerEntry: '/user/worker/omo-invoker-worker.ts',
      });
    }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.path).toBe('wrapper');
    expect(result.message).toBe(
      `Native runner unavailable: engine run barrel missing at "${join('/nope/root', 'packages', 'omo-opencode', 'src', 'cli', 'run', 'index.ts')}". The wrapper path is kept.`,
    );
    expect(result.details).toMatchObject({ engineRoot: '/nope/root', barrelFound: false });
  });

  it('runtime gate binds wrapper entry and env from its deps', () => {
    const root = mkdtempSync(join(tmpdir(), 'omo-gate-runtime-'));
    try {
      const barrel = join(root, 'packages', 'omo-opencode', 'src', 'cli', 'run', 'index.ts');
      mkdirSync(dirname(barrel), { recursive: true });
      writeFileSync(barrel, '// fixture barrel');
      const worker = join(root, 'omo-invoker-worker.ts');
      writeFileSync(worker, '// fixture worker');
      const bun = join(root, 'bun');
      writeFileSync(bun, '#!/bin/sh\n');
      const bridge = createOmoBridgeRuntime({
        resolveEngineEntry: () => join(root, 'bin', 'oh-my-opencode.js'),
        env: { OMO_BUN_PATH: bun },
      });
      const result = bridge.checkNativeParity({ workerEntry: worker });
      expect(result.ok).toBe(true);
      expect(result.path).toBe('native');
      expect(result.details).toMatchObject({ engineRoot: root, barrelFound: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolveBunCommand never throws on a missing PATH', () => {
    expect(resolveBunCommand({ env: {}, pathValue: '', platform: 'linux', existsSync: () => true }))
      .toEqual({ source: 'path', path: 'bun', found: false });
    expect(resolveBunCommand({ env: { OMO_BUN_PATH: '  ' }, existsSync: () => { throw new Error('must not probe'); } }))
      .toEqual({ source: 'path', path: 'bun', found: false });
  });
});

describe('one run path (kind selection on the default)', () => {
  const BUN_ABSENT_MESSAGE = 'Native runner unavailable: bun was not found on PATH and OMO_BUN_PATH is unset. The wrapper path is kept; install bun or set OMO_BUN_PATH to run natively.';
  const capable = (extra = {}) => ({
    resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
    existsSync: () => true,
    env: { OMO_BUN_PATH: '/x/bun' },
    ...extra,
  });

  it('default on a capable machine runs native with the job on stdin', async () => {
    const calls = [];
    let stdinText = '';
    const child = new FakeChild();
    child.stdin = {
      write: (text) => { stdinText += String(text); },
      end: () => {},
    };
    const spawn = (entry, argv, options) => {
      calls.push({ entry, argv, options });
      setImmediate(() => {
        child.stdout.emit('data', `${JSON.stringify(fixture.runResult)}\n`);
        child.exitCode = 0;
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      });
      return child;
    };
    const bridge = createOmoBridgeRuntime(capable({ spawn }));
    const handle = bridge.invoke({ message: 'hi', sessionId: 'ses_n1' });
    expect(handle.native).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].entry).toBe('/x/bun');
    expect(calls[0].argv[0].endsWith('omo-invoker-worker.ts')).toBe(true);
    expect(calls[0].argv).toContain('--engine-root');
    expect(JSON.parse(stdinText)).toMatchObject({ kind: 'native', message: 'hi', sessionId: 'ses_n1' });
    const settled = await handle.wait();
    expect(settled.exitCode).toBe(0);
    expect(settled.result).toMatchObject({ sessionId: 'ses_fixture01', success: true });
  });

  it('default with bun absent throws the exact degraded message and spawns nothing', () => {
    const { spawn, calls } = stubSpawn();
    const bridge = createOmoBridgeRuntime(capable({ spawn, env: {} }));
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(thrown.message).toBe(BUN_ABSENT_MESSAGE);
    expect(calls).toEqual([]);
  });

  it('default with an unresolvable OMO_BUN_PATH names the path and spawns nothing', () => {
    const { spawn, calls } = stubSpawn();
    const bridge = createOmoBridgeRuntime(capable({ spawn, env: { OMO_BUN_PATH: '/nope/bun' }, existsSync: (p) => p !== '/nope/bun' }));
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(thrown.message).toBe(
      'Native runner unavailable: OMO_BUN_PATH points at "/nope/bun" which does not resolve. '
      + 'The wrapper path is kept; fix OMO_BUN_PATH or install bun on PATH to run natively.',
    );
    expect(calls).toEqual([]);
  });

  it('unrecognized OMO_NATIVE_RUN values fail closed before any spawn', () => {
    const { spawn, calls } = stubSpawn();
    const bridge = createOmoBridgeRuntime(capable({ spawn, env: { OMO_NATIVE_RUN: '2' } }));
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(thrown.message).toContain('"2"');
    expect(thrown.message).toContain('Nothing was started');
    expect(calls).toEqual([]);
  });

  it('per-call native:false runs the wrapper kind even when the gate passes', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(capable({ spawn: stub.spawn }));
    const handle = bridge.invoke({ message: 'hi', port: 4321, native: false });
    expect(handle.native).toBe(false);
    expect(handle.argv).toEqual(['run', 'hi', '--port', '4321', '--json']);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].entry).toBe('/x/bun');
    expect(stdinJob(stub)).toEqual({
      kind: 'wrapper',
      message: 'hi',
      port: 4321,
      wrapperEntry: '/user/engine/bin/oh-my-opencode.js',
      wrapperArgv: ['run', 'hi', '--port', '4321', '--json'],
    });
  });

  it('wrapper kind with bun absent throws the exact degraded message and spawns nothing', () => {
    const stub = stubSpawn();
    const entry = '/user/engine/bin/oh-my-opencode.js';
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => entry,
      existsSync: (p) => p === entry || String(p).endsWith('.ts'),
      env: { OMO_NATIVE_RUN: '0' },
      spawn: stub.spawn,
    });
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi', port: 4321 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(thrown.message).toBe(bunUnavailableMessage({ source: 'path', path: 'bun' }));
    expect(stub.calls).toEqual([]);
  });

  it('per-call native:true with an unresolvable setup throws and spawns nothing', () => {
    const { spawn, calls } = stubSpawn();
    const bridge = createOmoBridgeRuntime(capable({
      spawn,
      existsSync: (p) => !String(p).endsWith('.ts'),
    }));
    let thrown = null;
    try {
      bridge.invoke({ message: 'hi', native: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_NATIVE_UNAVAILABLE');
    expect(calls).toEqual([]);
  });

  it('nativeFromEnv:false keeps the legacy wrapper-kind default', () => {
    const stub = stubSpawn();
    const bridge = createOmoBridgeRuntime(capable({ spawn: stub.spawn, nativeFromEnv: false }));
    const handle = bridge.invoke({ message: 'hi' });
    expect(handle.native).toBe(false);
    expect(handle.argv).toEqual(['run', 'hi', '--json']);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].entry).toBe('/x/bun');
    expect(stdinJob(stub)).toMatchObject({ kind: 'wrapper', message: 'hi' });
  });

  it('cancel on the wrapper kind still settles a receipt after the convergence', async () => {
    const { spawn } = stubSpawn();
    const bridge = createOmoBridgeRuntime(capable({ spawn }));
    const handle = bridge.invoke({ message: 'long run', native: false });
    expect(handle.native).toBe(false);
    const receipt = await handle.cancel('user asked to stop');
    expect(receipt).toMatchObject({
      provisional: true,
      alreadyExited: false,
      escalated: false,
      reason: 'user asked to stop',
    });
  });
});

describe('stream (session-filtered snapshot writer)', () => {
  const createWriter = (fs, sessionId = fixture.sessionId) => createSnapshotWriter({
    sessionId,
    snapshotPath: '/snap/ses_fixture01.snapshot.json',
    fs,
  });

  it('fixture snapshot renders through the snapshot path', () => {
    const fs = createMemoryFs();
    const writer = createWriter(fs);
    const dagOutcome = writer.handleEvent('omo.dag.updated', fixture.dagUpdated);
    const taskOutcome = writer.handleEvent('omo.task.updated', fixture.taskUpdated);
    expect(dagOutcome).toEqual({ accepted: true, written: true });
    expect(taskOutcome).toEqual({ accepted: true, written: true });
    const document = JSON.parse(fs.files.get('/snap/ses_fixture01.snapshot.json'));
    expect(document.schemaVersion).toBe(1);
    expect(document.sessionId).toBe('ses_fixture01');
    expect(document.dag.runs[0].run_id).toBe('run_fixture_a');
    expect(document.dag.runs[0].nodes).toHaveLength(3);
    expect(document.dag.runs[0].nodes.map((node) => node.id))
      .toEqual(['node_plan', 'node_build', 'node_verify']);
    expect(document.tasks.tasks[0].task_id).toBe('st_fixture0000000000000001');
    expect(writer.stats).toMatchObject({ acceptedDag: 1, acceptedTask: 1, writes: 2 });
  });

  it('other-session payloads are filtered out, never stored', () => {
    const fs = createMemoryFs();
    const writer = createWriter(fs);
    const outcome = writer.handleEvent('omo.dag.updated', fixture.dagUpdatedOtherSession);
    expect(outcome).toEqual({ accepted: false, written: false, reason: 'wrong_session' });
    expect(fs.files.size).toBe(0);
    expect(writer.stats.droppedWrongSession).toBe(1);
  });

  it('malformed input degrades to counters, never crashes', () => {
    const fs = createMemoryFs();
    const writer = createWriter(fs);
    for (const line of fixture.malformedLines) {
      expect(() => writer.handleLine(line)).not.toThrow();
    }
    expect(() => writer.handleEvent('omo.dag.updated', null)).not.toThrow();
    expect(() => writer.handleEvent('omo.dag.updated', { nope: true })).not.toThrow();
    expect(fs.files.size).toBe(0);
    expect(writer.stats.droppedMalformed).toBe(4);
    expect(writer.stats.droppedUnknownType).toBe(1);
    expect(writer.stats.droppedWrongSession).toBe(2);
  });

  it('oversize snapshots are dropped and counted, the file stays put', () => {
    const fs = createMemoryFs();
    const writer = createSnapshotWriter({
      sessionId: fixture.sessionId,
      snapshotPath: '/snap/ses_fixture01.snapshot.json',
      fs,
      maxSnapshotBytes: 10,
    });
    const outcome = writer.handleEvent('omo.dag.updated', fixture.dagUpdated);
    expect(outcome).toEqual({ accepted: true, written: false, reason: 'snapshot_too_large' });
    expect(fs.files.size).toBe(0);
    expect(writer.stats.droppedOversize).toBe(1);
  });

  it('writer construction misuse throws a coded error', () => {
    const fs = createMemoryFs();
    expect(() => createSnapshotWriter({ sessionId: '', snapshotPath: '/x', fs })).toThrow(OmoBridgeError);
    expect(() => createSnapshotWriter({ sessionId: 's', snapshotPath: '', fs })).toThrow(OmoBridgeError);
    expect(() => defaultSnapshotPath('/snap', 'ses/../evil')).toThrow(/snapshot filename/);
    expect(defaultSnapshotPath('/snap', 'ses_fixture01')).toBe(join('/snap', 'ses_fixture01.snapshot.json'));
  });

  it('stub event lines pumped through invoke land in the session snapshot', async () => {
    const eventLine = JSON.stringify({ type: 'omo.dag.updated', data: fixture.dagUpdated });
    const { spawn } = stubSpawn({ lines: [eventLine, JSON.stringify(fixture.runResult)], exitCode: 0 });
    const fs = createMemoryFs();
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      env: { OMO_BUN_PATH: '/x/bun' },
      spawn,
      fs,
      snapshotDir: '/snap',
    });
    const seen = [];
    const handle = bridge.invoke({ message: 'hi', sessionId: fixture.sessionId, native: false, onEvent: (name, data) => seen.push([name, data]) });
    const settled = await handle.wait();
    expect(settled.exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe('omo.dag.updated');
    const document = JSON.parse(fs.files.get(join('/snap', 'ses_fixture01.snapshot.json')));
    expect(document.dag.runs[0].run_id).toBe('run_fixture_a');
  });

  it('parseEventLine routes result lines and event lines', () => {
    expect(parseEventLine('nope{').error).toBe('malformed_json');
    expect(parseEventLine('[1]').error).toBe('malformed_json');
    expect(parseEventLine(JSON.stringify(fixture.runResult)).result).toMatchObject({ success: true });
    const parsed = parseEventLine(JSON.stringify({ type: 'omo.task.updated', data: fixture.taskUpdated }));
    expect(parsed.event.name).toBe('omo.task.updated');
    expect(parsed.event.data.parent_session_id).toBe('ses_fixture01');
  });
});

describe('cancel (PROVISIONAL kill-with-reason)', () => {
  it('scripted child records SIGTERM with the caller reason', async () => {
    const { spawn } = stubSpawn();
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      spawn,
    });
    const handle = bridge.invoke({ message: 'long run' });
    // T9 default with a stub-resolvable setup takes the native path, so this
    // pins cancel-on-native; the wrapper path is probed below.
    expect(handle.native).toBe(true);
    const receipt = await handle.cancel('user asked to stop');
    expect(receipt).toMatchObject({
      provisional: true,
      alreadyExited: false,
      escalated: false,
      reason: 'user asked to stop',
    });
  });

  it('real sleeper child is terminated with a documented receipt', async () => {
    const child = realSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
    liveChildren.push(child);
    const receipt = await cancelRun({ child }, 'qa cancel', { cancelGraceMs: 5000 });
    expect(receipt.provisional).toBe(true);
    expect(receipt.alreadyExited).toBe(false);
    expect(receipt.escalated).toBe(false);
    expect(receipt.reason).toBe('qa cancel');
    expect(receipt.signal).toBe('SIGTERM');
    // Signal-terminated children keep exitCode null with signalCode set.
    expect(child.signalCode ?? child.exitCode).not.toBeNull();
  }, 15000);

  it('already-exited runs report alreadyExited instead of signaling', async () => {
    const { spawn } = stubSpawn({ exitCode: 0 });
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
      existsSync: () => true,
      spawn,
    });
    const handle = bridge.invoke({ message: 'quick' });
    await handle.wait();
    const receipt = await handle.cancel('late cancel');
    expect(receipt.alreadyExited).toBe(true);
    expect(receipt.reason).toBe('late cancel');
  });

  it('handle without a child throws a coded error', async () => {
    let thrown = null;
    try {
      await cancelRun({}, 'x');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_CANCEL_NO_CHILD');
  });

  it('cancel on Windows fells the worker tree best-effort', async () => {
    const child = new FakeChild();
    child.pid = 4242;
    const calls = [];
    const receipt = await cancelRun({ child }, 'stop', {
      platform: 'win32',
      spawnSync: (cmd, args) => { calls.push({ cmd, args }); return { status: 0 }; },
      cancelGraceMs: 50,
    });
    expect(calls).toEqual([{ cmd: 'taskkill', args: ['/PID', '4242', '/T', '/F'] }]);
    expect(receipt).toMatchObject({
      provisional: true,
      alreadyExited: false,
      escalated: false,
      reason: 'stop',
    });
  });

  it('cancel off Windows leaves the tree alone', async () => {
    const child = new FakeChild();
    child.pid = 4242;
    let called = 0;
    const receipt = await cancelRun({ child }, 'stop', {
      platform: 'linux',
      spawnSync: () => { called += 1; return { status: 0 }; },
      cancelGraceMs: 50,
    });
    expect(called).toBe(0);
    expect(receipt.reason).toBe('stop');
  });

  it('cancel reaps the wrapper grandchild on every platform', async () => {
    // Full converged path with real processes but fixture-only (no engine,
    // no spend): bridge -> bun worker -> bun-run fixture wrapper. The
    // fixture path travels as the run message so `bun run <file>` executes
    // it; the script announces readiness on stderr (relayed through the
    // worker) and records its pid beside itself for the reap check.
    const dir = mkdtempSync(join(tmpdir(), 'omo-cancel-tree-'));
    const script = join(dir, 'wrapper.mjs');
    writeFileSync(script, [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { fileURLToPath } from "node:url";',
      'const dir = path.dirname(fileURLToPath(import.meta.url));',
      'fs.writeFileSync(path.join(dir, "wrapper.pid"), String(process.pid));',
      'console.error("wrapper-ready");',
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'));
    const bridge = createOmoBridgeRuntime({
      resolveEngineEntry: () => process.execPath,
      env: { OMO_NATIVE_RUN: '0', OMO_BUN_PATH: process.execPath },
    });
    const handle = bridge.invoke({ message: script, native: false });
    liveChildren.push(handle.child);
    expect(handle.native).toBe(false);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('wrapper never announced readiness')), 15000);
        timer.unref?.();
        handle.child.stderr?.on('data', (chunk) => {
          if (String(chunk).includes('wrapper-ready')) {
            clearTimeout(timer);
            resolve();
          }
        });
        handle.child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      const pid = Number(readFileSync(join(dir, 'wrapper.pid'), 'utf8'));
      expect(Number.isInteger(pid)).toBe(true);
      const receipt = await handle.cancel('tree test');
      expect(receipt).toMatchObject({ provisional: true, alreadyExited: false, reason: 'tree test' });
      expect(() => process.kill(pid, 0)).toThrow();
    } catch (error) {
      try {
        await handle.cancel('cleanup');
      } catch {
        // Cleanup best-effort; the original failure reports below.
      }
      throw error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('degraded message contract', () => {
  it('names the empty slot and rules out silent fetching', () => {
    const message = engineAbsentMessage('/user/engine/bin/oh-my-opencode.js');
    expect(message).toContain('/user/engine/bin/oh-my-opencode.js');
    expect(message).toContain('stays empty');
    expect(message).toContain('nothing is fetched automatically');
    expect(engineAbsentMessage(null)).toContain('OMO_WRAPPER_PATH');
  });
});
