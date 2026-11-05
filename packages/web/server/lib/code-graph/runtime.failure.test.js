import { execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

/**
 * Failure recovery, proven against the real engine over temp git
 * repositories with OS-level read denial (icacls on Windows, chmod
 * otherwise — verified effective by reading the file back, never assumed).
 *
 * One unreadable file degrades to partial instead of aborting the build;
 * terminal failures are remembered so status polls observe `failed` instead
 * of relaunching the doomed build on every read.
 */

const root = mkdtempSync(join(tmpdir(), 'code-graph-failure-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
const makeRepo = (files) => {
  const dir = join(root, `scope-${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  return dir;
};

const makeRuntime = (options = {}, fs = fsPromises, events = null) =>
  createCodeGraphRuntime(
    { fsPromises: fs, path },
    events === null ? options : { ...options, onProgress: (event) => events.push(event) },
  );
/**
 * Non-blocking reads answer before a background build reaches its terminal
 * state, so a poll that asserts on the failure counter must wait for the event
 * rather than assume it already arrived. Bounded, and it never sleeps past the
 * signal: on an idle host it returns on the first tick.
 */
const waitForFailures = async (events, count) => {
  const deadline = Date.now() + 60000;
  const seen = () => events.filter((event) => event.state === 'failed').length;
  while (seen() < count) {
    if (Date.now() > deadline) throw new Error(`waited 60000ms for ${count} failed event(s), saw ${seen()}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const isDenied = async (file) => {
  try {
    await fsPromises.readFile(file);
    return false;
  } catch {
    return true;
  }
};

/** Deny the process read access; throws loudly where the platform cannot. */
const denyRead = async (file) => {
  const user = process.env.USERNAME ?? 'Everyone';
  let lastError = null;
  try {
    execFileSync('icacls', [file, '/deny', `${user}:(R)`], { stdio: 'ignore' });
    if (await isDenied(file)) {
      return async () => {
        execFileSync('icacls', [file, '/remove:d', `${user}`], { stdio: 'ignore' });
      };
    }
    lastError = new Error('icacls left the file readable');
  } catch (error) {
    lastError = error;
  }
  try {
    execFileSync('chmod', ['000', file], { stdio: 'ignore' });
    if (await isDenied(file)) {
      return async () => {
        execFileSync('chmod', ['644', file], { stdio: 'ignore' });
      };
    }
    lastError = new Error('chmod left the file readable');
  } catch (error) {
    lastError = error;
  }
  throw new Error(`failure tests need OS read denial for ${file}: ${String(lastError)}`);
};

const A = 'export function alpha(): number { return 1; }\n';
const B = 'export function beta(): number { return 2; }\n';
const C = 'import { alpha } from "./a";\nexport function gamma(): number { return alpha(); }\n';

describe('failure recovery', () => {
  it('serves a usable partial graph when one file is OS-unreadable', async () => {
    const runtime = makeRuntime({ storeDir: join(root, 'store-partial') });
    const dir = makeRepo({ 'a.ts': A, 'b.ts': B, 'c.ts': C });
    const restore = await denyRead(join(dir, 'b.ts'));
    try {
      const evolved = await runtime.readIndex(dir, { block: true, refresh: true });
      expect(evolved.ready).toBe(true);
      expect(evolved.incremental?.reanalyzed).toBe(2);
      expect(evolved.incremental?.unreadableFileCount).toBe(1);
      expect(evolved.incremental?.unreadableFiles).toContain('b.ts');

      const explored = await runtime.query(dir, { kind: 'explore', limit: 50 });
      expect(explored.coverage).toBe('partial');
      expect(explored.unresolved.some((line) => line.includes('b.ts'))).toBe(true);

      const found = await runtime.query(dir, { kind: 'search', query: 'alpha' });
      expect(found.items.some((item) => item.name === 'alpha')).toBe(true);
      const traced = await runtime.query(dir, { kind: 'trace', from: 'fn:gamma@c.ts', to: 'fn:alpha@a.ts', depth: 2 });
      expect(traced.items.length).toBeGreaterThan(0);
    } finally {
      await restore();
    }
  }, 120000);

  it('keeps the previous complete generation servable when a rebuild fails everywhere', async () => {
    const runtime = makeRuntime({ storeDir: join(root, 'store-stale') });
    const dir = makeRepo({ 'a.ts': A, 'b.ts': B });
    const good = await runtime.readIndex(dir, { block: true });
    expect(good.ready).toBe(true);

    // Permission bits leave size/mtime alone, and matching stats reuse
    // records without reading: bump mtimes first (while writable) so the
    // refresh must re-read and the denial bites.
    const bumped = new Date('2026-02-02T00:00:00Z');
    utimesSync(join(dir, 'a.ts'), bumped, bumped);
    utimesSync(join(dir, 'b.ts'), bumped, bumped);
    const restoreA = await denyRead(join(dir, 'a.ts'));
    const restoreB = await denyRead(join(dir, 'b.ts'));
    try {
      const stale = await runtime.readIndex(dir, { block: true, refresh: true });
      expect(stale.ready).toBe(true);
      expect(stale.generation).toBe(good.generation);
      expect(stale.freshness).toBe('stale');
      expect(String(stale.refreshError ?? '')).toContain('no readable source files');
      expect(stale.nodeCount).toBe(good.nodeCount);
      const found = await runtime.query(dir, { kind: 'search', query: 'alpha' });
      expect(found.items.some((item) => item.name === 'alpha')).toBe(true);
    } finally {
      await restoreA();
      await restoreB();
    }

    const recovered = await runtime.readIndex(dir, { block: true, refresh: true });
    expect(recovered.ready).toBe(true);
    expect(recovered.freshness).toBe('fresh');
  }, 120000);

  it('does not relaunch a failed build on repeated plain polls', async () => {
    const events = [];
    const runtime = makeRuntime({ storeDir: join(root, 'store-storm') }, fsPromises, events);
    const dir = makeRepo({ 'a.ts': A, 'b.ts': B });
    const restoreA = await denyRead(join(dir, 'a.ts'));
    const restoreB = await denyRead(join(dir, 'b.ts'));
    try {
      await expect(runtime.readIndex(dir, { block: true, refresh: true })).rejects.toThrow('no readable source files');
      const failures = () => events.filter((event) => event.state === 'failed').length;
      expect(failures()).toBe(1);
      for (let i = 0; i < 3; i += 1) {
        const polled = await runtime.readIndex(dir);
        expect(polled.ready).toBe(false);
        expect(polled.indexState?.state).toBe('failed');
        expect(String(polled.indexState?.error ?? '')).toContain('no readable source files');
      }
      expect(failures()).toBe(1);
    } finally {
      await restoreA();
      await restoreB();
    }
  }, 120000);

  it('starts at most one build for concurrent polls on a doomed scope', async () => {
    const events = [];
    const runtime = makeRuntime({ storeDir: join(root, 'store-conc') }, fsPromises, events);
    const dir = makeRepo({ 'a.ts': A });
    const restore = await denyRead(join(dir, 'a.ts'));
    try {
      const settled = await Promise.all([runtime.readIndex(dir), runtime.readIndex(dir), runtime.readIndex(dir)]);
      expect(settled.every((s) => s.ready === false)).toBe(true);
      // The concurrent polls shared a single build: exactly one failure.
      await waitForFailures(events, 1);
      expect(events.filter((event) => event.state === 'failed').length).toBe(1);
      await expect(runtime.readIndex(dir, { block: true, refresh: true })).rejects.toThrow('no readable source files');
      // An explicit refresh retries the doomed build (documented
      // refresh-retries contract) and fails a second time.
      await waitForFailures(events, 2);
      expect(events.filter((event) => event.state === 'failed').length).toBe(2);
    } finally {
      await restore();
    }
  }, 120000);

  it('restores the same generation number across instances sharing one store', async () => {
    // Partials never persist (persistEntry skips truncated entries so a
    // partial can neither overwrite nor pose as a complete generation),
    // but complete builds must agree on numbering: without adopting the
    // persisted number, every fresh instance would mint local generation 1.
    const storeDir = join(root, 'store-restore');
    const dir = makeRepo({ 'a.ts': A, 'b.ts': B });
    const first = makeRuntime({ storeDir });
    await first.readIndex(dir, { block: true });
    writeFileSync(join(dir, 'b.ts'), 'import { add } from "./a";\n\nexport function sprint(): number { return add(5, 6); }\n');
    const second = await first.readIndex(dir, { block: true, refresh: true });
    expect(second.ready).toBe(true);
    expect(second.generation).toBe(2);

    const fresh = makeRuntime({ storeDir });
    const revived = await fresh.readIndex(dir);
    expect(revived.ready).toBe(true);
    expect(revived.generation).toBe(2);
    const found = await fresh.query(dir, { kind: 'search', query: 'sprint' });
    expect(found.items.some((item) => item.name === 'sprint')).toBe(true);
  }, 120000);

  it('recovers the unreadable file on explicit retry after access is restored', async () => {
    const runtime = makeRuntime({ storeDir: join(root, 'store-retry') });
    const dir = makeRepo({ 'a.ts': A, 'b.ts': B });
    const restore = await denyRead(join(dir, 'b.ts'));
    try {
      const partial = await runtime.readIndex(dir, { block: true, refresh: true });
      expect(partial.ready).toBe(true);
      expect(partial.incremental?.unreadableFileCount).toBe(1);
    } finally {
      await restore();
    }
    const recovered = await runtime.readIndex(dir, { block: true, refresh: true });
    expect(recovered.ready).toBe(true);
    expect(recovered.incremental?.unreadableFileCount ?? 0).toBe(0);
    const found = await runtime.query(dir, { kind: 'search', query: 'beta' });
    expect(found.items.some((item) => item.name === 'beta')).toBe(true);
  }, 120000);
});
