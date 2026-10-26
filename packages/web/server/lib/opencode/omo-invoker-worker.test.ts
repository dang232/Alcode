// Worker-level tests for the OmO run worker. Every case drives the real
// worker binary (`bun omo-invoker-worker.ts`) over real process stdio
// against fixture dirs only: stub run barrels, stub loop-state readers, and
// fixture wrapper CLIs are materialized per test under the OS temp dir, so
// no engine checkout, no session, and no keyed spend is ever touched.
import { describe, expect, it, afterEach } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_ENTRY = join(import.meta.dir ?? dirname(fileURLToPath(import.meta.url)), 'omo-invoker-worker.ts');
// A hung worker spawn is killed so one wedged case cannot block the file.
const WORKER_TIMEOUT_MS = 30000;

interface WorkerResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const liveChildren: ChildProcess[] = [];
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const child of liveChildren.splice(0)) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited; nothing to clean up.
    }
  }
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  }
});

const runWorker = (args: string[], stdin: string, env: Record<string, string> = {}): Promise<WorkerResult> =>
  new Promise((resolve) => {
    // Under `bun test` process.execPath is the bun binary, so the worker
    // always runs on the same runtime the suite does.
    const child = spawn(process.execPath, [WORKER_ENTRY, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    liveChildren.push(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, WORKER_TIMEOUT_MS);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin?.write(stdin);
    child.stdin?.end();
  });

const trackDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureDirs.push(dir);
  return dir;
};

// Stub run barrel: records the options it was called with, answers a
// scripted exit code, and optionally rejects. Extra named exports give
// --self-test a known export list to report.
const STUB_BARREL = `export async function run(options: Record<string, unknown>): Promise<number> {
  const fs = await import("node:fs");
  const out = process.env.OMO_WORKER_CALL_FILE;
  if (out) fs.writeFileSync(out, JSON.stringify(options));
  if (process.env.OMO_WORKER_REJECT === "1") throw new Error("stub run boom");
  return Number(process.env.OMO_WORKER_EXIT_CODE ?? "0");
}
export function helperAlpha(): string { return "alpha"; }
export function helperZeta(): string { return "zeta"; }
`;

const makeEngineRoot = (barrel = STUB_BARREL) => {
  const root = trackDir('omo-worker-engine-');
  const barrelPath = join(root, 'stub-barrel.ts');
  writeFileSync(barrelPath, barrel);
  return { root, barrelPath };
};

// Stub loop-state readers mirroring the worker's expected shapes
// (readUlwLoopPlanSync / summarizeUlwLoopPlan / readLedger). The happy set
// records the scope it was called with and serves 25 ledger entries; the
// throwing set proves the worker degrades to null/[] instead of crashing.
const HAPPY_LOOP_SRC = {
  'plan-io.ts': `import fs from "node:fs";
export function readUlwLoopPlanSync(repoRoot: string, scope?: { sessionId?: string }): unknown {
  if (process.env.OMO_WORKER_SCOPE_FILE) fs.writeFileSync(process.env.OMO_WORKER_SCOPE_FILE, JSON.stringify({ repoRoot, scope: scope ?? null }));
  return { goal: "fixture-goal", root: repoRoot };
}
`,
  'plan-crud.ts': `export function summarizeUlwLoopPlan(plan: unknown): unknown {
  const typed = plan as { goal?: string };
  return { summary: "fixture-summary", goal: typed?.goal ?? null };
}
`,
  'ledger.ts': `export function readLedger(): unknown[] {
  return Array.from({ length: 25 }, (_v, i) => ({ seq: i + 1, note: "entry-" + (i + 1) }));
}
`,
};

const THROWING_LOOP_SRC = {
  'plan-io.ts': `export function readUlwLoopPlanSync(): unknown { throw new Error("no plan here"); }\n`,
  'plan-crud.ts': `export function summarizeUlwLoopPlan(): unknown { throw new Error("no summary here"); }\n`,
  'ledger.ts': `export function readLedger(): unknown[] { throw new Error("no ledger here"); }\n`,
};

const makeLoopSrc = (files: Record<string, string>): string => {
  const dir = trackDir('omo-worker-loopsrc-');
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

describe('worker job mode (stdin parse)', () => {
  it('valid minimal job reaches run() with json:true and exits 0', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const callFile = join(root, 'call.json');
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ message: 'Fix the bug' })}\n`,
      { OMO_WORKER_CALL_FILE: callFile },
    );
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(JSON.parse(readFileSync(callFile, 'utf8'))).toMatchObject({ message: 'Fix the bug', json: true });
  }, 30000);

  it('every optional job field round-trips to run()', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const callFile = join(root, 'call.json');
    const job = {
      message: 'Continue',
      agent: 'atlas',
      model: 'alcore/al-1-2',
      directory: '/user/project',
      sessionId: 'ses_abc123',
      port: 4321,
      attach: 'http://127.0.0.1:4321',
    };
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify(job)}\n`,
      { OMO_WORKER_CALL_FILE: callFile },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(callFile, 'utf8'))).toMatchObject({ ...job, json: true });
  }, 30000);

  it('workflow round-trips trimmed to run() when provided', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const callFile = join(root, 'call.json');
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ message: 'Continue', workflow: '  plan-then-execute  ' })}\n`,
      { OMO_WORKER_CALL_FILE: callFile },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(callFile, 'utf8'))).toMatchObject({ message: 'Continue', workflow: 'plan-then-execute', json: true });
  }, 30000);

  it('blank workflow fails closed with a stderr reason', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ message: 'hi', workflow: '   ' })}\n`,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('[omo-invoker-worker]');
  }, 30000);

  it('leading blank lines are skipped, the first job line wins', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const callFile = join(root, 'call.json');
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `\n   \n${JSON.stringify({ message: 'hi' })}\n{"message":"ignored"}\n`,
      { OMO_WORKER_CALL_FILE: callFile },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(readFileSync(callFile, 'utf8'))).toMatchObject({ message: 'hi' });
  }, 30000);

  it('run() exit code passes through the worker', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ message: 'hi' })}\n`,
      { OMO_WORKER_EXIT_CODE: '3' },
    );
    expect(result.code).toBe(3);
  }, 30000);

  it('run() rejection exits 1 naming the rejection', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ message: 'hi' })}\n`,
      { OMO_WORKER_REJECT: '1' },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('run() rejected');
    expect(result.stderr).toContain('stub run boom');
  }, 30000);

  it('job without a message exits 2 with a stderr reason', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ agent: 'atlas' })}\n`,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('[omo-invoker-worker]');
    expect(result.stderr).toContain('non-empty message');
  }, 30000);

  it('blank message and out-of-range port exit 2', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const blank = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ message: '   ' })}\n`,
    );
    expect(blank.code).toBe(2);
    const badPort = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ message: 'hi', port: 0 })}\n`,
    );
    expect(badPort.code).toBe(2);
    expect(badPort.stderr).toContain('[omo-invoker-worker]');
  }, 30000);

  it('native-kind job without --engine-root exits 2 naming the flag', async () => {
    // No kind and no wrapper entry infers native, which still needs the
    // engine root; only wrapper-kind jobs run without one.
    const result = await runWorker([], `${JSON.stringify({ message: 'hi' })}\n`);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('missing --engine-root');
  }, 30000);

  it('explicit native-kind job without --engine-root exits 2 the same way', async () => {
    const result = await runWorker(
      [],
      `${JSON.stringify({ kind: 'native', message: 'hi' })}\n`,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('missing --engine-root');
  }, 30000);
});

describe('worker --self-test', () => {
  it('lists the barrel exports sorted as one JSON line', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(['--engine-root', root, '--self-test', '--barrel-path', barrelPath], '');
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ ok: true, exports: ['helperAlpha', 'helperZeta', 'run'] });
  }, 30000);

  it('resolves the default engine-layout barrel without --barrel-path', async () => {
    const root = trackDir('omo-worker-layout-');
    const runDir = join(root, 'packages', 'omo-opencode', 'src', 'cli', 'run');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'index.ts'), STUB_BARREL);
    const result = await runWorker(['--engine-root', root, '--self-test'], '');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ ok: true, exports: ['helperAlpha', 'helperZeta', 'run'] });
  }, 30000);

  it('missing barrel exits 2 naming the native-unavailable cause', async () => {
    const root = trackDir('omo-worker-nobarrel-');
    const result = await runWorker(
      ['--engine-root', root, '--self-test', '--barrel-path', join(root, 'absent.ts')],
      '',
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('[omo-invoker-worker]');
    expect(result.stderr).toContain('cannot import engine run barrel');
  }, 30000);
});

describe('worker --loop-status (T2 contract: --session/--limit, clamp-default-50, degrade exit 0)', () => {
  it('reports plan plus the full default tail with null session', async () => {
    // 25 stub entries against the default limit of 50: the whole tail.
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc],
      '',
    );
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    const body = JSON.parse(result.stdout.trim());
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBeNull();
    expect(body.plan).toMatchObject({ summary: 'fixture-summary', goal: 'fixture-goal' });
    expect(body.ledgerTail).toHaveLength(25);
    expect(body.ledgerTail[0]).toMatchObject({ seq: 1 });
    expect(body.ledgerTail[24]).toMatchObject({ seq: 25 });
  }, 30000);

  it('--limit 5 yields the newest 5 entries', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc, '--limit', '5'],
      '',
    );
    expect(result.code).toBe(0);
    const body = JSON.parse(result.stdout.trim());
    expect(body.ledgerTail).toHaveLength(5);
    expect(body.ledgerTail[0]).toMatchObject({ seq: 21 });
    expect(body.ledgerTail[4]).toMatchObject({ seq: 25 });
  }, 30000);

  it('oversized --limit clamps to the bounded maximum with exit 0', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc, '--limit', '999999'],
      '',
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim()).ledgerTail).toHaveLength(25);
  }, 30000);

  it('zero and non-numeric --limit fall back to the default with exit 0', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const base = ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc];
    for (const value of ['0', 'abc']) {
      const result = await runWorker([...base, '--limit', value], '');
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout.trim()).ledgerTail).toHaveLength(25);
    }
  }, 60000);

  it('--session is echoed and reaches the readers as scope', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const scopeFile = join(root, 'scope.json');
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc, '--session', 'ses_loop9'],
      '',
      { OMO_WORKER_SCOPE_FILE: scopeFile },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim()).sessionId).toBe('ses_loop9');
    expect(JSON.parse(readFileSync(scopeFile, 'utf8'))).toMatchObject({ scope: { sessionId: 'ses_loop9' } });
  }, 30000);

  it('invalid --session degrades to plan null and empty tail with exit 0', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc, '--session', '../evil'],
      '',
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ ok: true, sessionId: null, plan: null, ledgerTail: [] });
  }, 30000);

  it('absent default reader layout degrades; --loop-src override serves', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const withoutOverride = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status'],
      '',
    );
    expect(withoutOverride.code).toBe(0);
    expect(JSON.parse(withoutOverride.stdout.trim())).toEqual({ ok: true, sessionId: null, plan: null, ledgerTail: [] });
    const withOverride = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc],
      '',
    );
    expect(withOverride.code).toBe(0);
    expect(JSON.parse(withOverride.stdout.trim()).ok).toBe(true);
  }, 60000);

  it('broken readers degrade to plan null and empty tail with exit 0', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(THROWING_LOOP_SRC);
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc],
      '',
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ ok: true, sessionId: null, plan: null, ledgerTail: [] });
  }, 30000);

  it('retired flags and positionals fail with a stderr reason', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const base = ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc];
    for (const extra of [['--session-id', 'ses_x'], ['--ledger-limit', '5'], ['some-repo-root']]) {
      const result = await runWorker([...base, ...extra], '');
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('[omo-invoker-worker]');
    }
  }, 60000);

  it('missing --session/--limit/--loop-src values fail closed with exit 2', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const loopSrc = makeLoopSrc(HAPPY_LOOP_SRC);
    const base = ['--engine-root', root, '--barrel-path', barrelPath, '--loop-status', '--loop-src', loopSrc];
    for (const flag of ['--session', '--limit', '--loop-src']) {
      const result = await runWorker([...base, flag], '');
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('[omo-invoker-worker]');
    }
  }, 60000);
});

describe('worker malformed input', () => {
  it('empty stdin exits 2 with a stderr reason', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(['--engine-root', root, '--barrel-path', barrelPath], '');
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('[omo-invoker-worker]');
    expect(result.stderr).toContain('empty job on stdin');
  }, 30000);

  it('whitespace-only stdin exits 2 the same way', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(['--engine-root', root, '--barrel-path', barrelPath], '  \n\t\n');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('empty job on stdin');
  }, 30000);

  it('non-JSON stdin exits 2 with a stderr reason, never a raw dump', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(['--engine-root', root, '--barrel-path', barrelPath], 'not-json\n');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('[omo-invoker-worker]');
    expect(result.stderr).toContain('not valid JSON');
  }, 30000);

  it('truncated JSON exits 2 with a stderr reason', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(['--engine-root', root, '--barrel-path', barrelPath], '{"message": "hi"\n');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('[omo-invoker-worker]');
  }, 30000);

  it('native-kind job with a missing barrel exits 2 naming the cause', async () => {
    const root = trackDir('omo-worker-nobarrel-');
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', join(root, 'absent.ts')],
      `${JSON.stringify({ message: 'hi' })}\n`,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('cannot import engine run barrel');
  }, 30000);

  it('barrel without run() exits 2 naming the missing export', async () => {
    const { root, barrelPath } = makeEngineRoot('export function helperOnly(): void {}\n');
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ message: 'hi' })}\n`,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('exports no run() function');
  }, 30000);
});

