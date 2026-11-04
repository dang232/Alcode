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

const isStringValue = (value) => Object.prototype.toString.call(value) === '[object String]';

describe('safe bounded traversal', () => {
  it('excludes generated .tsbuild declaration caches but keeps real sources', async () => {
    write('cache-scope/src/a.ts', 'export function alpha(): number { return 1; }\n');
    write('cache-scope/src/types.d.ts', 'export declare function alpha(): number;\n');
    write('cache-scope/.tsbuild/ui/src/a.d.ts', 'export declare function alpha(): number;\n');
    const walk = await runtime.listEntryFiles(join(root, 'cache-scope'), 50);
    const rels = walk.entries.map((e) => path.relative(join(root, 'cache-scope'), e).split(path.sep).join('/')).sort();
    expect(rels).toEqual(['src/a.ts', 'src/types.d.ts']);
  });

  it('never indexes the repo-local .algraph store, even with an include-all config', async () => {
    write('algraph-scope/src/a.ts', 'export function alpha(): number { return 1; }\n');
    write('algraph-scope/.algraph/panel/main.js', 'console.log(1);\n');
    write('algraph-scope/codegraph.json', JSON.stringify({ include: ['**/*'] }));
    const walk = await runtime.listEntryFiles(join(root, 'algraph-scope'), 50);
    const rels = walk.entries.map((e) => path.relative(join(root, 'algraph-scope'), e).split(path.sep).join('/'));
    expect(rels).toEqual(['src/a.ts']);
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

  it('ignores legacy traversal budgets and completes the walk', async () => {
    const dir = join(root, 'many');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 10; i += 1) writeFileSync(join(dir, `m${i}.ts`), `export const v${i} = ${i};\n`);
    // Legacy budget options are accepted and ignored: the walk is unbounded.
    const walk = await runtime.listEntryFiles(dir, 50, { maxDirsVisited: 1, maxFilesDiscovered: 2, maxDepth: 1, maxCandidateFiles: 1, maxFileSizeBytes: 10 });
    expect(walk.truncated).toBe(false);
    expect(walk.truncationReason).toBe(null);
    expect(walk.excludedCount).toBe(0);
    expect(walk.entries.length).toBe(10);
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

describe('project config and ignore overrides (S7)', () => {
  const writeConfig = (dir, value) => {
    writeFileSync(join(dir, 'codegraph.json'), isStringValue(value) ? value : JSON.stringify(value));
  };
  const basenames = (walk) => walk.entries.map((e) => path.basename(e)).sort();
  const rels = (walk, scope) => walk.entries.map((e) => path.relative(scope, e).split(path.sep).join('/')).sort();

  it('negation + include move files between visible buckets with no silent drops', async () => {
    const dir = join(root, 's7-negation');
    mkdirSync(dir, { recursive: true });
    const baseline = await runtime.listEntryFiles(dir, 50);
    expect(baseline.truncated).toBe(false);
    write('s7-negation/keep.ts');
    write('s7-negation/drop1.ts');
    write('s7-negation/drop2.ts');
    write('s7-negation/notes.md', '# notes\n');
    const before = await runtime.listEntryFiles(dir, 50);
    expect(basenames(before)).toEqual(['drop1.ts', 'drop2.ts', 'keep.ts']);
    expect(before.excludedCount).toBe(0);
    expect(before.truncated).toBe(false);
    expect(baseline.truncated).toBe(false);
    writeConfig(dir, { exclude: ['drop*.ts', '!drop1.ts'] });
    const after = await runtime.listEntryFiles(dir, 50);
    // Negation rescues drop1.ts; drop2.ts moves to the excluded bucket.
    expect(basenames(after)).toEqual(['drop1.ts', 'keep.ts']);
    expect(after.excludedCount).toBe(1);
    expect(after.truncationReason).toBe('project-config');
    expect(after.excludedSample).toContain('drop2.ts');
    expect(after.coverage.byModule['(root)'].excludedFiles).toBe(1);
    expect(after.coverage.appliedConfig).toBe('codegraph.json');
    // No silent drops: every scanned file is analyzed, excluded, or unanalyzed.
    const totals = after.coverage.totals;
    expect(totals.analyzedFiles + totals.excludedFiles + totals.unanalyzedFiles).toBe(after.scanned);
    expect(totals.analyzedFiles).toBe(2);
    expect(totals.unanalyzedFiles).toBe(2);
  });

  it('include rescues a default-skipped directory', async () => {
    const dir = join(root, 's7-include');
    mkdirSync(join(dir, 'vendor'), { recursive: true });
    writeFileSync(join(dir, 'vendor', 'lib.ts'), 'export const lib = 1;\n');
    writeFileSync(join(dir, 'vendor', 'drop.ts'), 'export const drop = 1;\n');
    writeFileSync(join(dir, 'top.ts'), 'export const top = 1;\n');
    const before = await runtime.listEntryFiles(dir, 50);
    expect(basenames(before)).toEqual(['top.ts']);
    expect(before.coverage.skippedDirs).toContain('vendor');
    // Pruned skipped dirs count in their own rel's bucket (`vendor` is one
    // segment, so `(root)`), the pre-existing bucket rule.
    expect(before.coverage.byModule['(root)'].excludedFiles).toBe(2);
    writeConfig(dir, { include: ['vendor/lib.ts'] });
    const after = await runtime.listEntryFiles(dir, 50);
    expect(rels(after, dir)).toEqual(['top.ts', 'vendor/lib.ts']);
    // The rescued dir is walked, not pruned; the unrescued file stays excluded.
    expect(after.coverage.skippedDirs).toEqual([]);
    expect(after.coverage.byModule.vendor.analyzedFiles).toBe(1);
    expect(after.coverage.byModule.vendor.excludedFiles).toBe(1);
  });

  it('extension mapping promotes custom extensions and removes default ones', async () => {
    const dir = join(root, 's7-ext');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'widget.mdx'), '# widget\n');
    writeFileSync(join(dir, 'app.ts'), 'export const app = 1;\n');
    writeFileSync(join(dir, 'old.js'), 'export const old = 1;\n');
    const before = await runtime.listEntryFiles(dir, 50);
    expect(basenames(before)).toEqual(['app.ts', 'old.js']);
    expect(before.coverage.totals.unanalyzedByExtension['.mdx']).toBe(1);
    writeConfig(dir, { extensions: { '.mdx': 'markdown', '.js': false } });
    const after = await runtime.listEntryFiles(dir, 50);
    expect(basenames(after)).toEqual(['app.ts', 'widget.mdx']);
    expect(after.coverage.totals.unanalyzedByExtension['.js']).toBe(1);
    expect(after.coverage.totals.unanalyzedByExtension['.mdx'] ?? 0).toBe(0);
  });

  it('reads files of any size with no size cap to override', async () => {
    const dir = join(root, 's7-size');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'big.ts'), `export const big = "${'x'.repeat(1200 * 1024)}";\n`);
    writeFileSync(join(dir, 'small.ts'), 'export const small = 1;\n');
    const before = await runtime.listEntryFiles(dir, 50);
    expect(basenames(before)).toEqual(['big.ts', 'small.ts']);
    expect(before.excludedCount).toBe(0);
    expect(before.truncationReason).toBe(null);
    expect(before.truncated).toBe(false);
    expect(before.maxFileSizeBytes).toBe(null);
    // A legacy size override is parsed and ignored: the walk stays complete.
    writeConfig(dir, { maxFileSizeBytes: 2 * 1024 * 1024 });
    const after = await runtime.listEntryFiles(dir, 50);
    expect(basenames(after)).toEqual(['big.ts', 'small.ts']);
    expect(after.excludedCount).toBe(0);
    expect(after.maxFileSizeBytes).toBe(null);
    expect(after.budgets.maxFileSizeBytes).toBe(null);
    writeConfig(dir, { maxFileSizeBytes: 64 * 1024 * 1024 });
    const clamped = await runtime.listEntryFiles(dir, 50);
    expect(clamped.maxFileSizeBytes).toBe(null);
    expect(basenames(clamped)).toEqual(['big.ts', 'small.ts']);
    expect(clamped.projectConfig.maxFileSizeBytes).toBe(null);
  });

  it('deprioritize binds nothing without a cap: every file indexes', async () => {
    const dir = join(root, 's7-depri');
    mkdirSync(join(dir, 'slow'), { recursive: true });
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'b.ts'), 'export const b = 1;\n');
    writeFileSync(join(dir, 'slow', 'c.ts'), 'export const c = 1;\n');
    writeFileSync(join(dir, 'slow', 'd.ts'), 'export const d = 1;\n');
    const before = await runtime.listEntryFiles(dir, 2);
    expect(rels(before, dir)).toEqual(['a.ts', 'b.ts', 'slow/c.ts', 'slow/d.ts']);
    expect(before.truncationReason).toBe(null);
    expect(before.excludedCount).toBe(0);
    writeConfig(dir, { deprioritize: ['a.ts', 'b.ts'] });
    const after = await runtime.listEntryFiles(dir, 2);
    // No cap sheds anything: the deprioritized files index like the rest.
    expect(rels(after, dir)).toEqual(['a.ts', 'b.ts', 'slow/c.ts', 'slow/d.ts']);
    expect(after.truncationReason).toBe(null);
    expect(after.excludedCount).toBe(0);
  });

  it('root and nested gitignore files are honored', async () => {
    const dir = join(root, 's7-ignore');
    mkdirSync(join(dir, 'gen'), { recursive: true });
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'gen', 'out.ts'), 'export const out = 1;\n');
    writeFileSync(join(dir, 'keep.ts'), 'export const keep = 1;\n');
    writeFileSync(join(dir, 'sub', 'local.ts'), 'export const local = 1;\n');
    writeFileSync(join(dir, 'sub', 'keep2.ts'), 'export const keep2 = 1;\n');
    const before = await runtime.listEntryFiles(dir, 50);
    expect(rels(before, dir)).toEqual(['gen/out.ts', 'keep.ts', 'sub/keep2.ts', 'sub/local.ts']);
    writeFileSync(join(dir, '.gitignore'), 'gen/\n');
    writeFileSync(join(dir, 'sub', '.gitignore'), 'local.ts\n');
    const after = await runtime.listEntryFiles(dir, 50);
    expect(rels(after, dir)).toEqual(['keep.ts', 'sub/keep2.ts']);
    expect(after.excludedCount).toBe(2);
    // The ignore layer decided these, so the banner names .gitignore rather
    // than a project config file that does not exist.
    expect(after.truncationReason).toBe('gitignore');
    // A policy exclusion is exact and counted, never a truncation: the walk
    // reached every directory, so the build stays complete.
    expect(after.truncated).toBe(false);
    expect(after.gitignoreFiles).toEqual(['.gitignore', 'sub/.gitignore']);
    expect(after.coverage.byModule.gen.excludedFiles).toBe(1);
    expect(after.coverage.byModule.sub.excludedFiles).toBe(1);
  });

  it('invalid config fails open with a stated reason', async () => {
    const dir = join(root, 's7-badconfig');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    writeConfig(dir, '{nope');
    const walk = await runtime.listEntryFiles(dir, 50);
    expect(basenames(walk)).toEqual(['a.ts']);
    expect(walk.excludedCount).toBe(0);
    expect(walk.configError).toEqual(expect.stringContaining('not valid JSON'));
    expect(walk.projectConfig).toEqual(expect.objectContaining({ basename: 'codegraph.json' }));
  });
});
