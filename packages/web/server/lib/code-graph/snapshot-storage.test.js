import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fsPromises } from 'node:fs';
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

const storeIn = (name) => createSnapshotStorage({ fsPromises, path, engine, storeDir: path.join(root, name) });

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

  it('is disabled, not broken, when no store directory is configured', async () => {
    const storage = createSnapshotStorage({ fsPromises, path, engine, storeDir: '' });

    expect(storage.enabled).toBe(false);
    expect((await storage.write('I:/demo', entry())).written).toBe(false);
    expect((await storage.read('I:/demo', scope)).status).toBe('miss');
  });
});
