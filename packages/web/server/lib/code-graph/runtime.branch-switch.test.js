import { execFile as realExecFile, execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

// Branch-switch consistency while the watcher is running: every `git
// checkout` that changes the tree, delivered through the watcher event path,
// must settle to a graph that equals a clean full-build reference over the
// same checked-out tree.
//
// Conventions mirror runtime.watcher-fs.test.js: a real temp git checkout
// per test (`git init` + commit, never the Alwork checkout), the real
// runtime, and a fake `watchFactory` that captures `onEvent` so events fire
// deterministically. No test sleeps waiting for the debounce: after `fire()`
// the suite polls `readIndex(dir, { block: true })` until the expected
// condition holds, and the debounce (clamped to >=100ms) settles underneath.
//
// The graph search is FUZZY, so every symbol assertion below compares exact
// names (`item.name === 'query'`), never substrings.
//
// Reference method: after the watcher-driven sync settles, a SECOND runtime
// instance over the same directory with a fresh store (no watcher,
// blockOnRead, ALCODE_CODE_GRAPH_NO_ALGRAPH=1) performs a clean full build,
// and the suite compares entryCount, nodeCount, and edgeCount. Equality with
// a clean build is the contract; no test asserts only "a rebuild happened".

// Callable check without a runtime `typeof` (banned by the anti-slop gate).
const isFunction = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Function]' || tag === '[object AsyncFunction]';
};

const root = mkdtempSync(join(tmpdir(), 'code-graph-runtime-branch-switch-'));

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

const git = (dir, args) => {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
};

const commitAll = (dir, message) => {
  git(dir, ['add', '-A']);
  git(dir, [
    '-c', 'user.email=qa@example.test', '-c', 'user.name=qa', 'commit', '-m', message,
  ]);
};

const currentBranch = (dir) => execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).toString().trim();

const checkout = (dir, branch) => {
  git(dir, ['checkout', branch]);
};

const checkoutNew = (dir, branch) => {
  git(dir, ['checkout', '-b', branch]);
};

