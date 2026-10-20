import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_SESSION_CREATE_KEYS,
  STARTUP_READINESS_CODES,
  STARTUP_READINESS_PROBE_SESSION_TITLE,
  STARTUP_READINESS_ROUTE,
  STARTUP_READINESS_STEP_ORDER,
  assertTitleOnlySessionPayload,
  buildTitleOnlySessionPayload,
  createReadinessSnapshot,
  createStepResult,
  skippedStepResult,
} from './startup-readiness-contract.js';

describe('startup readiness contract', () => {
  it('fixes the probe order the task names', () => {
    expect(STARTUP_READINESS_STEP_ORDER).toEqual([
      'session-creatable',
      'native-plugin-materialized',
      'ulw-tools-discoverable',
      'model-resolution-initialized',
      'child-creatable',
      'event-interfaces-connected',
    ]);
  });

  it('serves a single explicit route', () => {
    expect(STARTUP_READINESS_ROUTE).toBe('/api/startup-readiness');
  });

  it('builds a title-only session payload', () => {
    expect(buildTitleOnlySessionPayload()).toEqual({
      title: STARTUP_READINESS_PROBE_SESSION_TITLE,
    });
  });

  it('rejects blank probe titles instead of creating untitled sessions', () => {
    expect(() => buildTitleOnlySessionPayload('   ')).toThrow(/non-empty title/);
  });

  it('forbids message, prompt, and model on the create payload', () => {
    expect(FORBIDDEN_SESSION_CREATE_KEYS).toEqual(['message', 'prompt', 'model']);
    expect(assertTitleOnlySessionPayload({ title: 'probe' })).toBe(true);
    for (const key of FORBIDDEN_SESSION_CREATE_KEYS) {
      expect(() => assertTitleOnlySessionPayload({ title: 'probe', [key]: 'x' }))
        .toThrow(new RegExp(`must never pass "${key}"`));
    }
  });

  it('rejects payloads without a title', () => {
    expect(() => assertTitleOnlySessionPayload({})).toThrow(/non-empty title/);
    expect(() => assertTitleOnlySessionPayload(null)).toThrow(/must be an object/);
  });

  it('orders snapshot steps by contract with skipped fillers after a short-circuit', () => {
    const snapshot = createReadinessSnapshot({
      status: 'ready',
      steps: [createStepResult('session-creatable', true, STARTUP_READINESS_CODES.SESSION_OK, { sessionId: 'ses_1' })],
      checkedAt: 7,
    });
    expect(snapshot.ok).toBe(false);
    expect(snapshot.steps.map((step) => step.step)).toEqual(STARTUP_READINESS_STEP_ORDER);
    expect(snapshot.failedStep).toBe('native-plugin-materialized');
    expect(snapshot.steps[1]).toMatchObject({
      ok: false,
      code: STARTUP_READINESS_CODES.SKIPPED,
    });
    expect(snapshot.checkedAt).toBe(7);
  });

  it('reports ok only when every contract step passed', () => {
    const snapshot = createReadinessSnapshot({
      status: 'ready',
      steps: STARTUP_READINESS_STEP_ORDER.map((step) => createStepResult(step, true, STARTUP_READINESS_CODES.OK)),
      checkedAt: 9,
    });
    expect(snapshot.ok).toBe(true);
    expect(snapshot.failedStep).toBeNull();
  });

  it('names the first failed step, not a skipped filler', () => {
    const snapshot = createReadinessSnapshot({
      status: 'unavailable',
      steps: [
        createStepResult('session-creatable', true, STARTUP_READINESS_CODES.SESSION_OK),
        createStepResult('native-plugin-materialized', false, STARTUP_READINESS_CODES.PLUGIN_FAILED),
      ],
      checkedAt: 11,
      consecutiveFailures: 2,
    });
    expect(snapshot.ok).toBe(false);
    expect(snapshot.failedStep).toBe('native-plugin-materialized');
    expect(snapshot.consecutiveFailures).toBe(2);
    expect(skippedStepResult('child-creatable').code).toBe(STARTUP_READINESS_CODES.SKIPPED);
  });
});
