import { describe, expect, it } from 'vitest';

import { createSnapshotReconciler } from './delivery-reconcile';

describe('createSnapshotReconciler', () => {
  it('refuses a call with no project directory and does not reconcile', () => {
    const calls = [];
    const reconcile = createSnapshotReconciler({ reconcile: (input) => calls.push(input) });

    expect(reconcile({})).toMatchObject({ error: expect.stringContaining('directory') });
    expect(reconcile({ directory: '   ' })).toMatchObject({ error: expect.stringContaining('directory') });
    expect(calls).toHaveLength(0);
  });

  it('passes the project directory to the reconciler it was given', () => {
    const seen = [];
    const reconcile = createSnapshotReconciler({
      reconcile: (input) => {
        seen.push(input);
        return { reconciled: 0 };
      },
    });

    expect(reconcile({ directory: process.cwd() })).toEqual({ report: { reconciled: 0 } });
    expect(seen).toHaveLength(1);
    expect(seen[0].directory).toBe(process.cwd());
  });
});
