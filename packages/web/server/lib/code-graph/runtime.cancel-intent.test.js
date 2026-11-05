import { execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

/**
 * Pre-job cancel intent, proven without timing: a cancel that lands while no
 * job exists must not report idle while the next read starts the refused
 * build anyway. The intent settles the next read as cancelled, an explicit
 * refresh overrides it, and a blocking read throws CANCELLED.
 */

const root = mkdtempSync(join(tmpdir(), 'code-graph-cancel-intent-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
const makeRepo = (files) => {
  const dir = join(root, `scope-${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.email=qa@example.test', '-c', 'user.name=qa', 'commit', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' },
  );
  return dir;
};

const makeRuntime = () => createCodeGraphRuntime({ fsPromises, path });

describe('pre-job cancel intent', () => {
  it('settles the next read as cancelled without starting a job', async () => {
    const runtime = makeRuntime();
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });

    expect(runtime.cancelIndex(dir)).toEqual({ cancelled: false, state: 'idle' });

    const summary = await runtime.readIndex(dir);
    expect(summary.ready).toBe(false);
    expect(summary.indexState?.state).toBe('cancelled');

    expect(runtime.indexState(dir).state).toBe('not-indexed');
  });

  it('lets an explicit refresh override the intent and build', async () => {
    const runtime = makeRuntime();
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });

    runtime.cancelIndex(dir);
    const built = await runtime.readIndex(dir, { refresh: true, block: true });
    expect(built.ready).toBe(true);
    expect(built.nodeCount).toBeGreaterThan(0);
  });

  it('throws CANCELLED for a blocking read while the intent stands', async () => {
    const runtime = makeRuntime();
    const dir = makeRepo({ 'a.ts': 'export const alpha = 1;\n' });

    runtime.cancelIndex(dir);
    const failure = await runtime.readIndex(dir, { block: true }).then(
      () => null,
      (error) => error,
    );
    expect(failure?.code).toBe('CANCELLED');
  });
});
