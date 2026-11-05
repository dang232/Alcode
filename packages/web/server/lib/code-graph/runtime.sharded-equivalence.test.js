import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCodeGraphRuntime } from './runtime.js';
import * as engine from './code-graph.bundle.js';

/**
 * Sharded-build experiment (flag-gated): per-project shards built in
 * separate worker sessions must merge to the whole-scope graph by id.
 * The served path never calls this; only explicit `{ shards }` (or the
 * `ALCODE_CODE_GRAPH_SHARDED_BUILD` env count) opts in.
 */
const root = mkdtempSync(join(tmpdir(), 'code-graph-sharded-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const makeRepo = (name) => {
  const dir = join(root, name);
  const pkgA = join(dir, 'pkg-a');
  const pkgB = join(dir, 'pkg-b');
  mkdirSync(pkgA, { recursive: true });
  mkdirSync(pkgB, { recursive: true });
  writeFileSync(join(pkgA, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['a.ts'] }));
  writeFileSync(join(pkgB, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['b.ts'] }));
  writeFileSync(join(pkgA, 'a.ts'), 'export function inner(): number {\n  return 1;\n}\n');
  writeFileSync(
    join(pkgB, 'b.ts'),
    "import { inner } from '../pkg-a/a.js';\nexport function outer(): number {\n  return inner() + 1;\n}\n",
  );
  return { dir, aFile: join(pkgA, 'a.ts'), bFile: join(pkgB, 'b.ts') };
};

const ids = (items) => new Set((items ?? []).map((item) => item.id));
const sortedIds = (items) => [...ids(items)].sort();

