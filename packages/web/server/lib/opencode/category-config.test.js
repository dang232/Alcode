import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { clearCategoryModel, getCategoryConfig, setCategoryModel } from './category-config.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const freshProject = async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alcode-category-config-'));
  temporaryDirectories.push(projectDir);
  return projectDir;
};

describe('category model config', () => {
  it('reports catalog defaults with the live chain override', () => {
    const found = getCategoryConfig('unspecified-high', {});
    expect(found.name).toBe('unspecified-high');
    expect(found.defaults.requiresModels.length).toBeGreaterThan(0);
    const overrideModel = found.override && found.override.model
      ? found.override.model
      : null;
    expect(found.effectiveModel).toBe(overrideModel ?? found.defaults.model);
  });

  it('sets, reads back, and clears a project override', async () => {
    const projectDir = await freshProject();
    const before = getCategoryConfig('unspecified-high', { projectDir });
    setCategoryModel('unspecified-high', 'openai/gpt-5.6-sol', { scope: 'project', projectDir });
    const after = getCategoryConfig('unspecified-high', { projectDir });
    expect(after.override?.model).toBe('openai/gpt-5.6-sol');
    expect(after.effectiveModel).toBe('openai/gpt-5.6-sol');
    clearCategoryModel('unspecified-high', { scope: 'project', projectDir });
    const cleared = getCategoryConfig('unspecified-high', { projectDir });
    expect(cleared.effectiveModel).toBe(before.effectiveModel);
  });

  it('rejects unknown categories and malformed models', async () => {
    const projectDir = await freshProject();
    expect(() => getCategoryConfig('nope', {})).toThrow('Unknown category');
    expect(() => setCategoryModel('quick', 'not-a-model', { scope: 'project', projectDir })).toThrow('Invalid model reference');
    expect(() => setCategoryModel('nope', 'openai/gpt-5.6-sol', { scope: 'project', projectDir })).toThrow('Unknown category');
  });
});
