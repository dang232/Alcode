// Service handler tests for the alcode-builtin-dag-pane guest (project-ide todo 13).
// bun:test, no servers: `handleRequest` is called directly with a scripted
// bridge. The live steer/cancel path spawns a REAL sleeper child (the
// platform node binary) and kills it through the REAL bridge `cancelRun`,
// so the test proves steer starts a process and cancel terminates it.
import { describe, expect, test, afterEach } from 'bun:test';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cancelRun } from '../../../web/server/lib/opencode/omo-bridge-runtime.js';
import { createRecord, renderRecordFile } from '../../../omo-engine/memory-core/src/project-knowledge/record.ts';
import { evaluatePromotion } from '../../../omo-engine/memory-core/src/project-knowledge/validator.ts';
import { createDagServiceHandlers } from './handlers.js';
import { parseManifest } from '../../../sdk/src/parse.ts';
import { parseSnapshotDoc } from '../panel/dag-view.ts';

const scratchDirs = [];
const liveChildren = [];

const makeSnapshotDir = () => {
  const dir = nodeFs.mkdtempSync(join(tmpdir(), 'dag-svc-'));
  scratchDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const child of liveChildren.splice(0)) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited: the cancel under test terminated it.
    }
  }
  for (const dir of scratchDirs.splice(0)) {
    nodeFs.rmSync(dir, { recursive: true, force: true });
  }
});

const absentBridge = () => ({
  probe: async () => ({ available: false, compatible: false, code: 'OMO_ENGINE_ABSENT' }),
  invoke: () => {
    throw Object.assign(new Error('OmO engine not found.'), { code: 'OMO_ENGINE_ABSENT' });
  },
});

// A stub bridge whose invoke starts a real sleeper process and whose cancel
// is the real provisional kill, so steer/cancel act on a live session.
const sleeperBridge = (probeResult) => ({
  probe: async () => probeResult,
  invoke: ({ message, sessionId }) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore', windowsHide: true });
    liveChildren.push(child);
    const wait = () => new Promise((resolve) => {
      child.on('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    return {
      entry: 'stub-sleeper',
      argv: ['run', message, '--session-id', sessionId, '--json'],
      child,
      writer: null,
      wait,
      cancel: (reason) => cancelRun({ child }, reason, { cancelGraceMs: 100 }),
    };
  },
});

const handlersWith = (snapshotDir, createBridge) => (
  createDagServiceHandlers({ fs: nodeFs, snapshotDir, createBridge })
);

// A stub bridge whose child exits at once, so steer completion settles
// without a sleeper: exit 0 records completed, exit 1 records failed.
const quickBridge = (exitCode) => ({
  probe: async () => ({ available: true, compatible: true, code: 'OMO_PROBE_OK' }),
  invoke: ({ message, sessionId }) => {
    const child = spawn(process.execPath, ['-e', exitCode === 0 ? '' : 'process.exit(1);'], { stdio: 'ignore', windowsHide: true });
    const wait = () => new Promise((resolve) => {
      child.on('close', (code, signal) => resolve({ exitCode: code, signal, result: null, sessionId }));
    });
    return {
      entry: 'stub-quick',
      argv: ['run', message, '--session-id', sessionId, '--json'],
      child,
      writer: null,
      wait,
      cancel: (reason) => cancelRun({ child }, reason, { cancelGraceMs: 100 }),
    };
  },
});

const waitForFile = async (path, timeoutMs = 5000) => {
  const start = Date.now();
  for (;;) {
    try {
      return nodeFs.readFileSync(path, 'utf8');
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${path}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
};

describe('dag guest manifest compat', () => {
  test('a legacy openchamber-block manifest still validates as this guest', () => {
    const legacy = parseManifest({
      openchamber: {
        apiVersion: 1,
        engines: { openchamber: '>=1.22.0' },
        contributes: {
          panel: {
            id: 'openchamber-builtin-dag-pane',
            name: 'DAG runs',
            icon: 'icon.svg',
            entry: 'panel/index.html',
          },
          service: { entry: 'service/main.js', runtime: 'host' },
          attach: false,
        },
      },
    });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.manifest.contributes.panel.id).toBe('alcode-builtin-dag-pane');
      expect(legacy.manifest.engines).toEqual({ alcode: '>=1.22.0' });
    }
  });

  test('the shipped manifest ships only the alcode block', () => {
    const shipped = JSON.parse(nodeFs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(shipped.openchamber).toBeUndefined();
    expect(shipped.alcode.contributes.panel.id).toBe('alcode-builtin-dag-pane');
    expect(shipped.alcode.engines).toEqual({ alcode: '>=0.0.1' });
    const parsed = parseManifest(shipped);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.contributes.panel.id).toBe('alcode-builtin-dag-pane');
    }
  });
});

