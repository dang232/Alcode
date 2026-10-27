import { mkdtempSync, promises as fsPromises, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCodeGraphRuntime } from './runtime.js';

/**
 * Warm open: the store is only worth the bytes if a *second* process — a fresh
 * runtime with no in-memory graph — serves the graph without running the
 * compiler. These cases prove the restore path, the scope gate that refuses a
 * stale generation, and that an explicit refresh still rebuilds.
 *
 * Every case uses a real temp repository and the real engine bundle, so a
 * snapshot that cannot round-trip fails here instead of on a person's screen.
 */
const root = mkdtempSync(join(tmpdir(), 'code-graph-store-runtime-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const makeRepo = (name) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'a.ts'),
    'export function inner(): number {\n  return 1;\n}\n\nexport function outer(): number {\n  return inner();\n}\n',
  );
  return dir;
};

// The write is fire-and-forget by design, so the test waits for the artifact
// rather than sleeping a guessed amount.
const waitForManifest = async (storeDir, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const scopes = await fsPromises.readdir(storeDir).catch(() => []);
    for (const scope of scopes) {
      const manifest = join(storeDir, scope, 'manifest.json');
      const exists = await fsPromises.stat(manifest).then(() => true, () => false);
      if (exists) return manifest;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`no manifest appeared under ${storeDir}`);
};

const makeRuntime = (storeDir, events) =>
  createCodeGraphRuntime(
    { fsPromises, path },
    {
      blockOnRead: true,
      storeDir,
      onProgress: (event) => events.push(event.state + (event.phase ? `:${event.phase}` : '') + (event.restoredFromStore ? ':restored' : '')),
    },
  );

describe('code graph warm open', () => {
  it('a fresh runtime serves the persisted generation instead of rebuilding', async () => {
    const dir = makeRepo('warm');
    const storeDir = join(root, 'store-warm');

    const builderEvents = [];
    const builder = makeRuntime(storeDir, builderEvents);
    const built = await builder.readIndex(dir, { refresh: true });
    expect(built.ready).toBe(true);
    expect(built.nodeCount).toBeGreaterThan(0);
    await waitForManifest(storeDir);

    const readerEvents = [];
    const reader = makeRuntime(storeDir, readerEvents);
    const restored = await reader.readIndex(dir, {});

    expect(restored.ready).toBe(true);
    expect(restored.nodeCount).toBe(built.nodeCount);
    expect(restored.edgeCount).toBe(built.edgeCount);
    expect(restored.revision).toBe(built.revision);
    expect(readerEvents.some((event) => event.endsWith(':restored'))).toBe(true);
    // No compiler phases in the reader: a restored graph never runs the build.
    expect(readerEvents.some((event) => event.startsWith('analyzing'))).toBe(false);
  });

  it('a source change refuses the stored generation and rebuilds', async () => {
    const dir = makeRepo('changed');
    const storeDir = join(root, 'store-changed');

    const first = makeRuntime(storeDir, []);
    await first.readIndex(dir, { refresh: true });
    await waitForManifest(storeDir);

    writeFileSync(
      join(dir, 'a.ts'),
      'export function inner(): number {\n  return 2;\n}\n\nexport function outer(): number {\n  return inner();\n}\n',
    );

    const events = [];
    const second = makeRuntime(storeDir, events);
    const read = await second.readIndex(dir, {});

    expect(read.ready).toBe(true);
    expect(events.some((event) => event.startsWith('analyzing'))).toBe(true);
    expect(events.some((event) => event.endsWith(':restored'))).toBe(false);
  });

  it('an explicit refresh rebuilds even when a stored generation matches', async () => {
    const dir = makeRepo('refresh');
    const storeDir = join(root, 'store-refresh');

    const first = makeRuntime(storeDir, []);
    await first.readIndex(dir, { refresh: true });
    await waitForManifest(storeDir);

    const events = [];
    const second = makeRuntime(storeDir, events);
    await second.readIndex(dir, { refresh: true });

    expect(events.some((event) => event.startsWith('analyzing'))).toBe(true);
  });
});