describe('sharded build experiment', () => {
  it('two shards merge to the whole-scope graph', async () => {
    const { dir, aFile, bFile } = makeRepo('two-shards');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const whole = engine.indexFiles([aFile, bFile], { rootDir: dir });
    const built = await runtime.buildShardedSnapshot([aFile, bFile], { rootDir: dir, shards: 2 });
    expect(sortedIds(built.snapshot.nodes)).toEqual(sortedIds(whole.nodes));
    expect(sortedIds(built.snapshot.edges)).toEqual(sortedIds(whole.edges));
    expect(built.snapshot.nodes.length).toBe(whole.nodes.length);
    expect(built.snapshot.edges.length).toBe(whole.edges.length);
    expect(built.snapshot.dropped.map((drop) => drop.file).sort()).toEqual(
      (whole.dropped ?? []).map((drop) => drop.file).sort(),
    );
    expect(Object.keys(built.snapshot.content.files).sort()).toEqual(Object.keys(whole.content.files).sort());
    expect(built.groups.reduce((sum, group) => sum + group.entries, 0)).toBe(2);
    expect(built.shards.length).toBeGreaterThanOrEqual(1);
    expect(built.shards.reduce((sum, shard) => sum + shard.entries, 0)).toBe(2);
  }, 120000);

  it('one shard matches the whole-scope graph (control arm)', async () => {
    const { dir, aFile, bFile } = makeRepo('one-shard');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const whole = engine.indexFiles([aFile, bFile], { rootDir: dir });
    const built = await runtime.buildShardedSnapshot([aFile, bFile], { rootDir: dir, shards: 1 });
    expect(sortedIds(built.snapshot.nodes)).toEqual(sortedIds(whole.nodes));
    expect(sortedIds(built.snapshot.edges)).toEqual(sortedIds(whole.edges));
  }, 120000);

  it('the env count opts in when shards is omitted', async () => {
    const { dir, aFile, bFile } = makeRepo('env-shards');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const previous = process.env.ALCODE_CODE_GRAPH_SHARDED_BUILD;
    process.env.ALCODE_CODE_GRAPH_SHARDED_BUILD = '2';
    try {
      const whole = engine.indexFiles([aFile, bFile], { rootDir: dir });
      const built = await runtime.buildShardedSnapshot([aFile, bFile], { rootDir: dir });
      expect(sortedIds(built.snapshot.nodes)).toEqual(sortedIds(whole.nodes));
    } finally {
      if (previous === undefined) delete process.env.ALCODE_CODE_GRAPH_SHARDED_BUILD;
      else process.env.ALCODE_CODE_GRAPH_SHARDED_BUILD = previous;
    }
  }, 120000);

  it('clamps shards to the machine cap and reports the binding', async () => {
    delete process.env.ALCODE_CODE_GRAPH_SHARD_MEM_FLOOR_MB;
    const { dir, aFile, bFile } = makeRepo('machine-cap');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const previous = process.env.ALCODE_CODE_GRAPH_SHARD_MEM_FLOOR_MB;
    process.env.ALCODE_CODE_GRAPH_SHARD_MEM_FLOOR_MB = '1048576';
    try {
      const whole = engine.indexFiles([aFile, bFile], { rootDir: dir });
      const built = await runtime.buildShardedSnapshot([aFile, bFile], { rootDir: dir, shards: 8 });
      // A 1TB floor clamps to the 64GB ceiling, so free memory holds no
      // whole shard: the cap binds at 1 and says so.
      expect(built.machine.memFloorMb).toBe(65536);
      expect(built.effectiveShards).toBe(1);
      expect(built.limitedBy).toBe('machine');
      expect(built.shards.length).toBe(1);
      expect(sortedIds(built.snapshot.nodes)).toEqual(sortedIds(whole.nodes));
      expect(sortedIds(built.snapshot.edges)).toEqual(sortedIds(whole.edges));
    } finally {
      if (previous === undefined) delete process.env.ALCODE_CODE_GRAPH_SHARD_MEM_FLOOR_MB;
      else process.env.ALCODE_CODE_GRAPH_SHARD_MEM_FLOOR_MB = previous;
    }
  }, 120000);

  it('reports per-shard memory', async () => {
    const { dir, aFile, bFile } = makeRepo('shard-rss');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const built = await runtime.buildShardedSnapshot([aFile, bFile], { rootDir: dir, shards: 2 });
    expect(built.maxShardRssMB).toBeGreaterThan(0);
    expect(built.shards.length).toBeGreaterThanOrEqual(1);
    for (const shard of built.shards) expect(shard.rssMB).toBeGreaterThan(0);
  }, 120000);

  it('refuses to guess when no shard count is given', async () => {
    delete process.env.ALCODE_CODE_GRAPH_SHARDED_BUILD;
    delete process.env.ALCODE_CODE_GRAPH_SHARD_MEM_FLOOR_MB;
    const { dir, aFile } = makeRepo('no-shards');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    await expect(runtime.buildShardedSnapshot([aFile], { rootDir: dir })).rejects.toThrow(/shards >= 1/);
    await expect(runtime.buildShardedSnapshot([aFile], { rootDir: dir, shards: 0 })).rejects.toThrow(/shards >= 1/);
    await expect(runtime.buildShardedSnapshot([], { rootDir: dir, shards: 2 })).rejects.toThrow(/non-empty/);
    await expect(runtime.buildShardedSnapshot([aFile], { rootDir: '', shards: 2 })).rejects.toThrow(/rootDir/);
  });

  it('emits shard-started and shard-done progress per shard', async () => {
    const { dir, aFile, bFile } = makeRepo('shard-progress');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const events = [];
    const built = await runtime.buildShardedSnapshot([aFile, bFile], {
      rootDir: dir, shards: 2, onProgress: (event) => events.push(event),
    });
    expect(built.shards.length).toBeGreaterThanOrEqual(1);
    const started = events.filter((event) => event.phase === 'shard-started');
    const done = events.filter((event) => event.phase === 'shard-done');
    expect(started.length).toBe(built.shards.length);
    expect(done.length).toBe(built.shards.length);
    for (const event of [...started, ...done]) {
      expect(event.shards).toBe(built.shards.length);
      expect(event.entries).toBeGreaterThan(0);
    }
    for (const event of done) {
      expect(event.wallMs).toBeGreaterThanOrEqual(0);
      expect(event.nodes).toBeGreaterThan(0);
    }
  }, 120000);

  it('rejects cancelled before spawning when already aborted', async () => {
    const { dir, aFile } = makeRepo('pre-aborted');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const controller = new AbortController();
    controller.abort();
    const failure = await runtime.buildShardedSnapshot([aFile], { rootDir: dir, shards: 2, signal: controller.signal }).catch((error) => error);
    expect(failure.code).toBe('CANCELLED');
  });

  it('rejects cancelled when shouldCancel is set', async () => {
    const { dir, aFile } = makeRepo('should-cancel');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const failure = await runtime.buildShardedSnapshot([aFile], { rootDir: dir, shards: 2, shouldCancel: () => true }).catch((error) => error);
    expect(failure.code).toBe('CANCELLED');
  });

  it('kills in-flight shards on abort and the next build still works', async () => {
    const { dir, aFile, bFile } = makeRepo('mid-flight-abort');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    const controller = new AbortController();
    const failure = await runtime.buildShardedSnapshot([aFile, bFile], {
      rootDir: dir,
      shards: 2,
      signal: controller.signal,
      onProgress: (event) => {
        // Spawn is guaranteed here; no result can be in yet, so the abort
        // always lands mid-flight and kills the running children.
        if (event.phase === 'shard-started') controller.abort();
      },
    }).catch((error) => error);
    expect(failure.code).toBe('CANCELLED');
    // Recovery is a clean rerun: no poisoned state, no partial merge kept.
    const rebuilt = await runtime.buildShardedSnapshot([aFile, bFile], { rootDir: dir, shards: 2 });
    expect(rebuilt.snapshot.nodes.length).toBeGreaterThan(0);
  }, 120000);

  it('fails closed when a shard budget blows, merging nothing', async () => {
    const { dir, aFile, bFile } = makeRepo('shard-budget');
    const runtime = createCodeGraphRuntime({ fsPromises: await import('node:fs/promises'), path: await import('node:path') }, { blockOnRead: true });
    await expect(runtime.buildShardedSnapshot([aFile, bFile], { rootDir: dir, shards: 2, budgets: { maxFiles: 0 } })).rejects.toThrow(/entry budget exceeded/);
  }, 120000);
});
