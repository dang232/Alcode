import { execFile as realExecFile, execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GIT_STATUS_TTL_MS, createCodeGraphRuntime } from './runtime.js';

/**
 * Working-tree freshness: an uncommitted edit must move the revision exactly
 * like a HEAD move, without a status spawn per query.
 *
 * Every case drives the real runtime over a real temp git checkout (`git
 * init` + commit in its own directory, never the Alwork checkout), so the
 * status probe, the TTL, and the rebuild are exercised end to end. The only
 * instrumentation is a delegating `execFile` fake that counts status spawns,
 * injected through the runtime's dependency seam — git itself still runs,
 * and no runtime logic is stubbed.
 */

// Spawn counting without module mocking: the fake delegates to the real
// `execFile` and only counts git status probes.
const statusSpawns = { count: 0 };

const countingExecFile = (file, execArgs, options, callback) => {
  if (file === 'git' && Array.isArray(execArgs) && execArgs.includes('status')) {
    statusSpawns.count += 1;
  }
  return realExecFile(file, execArgs, options, callback);
};

const root = mkdtempSync(join(tmpdir(), 'code-graph-runtime-freshness-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  statusSpawns.count = 0;
});

const commitAll = (dir, message) => {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.email=qa@example.test', '-c', 'user.name=qa', 'commit', '-m', message],
    { cwd: dir, stdio: 'ignore' },
  );
};

let seq = 0;
const makeRepo = (files) => {
  const dir = join(root, `repo-${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  commitAll(dir, 'init');
  return dir;
};

const makeRuntime = () => createCodeGraphRuntime({ fsPromises, path, execFile: countingExecFile }, { blockOnRead: true });

const idsFor = async (runtime, dir, query, extra = {}) => {
  const envelope = await runtime.query(dir, { kind: 'search', query, limit: 20, ...extra });
  return envelope.items.map((item) => item.id);
};

describe('working-tree freshness', () => {
  it(
    'a modified entry file changes the revision and rebuilds the snapshot',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const runtime = makeRuntime();

      const first = await runtime.readIndex(dir);
      expect(first.binding).toBe('git-head');
      expect(first.dirty).toBe('clean');
      expect(await idsFor(runtime, dir, 'alpha')).toContain('const:alpha@a.ts');

      writeFileSync(
        join(dir, 'a.ts'),
        'export const alpha = 1;\nexport const beta = 2;\nexport const gamma = 3;\n',
      );

      const second = await runtime.readIndex(dir, { refresh: true });
      expect(second.revision).not.toBe(first.revision);
      expect(second.dirty).toBe('dirty');
      expect(second.nodeCount).toBeGreaterThan(first.nodeCount);
      expect(second.edgeCount).toBeGreaterThan(first.edgeCount);
      expect(await idsFor(runtime, dir, 'beta')).toContain('const:beta@a.ts');
    },
    60_000,
  );

  it(
    'staging an edit also moves the revision',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const runtime = makeRuntime();

      const first = await runtime.readIndex(dir);
      expect(first.dirty).toBe('clean');

      // Same byte length: only the status code and mtime can move the revision.
      writeFileSync(join(dir, 'a.ts'), 'export const alpha = 2;\n');
      execFileSync('git', ['add', 'a.ts'], { cwd: dir, stdio: 'ignore' });

      const staged = await runtime.readIndex(dir, { refresh: true });
      expect(staged.dirty).toBe('dirty');
      expect(staged.revision).not.toBe(first.revision);
    },
    60_000,
  );

  it(
    'an untracked entry file changes the revision and is indexed',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const runtime = makeRuntime();

      const first = await runtime.readIndex(dir);
      writeFileSync(join(dir, 'fresh.ts'), 'export const fresh = 42;\n');

      const second = await runtime.readIndex(dir, { refresh: true });
      expect(second.revision).not.toBe(first.revision);
      expect(second.dirty).toBe('dirty');

      const fileView = await runtime.query(dir, { kind: 'file', file: 'fresh.ts' });
      expect(fileView.coverage).toBe('indexed');
      expect(await idsFor(runtime, dir, 'fresh')).toContain('const:fresh@fresh.ts');
    },
    60_000,
  );

  it(
    'deleting an entry file changes the revision and retires its nodes',
    async () => {
      const dir = makeRepo({
        'a.ts': 'export const alpha = 1;\n',
        'b.ts': 'export const beta = 2;\n',
      });
      const runtime = makeRuntime();

      const first = await runtime.readIndex(dir);
      expect(await idsFor(runtime, dir, 'alpha')).toContain('const:alpha@a.ts');

      rmSync(join(dir, 'a.ts'));

      const second = await runtime.readIndex(dir, { refresh: true });
      expect(second.revision).not.toBe(first.revision);
      expect(second.dirty).toBe('dirty');
      expect(second.nodeCount).toBeLessThan(first.nodeCount);
      expect(await idsFor(runtime, dir, 'alpha')).toEqual([]);
      expect(await idsFor(runtime, dir, 'beta')).toContain('const:beta@b.ts');
    },
    60_000,
  );

  it(
    'a HEAD move still rebuilds',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const runtime = makeRuntime();

      const first = await runtime.readIndex(dir);
      writeFileSync(join(dir, 'a.ts'), 'export const beta = 2;\n');
      commitAll(dir, 'beta');

      const second = await runtime.readIndex(dir);
      expect(second.revision).not.toBe(first.revision);
      expect(second.generation).toBeGreaterThan(first.generation);
      expect(await idsFor(runtime, dir, 'beta')).toContain('const:beta@a.ts');
      expect(await idsFor(runtime, dir, 'alpha')).toEqual([]);
    },
    60_000,
  );

  it(
    'a second query within the TTL spawns no status process, and one after it does',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const runtime = makeRuntime();

      const first = await runtime.readIndex(dir);
      expect(statusSpawns.count).toBe(1);

      await runtime.readIndex(dir);
      await runtime.query(dir, { kind: 'search', query: 'alpha' });
      expect(statusSpawns.count).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, GIT_STATUS_TTL_MS + 400));

      const reread = await runtime.readIndex(dir);
      expect(statusSpawns.count).toBe(2);
      // Clean tree, unchanged HEAD: the re-probe confirms freshness without rebuilding.
      expect(reread.revision).toBe(first.revision);
      expect(reread.generation).toBe(first.generation);
    },
    60_000,
  );

  it(
    'refresh:true bypasses the status TTL',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const runtime = makeRuntime();

      await runtime.readIndex(dir);
      expect(statusSpawns.count).toBe(1);

      await runtime.readIndex(dir, { refresh: true });
      expect(statusSpawns.count).toBe(2);
    },
    60_000,
  );

  it(
    'a failing status probe falls back to HEAD with a labelled unknown dirty state',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const runtime = makeRuntime();

      const first = await runtime.readIndex(dir);
      expect(first.dirty).toBe('clean');

      // Garbage where git keeps its index: `git status` fails while the
      // spawn-free HEAD read still resolves.
      writeFileSync(join(dir, '.git', 'index'), 'not-a-git-index');

      const second = await runtime.readIndex(dir, { refresh: true });
      expect(second.freshness).toBe('fresh');
      expect(second.revision).toBe(first.revision);
      expect(second.dirty).toBe('unknown');
      expect(second.dirtyReason).toEqual(expect.any(String));
      expect(second.dirtyReason.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
