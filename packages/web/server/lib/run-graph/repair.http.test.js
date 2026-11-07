// Repair state on the canonical run/tasks API (GET /api/run-graph/snapshot).
//
// Drives the real route + runtime + repair reader over a temporary project so
// the payload contract is proven end to end: current-epoch attempt attached,
// stale-epoch attempt fenced out, store failure surfaced as `repairError`,
// and absence left absent (never an empty fake block).
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createRepairStateReader } from '../verification-approval/repair-state.js';
import { registerRunGraphRoutes } from './routes.js';
import { createRunGraphRuntime } from './runtime.js';

const TASK_ID = 'st_repair000000000000000001';
const SESSION_ID = 'ses_repair01';

const roots = [];

const makeProject = () => {
  const root = mkdtempSync(join(tmpdir(), 'alcode-run-graph-repair-'));
  roots.push(root);
  const directory = join(root, 'project');
  const stateDir = join(root, 'state');
  mkdirSync(join(directory, '.omo', 'dag-runs'), { recursive: true });
  mkdirSync(join(stateDir, 'tasks'), { recursive: true });
  return { directory, stateDir };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const writeTaskRecord = ({ stateDir, runEpoch, verificationStatus }) => {
  const record = {
    task_id: TASK_ID,
    status: 'error',
    notification: { run_epoch: runEpoch, notified_epoch: -1 },
    updated_at: '2026-11-07T00:00:00.000Z',
  };
  if (verificationStatus !== undefined) record.verification_status = verificationStatus;
  writeFileSync(join(stateDir, 'tasks', `${TASK_ID}.json`), JSON.stringify(record), 'utf8');
};

const writeAttempt = ({ stateDir, epoch, attemptNumber = 1 }) => {
  const attemptId = `${TASK_ID}.e${epoch}.r${attemptNumber}`;
  mkdirSync(join(stateDir, 'repairs', TASK_ID), { recursive: true });
  writeFileSync(
    join(stateDir, 'repairs', TASK_ID, `${attemptId}.json`),
    JSON.stringify({
      attemptId,
      taskId: TASK_ID,
      runEpoch: epoch,
      workspaceId: 'workspace-1',
      attemptNumber,
      state: 'repaired',
      failedCheckIds: ['unit', 'lint'],
      failedEvidenceIds: ['unit.json', 'lint.json'],
      diagnosisRevision: 'rev-1',
      createdAt: 1,
      updatedAt: 2,
      plan: { summary: 'fix the failing checks', steps: ['edit src/a.ts', 'rerun unit', 'rerun lint'], createdAt: 1 },
      outcome: { result: 'repaired', detail: 'changedFiles: src/a.ts, src/b.ts', recordedAt: 2 },
    }),
    'utf8',
  );
  return attemptId;
};

const writeSnapshot = ({ directory }) => {
  const document = {
    schemaVersion: 1,
    sessionId: SESSION_ID,
    updatedAt: '2026-11-07T00:00:00.000Z',
    dag: {
      parent_session_id: SESSION_ID,
      runs: [{ run_id: TASK_ID, run_key: 'run-key', name: 'repair run', status: 'error', nodes: [], edges: [], waves: [] }],
    },
    tasks: {
      parent_session_id: SESSION_ID,
      tasks: [{ task_id: TASK_ID, status: 'error', name: 'repair run', task_summary: 'repair run' }],
    },
  };
  writeFileSync(join(directory, '.omo', 'dag-runs', `${SESSION_ID}.snapshot.json`), JSON.stringify(document), 'utf8');
};

const createApp = (stateDir) => {
  const app = express();
  const runtime = createRunGraphRuntime({ readRepairState: createRepairStateReader({ stateDirOf: () => stateDir }) });
  registerRunGraphRoutes(app, { runGraphRuntime: runtime });
  return app;
};

const fetchSnapshot = (app, directory) =>
  request(app).get('/api/run-graph/snapshot').query({ directory, conversationId: SESSION_ID });

describe('repair state on the run/tasks payload', () => {
  it('attaches the current-epoch repair block and takes verificationStatus from the gate record', async () => {
    const { directory, stateDir } = makeProject();
    writeSnapshot({ directory });
    writeTaskRecord({ stateDir, runEpoch: 2, verificationStatus: 'blocked' });
    const attemptId = writeAttempt({ stateDir, epoch: 2 });

    const response = await fetchSnapshot(createApp(stateDir), directory);

    expect(response.status).toBe(200);
    const expected = {
      attemptId,
      taskId: TASK_ID,
      epoch: 2,
      state: 'repaired',
      failedChecks: ['unit', 'lint'],
      rerunChecks: ['unit', 'lint'],
      changedFiles: ['src/a.ts', 'src/b.ts'],
      // The attempt says "repaired"; the gate record says "blocked". The gate wins.
      verificationStatus: 'blocked',
      hostFacts: [],
      modelHypotheses: [],
      updatedAt: 2,
    };
    expect(response.body.dag.runs[0].repair).toEqual(expected);
    expect(response.body.tasks.tasks[0].repair).toEqual(expected);
    expect(response.body.dag.runs[0].repairError).toBeUndefined();
    expect(response.body.tasks.tasks[0].repairError).toBeUndefined();
  });

  it('omits an attempt whose epoch trails the task record current run_epoch', async () => {
    const { directory, stateDir } = makeProject();
    writeSnapshot({ directory });
    writeTaskRecord({ stateDir, runEpoch: 3, verificationStatus: 'blocked' });
    writeAttempt({ stateDir, epoch: 2 });

    const response = await fetchSnapshot(createApp(stateDir), directory);

    expect(response.status).toBe(200);
    const run = response.body.dag.runs[0];
    const task = response.body.tasks.tasks[0];
    expect(Object.hasOwn(run, 'repair')).toBe(false);
    expect(Object.hasOwn(run, 'repairError')).toBe(false);
    expect(Object.hasOwn(task, 'repair')).toBe(false);
    expect(Object.hasOwn(task, 'repairError')).toBe(false);
  });

  it('reports a store read failure as repairError instead of "no repair"', async () => {
    const { directory, stateDir } = makeProject();
    writeSnapshot({ directory });
    writeTaskRecord({ stateDir, runEpoch: 2, verificationStatus: 'blocked' });
    // A file where the per-task repair directory belongs makes the store
    // listing fail with ENOTDIR, not a missing directory.
    writeFileSync(join(stateDir, 'repairs'), 'not a directory', 'utf8');

    const response = await fetchSnapshot(createApp(stateDir), directory);

    expect(response.status).toBe(200);
    const run = response.body.dag.runs[0];
    expect(Object.hasOwn(run, 'repair')).toBe(false);
    expect(run.repairError).toContain('repair attempt store unreadable');
    expect(response.body.tasks.tasks[0].repairError).toContain('repair attempt store unreadable');
  });

  it('leaves the field absent when the task has no repair attempt', async () => {
    const { directory, stateDir } = makeProject();
    writeSnapshot({ directory });
    writeTaskRecord({ stateDir, runEpoch: 2, verificationStatus: 'blocked' });

    const response = await fetchSnapshot(createApp(stateDir), directory);

    expect(response.status).toBe(200);
    const run = response.body.dag.runs[0];
    expect(Object.hasOwn(run, 'repair')).toBe(false);
    expect(Object.hasOwn(run, 'repairError')).toBe(false);
  });

  it('keeps verificationStatus null when the gate record carries no claim', async () => {
    const { directory, stateDir } = makeProject();
    writeSnapshot({ directory });
    writeTaskRecord({ stateDir, runEpoch: 2 });
    writeAttempt({ stateDir, epoch: 2 });

    const response = await fetchSnapshot(createApp(stateDir), directory);

    expect(response.status).toBe(200);
    expect(response.body.dag.runs[0].repair.verificationStatus).toBeNull();
  });
});
