import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it("refuses a project config that points the read at another project's store", () => {
    const projectA = mkdtempSync(path.join(tmpdir(), 'alcode-reader-a-'));
    const projectB = mkdtempSync(path.join(tmpdir(), 'alcode-reader-b-'));
    try {
      // Project B owns a store with a recognisable row.
      const bStore = path.join(projectB, 'b-state', 'tasks');
      mkdirSync(bStore, { recursive: true });
      writeFileSync(path.join(bStore, 'st_b.json'), JSON.stringify({ task_id: 'st_b', status: 'running', name: 'PROJECT_B_SECRET' }), 'utf8');
      // Project A's committed config tries to read it.
      mkdirSync(path.join(projectA, '.omo'), { recursive: true });
      writeFileSync(path.join(projectA, '.omo', 'omo.jsonc'), JSON.stringify({ task: { state_dir: bStore } }), 'utf8');

      const result = createRecordTaskReaderForProject()({ directory: projectA });

      // Fail closed: an out-of-scope state_dir is an error, never B's rows.
      expect(result).toMatchObject({ error: expect.stringContaining('outside the project and the agent dir') });
      expect(JSON.stringify(result)).not.toContain('PROJECT_B_SECRET');
    } finally {
      rmSync(projectA, { recursive: true, force: true });
      rmSync(projectB, { recursive: true, force: true });
    }
  });

  it('still honours a state_dir inside the project, resolved against the project not the cwd', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'alcode-reader-in-'));
    try {
      const store = path.join(project, 'own-state', 'tasks');
      mkdirSync(store, { recursive: true });
      writeFileSync(path.join(store, 'st_own.json'), JSON.stringify({ task_id: 'st_own', status: 'running' }), 'utf8');
      mkdirSync(path.join(project, '.omo'), { recursive: true });
      writeFileSync(path.join(project, '.omo', 'omo.jsonc'), JSON.stringify({ task: { state_dir: 'own-state' } }), 'utf8');

      const result = createRecordTaskReaderForProject()({ directory: project });

      expect(result.tasks.map((task) => task.task_id)).toEqual(['st_own']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
