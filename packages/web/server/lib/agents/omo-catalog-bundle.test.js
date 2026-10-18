import { describe, expect, it } from 'bun:test';

import { OMO_CATALOG_ITEMS, OMO_CATALOG_VERSION } from './omo-catalog.bundle.js';

const EXPECTED_IDS = [
  'explore',
  'librarian',
  'plan-consultant',
  'plan-reviewer',
  'omo-native-code-reviewer',
  'omo-native-qa-executor',
  'omo-native-gate-reviewer',
  'quick',
  'architect',
  'deep-low',
  'deep-high',
  'oracle',
  'metis',
  'momus',
  'sisyphus',
  'sisyphus-junior',
  'hephaestus',
  'prometheus',
  'multimodal-looker',
  'atlas',
];

describe('omo-catalog bundle preserves the engine catalog contract', () => {
  it('ships version 1 with the stable catalog ids', () => {
    expect(OMO_CATALOG_VERSION).toBe(1);
    expect(OMO_CATALOG_ITEMS.map((item) => item.id)).toEqual(EXPECTED_IDS);
  });

  it('labels every item OmO-compatible with a real edition', () => {
    for (const item of OMO_CATALOG_ITEMS) {
      expect(item.source).toBe('omo-compatible');
      expect(['senpi', 'opencode']).toContain(item.edition);
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it('keeps categories a distinct kind without definitions', () => {
    const categories = OMO_CATALOG_ITEMS.filter((item) => item.kind === 'category');
    expect(categories.map((item) => item.id).sort()).toEqual(['architect', 'deep-high', 'deep-low', 'quick']);
    for (const item of categories) {
      expect(item.prompt ?? null).toBeNull();
    }
  });

  it('carries senpi prompts and model policy for agent details', () => {
    const explore = OMO_CATALOG_ITEMS.find((item) => item.id === 'explore');
    expect(explore?.prompt?.length ?? 0).toBeGreaterThan(0);
    expect(explore?.executionMode).toBe('in-process');
    expect(explore?.tools?.allow?.length ?? 0).toBeGreaterThan(0);
  });

  it('declares requirements instead of failing silently', () => {
    // Ungated categories resolve dynamically: no model gate to declare.
    const architect = OMO_CATALOG_ITEMS.find((item) => item.id === 'architect');
    expect(architect?.requiresModels).toBeUndefined();
    const oracle = OMO_CATALOG_ITEMS.find((item) => item.id === 'oracle');
    expect(oracle?.requiresCapabilities).toEqual(['opencode-engine']);
  });
});
