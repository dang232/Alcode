// The shared client contract for repair state on the run/tasks API.
//
// Proves the parser is strict about the projected block, turns a malformed
// block into an explicit error (never "no repair"), and keeps the absent case
// absent rather than fabricating an empty block.
import { describe, expect, test } from 'bun:test';

import type { JsonValue } from '@alcode/sdk';
import { parseSnapshotRepairIndex } from './runGraphApi';

const block = {
  attemptId: 'st_a.e2.r1',
  taskId: 'st_a',
  epoch: 2,
  state: 'repair_failed',
  failedChecks: ['unit'],
  rerunChecks: ['unit'],
  changedFiles: ['src/a.ts'],
  verificationStatus: 'blocked',
  hostFacts: [],
  modelHypotheses: [],
  updatedAt: 2,
};

const payload = (runs: JsonValue[], tasks: JsonValue[]): JsonValue => ({
  schemaVersion: 1,
  sessionId: 'ses_1',
  dag: { runs },
  tasks: { tasks },
});

describe('parseSnapshotRepairIndex', () => {
  test('reads a repair block keyed by run_id and task_id', () => {
    const index = parseSnapshotRepairIndex(
      payload([{ run_id: 'st_a', repair: block }], [{ task_id: 'st_a', repair: block }]),
    );

    expect(index.runs.st_a).toEqual({ repair: block });
    expect(index.tasks.st_a).toEqual({ repair: block });
  });

  test('keeps a missing repair field absent', () => {
    const index = parseSnapshotRepairIndex(payload([{ run_id: 'st_a' }], [{ task_id: 'st_a' }]));

    expect(Object.hasOwn(index.runs, 'st_a')).toBe(false);
    expect(Object.hasOwn(index.tasks, 'st_a')).toBe(false);
  });

  test('surfaces a server repairError verbatim', () => {
    const index = parseSnapshotRepairIndex(
      payload([{ run_id: 'st_a', repairError: 'repair attempt store unreadable for st_a: boom' }], []),
    );

    expect(index.runs.st_a).toEqual({ repairError: 'repair attempt store unreadable for st_a: boom' });
  });

  test('turns a malformed block into an explicit error instead of dropping it', () => {
    const index = parseSnapshotRepairIndex(
      payload([{ run_id: 'st_a', repair: { ...block, state: 'done' } }], []),
    );

    expect(index.runs.st_a?.repair).toBeUndefined();
    expect(index.runs.st_a?.repairError).toContain('malformed');
  });
});