// Fixture wrapper entry: a tiny CLI that records the argv it was spawned
// with, relays scripted stdout lines, echoes one stderr line, and exits
// with a scripted code — the observable half of the wrapper contract the
// worker relay must preserve byte-verbatim.
const WRAPPER_SCRIPT = `import fs from "node:fs";
const out = process.env.OMO_WORKER_CALL_FILE;
if (out) fs.writeFileSync(out, JSON.stringify(process.argv.slice(1)));
if (process.env.OMO_WORKER_STDERR_LINE) console.error(process.env.OMO_WORKER_STDERR_LINE);
for (const line of String(process.env.OMO_WORKER_LINES ?? "").split("\\n")) {
  if (line) console.log(line);
}
process.exit(Number(process.env.OMO_WORKER_EXIT_CODE ?? "0"));
`;

// Sleeper wrapper: announces readiness on stderr (an event the test
// subscribes to — no polling), then traps SIGTERM into a receipt file so
// the test can prove the worker forwarded the signal instead of orphaning
// the child. POSIX-only proof: Windows terminates on SIGTERM without
// running traps, so the suite skips the live forwarding there (the win32
// path is the bridge-side tree-kill, covered by the cancel unit test).
const WRAPPER_SLEEPER = `import fs from "node:fs";
console.error("wrapper-ready");
process.on("SIGTERM", () => {
  const out = process.env.OMO_WORKER_RECEIPT_FILE;
  if (out) fs.writeFileSync(out, "got-sigterm");
  process.exit(0);
});
setInterval(() => {}, 1000);
`;

