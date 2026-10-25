import { describe, expect, test } from 'bun:test';

import { graphFilePathForDisplay, resolveGraphFile } from './graphFilePath';

const PROJECT = 'I:/AlRepo';
const SNAPSHOT = 'I:/AlRepo/apps';

describe('graph file path resolution', () => {
  test('a repo-relative id joins the snapshot root, not the project root', () => {
    const resolved = resolveGraphFile({
      snapshotRoot: SNAPSHOT,
      projectRoot: PROJECT,
      file: 'api/src/lib/debug-log-store.ts',
    });
    expect(resolved).toEqual({ ok: true, path: 'I:/AlRepo/apps/api/src/lib/debug-log-store.ts' });
  });

  test('an absolute id is accepted when it stays inside the project', () => {
    const resolved = resolveGraphFile({
      snapshotRoot: SNAPSHOT,
      projectRoot: PROJECT,
      file: 'I:/AlRepo/apps/api/src/main.ts',
    });
    expect(resolved).toEqual({ ok: true, path: 'I:/AlRepo/apps/api/src/main.ts' });
  });

  test('drive-letter casing and backslashes are normalised to the project root', () => {
    const resolved = resolveGraphFile({
      snapshotRoot: 'i:/AlRepo/apps',
      projectRoot: 'I:\\AlRepo\\',
      file: 'api\\src\\main.ts',
    });
    expect(resolved).toEqual({ ok: true, path: 'I:/AlRepo/apps/api/src/main.ts' });
  });

  test('a snapshot root reported with a lower-case drive still resolves under the project drive', () => {
    const resolved = resolveGraphFile({
      snapshotRoot: 'i:/AlRepo/apps',
      projectRoot: 'I:/AlRepo',
      file: 'api/src/main.ts',
    });
    expect(resolved).toEqual({ ok: true, path: 'I:/AlRepo/apps/api/src/main.ts' });
  });

  test('a path that escapes the project is refused instead of opened', () => {
    expect(resolveGraphFile({
      snapshotRoot: SNAPSHOT,
      projectRoot: PROJECT,
      file: 'I:/OtherRepo/api/src/main.ts',
    })).toEqual({ ok: false, reason: 'outside-project' });
    expect(resolveGraphFile({
      snapshotRoot: SNAPSHOT,
      projectRoot: PROJECT,
      file: '../../OtherRepo/api/src/main.ts',
    })).toEqual({ ok: false, reason: 'outside-project' });
  });

  test('a sibling directory that merely shares a prefix is not inside the project', () => {
    expect(resolveGraphFile({
      snapshotRoot: null,
      projectRoot: PROJECT,
      file: 'I:/AlRepo-archive/api/src/main.ts',
    })).toEqual({ ok: false, reason: 'outside-project' });
  });

  test('the resolved path always ends with the id it came from', () => {
    const resolved = resolveGraphFile({
      snapshotRoot: SNAPSHOT,
      projectRoot: PROJECT,
      file: 'api/src/main.ts',
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.ok ? resolved.path.endsWith('/api/src/main.ts') : '').toBe(true);
  });

  test('a missing file id or a missing project root resolves to nothing', () => {
    expect(resolveGraphFile({ snapshotRoot: SNAPSHOT, projectRoot: PROJECT, file: '' }))
      .toEqual({ ok: false, reason: 'no-file' });
    expect(resolveGraphFile({ snapshotRoot: SNAPSHOT, projectRoot: PROJECT, file: null }))
      .toEqual({ ok: false, reason: 'no-file' });
    expect(resolveGraphFile({ snapshotRoot: SNAPSHOT, projectRoot: '', file: 'api/src/main.ts' }))
      .toEqual({ ok: false, reason: 'no-root' });
    expect(resolveGraphFile({ snapshotRoot: SNAPSHOT, projectRoot: null, file: 'api/src/main.ts' }))
      .toEqual({ ok: false, reason: 'no-root' });
  });

  test('without a snapshot root the id falls back to the project root', () => {
    expect(resolveGraphFile({ snapshotRoot: null, projectRoot: PROJECT, file: 'apps/api/src/main.ts' }))
      .toEqual({ ok: true, path: 'I:/AlRepo/apps/api/src/main.ts' });
  });

  test('a project-root change moves the resolution with it', () => {
    const before = resolveGraphFile({ snapshotRoot: 'I:/AlRepo/apps', projectRoot: 'I:/AlRepo', file: 'api/src/main.ts' });
    const after = resolveGraphFile({ snapshotRoot: 'I:/Work/apps', projectRoot: 'I:/Work', file: 'api/src/main.ts' });
    expect(before).toEqual({ ok: true, path: 'I:/AlRepo/apps/api/src/main.ts' });
    expect(after).toEqual({ ok: true, path: 'I:/Work/apps/api/src/main.ts' });
    expect(resolveGraphFile({ snapshotRoot: 'I:/Other/apps', projectRoot: 'I:/Work', file: 'api/src/main.ts' }))
      .toEqual({ ok: false, reason: 'outside-project' });
  });
});

describe('graph file path display', () => {
  test('shows the project-relative path the editor tab names', () => {
    const shown = graphFilePathForDisplay({
      snapshotRoot: 'i:/AlRepo/apps',
      projectRoot: PROJECT,
      file: 'api/src/lib/debug-log-store.ts',
    });
    expect(shown).toBe('apps/api/src/lib/debug-log-store.ts');
  });

  test('keeps a root-relative id when the snapshot root is the project itself', () => {
    expect(graphFilePathForDisplay({ snapshotRoot: PROJECT, projectRoot: PROJECT, file: 'src/math.ts' })).toBe('src/math.ts');
  });

  test('shows the id as reported when it cannot be resolved, never a blank cell', () => {
    expect(graphFilePathForDisplay({ snapshotRoot: SNAPSHOT, projectRoot: PROJECT, file: '../../secret.ts' }))
      .toBe('../../secret.ts');
  });

  test('normalises separators so the shown path matches the editor tab', () => {
    expect(graphFilePathForDisplay({ snapshotRoot: 'I:/AlRepo/apps', projectRoot: PROJECT, file: 'api\\src\\math.ts' }))
      .toBe('apps/api/src/math.ts');
  });
});