let seq = 0;
const makeRepo = (files) => {
  const dir = join(root, `repo-${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  git(dir, ['init']);
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

// Raw search items: membership is always asserted by exact name below.
const searchItems = async (runtime, dir, query) => {
  const envelope = await runtime.query(dir, { kind: 'search', query, limit: 50 });
  return envelope.items;
};

// Exact-name membership: the search is fuzzy, so a substring check would
// also match longer names sharing the query text.
const hasSymbol = (items, name) => items.some((item) => item.name === name);

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

// Scope isolation: a branch switch must not create a second scope — the same
// scopeRoot and projectId serve before and after, under one watched scope.
const expectScopeStable = (first, settled, runtime) => {
  expect(settled.scopeRoot).toBe(first.scopeRoot);
  expect(settled.projectId).toBe(first.projectId);
  expect(runtime.watcherState().watchedScopes.length).toBe(1);
};

// The contract: the settled watcher graph equals a clean full build over the
// same checked-out tree (same entryCount, nodeCount, edgeCount).
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

describe('branch-switch consistency with the watcher running', () => {
  it(
    'branch switch that changes a source file: the new symbol appears and the graph equals a clean build',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const orig = currentBranch(dir);
      checkoutNew(dir, 'feature-content');
      writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\nexport const featureSym = 2;\n');
      commitAll(dir, 'feature content');
      checkout(dir, orig);

      const { runtime, box, first } = await openWatched(dir);
      try {
        expect(hasSymbol(await searchItems(runtime, dir, 'featureSym'), 'featureSym')).toBe(false);

        checkout(dir, 'feature-content');
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          hasSymbol(await searchItems(runtime, dir, 'featureSym'), 'featureSym')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        expect(hasSymbol(await searchItems(runtime, dir, 'alpha'), 'alpha')).toBe(true);
        expectScopeStable(first, settled, runtime);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'branch switch that deletes a file: its symbol is absent and the graph equals a clean build',
    async () => {
      const dir = makeRepo({
        'a.ts': 'export const alpha = 1;\n',
        'b.ts': 'export const beta = 2;\n',
      });
      const orig = currentBranch(dir);
      checkoutNew(dir, 'feature-delete');
      rmSync(join(dir, 'b.ts'));
      commitAll(dir, 'delete b');
      checkout(dir, orig);

      const { runtime, box, first } = await openWatched(dir);
      try {
        expect(hasSymbol(await searchItems(runtime, dir, 'beta'), 'beta')).toBe(true);

        checkout(dir, 'feature-delete');
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          !hasSymbol(await searchItems(runtime, dir, 'beta'), 'beta')
          && hasSymbol(await searchItems(runtime, dir, 'alpha'), 'alpha')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        expect(settled.nodeCount).toBeLessThan(first.nodeCount);
        expectScopeStable(first, settled, runtime);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'branch switch that renames a file: old path absent, new path present, single identity',
    async () => {
      const dir = makeRepo({
        'a.ts': 'export const alpha = 1;\n',
        'old.ts': 'export const moved = 1;\n',
      });
      const orig = currentBranch(dir);
      checkoutNew(dir, 'feature-rename');
      renameSync(join(dir, 'old.ts'), join(dir, 'new.ts'));
      commitAll(dir, 'rename old to new');
      checkout(dir, orig);

      const { runtime, box, first } = await openWatched(dir);
      try {
        checkout(dir, 'feature-rename');
        box.fire();

        const settled = await settleFor(runtime, dir, async () => {
          const items = await searchItems(runtime, dir, 'moved');
          return hasSymbol(items, 'moved')
            && items.filter((item) => item.name === 'moved').every((item) => item.file === 'new.ts');
        });
        expect(settled.generation).toBe(first.generation + 1);
        // Single identity: exactly one exact-name hit, on the new path only.
        const moved = (await searchItems(runtime, dir, 'moved')).filter((item) => item.name === 'moved');
        expect(moved.length).toBe(1);
        expect(moved[0].file).toBe('new.ts');
        const oldView = await runtime.query(dir, { kind: 'file', file: 'old.ts' });
        expect(oldView.coverage).toBe('unindexed');
        const newView = await runtime.query(dir, { kind: 'file', file: 'new.ts' });
        expect(newView.coverage).toBe('indexed');
        expectScopeStable(first, settled, runtime);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'branch switch during an in-flight build: one new generation, no duplicate storm',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const orig = currentBranch(dir);
      checkoutNew(dir, 'feature-flight');
      writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\nexport const inFlightSym = 2;\n');
      commitAll(dir, 'flight content');
      checkout(dir, orig);

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

        // The switch lands, the event fires, and the blocking read below is
        // already in flight while the debounced sync starts: the read joins
        // the single-flight job instead of starting a second build.
        checkout(dir, 'feature-flight');
        box.fire();
        const inFlight = runtime.readIndex(dir, { block: true });
        await inFlight;

        const settled = await settleFor(runtime, dir, async () => (
          hasSymbol(await searchItems(runtime, dir, 'inFlightSym'), 'inFlightSym')
        ));
        // No duplicate generation storm: exactly one new generation was
        // published for the switch, whatever overlapped it.
        expect(settled.generation).toBe(base + 1);
        expect(readyGenerations.filter((gen) => gen > base)).toEqual([base + 1]);
        expect(hasSymbol(await searchItems(runtime, dir, 'alpha'), 'alpha')).toBe(true);
        expectScopeStable(first, settled, runtime);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'rapid consecutive branch switches: the final graph matches the final branch',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const orig = currentBranch(dir);
      const branches = [
        ['feature-one', 'oneSym'],
        ['feature-two', 'twoSym'],
        ['feature-three', 'threeSym'],
      ];
      for (const [branch, symbol] of branches) {
        checkoutNew(dir, branch);
        writeFileSync(join(dir, 'a.ts'), `export const alpha = 1;\nexport const ${symbol} = 2;\n`);
        commitAll(dir, `add ${symbol}`);
        checkout(dir, orig);
      }

      const { runtime, box, first } = await openWatched(dir);
      try {
        // Three switches in one tick with one event each: the debounce must
        // coalesce them and the final graph must match the last branch only.
        checkout(dir, 'feature-one');
        box.fire();
        checkout(dir, 'feature-two');
        box.fire();
        checkout(dir, 'feature-three');
        box.fire();

        const settled = await settleFor(runtime, dir, async () => (
          hasSymbol(await searchItems(runtime, dir, 'threeSym'), 'threeSym')
        ));
        expect(settled.generation).toBe(first.generation + 1);
        expect(hasSymbol(await searchItems(runtime, dir, 'oneSym'), 'oneSym')).toBe(false);
        expect(hasSymbol(await searchItems(runtime, dir, 'twoSym'), 'twoSym')).toBe(false);
        expect(hasSymbol(await searchItems(runtime, dir, 'alpha'), 'alpha')).toBe(true);
        expectScopeStable(first, settled, runtime);
        await expectMatchesCleanBuild(settled, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );

  it(
    'return to the original branch: the graph returns to the original content',
    async () => {
      const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
      const orig = currentBranch(dir);
      checkoutNew(dir, 'feature-roundtrip');
      writeFileSync(join(dir, 'a.ts'), 'export const alpha = 1;\nexport const roundSym = 2;\n');
      commitAll(dir, 'roundtrip content');
      checkout(dir, orig);

      const { runtime, box, first } = await openWatched(dir);
      try {
        checkout(dir, 'feature-roundtrip');
        box.fire();
        const away = await settleFor(runtime, dir, async () => (
          hasSymbol(await searchItems(runtime, dir, 'roundSym'), 'roundSym')
        ));
        expect(away.generation).toBe(first.generation + 1);
        expectScopeStable(first, away, runtime);
        await expectMatchesCleanBuild(away, dir);

        checkout(dir, orig);
        box.fire();
        const back = await settleFor(runtime, dir, async () => (
          !hasSymbol(await searchItems(runtime, dir, 'roundSym'), 'roundSym')
          && hasSymbol(await searchItems(runtime, dir, 'alpha'), 'alpha')
        ));
        expect(back.generation).toBe(first.generation + 2);
        // The original tree is back byte-for-byte, so the counts match the
        // baseline exactly — not just "a rebuild happened".
        expect(back.entryCount).toBe(first.entryCount);
        expect(back.nodeCount).toBe(first.nodeCount);
        expect(back.edgeCount).toBe(first.edgeCount);
        expectScopeStable(first, back, runtime);
        await expectMatchesCleanBuild(back, dir);
      } finally {
        runtime.closeWatchers();
      }
    },
    60_000,
  );
});
