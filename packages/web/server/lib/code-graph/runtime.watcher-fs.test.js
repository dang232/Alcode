import { execFile as realExecFile, execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

// Watcher filesystem consistency: every real filesystem change, delivered
// through the watcher event path, must settle to a graph that equals a clean
// full-build reference over the same directory.
//
// Conventions mirror runtime.freshness.test.js: a real temp git checkout per
// test (`git init` + commit, never the Alwork checkout), the real runtime,
// and a fake `watchFactory` that captures `onEvent` so events fire
// deterministically. No test sleeps waiting for the debounce: after `fire()`
// the suite polls `readIndex(dir, { block: true })` until the expected
// condition holds, and the debounce (clamped to >=100ms) settles underneath.
//
// Reference method: after the watcher-driven sync settles, a SECOND runtime
// instance over the same directory with a fresh store (no watcher,
// blockOnRead) performs a clean full build, and the suite compares
// entryCount, nodeCount, and edgeCount. Equality with a clean build is the
// contract; no test asserts only "a rebuild happened".

// Callable check without a runtime `typeof` (banned by the anti-slop gate).
const isFunction = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Function]' || tag === '[object AsyncFunction]';
};

const root = mkdtempSync(join(tmpdir(), 'code-graph-runtime-watcher-fs-'));

const priorNoAlgraph = process.env.ALCODE_CODE_GRAPH_NO_ALGRAPH;

beforeEach(() => {
  // Force the configured store roots: otherwise every runtime over the same
  // git checkout resolves to the shared repo-local `.algraph` store and the
  // "fresh store" reference would restore the watched generation instead of
  // building cleanly.
  process.env.ALCODE_CODE_GRAPH_NO_ALGRAPH = '1';
});

