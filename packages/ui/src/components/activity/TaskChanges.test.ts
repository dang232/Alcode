import { describe, expect, test } from 'bun:test';

import { changedFilesForTask, type StatusFile } from './taskChangesModel';

const statusFile = (path: string, working = 'M', index = ' '): StatusFile => ({
  path,
  index,
  working_dir: working,
} as StatusFile);

describe('changes of a task', () => {
  test('matches a project-relative task path to the repository path', () => {
    const matched = changedFilesForTask(
      ['apps/api/src/domains/projects/operations.ts'],
      [statusFile('apps/api/src/domains/projects/operations.ts'), statusFile('README.md')],
    );
    expect(matched.map((entry) => entry.path)).toEqual(['apps/api/src/domains/projects/operations.ts']);
  });

  test('matches an absolute task path without claiming another directory', () => {
    const matched = changedFilesForTask(
      ['I:/AlRepo/src/index.ts'],
      [statusFile('src/index.ts'), statusFile('packages/other/src/index.ts')],
    );
    expect(matched.map((entry) => entry.path)).toEqual(['src/index.ts']);
  });

  test('a bare file name does not claim a same-named file in another directory', () => {
    const matched = changedFilesForTask(['x.ts'], [statusFile('b/x.ts')]);
    expect(matched).toEqual([]);
  });

  test('answers one entry per path and sorted, even with duplicate status rows', () => {
    const matched = changedFilesForTask(
      ['b.ts', 'a.ts'],
      [statusFile('b.ts'), statusFile('a.ts'), statusFile('b.ts')],
    );
    expect(matched.map((entry) => entry.path)).toEqual(['a.ts', 'b.ts']);
  });

  test('a task that touched nothing changed answers no rows', () => {
    expect(changedFilesForTask(['a.ts'], [])).toEqual([]);
    expect(changedFilesForTask([], [statusFile('a.ts')])).toEqual([]);
  });
});
