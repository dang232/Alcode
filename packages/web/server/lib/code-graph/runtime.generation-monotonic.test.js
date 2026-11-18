import { execFile as realExecFile, execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCodeGraphRuntime } from './runtime.js';

// A new runtime instance over the same store is what a restart gives a caller.
// A stale manifest still names this scope's last published generation, so the
// rebuild that follows must mint the next number instead of republishing it.
const root = mkdtempSync(join(tmpdir(), 'code-graph-generation-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
const makeRepo = (files) => {
  const dir = join(root, `scope-${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  return dir;
};

const commit = (dir, message) => {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', message], { cwd: dir, stdio: 'ignore' });
};

const openRuntime = (storeDir) => createCodeGraphRuntime(
  { fsPromises, path, execFile: realExecFile },
  { blockOnRead: true, storeDir },
);

const manifestOf = async (dir) => {
  const store = join(dir, '.algraph');
  const scopes = (await fsPromises.readdir(store)).filter((name) => !name.startsWith('.'));
  expect(scopes.length).toBe(1);
  return join(store, scopes[0], 'manifest.json');
};

describe('generation identity across restarts', () => {
  it('a rebuild after an off-session change mints the next generation, never republishes one', async () => {
    const store = join(root, 'store-monotonic');
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    commit(dir, 'init');

    const first = openRuntime(store);
    const cold = await first.readIndex(dir, { block: true, refresh: true });
    first.close();
    expect(cold.generation).toBe(1);

    const second = openRuntime(store);
    const restored = await second.readIndex(dir, { block: true });
    second.close();
    expect(restored.generation).toBe(1);
    expect(restored.entryCount).toBe(cold.entryCount);

    writeFileSync(join(dir, 'b.ts'), 'export const beta = 2;\n');
    commit(dir, 'offline change');

    const third = openRuntime(store);
    const rebuilt = await third.readIndex(dir, { block: true });
    third.close();
    expect(rebuilt.generation).toBe(2);
    expect(rebuilt.entryCount).toBe(cold.entryCount + 1);

    const fourth = openRuntime(store);
    const restoredAgain = await fourth.readIndex(dir, { block: true });
    fourth.close();
    expect(restoredAgain.generation).toBe(2);
    expect(restoredAgain.entryCount).toBe(rebuilt.entryCount);
  });

  it('keeps advancing when several restarts each see a changed tree', async () => {
    const store = join(root, 'store-repeat');
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    commit(dir, 'init');

    const generations = [];
    for (let i = 0; i < 3; i += 1) {
      const runtime = openRuntime(store);
      const summary = await runtime.readIndex(dir, { block: true, refresh: i === 0 });
      runtime.close();
      generations.push(summary.generation);
      writeFileSync(join(dir, `change${i}.ts`), `export const change${i} = ${i};\n`);
      commit(dir, `change ${i}`);
    }

    expect(generations).toEqual([1, 2, 3]);
  });

  it('a missing store starts at one and does not throw', async () => {
    const store = join(root, 'store-absent');
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    commit(dir, 'init');
    const runtime = openRuntime(store);
    const summary = await runtime.readIndex(dir, { block: true });
    runtime.close();
    expect(summary.ready).toBe(true);
    expect(summary.generation).toBe(1);
  });

  it('a corrupt manifest is a safe miss and the rebuild still advances from what is readable', async () => {
    const store = join(root, 'store-corrupt');
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    commit(dir, 'init');

    const first = openRuntime(store);
    await first.readIndex(dir, { block: true, refresh: true });
    first.close();

    writeFileSync(await manifestOf(dir), '{ this is not json', 'utf8');
    writeFileSync(join(dir, 'b.ts'), 'export const beta = 2;\n');
    commit(dir, 'after corruption');

    const second = openRuntime(store);
    const summary = await second.readIndex(dir, { block: true });
    second.close();
    expect(summary.ready).toBe(true);
    expect(summary.entryCount).toBe(2);
    expect(Number.isFinite(summary.generation)).toBe(true);
  });

  it('an incompatible manifest version is a safe miss, never a served graph', async () => {
    const store = join(root, 'store-version');
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    commit(dir, 'init');

    const first = openRuntime(store);
    await first.readIndex(dir, { block: true, refresh: true });
    first.close();

    const manifestPath = await manifestOf(dir);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: 999 }), 'utf8');
    writeFileSync(join(dir, 'b.ts'), 'export const beta = 2;\n');
    commit(dir, 'after version bump');

    const second = openRuntime(store);
    const summary = await second.readIndex(dir, { block: true });
    second.close();
    expect(summary.ready).toBe(true);
    expect(summary.entryCount).toBe(2);
  });

  it('two scopes sharing one store keep independent generation sequences', async () => {
    const store = join(root, 'store-two-scopes');
    const left = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });
    const right = makeRepo({ 'b.ts': 'export const beta = 2;\n' });
    commit(left, 'init');
    commit(right, 'init');

    const runtime = openRuntime(store);
    const firstLeft = await runtime.readIndex(left, { block: true, refresh: true });
    const firstRight = await runtime.readIndex(right, { block: true, refresh: true });
    runtime.close();
    expect(firstLeft.generation).toBe(1);
    expect(firstRight.generation).toBe(2);

    writeFileSync(join(right, 'c.ts'), 'export const gamma = 3;\n');
    commit(right, 'change right');

    const second = openRuntime(store);
    const rightAfter = await second.readIndex(right, { block: true });
    const leftAfter = await second.readIndex(left, { block: true });
    second.close();
    expect(rightAfter.generation).toBe(3);
    expect(leftAfter.generation).toBe(1);
    expect(leftAfter.entryCount).toBe(firstLeft.entryCount);
  });
});
