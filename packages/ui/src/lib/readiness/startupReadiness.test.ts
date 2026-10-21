// Repair-once then unavailable-marking for the startup readiness badge,
// proved against injected fetchers (no DOM, no network, no timers).
import { describe, expect, test } from 'bun:test';

import {
  createStartupReadinessTracker,
  decideReadinessBadge,
  parseReadinessSnapshot,
  type StartupReadinessSnapshot,
} from './startupReadiness';

const snapshot = (overrides: Partial<StartupReadinessSnapshot> = {}): StartupReadinessSnapshot => ({
  status: 'ready',
  ok: true,
  steps: [
    { step: 'session-creatable', ok: true, code: 'STARTUP_READINESS_SESSION_OK' },
    { step: 'native-plugin-materialized', ok: true, code: 'STARTUP_READINESS_PLUGIN_OK' },
    { step: 'ulw-tools-discoverable', ok: true, code: 'STARTUP_READINESS_TOOLS_OK' },
    { step: 'model-resolution-initialized', ok: true, code: 'STARTUP_READINESS_MODEL_OK' },
    { step: 'child-creatable', ok: true, code: 'STARTUP_READINESS_CHILD_OK' },
    { step: 'event-interfaces-connected', ok: true, code: 'STARTUP_READINESS_EVENTS_OK' },
  ],
  failedStep: null,
  checkedAt: 123,
  consecutiveFailures: 0,
  ...overrides,
});

describe('parseReadinessSnapshot', () => {
  test('accepts the full contract snapshot', () => {
    expect(parseReadinessSnapshot(snapshot())).toEqual(snapshot());
  });

  test('answers null for failures and malformed payloads, never a fake success', () => {
    expect(parseReadinessSnapshot(null)).toBeNull();
    expect(parseReadinessSnapshot({})).toBeNull();
    expect(parseReadinessSnapshot({ ...snapshot(), status: 'bogus' })).toBeNull();
    expect(parseReadinessSnapshot({ ...snapshot(), steps: [{ step: 'session-creatable' }] })).toBeNull();
    expect(parseReadinessSnapshot({ ...snapshot(), steps: 'ready' })).toBeNull();
  });
});

describe('decideReadinessBadge', () => {
  test('maps every tracker status to tone, icon, and an established i18n key', () => {
    expect(decideReadinessBadge({ status: 'ready', snapshot: null, failures: 0, repaired: false })).toEqual({
      tone: 'ok',
      icon: 'check',
      labelKey: 'desktopHostSwitcher.sshPhase.ready',
    });
    expect(decideReadinessBadge({ status: 'repairing', snapshot: null, failures: 1, repaired: true })).toEqual({
      tone: 'warn',
      icon: 'loader',
      labelKey: 'opencodeCompatibility.reconnecting',
    });
    expect(decideReadinessBadge({ status: 'unavailable', snapshot: null, failures: 2, repaired: true })).toEqual({
      tone: 'bad',
      icon: 'alert',
      labelKey: 'common.unavailable',
    });
    expect(decideReadinessBadge({ status: 'unknown', snapshot: null, failures: 0, repaired: false })).toEqual({
      tone: 'idle',
      icon: 'circle',
      labelKey: 'common.loading',
    });
  });
});

describe('createStartupReadinessTracker', () => {
  test('settles ready on a passing refresh', async () => {
    const tracker = createStartupReadinessTracker({ fetchSnapshot: async () => snapshot() });
    const state = await tracker.refresh();
    expect(state).toEqual({ status: 'ready', snapshot: snapshot(), failures: 0, repaired: false });
  });

  test('repairs once, then marks unavailable when the re-poll still fails', async () => {
    const failing = snapshot({ status: 'unavailable', ok: false, failedStep: 'ulw-tools-discoverable', consecutiveFailures: 1 });
    const calls: boolean[] = [];
    const tracker = createStartupReadinessTracker({
      fetchSnapshot: async (fresh: boolean) => {
        calls.push(fresh);
        return failing;
      },
    });
    const state = await tracker.refresh();
    // One stale poll plus exactly one fresh repair poll.
    expect(calls).toEqual([false, true]);
    expect(state).toEqual({ status: 'unavailable', snapshot: failing, failures: 1, repaired: true });
  });

  test('recovers to ready when the single repair poll passes', async () => {
    const failing = snapshot({ status: 'unavailable', ok: false, failedStep: 'child-creatable' });
    let first = true;
    const tracker = createStartupReadinessTracker({
      fetchSnapshot: async () => {
        if (first) {
          first = false;
          return failing;
        }
        return snapshot();
      },
    });
    const state = await tracker.refresh();
    expect(state.status).toBe('ready');
    expect(state.snapshot?.ok).toBe(true);
    expect(state).toMatchObject({ failures: 0, repaired: false });
  });

  test('does not repair again while the outage stays open', async () => {
    const failing = snapshot({ status: 'unavailable', ok: false, failedStep: 'session-creatable' });
    const calls: boolean[] = [];
    const tracker = createStartupReadinessTracker({
      fetchSnapshot: async (fresh: boolean) => {
        calls.push(fresh);
        return failing;
      },
    });
    await tracker.refresh();
    const second = await tracker.refresh();
    // Second refresh: one stale poll, no repair re-poll.
    expect(calls).toEqual([false, true, false]);
    expect(second).toMatchObject({ status: 'unavailable', failures: 2, repaired: true });
  });

  test('preserves the last authoritative snapshot across transient fetch failures', async () => {
    const good = snapshot();
    const answers: Array<'throw' | StartupReadinessSnapshot> = [good, 'throw', 'throw', 'throw'];
    const tracker = createStartupReadinessTracker({
      fetchSnapshot: async () => {
        const next = answers.shift() ?? null;
        if (next === 'throw') throw new Error('socket hang up');
        return next;
      },
    });
    await tracker.refresh();
    // Failure poll + failed repair poll, both transport failures: the last
    // good snapshot stays rendered instead of blanking to unknown.
    const failed = await tracker.refresh();
    expect(failed.status).toBe('unavailable');
    expect(failed.snapshot).toEqual(good);
    // A thrown transport failure on an open outage keeps the snapshot too.
    const thrown = await tracker.refresh();
    expect(thrown.status).toBe('unavailable');
    expect(thrown.snapshot).toEqual(good);
    expect(thrown.failures).toBe(2);
  });

  test('a passing refresh closes the outage and re-arms repair', async () => {
    const failing = snapshot({ status: 'unavailable', ok: false, failedStep: 'event-interfaces-connected' });
    const answers: StartupReadinessSnapshot[] = [failing, failing, snapshot(), failing, snapshot()];
    const tracker = createStartupReadinessTracker({ fetchSnapshot: async () => answers.shift() ?? null });
    await tracker.refresh();
    expect(tracker.getState().repaired).toBe(true);
    await tracker.refresh();
    expect(tracker.getState()).toMatchObject({ status: 'ready', repaired: false });
    const rearmed = await tracker.refresh();
    expect(rearmed.status).toBe('ready');
  });

  test('notifies subscribers and supports unsubscribe', async () => {
    const tracker = createStartupReadinessTracker({ fetchSnapshot: async () => snapshot() });
    const seen: string[] = [];
    const unsubscribe = tracker.subscribe((state) => {
      seen.push(state.status);
    });
    await tracker.refresh();
    unsubscribe();
    await tracker.refresh();
    expect(seen).toEqual(['ready']);
  });
});