const makeWrapperEntry = (script = WRAPPER_SCRIPT) => {
  const dir = trackDir('omo-worker-wrapper-');
  const scriptPath = join(dir, 'wrapper.mjs');
  writeFileSync(scriptPath, script);
  return { dir, scriptPath };
};

describe('worker wrapper-kind jobs (spawn and relay)', () => {
  it('relays wrapper stdout byte-exact with exit 0 and records argv', async () => {
    const { dir, scriptPath } = makeWrapperEntry();
    const callFile = join(dir, 'call.json');
    const eventLine = JSON.stringify({ type: 'omo.dag.updated', data: { parent_session_id: 'ses_w1' } });
    const resultLine = JSON.stringify({ sessionId: 'ses_w1', success: true });
    // No --engine-root on purpose: wrapper-kind jobs never touch the
    // engine tree, so none is required.
    const result = await runWorker(
      [],
      `${JSON.stringify({
        kind: 'wrapper',
        message: 'Steer on',
        sessionId: 'ses_w1',
        wrapperEntry: process.execPath,
        wrapperArgv: [scriptPath, 'run', 'Steer on', '--session-id', 'ses_w1', '--json'],
      })}\n`,
      {
        OMO_WORKER_CALL_FILE: callFile,
        OMO_WORKER_LINES: `${eventLine}\n${resultLine}`,
        OMO_WORKER_STDERR_LINE: 'wrapper warn line',
      },
    );
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    // Byte-exact: the relay adds no banners — stdout carries the wrapper's
    // bytes only, so the bridge line protocol reads them back unchanged.
    expect(result.stdout).toBe(`${eventLine}\n${resultLine}\n`);
    expect(result.stderr).toContain('wrapper warn line');
    expect(JSON.parse(readFileSync(callFile, 'utf8'))).toEqual(
      [scriptPath, 'run', 'Steer on', '--session-id', 'ses_w1', '--json'],
    );
  }, 30000);

  it('wrapper exit code passes through the worker', async () => {
    const { scriptPath } = makeWrapperEntry();
    const result = await runWorker(
      [],
      `${JSON.stringify({ kind: 'wrapper', message: 'hi', wrapperEntry: process.execPath, wrapperArgv: [scriptPath] })}\n`,
      { OMO_WORKER_EXIT_CODE: '3' },
    );
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(3);
    expect(result.stdout).toBe('');
  }, 30000);

  it('job without kind but with a wrapper entry infers wrapper', async () => {
    const { scriptPath } = makeWrapperEntry();
    const eventLine = JSON.stringify({ type: 'omo.task.updated', data: { parent_session_id: 'ses_w2' } });
    const result = await runWorker(
      [],
      `${JSON.stringify({ message: 'hi', wrapperEntry: process.execPath, wrapperArgv: [scriptPath] })}\n`,
      { OMO_WORKER_LINES: eventLine },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${eventLine}\n`);
  }, 30000);

  it('wrapper-kind without entry or argv exits 2 with a stderr reason', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const missing = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ kind: 'wrapper', message: 'hi' })}\n`,
    );
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('wrapper jobs need a wrapper entry plus argv');
  }, 30000);

  it('unknown kind exits 2 with a stderr reason', async () => {
    const { root, barrelPath } = makeEngineRoot();
    const result = await runWorker(
      ['--engine-root', root, '--barrel-path', barrelPath],
      `${JSON.stringify({ kind: 'teapot', message: 'hi' })}\n`,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('[omo-invoker-worker]');
    expect(result.stderr).toContain('non-empty message');
  }, 30000);

  it('unstartable wrapper entry exits 2 naming the cause', async () => {
    const dir = trackDir('omo-worker-wrapmissing-');
    const result = await runWorker(
      [],
      `${JSON.stringify({
        kind: 'wrapper', message: 'hi',
        wrapperEntry: join(dir, 'absent-wrapper'),
        wrapperArgv: ['run', 'hi', '--json'],
      })}\n`,
    );
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('[omo-invoker-worker]');
    expect(result.stderr).toContain('cannot start wrapper entry');
  }, 30000);

  it('SIGTERM to the worker reaches the wrapper child (no orphan)', async () => {
    if (process.platform === 'win32') {
      // Windows delivers SIGTERM as TerminateProcess: traps never run, so
      // a receipt-based proof is impossible here. The win32 reap path is
      // the bridge-side tree-kill, proved by the cancel unit test plus the
      // bridge integration test; skip the live proof instead of leaking a
      // sleeper the suite could never reap.
      return;
    }
    const { dir, scriptPath } = makeWrapperEntry(WRAPPER_SLEEPER);
    const receiptFile = join(dir, 'receipt.txt');
    const child = spawn(process.execPath, [WORKER_ENTRY], {
      env: { ...process.env, OMO_WORKER_RECEIPT_FILE: receiptFile },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    liveChildren.push(child);
    let stderrText = '';
    let ready = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, WORKER_TIMEOUT_MS);
    timer.unref?.();
    const settled = await new Promise<WorkerResult>((resolve) => {
      child.stderr?.on('data', (chunk) => {
        stderrText += String(chunk);
        if (!ready && stderrText.includes('wrapper-ready')) {
          ready = true;
          // The wrapper child is provably up (it announced itself), so the
          // signal must travel worker -> child for the receipt to land.
          child.kill('SIGTERM');
        }
      });
      child.stdout?.on('data', () => {});
      child.on('error', () => {
        clearTimeout(timer);
        resolve({ code: 1, stdout: '', stderr: stderrText, timedOut: false });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout: '', stderr: stderrText, timedOut: false });
      });
      child.stdin?.write(`${JSON.stringify({
        kind: 'wrapper', message: 'hi',
        wrapperEntry: process.execPath, wrapperArgv: [scriptPath],
      })}\n`);
      child.stdin?.end();
    });
    expect(settled.code).toBe(0);
    expect(stderrText).toContain('wrapper-ready');
    // The trap receipt is the proof: only a forwarded SIGTERM writes it,
    // and the wrapper exited 0 through the trap, which the worker adopted.
    expect(readFileSync(receiptFile, 'utf8')).toBe('got-sigterm');
  }, 30000);
});
