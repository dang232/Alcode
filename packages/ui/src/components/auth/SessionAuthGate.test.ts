import { describe, expect, test } from 'bun:test';

import {
  nextGateStateForAuthSession,
  runtimeIdentityMatches,
  shouldHealAuthSession,
} from './sessionAuthGateState';

describe('runtimeIdentityMatches', () => {
  test('rejects async auth results after switching hosts', () => {
    expect(runtimeIdentityMatches(
      { apiBaseUrl: 'https://host-a.example', runtimeKey: 'host:a' },
      { apiBaseUrl: 'https://host-b.example', runtimeKey: 'host:b' },
    )).toBe(false);
  });

  test('accepts a credential refresh for the same host', () => {
    expect(runtimeIdentityMatches(
      { apiBaseUrl: 'https://host-a.example', runtimeKey: 'host:a' },
      { apiBaseUrl: 'https://host-a.example', runtimeKey: 'host:a' },
    )).toBe(true);
  });
});

describe('nextGateStateForAuthSession', () => {
  test('a confirmed expiry takes an authenticated gate to the sign-in view', () => {
    expect(nextGateStateForAuthSession('authenticated', 'expired')).toBe('locked');
  });

  test('it never reopens or disturbs a gate that is not authenticated', () => {
    expect(nextGateStateForAuthSession('locked', 'expired')).toBe('locked');
    expect(nextGateStateForAuthSession('pending', 'expired')).toBe('pending');
    expect(nextGateStateForAuthSession('error', 'expired')).toBe('error');
  });

  test('a live or re-authenticating session keeps the current gate state', () => {
    expect(nextGateStateForAuthSession('authenticated', 'ok')).toBe('authenticated');
    expect(nextGateStateForAuthSession('authenticated', 'reauthenticating')).toBe('authenticated');
  });
});

describe('shouldHealAuthSession', () => {
  test('heals only the manual re-authentication path', () => {
    expect(shouldHealAuthSession('authenticated', 'reauthenticating')).toBe(true);
  });

  test('never heals a confirmed expiry, so the lock is not erased', () => {
    expect(shouldHealAuthSession('authenticated', 'expired')).toBe(false);
  });

  test('does nothing while the session is live or the gate is not authenticated', () => {
    expect(shouldHealAuthSession('authenticated', 'ok')).toBe(false);
    expect(shouldHealAuthSession('locked', 'reauthenticating')).toBe(false);
  });
});
