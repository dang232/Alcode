import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createCodeGraphRuntime } from './runtime.js';

/**
 * A partial build must never be served as a generation.
 *
 * The engine hands `onPartialSnapshot` the graph accumulated after each finished
 * project, so a progress reader can show what is analysed so far. That
 * projection is by construction missing every project not yet analysed: on the
 * fixture below it holds 3 nodes while the completed graph holds 6.
 *
 * The runtime used to write that projection into the map `readIndex` serves
 * from. While a build ran, the job registry shadowed it, so nothing leaked.
 * The leak appeared the moment a build ended WITHOUT publishing: a cancelled
 * or failed build left only the projection in the map, and the next read
 * served it as the current graph - `ready: true`, `freshness: 'stale'`,
 * `nodeCount: 3`. Half a graph, presented as the whole graph, and the previous
 * complete generation destroyed in the process.
 *
 * These cases pin both halves of the invariant: a projection is never a
 * generation, and a build that does not publish leaves the last good one alone.
 */

const root = mkdtempSync(join(tmpdir(), 'code-graph-partial-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Two TypeScript projects (one tsconfig per package) so the engine takes at
// least one `onPartialSnapshot` call with projectsTotal > 1.
const makeMonorepo = (name) => {
  const dir = join(root, name);
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
  return dir;
};

const completeNodeCount = async (name) => {
  const runtime = createCodeGraphRuntime({ fsPromises, path }, { blockOnRead: true });
  return (await runtime.readIndex(makeMonorepo(name))).nodeCount;
};

describe('a partial build is never served as a generation', () => {
  it('a cancelled build leaves no graph behind and never reports a smaller one as ready', async () => {
    const complete = await completeNodeCount('reference');
    expect(complete).toBeGreaterThan(0);

    const dir = makeMonorepo('cancelled');
    let runtime;
    let cancelled = false;
    runtime = createCodeGraphRuntime(
      { fsPromises, path },
      {
        blockOnRead: true,
        onProgress: (event) => {
          // Cancel once every project is analysed but before the build can
          // publish: the projection is already in hand at this instant, which
          // is exactly the state that used to leak.
          if (!cancelled && event.state === 'analyzing' && event.projectsTotal > 0 && event.projectsDone >= event.projectsTotal) {
            cancelled = true;
            runtime.cancelIndex(dir);
          }
        },
      },
    );

    await runtime.readIndex(dir).catch(() => null);
    expect(cancelled).toBe(true);

    // The cancelled build published nothing, so a read must either rebuild or
    // report that nothing is ready - never answer with the projection.
    const after = await runtime.readIndex(dir).catch(() => null);
    if (after !== null && after.ready === true) {
      expect(after.nodeCount).toBe(complete);
    }
  }, 180000);

  it('a cancelled build keeps the previous complete generation intact', async () => {
    const dir = makeMonorepo('preserved');
    let runtime;
    let armed = false;
    let cancelled = false;
    runtime = createCodeGraphRuntime(
      { fsPromises, path },
      {
        blockOnRead: true,
        onProgress: (event) => {
          if (armed && !cancelled && event.state === 'analyzing' && event.projectsTotal > 0 && event.projectsDone >= event.projectsTotal) {
            cancelled = true;
            runtime.cancelIndex(dir);
          }
        },
      },
    );

    const first = await runtime.readIndex(dir);
    const goodNodes = first.nodeCount;
    expect(goodNodes).toBeGreaterThan(0);

    // A refresh that gets cancelled must not replace the good graph with its
    // own half-built projection.
    armed = true;
    await runtime.readIndex(dir, { refresh: true }).catch(() => null);
    expect(cancelled).toBe(true);

    const after = await runtime.readIndex(dir);
    expect(after.ready).toBe(true);
    expect(after.nodeCount).toBe(goodNodes);
  }, 180000);
});
