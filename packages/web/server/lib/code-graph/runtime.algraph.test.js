import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCodeGraphRuntime } from './runtime.js';

/**
 * Repo-local `.algraph` store: each scope keeps its generations in a
 * gitignored folder inside the worked-on repo, falling back to the
 * configured user-root store when the scope cannot host one. A user-root
 * generation moves over on first use instead of forcing a rebuild.
 */
const root = mkdtempSync(join(tmpdir(), 'code-graph-algraph-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const makeRepo = (name) => {
  const dir = join(root, name);
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(
    join(dir, 'a.ts'),
    'export function inner(): number {\n  return 1;\n}\n\nexport function outer(): number {\n  return inner();\n}\n',
  );
  return dir;
};

const makeRuntime = (storeDir, events) => {
  const options = { blockOnRead: true, storeDir };
  if (events) options.onProgress = (event) => events.push(event);
  return createCodeGraphRuntime({ fsPromises, path }, options);
};

const findManifests = (dir) => {
  const found = [];
  const walk = (current) => {
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'manifest.json') found.push(full);
    }
  };
  walk(dir);
  return found;
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

describe('repo-local algraph store', () => {
  it('persists generations under .algraph and names the folder in gitignore', async () => {
    const dir = makeRepo('repo-local');
    const storeDir = join(root, 'store-user-1');
    const runtime = makeRuntime(storeDir);
    const built = await runtime.readIndex(dir);
    expect(built.ready).toBe(true);

    const manifests = findManifests(join(dir, '.algraph'));
    expect(manifests.length).toBe(1);
    const manifestDir = join(manifests[0], '..');
    expect(readJson(manifests[0]).buildSeq).toBe(built.generation);

    expect(readFileSync(join(dir, '.algraph', '.gitignore'), 'utf8')).toBe('*\n!.gitignore\n');

    const second = makeRuntime(storeDir);
    const reread = await second.readIndex(dir);
    expect(reread.generation).toBe(built.generation);
    const repoIgnore = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(repoIgnore.split('\n').filter((line) => line.trim() === '/.algraph/').length).toBe(1);

    expect(findManifests(storeDir).length).toBe(0);
  }, 60000);

  it('falls back to the user store when the scope cannot host .algraph', async () => {
    const dir = makeRepo('fallback');
    writeFileSync(join(dir, '.algraph'), 'a file blocks the directory\n');
    const storeDir = join(root, 'store-user-2');
    const runtime = makeRuntime(storeDir);
    const built = await runtime.readIndex(dir);
    expect(built.ready).toBe(true);
    expect(statSync(join(dir, '.algraph')).isFile()).toBe(true);
    expect(findManifests(storeDir).length).toBe(1);
  }, 60000);

  it('moves an existing user-root generation over instead of rebuilding', async () => {
    const dir = makeRepo('migrate');
    const storeDir = join(root, 'store-user-3');
    writeFileSync(join(dir, '.algraph'), 'a file blocks the directory\n');
    const first = makeRuntime(storeDir);
    const built = await first.readIndex(dir);
    expect(built.ready).toBe(true);
    expect(built.generation).toBe(1);
    expect(findManifests(storeDir).length).toBe(1);

    unlinkSync(join(dir, '.algraph'));
    const events = [];
    const second = makeRuntime(storeDir, events);
    const restored = await second.readIndex(dir);
    expect(restored.ready).toBe(true);
    expect(restored.freshness).toBe('fresh');
    expect(restored.generation).toBe(built.generation);
    expect(restored.nodeCount).toBe(built.nodeCount);
    expect(restored.edgeCount).toBe(built.edgeCount);
    expect(events.some((event) => event.restoredFromStore === true)).toBe(true);

    const moved = findManifests(join(dir, '.algraph'));
    expect(moved.length).toBe(1);
    expect(readJson(moved[0]).buildSeq).toBe(built.generation);
    expect(findManifests(storeDir).length).toBe(0);
  }, 120000);

  it('keeps restoring after the managed ignore line lands', async () => {
    const dir = makeRepo('carveout');
    const storeDir = join(root, 'store-user-4');
    const first = makeRuntime(storeDir);
    const built = await first.readIndex(dir);
    expect(built.ready).toBe(true);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8').split('\n')).toContain('/.algraph/');

    const events = [];
    const second = makeRuntime(storeDir, events);
    const restored = await second.readIndex(dir);
    expect(restored.generation).toBe(built.generation);
    expect(events.some((event) => event.restoredFromStore === true)).toBe(true);
  }, 120000);
});
