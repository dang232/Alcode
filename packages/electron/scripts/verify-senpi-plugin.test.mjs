import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findTaskDaemonContractMismatch } from './verify-senpi-plugin.mjs';

const roots = [];

const fixture = (protocolVersion, pluginCapabilities, engineCapabilities) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-contract-'));
  roots.push(root);
  const pluginDir = path.join(root, 'plugin', 'extensions');
  const engineDir = path.join(root, 'engine', 'dist', 'bundle');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(engineDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'omo-task.js'),
    `decideHostAction({ protocolVersion: ${protocolVersion}, requiredCapabilities: ${JSON.stringify(pluginCapabilities)} })`,
  );
  fs.writeFileSync(
    path.join(engineDir, 'host.js'),
    `const HOST_PROTOCOL_VERSION = ${protocolVersion}; const REQUIRED_HOST_CAPABILITIES = ${JSON.stringify(engineCapabilities)};`,
  );
  return [path.join(root, 'plugin'), path.join(root, 'engine')];
};

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('accepts a plugin and engine with the same task-daemon contract', () => {
  const [plugin, engine] = fixture(3, ['task.start', 'task.output'], ['task.start', 'task.output']);
  assert.equal(findTaskDaemonContractMismatch(plugin, engine), undefined);
});

test('refuses a protocol version mismatch', () => {
  const [plugin, engine] = fixture(4, ['task.start'], ['task.start']);
  fs.writeFileSync(
    path.join(engine, 'dist', 'bundle', 'host.js'),
    'const HOST_PROTOCOL_VERSION = 3; const REQUIRED_HOST_CAPABILITIES = ["task.start"];',
  );
  assert.match(findTaskDaemonContractMismatch(plugin, engine) ?? '', /protocol versions differ/);
});

test('refuses a required-capability mismatch', () => {
  const [plugin, engine] = fixture(3, ['task.start'], ['task.start', 'task.monitor']);
  assert.match(findTaskDaemonContractMismatch(plugin, engine) ?? '', /capabilities differ/);
});