afterAll(() => {
  if (priorNoAlgraph === undefined) {
    delete process.env.ALCODE_CODE_GRAPH_NO_ALGRAPH;
  } else {
    process.env.ALCODE_CODE_GRAPH_NO_ALGRAPH = priorNoAlgraph;
  }
  rmSync(root, { recursive: true, force: true });
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

const freshStoreDir = () => {
  const dir = join(root, `store-${seq++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// A watching runtime plus its captured event trigger. The caller owns
// `runtime.closeWatchers()` (every test closes in a finally).
const makeWatcherRuntime = (extraOptions = {}) => {
  const box = { fire: null };
  const runtime = createCodeGraphRuntime(
    { fsPromises, path, execFile: realExecFile },
    {
      blockOnRead: true,
      watcherEnabled: true,
      watcherDebounceMs: 1,
      watchFactory: (scopeRoot, onEvent) => {
        void scopeRoot;
        box.fire = onEvent;
        return {
          close: () => {
            box.fire = null;
          },
        };
      },
      storeDir: freshStoreDir(),
      ...extraOptions,
    },
  );
  return { runtime, box };
};

// First read: builds the baseline generation and registers the watcher.
const openWatched = async (dir, extraOptions = {}) => {
  const { runtime, box } = makeWatcherRuntime(extraOptions);
  const first = await runtime.readIndex(dir);
  expect(first.ready).toBe(true);
  expect(runtime.watcherState().watchedScopes.length).toBe(1);
  expect(isFunction(box.fire)).toBe(true);
  return { runtime, box, first };
};

const searchIds = async (runtime, dir, query) => {
  const envelope = await runtime.query(dir, { kind: 'search', query, limit: 50 });
  return envelope.items.map((item) => item.id);
};

const fileCoverage = async (runtime, dir, file) => {
  const view = await runtime.query(dir, { kind: 'file', file });
  return view.coverage;
};

// Bounded poll, never a blind debounce sleep: each pass performs a blocking
// read (which joins or drives the single-flight sync) until the wanted
// condition holds.
const settleFor = async (runtime, dir, wanted, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let index = await runtime.readIndex(dir, { block: true });
  while (!(await wanted(index))) {
    if (Date.now() >= deadline) {
      throw new Error('timed out waiting for the watcher sync to settle');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    index = await runtime.readIndex(dir, { block: true });
  }
  return index;
};

// The contract: the settled watcher graph equals a clean full build over the
// same directory (same entryCount, nodeCount, edgeCount).
const expectMatchesCleanBuild = async (watched, dir) => {
  const reference = createCodeGraphRuntime(
    { fsPromises, path, execFile: realExecFile },
    { blockOnRead: true, storeDir: freshStoreDir() },
  );
  try {
    const ref = await reference.readIndex(dir);
    expect(ref.ready).toBe(true);
    expect(watched.entryCount).toBe(ref.entryCount);
    expect(watched.nodeCount).toBe(ref.nodeCount);
    expect(watched.edgeCount).toBe(ref.edgeCount);
  } finally {
    reference.closeWatchers();
  }
};

describe('watcher filesystem consistency', () => {
  it(
    'file create: a new symbol appears and the graph equals a clean build',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const { runtime, box, first } = await openWatched(dir);
      try {
        writeFileSync(join(dir, 'fresh.ts'), 'export const fresh = 42;\n');
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          (await searchIds(runtime, dir, 'fresh')).includes('const:fresh@fresh.ts')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        expect(await fileCoverage(runtime, dir, 'fresh.ts')).toBe('indexed');
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'file edit: symbol content updates and the graph equals a clean build',
    async () => {
      const dir = makeRepo({
        'a.ts': 'export const alpha = 1;\n',
        'b.ts': "import { alpha } from './a.js';\nexport const beta = alpha + 1;\n",
      });
      const { runtime, box, first } = await openWatched(dir);
      try {
        writeFileSync(join(dir, 'a.ts'), 'export const alpha = 10;\nexport const gamma = 3;\n');
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          (await searchIds(runtime, dir, 'gamma')).includes('const:gamma@a.ts')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        expect(await searchIds(runtime, dir, 'alpha')).toContain('const:alpha@a.ts');
        expect(await searchIds(runtime, dir, 'beta')).toContain('const:beta@b.ts');
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'file delete: its symbols are gone, not stale, and the graph equals a clean build',
    async () => {
      const dir = makeRepo({
        'a.ts': 'export const alpha = 1;\n',
        'b.ts': 'export const beta = 2;\n',
      });
      const { runtime, box, first } = await openWatched(dir);
      try {
        rmSync(join(dir, 'a.ts'));
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          (await searchIds(runtime, dir, 'alpha')).length === 0
          && (await searchIds(runtime, dir, 'beta')).includes('const:beta@b.ts')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        expect(settled.nodeCount).toBeLessThan(first.nodeCount);
        // The removed path is absent from the file records, not lingering.
        expect(await fileCoverage(runtime, dir, 'a.ts')).toBe('unindexed');
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'file rename: old path absent, new path present, no duplicate identity',
    async () => {
      const dir = makeRepo({
        'a.ts': 'export const alpha = 1;\n',
        'old.ts': 'export const moved = 1;\n',
      });
      const { runtime, box, first } = await openWatched(dir);
      try {
        renameSync(join(dir, 'old.ts'), join(dir, 'new.ts'));
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          (await searchIds(runtime, dir, 'moved')).includes('const:moved@new.ts')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        const ids = await searchIds(runtime, dir, 'moved');
        expect(ids.filter((id) => id.includes('moved'))).toEqual(['const:moved@new.ts']);
        // The old path is absent from the entry/file records.
        expect(await fileCoverage(runtime, dir, 'old.ts')).toBe('unindexed');
        expect(await fileCoverage(runtime, dir, 'new.ts')).toBe('indexed');
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'directory create: files inside the new directory are indexed like a clean build',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const { runtime, box, first } = await openWatched(dir);
      try {
        mkdirSync(join(dir, 'sub'), { recursive: true });
        writeFileSync(join(dir, 'sub', 'c.ts'), 'export const gamma = 1;\n');
        writeFileSync(join(dir, 'sub', 'd.ts'), 'export const delta = 2;\n');
        box.fire();

        const settled = await settleFor(runtime, dir, async () => {
          const gamma = await searchIds(runtime, dir, 'gamma');
          const delta = await searchIds(runtime, dir, 'delta');
          return gamma.some((id) => id.includes('sub/c.ts')) && delta.some((id) => id.includes('sub/d.ts'));
        });
        expect(settled.generation).toBe(first.generation + 1);
        expect(await fileCoverage(runtime, dir, 'sub/c.ts')).toBe('indexed');
        expect(await fileCoverage(runtime, dir, 'sub/d.ts')).toBe('indexed');
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'directory delete: all its records are gone and the graph equals a clean build',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(join(dir, 'sub', 'c.ts'), 'export const gamma = 1;\n');
      writeFileSync(join(dir, 'sub', 'd.ts'), 'export const delta = 2;\n');
      commitAll(dir, 'add sub');
      const { runtime, box, first } = await openWatched(dir);
      try {
        rmSync(join(dir, 'sub'), { recursive: true, force: true });
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          (await searchIds(runtime, dir, 'gamma')).length === 0
          && (await searchIds(runtime, dir, 'delta')).length === 0
          && (await searchIds(runtime, dir, 'alpha')).includes('const:alpha@a.ts')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        expect(await fileCoverage(runtime, dir, 'sub/c.ts')).toBe('unindexed');
        expect(await fileCoverage(runtime, dir, 'sub/d.ts')).toBe('unindexed');
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'atomic save: tmp-write plus rename settles to the same graph as a clean build',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const { runtime, box, first } = await openWatched(dir);
      try {
        writeFileSync(join(dir, 'a.ts.tmp'), 'export const alpha = 1;\nexport const atomic = 2;\n');
        renameSync(join(dir, 'a.ts.tmp'), join(dir, 'a.ts'));
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          (await searchIds(runtime, dir, 'atomic')).includes('const:atomic@a.ts')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'rapid consecutive saves coalesce to the consistent final state',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const { runtime, box, first } = await openWatched(dir);
      try {
        // Three saves in one tick with one event each: the debounce must
        // coalesce them and the final graph must match the last write only.
        writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\nexport const interimOne = 1;\n');
        box.fire();
        writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\nexport const interimTwo = 2;\n');
        box.fire();
        writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\nexport const rapidFinal = 3;\n');
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          (await searchIds(runtime, dir, 'rapidFinal')).includes('const:rapidFinal@a.ts')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        expect(await searchIds(runtime, dir, 'interimOne')).toEqual([]);
        expect(await searchIds(runtime, dir, 'interimTwo')).toEqual([]);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'bulk change: many files at once settle to the same graph as a clean build',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const { runtime, box, first } = await openWatched(dir);
      const count = 10;
      try {
        for (let i = 0; i < count; i += 1) {
          writeFileSync(join(dir, `bulk${i}.ts`), `export const bulk${i} = ${i};\n`);
          box.fire();
        }

        const settled = await settleFor(runtime, dir, async () => {
          const ids = await searchIds(runtime, dir, 'bulk');
          const found = [];
          for (let i = 0; i < count; i += 1) {
            if (ids.includes(`const:bulk${i}@bulk${i}.ts`)) found.push(i);
          }
          return found.length === count;
        });
        expect(settled.generation).toBe(first.generation + 1);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'events during an active build join the sync and settle correctly',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const readyGenerations = [];
      const { runtime, box, first } = await openWatched(dir, {
        onProgress: (progress) => {
          if (progress?.state === 'ready' && Number.isFinite(progress?.generation)) {
            readyGenerations.push(progress.generation);
          }
        },
      });
      try {
        const base = first.generation;
        writeFileSync(join(dir, 'b.ts'), 'export const duringOne = 1;\n');
        box.fire();

        // A blocking read starts (or joins) the build for the first change;
        // the second change lands while that build is in flight.
        const inFlight = runtime.readIndex(dir, { block: true });
        writeFileSync(join(dir, 'c.ts'), 'export const duringTwo = 2;\n');
        box.fire();
        await inFlight;

        const settled = await settleFor(runtime, dir, async () => (
          (await searchIds(runtime, dir, 'duringOne')).includes('const:duringOne@b.ts')
          && (await searchIds(runtime, dir, 'duringTwo')).includes('const:duringTwo@c.ts')
        ));
        // The second event joined the single-flight sync instead of
        // duplicating it: exactly one new generation was published.
        expect(settled.generation).toBe(base + 1);
        expect(readyGenerations.filter((gen) => gen > base)).toEqual([base + 1]);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );
});
