import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as engine from './code-graph.bundle.js';
import { createSnapshotStorage } from './snapshot-storage.js';

const root = mkdtempSync(path.join(tmpdir(), 'code-graph-store-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const scope = {
  projectId: 'demo-12345678',
  worktreeId: 'demo',
  revision: 'a'.repeat(40),
  fingerprint: 'b'.repeat(64),
};

const snapshot = {
  nodes: [
    { id: 'file:src/a.ts', kind: 'file', file: 'src/a.ts', line: 1 },
    { id: 'fn:run@src/a.ts:3', kind: 'symbol', file: 'src/a.ts', line: 3, name: 'run' },
    { id: 'file:src/b.ts', kind: 'file', file: 'src/b.ts', line: 1 },
  ],
  edges: [
    { id: 'e1', from: 'file:src/b.ts', to: 'fn:run@src/a.ts:3', kind: 'IMPORTS', confidence: 1, ref: 'import { run } from "./a"' },
  ],
  content: { tokenCap: 500, files: { 'src/a.ts': { file: 'src/a.ts', language: 'ts', isTest: false, lines: ['export function run() {}'], tokens: { run: [1] }, tokenCount: 1, tokenTruncated: false } }, skipped: [] },
  root: 'I:/demo',
};

const entry = (overrides = {}) => ({
  snapshot,
  scope,
  observedAtMs: 1_700_000_000_000,
  entryCap: 5000,
  entryCount: 2,
  ...overrides,
});

const storeInDir = (name) => path.join(root, name);
const storeIn = (name) => createSnapshotStorage({ fsPromises, path, engine, storeDir: storeInDir(name) });

describe('snapshot storage', () => {
  it('publishes a generation and restores the same graph for the same scope', async () => {
    const storage = storeIn('hit');
    const written = await storage.write('I:/demo', entry());
    expect(written.written).toBe(true);

    const read = await storage.read('I:/demo', scope);

    expect(read.status).toBe('hit');
    expect(read.snapshot.nodes.length).toBe(snapshot.nodes.length);
    expect(read.snapshot.edges.length).toBe(snapshot.edges.length);
    expect(read.snapshot.content?.files['src/a.ts'].lines[0]).toBe('export function run() {}');
    expect(read.manifest.entryCount).toBe(2);
  });

  it('refuses a generation written for a different revision instead of serving it as current', async () => {
    const storage = storeIn('stale');
    await storage.write('I:/demo', entry());

    const read = await storage.read('I:/demo', { ...scope, revision: 'c'.repeat(40) });

    expect(read.status).toBe('stale');
    expect(read.snapshot).toBeUndefined();
  });

  it('reports a torn store as a miss rather than a graph missing files', async () => {
    const storage = storeIn('torn');
    await storage.write('I:/demo', entry());
    const manifestPath = path.join(root, 'torn', 'demo-12345678--demo', 'manifest.json');
    const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
    await fsPromises.rm(path.join(root, 'torn', 'demo-12345678--demo', 'shards', manifest.shards[0]));

    const read = await storage.read('I:/demo', scope);

    expect(read.status).toBe('miss');
    expect(String(read.reason)).toContain('ENOENT');
  });

  it('treats an unknown manifest version as a miss', async () => {
    const storage = storeIn('version');
    await storage.write('I:/demo', entry());
    const manifestPath = path.join(root, 'version', 'demo-12345678--demo', 'manifest.json');
    const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
    await fsPromises.writeFile(manifestPath, JSON.stringify({ ...manifest, version: 99 }), 'utf8');

    const read = await storage.read('I:/demo', scope);

    expect(read.status).toBe('miss');
    expect(String(read.reason)).toContain('version');
  });

  it('a second generation rewrites only the shards whose bytes changed', async () => {
    const storage = storeIn('reuse');
    const first = await storage.write('I:/demo', entry());
    expect(first.writtenShards).toBe(first.shards);

    const changed = {
      ...snapshot,
      nodes: [...snapshot.nodes, { id: 'fn:extra@src/b.ts:9', kind: 'symbol', file: 'src/b.ts', line: 9, name: 'extra' }],
    };
    const second = await storage.write('I:/demo', entry({ snapshot: changed }));

    expect(second.written).toBe(true);
    expect(second.writtenShards).toBe(1);
    expect(second.reusedShards).toBe(second.shards - 1);
    const read = await storage.read('I:/demo', scope);
    expect(read.status).toBe('hit');
    expect(read.snapshot.nodes.length).toBe(changed.nodes.length);
  });

  it('persists per-file records alongside the generation and returns them on hit', async () => {
    const storage = storeIn('records');
    const records = {
      version: 1,
      parser: 1,
      schema: 1,
      files: { 'src/a.ts': { file: 'src/a.ts', blob: 'a'.repeat(64) } },
    };
    const written = await storage.write('I:/demo', entry({ fileRecords: records }));
    expect(written.written).toBe(true);

    const read = await storage.read('I:/demo', scope);
    expect(read.status).toBe('hit');
    expect(read.fileRecords).toEqual(records);
  });

  it('keeps the snapshot hit when the records file is corrupt', async () => {
    const storage = storeIn('records-corrupt');
    const records = {
      version: 1,
      parser: 1,
      schema: 1,
      files: { 'src/a.ts': { file: 'src/a.ts', blob: 'a'.repeat(64) } },
    };
    await storage.write('I:/demo', entry({ fileRecords: records }));
    const names = await fsPromises.readdir(storeInDir('records-corrupt'));
    const scopeDir = names[0];
    const manifest = JSON.parse(
      await fsPromises.readFile(path.join(storeInDir('records-corrupt'), scopeDir, 'manifest.json'), 'utf8'),
    );
    await fsPromises.writeFile(
      path.join(storeInDir('records-corrupt'), scopeDir, manifest.fileRecords),
      'corrupt{{{',
      'utf8',
    );

    const read = await storage.read('I:/demo', scope);
    expect(read.status).toBe('hit');
    expect(read.fileRecords).toBe(null);
    expect(read.snapshot.nodes.length).toBe(snapshot.nodes.length);
  });

  it('is disabled, not broken, when no store directory is configured', async () => {
    const storage = createSnapshotStorage({ fsPromises, path, engine, storeDir: '' });

    expect(storage.enabled).toBe(false);
    expect((await storage.write('I:/demo', entry())).written).toBe(false);
    expect((await storage.read('I:/demo', scope)).status).toBe('miss');
  });
});

describe('snapshot storage single-writer guard (S10)', () => {
  const scopeDirFor = (name) => path.join(root, name, 'demo-12345678--demo');
  const leaseGone = (name) =>
    fsPromises.stat(path.join(scopeDirFor(name), '.lease')).then(() => false, () => true);
  const deadPidOf = () => Number(spawnSync(process.execPath, ['--version']).pid);
  const plantLease = (name, doc) =>
    fsPromises.writeFile(path.join(scopeDirFor(name), '.lease'), JSON.stringify(doc), 'utf8');

  // Same proven shape as the canned snapshot, plus tag-unique files so two
  // generations stage disjoint shards and really contend on publish + prune.
  const makeSnap = (tag, count) => {
    const nodes = [...snapshot.nodes];
    const files = { ...snapshot.content.files };
    for (let index = 0; index < count; index += 1) {
      const file = `src/${tag}-${String(index).padStart(2, '0')}.ts`;
      nodes.push({ id: `file:${file}`, kind: 'file', file, line: 1 });
      nodes.push({ id: `fn:${tag}fn${index}@${file}:3`, kind: 'symbol', file, line: 3, name: `${tag}fn${index}` });
      files[file] = {
        file,
        language: 'ts',
        isTest: false,
        lines: [`export function ${tag}fn${index}() {}`],
        tokens: { [`${tag}fn${index}`]: [1] },
        tokenCount: 1,
        tokenTruncated: false,
      };
    }
    return {
      nodes,
      edges: [...snapshot.edges],
      content: { tokenCap: 500, files, skipped: [] },
      root: snapshot.root,
    };
  };

  it('two publishers serialize: both land, the winner reads whole, no live shard pruned', async () => {
    const name = 's10-two-hosts';
    const hostA = createSnapshotStorage({ fsPromises, path, engine, storeDir: storeInDir(name) });
    const hostB = createSnapshotStorage({ fsPromises, path, engine, storeDir: storeInDir(name) });
    const snapA = makeSnap('aaa', 25);
    const snapB = makeSnap('bbb', 25);
    const [resA, resB] = await Promise.all([
      hostA.write('I:/demo', entry({ snapshot: snapA, observedAtMs: 1_700_000_000_001, buildSeq: 11 })),
      hostB.write('I:/demo', entry({ snapshot: snapB, observedAtMs: 1_700_000_000_002, buildSeq: 12 })),
    ]);
    expect(resA.written).toBe(true);
    expect(resB.written).toBe(true);

    const reader = createSnapshotStorage({ fsPromises, path, engine, storeDir: storeInDir(name) });
    const read = await reader.read('I:/demo', scope);
    expect(read.status).toBe('hit');
    // The winner is whole: every shard the published manifest names is on disk.
    for (const shardName of read.manifest.shards) {
      const present = await fsPromises.stat(path.join(scopeDirFor(name), 'shards', shardName)).then(() => true, () => false);
      expect(present).toBe(true);
    }
    // ...and the graph is one complete generation, not a mix of both publishes.
    const hasA = read.snapshot.nodes.some((node) => String(node.id).includes('aaafn'));
    const hasB = read.snapshot.nodes.some((node) => String(node.id).includes('bbbfn'));
    expect(hasA !== hasB).toBe(true);
    expect([11, 12]).toContain(read.manifest.buildSeq);
    // Both holders released: no lease lingers to block the next writer.
    expect(await leaseGone(name)).toBe(true);
  });

  it('a crash mid-publish leaves the prior generation intact and recoverable', async () => {
    const name = 's10-crash';
    const storage = createSnapshotStorage({ fsPromises, path, engine, storeDir: storeInDir(name) });
    const first = await storage.write('I:/demo', entry({ buildSeq: 21 }));
    expect(first.written).toBe(true);

    // A host killed between staging and rename: a torn temp manifest never
    // renamed into place, and the dead holder's lease left behind (fresh
    // timestamp, so recovery must come from the dead-pid probe, not expiry).
    const deadPid = deadPidOf();
    expect(() => process.kill(deadPid, 0)).toThrow();
    const dir = scopeDirFor(name);
    await fsPromises.writeFile(path.join(dir, 'manifest.json.tmp-99999'), '{"storeVersion": 1, "shar', 'utf8');
    await plantLease(name, { version: 1, pid: deadPid, token: 'dead-holder', acquiredAtMs: Date.now() });

    // The prior generation reads whole: the torn temp is ignored.
    const during = await storage.read('I:/demo', scope);
    expect(during.status).toBe('hit');
    expect(during.snapshot.nodes.length).toBe(snapshot.nodes.length);

    // The next writer steals the dead holder's lease and publishes over it.
    const snapNext = makeSnap('ccc', 5);
    const second = await storage.write('I:/demo', entry({ snapshot: snapNext, buildSeq: 22 }));
    expect(second.written).toBe(true);
    const after = await storage.read('I:/demo', scope);
    expect(after.status).toBe('hit');
    expect(after.manifest.buildSeq).toBe(22);
    expect(after.snapshot.nodes.length).toBe(snapNext.nodes.length);
    expect(await leaseGone(name)).toBe(true);
  });

  it('a stale lease from a dead holder does not block a new writer', async () => {
    const name = 's10-stale-dead';
    await fsPromises.mkdir(path.join(scopeDirFor(name), 'shards'), { recursive: true });
    const deadPid = deadPidOf();
    expect(() => process.kill(deadPid, 0)).toThrow();
    await plantLease(name, { version: 1, pid: deadPid, token: 'dead-holder', acquiredAtMs: Date.now() });
    const storage = createSnapshotStorage({ fsPromises, path, engine, storeDir: storeInDir(name) });
    const written = await storage.write('I:/demo', entry({ buildSeq: 31 }));
    expect(written.written).toBe(true);
    const read = await storage.read('I:/demo', scope);
    expect(read.status).toBe('hit');
    expect(await leaseGone(name)).toBe(true);
  });

  it('an expired lease is stolen even when its holder pid is alive', async () => {
    const name = 's10-stale-age';
    await fsPromises.mkdir(path.join(scopeDirFor(name), 'shards'), { recursive: true });
    await plantLease(name, { version: 1, pid: process.pid, token: 'stuck-holder', acquiredAtMs: Date.now() - 60_000 });
    const storage = createSnapshotStorage({
      fsPromises,
      path,
      engine,
      storeDir: storeInDir(name),
      leaseStaleMs: 1000,
      leaseTimeoutMs: 10_000,
    });
    const written = await storage.write('I:/demo', entry({ buildSeq: 41 }));
    expect(written.written).toBe(true);
    const read = await storage.read('I:/demo', scope);
    expect(read.status).toBe('hit');
    expect(await leaseGone(name)).toBe(true);
  });

  it('prune keeps the prior live generation and collects it once superseded', async () => {
    const name = 's10-prune-refs';
    const storage = createSnapshotStorage({ fsPromises, path, engine, storeDir: storeInDir(name) });
    const shardSetAfter = async () =>
      new Set(JSON.parse(await fsPromises.readFile(path.join(scopeDirFor(name), 'manifest.json'), 'utf8')).shards);
    const present = (shardName) =>
      fsPromises.stat(path.join(scopeDirFor(name), 'shards', shardName)).then(() => true, () => false);
    await storage.write('I:/demo', entry({ snapshot: makeSnap('ddd', 3), buildSeq: 51 }));
    const shardsA = await shardSetAfter();
    await storage.write('I:/demo', entry({ snapshot: makeSnap('eee', 3), buildSeq: 52 }));
    const shardsB = await shardSetAfter();
    // Prior live generation retained beside the new one: a restorer holding
    // the previous manifest still finds every shard it names.
    for (const shardName of shardsA) {
      expect(await present(shardName)).toBe(true);
    }
    await storage.write('I:/demo', entry({ snapshot: makeSnap('fff', 3), buildSeq: 53 }));
    const shardsC = await shardSetAfter();
    // Once superseded twice over, shards only the oldest generation named
    // are collected; everything either live generation names stays.
    const liveAfterC = new Set([...shardsC, ...shardsB]);
    const deadA = [...shardsA].filter((shardName) => !liveAfterC.has(shardName));
    expect(deadA.length).toBeGreaterThan(0);
    for (const shardName of deadA) {
      expect(await present(shardName)).toBe(false);
    }
    for (const shardName of liveAfterC) {
      expect(await present(shardName)).toBe(true);
    }
    const read = await storage.read('I:/demo', scope);
    expect(read.status).toBe('hit');
    expect(read.manifest.buildSeq).toBe(53);
  });
});
