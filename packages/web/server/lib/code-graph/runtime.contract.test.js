import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

/**
 * Server contract pins for the engine wiring in `runtime.js`.
 *
 * Every case drives the real engine bundle over a real temp directory, so
 * the depth walk, the generation mint, the walk-measured module coverage,
 * the file-row ranking, and the partial-coverage downgrade are proven from
 * compiler-resolved facts rather than from fixtures that assume them.
 */

const root = mkdtempSync(join(tmpdir(), 'code-graph-runtime-contract-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const runtime = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true });

// A call chain c <- b <- a <- main: impact(c) grows with depth, so two
// different depths must give two different answers on this fixture.
const chainDir = join(root, 'chain');
mkdirSync(chainDir, { recursive: true });
writeFileSync(
  join(chainDir, 'chain.ts'),
  `export function c(): number {\n  return 1;\n}\n\nexport function b(): number {\n  return c();\n}\n\nexport function a(): number {\n  return b();\n}\n\nexport function main(): number {\n  return a();\n}\n`,
);

// One analyzed file beside files the engine never analyzes: the module
// must not read as fully understood, and the shell-only directory must
// still get a row instead of vanishing.
const coverDir = join(root, 'cover');
mkdirSync(join(coverDir, 'scripts'), { recursive: true });
writeFileSync(join(coverDir, 'app.ts'), `export function hello(): string {\n  return 'hi';\n}\n`);
writeFileSync(join(coverDir, 'notes.yml'), 'service:\n  port: 8080\n');
writeFileSync(join(coverDir, 'deploy.sh'), '#!/bin/sh\nset -eu\necho deploy\n');
writeFileSync(join(coverDir, 'scripts', 'run.sh'), '#!/bin/sh\nset -eu\necho run\n');

// 25 definitions in one file: 25 DEFINES edges plus the subject row.
// (Unexported: an `export` modifier would add a second EXPORTS row per
// symbol and the file would carry 50 edges instead of 25.)
const wideDir = join(root, 'wide');
mkdirSync(wideDir, { recursive: true });
writeFileSync(
  join(wideDir, 'big.ts'),
  Array.from(
    { length: 25 },
    (_, index) => `function f${String(index).padStart(2, '0')}(): number {\n  return ${index};\n}\n`,
  ).join('\n'),
);

// Nested sources: ids stay repo-root relative, so the served snapshotRoot
// is the same directory the resolver joins ids against.
const nestedDir = join(root, 'nested');
mkdirSync(join(nestedDir, 'apps', 'api', 'src'), { recursive: true });
writeFileSync(
  join(nestedDir, 'apps', 'api', 'src', 'math.ts'),
  `export function add(left: number, right: number): number {\n  return left + right;\n}\n`,
);
writeFileSync(
  join(nestedDir, 'apps', 'api', 'src', 'main.ts'),
  `import { add } from "./math";\n\nexport function run(): number {\n  return add(1, 2);\n}\n`,
);

// Four entries against a cap of two: the index is incomplete by construction.
const capDir = join(root, 'capped');
mkdirSync(capDir, { recursive: true });
for (let index = 0; index < 4; index += 1) {
  writeFileSync(join(capDir, `m${index}.ts`), `export const v${index} = ${index};\n`);
}
const capRuntime = createCodeGraphRuntime({ fsPromises, path }, { maxEntryFiles: 2, blockOnRead: true });

const ids = (rows) => (rows ?? []).map((row) => row.id);

describe('neighbourhood depth', () => {
  it(
    'forwards depth into maxDepth and keys the memo on it',
    async () => {
      const one = await runtime.query(chainDir, { kind: 'impact', symbol: 'fn:c@chain.ts', depth: 1 });
      const three = await runtime.query(chainDir, { kind: 'impact', symbol: 'fn:c@chain.ts', depth: 3 });

      // Depth 3 reaches main through b and a; depth 1 stops at the caller.
      expect(ids(three.impacted)).toContain('fn:main@chain.ts');
      expect(ids(one.impacted)).not.toContain('fn:main@chain.ts');
      expect(three.impacted.length).toBeGreaterThan(one.impacted.length);

      // The default is the UI's neighbourhood view: depth 1.
      const implicit = await runtime.query(chainDir, { kind: 'impact', symbol: 'fn:c@chain.ts' });
      expect(ids(implicit.impacted)).toEqual(ids(one.impacted));

      // A repeat within one build is the memoized answer, not a rebuild.
      const oneAgain = await runtime.query(chainDir, { kind: 'impact', symbol: 'fn:c@chain.ts', depth: 1 });
      expect(oneAgain).toBe(one);
    },
    120_000,
  );
});

describe('index generations', () => {
  it(
    'serves the same generation from the index and its queries, then mints a newer one on refresh',
    async () => {
      const index = await runtime.readIndex(chainDir);
      expect(index.generation).toEqual(expect.any(Number));

      const answer = await runtime.query(chainDir, { kind: 'search', query: 'c', limit: 5 });
      expect(answer.generation).toBe(index.generation);

      const refreshed = await runtime.query(chainDir, { kind: 'search', query: 'c', limit: 5, refresh: true });
      expect(refreshed.generation).toBeGreaterThan(index.generation);

      // No rebuild since: the index now serves the refreshed generation.
      const reread = await runtime.readIndex(chainDir);
      expect(reread.generation).toBe(refreshed.generation);
    },
    120_000,
  );
});

describe('module coverage', () => {
  it(
    'counts analyzed, unanalyzed, and excluded files per module and for the repository',
    async () => {
      const answer = await runtime.query(coverDir, { kind: 'explore' });

      expect(answer.coverage).toBe('indexed');
      const bucket = answer.modules.find((module) => module.name === '(root)');
      expect(bucket).toBeDefined();
      expect(bucket.analyzedFiles).toBe(1);
      expect(bucket.unanalyzedFiles).toBe(2);
      expect(bucket.unanalyzedByExtension).toEqual({ '.sh': 1, '.yml': 1 });
      expect(bucket.excludedFiles).toBe(0);

      // The shell-only directory is a row with zero index counts, not a gap.
      const scripts = answer.modules.find((module) => module.name === 'scripts');
      expect(scripts).toBeDefined();
      expect(scripts.fileCount).toBe(0);
      expect(scripts.analyzedFiles).toBe(0);
      expect(scripts.unanalyzedFiles).toBe(1);
      expect(scripts.unanalyzedByExtension).toEqual({ '.sh': 1 });

      expect(answer.repositoryTotals).toEqual({
        analyzedFiles: 1,
        unanalyzedFiles: 3,
        unanalyzedByExtension: { '.sh': 2, '.yml': 1 },
        excludedFiles: 0,
      });
      expect(answer.skippedDirs).toEqual([]);
      expect(answer.unreadableDirs).toEqual([]);
    },
    120_000,
  );
});

describe('file view', () => {
  it(
    'ranks the subject first and reports known vs displayed totals',
    async () => {
      const answer = await runtime.query(wideDir, { kind: 'file', file: 'big.ts', limit: 10 });

      expect(answer.coverage).toBe('indexed');
      // Subject row plus 25 DEFINES rows; only 10 served.
      expect(answer.items.length).toBe(10);
      expect(answer.totals).toEqual({ displayed: 10, known: 26, hidden: 16 });
      expect(answer.items[0].id).toBe('file:big.ts');
      expect(answer.items[1]).toMatchObject({ id: 'fn:f00@big.ts' });
      expect(answer.items[1].evidence[0]).toMatchObject({ edge: 'DEFINES' });
      expect(answer.unresolved).toEqual(['truncated to 10 of 26 rows']);
    },
    120_000,
  );
});

describe('repo-root-relative ids', () => {
  it(
    'indexes nested sources under the served directory root',
    async () => {
      const index = await runtime.readIndex(nestedDir);
      const posix = (value) => String(value).replace(/\\/g, '/').toLowerCase();
      expect(posix(index.snapshotRoot)).toBe(posix(nestedDir));

      const answer = await runtime.query(nestedDir, { kind: 'context', symbol: 'fn:add@apps/api/src/math.ts' });
      expect(answer.coverage).toBe('indexed');
      expect(answer.definition.file).toBe('apps/api/src/math.ts');

      const resolved = await runtime.resolveFile(nestedDir, 'apps/api/src/math.ts');
      expect(resolved.ok).toBe(true);
      expect(resolved.projectRelative).toBe('apps/api/src/math.ts');
    },
    120_000,
  );
});

describe('partial-coverage index', () => {
  it(
    'surfaces completeness partial when the entry cap cuts the index',
    async () => {
      const index = await capRuntime.readIndex(capDir);
      expect(index.indexTruncated).toBe(true);
      expect(index.excludedCount).toBe(2);

      const answer = await capRuntime.query(capDir, { kind: 'search', query: 'v', limit: 20 });
      expect(answer.coverage).toBe('partial');
      expect(answer.completeness).toBe('partial');
      expect(answer.unresolved.some((line) => line.includes('index incomplete'))).toBe(true);

      const explore = await capRuntime.query(capDir, { kind: 'explore' });
      expect(explore.coverage).toBe('partial');
      expect(explore.completeness).toBe('partial');
    },
    120_000,
  );
});
