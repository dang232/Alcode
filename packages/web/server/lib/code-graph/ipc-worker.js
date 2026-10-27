/**
 * Code-graph worker process.
 *
 * The index is the most expensive thing this product does: a large monorepo
 * measured 265 s of wall time and ~1.3 GB of retained heap for one build. Run
 * in the app's own process, that heap and that CPU land on the desktop shell.
 * Run here, the graph lives in a process the app can cancel with a kill and
 * forget on exit.
 *
 * Protocol: `{ id, op, ...args }` in, `{ id, ok, result | error }` out, plus
 * unsolicited `{ event: 'progress', progress }` messages while a build runs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createCodeGraphRuntime } from './runtime.js';

const runtimeOptions = {
  maxEntryFiles: process.env.ALCODE_CODE_GRAPH_MAX_ENTRIES
    ? Number(process.env.ALCODE_CODE_GRAPH_MAX_ENTRIES)
    : undefined,
  // Warm opens read the persisted generation from here; an unset directory
  // simply means the store is off and every open rebuilds.
  storeDir: process.env.ALCODE_CODE_GRAPH_STORE ?? '',
  onProgress: (progress) => {
    // Progress is posted from inside the synchronous build; the message is
    // queued and delivered on the host's own loop, so a long phase still
    // reports as it completes phases rather than after everything.
    process.send?.({ event: 'progress', progress });
  },
};

const runtime = createCodeGraphRuntime({ fsPromises: fs, path, execFile }, runtimeOptions);

const OPS = {
  normalizeDirectory: (args) => runtime.normalizeDirectory(args.directory),
  deriveScopeIds: (args) => runtime.deriveScopeIds(args.directory),
  readIndex: (args) => runtime.readIndex(args.directory, args.options ?? {}),
  query: (args) => runtime.query(args.directory, args.input ?? {}),
  resolveFile: (args) => runtime.resolveFile(args.directory, args.file),
  indexState: (args) => runtime.indexState(args.directory),
  cancelIndex: (args) => runtime.cancelIndex(args.directory),
  awaitIndex: (args) => runtime.awaitIndex(args.directory, args.options ?? {}),
  seedSnapshot: (args) => runtime.seedSnapshot(args.directory, args.entry),
};

process.on('message', async (message) => {
  const { id, op } = message ?? {};
  if (!op) return;
  if (op === 'shutdown') {
    process.send?.({ id, ok: true, result: { stopped: true } });
    setImmediate(() => process.exit(0));
    return;
  }
  const handler = OPS[op];
  if (!handler) {
    process.send?.({ id, ok: false, error: `unknown op: ${op}` });
    return;
  }
  try {
    const result = await handler(message);
    process.send?.({ id, ok: true, result });
  } catch (error) {
    process.send?.({
      id,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});

process.on('uncaughtException', (error) => {
  process.send?.({ event: 'fatal', error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  process.send?.({ event: 'fatal', error: reason instanceof Error ? reason.message : String(reason) });
  process.exit(1);
});

process.send?.({ event: 'ready', pid: process.pid });
