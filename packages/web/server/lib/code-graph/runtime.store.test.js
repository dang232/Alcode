import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCodeGraphRuntime } from './runtime.js';

/**
 * Warm open: the store is only worth the bytes if a *second* process — a fresh
 * runtime with no in-memory graph — serves the graph without running the
 * compiler. These cases prove the restore path, the scope gate that refuses a
 * stale generation, and that an explicit refresh still rebuilds.
 *
 * Every case uses a real temp repository and the real engine bundle, so a
 * snapshot that cannot round-trip fails here instead of on a person's screen.
 */
const root = mkdtempSync(join(tmpdir(), 'code-graph-store-runtime-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const makeRepo = (name) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'a.ts'),
    'export function inner(): number {\n  return 1;\n}\n\nexport function outer(): number {\n  return inner();\n}\n',
  );
  return dir;
};

// The write is fire-and-forget by design, so the test waits for the artifact
// rather than sleeping a guessed amount.
const waitForManifest = async (storeDir, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const scopes = await fsPromises.readdir(storeDir).catch(() => []);
    for (const scope of scopes) {
      const manifest = join(storeDir, scope, 'manifest.json');
      const exists = await fsPromises.stat(manifest).then(() => true, () => false);
      if (exists) return manifest;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no manifest appeared under ${storeDir}`);
};

const makeRuntime = (storeDir, events) =>
  createCodeGraphRuntime(
    { fsPromises, path },
    {
      blockOnRead: true,
      storeDir,
      onProgress: (event) => events.push(event.state + (event.phase ? `:${event.phase}` : '') + (event.restoredFromStore ? ':restored' : '')),
    },
  );

const makeManyRepo = (name, fileCount) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (let index = 0; index < fileCount; index += 1) {
    const padded = String(index).padStart(2, '0');
    writeFileSync(
      join(dir, `f${padded}.ts`),
      `export function fn${padded}(): number {\n  return ${index};\n}\n`,
    );
  }
  return dir;
};

describe('uncapped index + visible surfacing', () => {
  it('uncapped walk indexes every file with zero excluded', async () => {
    const dir = makeManyRepo('uncapped-overcap', 15);
    const runtime = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true });
    // Legacy cap arguments are accepted and ignored: the walk is unbounded.
    const walk = await runtime.listEntryFiles(dir, 5);
    expect(walk.truncated).toBe(false);
    expect(walk.truncationReason).toBe(null);
    expect(walk.excludedCount).toBe(0);
    expect(walk.excludedSample).toEqual([]);
    expect(walk.entries.length).toBe(15);
    expect(walk.maxEntryFiles).toBe(null);
    const buckets = Object.values(walk.coverage.byModule);
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets.some((bucket) => (bucket.excludedFiles ?? 0) > 0)).toBe(false);
    expect(walk.coverage.totals.excludedFiles).toBe(0);
    expect(walk.coverage.totals.analyzedFiles).toBe(15);
    const indexed = await runtime.readIndex(dir, { maxEntryFiles: 5 });
    expect(indexed.ready).toBe(true);
    expect(indexed.freshness).toBe('fresh');
    expect(indexed.indexTruncated).toBe(false);
    expect(indexed.truncationReason).toBe(null);
    expect(indexed.excludedCount).toBe(0);
    expect(indexed.excludedSample).toEqual([]);
    expect(indexed.entryCap).toBe(null);
    expect(indexed.entryCount).toBe(15);
  });

  it('repeat reads agree on one complete generation with no gap', async () => {
    const dir = makeManyRepo('uncapped-repeat', 15);
    const runtime = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true });
    const first = await runtime.readIndex(dir, { maxEntryFiles: 5 });
    expect(first.excludedCount).toBe(0);
    expect(first.entryCount).toBe(15);
    const second = await runtime.readIndex(dir, { refresh: true, maxEntryFiles: 20 });
    expect(second.indexTruncated).toBe(false);
    expect(second.truncationReason).toBe(null);
    expect(second.excludedCount).toBe(0);
    expect(second.entryCount).toBe(15);
    expect(second.generation).toBeGreaterThanOrEqual(first.generation);
    expect(second.entryCount - first.entryCount).toBe(0);
    expect(second.excludedCount - first.excludedCount).toBe(0);
  });

  it('per-scope tunable is an unbounded no-op', async () => {
    const dirA = makeManyRepo('uncapped-scope-a', 3);
    const dirB = makeManyRepo('uncapped-scope-b', 3);
    const runtime = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true });
    expect(runtime.getScopeMaxEntryFiles(dirA)).toBe(null);
    expect(runtime.setScopeMaxEntryFiles(dirA, 7)).toBe(null);
    expect(runtime.getScopeMaxEntryFiles(dirA)).toBe(null);
    expect(runtime.getScopeMaxEntryFiles(dirB)).toBe(null);
    expect(runtime.setScopeMaxEntryFiles(dirA, 99999)).toBe(null);
    expect(runtime.getScopeMaxEntryFiles(dirA)).toBe(null);
    expect(runtime.resetScopeMaxEntryFiles(dirA)).toBe(null);
    expect(runtime.getScopeMaxEntryFiles(dirA)).toBe(null);
    // Both scopes index fully: the no-op tunable binds nothing.
    expect((await runtime.readIndex(dirA)).entryCount).toBe(3);
    expect((await runtime.readIndex(dirB)).entryCount).toBe(3);
  });

  it('policy-truncated build still never persists', async () => {
    const dir = makeManyRepo('uncapped-nopersist', 15);
    writeFileSync(
      join(dir, 'codegraph.json'),
      JSON.stringify({ exclude: ['f00.ts', 'f01.ts', 'f02.ts', 'f03.ts', 'f04.ts'] }),
    );
    const storeDir = join(root, 'store-uncapped-nopersist');
    const builder = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true, storeDir });
    const built = await builder.readIndex(dir, { refresh: true });
    expect(built.indexTruncated).toBe(true);
    expect(built.truncationReason).toBe('project-config');
    expect(built.excludedCount).toBe(5);
    expect(built.entryCount).toBe(10);
    const scopes = await fsPromises.readdir(storeDir).catch(() => []);
    let manifests = 0;
    for (const scope of scopes) {
      const found = await fsPromises.stat(join(storeDir, scope, 'manifest.json')).then(() => true, () => false);
      if (found) manifests += 1;
    }
    expect(manifests).toBe(0);
    const events = [];
    const reader = createCodeGraphRuntime(
      { fsPromises, path },
      {
        blockOnRead: true,
        storeDir,
        onProgress: (event) => events.push(event.state + (event.restoredFromStore ? ':restored' : '')),
      },
    );
    await reader.readIndex(dir);
    expect(events.some((event) => event.endsWith(':restored'))).toBe(false);
  });

  it('census-floor build still persists as complete', async () => {
    const dir = makeManyRepo('census-floor-persists', 3);
    // Trip the shared skipped-census bound without excluding an entry:
    // every file under a skipped directory only floors the excluded census.
    const vendored = join(dir, 'vendor');
    mkdirSync(vendored, { recursive: true });
    for (let index = 0; index < 10001; index += 1) {
      writeFileSync(join(vendored, `v${index}.txt`), 'vendored\n');
    }
    const storeDir = join(root, 'store-census-floor');
    const builder = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true, storeDir });
    const walk = await builder.listEntryFiles(dir);
    expect(walk.excludedCount).toBe(0);
    expect(walk.excludedSample).toEqual([]);
    expect(walk.coverage.excludedTruncated).toBe(true);
    expect(walk.coverage.totals.excludedFiles).toBeGreaterThanOrEqual(10000);
    // The floor no longer truncates: the walk is complete ...
    expect(walk.truncated).toBe(false);
    expect(walk.truncationReason).toBe(null);
    // ... so the build persists and a fresh runtime restores it.
    const built = await builder.readIndex(dir, { refresh: true });
    expect(built.indexTruncated).toBe(false);
    expect(built.truncationReason).toBe(null);
    expect(built.excludedCount).toBe(0);
    await waitForManifest(storeDir);
    const events = [];
    const reader = createCodeGraphRuntime(
      { fsPromises, path },
      {
        blockOnRead: true,
        storeDir,
        onProgress: (event) => events.push(event.state + (event.restoredFromStore ? ':restored' : '')),
      },
    );
    const restored = await reader.readIndex(dir);
    expect(restored.generation).toBe(built.generation);
    expect(restored.nodeCount).toBe(built.nodeCount);
    expect(restored.edgeCount).toBe(built.edgeCount);
    expect(events.some((event) => event.endsWith(':restored'))).toBe(true);
  });
});

describe('code graph warm open', () => {
  it('a fresh runtime serves the persisted generation instead of rebuilding', async () => {
    const dir = makeRepo('warm');
    const storeDir = join(root, 'store-warm');

    const builderEvents = [];
    const builder = makeRuntime(storeDir, builderEvents);
    const built = await builder.readIndex(dir, { refresh: true });
    expect(built.ready).toBe(true);
    expect(built.nodeCount).toBeGreaterThan(0);
    await waitForManifest(storeDir);

    const readerEvents = [];
    const reader = makeRuntime(storeDir, readerEvents);
    const restored = await reader.readIndex(dir, {});

    expect(restored.ready).toBe(true);
    expect(restored.nodeCount).toBe(built.nodeCount);
    expect(restored.edgeCount).toBe(built.edgeCount);
    expect(restored.revision).toBe(built.revision);
    expect(readerEvents.some((event) => event.endsWith(':restored'))).toBe(true);
    // No compiler phases in the reader: a restored graph never runs the build.
    expect(readerEvents.some((event) => event.startsWith('analyzing'))).toBe(false);
  });

  it('a source change refuses the stored generation and rebuilds', async () => {
    const dir = makeRepo('changed');
    const storeDir = join(root, 'store-changed');

    const first = makeRuntime(storeDir, []);
    await first.readIndex(dir, { refresh: true });
    await waitForManifest(storeDir);

    writeFileSync(
      join(dir, 'a.ts'),
      'export function inner(): number {\n  return 2;\n}\n\nexport function outer(): number {\n  return inner();\n}\n',
    );

    const events = [];
    const second = makeRuntime(storeDir, events);
    const read = await second.readIndex(dir, {});

    expect(read.ready).toBe(true);
    expect(events.some((event) => event.startsWith('analyzing'))).toBe(true);
    expect(events.some((event) => event.endsWith(':restored'))).toBe(false);
  });

  it('an explicit refresh rebuilds even when a stored generation matches', async () => {
    const dir = makeRepo('refresh');
    const storeDir = join(root, 'store-refresh');

    const first = makeRuntime(storeDir, []);
    await first.readIndex(dir, { refresh: true });
    await waitForManifest(storeDir);

    const events = [];
    const second = makeRuntime(storeDir, events);
    await second.readIndex(dir, { refresh: true });

    expect(events.some((event) => event.startsWith('analyzing'))).toBe(true);
  });
});

describe('code graph shared-store single writer (S10)', () => {
  it('concurrent publishers serialize on the store lease and agree on buildSeq', async () => {
    const dir = makeRepo('s10-two-writers');
    const storeDir = join(root, 'store-s10-two-writers');
    const eventsA = [];
    const eventsB = [];
    const runtimeA = createCodeGraphRuntime(
      { fsPromises, path },
      { blockOnRead: true, storeDir, onProgress: (event) => eventsA.push(event) },
    );
    const runtimeB = createCodeGraphRuntime(
      { fsPromises, path },
      { blockOnRead: true, storeDir, onProgress: (event) => eventsB.push(event) },
    );
    // Two runtimes, no shared in-process single-flight: both build and both
    // publish, so the file lease is the only thing serializing them.
    const [readA, readB] = await Promise.all([
      runtimeA.readIndex(dir, { refresh: true }),
      runtimeB.readIndex(dir, { refresh: true }),
    ]);
    expect(readA.ready).toBe(true);
    expect(readB.ready).toBe(true);
    // Neither publish failed closed on the lock: a `store-locked` note would
    // mean the guard serialized by dropping a generation instead of waiting.
    expect([...eventsA, ...eventsB].some((event) => event.storeWriteFailed)).toBe(false);

    const scopes = await fsPromises.readdir(storeDir);
    expect(scopes.length).toBe(1);
    const stored = JSON.parse(await fsPromises.readFile(join(storeDir, scopes[0], 'manifest.json'), 'utf8'));
    for (const shardName of stored.shards) {
      const present = await fsPromises.stat(join(storeDir, scopes[0], 'shards', shardName)).then(() => true, () => false);
      expect(present).toBe(true);
    }
    const lingering = await fsPromises.readdir(join(storeDir, scopes[0]));
    expect(lingering.includes('.lease')).toBe(false);

    // buildSeq stays the generation agreement: a fresh runtime restores the
    // stored number instead of minting a fresh local one.
    const reader = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true, storeDir });
    const restored = await reader.readIndex(dir, {});
    expect(restored.ready).toBe(true);
    expect(restored.generation).toBe(stored.buildSeq);
    expect(restored.nodeCount).toBe(readA.nodeCount);
    expect(restored.nodeCount).toBe(readB.nodeCount);
  });
});
