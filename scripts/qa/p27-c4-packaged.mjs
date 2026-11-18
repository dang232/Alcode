#!/usr/bin/env node
/**
 * Phase 2.7 - C4 (p27: bundle delivery) served-document check against the PACKAGED artifact.
 *
 * Identical harness to p26-c4-replay.mjs; only SERVICE_ENTRY differs. It drives the
 * bundle that ships inside the Electron app (app.asar.unpacked), so a PASS here is
 * the shipped runtime serving the engine-first document, not a source-tree copy.
 *
 * Starts the committed dag-pane service bundle
 * (`packages/extensions/dag-pane/service/main.js`, generated from
 * `service/server.js` + `service/handlers.js`) and drives its real
 * `GET /snapshot` route over loopback HTTP. This is not a reimplementation of
 * the reader: every decision under test is made by the shipped bundle, and the
 * assertions read the served body.
 *
 * The bundle is a program, not a module: it exports no server handle, so the
 * script runs it as a child process of this run and talks to it over the same
 * loopback transport the host uses. The route dispatch, bearer check, URL
 * parsing, and JSON framing are the shipped ones.
 *
 * Isolation:
 *   - the server binds 127.0.0.1 on an ephemeral port. The service entry (and
 *     the SDK service contract) accept a concrete 1..65535 port, exactly as the
 *     host passes one; this script reserves that port by binding port 0 itself,
 *     so it cannot collide with another service already running on the machine.
 *   - TEMP/TMP/TMPDIR point at a private state directory, so the service's
 *     `os.tmpdir()/omo-dag-snapshots` snapshot dir is private to this run.
 *   - every project document lives in a private temp project directory.
 *   - ALCODE_DATA_DIR points inside the same private tree (no shared store).
 *
 * Cases (each on its own session id):
 *   1. project engine document only            -> served: engine, tasks non-null
 *   2. temp engine document + newer synthetic  -> served: engine
 *   3. synthetic only (tasks:null, steer:*)    -> served: synthetic fallback
 *   4. malformed temp JSON + project engine    -> served: engine (not 422)
 *   5. neither document                        -> 404 OMO_DAG_SNAPSHOT_MISSING
 *   6. older engine document + newer synthetic -> served: engine (age is not authority)
 *
 * The script writes `.omo/ulw/p26/task-6-c4-replay.json`, prints a
 * {case, expectedSource, servedSource, tasksNonNull, status, pass} table, and
 * exits non-zero on any mismatch, harness failure, or cleanup failure.
 *
 * Usage:
 *   bun scripts/qa/p27-c4-packaged.mjs
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const SERVICE_ENTRY = path.join(REPO_ROOT, 'packages', 'electron', 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', '@alcode', 'web', 'server', 'built-in-extensions', 'dag-pane', 'service', 'main.js');
const ARTIFACT_PATH = path.join(REPO_ROOT, '.omo', 'ulw', 'p27', 'task-17-c4-served.json');

const READY_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RAW_BODY_LIMIT = 1500;

const ENGINE_UPDATED_AT = '2026-10-01T00:00:00.000Z';
const SYNTHETIC_UPDATED_AT = '2026-11-08T12:00:00.000Z';
const SYNTHETIC_ONLY_UPDATED_AT = '2026-11-08T12:00:00.000Z';

const TOKEN = `p26-c4-${randomUUID()}`;
const NODE_BIN = process.env.P26_C4_NODE_BIN ?? 'node';

// The same predicate the service uses. It is duplicated here on purpose: the
// script must judge the served body independently of the service's own answer,
// not ask the reader to grade itself.
const isRecord = (value) => Object(value) === value && !Array.isArray(value);
const isEngineDocument = (doc) => (
  isRecord(doc)
  && isRecord(doc.tasks)
  && Array.isArray(doc.tasks.tasks)
  && doc.tasks.tasks.length > 0
);
const asString = (value) => value?.trim?.() ?? '';
const runKeyOf = (doc) => (isRecord(doc) ? asString(doc?.dag?.runs?.[0]?.run_key) : '');
const tasksCountOf = (doc) => (isEngineDocument(doc) ? doc.tasks.tasks.length : 0);

const sourceOf = (body) => {
  const code = asString(body?.code);
  if (code === 'OMO_DAG_SNAPSHOT_MISSING') return 'none';
  if (code.length > 0) return `error:${code}`;
  if (isEngineDocument(body)) return 'engine';
  if (runKeyOf(body).startsWith('steer:')) return 'synthetic';
  return 'unknown';
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

const requestSnapshot = async (port, query) => {
  const url = `http://127.0.0.1:${port}/snapshot?${query}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  let parseError = null;
  try {
    body = JSON.parse(text);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  return { status: response.status, body, text, parseError };
};

const writeJson = (file, doc) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
};

const writeText = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
};

const setMtime = (file, iso) => {
  const date = new Date(iso);
  fs.utimesSync(file, date, date);
};

const engineDocument = (sessionId, updatedAt) => ({
  schemaVersion: 1,
  sessionId,
  updatedAt,
  dag: {
    runs: [{
      run_id: `run_${sessionId}`,
      run_key: `engine:${sessionId}`,
      name: `engine ${sessionId}`,
      status: 'running',
      counts: { pending: 0, running: 1, completed: 0 },
      nodes: [{ id: 'task-1', label: 'engine task', state: 'running' }],
      edges: [],
      waves: [{ index: 0, node_ids: ['task-1'] }],
    }],
  },
  tasks: { tasks: [{ task_id: `task_${sessionId}`, status: 'running' }] },
});

const syntheticDocument = (sessionId, updatedAt) => ({
  schemaVersion: 1,
  sessionId,
  updatedAt,
  dag: {
    runs: [{
      run_id: `run_${sessionId}`,
      run_key: `steer:${sessionId}`,
      name: `steer ${sessionId}`,
      status: 'running',
      counts: { pending: 1, running: 0, completed: 0 },
      nodes: [{ id: 'steer-1', label: 'steer', state: 'pending' }],
      edges: [],
      waves: [{ index: 0, node_ids: ['steer-1'] }],
    }],
  },
  tasks: null,
});

const buildCases = ({ snapshotDir, projectDir }) => {
  const tempPath = (sessionId) => path.join(snapshotDir, `${sessionId}.snapshot.json`);
  const projectPath = (sessionId) => path.join(projectDir, '.omo', 'dag-runs', `${sessionId}.snapshot.json`);

  return [
    {
      id: 1,
      name: 'project engine document only',
      expectedSource: 'engine',
      expectedStatus: 200,
      expectedTasksNonNull: true,
      expectedUpdatedAt: ENGINE_UPDATED_AT,
      expectedCode: null,
      expectSyntheticNewer: false,
      prepare: ({ sessionId }) => {
        const engine = projectPath(sessionId);
        writeJson(engine, engineDocument(sessionId, ENGINE_UPDATED_AT));
        setMtime(engine, ENGINE_UPDATED_AT);
        return { engine: { path: engine, scope: 'project' } };
      },
    },
    {
      id: 2,
      name: 'temp engine document + newer synthetic document',
      expectedSource: 'engine',
      expectedStatus: 200,
      expectedTasksNonNull: true,
      expectedUpdatedAt: ENGINE_UPDATED_AT,
      expectedCode: null,
      expectSyntheticNewer: true,
      prepare: ({ sessionId }) => {
        const engine = tempPath(sessionId);
        const synthetic = projectPath(sessionId);
        writeJson(engine, engineDocument(sessionId, ENGINE_UPDATED_AT));
        writeJson(synthetic, syntheticDocument(sessionId, SYNTHETIC_UPDATED_AT));
        setMtime(engine, ENGINE_UPDATED_AT);
        setMtime(synthetic, SYNTHETIC_UPDATED_AT);
        return {
          engine: { path: engine, scope: 'temp' },
          synthetic: { path: synthetic, scope: 'project' },
        };
      },
    },
    {
      id: 3,
      name: 'synthetic only (tasks:null, run_key steer:*)',
      expectedSource: 'synthetic',
      expectedStatus: 200,
      expectedTasksNonNull: false,
      expectedUpdatedAt: SYNTHETIC_ONLY_UPDATED_AT,
      expectedCode: null,
      expectSyntheticNewer: false,
      prepare: ({ sessionId }) => {
        const synthetic = tempPath(sessionId);
        writeJson(synthetic, syntheticDocument(sessionId, SYNTHETIC_ONLY_UPDATED_AT));
        setMtime(synthetic, SYNTHETIC_ONLY_UPDATED_AT);
        return { synthetic: { path: synthetic, scope: 'temp' } };
      },
    },
    {
      id: 4,
      name: 'malformed temp JSON + valid project engine document',
      expectedSource: 'engine',
      expectedStatus: 200,
      expectedTasksNonNull: true,
      expectedUpdatedAt: ENGINE_UPDATED_AT,
      expectedCode: null,
      expectSyntheticNewer: false,
      prepare: ({ sessionId }) => {
        const malformed = tempPath(sessionId);
        const engine = projectPath(sessionId);
        writeText(malformed, 'not json{');
        writeJson(engine, engineDocument(sessionId, ENGINE_UPDATED_AT));
        setMtime(engine, ENGINE_UPDATED_AT);
        return {
          engine: { path: engine, scope: 'project' },
          malformed: { path: malformed, scope: 'temp' },
        };
      },
    },
    {
      id: 5,
      name: 'neither document',
      expectedSource: 'none',
      expectedStatus: 404,
      expectedTasksNonNull: false,
      expectedUpdatedAt: null,
      expectedCode: 'OMO_DAG_SNAPSHOT_MISSING',
      expectSyntheticNewer: false,
      prepare: () => ({}),
    },
    {
      id: 6,
      name: 'older engine document + newer synthetic document',
      expectedSource: 'engine',
      expectedStatus: 200,
      expectedTasksNonNull: true,
      expectedUpdatedAt: ENGINE_UPDATED_AT,
      expectedCode: null,
      expectSyntheticNewer: true,
      prepare: ({ sessionId }) => {
        const engine = projectPath(sessionId);
        const synthetic = tempPath(sessionId);
        writeJson(engine, engineDocument(sessionId, ENGINE_UPDATED_AT));
        writeJson(synthetic, syntheticDocument(sessionId, SYNTHETIC_UPDATED_AT));
        setMtime(engine, ENGINE_UPDATED_AT);
        setMtime(synthetic, SYNTHETIC_UPDATED_AT);
        return {
          engine: { path: engine, scope: 'project' },
          synthetic: { path: synthetic, scope: 'temp' },
        };
      },
    },
  ];
};

const mtimeOf = (fixtures, key) => {
  const entry = fixtures[key];
  if (entry === undefined) return null;
  try {
    return fs.statSync(entry.path).mtime.toISOString();
  } catch {
    return null;
  }
};

const trimRawBody = (text) => ({
  text: text.length > RAW_BODY_LIMIT ? `${text.slice(0, RAW_BODY_LIMIT)}...` : text,
  truncated: text.length > RAW_BODY_LIMIT,
  bytes: Buffer.byteLength(text, 'utf8'),
});

const toDirectoryQuery = (directory) => directory.split(path.sep).join('/');

const padCell = (value, width) => String(value).padEnd(width);

const printTable = (table) => {
  const headers = ['case', 'expectedSource', 'servedSource', 'tasksNonNull', 'status', 'pass'];
  const widths = headers.map((header) => Math.max(
    header.length,
    ...table.map((row) => String(row[header]).length),
  ));
  const line = (cells) => cells.map((cell, index) => padCell(cell, widths[index])).join(' | ');
  console.log('');
  console.log(line(headers));
  console.log(widths.map((width) => '-'.repeat(width)).join('-+-'));
  for (const row of table) console.log(line(headers.map((header) => row[header])));
};

const writeArtifact = (artifact) => {
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
};

const main = async () => {
  if (!fs.existsSync(SERVICE_ENTRY)) {
    console.error(`FAIL service entry missing: ${SERVICE_ENTRY}`);
    process.exit(2);
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p26-c4-replay-'));
  const stateDir = path.join(root, 'state');
  const projectDir = path.join(root, 'project');
  const snapshotDir = path.join(stateDir, 'omo-dag-snapshots');
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  const port = await reserveEphemeralPort();
  const directoryQuery = toDirectoryQuery(projectDir);
  const cases = buildCases({ snapshotDir, projectDir });

  let child = null;
  let serviceLog = { stdout: '', stderr: '' };
  let harnessError = null;
  const results = [];

  try {
    const service = startService(port, stateDir);
    const started = await service.ready;
    child = started.child;
    serviceLog = service.log;
    console.log(`service: ${path.relative(REPO_ROOT, SERVICE_ENTRY).split(path.sep).join('/')} on 127.0.0.1:${port}`);

    for (const spec of cases) {
      const sessionId = `ses_p26c4_case${spec.id}_${randomUUID().slice(0, 8)}`;
      const fixtures = spec.prepare({ sessionId });
      const query = new URLSearchParams({ sessionId, directory: directoryQuery }).toString();
      const response = await requestSnapshot(port, query);

      const servedSource = sourceOf(response.body);
      const tasksNonNull = isEngineDocument(response.body);
      const updatedAt = asString(response.body?.updatedAt) || null;
      const runKey = runKeyOf(response.body) || null;
      const code = asString(response.body?.code) || null;
      const engineMtime = mtimeOf(fixtures, 'engine');
      const syntheticMtime = mtimeOf(fixtures, 'synthetic');
      const syntheticNewer = spec.expectSyntheticNewer
        ? (engineMtime !== null && syntheticMtime !== null && new Date(syntheticMtime) > new Date(engineMtime))
        : null;

      const checks = {
        status: response.status === spec.expectedStatus,
        source: servedSource === spec.expectedSource,
        tasksNonNull: tasksNonNull === spec.expectedTasksNonNull,
        updatedAt: updatedAt === spec.expectedUpdatedAt,
        code: code === spec.expectedCode,
        syntheticNewer: spec.expectSyntheticNewer ? syntheticNewer === true : null,
      };
      const pass = Object.values(checks).every((value) => value === null || value === true);
      const rawBody = trimRawBody(response.text);

      results.push({
        case: spec.id,
        name: spec.name,
        session_id: sessionId,
        expected_source: spec.expectedSource,
        served_source: servedSource,
        tasks_non_null: tasksNonNull,
        tasks_count: tasksCountOf(response.body),
        run_key: runKey,
        served_updated_at: updatedAt,
        expected_updated_at: spec.expectedUpdatedAt,
        code,
        status: response.status,
        pass,
        checks,
        synthetic_newer_than_engine: syntheticNewer,
        fixtures: {
          engine: fixtures.engine ?? null,
          synthetic: fixtures.synthetic ?? null,
          malformed: fixtures.malformed ?? null,
          engine_mtime: engineMtime,
          synthetic_mtime: syntheticMtime,
        },
        raw_body: rawBody.text,
        raw_body_truncated: rawBody.truncated,
        raw_body_bytes: rawBody.bytes,
        parse_error: response.parseError,
      });

      console.log(
        `case ${spec.id}: ${spec.name}\n`
        + `  system  source=${servedSource} status=${response.status} tasksNonNull=${tasksNonNull} runKey=${runKey ?? '(none)'} updatedAt=${updatedAt ?? '(none)'}${code === null ? '' : ` code=${code}`}\n`
        + `  verdict ${pass ? 'PASS' : 'FAIL'} checks=${JSON.stringify(checks)}`,
      );
    }
  } catch (error) {
    harnessError = error instanceof Error ? error.message : String(error);
    console.error(`harness error: ${harnessError}`);
  }

  let serverClosed = child === null;
  if (child !== null) {
    try {
      child.kill();
      await awaitExit(child, EXIT_TIMEOUT_MS);
      serverClosed = true;
    } catch (error) {
      serverClosed = false;
      console.error(`cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const portCheck = await checkPortFree(port);
  fs.rmSync(root, { recursive: true, force: true });
  const stateDirRemoved = !fs.existsSync(stateDir);
  const projectDirRemoved = !fs.existsSync(projectDir);
  const tempDirPresent = fs.existsSync(root);

  const cleanup = {
    server_closed: serverClosed,
    port,
    port_free: portCheck.free,
    port_check_code: portCheck.code,
    state_dir: stateDir,
    state_dir_removed: stateDirRemoved,
    project_dir: projectDir,
    project_dir_removed: projectDirRemoved,
    temp_dir_present: tempDirPresent,
  };
  const cleanupOk = serverClosed
    && portCheck.free
    && stateDirRemoved
    && projectDirRemoved
    && tempDirPresent === false;

  const table = results.map((result) => ({
    case: result.case,
    expectedSource: result.expected_source,
    servedSource: result.served_source,
    tasksNonNull: result.tasks_non_null,
    status: result.status,
    pass: result.pass,
  }));
  const passCount = table.filter((row) => row.pass).length;
  const allPass = harnessError === null && results.length === cases.length && passCount === cases.length;

  if (table.length > 0) printTable(table);
  console.log('');
  console.log(`${passCount}/${cases.length} HTTP cases pass${allPass ? '' : ' (mismatch or harness failure)'}`);
  console.log(
    `CLEANUP server ${serverClosed ? 'closed' : 'NOT closed'}, port ${port} ${portCheck.free ? 'free' : `NOT free (${portCheck.code})`}, `
    + `dirs ${stateDirRemoved && projectDirRemoved ? 'gone' : 'PRESENT'} (TEMP_DIR_PRESENT=${tempDirPresent})`,
  );

  const artifact = {
    task: 'p26-task-6-c4-replay',
    generated_at: new Date().toISOString(),
    purpose: 'C4 authority over the real HTTP surface of the committed dag-pane service bundle',
    transport: 'real loopback HTTP (127.0.0.1) GET /snapshot',
    service_entry: path.relative(REPO_ROOT, SERVICE_ENTRY).split(path.sep).join('/'),
    service_entry_bytes: fs.existsSync(SERVICE_ENTRY) ? fs.statSync(SERVICE_ENTRY).size : null,
    service_runtime: NODE_BIN,
    service_stdout: serviceLog.stdout,
    service_stderr: serviceLog.stderr,
    auth: 'bearer token required; value not recorded',
    port,
    port_origin: 'reserved by binding 127.0.0.1:0 (ephemeral), then handed to ALCODE_SERVICE_PORT, exactly as the host does; the service entry and SDK contract accept a concrete 1..65535 port',
    state_dir: stateDir,
    snapshot_dir: snapshotDir,
    project_dir: projectDir,
    environment: {
      TEMP: 'state_dir',
      TMP: 'state_dir',
      TMPDIR: 'state_dir',
      ALCODE_DATA_DIR: 'state_dir/alcode-data',
    },
    cases: results,
    table,
    pass_count: passCount,
    total: cases.length,
    adversarial: {
      misleading_success_output: {
        guard: 'cases 1, 2, 4 and 6 require served_source "engine", tasks_non_null true, and the engine document\'s updatedAt; case 3 proves a steer body classifies as "synthetic", so a 200 carrying the synthetic document in case 1 or 6 fails',
        observed: results.filter((result) => [1, 2, 4, 6].includes(result.case)).map((result) => ({
          case: result.case,
          served_source: result.served_source,
          tasks_non_null: result.tasks_non_null,
          served_updated_at: result.served_updated_at,
          pass: result.pass,
        })),
      },
      stale_state: {
        guard: 'case 6 stages an engine document with mtime 2026-10-01 and a synthetic document with mtime 2026-11-08; the served body must be the engine document with the older updatedAt',
        observed: results.filter((result) => result.case === 6).map((result) => ({
          case: result.case,
          synthetic_newer_than_engine: result.synthetic_newer_than_engine,
          served_source: result.served_source,
          served_updated_at: result.served_updated_at,
          pass: result.pass,
        })),
      },
      malformed_input: {
        guard: 'case 4 stages `not json{` at the temp snapshot path beside a valid project engine document; the route must answer 200 with the engine document, never 422',
        observed: results.filter((result) => result.case === 4).map((result) => ({
          case: result.case,
          status: result.status,
          served_source: result.served_source,
          pass: result.pass,
        })),
      },
    },
    cleanup,
    harness_error: harnessError,
    verdict: allPass && cleanupOk ? 'PASS' : 'FAIL',
  };
  writeArtifact(artifact);
  console.log(`artifact: ${path.relative(REPO_ROOT, ARTIFACT_PATH).split(path.sep).join('/')}`);

  if (!allPass || !cleanupOk) process.exit(1);
};

await main();
