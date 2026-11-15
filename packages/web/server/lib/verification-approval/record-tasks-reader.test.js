import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createRecordTaskReaderForProject } from './record-tasks-reader';

// The server reaches this factory only through run-graph/runtime.js' dynamic bundle seam, so nothing imports it
// statically. These cases cover the factory itself: the engine's store resolution is bound in, and a call without a
// project directory is refused instead of reading some other project's records.
describe('createRecordTaskReaderForProject', () => {
  it('returns a reader that refuses a call with no project directory', () => {
    const read = createRecordTaskReaderForProject();

    expect(typeof read).toBe('function');
    expect(read({})).toMatchObject({ error: expect.stringContaining('directory') });
    expect(read({ directory: '   ' })).toMatchObject({ error: expect.stringContaining('directory') });
  });

  it('reads a real project directory without inventing records', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'alcode-reader-'));
    try {
      const result = createRecordTaskReaderForProject()({ directory: dir });

      expect(result).toBeTypeOf('object');
      if ('error' in result) {
        expect(typeof result.error).toBe('string');
      } else {
        expect(result.tasks).toEqual([]);
        expect(result.absent).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
