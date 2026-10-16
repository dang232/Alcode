// Fixture-only round-trip over the engine omo.json core, through the committed
// bundle (`omo-config.bundle.js`, regen with `bun ./omo-config.regen.js`).
// No network, no keys, no real home directory: every read points at a scratch
// temp dir (env HOME overridden) and every write targets a scratch file.
// Imports `bun:test` so the file runs under both `bun test` and the repo's
// vitest runner (which aliases `bun:test` to its shim).
// Nothing here imports engine `.ts` directly: the packaged server runs under
// plain Node with no transpile step, so the runtime chain under test stays
// bundle-only by construction.
import { afterAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OmoConfigLayerSchema,
  OmoConfigSchema,
  readOmoConfig,
  validateOmoConfig,
  validateOmoConfigLayer,
  writeOmoConfig,
} from './omo-config.bundle.js';
import * as configV2 from './config-v2.js';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alcode-omo-config-'));

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

function scratchDir(name) {
  const dir = path.join(scratchRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonc(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  return filePath;
}

describe('omo-config bridge delegates to omo-config-core', () => {
  it('re-exports the engine schema objects, not a fork', () => {
    expect(OmoConfigSchema).toBe(configV2.OmoConfigSchema);
    expect(OmoConfigLayerSchema).toBe(configV2.OmoConfigLayerSchema);
  });

  it('validates a merged document against the strict core schema', () => {
    const result = validateOmoConfig({ task: { default_concurrency: 2 } });
    expect(result.ok).toBe(true);
    expect(result.config.task.default_concurrency).toBe(2);
    expect(result.issues).toBeUndefined();
    // Schema-level parse carries the core `profiles` default and nothing else.
    expect(validateOmoConfig({}).config.profiles).toEqual({});
  });

  it('rejects unknown top-level keys the strict core schema rejects', () => {
    const result = validateOmoConfig({ bogus_key: 1 });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('validates a layer shape: partial values pass, unknown keys fail', () => {
    const good = validateOmoConfigLayer({ categories: { quick: { model: 'user-model' } } });
    expect(good.ok).toBe(true);
    const bad = validateOmoConfigLayer({ bogus_key: 1 });
    expect(bad.ok).toBe(false);
  });

  it('reads user plus project layers with nearest-project-wins precedence', () => {
    const home = scratchDir('home-precedence');
    const project = path.join(home, 'work', 'project');
    writeJsonc(path.join(home, '.omo', 'omo.jsonc'), {
      categories: { quick: { model: 'user-model' } },
      task: { default_concurrency: 2 },
    });
    writeJsonc(path.join(project, '.omo', 'omo.jsonc'), {
      task: { default_concurrency: 7 },
    });

    const result = readOmoConfig({
      cwd: path.join(project, 'child'),
      env: { HOME: home },
      platform: 'linux',
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.config.task.default_concurrency).toBe(7);
    expect(result.config.categories.quick.model).toBe('user-model');
    // Loader-seeded defaults survive the merge when no layer sets them.
    expect(result.config.task.wait.default_ms).toBe(60000);
    expect(result.sources.filter((source) => source.loaded).map((source) => source.scope).sort())
      .toEqual(['project', 'user']);
  });

  it('round-trips write then read through the engine atomic writer', () => {
    const home = scratchDir('home-roundtrip');
    const project = path.join(home, 'work', 'project');
    const targetPath = path.join(project, '.omo', 'omo.jsonc');

    const first = writeOmoConfig({
      edits: [{ path: ['task', 'default_concurrency'], value: 7 }],
      scope: 'project',
      targetPath,
    });
    expect(first.path).toBe(targetPath);
    expect(first.backupPath).toBeUndefined();

    const second = writeOmoConfig({
      edits: [{ path: ['categories', 'quick', 'model'], value: 'near-model' }],
      scope: 'project',
      targetPath,
    });
    expect(second.backupPath).toMatch(/\.bak\./);
    expect(fs.existsSync(second.backupPath)).toBe(true);

    const result = readOmoConfig({ cwd: project, env: { HOME: home }, platform: 'linux' });
    expect(result.diagnostics).toEqual([]);
    expect(result.config.task.default_concurrency).toBe(7);
    expect(result.config.categories.quick.model).toBe('near-model');
  });

  it('config-v2.js delegates omo.json reads and validation to the bridge', () => {
    const home = scratchDir('home-delegation');
    const project = path.join(home, 'work', 'project');
    writeJsonc(path.join(project, '.omo', 'omo.jsonc'), {
      task: { default_concurrency: 9 },
    });

    const viaBridge = readOmoConfig({ cwd: project, env: { HOME: home }, platform: 'linux' });
    const viaConfigV2 = configV2.readOmoConfig({ cwd: project, env: { HOME: home }, platform: 'linux' });
    expect(viaConfigV2.config.task.default_concurrency).toBe(
      viaBridge.config.task.default_concurrency,
    );
    expect(configV2.validateOmoConfig({})).toEqual(validateOmoConfig({}));
  });

  it('keeps the runtime chain on the bundle, never engine `.ts`', () => {
    const entry = fs.readFileSync(path.join(thisDir, 'config-v2.js'), 'utf8');
    expect(entry.includes("from './omo-config.bundle.js'")).toBe(true);
    expect(entry.includes("from './omo-config.js'")).toBe(false);
    for (const file of ['config-v2.js', 'omo-config.bundle.js', 'omo-config.test.js']) {
      const text = fs.readFileSync(path.join(thisDir, file), 'utf8');
      const tsImports = [...text.matchAll(/from\s*["']([^"']+\.ts)["']/g)].map((match) => match[1]);
      expect(tsImports).toEqual([]);
    }
    // The only runtime specifiers plain Node must resolve are node:* builtins;
    // engine code, zod, and jsonc-parser ship inlined in the bundle.
    const bundleText = fs.readFileSync(path.join(thisDir, 'omo-config.bundle.js'), 'utf8');
    const specifiers = [
      ...bundleText.matchAll(/from\s*["']([^"']+)["']/g),
      ...bundleText.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) expect(spec.startsWith('node:')).toBe(true);
  });
});
