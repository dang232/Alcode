import { execFile as realExecFile, execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GIT_STATUS_TTL_MS, createCodeGraphRuntime, resolveWatcherDebounceMs } from './runtime.js';

// Representation checks without a runtime `typeof` (banned by the anti-slop
// gate): tag dispatch for callables, a finite-number check for ages.
const isFunction = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Function]' || tag === '[object AsyncFunction]';
};

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

  it(
    'a query served from the previous generation names the edited file as stale',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n', 'b.ts': 'export const beta = 2;\n' });
      // Non-blocking on purpose: a blocking read would absorb the edit into
      // a new generation before the answer is served, leaving no pending set
      // to assert. The background rebuild serves the previous generation
      // with the measured staleness attached, exactly what the panel locks on.
      const runtime = createCodeGraphRuntime({ fsPromises, path, execFile: countingExecFile }, {});
      let index = await runtime.readIndex(dir);
      for (let i = 0; i < 200 && !index.ready; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        index = await runtime.readIndex(dir);
      }
      expect(index.ready).toBe(true);
      expect(index.staleFiles).toEqual([]);
      expect(index.pendingSync).toEqual([]);
      expect(index.syncStatus).toBe('ok');

      const clean = await runtime.query(dir, { kind: 'search', query: 'alpha', limit: 20 });
      expect(clean.staleFiles).toEqual([]);
      expect(clean.pendingSync).toEqual([]);

      writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\nexport const alphaNext = 2;\n');

      await new Promise((resolve) => setTimeout(resolve, GIT_STATUS_TTL_MS + 400));

      const stale = await runtime.query(dir, { kind: 'search', query: 'alpha', limit: 20 });
      expect(stale.pendingSync).toContain('a.ts');
      expect(stale.staleFiles.map((entry) => entry.file)).toEqual(['a.ts']);
      expect(Number.isFinite(stale.staleFiles[0].ageMs)).toBe(true);
      expect(stale.syncStatus).toBe('ok');
      expect(
        stale.unresolved.some(
          (line) => line.includes('stale: a.ts edited since index') && line.includes('Read directly'),
        ),
      ).toBe(true);

      // The rebuild absorbs the edit: a blocking refresh clears the pending set.
      const absorbed = await runtime.readIndex(dir, { refresh: true, block: true });
      expect(absorbed.ready).toBe(true);
      expect(absorbed.pendingSync).toEqual([]);
      expect(absorbed.staleFiles).toEqual([]);
    },
    60_000,
  );

  it(
    'an edit to a file the answer never references stays footer-only',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n', 'b.ts': 'export const beta = 2;\n' });
      const runtime = createCodeGraphRuntime({ fsPromises, path, execFile: countingExecFile }, {});
      let index = await runtime.readIndex(dir);
      for (let i = 0; i < 200 && !index.ready; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        index = await runtime.readIndex(dir);
      }
      expect(index.ready).toBe(true);

      writeFileSync(join(dir, 'b.ts'), 'export const beta = 2;\nexport const betaNext = 3;\n');

      await new Promise((resolve) => setTimeout(resolve, GIT_STATUS_TTL_MS + 400));

      // The alpha answer touches only a.ts: b.ts stays pending but earns no
      // banner file and no Read-directly note.
      const answered = await runtime.query(dir, { kind: 'search', query: 'alpha', limit: 20 });
      expect(answered.pendingSync).toContain('b.ts');
      expect(answered.staleFiles).toEqual([]);
      expect(answered.syncStatus).toBe('ok');
      expect(answered.unresolved.some((line) => line.includes('stale:'))).toBe(false);

      await runtime.readIndex(dir, { refresh: true, block: true });
    },
    60_000,
  );

  it(
    'connect-time catch-up absorbs off-session edits on the first query without a full re-index',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n', 'b.ts': 'export const beta = 2;\n' });
      const runtime = createCodeGraphRuntime({ fsPromises, path, execFile: countingExecFile }, {});
      let index = await runtime.readIndex(dir);
      for (let i = 0; i < 200 && !index.ready; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        index = await runtime.readIndex(dir);
      }
      expect(index.ready).toBe(true);
      const firstGeneration = index.generation;
      expect(index.pendingSync).toEqual([]);

      // An off-session edit committed while the session was away
      // (git-pull-like): HEAD moves with a clean tree, so the S2 dirt set is
      // empty and only the connect-time catch-up can name the file.
      writeFileSync(join(dir, 'b.ts'), 'export const beta = 2;\nexport const betaNext = 3;\n');
      commitAll(dir, 'pull: betaNext');

      await new Promise((resolve) => setTimeout(resolve, GIT_STATUS_TTL_MS + 400));

      // The first query of the generation serves the previous generation and
      // reports the caught-up file into the S2 pending-sync set.
      const first = await runtime.query(dir, { kind: 'search', query: 'beta', limit: 20 });
      expect(first.pendingSync).toContain('b.ts');
      expect(first.staleFiles.map((entry) => entry.file)).toEqual(['b.ts']);
      expect(Number.isFinite(first.staleFiles[0].ageMs)).toBe(true);
      expect(first.syncStatus).toBe('ok');

      // The absorb is incremental: exactly the edited file reanalyzes.
      const absorbed = await runtime.readIndex(dir, { block: true });
      expect(absorbed.ready).toBe(true);
      expect(absorbed.generation).toBeGreaterThan(firstGeneration);
      expect(absorbed.incremental?.reanalyzed).toBe(1);
      expect(absorbed.incremental?.reused).toBe(1);
      expect(absorbed.pendingSync).toEqual([]);
      expect(absorbed.staleFiles).toEqual([]);
      const evolved = await runtime.query(dir, { kind: 'search', query: 'betaNext', limit: 20 });
      expect(evolved.items.some((item) => item.name === 'betaNext')).toBe(true);

      // refresh:true still forces a new generation on a clean tree.
      const forced = await runtime.readIndex(dir, { refresh: true, block: true });
      expect(forced.ready).toBe(true);
      expect(forced.generation).toBeGreaterThan(absorbed.generation);
    },
    60_000,
  );

  it(
    'an explicit sync opt-out serves disabled instead of a per-file pending set',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const runtime = createCodeGraphRuntime(
        { fsPromises, path, execFile: countingExecFile },
        { blockOnRead: true, syncDisabled: true },
      );

      const index = await runtime.readIndex(dir);
      expect(index.ready).toBe(true);
      expect(index.syncStatus).toBe('disabled');
      expect(index.staleFiles).toEqual([]);
      expect(index.pendingSync).toEqual([]);

      const answered = await runtime.query(dir, { kind: 'search', query: 'alpha', limit: 20 });
      expect(answered.syncStatus).toBe('disabled');
      expect(answered.staleFiles).toEqual([]);
      expect(answered.pendingSync).toEqual([]);
    },
    60_000,
  );
});

