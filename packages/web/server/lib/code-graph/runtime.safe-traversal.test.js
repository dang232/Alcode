import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCodeGraphRuntime } from './runtime.js';

const root = mkdtempSync(join(tmpdir(), 'code-graph-safe-walk-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const runtime = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true, maxEntryFiles: 50 });

const write = (rel, content = 'export const v = 1;\n') => {
  const full = join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
};

describe('safe bounded traversal', () => {
  it('excludes generated .tsbuild declaration caches but keeps real sources', async () => {
    write('cache-scope/src/a.ts', 'export function alpha(): number { return 1; }\n');
    write('cache-scope/src/types.d.ts', 'export declare function alpha(): number;\n');
    write('cache-scope/.tsbuild/ui/src/a.d.ts', 'export declare function alpha(): number;\n');
    const walk = await runtime.listEntryFiles(join(root, 'cache-scope'), 50);
    const rels = walk.entries.map((e) => path.relative(join(root, 'cache-scope'), e).split(path.sep).join('/')).sort();
    expect(rels).toEqual(['src/a.ts', 'src/types.d.ts']);
  });

  it('indexes a normal tree without truncation', async () => {
    write('normal/a.ts');
    write('normal/b.ts');
    const walk = await runtime.listEntryFiles(join(root, 'normal'), 50);
    expect(walk.truncated).toBe(false);
    expect(walk.entries.length).toBe(2);
    expect(walk.dirsVisited).toBeGreaterThan(0);
  });

  it('does not follow a symlink to its parent', async () => {
    const dir = join(root, 'loop');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'file.ts'), 'export const z = 1;\n');
    try {
      await fsPromises.symlink(dir, join(dir, 'sub', 'back'), 'junction');
    } catch {
      return;
    }
    const walk = await runtime.listEntryFiles(join(dir, 'sub'), 50);
    expect(walk.entries.map((e) => path.basename(e))).toEqual(['file.ts']);
    expect(walk.symlinksSkipped).toBeGreaterThan(0);
  });

  it('does not escape the project root through an outside link', async () => {
    const outside = join(root, 'outside-secret');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'secret.ts'), 'export const s = 1;\n');
    const victim = join(root, 'victim');
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, 'ok.ts'), 'export const o = 1;\n');
    try {
      await fsPromises.symlink(outside, join(victim, 'evil'), 'junction');
    } catch {
      return;
    }
    const walk = await runtime.listEntryFiles(victim, 50);
    expect(walk.entries.map((e) => path.basename(e))).toEqual(['ok.ts']);
  });

  it('skips broken links without crashing', async () => {
    const dir = join(root, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ok.ts'), 'export const o = 1;\n');
    try {
      await fsPromises.symlink(join(dir, 'nope'), join(dir, 'broken-link'), 'junction');
    } catch {
      return;
    }
    const walk = await runtime.listEntryFiles(dir, 50);
    expect(walk.entries.map((e) => path.basename(e))).toEqual(['ok.ts']);
  });

  it('does not merge nested repositories', async () => {
    const parent = join(root, 'parent-repos');
    mkdirSync(join(parent, 'repoA', '.git'), { recursive: true });
    mkdirSync(join(parent, 'repoB', '.git'), { recursive: true });
    writeFileSync(join(parent, 'repoA', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(parent, 'repoB', 'b.ts'), 'export const b = 1;\n');
    writeFileSync(join(parent, 'top.ts'), 'export const t = 1;\n');
    const walk = await runtime.listEntryFiles(parent, 50);
    expect(walk.entries.map((e) => path.basename(e))).toEqual(['top.ts']);
    expect(walk.nestedRepoRoots).toContain('repoA');
    expect(walk.nestedRepoRoots).toContain('repoB');
  });

  it('truncates safely when budgets are exceeded', async () => {
    const dir = join(root, 'many');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 10; i += 1) writeFileSync(join(dir, `m${i}.ts`), `export const v${i} = ${i};\n`);
    const walk = await runtime.listEntryFiles(dir, 50, { maxDirsVisited: 1, maxFilesDiscovered: 2 });
    expect(walk.truncated).toBe(true);
    expect(walk.truncationReason).toBeTruthy();
  });

  it('honours cancellation during discovery', async () => {
    const dir = join(root, 'cancel-me');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    await expect(runtime.listEntryFiles(dir, 50, { shouldCancel: () => true })).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('keeps the event loop responsive while discovery walks', async () => {
    const dir = join(root, 'responsive');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 600; i += 1) {
      writeFileSync(join(dir, `f${i}.ts`), `export const v${i} = ${i};\n`);
    }
    let heartbeats = 0;
    const beat = () => {
      heartbeats += 1;
      if (heartbeats < 50) setImmediate(beat);
    };
    setImmediate(beat);
    const walk = await runtime.listEntryFiles(dir, 10000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(walk.filesDiscovered).toBeGreaterThan(200);
    expect(heartbeats).toBeGreaterThan(0);
  });

  it('cancels mid-discovery once the flag flips', async () => {
    const dir = join(root, 'cancel-mid');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 600; i += 1) {
      writeFileSync(join(dir, `g${i}.ts`), `export const w${i} = ${i};\n`);
    }
    let calls = 0;
    await expect(
      runtime.listEntryFiles(dir, 10000, {
        shouldCancel: () => {
          calls += 1;
          return calls > 2;
        },
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(calls).toBeGreaterThan(0);
  });

  it('canonicalizes trailing separators to one scope', async () => {
    const dir = join(root, 'canon');
    mkdirSync(dir, { recursive: true });
    const a = await runtime.normalizeDirectory(dir + path.sep);
    const b = await runtime.normalizeDirectory(dir);
    expect(a.directory).toBe(b.directory);
  });
});
