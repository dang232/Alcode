#!/usr/bin/env node
/**
 * Phase 2.8 - C8 (DAG/UI/API truthfulness) served-document check against the PACKAGED artifact.
 *
 * Same harness pattern as `p27-c4-packaged.mjs`: it starts the dag-pane service that ships inside
 * the Electron app (`app.asar.unpacked`), drives its real `GET /snapshot`, `POST /snapshot`, and
 * `GET /history` routes over loopback HTTP, and asserts the served body. Nothing here reimplements
 * the service: every projection, corroboration, and persistence decision under test is made by the
 * packaged bundle.
 *
 * What is real:
 *   - the service entry is the packaged `app.asar.unpacked/.../dag-pane/service/main.js`;
 *   - task records are created and persisted by the engine's own `createTaskRecord` +
 *     `createTaskRecordStore` (the Alwork source-of-truth engine), never hand-written JSON;
 *   - the `omo.task.updated` / `omo.dag.updated` payloads are built by the adapter's real
 *     `taskSnapshot` / `dagUpdatedPayload` projections (the host `omo-senpi` adapter);
 *   - the shipped service corroborates posted identities and verification claims against those
 *     real persisted records.
 *
 * Fixtures are synthetic by construction and labelled `fixture: true` in the artifact: this driver
 * proves the projection/transport truth of a verified, unverified, blocked, and in-flight parent.
 * It never claims that a verification check ran, and it never writes a verification record.
 *
 * Cases (each on its own session id):
 *   1. verified parent + child node        -> parent `verified`, child work is a separate node
 *   2. blocked parent + child "all passed" -> parent `blocked`, never `verified`, child output is
 *                                             not the parent's claim
 *   3. completed parent with no claim      -> `unverified` (fail closed), never `verified`
 *   4. running parent                      -> no verification claim at all before the host finishes
 *   5. forged POST claiming `verified`     -> dropped; the blocked record cannot be served verified
 *   6. service restart                     -> identical served body + identical record hashes
 *   7. duplicate POST of one completion    -> one live doc, one history record, no duplicate rows
 *   8. fabricated task identity/edge       -> false ids dropped; posted edges are served unchanged
 *
 * Usage (Bun is required for the TypeScript engine/adapter imports):
 *   bun scripts/qa/p28-c8-packaged.mjs
 *
 * Exit codes: 0 all cases pass; 1 a case failed; 2 harness/blocked.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const HOST_REPO_ROOT = 'I:/migration/oh-my-openAlcore';
const SERVICE_ENTRY = path.join(
  REPO_ROOT,
  'packages',
  'electron',
  'dist',
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
  'node_modules',
  '@alcode',
  'web',
  'server',
  'built-in-extensions',
  'dag-pane',
  'service',
  'main.js',
);
const STAGED_ENTRY = path.join(REPO_ROOT, 'packages', 'web', 'server', 'built-in-extensions', 'dag-pane', 'service', 'main.js');
const SOURCE_ENTRY = path.join(REPO_ROOT, 'packages', 'extensions', 'dag-pane', 'service', 'main.js');
const REGEN_SCRIPT = path.join(REPO_ROOT, 'packages', 'extensions', 'dag-pane', 'service', 'main.regen.mjs');
const BUILTIN_BUILD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-builtin-extensions.mjs');
const ADAPTER_SOURCE = path.join(HOST_REPO_ROOT, 'packages', 'omo-senpi', 'src', 'components', 'task', 'task-rpc-codec.ts');
const ADAPTER_BUNDLE = path.join(HOST_REPO_ROOT, 'packages', 'omo-senpi', 'plugin', 'extensions', 'omo-task.js');
const ARTIFACT_PATH = path.join(REPO_ROOT, '.omo', 'evidence', 'p28', 'c8-dag-ui.json');
const SERVED_LOG_PATH = path.join(REPO_ROOT, '.omo', 'evidence', 'p28', 'c8-dag-ui.served.log');

const READY_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN = `p28-c8-${randomUUID()}`;
const NODE_BIN = process.env.P28_C8_NODE_BIN ?? 'node';
const PARENT_SESSION = 'ses_p28_c8_parent';
const RUN_ID = 'dag_p28_c8_run';
const OWNER_FINGERPRINT = createHash('sha256').update(`${RUN_ID}:work`).digest('hex');

const isRecord = (value) => Object(value) === value && !Array.isArray(value);
const asString = (value) => (String(value) === value ? value : '');
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, doc) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
};
const writeText = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
};

const reserveEphemeralPort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    const port = address?.port;
    probe.close(() => {
      if (Number.isInteger(port) && port > 0) resolve(port);
      else reject(new Error(`the OS did not assign an ephemeral port: ${JSON.stringify(address)}`));
    });
  });
});

const checkPortFree = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', (error) => resolve({ free: false, code: error?.code ?? 'UNKNOWN' }));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve({ free: true, code: null })));
});

const awaitExit = (child, timeoutMs) => new Promise((resolve, reject) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolve();
    return;
  }
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error(`service did not exit within ${timeoutMs} ms`));
  }, timeoutMs);
  child.once('exit', () => {
    clearTimeout(timer);
    resolve();
  });
});

const startService = (port, stateDir) => {
  const env = {
    ...process.env,
    ALCODE_SERVICE_PORT: String(port),
    ALCODE_SERVICE_TOKEN: TOKEN,
    TEMP: stateDir,
    TMP: stateDir,
    TMPDIR: stateDir,
    ALCODE_DATA_DIR: path.join(stateDir, 'alcode-data'),
  };
  const child = spawn(NODE_BIN, [SERVICE_ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = { stdout: '', stderr: '' };
  const readyMarker = `ready on 127.0.0.1:${port}`;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timer = setTimeout(() => {
    rejectReady(new Error(
      `service did not become ready within ${READY_TIMEOUT_MS} ms\nstdout:\n${log.stdout}\nstderr:\n${log.stderr}`,
    ));
  }, READY_TIMEOUT_MS);
  child.stdout.on('data', (chunk) => {
    log.stdout += chunk.toString();
    if (log.stdout.includes(readyMarker)) {
      clearTimeout(timer);
      resolveReady({ child, log });
    }
  });
  child.stderr.on('data', (chunk) => {
    log.stderr += chunk.toString();
  });
  child.once('error', (error) => {
    clearTimeout(timer);
    rejectReady(new Error(`cannot spawn ${NODE_BIN}: ${error.message}`));
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    rejectReady(new Error(
      `service exited before ready with code ${code}\nstdout:\n${log.stdout}\nstderr:\n${log.stderr}`,
    ));
  });
  return { ready, log };
};

const request = async (port, method, route, { query, body } = {}) => {
  const search = query === undefined ? '' : `?${new URLSearchParams(query).toString()}`;
  const response = await fetch(`http://127.0.0.1:${port}${route}${search}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  return { status: response.status, body: parsed, text, parseError };
};

const toDirectoryQuery = (directory) => directory.split(path.sep).join('/');

const stopService = async (child) => {
  if (child === null) return { serverClosed: true, error: null };
  try {
    child.kill();
    await awaitExit(child, EXIT_TIMEOUT_MS);
    return { serverClosed: true, error: null };
  } catch (error) {
    return { serverClosed: false, error: error instanceof Error ? error.message : String(error) };
  }
};

const main = async () => {
  for (const required of [SERVICE_ENTRY, STAGED_ENTRY, SOURCE_ENTRY, REGEN_SCRIPT, BUILTIN_BUILD_SCRIPT]) {
    if (!fs.existsSync(required)) {
      console.error(`BLOCKED missing required file: ${required}`);
      process.exit(2);
    }
  }

  const { taskSnapshot } = await import(
    pathToFileURL(path.join(HOST_REPO_ROOT, 'packages', 'omo-senpi', 'src', 'components', 'task', 'task-rpc-codec.ts')).href
  );
  const { dagUpdatedPayload } = await import(
    pathToFileURL(path.join(HOST_REPO_ROOT, 'packages', 'omo-senpi', 'src', 'components', 'task', 'dag-snapshot-payload.ts')).href
  );
  const { createTaskRecord, createTaskRecordStore } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'packages', 'omo-engine', 'senpi-task', 'src', 'index.ts')).href
  );
  const { buildBuiltInExtensions } = await import(pathToFileURL(BUILTIN_BUILD_SCRIPT).href);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p28-c8-packaged-'));
  const stateDir = path.join(root, 'state');
  const projectDir = path.join(root, 'project');
  const snapshotDir = path.join(stateDir, 'omo-dag-snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  const directoryQuery = toDirectoryQuery(projectDir);
  const inProjectStateDir = path.join(projectDir, '.omo', 'senpi-task');
  const store = createTaskRecordStore({ project_dir: projectDir, task: { state_dir: inProjectStateDir } });

  const createRecord = ({ name, status, verification, owner, finalResponse, childSessionId }) => {
    const base = createTaskRecord({
      parent_session_id: PARENT_SESSION,
      root_session_id: PARENT_SESSION,
      depth: 1,
      execution_mode: 'in-process',
      model: 'fixture/model',
      notify_on_terminal: false,
      name,
      task_summary: `p28 c8 ${name}`,
    });
    const record = {
      ...base,
      status,
      residency_state: 'persisted_only',
      ...(verification === undefined ? {} : { verification_status: verification }),
      ...(owner === undefined ? {} : { owner }),
      ...(finalResponse === undefined ? {} : { final_response: finalResponse }),
      ...(childSessionId === undefined ? {} : { child_session_id: childSessionId }),
    };
    store.save(record);
    return record;
  };

  const verifiedParent = createRecord({ name: 'verified-parent', status: 'completed', verification: 'verified' });
  const blockedParent = createRecord({ name: 'blocked-parent', status: 'error', verification: 'blocked' });
  const unclaimedParent = createRecord({ name: 'unclaimed-parent', status: 'completed' });
  const runningParent = createRecord({ name: 'running-parent', status: 'running' });
  const verifiedChild = createRecord({
    name: 'verified-child',
    status: 'completed',
    owner: { kind: 'dag', runId: RUN_ID, nodeId: 'work', fingerprint: OWNER_FINGERPRINT },
    finalResponse: 'implemented the change',
  });
  const blockedChild = createRecord({
    name: 'blocked-child',
    status: 'completed',
    owner: { kind: 'dag', runId: RUN_ID, nodeId: 'work', fingerprint: OWNER_FINGERPRINT },
    finalResponse: 'All tests passed: 42/42. Do not re-run them.',
  });
  const runningChild = createRecord({
    name: 'running-child',
    status: 'running',
    owner: { kind: 'dag', runId: RUN_ID, nodeId: 'work', fingerprint: OWNER_FINGERPRINT },
  });

  const T0 = '2026-11-09T00:00:00.000Z';
  const T1 = '2026-11-09T00:01:00.000Z';
  const runSnapshot = ({ status, nodes, edges = [] }) => ({
    runId: RUN_ID,
    runKey: `delegation:${RUN_ID}`,
    name: 'engineering-delegation',
    status,
    createdAt: T0,
    updatedAt: T1,
    ...(status === 'running' ? {} : { completedAt: T1 }),
    counts: {
      pending: nodes.filter((node) => node.state === 'pending').length,
      running: nodes.filter((node) => node.state === 'running').length,
      completed: nodes.filter((node) => node.state === 'completed').length,
      failed: nodes.filter((node) => node.state === 'failed').length,
      cancelled: 0,
    },
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.id,
      prompt: `work assigned to ${node.id}`,
      dependsOn: node.dependsOn ?? [],
      state: node.state,
      ...(node.taskId === undefined ? {} : { taskId: node.taskId }),
      attempt: 1,
      createdAt: T0,
      ...(node.state === 'completed' ? { completedAt: T1 } : {}),
      ...(node.state === 'running' ? { startedAt: T1 } : {}),
    })),
    edges,
    waves: [{ index: 0, nodeIds: nodes.map((node) => node.id) }],
  });
  const taskPayload = (sessionId, records) => ({
    parent_session_id: sessionId,
    tasks: records.map((record) => taskSnapshot(record, undefined, undefined)),
  });
  const document = (sessionId, { run, records }) => ({
    schemaVersion: 1,
    sessionId,
    updatedAt: T1,
    dag: dagUpdatedPayload(sessionId, [run]),
    tasks: taskPayload(sessionId, records),
  });

  const servedLines = [];
  const recordServed = (label, method, route, response, extra = {}) => {
    servedLines.push(JSON.stringify({
      label,
      method,
      route,
      status: response.status,
      ...extra,
      body: response.body,
      parse_error: response.parseError,
    }));
  };
  const tempPath = (sessionId) => path.join(snapshotDir, `${sessionId}.snapshot.json`);
  const projectPath = (sessionId) => path.join(projectDir, '.omo', 'dag-runs', `${sessionId}.snapshot.json`);

  const assertions = [];
  const check = (requirement, name, expected, observed) => {
    const pass = JSON.stringify(expected) === JSON.stringify(observed);
    assertions.push({ requirement, name, expected, observed, pass });
    return pass;
  };
  const checkTruthy = (requirement, name, observed) => {
    const pass = observed === true;
    assertions.push({ requirement, name, expected: true, observed, pass });
    return pass;
  };

  let child = null;
  let serviceLog = { stdout: '', stderr: '' };
  let harnessError = null;
  let port = await reserveEphemeralPort();
  const initialPort = port;
  let restartPort = null;
  const cases = [];

  try {
    const service = startService(port, stateDir);
    const started = await service.ready;
    child = started.child;
    serviceLog = service.log;
    console.log(`service: ${path.relative(REPO_ROOT, SERVICE_ENTRY).split(path.sep).join('/')} on 127.0.0.1:${port}`);

    // Case 1: verified parent + child work are distinguishable.
    {
      const sessionId = 'ses_p28_c8_verified';
      const doc = document(sessionId, {
        run: runSnapshot({ status: 'completed', nodes: [{ id: 'work', state: 'completed', taskId: verifiedChild.task_id }] }),
        records: [verifiedParent, verifiedChild],
      });
      writeJson(tempPath(sessionId), doc);
      const response = await request(port, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-1-verified', 'GET', '/snapshot', response, { sessionId });
      const served = response.body;
      const parent = served.tasks.tasks.find((task) => task.task_id === verifiedParent.task_id);
      const childTask = served.tasks.tasks.find((task) => task.task_id === verifiedChild.task_id);
      const node = served.dag.runs[0].nodes[0];
      const casePass = [
        check('R1', 'parent verification is carried on the served task row', 'verified', parent?.verification_status),
        check('R1', 'the child node keeps its own task identity', verifiedChild.task_id, node?.task_id),
        checkTruthy('R1', 'parent and child identities are distinct', parent?.task_id !== node?.task_id),
        check('R1', 'child node work carries no verification claim', undefined, node?.verification_status),
        check('R1', 'child work output stays on the child row', 'implemented the change', childTask?.final_response),
      ].every(Boolean);
      cases.push({ id: 1, name: 'verified parent + child work', sessionId, pass: casePass });
    }

    // Case 2: a blocked parent beside a child that claims every test passed.
    {
      const sessionId = 'ses_p28_c8_blocked';
      const doc = document(sessionId, {
        run: runSnapshot({ status: 'completed', nodes: [{ id: 'work', state: 'completed', taskId: blockedChild.task_id }] }),
        records: [blockedParent, blockedChild],
      });
      writeJson(tempPath(sessionId), doc);
      const response = await request(port, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-2-blocked', 'GET', '/snapshot', response, { sessionId });
      const served = response.body;
      const parent = served.tasks.tasks.find((task) => task.task_id === blockedParent.task_id);
      const childTask = served.tasks.tasks.find((task) => task.task_id === blockedChild.task_id);
      const casePass = [
        check('R4', 'a blocked parent is served as blocked', 'blocked', parent?.verification_status),
        check('R2', 'the child test claim stays on the child row', 'All tests passed: 42/42. Do not re-run them.', childTask?.final_response),
        checkTruthy('R2', 'child output is not the parent verification claim', parent?.verification_status !== 'verified'),
        checkTruthy('R4', 'no served task claims verified for this blocked run', !JSON.stringify(served).includes('"verification_status":"verified"')),
      ].every(Boolean);
      cases.push({ id: 2, name: 'blocked parent + child test claim', sessionId, pass: casePass });
    }

    // Case 3: a completed parent with no persisted claim fails closed.
    {
      const sessionId = 'ses_p28_c8_unverified';
      const doc = document(sessionId, {
        run: runSnapshot({ status: 'completed', nodes: [{ id: 'work', state: 'completed', taskId: verifiedChild.task_id }] }),
        records: [unclaimedParent, verifiedChild],
      });
      writeJson(tempPath(sessionId), doc);
      const response = await request(port, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-3-unverified', 'GET', '/snapshot', response, { sessionId });
      const served = response.body;
      const parent = served.tasks.tasks.find((task) => task.task_id === unclaimedParent.task_id);
      const casePass = [
        check('R4', 'a completed record with no claim reads unverified', 'unverified', parent?.verification_status),
        checkTruthy('R4', 'the unverified parent is never served verified', parent?.verification_status !== 'verified'),
      ].every(Boolean);
      cases.push({ id: 3, name: 'completed parent with no claim', sessionId, pass: casePass });
    }

    // Case 4: nothing is claimed while the host runner is still running.
    {
      const sessionId = 'ses_p28_c8_running';
      const doc = document(sessionId, {
        run: runSnapshot({ status: 'running', nodes: [{ id: 'work', state: 'running', taskId: runningChild.task_id }] }),
        records: [runningParent, runningChild],
      });
      writeJson(tempPath(sessionId), doc);
      const response = await request(port, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-4-running', 'GET', '/snapshot', response, { sessionId });
      const served = response.body;
      const parent = served.tasks.tasks.find((task) => task.task_id === runningParent.task_id);
      const casePass = [
        check('R3', 'a running parent carries no verification claim', undefined, parent?.verification_status),
        checkTruthy('R3', 'the served document contains no verification claim at all', !JSON.stringify(served).includes('"verification_status"')),
        check('R3', 'the run is still running', 'running', served.dag.runs[0].status),
      ].every(Boolean);
      cases.push({ id: 4, name: 'running parent before the host finishes', sessionId, pass: casePass });
    }

    // Case 5: a posted verified claim for a blocked record is dropped by the shipped service.
    {
      const sessionId = 'ses_p28_c8_forged';
      const doc = document(sessionId, {
        run: runSnapshot({
          status: 'completed',
          nodes: [{ id: 'work', state: 'completed', taskId: blockedChild.task_id }],
        }),
        records: [blockedParent, blockedChild],
      });
      const forgedNode = { ...doc.dag.runs[0].nodes[0], node_id: 'work', verification_status: 'verified' };
      const forgedParent = { ...doc.tasks.tasks.find((task) => task.task_id === blockedParent.task_id), verification_status: 'verified' };
      const forgedDoc = {
        ...doc,
        dag: { ...doc.dag, runs: [{ ...doc.dag.runs[0], nodes: [forgedNode] }] },
        tasks: { ...doc.tasks, tasks: [forgedParent, doc.tasks.tasks.find((task) => task.task_id === blockedChild.task_id)] },
      };
      const post = await request(port, 'POST', '/snapshot', {
        body: { directory: directoryQuery, conversationId: sessionId, snapshot: forgedDoc },
      });
      recordServed('case-5-forged-post', 'POST', '/snapshot', post, { sessionId });
      const read = await request(port, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-5-forged-read', 'GET', '/snapshot', read, { sessionId });
      const dropped = Array.isArray(post.body?.attributionDropped) ? post.body.attributionDropped : [];
      const droppedFields = dropped.map((entry) => entry.field);
      const served = read.body;
      const servedParent = served.tasks.tasks.find((task) => task.task_id === blockedParent.task_id);
      const casePass = [
        check('R4', 'the service reports the forged claim as dropped', ['verification_status', 'verification_status'], droppedFields),
        checkTruthy('R4', 'the blocked task row is not served verified', servedParent?.verification_status !== 'verified'),
        checkTruthy('R4', 'the served document never says verified', !JSON.stringify(served).includes('"verification_status":"verified"')),
      ].every(Boolean);
      cases.push({ id: 5, name: 'forged verified claim for a blocked record', sessionId, pass: casePass });
    }

    // Case 6: restart reconstructs the same served body and the same authoritative records.
    {
      const sessionId = 'ses_p28_c8_verified';
      const before = await request(port, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-6-before-restart', 'GET', '/snapshot', before, { sessionId });
      const tasksDir = path.join(inProjectStateDir, 'tasks');
      const recordHashes = () => Object.fromEntries(
        fs.readdirSync(tasksDir).filter((name) => name.endsWith('.json')).sort()
          .map((name) => [name, sha256(path.join(tasksDir, name))]),
      );
      const hashesBefore = recordHashes();
      const stopped = await stopService(child);
      child = null;
      if (!stopped.serverClosed) throw new Error(`restart: ${stopped.error}`);
      restartPort = await reserveEphemeralPort();
      port = restartPort;
      const restarted = startService(restartPort, stateDir);
      const startedAgain = await restarted.ready;
      child = startedAgain.child;
      serviceLog = restarted.log;
      const after = await request(restartPort, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-6-after-restart', 'GET', '/snapshot', after, { sessionId });
      const hashesAfter = recordHashes();
      const casePass = [
        checkTruthy('R5', 'the restarted service serves the identical document', JSON.stringify(before.body) === JSON.stringify(after.body)),
        checkTruthy('R5', 'the authoritative task records are unchanged by the restart', JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter)),
        check('R5', 'the restarted service still reports the parent verdict', 'verified', after.body?.tasks?.tasks?.find((task) => task.task_id === verifiedParent.task_id)?.verification_status),
      ].every(Boolean);
      cases.push({ id: 6, name: 'restart reconstruction', sessionId, pass: casePass });
    }

    // Case 7: one completion cannot become two records.
    {
      const sessionId = 'ses_p28_c8_duplicate';
      const doc = document(sessionId, {
        run: runSnapshot({ status: 'completed', nodes: [{ id: 'work', state: 'completed', taskId: verifiedChild.task_id }] }),
        records: [verifiedParent, verifiedChild],
      });
      const post = { directory: directoryQuery, conversationId: sessionId, snapshot: doc };
      const first = await request(port, 'POST', '/snapshot', { body: post });
      recordServed('case-7-duplicate-first', 'POST', '/snapshot', first, { sessionId });
      const second = await request(port, 'POST', '/snapshot', { body: post });
      recordServed('case-7-duplicate-second', 'POST', '/snapshot', second, { sessionId });
      const history = await request(port, 'GET', '/history', { query: { directory: directoryQuery } });
      recordServed('case-7-history', 'GET', '/history', history, { sessionId });
      const read = await request(port, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-7-read', 'GET', '/snapshot', read, { sessionId });
      const entries = Array.isArray(history.body?.entries) ? history.body.entries.filter((entry) => entry.sessionId === sessionId) : [];
      const served = read.body;
      const parentRows = Array.isArray(served?.tasks?.tasks)
        ? served.tasks.tasks.filter((task) => task.task_id === verifiedParent.task_id).length
        : -1;
      const casePass = [
        check('R6', 'the first completion is written', true, first.body?.written === true),
        check('R6', 'the duplicate is not written again', false, second.body?.written === true),
        check('R6', 'the duplicate is reported as unchanged', 'unchanged', second.body?.reason),
        check('R6', 'the duplicate adds no history record', 1, entries.length),
        check('R6', 'the served document keeps exactly one parent row', 1, parentRows),
        check('R6', 'the served document keeps exactly one run', 1, served?.dag?.runs?.length),
        checkTruthy('R6', 'no synthetic steer document shadows the engine document', !fs.existsSync(tempPath(sessionId))),
      ].every(Boolean);
      cases.push({ id: 7, name: 'duplicate completion', sessionId, pass: casePass });
    }

    // Case 8: fabricated identities are dropped and no edge is invented.
    {
      const sessionId = 'ses_p28_c8_identities';
      const fabricatedTaskId = `st_p28_c8_unrecorded_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const postedEdges = [{ from: 'work', to: 'ghost' }];
      const doc = document(sessionId, {
        run: runSnapshot({
          status: 'completed',
          nodes: [
            { id: 'work', state: 'completed', taskId: verifiedChild.task_id },
            { id: 'ghost', state: 'completed' },
          ],
          edges: postedEdges,
        }),
        records: [verifiedParent, verifiedChild],
      });
      const ghostNode = { ...doc.dag.runs[0].nodes[1], task_id: fabricatedTaskId, node_id: 'ghost-node' };
      const ghostTask = { task_id: fabricatedTaskId, node_id: 'ghost-node', status: 'completed', name: 'ghost' };
      const posted = {
        ...doc,
        dag: { ...doc.dag, runs: [{ ...doc.dag.runs[0], nodes: [doc.dag.runs[0].nodes[0], ghostNode] }] },
        tasks: { ...doc.tasks, tasks: [...doc.tasks.tasks, ghostTask] },
      };
      const post = await request(port, 'POST', '/snapshot', {
        body: { directory: directoryQuery, conversationId: sessionId, snapshot: posted },
      });
      recordServed('case-8-identities-post', 'POST', '/snapshot', post, { sessionId, fabricatedTaskId });
      const read = await request(port, 'GET', '/snapshot', { query: { sessionId, directory: directoryQuery } });
      recordServed('case-8-identities-read', 'GET', '/snapshot', read, { sessionId, fabricatedTaskId });
      const served = read.body;
      const servedNodeIds = served.dag.runs[0].nodes.map((node) => node.id);
      const ghost = served.dag.runs[0].nodes.find((node) => node.id === 'ghost');
      const realNode = served.dag.runs[0].nodes.find((node) => node.id === 'work');
      const ghostTaskRow = served.tasks.tasks.find((task) => task.name === 'ghost');
      const casePass = [
        checkTruthy('R7', 'the fabricated task id appears nowhere in the served document', !JSON.stringify(served).includes(fabricatedTaskId)),
        check('R7', 'the fabricated node loses its task identity', undefined, ghost?.task_id),
        check('R7', 'the fabricated node loses its node identity', undefined, ghost?.node_id),
        check('R7', 'the real node keeps its corroborated task identity', verifiedChild.task_id, realNode?.task_id),
        check('R7', 'the posted edges are served unchanged', postedEdges, served.dag.runs[0].edges),
        check('R7', 'no node id is invented', ['work', 'ghost'], servedNodeIds),
        check('R7', 'the fabricated task row loses its task identity', undefined, ghostTaskRow?.task_id),
      ].every(Boolean);
      cases.push({ id: 8, name: 'fabricated identity and edges', sessionId, pass: casePass });
    }
  } catch (error) {
    harnessError = error instanceof Error ? error.message : String(error);
    console.error(`harness error: ${harnessError}`);
  }

  const stopped = await stopService(child);
  child = null;
  const portCheck = await checkPortFree(restartPort ?? port);
  const primaryPortFree = await checkPortFree(initialPort);

  // Packaged-artifact proof: source bundle == fresh regen, staged == fresh built-in build,
  // packaged == staged.
  let buildProof = null;
  try {
    const regenOut = path.join(root, 'regen-main.js');
    const regen = await new Promise((resolve) => {
      const proc = spawn('bun', [REGEN_SCRIPT], {
        cwd: path.dirname(REGEN_SCRIPT),
        env: { ...process.env, DAG_PANE_SERVICE_OUTFILE: regenOut },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      proc.stdout.on('data', (chunk) => { output += chunk.toString(); });
      proc.stderr.on('data', (chunk) => { output += chunk.toString(); });
      proc.once('exit', (code) => resolve({ code, output }));
    });
    const freshBuiltinDir = path.join(root, 'builtins');
    await buildBuiltInExtensions({ outDir: freshBuiltinDir });
    const freshBuiltin = path.join(freshBuiltinDir, 'dag-pane', 'service', 'main.js');
    const sourceHash = sha256(SOURCE_ENTRY);
    const regenHash = fs.existsSync(regenOut) ? sha256(regenOut) : null;
    const stagedHash = sha256(STAGED_ENTRY);
    const freshBuiltinHash = fs.existsSync(freshBuiltin) ? sha256(freshBuiltin) : null;
    const packagedHash = sha256(SERVICE_ENTRY);
    const adapterBundleText = fs.existsSync(ADAPTER_BUNDLE) ? fs.readFileSync(ADAPTER_BUNDLE, 'utf8') : '';
    const adapterProjectionMarker = 'verification_status??("completed"===e.status?"unverified"';
    buildProof = {
      regen_exit_code: regen.code,
      source_bundle_sha256: sourceHash,
      fresh_regen_sha256: regenHash,
      source_equals_fresh_regen: sourceHash === regenHash,
      staged_bundle_sha256: stagedHash,
      fresh_builtin_sha256: freshBuiltinHash,
      staged_equals_fresh_builtin: stagedHash === freshBuiltinHash,
      packaged_bundle_sha256: packagedHash,
      packaged_equals_staged: packagedHash === stagedHash,
      adapter_source_sha256: fs.existsSync(ADAPTER_SOURCE) ? sha256(ADAPTER_SOURCE) : null,
      adapter_bundle: path.relative(HOST_REPO_ROOT, ADAPTER_BUNDLE).split(path.sep).join('/'),
      adapter_bundle_sha256: fs.existsSync(ADAPTER_BUNDLE) ? sha256(ADAPTER_BUNDLE) : null,
      adapter_bundle_carries_task_snapshot_projection: adapterBundleText.includes(adapterProjectionMarker),
      regen_output: regen.output.trim(),
    };
  } catch (error) {
    buildProof = { error: error instanceof Error ? error.message : String(error) };
  }

  const requirements = [
    ['R1', 'child work and parent verification are distinguishable in the DAG/served state'],
    ['R2', 'child-reported test output is not authoritative parent evidence'],
    ['R3', 'the DAG claims no verification before the host runner completes'],
    ['R4', 'a blocked or unverified outcome never renders as successful verification'],
    ['R5', 'refresh/restart reconstructs the same authoritative state'],
    ['R6', 'no duplicate synthetic completion records'],
    ['R7', 'no false task identities or invented edges'],
  ].map(([id, statement]) => {
    const related = assertions.filter((entry) => entry.requirement === id);
    return {
      id,
      statement,
      assertions: related,
      pass: related.length > 0 && related.every((entry) => entry.pass),
    };
  });

  const allCasesPass = cases.length === 8 && cases.every((entry) => entry.pass);
  const allRequirementsPass = requirements.every((entry) => entry.pass);
  const buildPass = buildProof !== null
    && buildProof.source_equals_fresh_regen === true
    && buildProof.staged_equals_fresh_builtin === true
    && buildProof.packaged_equals_staged === true
    && buildProof.adapter_bundle_carries_task_snapshot_projection === true;
  const cleanup = {
    server_closed: stopped.serverClosed,
    cleanup_error: stopped.error,
    primary_port: initialPort,
    primary_port_free: primaryPortFree.free,
    restart_port: restartPort,
    restart_port_free: restartPort === null ? null : portCheck.free,
    temp_root_removed: false,
  };

  writeText(SERVED_LOG_PATH, `${servedLines.join('\n')}\n`);
  const artifact = {
    task: 'p28-c8-dag-ui',
    generated_at: new Date().toISOString(),
    purpose: 'C8 served-document truthfulness for the parent-owned verification lifecycle, driven against the packaged dag-pane service',
    fixture: true,
    fixture_note: 'Task records are synthetic fixture records created by the engine factory; no verification check was run by this harness and no verification record was written by it.',
    transport: 'real loopback HTTP (127.0.0.1) GET/POST /snapshot and GET /history',
    service_entry: path.relative(REPO_ROOT, SERVICE_ENTRY).split(path.sep).join('/'),
    service_entry_bytes: fs.statSync(SERVICE_ENTRY).size,
    service_runtime: NODE_BIN,
    service_stdout: serviceLog.stdout,
    service_stderr: serviceLog.stderr,
    auth: 'bearer token required; value not recorded',
    project_dir: projectDir,
    snapshot_dir: snapshotDir,
    state_dir: inProjectStateDir,
    task_records: {
      verified_parent: verifiedParent.task_id,
      blocked_parent: blockedParent.task_id,
      unclaimed_parent: unclaimedParent.task_id,
      running_parent: runningParent.task_id,
      verified_child: verifiedChild.task_id,
      blocked_child: blockedChild.task_id,
      running_child: runningChild.task_id,
      dag_run_id: RUN_ID,
    },
    build_proof: buildProof,
    cases,
    assertions,
    requirements,
    served_log: path.relative(REPO_ROOT, SERVED_LOG_PATH).split(path.sep).join('/'),
    cleanup,
    harness_error: harnessError,
    verdict: allCasesPass && allRequirementsPass && buildPass && stopped.serverClosed && harnessError === null
      ? 'PASS'
      : 'FAIL',
  };

  fs.rmSync(root, { recursive: true, force: true });
  cleanup.temp_root_removed = !fs.existsSync(root);
  writeJson(ARTIFACT_PATH, artifact);

  for (const entry of cases) {
    console.log(`case ${entry.id}: ${entry.name} -> ${entry.pass ? 'PASS' : 'FAIL'}`);
  }
  for (const entry of requirements) {
    const failed = entry.assertions.filter((assertion) => !assertion.pass);
    console.log(`  ${entry.id} ${entry.pass ? 'PASS' : 'FAIL'} (${entry.assertions.length} assertions)${failed.length === 0 ? '' : ` first failure: ${failed[0].name}`}`);
  }
  console.log(`build proof: source=${buildProof?.source_equals_fresh_regen} staged=${buildProof?.staged_equals_fresh_builtin} packaged=${buildProof?.packaged_equals_staged}`);
  console.log(`artifact: ${path.relative(REPO_ROOT, ARTIFACT_PATH).split(path.sep).join('/')}`);
  console.log(`served log: ${path.relative(REPO_ROOT, SERVED_LOG_PATH).split(path.sep).join('/')}`);
  console.log(`RESULT: ${artifact.verdict} cases=${cases.filter((entry) => entry.pass).length}/${cases.length} requirements=${requirements.filter((entry) => entry.pass).length}/${requirements.length}`);

  if (artifact.verdict !== 'PASS') process.exit(1);
};

await main();
