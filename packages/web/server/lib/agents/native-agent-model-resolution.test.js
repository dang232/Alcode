import { describe, expect, it } from 'vitest';

import {
  buildNativeAgentConfigMap,
  getNativeAgentModelGaps,
  NATIVE_AGENT_MODEL_CHAINS,
  NATIVE_STATIC_AGENT_KEYS,
  resolveStaticAgentModel,
} from './omo-native-catalog.bundle.js';

const chainIndex = (configKey, modelRef) => {
  const chain = NATIVE_AGENT_MODEL_CHAINS[configKey] ?? [];
  const bare = String(modelRef ?? '').split('#')[0];
  return chain.findIndex((entry) => {
    const id = typeof entry?.model === 'string' ? entry.model : '';
    return (entry?.providers ?? []).some((provider) => `${provider}/${id}` === bare || id === bare);
  });
};

describe('native static agent model resolution', () => {
  it('resolves the preferred model when its provider is connected', () => {
    const resolved = resolveStaticAgentModel('explore', {
      connectedProviders: ['kimi-for-coding', 'opencode-go'],
    });
    expect(resolved?.model).toBe('kimi-for-coding/kimi-for-coding-highspeed#off');
    expect(resolved?.provenance).toBe('provider-fallback');
    expect(chainIndex('explore', resolved?.model)).toBe(0);
  });

  it('falls back within the SAME agent chain when the head provider is gone', () => {
    const resolved = resolveStaticAgentModel('explore', {
      connectedProviders: ['opencode-go'],
    });
    expect(resolved?.model).toBe('opencode-go/qwen3.7-plus');
    expect(chainIndex('explore', resolved?.model)).toBeGreaterThan(0);
  });

  it('returns a typed sentinel when no chain provider is connected', () => {
    expect(resolveStaticAgentModel('explore', { connectedProviders: [] })).toMatchObject({
      noEligible: true,
      reason: 'chain-exhausted',
      configKey: 'explore',
    });
  });

  it('honours an explicit override when its provider is connected', () => {
    const resolved = resolveStaticAgentModel('explore', {
      connectedProviders: ['custom-lab'],
      modelOverride: 'custom-lab/test-model',
    });
    expect(resolved?.model).toBe('custom-lab/test-model');
    expect(resolved?.provenance).toBe('override');
  });

  it('rejects an override naming a known-but-absent provider', () => {
    expect(resolveStaticAgentModel('explore', {
      connectedProviders: [],
      modelOverride: 'custom-lab/test-model',
    })).toMatchObject({
      noEligible: true,
      reason: 'override-provider-unavailable',
      configKey: 'explore',
      override: 'custom-lab/test-model',
    });
  });

  it('keeps identity and read-only permissions across a fallback', () => {
    const first = buildNativeAgentConfigMap({ connectedProviders: ['opencode-go'] });
    const second = buildNativeAgentConfigMap({ connectedProviders: ['opencode-go', 'kimi-for-coding'] });
    expect(first.oracle.model).toBe('opencode-go/glm-5.2');
    for (const key of ['description', 'mode']) {
      expect(second.oracle[key]).toBe(first.oracle[key]);
    }
    expect(second.oracle.permission).toEqual(first.oracle.permission);
    expect(first.oracle.permission).toMatchObject({
      call_omo_agent: 'deny',
      edit: 'deny',
    });
  });

  it('drops model-less agents from the shipped map and reports the gaps', () => {
    const empty = buildNativeAgentConfigMap({ connectedProviders: [] });
    expect(empty.explore).toBeUndefined();
    const gaps = getNativeAgentModelGaps({ connectedProviders: [] });
    const exploreGap = gaps.find((gap) => gap.configKey === 'explore');
    expect(exploreGap).toMatchObject({ reason: 'chain-exhausted' });
    expect(Array.isArray(exploreGap.chain)).toBe(true);
    for (const key of NATIVE_STATIC_AGENT_KEYS) {
      expect(empty[key]?.model ?? null).not.toBe('general/general');
    }
  });

  it('never substitutes another identity and never freezes the head', () => {
    const blind = buildNativeAgentConfigMap();
    for (const key of NATIVE_STATIC_AGENT_KEYS) {
      expect(blind[key]).toBeDefined();
      expect(blind[key]).not.toHaveProperty('model');
    }
  });
});
