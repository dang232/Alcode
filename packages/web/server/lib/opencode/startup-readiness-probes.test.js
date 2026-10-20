import { describe, expect, it, vi } from 'vitest';

import { STARTUP_READINESS_CODES } from './startup-readiness-contract.js';
import { createStartupReadinessProbes } from './startup-readiness-probes.js';

const healthyDependencies = (overrides = {}) => ({
  createProbeSession: vi.fn(async () => ({ id: 'ses_probe_1' })),
  deleteProbeSession: vi.fn(async () => ({})),
  materializeNativePlugin: vi.fn(async () => ({
    directory: '/data/omo-native/omo-native',
    setupPayloadBytes: 1024,
    hasSetup: true,
  })),
  listUlwTools: vi.fn(async () => ['ulw_goal_create', 'ulw_status']),
  resolveInitialModel: vi.fn(async () => ({ providerID: 'acme', modelID: 'acme-large' })),
  forkProbeChild: vi.fn(async () => ({ id: 'ses_child_1' })),
  checkEventInterfaces: vi.fn(async () => ({ hubSubscribed: true, upstreamReachable: true })),
  clock: (() => {
    let now = 1000;
    return () => now++;
  })(),
  ...overrides,
});

describe('startup readiness probes', () => {
  it('requires every probe dependency up front', () => {
    expect(() => createStartupReadinessProbes({})).toThrow(/require "createProbeSession"/);
  });

  it('runs the full contract in order when every layer is healthy', async () => {
    const deps = healthyDependencies();
    const { run } = createStartupReadinessProbes(deps);
    const results = await run();
    expect(results.map((result) => result.step)).toEqual([
      'session-creatable',
      'native-plugin-materialized',
      'ulw-tools-discoverable',
      'model-resolution-initialized',
      'child-creatable',
      'event-interfaces-connected',
    ]);
    for (const result of results) {
      expect(result.ok).toBe(true);
      expect(result.code).not.toBe(STARTUP_READINESS_CODES.SKIPPED);
    }
    expect(results[0].detail).toEqual({ sessionId: 'ses_probe_1' });
    expect(results[4].detail).toEqual({ childSessionId: 'ses_child_1' });
  });

  it('creates the probe session with a title only, never message/prompt/model', async () => {
    const deps = healthyDependencies();
    await createStartupReadinessProbes(deps).run();
    expect(deps.createProbeSession).toHaveBeenCalledTimes(1);
    expect(deps.createProbeSession).toHaveBeenCalledWith({
      title: 'alcode-startup-readiness-probe',
    });
  });

  it('removes the probe session and its child afterwards', async () => {
    const deps = healthyDependencies();
    await createStartupReadinessProbes(deps).run();
    const deletedIds = deps.deleteProbeSession.mock.calls.map((call) => call[0]).sort();
    expect(deletedIds).toEqual(['ses_child_1', 'ses_probe_1']);
  });

  it('removes the probe session even when a later step fails', async () => {
    const deps = healthyDependencies({
      listUlwTools: vi.fn(async () => []),
    });
    const results = await createStartupReadinessProbes(deps).run();
    expect(results.map((result) => result.step)).toEqual([
      'session-creatable',
      'native-plugin-materialized',
      'ulw-tools-discoverable',
    ]);
    expect(results[2]).toMatchObject({ ok: false, code: STARTUP_READINESS_CODES.TOOLS_FAILED });
    expect(deps.deleteProbeSession).toHaveBeenCalledWith('ses_probe_1');
    expect(deps.forkProbeChild).not.toHaveBeenCalled();
    expect(deps.checkEventInterfaces).not.toHaveBeenCalled();
  });

  it('short-circuits when the session cannot be created and deletes nothing', async () => {
    const deps = healthyDependencies({
      createProbeSession: vi.fn(async () => null),
    });
    const results = await createStartupReadinessProbes(deps).run();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ step: 'session-creatable', ok: false });
    expect(deps.deleteProbeSession).not.toHaveBeenCalled();
    expect(deps.materializeNativePlugin).not.toHaveBeenCalled();
  });

  it('fails the plugin step when the setup payload is a placeholder', async () => {
    const deps = healthyDependencies({
      materializeNativePlugin: vi.fn(async () => ({
        directory: '/data/omo-native/omo-native',
        setupPayloadBytes: 0,
        hasSetup: false,
      })),
    });
    const results = await createStartupReadinessProbes(deps).run();
    expect(results[1]).toMatchObject({
      step: 'native-plugin-materialized',
      ok: false,
      code: STARTUP_READINESS_CODES.PLUGIN_FAILED,
    });
    expect(deps.listUlwTools).not.toHaveBeenCalled();
    expect(deps.deleteProbeSession).toHaveBeenCalledWith('ses_probe_1');
  });

  it('fails the model step when no usable reference resolves, without spending a prompt', async () => {
    const deps = healthyDependencies({
      resolveInitialModel: vi.fn(async () => null),
    });
    const results = await createStartupReadinessProbes(deps).run();
    expect(results[3]).toMatchObject({
      step: 'model-resolution-initialized',
      ok: false,
      code: STARTUP_READINESS_CODES.MODEL_FAILED,
    });
    expect(deps.forkProbeChild).not.toHaveBeenCalled();
  });

  it('fails the child step when no real id comes back and still cleans up the parent', async () => {
    const deps = healthyDependencies({
      forkProbeChild: vi.fn(async () => ({})),
    });
    const results = await createStartupReadinessProbes(deps).run();
    expect(results[4]).toMatchObject({
      step: 'child-creatable',
      ok: false,
      code: STARTUP_READINESS_CODES.CHILD_FAILED,
    });
    expect(deps.checkEventInterfaces).not.toHaveBeenCalled();
    expect(deps.deleteProbeSession).toHaveBeenCalledWith('ses_probe_1');
  });

  it('fails the events step when the hub or upstream is disconnected', async () => {
    const deps = healthyDependencies({
      checkEventInterfaces: vi.fn(async () => ({ hubSubscribed: true, upstreamReachable: false })),
    });
    const results = await createStartupReadinessProbes(deps).run();
    expect(results[5]).toMatchObject({
      step: 'event-interfaces-connected',
      ok: false,
      code: STARTUP_READINESS_CODES.EVENTS_FAILED,
      detail: { hubSubscribed: true, upstreamReachable: false },
    });
    expect(deps.deleteProbeSession).toHaveBeenCalledWith('ses_probe_1');
  });

  it('turns a throwing probe into a failed step, never a thrown run', async () => {
    const deps = healthyDependencies({
      listUlwTools: vi.fn(async () => { throw new Error('socket hang up'); }),
    });
    const results = await createStartupReadinessProbes(deps).run();
    expect(results[2].ok).toBe(false);
    expect(results[2].detail).toMatchObject({ error: 'socket hang up' });
    expect(deps.deleteProbeSession).toHaveBeenCalledWith('ses_probe_1');
  });
});