describe('S4 native watcher freshness driver', () => {
  it('clamps the env-tunable debounce to 100ms..60s', () => {
    expect(resolveWatcherDebounceMs(50)).toBe(100);
    expect(resolveWatcherDebounceMs(2000)).toBe(2000);
    expect(resolveWatcherDebounceMs(999_999)).toBe(60_000);
    expect(resolveWatcherDebounceMs('nope')).toBe(2000);
  });

  it(
    'a burst of writes coalesces to exactly one background sync',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      let fire = null;
      const watchFactory = (scopeRoot, onEvent) => {
        void scopeRoot;
        fire = onEvent;
        return { close: () => { fire = null; } };
      };
      const readyGenerations = [];
      const runtime = createCodeGraphRuntime(
        { fsPromises, path, execFile: countingExecFile },
        {
          blockOnRead: true,
          watcherEnabled: true,
          watcherDebounceMs: 100,
          watchFactory,
          onProgress: (progress) => {
            if (progress?.state === 'ready' && Number.isFinite(progress?.generation)) {
              readyGenerations.push(progress.generation);
            }
          },
        },
      );
      try {
        const first = await runtime.readIndex(dir);
        expect(first.ready).toBe(true);
        expect(runtime.watcherState().enabled).toBe(true);
        expect(runtime.watcherState().watchedScopes.length).toBe(1);
        const base = first.generation;
        expect(isFunction(fire)).toBe(true);

        // Burst: five real writes, one watcher event each, delivered back to
        // back so the debounce sees a single burst instead of five edits.
        for (let i = 0; i < 5; i += 1) {
          writeFileSync(join(dir, `burst${i}.ts`), `export const burst${i} = ${i};\n`);
          fire?.();
        }
        // A second flurry before the debounce fires still joins the one sync.
        for (let i = 0; i < 3; i += 1) fire?.();

        // The single-flight job publishes exactly one new generation.
        const deadline = Date.now() + 20_000;
        let current = await runtime.readIndex(dir);
        while (current.generation <= base && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          current = await runtime.readIndex(dir);
        }
        expect(current.generation).toBe(base + 1);

        // Quiet window: no second sync follows the burst.
        await new Promise((resolve) => setTimeout(resolve, 800));
        const settled = await runtime.readIndex(dir);
        expect(settled.generation).toBe(base + 1);
        expect(readyGenerations.filter((gen) => gen > base)).toEqual([base + 1]);

        // The burst contents are indexed by that single sync.
        const found = await runtime.query(dir, { kind: 'search', query: 'burst', limit: 20 });
        expect(found.items.some((item) => item.name === 'burst0')).toBe(true);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'watcher-disabled mode never watches and manual refresh still rebuilds',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      let factoryCalls = 0;
      const runtime = createCodeGraphRuntime(
        { fsPromises, path, execFile: countingExecFile },
        {
          blockOnRead: true,
          watcherEnabled: false,
          watchFactory: () => {
            factoryCalls += 1;
            return { close: () => {} };
          },
        },
      );
      try {
        const first = await runtime.readIndex(dir);
        expect(first.ready).toBe(true);
        const base = first.generation;

        writeFileSync(join(dir, 'manual.ts'), 'export const manual = 1;\n');

        // No watcher registered, so nothing rebuilds in the background: the
        // generation only moves on the explicit manual refresh.
        expect(factoryCalls).toBe(0);
        expect(runtime.watcherState().enabled).toBe(false);
        expect(runtime.watcherState().watchedScopes).toEqual([]);

        const rebuilt = await runtime.readIndex(dir, { refresh: true });
        expect(rebuilt.generation).toBeGreaterThan(base);
        expect(await idsFor(runtime, dir, 'manual')).toContain('const:manual@manual.ts');
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );
});