describe('dag service handlers', () => {
  test('health answers ready', async () => {
    const { handleRequest } = handlersWith(makeSnapshotDir(), absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/health' });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ ok: true, service: 'alcode-builtin-dag-pane' });
  });

  test('status passes the probe through and lists snapshot sessions', async () => {
    const dir = makeSnapshotDir();
    nodeFs.writeFileSync(join(dir, 'ses_live01.snapshot.json'), '{"schemaVersion":1}', 'utf8');
    const { handleRequest } = handlersWith(dir, () => sleeperBridge({ available: true, compatible: true, code: 'OMO_PROBE_OK' }));
    const answer = await handleRequest({ method: 'GET', path: '/status' });
    expect(answer.status).toBe(200);
    expect(answer.body.probe.code).toBe('OMO_PROBE_OK');
    expect(answer.body.sessions).toEqual(['ses_live01']);
  });

  test('snapshot reads the bridge file, missing and malformed degrade by code', async () => {
    const dir = makeSnapshotDir();
    const doc = {
      schemaVersion: 1, sessionId: 'ses_live01', updatedAt: '2026-10-08T08:01:00.000Z', dag: null, tasks: null,
    };
    nodeFs.writeFileSync(join(dir, 'ses_live01.snapshot.json'), JSON.stringify(doc), 'utf8');
    nodeFs.writeFileSync(join(dir, 'ses_bad.snapshot.json'), 'not json{', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const read = await handleRequest({ method: 'GET', path: '/snapshot', query: { sessionId: 'ses_live01' } });
    expect(read).toEqual({ status: 200, body: doc });
    const missing = await handleRequest({ method: 'GET', path: '/snapshot', query: { sessionId: 'ses_nope' } });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('OMO_DAG_SNAPSHOT_MISSING');
    const malformed = await handleRequest({ method: 'GET', path: '/snapshot', query: { sessionId: 'ses_bad' } });
    expect(malformed.status).toBe(422);
    expect(malformed.body.code).toBe('DAG_SNAPSHOT_MALFORMED');
    const noSession = await handleRequest({ method: 'GET', path: '/snapshot', query: {} });
    expect(noSession.status).toBe(400);
    expect(noSession.body.code).toBe('OMO_DAG_SESSION_REQUIRED');
  });

  test('steer validates input before spawning', async () => {
    const { handleRequest } = handlersWith(makeSnapshotDir(), absentBridge);
    const emptyMessage = await handleRequest({ method: 'POST', path: '/steer', body: { message: '  ', sessionId: 'ses_live01' } });
    expect(emptyMessage.status).toBe(400);
    const noSession = await handleRequest({ method: 'POST', path: '/steer', body: { message: 'Go' } });
    expect(noSession.status).toBe(400);
    expect(noSession.body.code).toBe('OMO_DAG_SESSION_REQUIRED');
  });

  test('steer forwards model and agent, unsigned provider answers 409', async () => {
    const seen = [];
    const { handleRequest } = handlersWith(makeSnapshotDir(), () => ({
      invoke: (args) => {
        seen.push(args);
        if (args.model === 'openai/gpt-5') {
          const error = new Error('Model "openai/gpt-5" needs provider "openai" — sign it in first. No run was started.');
          error.code = 'OMO_PROVIDER_NOT_SIGNED_IN';
          throw error;
        }
        return { entry: 'e', argv: ['run'], writer: null, wait: async () => ({}), cancel: () => ({}) };
      },
    }));
    const refused = await handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Go', sessionId: 'ses_m1', model: 'openai/gpt-5', agent: 'atlas' },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('OMO_PROVIDER_NOT_SIGNED_IN');
    expect(seen[0]).toMatchObject({ model: 'openai/gpt-5', agent: 'atlas' });
    const passed = await handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Go', sessionId: 'ses_m2', model: 'alcore/al-1-2' },
    });
    expect(passed.status).toBe(200);
    expect(seen[1]).toMatchObject({ model: 'alcore/al-1-2', agent: undefined });
  });

  test('steer without an engine answers 503 with the degraded message', async () => {
    const { handleRequest } = handlersWith(makeSnapshotDir(), absentBridge);
    const answer = await handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Go', sessionId: 'ses_live01' },
    });
    expect(answer.status).toBe(503);
    expect(answer.body.code).toBe('OMO_ENGINE_ABSENT');
    expect(answer.body.message.length).toBeGreaterThan(0);
  });

  test('steer starts a live session and cancel terminates it', async () => {
    const { handleRequest, live } = handlersWith(
      makeSnapshotDir(),
      () => sleeperBridge({ available: true, compatible: true, code: 'OMO_PROBE_OK' }),
    );
    const steered = await handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Keep going', sessionId: 'ses_live01' },
    });
    expect(steered.status).toBe(200);
    expect(steered.body.sessionId).toBe('ses_live01');
    expect(steered.body.argv).toContain('--session-id');
    expect(live.has('ses_live01')).toBe(true);

    const cancelled = await handleRequest({
      method: 'POST', path: '/cancel', body: { sessionId: 'ses_live01', reason: 'test cancel' },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.ok).toBe(true);
    expect(cancelled.body.receipt.provisional).toBe(true);
    expect(cancelled.body.receipt.reason).toBe('test cancel');
    expect(live.has('ses_live01')).toBe(false);

    const again = await handleRequest({ method: 'POST', path: '/cancel', body: { sessionId: 'ses_live01' } });
    expect(again.status).toBe(404);
    expect(again.body.code).toBe('OMO_DAG_NO_RUN');
  });

  test('status lists live steers so the pane can row running engine runs', async () => {
    const { handleRequest, live } = handlersWith(
      makeSnapshotDir(),
      () => sleeperBridge({ available: true, compatible: true, code: 'OMO_PROBE_OK' }),
    );
    const steered = await handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Keep going', sessionId: 'ses_live02' },
    });
    expect(steered.status).toBe(200);
    const status = await handleRequest({ method: 'GET', path: '/status' });
    expect(status.status).toBe(200);
    const listed = status.body.liveRuns.find((entry) => entry.sessionId === 'ses_live02');
    expect(listed).toBeDefined();
    expect(new Date(listed.startedAt).toISOString()).toBe(listed.startedAt);
    expect(live.has('ses_live02')).toBe(true);
    await handleRequest({ method: 'POST', path: '/cancel', body: { sessionId: 'ses_live02' } });
    const after = await handleRequest({ method: 'GET', path: '/status' });
    expect(after.body.liveRuns.find((entry) => entry.sessionId === 'ses_live02')).toBeUndefined();
  });

  test('loop rows a live steer as pending without a route report', async () => {
    const { handleRequest } = handlersWith(
      makeSnapshotDir(),
      () => sleeperBridge({ available: true, compatible: true, code: 'OMO_PROBE_OK' }),
    );
    const steered = await handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Analyze the repo', sessionId: 'ses_live03' },
    });
    expect(steered.status).toBe(200);
    const looped = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_live03' } });
    expect(looped.status).toBe(200);
    expect(looped.body.dag.runs).toHaveLength(1);
    expect(looped.body.dag.runs[0].status).toBe('pending');
    expect(looped.body.dag.runs[0].nodes[0].label).toContain('Analyze the repo');
    await handleRequest({ method: 'POST', path: '/cancel', body: { sessionId: 'ses_live03' } });
  });

  test('steer completion records a completed snapshot, failure records failed', async () => {
    const dir = makeSnapshotDir();
    const okHandlers = handlersWith(dir, () => quickBridge(0));
    const steered = await okHandlers.handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Quick ok', sessionId: 'ses_done01' },
    });
    expect(steered.status).toBe(200);
    const completed = JSON.parse(await waitForFile(join(dir, 'ses_done01.snapshot.json')));
    expect(completed.dag.runs[0].status).toBe('completed');
    expect(completed.dag.runs[0].nodes[0].state).toBe('completed');
    expect(okHandlers.live.has('ses_done01')).toBe(false);

    const failHandlers = handlersWith(dir, () => quickBridge(1));
    const failed = await failHandlers.handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Quick fail', sessionId: 'ses_fail01' },
    });
    expect(failed.status).toBe(200);
    const recorded = JSON.parse(await waitForFile(join(dir, 'ses_fail01.snapshot.json')));
    expect(recorded.dag.runs[0].status).toBe('failed');
    expect(recorded.dag.runs[0].nodes[0].state).toBe('failed');
  });

  test('cancel writes no completion snapshot for the terminated run', async () => {
    const dir = makeSnapshotDir();
    const { handleRequest } = handlersWith(
      dir,
      () => sleeperBridge({ available: true, compatible: true, code: 'OMO_PROBE_OK' }),
    );
    const steered = await handleRequest({
      method: 'POST', path: '/steer', body: { message: 'Keep going', sessionId: 'ses_cancel01' },
    });
    expect(steered.status).toBe(200);
    await handleRequest({ method: 'POST', path: '/cancel', body: { sessionId: 'ses_cancel01' } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(nodeFs.existsSync(join(dir, 'ses_cancel01.snapshot.json'))).toBe(false);
  });

  test('steer with OMO_NATIVE_RUN steers through the bun worker, not the wrapper', async () => {
    const engineRoot = nodeFs.mkdtempSync(join(tmpdir(), 'fake-engine-'));
    scratchDirs.push(engineRoot);
    const barrelDir = join(engineRoot, 'packages', 'omo-opencode', 'src', 'cli', 'run');
    nodeFs.mkdirSync(barrelDir, { recursive: true });
    nodeFs.writeFileSync(join(barrelDir, 'index.ts'),
      'export async function run(options: Record<string, unknown>): Promise<number> {\n' +
      '  console.log(JSON.stringify({ sessionId: \'ses_native01\', success: true, summary: \'native ok\' }));\n' +
      '  return 0;\n' +
      '}\n');
    nodeFs.mkdirSync(join(engineRoot, 'bin'), { recursive: true });
    const wrapperFile = join(engineRoot, 'bin', 'oh-my-opencode.js');
    nodeFs.writeFileSync(wrapperFile, '// fixture wrapper entry (existence only)\n');
    const prev = {
      OMO_NATIVE_RUN: process.env.OMO_NATIVE_RUN,
      OMO_ENGINE_ROOT: process.env.OMO_ENGINE_ROOT,
      OMO_WRAPPER_PATH: process.env.OMO_WRAPPER_PATH,
    };
    process.env.OMO_NATIVE_RUN = '1';
    process.env.OMO_ENGINE_ROOT = engineRoot;
    process.env.OMO_WRAPPER_PATH = wrapperFile;
    try {
      const { handleRequest, live } = createDagServiceHandlers({ fs: nodeFs, snapshotDir: makeSnapshotDir() });
      const steered = await handleRequest({
        method: 'POST', path: '/steer', body: { message: 'Native go', sessionId: 'ses_native01' },
      });
      expect(steered.status).toBe(200);
      expect(steered.body.native).toBe(true);
      expect(live.has('ses_native01')).toBe(true);
      const cancelled = await handleRequest({
        method: 'POST', path: '/cancel', body: { sessionId: 'ses_native01', reason: 'test done' },
      });
      expect(cancelled.status).toBe(200);
      expect(live.has('ses_native01')).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('debug route stores the last route decision and rejects unknown ones', async () => {
    const { handleRequest } = handlersWith(makeSnapshotDir(), absentBridge);
    const stored = await handleRequest({
      method: 'POST', path: '/debug/route',
      body: { decision: 'captured-to-/ulw', sample: 'ulw test hello', command: 'ulw', arguments: 'test hello', sessionId: 'ses_live01' },
    });
    expect(stored.status).toBe(200);
    expect(stored.body.route).toMatchObject({
      decision: 'captured-to-/ulw', sample: 'ulw test hello', command: 'ulw', arguments: 'test hello', sessionId: 'ses_live01',
    });
    expect(typeof stored.body.route.at).toBe('string');
    const bad = await handleRequest({ method: 'POST', path: '/debug/route', body: { decision: 'teleport' } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('OMO_DAG_ROUTE_INVALID');
  });

  test('debug aggregates hook, loop, snapshot, and probe evidence for a healthy flow', async () => {
    const dir = makeSnapshotDir();
    nodeFs.writeFileSync(join(dir, 'ses_live01.snapshot.json'), JSON.stringify({
      schemaVersion: 1, sessionId: 'ses_live01', updatedAt: '2026-10-11T00:00:00.000Z', dag: null, tasks: null,
    }), 'utf8');
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-dbg-repo-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_live01');
    nodeFs.mkdirSync(loop, { recursive: true });
    nodeFs.writeFileSync(join(loop, 'plan.json'), '{"title":"t"}', 'utf8');
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), '{"seq":1,"event":"started"}\n{"seq":2,"event":"goal_started"}\n', 'utf8');
    const { handleRequest } = handlersWith(dir, () => sleeperBridge({ available: true, compatible: true, code: 'OMO_PROBE_OK' }));
    await handleRequest({
      method: 'POST', path: '/debug/route',
      body: { decision: 'captured-to-/ulw', sample: 'ulw test hello', command: 'ulw', arguments: 'test hello', sessionId: 'ses_live01' },
    });
    const answer = await handleRequest({ method: 'GET', path: '/debug', query: { sessionId: 'ses_live01', directory: repo } });
    expect(answer.status).toBe(200);
    expect(answer.body.route.decision).toBe('captured-to-/ulw');
    expect(answer.body.hook).toMatchObject({ pattern: '(?:ultrawork|ulw)', hit: true, sample: 'ulw test hello' });
    expect(answer.body.loop).toMatchObject({ plan: true, ledger: true, events: 2 });
    expect(answer.body.snapshot).toMatchObject({ exists: true, sessionMatch: true });
    expect(typeof answer.body.snapshot.updatedAt).toBe('string');
    expect(answer.body.probe).toMatchObject({ code: 'OMO_PROBE_OK', available: true, compatible: true });
    expect(answer.body.sessions).toEqual(['ses_live01']);
  });

  test('debug shows exactly which stage fails: no run yet and probe unavailable', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-dbg-empty-'));
    scratchDirs.push(repo);
    const { handleRequest } = handlersWith(dir, absentBridge);
    await handleRequest({
      method: 'POST', path: '/debug/route',
      body: { decision: 'plain-prompt', sample: 'hello world', sessionId: 'ses_live01' },
    });
    const answer = await handleRequest({ method: 'GET', path: '/debug', query: { sessionId: 'ses_live01', directory: repo } });
    expect(answer.status).toBe(200);
    expect(answer.body.route).toMatchObject({ decision: 'plain-prompt', command: null });
    expect(answer.body.hook.hit).toBe(false);
    expect(answer.body.loop).toMatchObject({ plan: false, goals: false, ledger: false, events: 0 });
    expect(answer.body.snapshot).toMatchObject({ exists: false, sessionMatch: false });
    expect(answer.body.probe).toMatchObject({ code: 'OMO_ENGINE_ABSENT', available: false });
    expect(answer.body.sessions).toEqual([]);
  });

  test('debug rejects bad input and never throws on malformed state', async () => {
    const dir = makeSnapshotDir();
    nodeFs.writeFileSync(join(dir, 'ses_bad.snapshot.json'), 'not json{', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const noSession = await handleRequest({ method: 'GET', path: '/debug', query: {} });
    expect(noSession.status).toBe(400);
    expect(noSession.body.code).toBe('OMO_DAG_SESSION_REQUIRED');
    const escape = await handleRequest({ method: 'GET', path: '/debug', query: { sessionId: '../x', directory: tmpdir() } });
    expect(escape.status).toBe(400);
    expect(escape.body.code).toBe('OMO_SESSION_ID_INVALID');
    const malformed = await handleRequest({ method: 'GET', path: '/debug', query: { sessionId: 'ses_bad' } });
    expect(malformed.status).toBe(200);
    expect(malformed.body.snapshot).toMatchObject({ exists: true, sessionMatch: false });
    const noDir = await handleRequest({ method: 'GET', path: '/debug', query: { sessionId: 'ses_bad' } });
    expect(noDir.status).toBe(200);
    expect(noDir.body.loop).toMatchObject({ dir: null, events: 0 });
  });

  test('status lists loop runs from route reports without touching sessions', async () => {
    const { handleRequest } = handlersWith(makeSnapshotDir(), absentBridge);
    await handleRequest({
      method: 'POST', path: '/debug/route',
      body: { decision: 'captured-to-/ulw', sample: 'ulw ship it', command: 'ulw', arguments: 'ship it', sessionId: 'ses_ulw01' },
    });
    await handleRequest({
      method: 'POST', path: '/debug/route',
      body: { decision: 'plain-prompt', sample: 'hello', sessionId: 'ses_plain' },
    });
    const answer = await handleRequest({ method: 'GET', path: '/status' });
    expect(answer.status).toBe(200);
    expect(answer.body.sessions).toEqual([]);
    expect(answer.body.loopRuns).toEqual([{
      sessionId: 'ses_ulw01',
      source: 'route',
      decision: 'captured-to-/ulw',
      plan: false,
      goals: false,
      ledger: false,
      events: 0,
      updatedAt: expect.any(String),
    }]);
  });

  test('status merges loop-state sessions from the directory scan', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-scan-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_loop01');
    nodeFs.mkdirSync(loop, { recursive: true });
    nodeFs.writeFileSync(join(loop, 'goals.json'), '{}', 'utf8');
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), '{"seq":1,"event":"started"}\n', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/status', query: { directory: repo } });
    expect(answer.status).toBe(200);
    expect(answer.body.sessions).toEqual([]);
    expect(answer.body.loopRuns).toEqual([{
      sessionId: 'ses_loop01',
      source: 'loop',
      decision: null,
      plan: false,
      goals: true,
      ledger: true,
      events: 1,
      updatedAt: expect.any(String),
    }]);
    const noDir = await handleRequest({ method: 'GET', path: '/status' });
    expect(noDir.body.loopRuns).toEqual([]);
  });

  test('loop projects state into the snapshot shape and degrades by code', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-proj-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_loop01');
    nodeFs.mkdirSync(loop, { recursive: true });
    nodeFs.writeFileSync(join(loop, 'plan.json'), JSON.stringify({
      title: 'Ship it', status: 'running', goal: 'Ship it', totalSteps: 3, completedSteps: 1,
    }), 'utf8');
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), '{"seq":1,"event":"started"}\n{"seq":2,"event":"advanced"}\n', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const projected = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_loop01', directory: repo } });
    expect(projected.status).toBe(200);
    expect(projected.body.schemaVersion).toBe(1);
    expect(projected.body.sessionId).toBe('ses_loop01');
    const run = projected.body.dag.runs[0];
    expect(run.run_id).toBe('ses_loop01');
    expect(run.run_key).toBe('loop:ses_loop01');
    expect(run.name).toBe('Ship it');
    expect(run.status).toBe('running');
    expect(run.nodes.map((node) => node.label)).toEqual(['started', 'advanced']);
    expect(run.waves).toEqual([{ index: 0, node_ids: ['step-1', 'step-2'] }]);
    // The projection must survive the panel's own snapshot parser, or the
    // pane renders an error card instead of the run row.
    const parsed = parseSnapshotDoc(projected.body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.view.runs).toHaveLength(1);
      expect(parsed.view.runs[0].runId).toBe('ses_loop01');
      expect(parsed.view.runs[0].status).toBe('running');
    }
    nodeFs.appendFileSync(join(loop, 'ledger.jsonl'), '{"seq":3,"event":"completed"}\n');
    const done = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_loop01', directory: repo } });
    expect(done.body.dag.runs[0].status).toBe('completed');
    const missing = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_nope', directory: repo } });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('OMO_DAG_NO_LOOP');
    const noSession = await handleRequest({ method: 'GET', path: '/loop', query: { directory: repo } });
    expect(noSession.status).toBe(400);
    expect(noSession.body.code).toBe('OMO_DAG_SESSION_REQUIRED');
    const escape = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: '../x', directory: repo } });
    expect(escape.status).toBe(400);
    expect(escape.body.code).toBe('OMO_SESSION_ID_INVALID');
  });

  test('loop projects dispatched workers under their goal', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-workers-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_workers');
    nodeFs.mkdirSync(loop, { recursive: true });
    nodeFs.writeFileSync(join(loop, 'goals.json'), JSON.stringify({
      brief: 'Analyze repo',
      goals: [
        { id: 'G001-analyze-repo', title: 'analyze repo', objective: 'analyze repo', status: 'complete', attempt: 1 },
        { id: 'G002-docs', title: 'docs pass', objective: 'docs pass', status: 'in_progress', attempt: 1 },
      ],
    }), 'utf8');
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), [
      JSON.stringify({ at: '2026-10-20T20:41:07.620Z', kind: 'goal_dispatched', goalId: 'G001-analyze-repo', status: 'in_progress', message: 'Dispatched as Analyze architecture stack: attempt 1' }),
      JSON.stringify({ at: '2026-10-20T20:42:01.000Z', kind: 'child_completed', goalId: 'G001-analyze-repo', status: 'complete', message: 'Child st_arch (Analyze architecture stack) result: evidence/arch.md' }),
      JSON.stringify({ at: '2026-10-20T20:42:02.000Z', kind: 'goal_dispatched', goalId: 'G001-analyze-repo', status: 'in_progress', message: 'Dispatched as Analyze DB config schemas: attempt 1' }),
      JSON.stringify({ at: '2026-10-20T20:43:05.350Z', kind: 'child_failed', goalId: 'G001-analyze-repo', status: 'failed', message: 'Child st_db (Analyze DB config schemas) failed: timeout' }),
      JSON.stringify({ at: '2026-10-20T20:44:00.000Z', kind: 'goal_dispatched', goalId: 'G002-docs', status: 'in_progress', message: 'Dispatched: attempt 1' }),
      JSON.stringify({ at: '2026-10-20T20:44:01.000Z', kind: 'goal_started', goalId: 'G002-docs', status: 'in_progress', message: 'noise, not a worker record' }),
      'not json at all',
    ].join('\n') + '\n', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const projected = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_workers', directory: repo } });
    expect(projected.status).toBe(200);
    const run = projected.body.dag.runs[0];
    const byId = Object.fromEntries(run.nodes.map((node) => [node.id, node]));
    // Two settled workers under G001 plus one running worker under G002.
    expect(byId['worker:G001-analyze-repo:1']).toMatchObject({
      label: 'Analyze architecture stack', state: 'completed', depends_on: ['G001-analyze-repo'],
    });
    expect(byId['worker:G001-analyze-repo:1'].prompt).toContain('evidence/arch.md');
    expect(byId['worker:G001-analyze-repo:2']).toMatchObject({
      label: 'Analyze DB config schemas', state: 'failed', depends_on: ['G001-analyze-repo'],
    });
    expect(byId['worker:G002-docs:1']).toMatchObject({
      label: 'Worker 1', state: 'running', depends_on: ['G002-docs'],
    });
    // Workers fan into synthesis through their goal; goals without workers
    // keep the direct edge.
    expect(run.edges).toContainEqual({ from: 'G001-analyze-repo', to: 'worker:G001-analyze-repo:1' });
    expect(run.edges).toContainEqual({ from: 'worker:G001-analyze-repo:1', to: 'synthesis' });
    expect(run.edges).not.toContainEqual({ from: 'G001-analyze-repo', to: 'synthesis' });
    expect(run.edges).toContainEqual({ from: 'worker:G002-docs:1', to: 'synthesis' });
    expect(run.waves[1].node_ids).toEqual(expect.arrayContaining(['worker:G001-analyze-repo:1', 'worker:G002-docs:1']));
    const synthesis = byId.synthesis;
    expect(synthesis.depends_on).toEqual(expect.arrayContaining(['worker:G001-analyze-repo:1', 'worker:G001-analyze-repo:2', 'worker:G002-docs:1']));
    const parsed = parseSnapshotDoc(projected.body);
    expect(parsed.ok).toBe(true);
  });

  test('loop rows a route-only send as pending only while it is live', async () => {
    const liveBridge = () => ({
      probe: async () => ({ available: true, compatible: true, code: 'OMO_PROBE_OK' }),
      invoke: ({ message, sessionId }) => ({
        entry: 'stub-live',
        argv: ['run', message, '--session-id', sessionId, '--json'],
        child: null,
        writer: null,
        wait: () => new Promise(() => {}),
        cancel: () => ({}),
      }),
    });
    const { handleRequest } = handlersWith(makeSnapshotDir(), liveBridge);
    await handleRequest({
      method: 'POST', path: '/debug/route',
      body: { decision: 'captured-to-/ulw', sample: 'ulw fresh goal', command: 'ulw', arguments: 'fresh goal', sessionId: 'ses_fresh' },
    });
    const stale = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_fresh' } });
    expect(stale.status).toBe(404);
    expect(stale.body.code).toBe('OMO_DAG_NO_LOOP');
    const steered = await handleRequest({
      method: 'POST', path: '/steer', body: { message: 'fresh goal', sessionId: 'ses_fresh' },
    });
    expect(steered.status).toBe(200);
    const pending = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_fresh' } });
    expect(pending.status).toBe(200);
    expect(pending.body.schemaVersion).toBe(1);
    expect(pending.body.dag.runs[0].status).toBe('pending');
    expect(pending.body.dag.runs[0].counts).toEqual({ pending: 1, running: 0, completed: 0 });
    const cancelled = await handleRequest({
      method: 'POST', path: '/cancel', body: { sessionId: 'ses_fresh', reason: 'test cleanup' },
    });
    expect(cancelled.status).toBe(200);
    const unknown = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_never' } });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('OMO_DAG_NO_LOOP');
  });

  test('loop reports failed when ledger events fail, never completed', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-failed-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_broken');
    nodeFs.mkdirSync(loop, { recursive: true });
    const lines = ['{"seq":1,"event":"started"}', '{"seq":2,"event":"failed"}'];
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), lines.join('\n') + '\n', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_broken', directory: repo } });
    expect(answer.status).toBe(200);
    expect(answer.body.dag.runs[0].status).toBe('failed');
    expect(answer.body.dag.runs[0].status).not.toBe('completed');
    expect(answer.body.dag.runs[0].nodes.map((node) => node.state)).toContain('failed');
  });

  test('loop names rows from CLI kind vocabulary, not markers', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-kinds-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_kinds');
    nodeFs.mkdirSync(loop, { recursive: true });
    const lines = ['{"at":"2026-10-13T00:00:00.000Z","kind":"plan_created"}', '{"at":"2026-10-13T00:01:00.000Z","kind":"evidence_captured"}'];
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), lines.join('\n') + '\n', 'utf8');
    nodeFs.writeFileSync(join(loop, 'goals.json'), '{"version":1}', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_kinds', directory: repo } });
    expect(answer.status).toBe(200);
    const names = answer.body.dag.runs[0].nodes.map((node) => node.label);
    expect(names).toEqual(['plan_created', 'evidence_captured']);
    expect(names.join(' ')).not.toContain('entry-');
    expect(answer.body.dag.runs[0].nodes.map((node) => node.state)).toEqual(['running', 'running']);
  });

  test('loop maps dispatch lifecycle rows to motion, never stuck pending', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-dispatch-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_dispatch');
    nodeFs.mkdirSync(loop, { recursive: true });
    const lines = ['{"at":"t","kind":"goal_dispatched","goalId":"G001"}', '{"at":"t","kind":"child_completed","goalId":"G001"}', '{"at":"t","kind":"child_failed","goalId":"G002"}'];
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), lines.join('\n') + '\n', 'utf8');
    nodeFs.writeFileSync(join(loop, 'goals.json'), '{"version":1}', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_dispatch', directory: repo } });
    expect(answer.status).toBe(200);
    expect(answer.body.dag.runs[0].nodes.map((node) => node.state)).toEqual(['running', 'completed', 'failed']);
  });

  test('loop projects real goals as parent, parallel children, and synthesis waves', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-goals-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_goals');
    nodeFs.mkdirSync(loop, { recursive: true });
    nodeFs.writeFileSync(join(loop, 'goals.json'), JSON.stringify({
      version: 1,
      brief: 'Ship it\n',
      goals: [
        { id: 'G001', title: 'arch', objective: 'survey arch', status: 'in_progress', successCriteria: [], attempt: 1, createdAt: 't', updatedAt: 't' },
        { id: 'G002', title: 'ops', objective: 'survey ops', status: 'pending', successCriteria: [], attempt: 0, createdAt: 't', updatedAt: 't' },
      ],
    }), 'utf8');
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), '{"at":"t","kind":"plan_created"}\n', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_goals', directory: repo } });
    expect(answer.status).toBe(200);
    const run = answer.body.dag.runs[0];
    expect(run.name).toBe('Ship it');
    expect(run.nodes.map((node) => node.id)).toEqual(['parent', 'G001', 'G002', 'synthesis']);
    expect(run.nodes.map((node) => node.state)).toEqual(['running', 'running', 'pending', 'running']);
    expect(run.waves.map((wave) => wave.node_ids)).toEqual([['parent'], ['G001', 'G002'], ['synthesis']]);
    expect(run.edges).toContainEqual({ from: 'parent', to: 'G001' });
    expect(run.edges).toContainEqual({ from: 'G002', to: 'synthesis' });
  });

  test('loop hides marker-only ledgers for dead sessions', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-markers-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_marked');
    nodeFs.mkdirSync(loop, { recursive: true });
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), '\nnot json{\n{"seq":3}\n', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/loop', query: { sessionId: 'ses_marked', directory: repo } });
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe('OMO_DAG_NO_LOOP');
  });

  test('history lists completed snapshots, skips malformed, hides live runs', async () => {
    const dir = makeSnapshotDir();
    const done = {
      schemaVersion: 1, sessionId: 'ses_done', updatedAt: '2026-10-13T10:00:00.000Z',
      dag: { runs: [{ run_id: 'ses_done', run_key: 'steer:ses_done', name: 'Quick ok', status: 'completed', counts: { pending: 0, running: 0, completed: 1 }, nodes: [], edges: [], waves: [] }] },
      tasks: null,
    };
    const failed = {
      schemaVersion: 1, sessionId: 'ses_fail', updatedAt: '2026-10-13T11:00:00.000Z',
      dag: { runs: [{ run_id: 'ses_fail', run_key: 'steer:ses_fail', name: 'Quick fail', status: 'failed', counts: { pending: 0, running: 0, completed: 0 }, nodes: [], edges: [], waves: [] }] },
      tasks: null,
    };
    const running = {
      schemaVersion: 1, sessionId: 'ses_live', updatedAt: '2026-10-13T12:00:00.000Z',
      dag: { runs: [{ run_id: 'ses_live', run_key: 'steer:ses_live', name: 'Running', status: 'running', counts: { pending: 0, running: 1, completed: 0 }, nodes: [], edges: [], waves: [] }] },
      tasks: null,
    };
    nodeFs.writeFileSync(join(dir, 'ses_done.snapshot.json'), JSON.stringify(done), 'utf8');
    nodeFs.writeFileSync(join(dir, 'ses_fail.snapshot.json'), JSON.stringify(failed), 'utf8');
    nodeFs.writeFileSync(join(dir, 'ses_live.snapshot.json'), JSON.stringify(running), 'utf8');
    nodeFs.writeFileSync(join(dir, 'ses_bad.snapshot.json'), 'not json{', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/history' });
    expect(answer.status).toBe(200);
    expect(answer.body.ok).toBe(true);
    expect(answer.body.skipped).toBe(1);
    expect(answer.body.entries.map((entry) => entry.sessionId).sort()).toEqual(['ses_done', 'ses_fail']);
    expect(answer.body.entries[0].status).toBe('failed');
    expect(answer.body.entries[0].label).toBe('Quick fail');
    expect(answer.body.entries.find((entry) => entry.sessionId === 'ses_done').source).toBe('snapshot');
  });

  test('history filters steer snapshots by recorded directory', async () => {
    const dir = makeSnapshotDir();
    const here = {
      schemaVersion: 1, sessionId: 'ses_here', updatedAt: '2026-10-13T10:00:00.000Z', directory: '/proj/a',
      dag: { runs: [{ run_id: 'ses_here', run_key: 'steer:ses_here', name: 'Here', status: 'completed', counts: { pending: 0, running: 0, completed: 1 }, nodes: [], edges: [], waves: [] }] },
      tasks: null,
    };
    const away = {
      schemaVersion: 1, sessionId: 'ses_away', updatedAt: '2026-10-13T10:00:00.000Z', directory: '/proj/b',
      dag: { runs: [{ run_id: 'ses_away', run_key: 'steer:ses_away', name: 'Away', status: 'completed', counts: { pending: 0, running: 0, completed: 1 }, nodes: [], edges: [], waves: [] }] },
      tasks: null,
    };
    const legacy = {
      schemaVersion: 1, sessionId: 'ses_legacy', updatedAt: '2026-10-13T10:00:00.000Z',
      dag: { runs: [{ run_id: 'ses_legacy', run_key: 'steer:ses_legacy', name: 'Legacy', status: 'completed', counts: { pending: 0, running: 0, completed: 1 }, nodes: [], edges: [], waves: [] }] },
      tasks: null,
    };
    nodeFs.writeFileSync(join(dir, 'ses_here.snapshot.json'), JSON.stringify(here), 'utf8');
    nodeFs.writeFileSync(join(dir, 'ses_away.snapshot.json'), JSON.stringify(away), 'utf8');
    nodeFs.writeFileSync(join(dir, 'ses_legacy.snapshot.json'), JSON.stringify(legacy), 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const filtered = await handleRequest({ method: 'GET', path: '/history', query: { directory: '/proj/a' } });
    expect(filtered.body.entries.map((entry) => entry.sessionId)).toEqual(['ses_here']);
    const unfiltered = await handleRequest({ method: 'GET', path: '/history' });
    expect(unfiltered.body.entries.map((entry) => entry.sessionId).sort()).toEqual(['ses_away', 'ses_here', 'ses_legacy']);
  });

  test('steer records the project directory on its completion snapshot', async () => {
    const dir = makeSnapshotDir();
    const { handleRequest } = handlersWith(dir, () => quickBridge(0));
    const steered = await handleRequest({
      method: 'POST', path: '/steer',
      body: { message: 'Scoped run', sessionId: 'ses_scoped', directory: '/proj/a' },
    });
    expect(steered.status).toBe(200);
    const recorded = JSON.parse(await waitForFile(join(dir, 'ses_scoped.snapshot.json')));
    expect(recorded.directory).toBe('/proj/a');
    const bad = await handleRequest({
      method: 'POST', path: '/steer',
      body: { message: 'Bad scope', sessionId: 'ses_bad_scope', directory: '  ' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('OMO_INVOKE_ARGS_INVALID');
  });

  test('history includes terminal loop rows for the filtered directory', async () => {
    const dir = makeSnapshotDir();
    const repo = nodeFs.mkdtempSync(join(tmpdir(), 'dag-loop-hist-'));
    scratchDirs.push(repo);
    const loop = join(repo, '.omo', 'ulw-loop', 'ses_loop_hist');
    nodeFs.mkdirSync(loop, { recursive: true });
    nodeFs.writeFileSync(join(loop, 'plan.json'), JSON.stringify({
      title: 'Ship it', status: 'running', goal: 'Ship it', totalSteps: 3, completedSteps: 1,
    }), 'utf8');
    nodeFs.writeFileSync(join(loop, 'ledger.jsonl'), '{"seq":1,"event":"started"}\n{"seq":2,"event":"advanced"}\n{"seq":3,"event":"completed"}\n', 'utf8');
    const { handleRequest } = handlersWith(dir, absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/history', query: { directory: repo } });
    expect(answer.status).toBe(200);
    const row = answer.body.entries.find((entry) => entry.sessionId === 'ses_loop_hist');
    expect(row).toBeDefined();
    expect(row.source).toBe('loop');
    expect(row.status).toBe('completed');
    const parsed = parseSnapshotDoc({
      schemaVersion: 1, sessionId: 'ses_loop_hist', updatedAt: row.updatedAt ?? new Date().toISOString(),
      dag: { runs: [{ run_id: 'ses_loop_hist', run_key: 'loop:ses_loop_hist', name: row.label, status: row.status, counts: { pending: 0, running: 0, completed: 1 }, nodes: [], edges: [], waves: [] }] },
      tasks: null,
    });
    expect(parsed.ok).toBe(true);
  });

  test('unknown paths 404 with the path echoed', async () => {
    const { handleRequest } = handlersWith(makeSnapshotDir(), absentBridge);
    const answer = await handleRequest({ method: 'GET', path: '/nope' });
    expect(answer.status).toBe(404);
    expect(answer.body.code).toBe('OMO_DAG_UNKNOWN_PATH');
  });
});

// C4 authority (p26 todo 4): an engine document always outranks the synthetic
// steer fallback. Only the engine owns `tasks.tasks`; the synthetic document
// keeps `tasks: null`, so a document with a non-empty tasks array is engine
// evidence regardless of which path holds it or how new the fallback is.
describe('engine-document authority over the synthetic steer fallback', () => {
  const engineDoc = (sessionId, updatedAt, taskId = 'tsk_engine01') => ({
    schemaVersion: 1,
    sessionId,
    updatedAt,
    dag: {
      runs: [{
        run_id: sessionId,
        run_key: `engine:${sessionId}`,
        name: 'Engine run',
        status: 'completed',
        counts: { pending: 0, running: 0, completed: 1 },
        nodes: [{
          id: taskId, label: 'Engine child', state: 'completed', attempt: 1, prompt: 'Engine child',
          depends_on: [], started_at: null, completed_at: updatedAt,
        }],
        edges: [],
        waves: [{ index: 0, node_ids: [taskId] }],
      }],
    },
    tasks: { tasks: [{ task_id: taskId, status: 'completed' }] },
  });
  const syntheticDoc = (sessionId, updatedAt) => ({
    schemaVersion: 1,
    sessionId,
    updatedAt,
    directory: null,
    dag: {
      runs: [{
        run_id: sessionId,
        run_key: `steer:${sessionId}`,
        name: sessionId,
        status: 'completed',
        counts: { pending: 0, running: 0, completed: 1 },
        nodes: [{
          id: 'step-1', label: 'Steer', state: 'completed', attempt: 1, prompt: 'Steer',
          depends_on: [], started_at: null, completed_at: updatedAt,
        }],
        edges: [],
        waves: [{ index: 0, node_ids: ['step-1'] }],
      }],
    },
    tasks: null,
  });
  const tempPath = (snapshotDir, sessionId) => join(snapshotDir, `${sessionId}.snapshot.json`);
  const projectRunsDir = (project) => join(project, '.omo', 'dag-runs');
  const writeJson = (dir, sessionId, doc) => {
    nodeFs.mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sessionId}.snapshot.json`);
    nodeFs.writeFileSync(file, JSON.stringify(doc), 'utf8');
    return file;
  };
  const makeProject = () => {
    const project = nodeFs.mkdtempSync(join(tmpdir(), 'dag-engine-'));
    scratchDirs.push(project);
    return project;
  };
  // A bridge whose wait() resolves only when the test says so, so the settle
  // path is observed at a deterministic point instead of on a timer.
  const controlledBridge = () => {
    let settle;
    const wait = new Promise((resolve) => { settle = resolve; });
    return {
      bridge: {
        probe: async () => ({ available: true, compatible: true, code: 'OMO_PROBE_OK' }),
        invoke: () => ({
          entry: 'stub-controlled',
          argv: ['run'],
          writer: null,
          wait: () => wait,
          cancel: () => ({}),
        }),
      },
      settle: () => settle({ exitCode: 0, signal: null, result: null }),
      settled: wait,
    };
  };

  test('a project engine document beats a newer synthetic temp document', async () => {
    const snapshotDir = makeSnapshotDir();
    const project = makeProject();
    const engine = engineDoc('ses_authority', '2026-10-01T00:00:00.000Z');
    writeJson(projectRunsDir(project), 'ses_authority', engine);
    const synthetic = syntheticDoc('ses_authority', '2026-11-08T12:00:00.000Z');
    const tempFile = writeJson(snapshotDir, 'ses_authority', synthetic);
    nodeFs.utimesSync(tempFile, new Date('2026-11-08T12:00:00.000Z'), new Date('2026-11-08T12:00:00.000Z'));
    const { handleRequest } = handlersWith(snapshotDir, absentBridge);
    const answer = await handleRequest({
      method: 'GET', path: '/snapshot', query: { sessionId: 'ses_authority', directory: project },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.dag.runs[0].run_key).toBe('engine:ses_authority');
    expect(answer.body.tasks.tasks).toHaveLength(1);
  });

  test('a project engine document is served when the temp path is absent', async () => {
    const snapshotDir = makeSnapshotDir();
    const project = makeProject();
    const engine = engineDoc('ses_engine_only', '2026-10-01T00:00:00.000Z');
    writeJson(projectRunsDir(project), 'ses_engine_only', engine);
    const { handleRequest } = handlersWith(snapshotDir, absentBridge);
    const answer = await handleRequest({
      method: 'GET', path: '/snapshot', query: { sessionId: 'ses_engine_only', directory: project },
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(engine);
  });

  test('a synthetic steer document is still served when no engine document exists', async () => {
    const snapshotDir = makeSnapshotDir();
    const project = makeProject();
    const synthetic = syntheticDoc('ses_steer_only', '2026-11-08T12:00:00.000Z');
    writeJson(snapshotDir, 'ses_steer_only', synthetic);
    const { handleRequest } = handlersWith(snapshotDir, absentBridge);
    const answer = await handleRequest({
      method: 'GET', path: '/snapshot', query: { sessionId: 'ses_steer_only', directory: project },
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(synthetic);
    expect(answer.body.tasks).toBeNull();
    expect(answer.body.dag.runs[0].run_key).toBe('steer:ses_steer_only');
  });

  test('a malformed temp candidate never masks a valid project engine document', async () => {
    const snapshotDir = makeSnapshotDir();
    const project = makeProject();
    const engine = engineDoc('ses_malformed_temp', '2026-10-01T00:00:00.000Z');
    writeJson(projectRunsDir(project), 'ses_malformed_temp', engine);
    nodeFs.writeFileSync(tempPath(snapshotDir, 'ses_malformed_temp'), 'not json{', 'utf8');
    const { handleRequest } = handlersWith(snapshotDir, absentBridge);
    const answer = await handleRequest({
      method: 'GET', path: '/snapshot', query: { sessionId: 'ses_malformed_temp', directory: project },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.tasks.tasks).toHaveLength(1);
    expect(answer.body.dag.runs[0].run_key).toBe('engine:ses_malformed_temp');
  });

  test('settleSteer writes no synthetic document when an engine document exists at either path', async () => {
    // Engine at the temp path: the existing bytes must survive untouched.
    const snapshotDir = makeSnapshotDir();
    const projectA = makeProject();
    const tempEngine = `${JSON.stringify(engineDoc('ses_guard_temp', '2026-10-01T00:00:00.000Z'))}`;
    nodeFs.writeFileSync(tempPath(snapshotDir, 'ses_guard_temp'), tempEngine, 'utf8');
    const runA = controlledBridge();
    const handlersA = handlersWith(snapshotDir, () => runA.bridge);
    const steeredA = await handlersA.handleRequest({
      method: 'POST', path: '/steer',
      body: { message: 'Go', sessionId: 'ses_guard_temp', directory: projectA },
    });
    expect(steeredA.status).toBe(200);
    runA.settle();
    await runA.settled;
    expect(nodeFs.readFileSync(tempPath(snapshotDir, 'ses_guard_temp'), 'utf8')).toBe(tempEngine);

    // Engine at the project path, no temp candidate: the settle path must not
    // create the synthetic fallback beside it.
    const projectB = makeProject();
    writeJson(projectRunsDir(projectB), 'ses_guard_project', engineDoc('ses_guard_project', '2026-10-01T00:00:00.000Z'));
    const runB = controlledBridge();
    const handlersB = handlersWith(snapshotDir, () => runB.bridge);
    const steeredB = await handlersB.handleRequest({
      method: 'POST', path: '/steer',
      body: { message: 'Go', sessionId: 'ses_guard_project', directory: projectB },
    });
    expect(steeredB.status).toBe(200);
    runB.settle();
    await runB.settled;
    expect(nodeFs.existsSync(tempPath(snapshotDir, 'ses_guard_project'))).toBe(false);
  });
});

// Durable chat-run persistence (P0): the host posts the run model it builds
// from engine session data; the service persists it project-scoped. A
// "restart" below is a FRESH handlers instance over the same directories:
// every in-memory map is dropped, so whatever restores came from disk.
describe('project-scoped chat-run persistence', () => {
  const childNode = (id, label, state) => ({
    id, label, state, attempt: 1, prompt: label,
    depends_on: ['parent'], started_at: '2026-10-14T00:00:00.000Z', completed_at: state === 'completed' ? '2026-10-14T00:01:00.000Z' : null,
  });
  const chatDoc = (sessionId, updatedAt, status, childIds, name = `Conv ${sessionId}`) => ({
    schemaVersion: 1,
    sessionId,
    updatedAt,
    dag: {
      runs: [{
        run_id: sessionId,
        run_key: `chat:${sessionId}`,
        name,
        status,
        counts: { pending: 0, running: status === 'completed' ? 0 : childIds.length, completed: status === 'completed' ? childIds.length : 0 },
        nodes: [
          { id: 'parent', label: name, state: status === 'completed' ? 'completed' : 'running', attempt: 1, prompt: name, depends_on: [], started_at: '2026-10-14T00:00:00.000Z', completed_at: status === 'completed' ? updatedAt : null },
          ...childIds.map((id) => childNode(id, `Analyze ${id}`, status === 'completed' ? 'completed' : 'running')),
          { id: 'synthesis', label: 'Synthesis', state: status === 'completed' ? 'completed' : 'pending', attempt: 1, prompt: '', depends_on: childIds, started_at: null, completed_at: null },
        ],
        edges: [...childIds.map((id) => ({ from: 'parent', to: id })), ...childIds.map((id) => ({ from: id, to: 'synthesis' }))],
        waves: [{ index: 0, node_ids: ['parent'] }, { index: 1, node_ids: childIds }, { index: 2, node_ids: ['synthesis'] }],
      }],
    },
    tasks: null,
  });
  const restart = (snapDir) => handlersWith(snapDir, absentBridge).handleRequest;
  const nodeIdsOf = (body) => body.dag.runs[0].nodes.map((n) => n.id);

  test('Scenario A: a completed run with three children restores after a service restart', async () => {
    const snapDir = makeSnapshotDir();
    const project = nodeFs.mkdtempSync(join(tmpdir(), 'dag-projA-'));
    scratchDirs.push(project);
    const post = await handlersWith(snapDir, absentBridge).handleRequest({
      method: 'POST', path: '/snapshot',
      body: { directory: project, conversationId: 'ses_A', snapshot: chatDoc('ses_A', '2026-10-14T00:10:00.000Z', 'completed', ['ses_a1', 'ses_a2', 'ses_a3']) },
    });
    expect(post.status).toBe(200);
    expect(post.body).toMatchObject({ ok: true, written: true, historyRecorded: true });
    const get = await restart(snapDir)({ method: 'GET', path: '/snapshot', query: { sessionId: 'ses_A', directory: project } });
    expect(get.status).toBe(200);
    expect(nodeIdsOf(get.body)).toEqual(['parent', 'ses_a1', 'ses_a2', 'ses_a3', 'synthesis']);
    expect(get.body.directory).toBe(project);
    const parsed = parseSnapshotDoc(get.body);
    expect(parsed.ok).toBe(true);
    const history = await restart(snapDir)({ method: 'GET', path: '/history', query: { directory: project } });
    expect(history.status).toBe(200);
    const rows = history.body.entries.filter((e) => e.sessionId === 'ses_A');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].status).toBe('completed');
  });

  test('Scenario B: conversations A and B stay isolated across restarts and repeated switches', async () => {
    const snapDir = makeSnapshotDir();
    const project = nodeFs.mkdtempSync(join(tmpdir(), 'dag-projB-'));
    scratchDirs.push(project);
    const first = handlersWith(snapDir, absentBridge).handleRequest;
    await first({ method: 'POST', path: '/snapshot', body: { directory: project, conversationId: 'ses_A', snapshot: chatDoc('ses_A', '2026-10-14T00:10:00.000Z', 'completed', ['ses_a1']) } });
    await first({ method: 'POST', path: '/snapshot', body: { directory: project, conversationId: 'ses_B', snapshot: chatDoc('ses_B', '2026-10-14T00:11:00.000Z', 'completed', ['ses_b1', 'ses_b2']) } });
    const get = restart(snapDir);
    for (const [id, kids] of [['ses_A', ['ses_a1']], ['ses_B', ['ses_b1', 'ses_b2']], ['ses_A', ['ses_a1']]]) {
      const answer = await get({ method: 'GET', path: '/snapshot', query: { sessionId: id, directory: project } });
      expect(answer.status).toBe(200);
      const ids = nodeIdsOf(answer.body);
      for (const kid of kids) expect(ids).toContain(kid);
      const foreign = id === 'ses_A' ? ['ses_b1', 'ses_b2'] : ['ses_a1'];
      for (const other of foreign) expect(ids).not.toContain(other);
    }
    const history = await get({ method: 'GET', path: '/history', query: { directory: project } });
    const aRows = history.body.entries.filter((e) => e.sessionId === 'ses_A');
    const bRows = history.body.entries.filter((e) => e.sessionId === 'ses_B');
    expect(aRows.length).toBeGreaterThanOrEqual(1);
    expect(bRows.length).toBeGreaterThanOrEqual(1);
  });

  test('Scenario C: two runs in one conversation stay distinct; history reads never move the live run', async () => {
    const snapDir = makeSnapshotDir();
    const project = nodeFs.mkdtempSync(join(tmpdir(), 'dag-projC-'));
    scratchDirs.push(project);
    const first = handlersWith(snapDir, absentBridge).handleRequest;
    await first({ method: 'POST', path: '/snapshot', body: { directory: project, conversationId: 'ses_A', snapshot: chatDoc('ses_A', '2026-10-14T00:10:00.000Z', 'completed', ['ses_a1']) } });
    await first({ method: 'POST', path: '/snapshot', body: { directory: project, conversationId: 'ses_A', snapshot: chatDoc('ses_A', '2026-10-14T00:20:00.000Z', 'completed', ['ses_a1', 'ses_a2']) } });
    const get = restart(snapDir);
    const history = await get({ method: 'GET', path: '/history', query: { directory: project } });
    const rows = history.body.entries.filter((e) => e.sessionId === 'ses_A');
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.updatedAt)).size).toBe(2);
    const live = await get({ method: 'GET', path: '/snapshot', query: { sessionId: 'ses_A', directory: project } });
    expect(live.status).toBe(200);
    expect(nodeIdsOf(live.body)).toContain('ses_a2');
    expect(live.body.updatedAt).toBe('2026-10-14T00:20:00.000Z');
  });

  test('Scenario D: a new conversation is empty, and an empty doc can never overwrite a valid run', async () => {
    const snapDir = makeSnapshotDir();
    const project = nodeFs.mkdtempSync(join(tmpdir(), 'dag-projD-'));
    scratchDirs.push(project);
    const first = handlersWith(snapDir, absentBridge).handleRequest;
    await first({ method: 'POST', path: '/snapshot', body: { directory: project, conversationId: 'ses_A', snapshot: chatDoc('ses_A', '2026-10-14T00:10:00.000Z', 'completed', ['ses_a1']) } });
    const get = restart(snapDir);
    const missing = await get({ method: 'GET', path: '/snapshot', query: { sessionId: 'ses_new', directory: project } });
    expect(missing.status).toBe(404);
    const history = await get({ method: 'GET', path: '/history', query: { directory: project } });
    expect(history.body.entries.some((e) => e.sessionId === 'ses_new')).toBe(false);
    const stale = await get({
      method: 'POST', path: '/snapshot',
      body: { directory: project, conversationId: 'ses_A', snapshot: { schemaVersion: 1, sessionId: 'ses_A', updatedAt: '2026-10-14T00:30:00.000Z', dag: { runs: [] }, tasks: null } },
    });
    expect(stale.status).toBe(400);
    const live = await get({ method: 'GET', path: '/snapshot', query: { sessionId: 'ses_A', directory: project } });
    expect(live.status).toBe(200);
    expect(nodeIdsOf(live.body)).toContain('ses_a1');
  });

  test('Scenario E: corrupt and versioned snapshots fail loud and preserve the valid run', async () => {
    const snapDir = makeSnapshotDir();
    const project = nodeFs.mkdtempSync(join(tmpdir(), 'dag-projE-'));
    scratchDirs.push(project);
    const first = handlersWith(snapDir, absentBridge).handleRequest;
    await first({ method: 'POST', path: '/snapshot', body: { directory: project, conversationId: 'ses_A', snapshot: chatDoc('ses_A', '2026-10-14T00:10:00.000Z', 'completed', ['ses_a1']) } });
    nodeFs.writeFileSync(join(project, '.omo', 'dag-runs', 'ses_A.snapshot.json'), '{"schemaVersion":1, "sessionId":', 'utf8');
    const get = restart(snapDir);
    const corrupt = await get({ method: 'GET', path: '/snapshot', query: { sessionId: 'ses_A', directory: project } });
    expect(corrupt.status).toBe(422);
    expect(corrupt.body.code).toBe('DAG_SNAPSHOT_MALFORMED');
    const wrongVersion = await get({
      method: 'POST', path: '/snapshot',
      body: { directory: project, conversationId: 'ses_A', snapshot: chatDoc('ses_A', '2026-10-14T00:40:00.000Z', 'completed', ['ses_a1']) },
    });
    expect(wrongVersion.status).toBe(200);
    const traversal = await get({
      method: 'POST', path: '/snapshot',
      body: { directory: `${project}/../escape`, conversationId: 'ses_A', snapshot: chatDoc('ses_A', '2026-10-14T00:40:00.000Z', 'completed', ['ses_a1']) },
    });
    expect(traversal.status).toBe(400);
    const mismatch = await get({
      method: 'POST', path: '/snapshot',
      body: { directory: project, conversationId: 'ses_B', snapshot: chatDoc('ses_A', '2026-10-14T00:40:00.000Z', 'completed', ['ses_a1']) },
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.code).toBe('OMO_DAG_CONVERSATION_MISMATCH');
  });

  test('Scenario F: restored identifiers keep real engine parent-child relationships', async () => {
    const snapDir = makeSnapshotDir();
    const project = nodeFs.mkdtempSync(join(tmpdir(), 'dag-projF-'));
    scratchDirs.push(project);
    const parentId = 'ses_f00parent000000000000000001';
    const kids = ['ses_f00child000000000000000001', 'ses_f00child000000000000000002', 'ses_f00child000000000000000003'];
    const first = handlersWith(snapDir, absentBridge).handleRequest;
    const post = await first({
      method: 'POST', path: '/snapshot',
      body: { directory: project, conversationId: parentId, snapshot: chatDoc(parentId, '2026-10-14T00:10:00.000Z', 'completed', kids, 'Repository analysis with three independent investigations') },
    });
    expect(post.status).toBe(200);
    const get = restart(snapDir);
    const live = await get({ method: 'GET', path: '/snapshot', query: { sessionId: parentId, directory: project } });
    expect(live.status).toBe(200);
    const run = live.body.dag.runs[0];
    expect(run.run_id).toBe(parentId);
    expect(run.run_key).toBe(`chat:${parentId}`);
    expect(run.name).toBe('Repository analysis with three independent investigations');
    for (const kid of kids) {
      expect(run.edges).toContainEqual({ from: 'parent', to: kid });
      expect(run.edges).toContainEqual({ from: kid, to: 'synthesis' });
    }
    const parsed = parseSnapshotDoc(live.body);
    expect(parsed.ok).toBe(true);
  });
});

// HC8: a posted task_id/node_id is a claim, and only the project's persisted
// task records may corroborate it. These tests drive the real
// createAttributionStateReader over real temp project records; none of it is
// stubbed, so a fabricated id that survives would be a genuine leak.
describe('posted attribution corroboration', () => {
  const dagRecord = (taskId, childSessionId, nodeId, runId = 'run-1') => ({
    task_id: taskId,
    child_session_id: childSessionId,
    owner: { kind: 'dag', runId, nodeId },
  });
  const writeTaskRecord = (project, record) => {
    const tasks = join(project, '.omo', 'senpi-task', 'tasks');
    nodeFs.mkdirSync(tasks, { recursive: true });
    nodeFs.writeFileSync(join(tasks, `${record.task_id}.json`), JSON.stringify(record), 'utf8');
  };
  const node = (id, extra = {}) => ({
    id,
    label: id,
    state: 'completed',
    attempt: 1,
    prompt: id,
    depends_on: [],
    started_at: null,
    completed_at: null,
    ...extra,
  });
  const docWithNodes = (sessionId, nodes) => ({
    schemaVersion: 1,
    sessionId,
    updatedAt: '2026-11-08T10:00:00.000Z',
    dag: {
      runs: [{
        run_id: sessionId,
        run_key: `chat:${sessionId}`,
        name: `Conv ${sessionId}`,
        status: 'completed',
        counts: { pending: 0, running: 0, completed: nodes.length },
        nodes,
        edges: [],
        waves: [{ index: 0, node_ids: nodes.map((entry) => entry.id) }],
      }],
    },
    tasks: null,
  });
  const docWithTasks = (sessionId, tasks) => ({
    ...docWithNodes(sessionId, [node('parent')]),
    tasks: { tasks },
  });
  const newProject = () => {
    const dir = nodeFs.mkdtempSync(join(tmpdir(), 'dag-attr-'));
    scratchDirs.push(dir);
    return dir;
  };
  const persistedNode = (project, sessionId, nodeId) => {
    const raw = nodeFs.readFileSync(join(project, '.omo', 'dag-runs', `${sessionId}.snapshot.json`), 'utf8');
    return JSON.parse(raw).dag.runs[0].nodes.find((entry) => entry.id === nodeId);
  };
  const persistedTasks = (project, sessionId) => {
    const raw = nodeFs.readFileSync(join(project, '.omo', 'dag-runs', `${sessionId}.snapshot.json`), 'utf8');
    return JSON.parse(raw).tasks.tasks;
  };

  test('keeps a corroborated id and drops a fabricated pair before persisting', async () => {
    const project = newProject();
    writeTaskRecord(project, dagRecord('task_real_1', 'ses_kid_real', 'node_real_1'));
    const sessionId = 'ses_attr_A';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithNodes(sessionId, [
          node('parent'),
          node('ses_kid_real', { task_id: 'task_real_1', node_id: 'node_real_1' }),
          node('ses_kid_fake', { task_id: 'task_fake', node_id: 'node_fake' }),
          node('synthesis'),
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.written).toBe(true);
    expect(post.body.attributionCorroboration).toBe('applied');
    expect(post.body.attributionDropped).toEqual([
      { node: 'ses_kid_fake', nodeIndex: 2, field: 'task_id', reason: 'task_id is not present in the attribution records' },
      { node: 'ses_kid_fake', nodeIndex: 2, field: 'node_id', reason: 'node_id is not present in the attribution records' },
    ]);
    const real = persistedNode(project, sessionId, 'ses_kid_real');
    expect(real.task_id).toBe('task_real_1');
    expect(real.node_id).toBe('node_real_1');
    const fake = persistedNode(project, sessionId, 'ses_kid_fake');
    expect('task_id' in fake).toBe(false);
    expect('node_id' in fake).toBe(false);
    expect('task_id' in persistedNode(project, sessionId, 'parent')).toBe(false);
    expect('node_id' in persistedNode(project, sessionId, 'synthesis')).toBe(false);
    const read = await request({ method: 'GET', path: '/snapshot', query: { sessionId, directory: project } });
    expect(read.status).toBe(200);
    const served = read.body.dag.runs[0].nodes.find((entry) => entry.id === 'ses_kid_fake');
    expect('task_id' in served).toBe(false);
    expect('node_id' in served).toBe(false);
  });

  test('drops malformed and prototype-named ids instead of persisting them', async () => {
    const project = newProject();
    writeTaskRecord(project, dagRecord('task_real_1', 'ses_kid_real', 'node_real_1'));
    const sessionId = 'ses_attr_B';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithNodes(sessionId, [
          node('ses_kid_real', { task_id: 42, node_id: { nested: true } }),
          node('ses_kid_proto', { task_id: '__proto__', node_id: 'constructor' }),
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.written).toBe(true);
    expect(post.body.attributionCorroboration).toBe('applied');
    expect(post.body.attributionDropped.map((entry) => [entry.node, entry.field]))
      .toEqual([
        ['ses_kid_real', 'task_id'],
        ['ses_kid_real', 'node_id'],
        ['ses_kid_proto', 'task_id'],
        ['ses_kid_proto', 'node_id'],
      ]);
    for (const entry of post.body.attributionDropped) {
      expect(entry.reason.length).toBeGreaterThan(0);
    }
    expect(post.body.attributionDropped[0].reason).toBe('task_id must be a non-empty string');
    const malformed = persistedNode(project, sessionId, 'ses_kid_real');
    expect('task_id' in malformed).toBe(false);
    expect('node_id' in malformed).toBe(false);
    const proto = persistedNode(project, sessionId, 'ses_kid_proto');
    expect('task_id' in proto).toBe(false);
    expect('node_id' in proto).toBe(false);
  });

  test('an absent index drops every unverifiable id and reports the skip', async () => {
    const project = newProject();
    const sessionId = 'ses_attr_C';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithNodes(sessionId, [
          node('ses_kid_unrecorded', { task_id: 'task_unrecorded', node_id: 'node_unrecorded' }),
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.written).toBe(true);
    expect(post.body.attributionCorroboration).toBe('skipped');
    expect(post.body.attributionSkippedReason).toBe('no attribution records exist for this project');
    expect(post.body.attributionDropped).toEqual([
      { node: 'ses_kid_unrecorded', nodeIndex: 0, field: 'task_id', reason: 'corroboration_unavailable' },
      { node: 'ses_kid_unrecorded', nodeIndex: 0, field: 'node_id', reason: 'corroboration_unavailable' },
    ]);
    const dropped = persistedNode(project, sessionId, 'ses_kid_unrecorded');
    expect('task_id' in dropped).toBe(false);
    expect('node_id' in dropped).toBe(false);
  });

  test('malformed and prototype-named ids are dropped when corroboration is skipped', async () => {
    const project = newProject();
    const sessionId = 'ses_attr_C2';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithNodes(sessionId, [
          node('ses_kid_proto_skipped', { task_id: '__proto__', node_id: 'constructor' }),
          node('ses_kid_bad_skipped', { task_id: 42, node_id: { nested: true } }),
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.attributionCorroboration).toBe('skipped');
    expect(post.body.attributionDropped.map((entry) => [entry.node, entry.field, entry.reason])).toEqual([
      ['ses_kid_proto_skipped', 'task_id', 'corroboration_unavailable'],
      ['ses_kid_proto_skipped', 'node_id', 'corroboration_unavailable'],
      ['ses_kid_bad_skipped', 'task_id', 'corroboration_unavailable'],
      ['ses_kid_bad_skipped', 'node_id', 'corroboration_unavailable'],
    ]);
    const proto = persistedNode(project, sessionId, 'ses_kid_proto_skipped');
    expect('task_id' in proto).toBe(false);
    expect('node_id' in proto).toBe(false);
    const malformed = persistedNode(project, sessionId, 'ses_kid_bad_skipped');
    expect('task_id' in malformed).toBe(false);
    expect('node_id' in malformed).toBe(false);
  });

  test('an unreadable index drops every unverifiable id and never pretends corroboration passed', async () => {
    const project = newProject();
    nodeFs.mkdirSync(join(project, '.omo', 'senpi-task', 'tasks'), { recursive: true });
    nodeFs.writeFileSync(join(project, '.omo', 'senpi-task', 'tasks', 'broken.json'), 'not json{', 'utf8');
    const sessionId = 'ses_attr_D';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithNodes(sessionId, [
          node('ses_kid_any', { task_id: 'task_any', node_id: 'node_any' }),
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.attributionCorroboration).toBe('skipped');
    expect(post.body.attributionSkippedReason).toContain('malformed');
    expect(post.body.attributionDropped).toEqual([
      { node: 'ses_kid_any', nodeIndex: 0, field: 'task_id', reason: 'corroboration_unavailable' },
      { node: 'ses_kid_any', nodeIndex: 0, field: 'node_id', reason: 'corroboration_unavailable' },
    ]);
    const dropped = persistedNode(project, sessionId, 'ses_kid_any');
    expect('task_id' in dropped).toBe(false);
    expect('node_id' in dropped).toBe(false);
  });

  test('a repost that writes nothing still reports the fabricated id it dropped', async () => {
    const project = newProject();
    writeTaskRecord(project, dagRecord('task_real_1', 'ses_kid_real', 'node_real_1'));
    const sessionId = 'ses_attr_E';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const body = {
      directory: project,
      conversationId: sessionId,
      snapshot: docWithNodes(sessionId, [node('ses_kid_fake', { task_id: 'task_fake', node_id: 'node_fake' })]),
    };
    const first = await request({ method: 'POST', path: '/snapshot', body });
    expect(first.body.written).toBe(true);
    expect(first.body.attributionDropped.length).toBe(2);
    const second = await request({ method: 'POST', path: '/snapshot', body });
    expect(second.status).toBe(200);
    expect(second.body.written).toBe(false);
    expect(second.body.reason).toBe('unchanged');
    expect(second.body.attributionCorroboration).toBe('applied');
    expect(second.body.attributionDropped.length).toBe(2);
    const fake = persistedNode(project, sessionId, 'ses_kid_fake');
    expect('task_id' in fake).toBe(false);
    expect('node_id' in fake).toBe(false);
  });

  test('a real id claimed for the wrong child session is dropped', async () => {
    const project = newProject();
    writeTaskRecord(project, dagRecord('task_real_1', 'ses_kid_real', 'node_real_1'));
    writeTaskRecord(project, dagRecord('task_other_1', 'ses_kid_other', 'node_other_1'));
    const sessionId = 'ses_attr_F';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithNodes(sessionId, [
          node('ses_kid_real', { task_id: 'task_other_1', node_id: 'node_other_1' }),
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.written).toBe(true);
    expect(post.body.attributionDropped.map((entry) => entry.field)).toEqual(['task_id', 'node_id']);
    const keptNode = persistedNode(project, sessionId, 'ses_kid_real');
    expect('task_id' in keptNode).toBe(false);
    expect('node_id' in keptNode).toBe(false);
  });

  test('an absent index drops every unverifiable tasks-row id and reports it', async () => {
    const project = newProject();
    const sessionId = 'ses_attr_T1';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithTasks(sessionId, [
          { task_id: 'st_fake', node_id: 'node_fake', status: 'completed', name: 'fake' },
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.written).toBe(true);
    expect(post.body.attributionCorroboration).toBe('skipped');
    expect(post.body.attributionSkippedReason).toBe('no attribution records exist for this project');
    expect(post.body.attributionDropped).toEqual([
      { task: 'st_fake', taskIndex: 0, field: 'task_id', reason: 'corroboration_unavailable' },
      { task: 'st_fake', taskIndex: 0, field: 'node_id', reason: 'corroboration_unavailable' },
    ]);
    const persisted = persistedTasks(project, sessionId)[0];
    expect('task_id' in persisted).toBe(false);
    expect('node_id' in persisted).toBe(false);
    expect(persisted.status).toBe('completed');
    const read = await request({ method: 'GET', path: '/snapshot', query: { sessionId, directory: project } });
    expect(read.status).toBe(200);
    const served = read.body.tasks.tasks[0];
    expect('task_id' in served).toBe(false);
    expect('node_id' in served).toBe(false);
  });

  test('a real index keeps a corroborated tasks-row id and drops the fabricated row beside it', async () => {
    const project = newProject();
    writeTaskRecord(project, dagRecord('task_real_t', 'ses_kid_t', 'node_real_t'));
    const sessionId = 'ses_attr_T2';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithTasks(sessionId, [
          { task_id: 'task_real_t', node_id: 'node_real_t', status: 'running', name: 'real' },
          { task_id: 'st_fake', node_id: 'node_fake', status: 'running', name: 'fake' },
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.written).toBe(true);
    expect(post.body.attributionCorroboration).toBe('applied');
    expect(post.body.attributionDropped).toEqual([
      { task: 'st_fake', taskIndex: 1, field: 'task_id', reason: 'task_id is not present in the attribution records' },
      { task: 'st_fake', taskIndex: 1, field: 'node_id', reason: 'node_id is not present in the attribution records' },
    ]);
    const [real, fake] = persistedTasks(project, sessionId);
    expect(real.task_id).toBe('task_real_t');
    expect(real.node_id).toBe('node_real_t');
    expect(real.name).toBe('real');
    expect('task_id' in fake).toBe(false);
    expect('node_id' in fake).toBe(false);
  });

  const claimedRecord = (taskId, childSessionId, nodeId, status, verificationStatus) => ({
    ...dagRecord(taskId, childSessionId, nodeId),
    status,
    ...(verificationStatus === undefined ? {} : { verification_status: verificationStatus }),
  });

  test('keeps a posted verification claim only when the durable record carries the same claim', async () => {
    const project = newProject();
    writeTaskRecord(project, claimedRecord('task_verified', 'ses_verified', 'node_verified', 'completed', 'verified'));
    const sessionId = 'ses_attr_V1';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithTasks(sessionId, [
          { task_id: 'task_verified', node_id: 'node_verified', status: 'completed', name: 'verified', verification_status: 'verified' },
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.attributionDropped).toEqual([]);
    expect(persistedTasks(project, sessionId)[0].verification_status).toBe('verified');
    const read = await request({ method: 'GET', path: '/snapshot', query: { sessionId, directory: project } });
    expect(read.body.tasks.tasks[0].verification_status).toBe('verified');
  });

  test('a blocked record can never be posted or served as verified', async () => {
    const project = newProject();
    writeTaskRecord(project, claimedRecord('task_blocked', 'ses_blocked', 'node_blocked', 'error', 'blocked'));
    const sessionId = 'ses_attr_V2';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithTasks(sessionId, [
          { task_id: 'task_blocked', node_id: 'node_blocked', status: 'error', name: 'blocked', verification_status: 'verified' },
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.written).toBe(true);
    expect(post.body.attributionDropped.map((entry) => [entry.field, entry.reason])).toEqual([
      ['verification_status', 'verification_status does not match the persisted task record'],
    ]);
    const persisted = persistedTasks(project, sessionId)[0];
    expect('verification_status' in persisted).toBe(false);
    const read = await request({ method: 'GET', path: '/snapshot', query: { sessionId, directory: project } });
    const served = read.body.tasks.tasks[0];
    expect('verification_status' in served).toBe(false);
    expect(JSON.stringify(read.body)).not.toContain('"verification_status":"verified"');
  });

  test('a completed record with no claim rejects a posted verified claim and accepts the fail-closed unverified projection', async () => {
    const project = newProject();
    writeTaskRecord(project, claimedRecord('task_unclaimed', 'ses_unclaimed', 'node_unclaimed', 'completed'));
    const sessionId = 'ses_attr_V3';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const forged = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithTasks(sessionId, [
          { task_id: 'task_unclaimed', node_id: 'node_unclaimed', status: 'completed', name: 'unclaimed', verification_status: 'verified' },
        ]),
      },
    });
    expect(forged.body.attributionDropped.map((entry) => entry.field)).toEqual(['verification_status']);
    expect('verification_status' in persistedTasks(project, sessionId)[0]).toBe(false);
    const truthful = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithTasks(sessionId, [
          { task_id: 'task_unclaimed', node_id: 'node_unclaimed', status: 'completed', name: 'unclaimed', verification_status: 'unverified' },
        ]),
      },
    });
    expect(truthful.body.attributionDropped).toEqual([]);
    expect(persistedTasks(project, sessionId)[0].verification_status).toBe('unverified');
  });

  test('a run node cannot borrow a verification claim from another task or a bare node id', async () => {
    const project = newProject();
    writeTaskRecord(project, claimedRecord('task_verified', 'ses_verified', 'node_verified', 'completed', 'verified'));
    const sessionId = 'ses_attr_V4';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithNodes(sessionId, [
          node('ses_verified', { task_id: 'task_verified', node_id: 'node_verified', verification_status: 'verified' }),
          node('ses_unrecorded', { verification_status: 'verified' }),
        ]),
      },
    });
    expect(post.status).toBe(200);
    expect(post.body.attributionDropped.map((entry) => [entry.node, entry.field])).toEqual([
      ['ses_unrecorded', 'verification_status'],
    ]);
    expect(persistedNode(project, sessionId, 'ses_verified').verification_status).toBe('verified');
    expect('verification_status' in persistedNode(project, sessionId, 'ses_unrecorded')).toBe(false);
  });

  test('when corroboration is skipped a posted verification claim is dropped like every unverifiable identity', async () => {
    const project = newProject();
    const sessionId = 'ses_attr_V5';
    const request = handlersWith(makeSnapshotDir(), absentBridge).handleRequest;
    const post = await request({
      method: 'POST', path: '/snapshot',
      body: {
        directory: project,
        conversationId: sessionId,
        snapshot: docWithTasks(sessionId, [
          { task_id: 'st_fake', node_id: 'node_fake', status: 'completed', name: 'fake', verification_status: 'verified' },
        ]),
      },
    });
    expect(post.body.attributionCorroboration).toBe('skipped');
    expect(post.body.attributionDropped.map((entry) => entry.field)).toEqual([
      'task_id', 'node_id', 'verification_status',
    ]);
    expect('verification_status' in persistedTasks(project, sessionId)[0]).toBe(false);
  });
});

// Read-only code-graph routes: the real engine runtime, directory-scoped.
// The first five cases run the real engine over a two-file fixture
// checkout (math.ts defines `add`, main.ts calls it); the last pins the
// 5xx-never-fake-empty contract with a throwing runtime.
describe('dag service code-graph routes', () => {
  const MATH_TS = 'export function add(left: number, right: number): number {\n  return left + right;\n}\n';
  const MAIN_TS = 'import { add } from "./math";\n\nexport function run(): number {\n  return add(1, 2);\n}\n';

  const makeFixtureDir = () => {
    const dir = nodeFs.mkdtempSync(join(tmpdir(), 'dag-cg-'));
    scratchDirs.push(dir);
    nodeFs.writeFileSync(join(dir, 'math.ts'), MATH_TS);
    nodeFs.writeFileSync(join(dir, 'main.ts'), MAIN_TS);
    return dir;
  };

  // Default wiring is the real engine: no bridge override, no runtime stub.
  const codeGraphHandlers = () => createDagServiceHandlers({ fs: nodeFs, snapshotDir: makeSnapshotDir() });

  test('index answers the real shape for a fixture directory', async () => {
    const { handleRequest } = codeGraphHandlers();
    const answer = await handleRequest({ method: 'GET', path: '/codegraph/index', query: { directory: makeFixtureDir() } });
    expect(answer.status).toBe(200);
    expect(answer.body.nodeCount).toBeGreaterThan(2);
    expect(answer.body.edgeCount).toBeGreaterThan(0);
    expect(answer.body.entryCount).toBe(2);
  });

  test('index and query refuse a missing directory instead of indexing the service cwd', async () => {
    const { handleRequest } = codeGraphHandlers();
    const index = await handleRequest({ method: 'GET', path: '/codegraph/index', query: {} });
    expect(index.status).toBe(400);
    expect(index.body.error).toContain('directory is required');
    const query = await handleRequest({ method: 'GET', path: '/codegraph/query', query: { kind: 'search', q: 'add' } });
    expect(query.status).toBe(400);
    expect(query.body.error).toContain('directory is required');
  });

  test('query validation answers 400 for unknown kinds and missing subjects', async () => {
    const { handleRequest } = codeGraphHandlers();
    const directory = makeFixtureDir();
    const unknown = await handleRequest({ method: 'GET', path: '/codegraph/query', query: { directory, kind: 'callers' } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toContain('kind must be');
    const noSymbol = await handleRequest({ method: 'GET', path: '/codegraph/query', query: { directory, kind: 'context' } });
    expect(noSymbol.status).toBe(400);
    expect(noSymbol.body.error).toContain('symbol is required');
    const noQuery = await handleRequest({ method: 'GET', path: '/codegraph/query', query: { directory, kind: 'search' } });
    expect(noQuery.status).toBe(400);
    expect(noQuery.body.error).toContain('query is required');
    const noTarget = await handleRequest({ method: 'GET', path: '/codegraph/query', query: { directory, kind: 'tests' } });
    expect(noTarget.status).toBe(400);
    expect(noTarget.body.error).toContain('target is required');
  });

  test('search round-trips real engine refs against the fixture directory', async () => {
    const { handleRequest } = codeGraphHandlers();
    const answer = await handleRequest({
      method: 'GET', path: '/codegraph/query',
      query: { directory: makeFixtureDir(), kind: 'search', q: 'add' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.coverage).toBe('indexed');
    const ids = (answer.body.items ?? []).map((item) => item.id);
    expect(ids).toContain('fn:add@math.ts');
  });

  test('index and query carry the freshness binding the panel renders', async () => {
    const { handleRequest } = codeGraphHandlers();
    const directory = makeFixtureDir();
    const index = await handleRequest({ method: 'GET', path: '/codegraph/index', query: { directory } });
    expect(index.status).toBe(200);
    expect(index.body.freshness).toBe('fresh');
    expect(index.body.projectId).toMatch(/^[^\s/]+-[0-9a-f]{8}$/);
    expect(index.body.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(index.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof index.body.observedAtMs).toBe('number');
    expect(index.body.staleAfterMs).toBe(7 * 24 * 60 * 60 * 1000);
    const query = await handleRequest({ method: 'GET', path: '/codegraph/query', query: { directory, kind: 'search', q: 'add' } });
    expect(query.status).toBe(200);
    expect(query.body.freshness).toBe('fresh');
    expect(query.body.revision).toBe(index.body.revision);
    expect(query.body.fingerprint).toBe(index.body.fingerprint);
  });

// Read-only rationale route: real git HEAD-tree reads through the actual
// memory-core project-knowledge modules. Every fixture repo is a real git
// checkout; records are built through createRecord/renderRecordFile (and
// evaluatePromotion for the verified one) and committed under
// project-knowledge/, so the route proves the full HEAD-tree round trip.
describe('dag service rationale route', () => {
  const SOURCE_TS = 'export function add(left: number, right: number): number {\n  return left + right;\n}\n';

  const gitIn = (dir, args) => execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

  const commitAll = (dir, message) => {
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['-c', 'user.name=dag-test', '-c', 'user.email=dag-test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', message]);
    return gitIn(dir, ['rev-parse', 'HEAD']);
  };

  const initRepo = () => {
    const dir = nodeFs.mkdtempSync(join(tmpdir(), 'dag-rat-'));
    scratchDirs.push(dir);
    gitIn(dir, ['init']);
    gitIn(dir, ['config', 'user.name', 'dag-test']);
    gitIn(dir, ['config', 'user.email', 'dag-test@example.com']);
    gitIn(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
  };

  const makeKnowledgeRepo = () => {
    const dir = initRepo();
    nodeFs.writeFileSync(join(dir, 'math.ts'), SOURCE_TS);
    const sourceHead = commitAll(dir, 'source');
    const blob = createHash('sha256').update(nodeFs.readFileSync(join(dir, 'math.ts'))).digest('hex');
    const projectId = 'fixture-abcdef12';
    const hypothesis = createRecord({
      projectId,
      claim: 'add returns the sum of its two arguments',
      sourceFile: 'math.ts',
      sourceSymbol: 'fn:add',
      sourceRevision: sourceHead,
      sourceBlobSha256: blob,
      observedAt: '2026-10-20T00:00:00.000Z',
      validationMethod: 'rg-resolve',
      confidence: 0.7,
      scope: { writeScopes: ['math'] },
      invalidationConditions: ['SRC-EDIT'],
      rationale: { notes: [{ kind: 'purpose', text: 'add exists to total two numbers', confidence: 0.6 }] },
    });
    expect(hypothesis.kind).toBe('created');
    if (hypothesis.kind !== 'created') throw new Error('hypothesis record refused');
    const base = createRecord({
      projectId,
      claim: 'math.ts exports the add helper',
      sourceFile: 'math.ts',
      sourceSymbol: 'file',
      sourceRevision: sourceHead,
      sourceBlobSha256: blob,
      observedAt: '2026-10-20T00:00:00.000Z',
      validationMethod: 'rg-resolve',
      confidence: 0.8,
      scope: { writeScopes: ['math'] },
      invalidationConditions: ['SRC-EDIT'],
    });
    expect(base.kind).toBe('created');
    if (base.kind !== 'created') throw new Error('base record refused');
    const promoted = evaluatePromotion(base.record, {
      probe: { source: 'head-tree', revision: sourceHead, symbolResolved: true, blobSha256: blob, revisionReachable: true },
      secretClean: true,
    }, '2026-10-21T00:00:00.000Z');
    expect(promoted.outcome).toBe('promoted');
    nodeFs.mkdirSync(join(dir, 'project-knowledge'), { recursive: true });
    nodeFs.writeFileSync(join(dir, 'project-knowledge', `${hypothesis.record.id}.md`), renderRecordFile(hypothesis.record));
    nodeFs.writeFileSync(join(dir, 'project-knowledge', `${promoted.record.id}.md`), renderRecordFile(promoted.record));
    const knowledgeHead = commitAll(dir, 'knowledge');
    return { dir, projectId, sourceHead, knowledgeHead, hypothesisId: hypothesis.record.id, verifiedId: promoted.record.id };
  };

  const rationaleHandlers = () => createDagServiceHandlers({ fs: nodeFs, snapshotDir: makeSnapshotDir() });

  test('serves real ranked records with provenance from the HEAD tree', async () => {
    const repo = makeKnowledgeRepo();
    const { handleRequest } = rationaleHandlers();
    const answer = await handleRequest({
      method: 'GET', path: '/rationale',
      query: { directory: repo.dir, projectId: repo.projectId, q: 'add', scopes: 'math' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.projectId).toBe(repo.projectId);
    expect(answer.body.revision).toBe(repo.knowledgeHead);
    expect(answer.body.revision).toMatch(/^[0-9a-f]{40}$/);
    const byId = new Map(answer.body.ranked.map((entry) => [entry.id, entry]));
    const hyp = byId.get(repo.hypothesisId);
    expect(hyp.claim).toBe('add returns the sum of its two arguments');
    expect(hyp.kind).toBe('unverified-hypothesis');
    expect(hyp.standing).toBe('unverified-hypothesis');
    expect(hyp.confidence).toBe(0.7);
    expect(hyp.sourceFile).toBe('math.ts');
    expect(hyp.sourceSymbol).toBe('fn:add');
    expect(hyp.observedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(hyp.validationMethod).toBe('rg-resolve');
    expect(hyp.invalidationConditions).toEqual(['SRC-EDIT']);
    expect(hyp.notes).toEqual([{ kind: 'purpose', text: 'add exists to total two numbers', standing: 'unverified-hypothesis', confidence: 0.6 }]);
    expect(hyp.freshness).toEqual({ demoted: false, appliedCase: null });
    expect(hyp.scopeNote).toBe('in-scope');
    expect(typeof hyp.totalScore).toBe('number');
    const verified = byId.get(repo.verifiedId);
    expect(verified.claim).toBe('math.ts exports the add helper');
    expect(verified.kind).toBe('source-verified');
    // The knowledge commit moved HEAD past the pinned source revision, so
    // the verified record demotes against the directory HEAD.
    expect(verified.standing).toBe('previously-verified');
    expect(verified.freshness).toEqual({ demoted: true, appliedCase: 'HEAD-MOVE' });
  }, 30000);

  test('an empty store answers ranked [] with the HEAD revision', async () => {
    const dir = initRepo();
    nodeFs.writeFileSync(join(dir, 'math.ts'), SOURCE_TS);
    const head = commitAll(dir, 'source');
    const { handleRequest } = rationaleHandlers();
    const answer = await handleRequest({
      method: 'GET', path: '/rationale',
      query: { directory: dir, projectId: 'fixture-abcdef12', q: 'add' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.revision).toBe(head);
    expect(answer.body.ranked).toEqual([]);
    expect(answer.body.purgedSecretIds).toEqual([]);
  }, 30000);

  test('a cross-project query answers ranked [] without leaking records', async () => {
    const repo = makeKnowledgeRepo();
    const { handleRequest } = rationaleHandlers();
    const answer = await handleRequest({
      method: 'GET', path: '/rationale',
      query: { directory: repo.dir, projectId: 'other-12345678', q: 'add', scopes: 'math' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.revision).toBe(repo.knowledgeHead);
    expect(answer.body.ranked).toEqual([]);
  }, 30000);

  test('a missing directory answers ranked [] with no fabricated text', async () => {
    const { handleRequest } = rationaleHandlers();
    const blank = await handleRequest({ method: 'GET', path: '/rationale', query: {} });
    expect(blank.status).toBe(200);
    expect(blank.body.ranked).toEqual([]);
    expect(blank.body.revision).toBeNull();
    const gone = await handleRequest({
      method: 'GET', path: '/rationale',
      query: { directory: join(tmpdir(), 'dag-rat-no-such-dir'), projectId: 'fixture-abcdef12', q: 'add' },
    });
    expect(gone.status).toBe(200);
    expect(gone.body.ranked).toEqual([]);
    expect(gone.body.revision).toBeNull();
    const traversal = await handleRequest({
      method: 'GET', path: '/rationale',
      query: { directory: '../escape', projectId: 'fixture-abcdef12', q: 'add' },
    });
    expect(traversal.status).toBe(400);
  });

  test('a directory that is not a git checkout answers ranked []', async () => {
    const dir = nodeFs.mkdtempSync(join(tmpdir(), 'dag-rat-plain-'));
    scratchDirs.push(dir);
    const { handleRequest } = rationaleHandlers();
    const answer = await handleRequest({
      method: 'GET', path: '/rationale',
      query: { directory: dir, projectId: 'fixture-abcdef12', q: 'add' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.revision).toBeNull();
    expect(answer.body.ranked).toEqual([]);
  });

  test('uncommitted working-tree knowledge never enters the ranked results', async () => {
    const repo = makeKnowledgeRepo();
    const { handleRequest } = rationaleHandlers();
    const query = { directory: repo.dir, projectId: repo.projectId, q: 'add', scopes: 'math' };
    const before = await handleRequest({ method: 'GET', path: '/rationale', query });
    expect(before.status).toBe(200);
    const count = before.body.ranked.length;
    expect(count).toBeGreaterThan(0);
    nodeFs.writeFileSync(join(repo.dir, 'project-knowledge', 'pk-000000000000.md'), '---\ndescription: uncommitted draft\n---\n');
    const after = await handleRequest({ method: 'GET', path: '/rationale', query });
    expect(after.status).toBe(200);
    expect(after.body.ranked.length).toBe(count);
    expect(after.body.ranked.some((entry) => entry.claim === 'uncommitted draft')).toBe(false);
  }, 30000);
});

  test('backend failure answers 5xx with the error, never a fake empty index', async () => {
    const { handleRequest } = createDagServiceHandlers({
      fs: nodeFs,
      snapshotDir: makeSnapshotDir(),
      codeGraphRuntime: {
        normalizeDirectory: async (directory) => ({ directory }),
        readIndex: async () => { throw new Error('code-graph: no TypeScript server binary'); },
        query: async () => { throw new Error('engine exploded'); },
      },
    });
    const index = await handleRequest({ method: 'GET', path: '/codegraph/index', query: { directory: '/proj/a' } });
    expect(index.status).toBe(500);
    expect(index.body.error).toContain('no TypeScript server binary');
    expect(index.body.nodeCount).toBeUndefined();
    const query = await handleRequest({ method: 'GET', path: '/codegraph/query', query: { directory: '/proj/a', kind: 'search', q: 'add' } });
    expect(query.status).toBe(500);
    expect(query.body.error).toContain('engine exploded');
    expect(query.body.coverage).toBeUndefined();
  });
});

// Read-only project discovery: GET /rationale/projects lists the distinct
// projectIds parsed from the HEAD-tree project-knowledge/*.md frontmatter
// via the real parseRecordFile. Fixtures are real git checkouts; records
// are built through the real createRecord/renderRecordFile and committed
// under project-knowledge/, so the route proves the full HEAD-tree round
// trip including dedupe, sort order, and honest empties.
describe('dag service rationale projects route', () => {
  const SOURCE_TS = 'export function add(left: number, right: number): number {\n  return left + right;\n}\n';

  const gitIn = (dir, args) => execFileSync('git', args, {
    cwd: dir, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

  const commitAll = (dir, message) => {
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['-c', 'user.name=dag-test', '-c', 'user.email=dag-test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', message]);
    return gitIn(dir, ['rev-parse', 'HEAD']);
  };

  const initRepo = () => {
    const dir = nodeFs.mkdtempSync(join(tmpdir(), 'dag-projids-'));
    scratchDirs.push(dir);
    gitIn(dir, ['init']);
    gitIn(dir, ['config', 'user.name', 'dag-test']);
    gitIn(dir, ['config', 'user.email', 'dag-test@example.com']);
    gitIn(dir, ['config', 'commit.gpgsign', 'false']);
    return dir;
  };

  const makeRecord = (dir, sourceHead, blob, projectId, claim) => {
    const built = createRecord({
      projectId,
      claim,
      sourceFile: 'math.ts',
      sourceSymbol: 'fn:add',
      sourceRevision: sourceHead,
      sourceBlobSha256: blob,
      observedAt: '2026-10-20T00:00:00.000Z',
      validationMethod: 'rg-resolve',
      confidence: 0.7,
      scope: { writeScopes: ['math'] },
      invalidationConditions: ['SRC-EDIT'],
    });
    expect(built.kind).toBe('created');
    if (built.kind !== 'created') throw new Error(`record refused for ${projectId}`);
    nodeFs.writeFileSync(join(dir, 'project-knowledge', `${built.record.id}.md`), renderRecordFile(built.record));
    return built.record.id;
  };

  // Two projectIds across three records (alpha appears twice, proving
  // dedupe); beta sorts after alpha, proving sort order.
  const makeTwoProjectRepo = () => {
    const dir = initRepo();
    nodeFs.writeFileSync(join(dir, 'math.ts'), SOURCE_TS);
    const sourceHead = commitAll(dir, 'source');
    const blob = createHash('sha256').update(nodeFs.readFileSync(join(dir, 'math.ts'))).digest('hex');
    nodeFs.mkdirSync(join(dir, 'project-knowledge'), { recursive: true });
    makeRecord(dir, sourceHead, blob, 'alpha-abcdef12', 'add returns the sum of its two arguments');
    makeRecord(dir, sourceHead, blob, 'alpha-abcdef12', 'math.ts exports the add helper');
    makeRecord(dir, sourceHead, blob, 'beta-12345678', 'add handles negative operands');
    const knowledgeHead = commitAll(dir, 'knowledge');
    return { dir, knowledgeHead };
  };

  const projectsHandlers = () => createDagServiceHandlers({ fs: nodeFs, snapshotDir: makeSnapshotDir() });

  test('lists distinct sorted projectIds from the HEAD tree', async () => {
    const repo = makeTwoProjectRepo();
    const { handleRequest } = projectsHandlers();
    const answer = await handleRequest({ method: 'GET', path: '/rationale/projects', query: { directory: repo.dir } });
    expect(answer.status).toBe(200);
    expect(answer.body.revision).toBe(repo.knowledgeHead);
    expect(answer.body.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(answer.body.projectIds).toEqual(['alpha-abcdef12', 'beta-12345678']);
  }, 30000);

  test('blank and missing directories answer honest empties', async () => {
    const { handleRequest } = projectsHandlers();
    const blank = await handleRequest({ method: 'GET', path: '/rationale/projects', query: {} });
    expect(blank.status).toBe(200);
    expect(blank.body).toEqual({ revision: null, projectIds: [] });
    const gone = await handleRequest({
      method: 'GET', path: '/rationale/projects',
      query: { directory: join(tmpdir(), 'dag-projids-no-such-dir') },
    });
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ revision: null, projectIds: [] });
  });

  test('traversal answers 400 before git runs', async () => {
    const { handleRequest } = projectsHandlers();
    const answer = await handleRequest({
      method: 'GET', path: '/rationale/projects',
      query: { directory: '../escape' },
    });
    expect(answer.status).toBe(400);
  });

  test('a directory that is not a git checkout answers an honest empty', async () => {
    const dir = nodeFs.mkdtempSync(join(tmpdir(), 'dag-projids-plain-'));
    scratchDirs.push(dir);
    const { handleRequest } = projectsHandlers();
    const answer = await handleRequest({ method: 'GET', path: '/rationale/projects', query: { directory: dir } });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ revision: null, projectIds: [] });
  });

  test('a repo without knowledge answers [] with the HEAD revision', async () => {
    const dir = initRepo();
    nodeFs.writeFileSync(join(dir, 'math.ts'), SOURCE_TS);
    const head = commitAll(dir, 'source');
    const { handleRequest } = projectsHandlers();
    const answer = await handleRequest({ method: 'GET', path: '/rationale/projects', query: { directory: dir } });
    expect(answer.status).toBe(200);
    expect(answer.body.revision).toBe(head);
    expect(answer.body.projectIds).toEqual([]);
  }, 30000);

  test('uncommitted working-tree knowledge never enters the project list', async () => {
    const repo = makeTwoProjectRepo();
    const { handleRequest } = projectsHandlers();
    const query = { directory: repo.dir };
    const before = await handleRequest({ method: 'GET', path: '/rationale/projects', query });
    expect(before.status).toBe(200);
    expect(before.body.projectIds).toEqual(['alpha-abcdef12', 'beta-12345678']);
    nodeFs.writeFileSync(join(repo.dir, 'project-knowledge', 'pk-000000000000.md'), '---\ndescription: uncommitted draft\n---\n');
    const after = await handleRequest({ method: 'GET', path: '/rationale/projects', query });
    expect(after.status).toBe(200);
    expect(after.body.projectIds).toEqual(['alpha-abcdef12', 'beta-12345678']);
  }, 30000);
});
