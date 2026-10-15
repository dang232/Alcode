// Live-shaped Slice-E predicate tests (omo-full-integration T4, GAP-5).
//
// The gate inputs are fed the way production feeds them, but from fixtures
// so nothing is spent and no OpenCode is phoned: the catalog comes from a
// real file on disk (bridge shape, like
// packages/omo-engine/omo-codex/plugin/model-catalog.json) via
// readModelCatalogFileSync, and readiness comes from an integration-list
// shaped snapshot (the GET /api/integration shape behind IntegrationCatalog)
// via isProviderReadyFromCardSnapshot. Every failure case asserts the spawn
// counter stayed at zero: fail-closed means no child, not just an error.
import { describe, expect, it, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OmoBridgeError,
  createOmoBridgeRuntime,
  isProviderReadyFromCardSnapshot,
  readModelCatalogFileSync,
} from './omo-bridge-runtime.js';

const scratchDirs = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; a leftover tmpdir never fails the suite.
    }
  }
});

// Fresh fixtures every test: a new tmpdir per catalog file, so no read can
// ever serve a stale catalog from an earlier case.
const writeCatalogText = (text) => {
  const dir = mkdtempSync(join(tmpdir(), 'omo-slice-e-'));
  scratchDirs.push(dir);
  const path = join(dir, 'model-catalog.json');
  writeFileSync(path, text, 'utf8');
  return path;
};

const writeCatalogFile = (catalog) => writeCatalogText(JSON.stringify(catalog));

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
  }
}

// Counting stand-in for the single worker spawn: records entry/argv, captures
// the stdin job, exits cleanly, never runs an engine. calls.length is the
// spawn counter every fail-closed case asserts.
const countingSpawn = () => {
  const calls = [];
  let last = null;
  const spawn = (entry, argv, options) => {
    calls.push({ entry, argv, options });
    const child = new FakeChild();
    child.stdinText = '';
    child.stdin = {
      write: (text) => { child.stdinText += String(text); },
      end: () => {},
    };
    last = child;
    setImmediate(() => {
      child.exitCode = 0;
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
    });
    return child;
  };
  return { spawn, calls, stdinJob: () => JSON.parse(last.stdinText) };
};

const engine = (extra = {}) => ({
  resolveEngineEntry: () => '/user/engine/bin/oh-my-opencode.js',
  existsSync: () => true,
  // Pin the wrapper kind: this file asserts Slice-E argv on the wrapper
  // contract, and the T9 native default would otherwise take the native
  // kind (existsSync stubs everything resolvable). OMO_BUN_PATH keeps the
  // worker resolution hermetic (no real PATH scan).
  env: { OMO_NATIVE_RUN: '0', OMO_BUN_PATH: '/x/bun' },
  ...extra,
});

// Live-shaped provider-card snapshot: alcore signed in via a stored
// credential, openai listed with no connections (card: signInNeeded).
const fixtureCardSnapshot = () => ({
  integrations: [
    { id: 'alcore', connections: [{ type: 'credential', id: 'cred_live_1' }] },
    { id: 'openai', connections: [] },
  ],
  optionsApiKeys: {},
});

// Bridge-shaped catalog file contents, mirroring the engine codex catalog
// (current + roles keyed by run role).
const fixtureCatalogDoc = () => ({
  current: { model: 'gpt-6-astra' },
  roles: { default: { model: 'al-1-2' } },
});

const invokeThrows = (bridge, args) => {
  try {
    bridge.invoke(args);
  } catch (error) {
    return error;
  }
  return null;
};

