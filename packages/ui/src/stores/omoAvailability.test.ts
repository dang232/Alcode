import { describe, expect, test } from 'bun:test';

import { resolveOmoAvailability, type OmoAvailabilityContext } from './omoAvailability';

const ctx = (overrides: Partial<OmoAvailabilityContext> = {}): OmoAvailabilityContext => ({
  agentNames: new Set(['build', 'general', 'explore']),
  disabledNames: new Set(),
  listUnknown: false,
  ...overrides,
});

describe('resolveOmoAvailability', () => {
  test('a live enabled name is available with the session default model', () => {
    expect(
      resolveOmoAvailability({ id: 'explore', kind: 'agent', fallback: ['explore'] }, ctx()),
    ).toEqual({ status: 'available', resolvedModel: 'session default', actions: ['dispatch'] });
  });

  test('a pinned connected model resolves on the entry', () => {
    const result = resolveOmoAvailability(
      { id: 'build', kind: 'agent' },
      ctx({
        agentModel: () => 'opencode-go/qwen3.7-plus',
        isModelConnected: (model) => model === 'opencode-go/qwen3.7-plus',
      }),
    );
    expect(result.status).toBe('available');
    expect(result.resolvedModel).toBe('opencode-go/qwen3.7-plus');
  });

  test('a pinned disconnected model is unavailable with its reason', () => {
    const result = resolveOmoAvailability(
      { id: 'build', kind: 'agent' },
      ctx({
        agentModel: () => 'gone-provider/gone-model',
        isModelConnected: () => false,
      }),
    );
    expect(result.status).toBe('unavailable');
    expect(result.reason).toEqual({ key: 'modelNotConnected', params: { model: 'gone-provider/gone-model' } });
    expect(result.actions).toEqual([]);
  });

  test('a disabled live name is unavailable, never silently dispatchable', () => {
    const result = resolveOmoAvailability(
      { id: 'explore', kind: 'agent', fallback: ['explore'] },
      ctx({ disabledNames: new Set(['explore']) }),
    );
    expect(result.status).toBe('unavailable');
    expect(result.reason).toEqual({ key: 'disabled' });
  });

  test('a missing name resolves its first live fallback', () => {
    const result = resolveOmoAvailability(
      { id: 'librarian', kind: 'agent', fallback: ['librarian', 'explore'] },
      ctx(),
    );
    expect(result.status).toBe('fallback_available');
    expect(result.fallback).toBe('explore');
    expect(result.reason).toEqual({ key: 'fallback', params: { name: 'librarian', fallback: 'explore' } });
  });

  test('a category names its fallback without dispatch actions', () => {
    const result = resolveOmoAvailability(
      { id: 'quick', kind: 'category', fallback: ['explore'] },
      ctx(),
    );
    expect(result.status).toBe('fallback_available');
    expect(result.fallback).toBe('explore');
    expect(result.actions).toEqual([]);
  });

  test('a missing name without a live fallback is unavailable with clone', () => {
    const result = resolveOmoAvailability(
      { id: 'oracle', kind: 'agent', fallback: ['oracle', 'explore'] },
      ctx({ agentNames: new Set(['build']) }),
    );
    expect(result.status).toBe('unavailable');
    expect(result.reason).toEqual({ key: 'notRegistered', params: { name: 'oracle' } });
    expect(result.actions).toEqual(['clone']);
  });

  test('a failed live list is unknown, never empty success', () => {
    const result = resolveOmoAvailability(
      { id: 'explore', kind: 'agent', fallback: ['explore'] },
      ctx({ listUnknown: true }),
    );
    expect(result.status).toBe('unknown');
    expect(result.actions).toEqual([]);
  });
});
