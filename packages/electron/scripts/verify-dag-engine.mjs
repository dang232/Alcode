/**
 * Verify the DAG pane's native engine answers from a staged or packaged
 * service bundle with no bun and no overrides on the machine.
 *
 * `--staged` boots `packages/web/server/built-in-extensions/dag-pane/service`
 * (what `extensions:build` produces). `--packaged` walks
 * `packages/electron/dist` for the same service inside built app output.
 * Both modes assert the native companions exist, boot the service under
 * plain Node with a scrubbed environment, and require the `/status` probe
 * to answer OMO_PROBE_OK with available true. Mirrors
 * `verify-ulw-loop-cli.mjs`.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronRoot, '..', '..');

const READY_TIMEOUT_MS = 15_000;
const POLL_MS = 200;

const stagedServiceDir = () => path.join(
  repoRoot, 'packages', 'web', 'server', 'built-in-extensions', 'dag-pane', 'service',
);

const findPackagedServiceDirs = () => {
  const found = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.name === 'main.js' && path.basename(path.dirname(fullPath)) === 'service'
        && path.basename(path.dirname(path.dirname(fullPath))) === 'dag-pane') {
        found.push(path.dirname(fullPath));
      }
    }
  };
  visit(path.join(electronRoot, 'dist'));
  return found;
};

const assertCompanions = (serviceDir) => {
  for (const relative of [
    'main.js',
    'worker.js',
    path.join('vendor', 'omo-engine', 'omo-opencode', 'src', 'cli', 'run', 'index.js'),
  ]) {
    const file = path.join(serviceDir, relative);
    if (!fs.existsSync(file)) {
      throw new Error(`DAG service companion missing: ${file}`);
    }
  }
};

const reserveLoopbackPort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || !('port' in address)) {
      server.close();
      reject(new Error('Could not reserve a loopback port'));
      return;
    }
    const { port } = address;
    server.close((error) => {
      if (error) reject(error);
      else resolve(port);
    });
  });
  server.on('error', reject);
});

const scrubbedEnv = (port, token) => {
  const env = {
    ALCODE_SERVICE_PORT: String(port),
    ALCODE_SERVICE_TOKEN: token,
  };
  if (process.platform === 'win32') {
    for (const name of ['SystemRoot', 'WINDIR', 'SYSTEMDRIVE']) {
      if (process.env[name]) env[name] = process.env[name];
    }
    env.PATH = 'C:\\Windows\\System32';
  } else {
    if (process.env.HOME) env.HOME = process.env.HOME;
    env.PATH = '/usr/bin:/bin';
  }
  return env;
};

const waitForReady = async (port, token) => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json', authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1500),
      });
      if (response.status === 200) return true;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
};

const verifyServiceDir = async (serviceDir) => {
  assertCompanions(serviceDir);
  const port = await reserveLoopbackPort();
  const token = randomBytes(24).toString('hex');
  const child = spawn(process.execPath, ['main.js'], {
    cwd: serviceDir,
    env: scrubbedEnv(port, token),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  try {
    if (!await waitForReady(port, token)) {
      throw new Error(`DAG service at ${serviceDir} never became ready`);
    }
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      method: 'GET',
      headers: { Accept: 'application/json', authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    const body = await response.json();
    const probe = body?.probe ?? null;
    if (!probe || probe.available !== true || probe.code !== 'OMO_PROBE_OK') {
      throw new Error(
        `DAG service at ${serviceDir} probes unavailable: ${JSON.stringify(probe)}`,
      );
    }
    console.log(`[electron] verified DAG engine: ${serviceDir} (probe OMO_PROBE_OK, no bun, no overrides)`);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.on('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
};

const usage = () => {
  console.error('Usage: node scripts/verify-dag-engine.mjs --staged|--packaged');
  process.exit(2);
};

const main = async () => {
  const mode = process.argv[2];
  if (mode !== '--staged' && mode !== '--packaged') usage();

  if (mode === '--staged') {
    await verifyServiceDir(stagedServiceDir());
    return;
  }

  const packaged = findPackagedServiceDirs();
  if (packaged.length === 0) {
    throw new Error('No packaged DAG service found under packages/electron/dist');
  }
  for (const serviceDir of packaged) {
    await verifyServiceDir(serviceDir);
  }
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
