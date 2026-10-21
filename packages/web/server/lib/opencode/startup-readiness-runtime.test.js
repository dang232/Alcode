import { describe, expect, it, vi } from 'vitest';

import {
  STARTUP_READINESS_ROUTE,
  STARTUP_READINESS_STEP_ORDER,
  createStepResult,
} from './startup-readiness-contract.js';
import { createStartupReadinessRuntime } from './startup-readiness-runtime.js';

const okSteps = () => STARTUP_READINESS_STEP_ORDER.map((step, index) => createStepResult(step, true, `OK_${index}`));

const failingSteps = (failedStep) => {
  const index = STARTUP_READINESS_STEP_ORDER.indexOf(failedStep);
  return STARTUP_READINESS_STEP_ORDER.slice(0, index + 1).map((step, position) => (
    position < index ? createStepResult(step, true, 'OK') : createStepResult(step, false, 'FAILED')
  ));
};

const createHarness = ({ sequences = [okSteps()], repairStep } = {}) => {
  const runs = [];
  const queue = sequences.map((steps) => [...steps]);
  const runtime = createStartupReadinessRuntime({
    runProbes: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      runs.push(next.map((step) => step.step));
      return next;
    }),
    repairStep: repairStep ?? (async () => ({})),
    clock: (() => {
      let now = 5000;
      return () => now++;
    })(),
    snapshotCacheTtlMs: 60_000,
  });
  return { runtime, runs };
};

const createRouteHarness = () => {
  const handlers = new Map();
  const app = {
    get: vi.fn((route, handler) => {
      handlers.set(route, handler);
      return app;
    }),
  };
  return { app, handlers };
};

const jsonResponse = () => {
  const res = { statusCode: 200 };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
};

