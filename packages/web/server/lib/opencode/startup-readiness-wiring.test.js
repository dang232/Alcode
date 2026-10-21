import { describe, expect, it, vi } from 'vitest';

import { createStartupReadinessRuntime } from './startup-readiness-runtime.js';
import {
  createReadinessSnapshot,
  createStepResult,
  STARTUP_READINESS_STEP_ORDER,
} from './startup-readiness-contract.js';
import { createStartupReadinessWiring } from './startup-readiness-wiring.js';

const stubHub = () => {
  const subscribers = new Set();
  return {
    subscribeEvent: (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    injectEvent: (event) => {
      for (const fn of [...subscribers]) fn(event);
    },
    isConnected: () => true,
    size: () => subscribers.size,
  };
};

const wiringWith = (overrides = {}) => createStartupReadinessWiring({
  getOpenCodeBaseUrl: () => 'http://127.0.0.1:9999',
  getOpenCodeHeaders: () => ({ Authorization: 'Bearer probe' }),
  defaultDirectory: '/tmp/probe-dir',
  omoNativeRuntime: { materializePlugin: async () => '/tmp/plugin' },
  managedDataDir: '/tmp/data',
  fsPromises: {
    readFile: async (file) => {
      if (String(file).endsWith('index.js')) return 'setup with ulw_goal_create inside';
      throw new Error(`unexpected read ${file}`);
    },
  },
  path: {
    join: (...parts) => parts.join('/'),
  },
  getSmallModelClient: () => ({}),
  listModelInfos: async () => [{ providerID: 'p', modelID: 'm', enabled: true }],
  resetOpenCodeRuntimeProviders: async () => 'reset',
  getMessageStreamHub: stubHub,
  ...overrides,
});

describe('startup readiness wiring', () => {
  it('fails probe steps with exact missing-dep names', async () => {
    const { runProbes } = wiringWith({ getOpenCodeBaseUrl: null });
    const snapshot = createReadinessSnapshot({ steps: await runProbes() });
    expect(snapshot.ok).toBe(false);
    expect(snapshot.failedStep).toBe('session-creatable');
    expect(snapshot.steps[0].detail).toMatchObject({ error: expect.stringContaining('getOpenCodeBaseUrl') });
  });

  it('repairs only the failed layer, never restarts', async () => {
    const materializePlugin = vi.fn(async () => '/tmp/plugin');
    const resetOpenCodeRuntimeProviders = vi.fn(async () => 'reset');
    const { repairStep } = wiringWith({ omoNativeRuntime: { materializePlugin }, resetOpenCodeRuntimeProviders });
    expect(await repairStep('native-plugin-materialized')).toEqual({ repaired: 'native-plugin-materialized' });
    expect(materializePlugin).toHaveBeenCalledTimes(1);
    expect(await repairStep('model-resolution-initialized')).toEqual({ repaired: 'model-resolution-initialized' });
    expect(resetOpenCodeRuntimeProviders).toHaveBeenCalledTimes(1);
    expect(await repairStep('session-creatable')).toEqual({});
    expect(materializePlugin).toHaveBeenCalledTimes(1);
  });

  it('mounts GET /api/startup-readiness with snapshot and 503 shapes', async () => {
    const routes = {};
    const app = { get: (route, handler) => { routes[route] = handler; } };
    const runtime = createStartupReadinessRuntime({
      runProbes: async () => STARTUP_READINESS_STEP_ORDER.map((step) =>
        createStepResult(step, true, `${step}-ok`, {}, 1)),
      repairStep: async () => ({}),
    });
    runtime.registerStartupReadinessRoutes(app);
    expect(typeof routes['/api/startup-readiness']).toBe('function');
    let okBody = null;
    const okRes = { json: (body) => { okBody = body; }, status: () => { throw new Error('must not 503 on success'); } };
    await routes['/api/startup-readiness']({ query: {} }, okRes);
    expect(okBody).toMatchObject({ ok: true });
    const failing = createStartupReadinessRuntime({
      runProbes: async () => { throw new Error('boom'); },
      repairStep: async () => ({}),
    });
    failing.registerStartupReadinessRoutes(app);
    let status = 0;
    let body = null;
    await routes['/api/startup-readiness']({ query: {} }, {
      status: (code) => { status = code; return { json: (payload) => { body = payload; } }; },
    });
    expect(status).toBe(503);
    expect(body).toMatchObject({ status: 'unavailable', ok: false });
  });
});
