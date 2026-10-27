import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

/**
 * Snapshot file ids are relative to the snapshot root the engine reports,
 * which is the entry list's common directory and may sit below the project
 * root. These cases pin the property that made a real indexed file render as
 * "File not found" in the app: an id joined to the project directory instead
 * of the snapshot root.
 *
 * Every assertion runs against a real temp checkout indexed by the real
 * engine bundle, so the root comes from the index itself rather than from a
 * fixture that assumes one.
 */

const MATH_TS = `export function add(left: number, right: number): number {
  return left + right;
}
`;

const root = mkdtempSync(join(tmpdir(), 'code-graph-resolve-'));

// Flat project: entries sit at the project root.
const flat = join(root, 'flat');
mkdirSync(flat, { recursive: true });
writeFileSync(join(flat, 'math.ts'), MATH_TS);

// Nested project: the indexed sources live under apps/, so the snapshot root
// is the subfolder and not the project directory the editor addresses.
const nested = join(root, 'nested');
mkdirSync(join(nested, 'apps', 'api', 'src'), { recursive: true });
writeFileSync(join(nested, 'apps', 'api', 'src', 'math.ts'), MATH_TS);

const outside = join(root, 'outside');
mkdirSync(outside, { recursive: true });
writeFileSync(join(outside, 'secret.ts'), MATH_TS);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const runtime = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true });

describe('snapshot file resolution', () => {
  it('resolves an absolute id the engine emits for files outside the snapshot root', async () => {
    const mono = join(root, 'mono');
    mkdirSync(join(mono, 'apps', 'api'), { recursive: true });
    mkdirSync(join(mono, 'packages', 'db'), { recursive: true });
    writeFileSync(join(mono, 'apps', 'api', 'math.ts'), MATH_TS);
    writeFileSync(join(mono, 'packages', 'db', 'index.ts'), MATH_TS);
    await runtime.readIndex(mono);
    const result = await runtime.resolveFile(mono, join(mono, 'packages', 'db', 'index.ts'));
    expect(result.ok).toBe(true);
    expect(result.projectRelative).toBe('packages/db/index.ts');
  }, 120_000);

  it('resolves an id against the snapshot root, not the project directory', async () => {
    const index = await runtime.readIndex(flat);
    const result = await runtime.resolveFile(flat, 'math.ts');

    expect(index.snapshotRoot).toBeTruthy();
    expect(result.ok).toBe(true);
    expect(result.absolute.toLowerCase()).toBe(join(flat, 'math.ts').toLowerCase());
    expect(result.projectRelative).toBe('math.ts');
    expect(result.snapshotRoot.toLowerCase()).toBe(String(index.snapshotRoot).toLowerCase());
  }, 120_000);

  it('reports a project-relative path the editor can address when ids are root-relative', async () => {
    const index = await runtime.readIndex(nested);
    const absoluteFile = join(nested, 'apps', 'api', 'src', 'math.ts');
    const idUnderRoot = path.relative(String(index.snapshotRoot), absoluteFile).replace(/\\/g, '/');
    const result = await runtime.resolveFile(nested, idUnderRoot);

    expect(idUnderRoot.length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
    expect(result.projectRelative).toBe('apps/api/src/math.ts');
    expect(result.projectRelative).not.toContain('\\');
  }, 120_000);

  it('refuses traversal out of the snapshot root instead of reading a neighbour file', async () => {
    await runtime.readIndex(flat);
    for (const { id: attempt, reason } of [
      { id: '../outside/secret.ts', reason: 'outside-snapshot-root' },
      { id: '../../etc/passwd', reason: 'outside-snapshot-root' },
      { id: 'math.ts/../../../outside/secret.ts', reason: 'outside-snapshot-root' },
      // A backslash separates path segments only on Windows. On POSIX it is a
      // legal filename character, so this id names nothing inside the root
      // instead of escaping it, and the refusal reason is `missing`.
      { id: '..\\outside\\secret.ts', reason: process.platform === 'win32' ? 'outside-snapshot-root' : 'missing' },
    ]) {
      const result = await runtime.resolveFile(flat, attempt);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(reason);
    }
  }, 120_000);

  it('refuses a link that escapes the project after realpath', async () => {
    const linked = join(root, 'linked');
    mkdirSync(join(linked, 'src'), { recursive: true });
    writeFileSync(join(linked, 'src', 'math.ts'), MATH_TS);
    const escape = join(linked, 'src', 'escape.ts');
    try {
      symlinkSync(join(outside, 'secret.ts'), escape, 'file');
    } catch {
      return;
    }
    await runtime.readIndex(linked);
    const result = await runtime.resolveFile(linked, 'escape.ts');
    expect(result.ok).toBe(false);
    expect(['outside-project', 'outside-snapshot-root']).toContain(result.reason);
  }, 120_000);

  it('distinguishes a missing file from a refused path', async () => {
    await runtime.readIndex(flat);
    const missing = await runtime.resolveFile(flat, 'missing.ts');
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe('missing');

    const empty = await runtime.resolveFile(flat, '   ');
    expect(empty.ok).toBe(false);
    expect(empty.reason).toBe('missing-file-id');
  }, 120_000);

  it('accepts a differently-cased directory on win32, as the engine reports a lowercased drive', async () => {
    if (process.platform !== 'win32') return;
    await runtime.readIndex(flat);
    const flipped = flat.replace(/^[A-Za-z]:/, (drive) => drive.toLowerCase());
    const result = await runtime.resolveFile(flipped, 'math.ts');
    expect(result.ok).toBe(true);
    expect(result.projectRelative).toBe('math.ts');
  }, 120_000);
});
