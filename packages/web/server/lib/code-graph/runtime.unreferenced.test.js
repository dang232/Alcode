import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

/**
 * Server contract pins for `kind=unreferenced` in `runtime.js`.
 *
 * Drives the real engine bundle over a real temp directory: `orphan.ts`
 * (imported by nobody) must surface as a candidate while `used.ts`
 * (imported by `entry.ts`) never does, the entry-like `main.ts` is counted
 * in `summary.excludedEntryLike` instead of appearing as a candidate, and
 * an unknown kind still answers 400.
 */

const root = mkdtempSync(join(tmpdir(), 'code-graph-runtime-unreferenced-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const runtime = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true });

const dir = join(root, 'unref');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'orphan.ts'), `export function orphan(): number {\n  return 42;\n}\n`);
writeFileSync(join(dir, 'used.ts'), `export function used(): number {\n  return 7;\n}\n`);
writeFileSync(
  join(dir, 'entry.ts'),
  `import { used } from "./used";\n\nexport function run(): number {\n  return used();\n}\n`,
);
writeFileSync(join(dir, 'main.ts'), `export function boot(): number {\n  return 0;\n}\n`);

const files = (rows) => (rows ?? []).map((row) => row.file);

describe('kind=unreferenced', () => {
  it(
    'surfaces the file nobody imports and never the file entry.ts reaches',
    async () => {
      const answer = await runtime.query(dir, { kind: 'unreferenced' });

      expect(answer.coverage).toBe('indexed');
      // File granularity: `used.ts` is imported by `entry.ts`, so its file row
      // stays out. Symbol granularity must agree: `used()` is called through
      // that import, so reporting its export contract as `only-exported` was a
      // false positive - inbound call edges land on the export/file id, and a
      // reference found through ANY of a symbol's ids disqualifies it.
      const fileCandidates = answer.candidates
        .filter((candidate) => candidate.kind === 'file')
        .map((candidate) => candidate.file);
      expect(fileCandidates).toContain('orphan.ts');
      expect(fileCandidates).not.toContain('used.ts');
      expect(answer.candidates.some((candidate) => candidate.file === 'used.ts')).toBe(false);
      // The unreferenced export in that same directory is the case the query exists for.
      expect(
        answer.candidates.find((candidate) => candidate.id === 'export:orphan@orphan.ts')?.reason,
      ).toBe('only-exported');
    },
    120_000,
  );

  it(
    'counts the entry-like file instead of listing it as a candidate',
    async () => {
      const answer = await runtime.query(dir, { kind: 'unreferenced' });

      expect(answer.summary.excludedEntryLike).toBeGreaterThanOrEqual(1);
      expect(files(answer.candidates)).not.toContain('main.ts');
    },
    120_000,
  );

  it(
    'carries honest totals and the never-dead-code contract note',
    async () => {
      const answer = await runtime.query(dir, { kind: 'unreferenced' });

      expect(answer.totals.known).toBe(answer.candidates.length);
      expect(answer.totals.displayed).toBe(answer.items.length);
      expect(answer.summary.unanalyzedNote).toEqual(expect.any(String));
      expect(answer.summary.unanalyzedNote).toContain('potentially unreferenced');
    },
    120_000,
  );

  it(
    'answers 400 for an unknown kind',
    async () => {
      const answer = await runtime.query(dir, { kind: 'nope' });

      expect(answer.status).toBe(400);
      expect(answer.error).toContain('kind must be');
    },
    120_000,
  );
});
