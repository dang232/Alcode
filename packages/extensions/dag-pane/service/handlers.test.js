// Service handler tests for the alcode-builtin-dag-pane guest (project-ide todo 13).
// bun:test, no servers: `handleRequest` is called directly with a scripted
// bridge. The live steer/cancel path spawns a REAL sleeper child (the
// platform node binary) and kills it through the REAL bridge `cancelRun`,
// so the test proves steer starts a process and cancel terminates it.
import { describe, expect, test, afterEach } from 'bun:test';
import { spawn } from 'node:child_process';
import nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cancelRun } from '../../../web/server/lib/opencode/omo-bridge-runtime.js';
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

  test('the shipped manifest keeps both blocks and the new spelling wins', () => {
    const shipped = JSON.parse(nodeFs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(shipped.alcode.contributes.panel.id).toBe('alcode-builtin-dag-pane');
    expect(shipped.alcode.engines).toEqual({ alcode: '>=1.22.0' });
    expect(shipped.openchamber.contributes.panel.id).toBe('openchamber-builtin-dag-pane');
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
