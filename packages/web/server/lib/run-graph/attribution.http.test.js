// Attribution on the run-graph API.
//
// Drives the real route + runtime + attribution reader over a temporary project
// so the payload contract is proven end to end: a chat node whose id is a known
// child session gets both ids, an unknown session gets neither, a collision is
// surfaced instead of guessed, and a reader failure never reads as an empty
// index. The served snapshot file is only read, never rewritten.
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createAttributionStateReader } from '../verification-approval/attribution-state.js';
import { registerRunGraphRoutes } from './routes.js';
import { createRunGraphRuntime } from './runtime.js';

const SESSION_ID = 'ses_attrib01';
const CHILD_SESSION = 'ses_child01';
const TASK_ID = 'st_attrib000000000000000001';
const TASK_ID_B = 'st_attrib000000000000000002';
const NODE_ID = 'node_alpha';
const NODE_ID_B = 'node_beta';
const RUN_ID = 'run_alpha';

const roots = [];

const makeProject = () => {
  const root = mkdtempSync(join(tmpdir(), 'alcode-run-graph-attribution-'));
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

const writeTaskRecord = ({ stateDir, taskId = TASK_ID, childSessionId = CHILD_SESSION, nodeId = NODE_ID, runId = RUN_ID }) => {
  const record = {
    task_id: taskId,
    child_session_id: childSessionId,
    owner: { kind: 'dag', runId, nodeId },
  };
  writeFileSync(join(stateDir, 'tasks', `${taskId}.json`), JSON.stringify(record), 'utf8');
};

const snapshotDoc = ({ childSessionId = CHILD_SESSION } = {}) => ({
  schemaVersion: 1,
  sessionId: SESSION_ID,
  updatedAt: '2026-11-08T00:00:00.000Z',
  dag: {
    runs: [
      {
        run_id: SESSION_ID,
        run_key: `chat:${SESSION_ID}`,
        name: 'chat run',
        status: 'running',
        nodes: [
          { id: 'parent', label: 'parent', state: 'running', depends_on: [] },
          { id: childSessionId, label: 'child', state: 'completed', depends_on: ['parent'] },
          { id: 'synthesis', label: 'Synthesis', state: 'pending', depends_on: [childSessionId] },
        ],
        edges: [],
        waves: [],
      },
      {
        run_id: RUN_ID,
        run_key: `engine:${RUN_ID}`,
        name: 'engine run',
        status: 'running',
        nodes: [{ id: childSessionId, label: 'engine child', state: 'completed', depends_on: [] }],
        edges: [],
        waves: [],
      },
    ],
  },
  tasks: {
    tasks: [
      { task_id: TASK_ID, status: 'completed', name: 'child' },
      { task_id: TASK_ID_B, status: 'completed', name: 'other child' },
    ],
  },
});

const snapshotPath = ({ directory }) => join(directory, '.omo', 'dag-runs', `${SESSION_ID}.snapshot.json`);

const writeSnapshot = (project, doc = snapshotDoc()) => {
  writeFileSync(snapshotPath(project), JSON.stringify(doc), 'utf8');
};

const createApp = (project, overrides = {}) => {
  const app = express();
  const runtime = createRunGraphRuntime({
    readRepairState: () => ({}),
    readAttributionState: createAttributionStateReader({ stateDirOf: () => project.stateDir }),
    ...overrides,
  });
  registerRunGraphRoutes(app, { runGraphRuntime: runtime });
  return app;
};

const fetchSnapshot = (app, directory) =>
  request(app).get('/api/run-graph/snapshot').query({ directory, conversationId: SESSION_ID });

const fetchAttribution = (app, directory) =>
  request(app).get('/api/run-graph/attribution').query({ directory });

const chatNode = (body, id) => body.dag.runs[0].nodes.find((node) => node.id === id);
const engineNode = (body, id) => body.dag.runs[1].nodes.find((node) => node.id === id);

describe('attribution on the run/tasks payload', () => {
  it('attaches both ids to a known chat child and leaves the served file untouched', async () => {
    const project = makeProject();
    writeSnapshot(project);
    writeTaskRecord(project);
    const before = readFileSync(snapshotPath(project));

    const response = await fetchSnapshot(createApp(project), project.directory);

    expect(response.status).toBe(200);
    expect(chatNode(response.body, CHILD_SESSION).task_id).toBe(TASK_ID);
    expect(chatNode(response.body, CHILD_SESSION).node_id).toBe(NODE_ID);
    expect(response.body.tasks.tasks[0].node_id).toBe(NODE_ID);
    // Engine nodes keep the id their own producer emitted; the join never runs.
    expect(chatNode(response.body, 'parent').task_id).toBeUndefined();
    expect(engineNode(response.body, CHILD_SESSION).task_id).toBeUndefined();
    expect(engineNode(response.body, CHILD_SESSION).node_id).toBeUndefined();
    expect(readFileSync(snapshotPath(project))).toEqual(before);
  });

  it('leaves an unknown child session without either id', async () => {
    const project = makeProject();
    writeSnapshot(project, snapshotDoc({ childSessionId: 'ses_unknown' }));
    writeTaskRecord(project);

    const response = await fetchSnapshot(createApp(project), project.directory);

    expect(response.status).toBe(200);
    const node = chatNode(response.body, 'ses_unknown');
    expect(node.task_id).toBeUndefined();
    expect(node.node_id).toBeUndefined();
    expect(Object.hasOwn(node, 'task_id')).toBe(false);
    expect(Object.hasOwn(node, 'node_id')).toBe(false);
  });

  it('serves the attribution index for a known child', async () => {
    const project = makeProject();
    writeSnapshot(project);
    writeTaskRecord(project);

    const response = await fetchAttribution(createApp(project), project.directory);

    expect(response.status).toBe(200);
    expect(response.body.entries).toEqual([{ taskId: TASK_ID, childSessionId: CHILD_SESSION, nodeId: NODE_ID, runId: RUN_ID }]);
    expect(response.body.byChildSessionId[CHILD_SESSION]).toEqual({ taskId: TASK_ID, nodeId: NODE_ID, runId: RUN_ID });
    expect(response.body.collisions).toEqual([]);
  });

  it('surfaces a reader failure on both routes instead of an empty index', async () => {
    const project = makeProject();
    writeSnapshot(project);
    const failure = () => ({ error: 'attribution state: task record malformed for bad.json' });
    const app = createApp(project, { readAttributionState: failure });

    const snapshot = await fetchSnapshot(app, project.directory);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.attributionError).toContain('attribution state: task record malformed');
    expect(chatNode(snapshot.body, CHILD_SESSION).task_id).toBeUndefined();
    expect(snapshot.body.tasks.tasks[0].node_id).toBeUndefined();

    const attribution = await fetchAttribution(app, project.directory);
    expect(attribution.status).toBe(500);
    expect(attribution.body.code).toBe('ATTRIBUTION_STATE_UNAVAILABLE');
    expect(attribution.body.error).toContain('attribution state: task record malformed');
    expect(attribution.body.entries).toBeUndefined();
  });

  it('surfaces a thrown reader failure instead of looking like no attribution', async () => {
    const project = makeProject();
    writeSnapshot(project);
    const app = createApp(project, {
      readAttributionState: () => {
        throw new Error('state store exploded');
      },
    });

    const snapshot = await fetchSnapshot(app, project.directory);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.attributionError).toContain('attribution state read failed: state store exploded');

    const attribution = await fetchAttribution(app, project.directory);
    expect(attribution.status).toBe(500);
    expect(attribution.body.code).toBe('ATTRIBUTION_STATE_UNAVAILABLE');
  });

  it('reports a collision instead of guessing which record owns the child', async () => {
    const project = makeProject();
    writeSnapshot(project);
    writeTaskRecord(project);
    writeTaskRecord({ ...project, taskId: TASK_ID_B, nodeId: NODE_ID_B });
    const app = createApp(project);

    const snapshot = await fetchSnapshot(app, project.directory);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.attributionCollisions).toEqual([
      { childSessionId: CHILD_SESSION, taskIds: [TASK_ID, TASK_ID_B].sort() },
    ]);
    expect(chatNode(snapshot.body, CHILD_SESSION).task_id).toBeUndefined();
    expect(chatNode(snapshot.body, CHILD_SESSION).node_id).toBeUndefined();
    // Per-task node ids are still authoritative and are not a guess.
    expect(snapshot.body.tasks.tasks[0].node_id).toBe(NODE_ID);
    expect(snapshot.body.tasks.tasks[1].node_id).toBe(NODE_ID_B);

    const attribution = await fetchAttribution(app, project.directory);
    expect(attribution.status).toBe(200);
    expect(attribution.body.byChildSessionId[CHILD_SESSION]).toBeUndefined();
    expect(attribution.body.collisions).toEqual([
      { childSessionId: CHILD_SESSION, taskIds: [TASK_ID, TASK_ID_B].sort() },
    ]);
  });

  it('answers 404 with an explicit code when the project has no attribution state', async () => {
    const project = makeProject();
    rmSync(join(project.stateDir, 'tasks'), { recursive: true, force: true });
    writeSnapshot(project);
    const app = createApp(project);

    const attribution = await fetchAttribution(app, project.directory);
    expect(attribution.status).toBe(404);
    expect(attribution.body.code).toBe('ATTRIBUTION_STATE_ABSENT');
    expect(attribution.body.absent).toBe(true);
    // A 200 with an empty index is the failure this asserts against.
    expect(attribution.body.entries).toBeUndefined();

    // Absence is legitimate for the snapshot read: no enrichment, no error.
    const snapshot = await fetchSnapshot(app, project.directory);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.attributionError).toBeUndefined();
    expect(chatNode(snapshot.body, CHILD_SESSION).task_id).toBeUndefined();
  });

  it('answers 400 without a directory', async () => {
    const project = makeProject();
    const response = await request(createApp(project)).get('/api/run-graph/attribution');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('directory is required');
  });
});
