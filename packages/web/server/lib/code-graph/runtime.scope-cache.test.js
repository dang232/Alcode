import { execFileSync } from 'node:child_process';
import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime, resolveIndexScope } from './runtime.js';

/**
 * Scope-root consistency and truncated-index safety.
 *
 * Two defects, proven by the cg-repro probes, lived in `ensureIndex`:
 *
 * 1. The cache lookup keyed the requested-directory string and recomputed the
 *    revision on it, while the build walked and bound the resolved scope root.
 *    In auto mode on a subdirectory those are different roots with different
 *    bindings (content vs git-head), so an unchanged, already-indexed scope
 *    rebuilt on every open instead of reusing the cache.
 * 2. A truncated cached entry was never servable, so an over-cap scope
 *    rebuilt its multi-minute job on every open - and a truncated build was
 *    served back labelled fresh.
 *
 * Every case below drives the real engine bundle over a real temp directory,
 * so the scope resolution, the reuse, and the truncation labels are proven
 * from the production path rather than from fixtures that assume it. No case
 * asserts on wall-clock time: reuse is proven by generation identity plus the
 * absence of build progress, which is deterministic.
 */

const root = mkdtempSync(join(tmpdir(), 'code-graph-scope-cache-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const posixLower = (value) => String(value ?? '').replace(/\\/g, '/').toLowerCase();

const commitAll = (dir, message) => {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.email=qa@example.test', '-c', 'user.name=qa', 'commit', '-m', message],
    { cwd: dir, stdio: 'ignore' },
  );
};

let seq = 0;
const makeRepo = (files) => {
  const dir = join(root, `scope-${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  commitAll(dir, 'init');
  return dir;
};

// Blocking is requested per call (not via `blockOnRead`) so the same runtime
// can prove both the blocking builds and the non-blocking serves.
const makeRuntime = (events, options = {}) =>
  createCodeGraphRuntime({ fsPromises, path }, { ...options, onProgress: (event) => events.push(event) });

describe('scope-root canonicalization', () => {
  it('auto mode resolves a subdirectory to the repo root, directory mode keeps it', async () => {
    const repo = makeRepo({ 'sub/a.ts': 'export const alpha = 1;\n' });
    const sub = join(repo, 'sub');

    const auto = await resolveIndexScope({ fsPromises, path }, sub, 'auto');
    expect(posixLower(auto.scopeRoot)).toBe(posixLower(repo));
    expect(auto.mode).toBe('repo');

    const direct = await resolveIndexScope({ fsPromises, path }, sub, 'directory');
    expect(posixLower(direct.scopeRoot)).toBe(posixLower(sub));
    expect(direct.mode).toBe('directory');
  });

  it('a subdirectory open reuses the repo-root build instead of rebuilding', async () => {
    const repo = makeRepo({
      'sub/a.ts': 'export const alpha = 1;\n',
      'sub/b.ts': 'export const beta = 2;\n',
    });
    const sub = join(repo, 'sub');
    const events = [];
    const runtime = makeRuntime(events);

    const fromRoot = await runtime.readIndex(repo, { block: true });
    expect(fromRoot.ready).toBe(true);
    expect(fromRoot.freshness).toBe('fresh');
    expect(posixLower(fromRoot.scopeRoot)).toBe(posixLower(repo));
    const built = events.filter((event) => event.state === 'discovering' || event.state === 'analyzing');
    expect(built.length).toBeGreaterThan(0);

    // Repeat opens of the same scope - via the subdirectory, with and
    // without a trailing separator - reuse the build: identical generation,
    // identical revision, and no new build progress at all.
    events.length = 0;
    const fromSub = await runtime.readIndex(sub, { block: true });
    expect(fromSub.ready).toBe(true);
    expect(fromSub.freshness).toBe('fresh');
    expect(fromSub.generation).toBe(fromRoot.generation);
    expect(fromSub.revision).toBe(fromRoot.revision);
    expect(posixLower(fromSub.scopeRoot)).toBe(posixLower(repo));
    expect(events.filter((event) => event.state === 'discovering' || event.state === 'analyzing')).toEqual([]);

    events.length = 0;
    const fromSubSlash = await runtime.readIndex(sub + path.sep, { block: true });
    expect(fromSubSlash.generation).toBe(fromRoot.generation);
    expect(events.filter((event) => event.state === 'discovering' || event.state === 'analyzing')).toEqual([]);

    // Directory mode is a different scope: it keeps the requested dir and
    // builds its own generation instead of aliasing the repo root's.
    events.length = 0;
    const directoryScoped = await runtime.readIndex(sub, { block: true, scopeMode: 'directory' });
    expect(directoryScoped.ready).toBe(true);
    expect(posixLower(directoryScoped.scopeRoot)).toBe(posixLower(sub));
    expect(directoryScoped.generation).not.toBe(fromRoot.generation);

    // ...and the directory scope reuses its own build on repeat opens.
    events.length = 0;
    const directoryAgain = await runtime.readIndex(sub, { block: true, scopeMode: 'directory' });
    expect(directoryAgain.generation).toBe(directoryScoped.generation);
    expect(events.filter((event) => event.state === 'discovering' || event.state === 'analyzing')).toEqual([]);
  }, 120_000);
});

describe('truncated scope with a previous complete generation', () => {
  it('serves the previous complete graph labelled stale while a rebuild runs or fails', async () => {
    const dir = makeRepo({
      'a.ts': 'export const alpha = 1;\n',
      'b.ts': 'export const beta = 2;\n',
    });
    const events = [];
    const runtime = makeRuntime(events);

    const complete = await runtime.readIndex(dir, { block: true, maxEntryFiles: 10 });
    expect(complete.ready).toBe(true);
    expect(complete.truncated).toBe(false);
    expect(complete.freshness).toBe('fresh');

    // A non-blocking refresh starts a rebuild and meanwhile serves the
    // previous complete generation explicitly labelled stale.
    events.length = 0;
    const pending = await runtime.readIndex(dir, { refresh: true });
    expect(pending.ready).toBe(false);
    expect(pending.generation).toBe(complete.generation);
    expect(pending.freshness).toBe('stale');
    expect(pending.staleReason).toBe('rebuild-pending');

    // Joining a refresh build publishes a newer complete generation: the
    // explicit refresh supersedes the running build and rebuilds instead
    // of re-serving the current one (no cap distinguishes them anymore).
    const rebuilt = await runtime.readIndex(dir, { block: true, refresh: true });
    expect(rebuilt.ready).toBe(true);
    expect(rebuilt.freshness).toBe('fresh');
    expect(rebuilt.generation).toBeGreaterThan(complete.generation);
  }, 120_000);

  it('serves the previous complete graph labelled stale when a rebuild fails', async () => {
    // Two TypeScript projects so the engine reports per-project progress:
    // cancelling from the progress callback lands deterministically inside
    // the synchronous build, exercising the same catch path as a genuine
    // build failure (the job ends without publishing either way).
    const dir = join(root, `cancel-scope-${seq++}`);
    for (const pkg of ['alpha', 'beta']) {
      mkdirSync(join(dir, 'packages', pkg, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'packages', pkg, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler' },
          include: ['src'],
        }),
      );
    }
    writeFileSync(join(dir, 'packages', 'alpha', 'src', 'alpha.ts'), 'export function alphaFn(): number {\n  return 1;\n}\n');
    writeFileSync(join(dir, 'packages', 'beta', 'src', 'beta.ts'), 'export function betaFn(): number {\n  return 2;\n}\n');

    const seen = [];
    let armed = false;
    let cancelled = false;
    const cancelling = createCodeGraphRuntime(
      { fsPromises, path },
      {
        onProgress: (event) => {
          seen.push(event);
          if (armed && !cancelled && (event.state === 'discovering' || event.state === 'analyzing')) {
            cancelled = true;
            cancelling.cancelIndex(dir);
          }
        },
      },
    );

    const complete = await cancelling.readIndex(dir, { block: true });
    expect(complete.ready).toBe(true);
    expect(complete.freshness).toBe('fresh');
    expect(complete.truncated).toBe(false);

    // A refresh that fails never erases the previous complete graph: the
    // read serves it labelled stale with the failure attached, instead of
    // throwing or serving nothing.
    armed = true;
    const failed = await cancelling.readIndex(dir, { block: true, refresh: true });
    expect(cancelled).toBe(true);
    expect(failed.ready).toBe(true);
    expect(failed.freshness).toBe('stale');
    expect(failed.staleReason).toBe('rebuild-failed');
    expect(failed.generation).toBe(complete.generation);
    expect(failed.refreshError).toEqual(expect.any(String));

    // The failed attempt started no replacement: the next plain open serves
    // the same complete generation fresh with no rebuild.
    seen.length = 0;
    armed = false;
    const after = await cancelling.readIndex(dir, { block: true });
    expect(after.freshness).toBe('fresh');
    expect(after.generation).toBe(complete.generation);
    expect(seen.filter((event) => event.state === 'discovering' || event.state === 'analyzing')).toEqual([]);
  }, 120_000);

  it('legacy caps are ignored: every read serves one fresh complete generation', async () => {
    const dir = makeRepo({
      'a.ts': 'export const alpha = 1;\n',
      'b.ts': 'export const beta = 2;\n',
    });
    const events = [];
    const runtime = makeRuntime(events);

    const complete = await runtime.readIndex(dir, { block: true, maxEntryFiles: 10 });
    expect(complete.truncated).toBe(false);
    expect(complete.freshness).toBe('fresh');
    expect(complete.excludedCount).toBe(0);
    expect(complete.entryCount).toBe(2);

    // A legacy per-call cap binds nothing: the same complete generation
    // serves fresh with no rebuild.
    events.length = 0;
    const second = await runtime.readIndex(dir, { block: true, maxEntryFiles: 1 });
    expect(second.truncated).toBe(false);
    expect(second.freshness).toBe('fresh');
    expect(second.excludedCount).toBe(0);
    expect(second.generation).toBe(complete.generation);
    expect(events.filter((event) => event.state === 'discovering' || event.state === 'analyzing')).toEqual([]);

    // Reopening under the earlier cap finds the same complete generation
    // (same revision) and serves it fresh - no rebuild.
    events.length = 0;
    const switchback = await runtime.readIndex(dir, { block: true, maxEntryFiles: 10 });
    expect(switchback.freshness).toBe('fresh');
    expect(switchback.truncated).toBe(false);
    expect(switchback.generation).toBe(complete.generation);
    expect(events.filter((event) => event.state === 'discovering' || event.state === 'analyzing')).toEqual([]);
  }, 120_000);
});

describe('uncapped-only scope', () => {
  it('serves a fresh complete generation and reuses it on every open', async () => {
    const dir = makeRepo({
      'a.ts': 'export const alpha = 1;\n',
      'b.ts': 'export const beta = 2;\n',
      'c.ts': 'export const gamma = 3;\n',
    });
    const events = [];
    const runtime = makeRuntime(events, { maxEntryFiles: 1 });

    const first = await runtime.readIndex(dir, { block: true });
    expect(first.ready).toBe(true);
    // Advertised as fresh and complete: the legacy runtime cap binds nothing.
    expect(first.truncated).toBe(false);
    expect(first.indexTruncated).toBe(false);
    expect(first.truncationReason).toBe(null);
    expect(first.excludedCount).toBe(0);
    expect(first.entryCount).toBe(3);
    expect(first.entryCap).toBe(null);
    expect(first.freshness).toBe('fresh');

    // Queries answer at full coverage on a complete index.
    const explore = await runtime.query(dir, { kind: 'explore' });
    expect(explore.coverage).toBe('indexed');
    expect(explore.unresolved.some((line) => line.includes('index incomplete'))).toBe(false);

    // Repeat opens of the unchanged scope reuse the entry - same
    // generation, no build progress - in both modes.
    events.length = 0;
    const second = await runtime.readIndex(dir, { block: true });
    expect(second.generation).toBe(first.generation);
    expect(second.freshness).toBe('fresh');
    expect(events.filter((event) => event.state === 'discovering' || event.state === 'analyzing')).toEqual([]);

    events.length = 0;
    const passive = await runtime.readIndex(dir, {});
    expect(passive.ready).toBe(true);
    expect(passive.generation).toBe(first.generation);
    expect(passive.freshness).toBe('fresh');
    expect(events.filter((event) => event.state === 'discovering' || event.state === 'analyzing')).toEqual([]);
  }, 120_000);
});

describe('project config and ignore scope rules (S7)', () => {
  const walkRels = (walk, scope) => walk.entries.map((e) => path.relative(scope, e).split(path.sep).join('/')).sort();

  it('committed files need exclude: gitignore does not drop them', async () => {
    const dir = makeRepo({
      'tracked.ts': 'export const tracked = 1;\n',
      'gen/out.ts': 'export const out = 1;\n',
    });
    writeFileSync(join(dir, '.gitignore'), 'tracked.ts\ngen/out.ts\n');
    const runtime = makeRuntime([]);
    // Both files are committed, so the ignore file cannot drop them.
    const immune = await runtime.listEntryFiles(dir, 50);
    expect(walkRels(immune, dir)).toEqual(['gen/out.ts', 'tracked.ts']);
    expect(immune.excludedCount).toBe(0);
    expect(immune.gitignoreFiles).toEqual(['.gitignore']);
    // An explicit config exclude removes the committed path.
    writeFileSync(join(dir, 'codegraph.json'), JSON.stringify({ exclude: ['gen/**'] }));
    const excluded = await runtime.listEntryFiles(dir, 50);
    expect(walkRels(excluded, dir)).toEqual(['tracked.ts']);
    expect(excluded.excludedCount).toBe(1);
    expect(excluded.truncationReason).toBe('project-config');
    expect(excluded.excludedSample).toContain('gen/out.ts');
  });

  it('nested-repo boundary holds despite include', async () => {
    const parent = join(root, `s7-nested-${seq++}`);
    mkdirSync(join(parent, 'repoA', '.git'), { recursive: true });
    writeFileSync(join(parent, 'repoA', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(parent, 'top.ts'), 'export const t = 1;\n');
    writeFileSync(join(parent, 'codegraph.json'), JSON.stringify({ include: ['repoA/**'] }));
    const runtime = makeRuntime([]);
    const walk = await runtime.listEntryFiles(parent, 50);
    expect(walkRels(walk, parent)).toEqual(['top.ts']);
    expect(walk.nestedRepoRoots).toContain('repoA');
  });

  it('served index reflects config bucket moves and rollback restores them', async () => {
    const dir = makeRepo({
      'a.ts': 'export const alpha = 1;\n',
      'b.ts': 'export const beta = 2;\n',
    });
    const events = [];
    const runtime = makeRuntime(events);
    const complete = await runtime.readIndex(dir, { block: true });
    expect(complete.ready).toBe(true);
    expect(complete.freshness).toBe('fresh');
    expect(complete.excludedCount).toBe(0);
    // Excluding one file rebuilds (the config joins the revision) and the
    // served index names the gap the S1/S6 surfaces render. A config
    // exclusion is configuration, not truncation: the walk decided every
    // file, so the graph stays fresh and answers completely.
    writeFileSync(join(dir, 'codegraph.json'), JSON.stringify({ exclude: ['b.ts'] }));
    events.length = 0;
    const moved = await runtime.readIndex(dir, { block: true });
    expect(moved.ready).toBe(true);
    expect(moved.generation).toBeGreaterThan(complete.generation);
    expect(moved.freshness).toBe('fresh');
    expect(moved.excludedCount).toBe(1);
    expect(moved.truncationReason).toBe('project-config');
    expect(moved.excludedSample).toContain('b.ts');
    // A scope first built under a config indexes the same way: complete
    // answers, with the exclusion named instead of downgrading coverage.
    const fresh = makeRepo({
      'a.ts': 'export const alpha = 1;\n',
      'b.ts': 'export const beta = 2;\n',
    });
    writeFileSync(join(fresh, 'codegraph.json'), JSON.stringify({ exclude: ['b.ts'] }));
    const first = await runtime.readIndex(fresh, { block: true });
    expect(first.ready).toBe(true);
    expect(first.freshness).toBe('fresh');
    const explore = await runtime.query(fresh, { kind: 'explore' });
    expect(explore.coverage).toBe('indexed');
    // Rollback is deleting the file. The config-excluded generation was
    // persisted in its place, so the store holds no generation matching the
    // restored revision and the scope rebuilds once. That is still far cheaper
    // than the old behaviour, where a policy exclusion was never persisted and
    // every open rebuilt the whole scope.
    await fsPromises.rm(join(dir, 'codegraph.json'), { force: true });
    events.length = 0;
    const restored = await runtime.readIndex(dir, { block: true });
    expect(restored.ready).toBe(true);
    expect(restored.freshness).toBe('fresh');
    expect(restored.excludedCount).toBe(0);
    expect(restored.generation).toBeGreaterThan(complete.generation);
  }, 120_000);
});
