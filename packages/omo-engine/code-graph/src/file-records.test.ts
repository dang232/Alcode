import { describe, expect, test } from 'bun:test';

import type { FileRecordsDoc } from './file-records';
import {
  FILE_RECORDS_VERSION,
  PARSER_RECORD_VERSION,
  exportSurfaceKey,
  fingerprintBytes,
  fingerprintContent,
  parseFileRecordsDoc,
  serializeFileRecordsDoc,
  validateFileRecords,
} from './file-records';
import { SNAPSHOT_STORE_VERSION } from './snapshot-store';

const BLOB_A = 'a'.repeat(64);
const BLOB_B = 'b'.repeat(64);

const docOf = (files: Record<string, string>): FileRecordsDoc => ({
  version: FILE_RECORDS_VERSION,
  parser: PARSER_RECORD_VERSION,
  schema: SNAPSHOT_STORE_VERSION,
  files: Object.fromEntries(Object.entries(files).map(([file, blob]) => [file, { file, blob }])),
});

describe('file records', () => {
  test('fingerprints are deterministic and content-sensitive', () => {
    expect(fingerprintContent('const x = 1;\n')).toBe(fingerprintContent('const x = 1;\n'));
    expect(fingerprintContent('const x = 1;\n')).not.toBe(fingerprintContent('const x = 2;\n'));
    expect(fingerprintContent('')).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprintBytes(Buffer.from('const x = 1;\n', 'utf8'))).toBe(fingerprintContent('const x = 1;\n'));
  });

  test('records keep valid stats and drop malformed ones to the hash path', () => {
    const doc = parseFileRecordsDoc({
      version: FILE_RECORDS_VERSION,
      parser: PARSER_RECORD_VERSION,
      schema: SNAPSHOT_STORE_VERSION,
      files: {
        'sized.ts': { file: 'sized.ts', blob: BLOB_A, size: 12, mtimeMs: 7 },
        'plain.ts': { file: 'plain.ts', blob: BLOB_A },
        'broken.ts': { file: 'broken.ts', blob: BLOB_A, size: 'huge', mtimeMs: NaN },
      },
    });
    expect(doc?.files['sized.ts']).toEqual({ file: 'sized.ts', blob: BLOB_A, size: 12, mtimeMs: 7 });
    expect(doc?.files['plain.ts']).toEqual({ file: 'plain.ts', blob: BLOB_A });
    expect(doc?.files['broken.ts']).toEqual({ file: 'broken.ts', blob: BLOB_A });
    const roundTripped = parseFileRecordsDoc(JSON.parse(serializeFileRecordsDoc(doc as FileRecordsDoc)));
    expect(roundTripped).toEqual(doc);
  });

  test('a valid document round-trips through serialization', () => {
    const doc = docOf({ 'a.ts': BLOB_A, 'sub/b.ts': BLOB_B });
    expect(parseFileRecordsDoc(JSON.parse(serializeFileRecordsDoc(doc)))).toEqual(doc);
  });

  test('corrupt documents are refused, never guessed', () => {
    expect(parseFileRecordsDoc(null)).toBe(null);
    expect(parseFileRecordsDoc({})).toBe(null);
    expect(parseFileRecordsDoc({ ...docOf({}), version: 999 })).toBe(null);
    expect(parseFileRecordsDoc({ ...docOf({}), parser: 999 })).toBe(null);
    expect(parseFileRecordsDoc({ ...docOf({}), schema: 999 })).toBe(null);
    expect(parseFileRecordsDoc({ ...docOf({}), files: [] })).toBe(null);
    expect(parseFileRecordsDoc(docOf({ 'a.ts': 'not-a-hash' }))).toBe(null);
    expect(parseFileRecordsDoc(docOf({ 'a.ts': BLOB_A }).files)).toBe(null);
  });

  test('partition reports reused, changed, added, and deleted', () => {
    const doc = docOf({ 'same.ts': BLOB_A, 'edit.ts': BLOB_A, 'gone.ts': BLOB_A });
    const current = new Map([
      ['same.ts', BLOB_A],
      ['edit.ts', BLOB_B],
      ['new.ts', BLOB_A],
    ]);
    const parts = validateFileRecords(doc, current);
    expect([...parts.reused]).toEqual(['same.ts']);
    expect([...parts.changed]).toEqual(['edit.ts']);
    expect([...parts.added]).toEqual(['new.ts']);
    expect([...parts.deleted]).toEqual(['gone.ts']);
  });

  test('a rename surfaces as a delete plus an add', () => {
    const doc = docOf({ 'old.ts': BLOB_A });
    const parts = validateFileRecords(doc, new Map([['new.ts', BLOB_A]]));
    expect([...parts.added]).toEqual(['new.ts']);
    expect([...parts.deleted]).toEqual(['old.ts']);
    expect(parts.reused.size).toBe(0);
  });

  test('a missing document rebuilds everything', () => {
    const parts = validateFileRecords(null, new Map([['a.ts', BLOB_A]]));
    expect([...parts.added]).toEqual(['a.ts']);
  });

  test('export surfaces ignore bodies but catch renames and retargets', () => {
    const shard = (name: string, target: string, callRef: string) => ({
      nodes: [
        { id: 'file:a.ts', kind: 'file' },
        { id: `fn:${name}@a.ts`, kind: 'symbol' },
        { id: `export:${name}@a.ts`, kind: 'export-contract', target },
      ],
      edges: [
        { id: 'defines:file:a.ts', kind: 'DEFINES' },
        { id: `calls:${callRef}`, kind: 'CALLS_STATIC' },
        { id: `exports:file:a.ts:export:${name}@a.ts`, kind: 'EXPORTS' },
      ],
    });
    const base = exportSurfaceKey(shard('run', 'fn:run@a.ts', 'a.ts:5'));
    expect(base).toContain('export:run@a.ts');
    expect(base).not.toContain('CALLS_STATIC');
    expect(base).not.toContain('DEFINES');
    // Body-only change: different call refs, identical surface.
    expect(exportSurfaceKey(shard('run', 'fn:run@a.ts', 'a.ts:9'))).toBe(base);
    // Rename, removal signal, and alias retarget all change the surface.
    expect(exportSurfaceKey(shard('walk', 'fn:walk@a.ts', 'a.ts:5'))).not.toBe(base);
    expect(exportSurfaceKey(shard('run', 'fn:other@a.ts', 'a.ts:5'))).not.toBe(base);
    expect(exportSurfaceKey({
      nodes: [{ id: 'file:a.ts', kind: 'file' }],
      edges: [],
    })).not.toBe(base);
  });
});
