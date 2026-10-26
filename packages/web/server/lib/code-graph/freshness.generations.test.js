import { execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

/**
 * Index generations: a repository change must move the published generation and
 * retire the previous snapshot's answers, never blend the two.
 *
 * Every case drives the real runtime over a real temp directory (a checkout for
 * the git-bound cases, a plain directory for the content-bound ones), so the
 * binding, the rebuild and the query memo are exercised end to end rather than
 * simulated.
 */

const runtime = createCodeGraphRuntime({ fsPromises, path });
const root = mkdtempSync(join(tmpdir(), 'code-graph-generations-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const commit = (dir, message) => {
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=qa@example.test', '-c', 'user.name=qa', 'commit', '-m', message], {
    cwd: dir,
    stdio: 'ignore',
  });
};

const idsFor = async (dir, query, extra = {}) => {
  const envelope = await runtime.query(dir, { kind: 'search', query, limit: 20, ...extra });
  return envelope.items.map((item) => item.id);
};

describe('index generations', () => {
  it('a commit invalidates the old rows and increments the published generation', async () => {
    const dir = join(root, 'git-edit');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\n');
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    commit(dir, 'alpha');

    const first = await runtime.readIndex(dir);
    expect(first.binding).toBe('git-head');
    expect(first.generation).toBeGreaterThan(0);
    expect(await idsFor(dir, 'alpha')).toContain('const:alpha@a.ts');

    writeFileSync(join(dir, 'a.ts'), 'export const beta = 2;\n');
    commit(dir, 'beta');

    const second = await runtime.readIndex(dir);
    expect(second.revision).not.toBe(first.revision);
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(await idsFor(dir, 'beta')).toContain('const:beta@a.ts');
    expect(await idsFor(dir, 'alpha')).toEqual([]);
  });

  it('an in-place edit outside git still moves the revision (size and mtime stamping)', async () => {
    const dir = join(root, 'plain-edit');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'b.ts'), 'export const gamma = 3;\n');

    const first = await runtime.readIndex(dir);
    expect(first.binding).toBe('content');
    expect(await idsFor(dir, 'gamma')).toContain('const:gamma@b.ts');

    writeFileSync(join(dir, 'b.ts'), 'export const delta = 4;\n');

    const second = await runtime.readIndex(dir);
    expect(second.revision).not.toBe(first.revision);
    expect(await idsFor(dir, 'delta')).toContain('const:delta@b.ts');
    expect(await idsFor(dir, 'gamma')).toEqual([]);
  });

  it('a rename and a delete each move the revision and retire the file', async () => {
    const dir = join(root, 'plain-rename');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'old.ts'), 'export const epsilon = 5;\n');

    const first = await runtime.readIndex(dir);
    renameSync(join(dir, 'old.ts'), join(dir, 'new.ts'));

    const renamed = await runtime.readIndex(dir);
    expect(renamed.revision).not.toBe(first.revision);
    const fileView = await runtime.query(dir, { kind: 'file', file: 'new.ts' });
    expect(fileView.coverage).toBe('indexed');
    expect(await idsFor(dir, 'epsilon')).toContain('const:epsilon@new.ts');

    rmSync(join(dir, 'new.ts'));

    const deleted = await runtime.readIndex(dir);
    expect(deleted.revision).not.toBe(renamed.revision);
    expect(await idsFor(dir, 'epsilon')).toEqual([]);
  });

  it('refresh forces a new generation even when the tree did not move', async () => {
    const dir = join(root, 'refresh');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'c.ts'), 'export const zeta = 6;\n');

    const first = await runtime.readIndex(dir);
    const again = await runtime.readIndex(dir);
    expect(again.generation).toBe(first.generation);

    const forced = await runtime.readIndex(dir, { refresh: true });
    expect(forced.generation).toBeGreaterThan(first.generation);
    expect(forced.revision).toBe(first.revision);
  });

  it('one generation serves distinct cache keys for query, mode and limit', async () => {
    const dir = join(root, 'cache-keys');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'd.ts'), 'export const eta = 7;\nexport const thetaTheSecond = 8;\n');

    await runtime.readIndex(dir);

    const one = await runtime.query(dir, { kind: 'search', query: 'e', limit: 1 });
    const many = await runtime.query(dir, { kind: 'search', query: 'e', limit: 20 });
    expect(one.items.length).toBe(1);
    expect(many.items.length).toBeGreaterThan(1);

    const byName = await runtime.query(dir, { kind: 'search', query: 'eta', limit: 20 });
    const byContent = await runtime.query(dir, { kind: 'content', query: 'thetaTheSecond', limit: 20 });
    expect(byName.items.some((item) => item.id === 'const:eta@d.ts')).toBe(true);
    expect(byContent.items.length).toBeGreaterThan(0);
    expect(byContent.items[0].file).toBe('d.ts');
  });
});
