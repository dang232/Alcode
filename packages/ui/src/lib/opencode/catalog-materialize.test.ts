import { describe, expect, test } from 'bun:test';

import {
  buildCatalogAgentConfig,
  canMaterializeCatalogAgent,
  CATALOG_MATERIALIZE_PERMISSIONS,
  CATALOG_MATERIALIZE_RUNTIME_NOTE,
} from './catalog-materialize';

const librarianItem = {
  id: 'librarian',
  kind: 'agent',
  description: 'Read-only open-source research specialist.',
  edition: 'opencode',
  prompt: '# THE LIBRARIAN\nResearch with evidence.',
} as const;

describe('catalog-materialize', () => {
  test('materializes only the ungated native research agents', () => {
    expect(canMaterializeCatalogAgent(librarianItem)).toBe(true);
    expect(canMaterializeCatalogAgent({ ...librarianItem, id: 'explore' })).toBe(true);
    expect(canMaterializeCatalogAgent({ ...librarianItem, kind: 'category' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, edition: 'senpi' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, id: 'plan-consultant', prompt: 'x' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, id: 'plan-reviewer', prompt: 'x' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, id: 'omo-native-code-reviewer', prompt: 'x' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, id: 'omo-native-qa-executor', prompt: 'x' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, id: 'omo-native-gate-reviewer', prompt: 'x' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, id: 'oracle', prompt: 'x' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, prompt: '' })).toBe(false);
    expect(canMaterializeCatalogAgent({ ...librarianItem, prompt: null })).toBe(false);
  });

  test('builds an exact-name user subagent config', () => {
    const config = buildCatalogAgentConfig(librarianItem);
    expect(config.name).toBe('librarian');
    expect(config.scope).toBe('user');
    expect(config.mode).toBe('subagent');
    expect(config.description).toBe(librarianItem.description);
  });

  test('prepends the runtime note without rewriting the prompt', () => {
    const config = buildCatalogAgentConfig(librarianItem);
    expect(config.system?.startsWith(CATALOG_MATERIALIZE_RUNTIME_NOTE)).toBe(true);
    expect(config.system).toContain(librarianItem.prompt);
  });

  test('keeps read-only rules with broad denies before narrow allows', () => {
    const actions = CATALOG_MATERIALIZE_PERMISSIONS.map((rule) => `${rule.action} ${rule.resource} ${rule.effect}`);
    expect(actions).toContain('edit * deny');
    expect(actions).toContain('shell * deny');
    expect(actions).toContain('shell gh * allow');
    expect(actions).toContain('shell curl * allow');
    const denyShell = actions.indexOf('shell * deny');
    expect(actions.indexOf('shell gh * allow')).toBeGreaterThan(denyShell);
    expect(actions.indexOf('shell curl * allow')).toBeGreaterThan(denyShell);
  });
});