describe('startup readiness runtime', () => {
  it('requires a probe runner', () => {
    expect(() => createStartupReadinessRuntime({})).toThrow(/requires "runProbes"/);
  });

  it('settles ready when the contract passes and arms repair for the next outage', async () => {
    const repairStep = vi.fn(async () => ({}));
    const { runtime } = createHarness({ repairStep });
    const snapshot = await runtime.runReadiness();
    expect(snapshot).toMatchObject({ status: 'ready', ok: true, failedStep: null });
    expect(snapshot.steps.map((step) => step.step)).toEqual(STARTUP_READINESS_STEP_ORDER);
    expect(repairStep).not.toHaveBeenCalled();
    expect(runtime.getState()).toMatchObject({
      status: 'ready',
      consecutiveFailures: 0,
      repairedThisOutage: false,
    });
  });

  it('repairs once on the first failure and settles ready when the re-probe passes', async () => {
    const repairStep = vi.fn(async () => ({}));
    const { runtime } = createHarness({
      sequences: [[...failingSteps('ulw-tools-discoverable')], okSteps()],
      repairStep,
    });
    const snapshot = await runtime.runReadiness();
    expect(repairStep).toHaveBeenCalledTimes(1);
    expect(repairStep).toHaveBeenCalledWith('ulw-tools-discoverable', expect.objectContaining({ ok: false }));
    expect(snapshot).toMatchObject({ status: 'ready', ok: true });
    expect(runtime.getState()).toMatchObject({ consecutiveFailures: 0 });
  });

  it('marks unavailable when the re-probe still fails after the single repair', async () => {
    const repairStep = vi.fn(async () => ({}));
    const { runtime } = createHarness({
      sequences: [[...failingSteps('child-creatable')], [...failingSteps('child-creatable')]],
      repairStep,
    });
    const snapshot = await runtime.runReadiness();
    expect(repairStep).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      status: 'unavailable',
      ok: false,
      failedStep: 'child-creatable',
    });
    expect(snapshot.consecutiveFailures).toBe(1);
  });

  it('does not repair again while the outage stays open', async () => {
    const repairStep = vi.fn(async () => ({}));
    const failing = [...failingSteps('model-resolution-initialized')];
    const { runtime } = createHarness({ sequences: [failing, failing, failing], repairStep });
    await runtime.runReadiness();
    // The second run sees the same outage: no second repair, still unavailable.
    const second = await runtime.runReadiness();
    expect(repairStep).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ status: 'unavailable', ok: false });
    expect(runtime.getState().consecutiveFailures).toBe(2);
    expect(runtime.getState().repairedThisOutage).toBe(true);
  });

  it('re-arms repair after a passing run closes the outage', async () => {
    const repairStep = vi.fn(async () => ({}));
    const { runtime } = createHarness({
      sequences: [
        [...failingSteps('event-interfaces-connected')],
        [...failingSteps('event-interfaces-connected')],
        [...failingSteps('event-interfaces-connected')],
        okSteps(),
        [...failingSteps('session-creatable')],
        okSteps(),
      ],
      repairStep,
    });
    await runtime.runReadiness();
    expect(runtime.getState().status).toBe('unavailable');
    // Fresh cache would hide the outage; force live runs throughout.
    await runtime.getSnapshot({ fresh: true });
    expect(runtime.getState().status).toBe('unavailable');
    expect(repairStep).toHaveBeenCalledTimes(1);
    const recovered = await runtime.getSnapshot({ fresh: true });
    expect(recovered.status).toBe('ready');
    const rearmed = await runtime.getSnapshot({ fresh: true });
    expect(rearmed.status).toBe('ready');
    expect(repairStep).toHaveBeenCalledTimes(2);
  });

  it('treats a throwing repair as a failed repair, never a thrown run', async () => {
    const { runtime } = createHarness({
      sequences: [[...failingSteps('session-creatable')], [...failingSteps('session-creatable')]],
      repairStep: vi.fn(async () => { throw new Error('repair exploded'); }),
    });
    const snapshot = await runtime.runReadiness();
    expect(snapshot).toMatchObject({ status: 'unavailable', failedStep: 'session-creatable' });
  });

  it('serves the cached snapshot inside the TTL without re-running probes', async () => {
    const runProbes = vi.fn(async () => okSteps());
    const runtime = createStartupReadinessRuntime({
      runProbes,
      clock: (() => {
        let now = 100;
        return () => now++;
      })(),
      snapshotCacheTtlMs: 60_000,
    });
    const first = await runtime.getSnapshot();
    const second = await runtime.getSnapshot();
    expect(first).toBe(second);
    expect(runProbes).toHaveBeenCalledTimes(1);
    const fresh = await runtime.getSnapshot({ fresh: true });
    expect(fresh).not.toBe(first);
    expect(runProbes).toHaveBeenCalledTimes(2);
  });

  it('mounts GET /api/startup-readiness and answers the snapshot', async () => {
    const { runtime } = createHarness();
    const { app, handlers } = createRouteHarness();
    expect(runtime.registerStartupReadinessRoutes(app)).toBe(app);
    expect(app.get).toHaveBeenCalledWith(STARTUP_READINESS_ROUTE, expect.any(Function));
    const handler = handlers.get(STARTUP_READINESS_ROUTE);
    const res = jsonResponse();
    await handler({ query: {} }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', ok: true }));
  });

  it('honours ?fresh=1 on the route', async () => {
    const runProbes = vi.fn(async () => okSteps());
    const runtime = createStartupReadinessRuntime({ runProbes, snapshotCacheTtlMs: 60_000 });
    const { handlers } = createRouteHarness();
    runtime.registerStartupReadinessRoutes({
      get: (route, handler) => handlers.set(route, handler),
    });
    const handler = handlers.get(STARTUP_READINESS_ROUTE);
    await handler({ query: {} }, jsonResponse());
    await handler({ query: { fresh: '1' } }, jsonResponse());
    expect(runProbes).toHaveBeenCalledTimes(2);
  });

  it('answers 503 with the last snapshot when probes throw', async () => {
    const runtime = createStartupReadinessRuntime({
      runProbes: vi.fn(async () => { throw new Error('opencode down'); }),
    });
    const { handlers } = createRouteHarness();
    runtime.registerStartupReadinessRoutes({
      get: (route, handler) => handlers.set(route, handler),
    });
    const res = jsonResponse();
    await handlers.get(STARTUP_READINESS_ROUTE)({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body).toMatchObject({ status: 'unavailable', ok: false });
    expect(Array.isArray(res.body.steps)).toBe(true);
  });
});