describe('live Slice-E predicates (fixture catalog + card snapshot, zero spend)', () => {
  it('signed model passes the gate against the fixture catalog file', async () => {
    const { spawn, calls, stdinJob } = countingSpawn();
    const catalog = readModelCatalogFileSync(writeCatalogFile(fixtureCatalogDoc()));
    const bridge = createOmoBridgeRuntime(engine({
      spawn,
      modelCatalog: catalog,
      modelProviders: { 'openai/gpt-5': 'openai' },
      isProviderReady: isProviderReadyFromCardSnapshot(fixtureCardSnapshot()),
    }));
    const handle = bridge.invoke({ message: 'hi' });
    expect(calls).toHaveLength(1);
    expect(calls[0].entry).toBe('/x/bun');
    expect(handle.native).toBe(false);
    expect(handle.argv).toEqual(['run', 'hi', '--model', 'alcore/al-1-2', '--json']);
    expect(stdinJob()).toMatchObject({ kind: 'wrapper', message: 'hi', model: 'alcore/al-1-2' });
    await handle.wait();
  });

  it('unsigned model fails closed with OMO_PROVIDER_NOT_SIGNED_IN and zero spawns', () => {
    const { spawn, calls } = countingSpawn();
    const bridge = createOmoBridgeRuntime(engine({
      spawn,
      modelProviders: { 'openai/gpt-5': 'openai' },
      isProviderReady: isProviderReadyFromCardSnapshot(fixtureCardSnapshot()),
    }));
    const thrown = invokeThrows(bridge, { message: 'hi', model: 'openai/gpt-5' });
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_PROVIDER_NOT_SIGNED_IN');
    expect(thrown.message).toContain('openai/gpt-5');
    expect(thrown.message).toContain('openai');
    expect(thrown.details).toMatchObject({ model: 'openai/gpt-5', provider: 'openai' });
    expect(calls).toHaveLength(0);
  });

  it('revoked credential (needs_auth) fails closed with zero spawns', () => {
    const { spawn, calls } = countingSpawn();
    const snapshot = fixtureCardSnapshot();
    snapshot.integrations[0].connections = [{ type: 'credential', id: 'cred_dead_1', status: { status: 'needs_auth' } }];
    const bridge = createOmoBridgeRuntime(engine({
      spawn,
      isProviderReady: isProviderReadyFromCardSnapshot(snapshot),
    }));
    const thrown = invokeThrows(bridge, { message: 'hi', model: 'al-1-2' });
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_PROVIDER_NOT_SIGNED_IN');
    expect(calls).toHaveLength(0);
  });

  it('codex-shaped catalog file resolves current.model', () => {
    const path = writeCatalogFile({
      current: { model: 'al-1-2-flash', model_context_window: 600000 },
      managedProfiles: [{ model: 'gpt-5.5' }],
    });
    expect(readModelCatalogFileSync(path)).toEqual({ current: { model: 'al-1-2-flash' } });
  });

  it('catalog reads are never cached: a rewrite lands on the next read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omo-slice-e-'));
    scratchDirs.push(dir);
    const path = join(dir, 'model-catalog.json');
    writeFileSync(path, JSON.stringify({ current: { model: 'al-1-2' } }), 'utf8');
    expect(readModelCatalogFileSync(path).current.model).toBe('al-1-2');
    writeFileSync(path, JSON.stringify({ current: { model: 'al-1-3-max' } }), 'utf8');
    expect(readModelCatalogFileSync(path).current.model).toBe('al-1-3-max');
  });

  it('missing catalog file throws UNREADABLE before any spawn', () => {
    const { spawn, calls } = countingSpawn();
    const thrown = (() => {
      try {
        readModelCatalogFileSync(join(tmpdir(), 'omo-slice-e-missing', 'model-catalog.json'));
      } catch (error) {
        return error;
      }
      return null;
    })();
    expect(thrown).toBeInstanceOf(OmoBridgeError);
    expect(thrown.code).toBe('OMO_MODEL_CATALOG_UNREADABLE');
    expect(calls).toHaveLength(0);
  });

  it('corrupt catalog JSON and model-less catalogs throw MALFORMED with zero spawns', () => {
    const { calls } = countingSpawn();
    for (const contents of ['{nope', JSON.stringify({ roles: {} }), JSON.stringify({ current: {} }), JSON.stringify([])]) {
      let thrown = null;
      try {
        readModelCatalogFileSync(writeCatalogText(contents));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(OmoBridgeError);
      expect(thrown.code).toBe('OMO_MODEL_CATALOG_MALFORMED');
    }
    expect(calls).toHaveLength(0);
  });

  it('corrupt provider snapshot throws MALFORMED before any spawn', () => {
    const { calls } = countingSpawn();
    for (const snapshot of [{}, { integrations: 'nope' }, { integrations: null }, 42]) {
      let thrown = null;
      try {
        isProviderReadyFromCardSnapshot(snapshot);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(OmoBridgeError);
      expect(thrown.code).toBe('OMO_PROVIDER_SNAPSHOT_MALFORMED');
    }
    expect(calls).toHaveLength(0);
  });

  it('null snapshot leaves the gate unwired (legacy argv, no model)', () => {
    expect(isProviderReadyFromCardSnapshot(null)).toBeNull();
    expect(isProviderReadyFromCardSnapshot(undefined)).toBeNull();
    const { spawn, calls, stdinJob } = countingSpawn();
    const bridge = createOmoBridgeRuntime(engine({ spawn, isProviderReady: null }));
    const handle = bridge.invoke({ message: 'hi', model: 'al-1-2' });
    expect(calls).toHaveLength(1);
    expect(handle.argv).toEqual(['run', 'hi', '--model', 'alcore/al-1-2', '--json']);
    expect(stdinJob()).toMatchObject({ kind: 'wrapper', model: 'alcore/al-1-2' });
  });

  it('unknown provider (no integration) proceeds — custom keyed providers have no card', () => {
    const { spawn, calls, stdinJob } = countingSpawn();
    const bridge = createOmoBridgeRuntime(engine({
      spawn,
      modelProviders: { 'custom/acme-1': 'acme' },
      isProviderReady: isProviderReadyFromCardSnapshot(fixtureCardSnapshot()),
    }));
    const handle = bridge.invoke({ message: 'hi', model: 'custom/acme-1' });
    expect(calls).toHaveLength(1);
    expect(handle.argv).toEqual(['run', 'hi', '--model', 'custom/acme-1', '--json']);
    expect(stdinJob()).toMatchObject({ kind: 'wrapper', model: 'custom/acme-1' });
  });

  it('env connections and inline options keys read ready', () => {
    const ready = isProviderReadyFromCardSnapshot({
      integrations: [
        { id: 'google', connections: [{ type: 'env', id: 'GOOGLE_GENERATIVE_AI_API_KEY' }] },
        { id: 'custom', connections: [] },
      ],
      optionsApiKeys: { custom: 'sk-inline' },
    });
    expect(ready('google')).toBe(true);
    expect(ready('custom')).toBe(true);
    expect(ready('openai')).toBe(true);
    expect(ready('  ')).toBe(false);
  });

  it('opencode-go signs in through the opencode integration', () => {
    const ready = isProviderReadyFromCardSnapshot({
      integrations: [{ id: 'opencode', connections: [{ type: 'credential', id: 'cred_console_1' }] }],
    });
    expect(ready('opencode-go')).toBe(true);
  });
});
