import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const ENTRY = path.join('extensions', 'omo.js');
const TASK_DAEMON_ENTRY = path.join('extensions', 'omo-task.js');
const ENGINE_PACKAGE = path.join('senpi-engine', 'engine', 'node_modules', '@code-yeongyu', 'senpi');
const MIN_ENTRY_BYTES = 100_000;
const REQUIRED_FILES = ['LICENSE', 'NOTICE', 'package.json'];
const PACKAGE_NAME = '@code-yeongyu/omo-senpi';

const fail = (message) => {
  console.error(`[electron] verify-senpi-plugin: ${message}`);
  process.exit(1);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The task client in the plugin bundle calls `decideHostAction` with the protocol generation it speaks and
 * the capabilities it requires of a host. Read that pair here instead of hardcoding a version: the bundle is
 * the artifact that actually runs.
 */
export const readPluginTaskDaemonContract = (pluginDir) => {
  const file = path.join(pluginDir, TASK_DAEMON_ENTRY);
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, 'utf8');
  const call = /protocolVersion:\s*(\d+)\s*,\s*requiredCapabilities:\s*([A-Za-z_$][\w$]*|\[[^\]]*\])/.exec(text);
  if (call === null) return undefined;
  const expression = call[2].startsWith('[')
    ? call[2]
    : new RegExp(`(?:^|[^\\w$])${escapeRegExp(call[2])}\\s*=\\s*(\\[[^\\]]*\\])`).exec(text)?.[1];
  if (expression === undefined) return undefined;
  const capabilities = [...expression.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (capabilities.length === 0) return undefined;
  return { file, protocolVersion: Number(call[1]), capabilities };
};

const listJavaScriptFiles = (dir) => {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const location = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(location));
    else if (entry.name.endsWith('.js')) files.push(location);
  }
  return files;
};

const resolveCapabilityExpression = (expression, definitions) => {
  const capabilities = [];
  for (const token of expression.slice(1, -1).split(',').map((part) => part.trim()).filter(Boolean)) {
    if (token.startsWith('"')) {
      capabilities.push(token.slice(1, -1));
      continue;
    }
    const value = definitions.get(token);
    if (value === undefined) return undefined;
    capabilities.push(value);
  }
  return capabilities;
};

/**
 * The engine bundle owns the host side of the same handshake: `HOST_PROTOCOL_VERSION` and
 * `REQUIRED_HOST_CAPABILITIES` are exported by its supervisor chunk. Resolve the capability constants from
 * the bundle itself so a version bump on either side is read, never assumed.
 */
export const readEngineTaskDaemonContract = (enginePackageDir) => {
  const bundleDir = path.join(enginePackageDir, 'dist', 'bundle');
  if (!fs.existsSync(bundleDir)) return undefined;
  const protocols = new Set();
  const capabilityLists = [];
  const definitions = new Map();
  let file;
  for (const candidate of listJavaScriptFiles(bundleDir)) {
    const text = fs.readFileSync(candidate, 'utf8');
    for (const match of text.matchAll(/([A-Z][A-Z0-9_]*)\s*=\s*"([^"]{1,120})"/g)) {
      if (!definitions.has(match[1])) definitions.set(match[1], match[2]);
    }
    const protocol = /HOST_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(text);
    if (protocol !== null) {
      protocols.add(Number(protocol[1]));
      file ??= candidate;
    }
    const required = /REQUIRED_HOST_CAPABILITIES\s*=\s*(\[[^\]]*\])/.exec(text);
    if (required !== null) {
      const capabilities = resolveCapabilityExpression(required[1], definitions);
      if (capabilities === undefined) return undefined;
      capabilityLists.push(capabilities);
      file ??= candidate;
    }
  }
  if (protocols.size !== 1 || capabilityLists.length === 0) return undefined;
  const distinct = new Set(capabilityLists.map((capabilities) => JSON.stringify([...capabilities].sort())));
  if (distinct.size !== 1) return undefined;
  return { file, protocolVersion: [...protocols][0], capabilities: capabilityLists[0] };
};

/**
 * Returns an actionable message when the plugin's task-daemon contract disagrees with the engine staged
 * beside it, or `undefined` when they match. A disagreement is what makes child registration fail with
 * `HostUnavailableError` (protocol or capability) in a packaged app.
 */
export const findTaskDaemonContractMismatch = (pluginDir, enginePackageDir) => {
  const pluginEntry = path.join(pluginDir, TASK_DAEMON_ENTRY);
  const engineBundle = path.join(enginePackageDir, 'dist', 'bundle');
  const plugin = readPluginTaskDaemonContract(pluginDir);
  if (plugin === undefined) {
    return `cannot read the task-daemon contract from the plugin bundle (${pluginEntry}); `
      + 'expected its decideHostAction call to carry protocolVersion and requiredCapabilities';
  }
  const engine = readEngineTaskDaemonContract(enginePackageDir);
  if (engine === undefined) {
    return `cannot read the task-daemon contract from the engine bundle (${engineBundle}); `
      + 'expected it to export HOST_PROTOCOL_VERSION and REQUIRED_HOST_CAPABILITIES';
  }
  const pluginCapabilities = [...new Set(plugin.capabilities)].sort();
  const engineCapabilities = [...new Set(engine.capabilities)].sort();
  const pluginOnly = pluginCapabilities.filter((capability) => !engineCapabilities.includes(capability));
  const engineOnly = engineCapabilities.filter((capability) => !pluginCapabilities.includes(capability));
  if (plugin.protocolVersion === engine.protocolVersion && pluginOnly.length === 0 && engineOnly.length === 0) {
    return undefined;
  }
  const detail = plugin.protocolVersion === engine.protocolVersion
    ? `capabilities differ (plugin-only ${JSON.stringify(pluginOnly)}, engine-only ${JSON.stringify(engineOnly)})`
    : `protocol versions differ (plugin ${plugin.protocolVersion}, engine ${engine.protocolVersion})`;
  return `task-daemon contract mismatch: ${detail}. `
    + 'Child registration is refused with HostUnavailableError when these disagree. '
    + `Restage both artifacts from the same build (plugin ${plugin.file}, engine ${engine.file}; `
    + 'OMO_SENPI_PLUGIN_SRC and OMO_SENPI_ENGINE_SRC).';
};

const assertPluginDir = (pluginDir) => {
  const entry = path.join(pluginDir, ENTRY);
  if (!fs.existsSync(entry)) {
    fail(`task host plugin entry missing: ${entry}`);
  }
  const entryBytes = fs.statSync(entry).size;
  if (entryBytes < MIN_ENTRY_BYTES) {
    fail(`task host plugin entry looks truncated (${entryBytes} bytes): ${entry}`);
  }
  for (const name of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(pluginDir, name))) {
      fail(`task host plugin is missing ${name}: ${pluginDir}`);
    }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
  if (manifest?.name !== PACKAGE_NAME) {
    fail(`unexpected plugin package name ${JSON.stringify(manifest?.name)} in ${pluginDir}`);
  }
  const text = fs.readFileSync(entry, 'utf8');
  if (!/omo\.task\.(child|terminal)/.test(text)) {
    fail(`task host plugin entry does not emit the omo.task.* events: ${entry}`);
  }
  return { entry, entryBytes };
};

/**
 * Packaged outputs that carry `resources/senpi-plugin`: electron-builder's unpacked directory and the macOS
 * app bundle (`dist/mac/<App>.app` and `dist/mac-arm64/<App>.app` in the release workflow).
 */
export const packagedPluginCandidates = (distDir) => {
  if (!fs.existsSync(distDir)) return [];
  const candidates = [];
  for (const child of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const dir = path.join(distDir, child.name);
    if (child.name.includes('unpacked')) {
      candidates.push(path.join(dir, 'resources', 'senpi-plugin'));
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) {
        candidates.push(path.join(dir, entry.name, 'Contents', 'Resources', 'senpi-plugin'));
      }
    }
  }
  return candidates.filter((candidate) => fs.existsSync(candidate));
};

const main = () => {
  const mode = process.argv.includes('--packaged') ? 'packaged' : 'staged';
  if (mode === 'staged') {
    const pluginDir = path.join(electronRoot, 'resources', 'senpi-plugin');
    const { entry, entryBytes } = assertPluginDir(pluginDir);
    const mismatch = findTaskDaemonContractMismatch(pluginDir, path.join(electronRoot, 'resources', ENGINE_PACKAGE));
    if (mismatch !== undefined) fail(mismatch);
    console.log(`[electron] staged task host plugin ok: ${entry} (${entryBytes} bytes, task-daemon contract matches)`);
    return;
  }

  const distDir = path.join(electronRoot, 'dist');
  if (!fs.existsSync(distDir)) {
    fail(`packaged output directory not found: ${distDir}`);
  }
  const candidates = packagedPluginCandidates(distDir);
  if (candidates.length === 0) {
    fail(
      `no packaged resources/senpi-plugin under ${distDir}: looked in <dir>/resources/senpi-plugin `
      + 'and <dir>/<App>.app/Contents/Resources/senpi-plugin',
    );
  }
  for (const candidate of candidates) {
    const { entry, entryBytes } = assertPluginDir(candidate);
    console.log(`[electron] packaged task host plugin ok: ${entry} (${entryBytes} bytes)`);
    const resourcesDir = path.dirname(candidate);
    const engineDir = path.join(resourcesDir, 'senpi-engine', 'engine');
    const enginePackageDir = path.join(engineDir, 'node_modules', '@code-yeongyu', 'senpi');
    const engineEntry = path.join(enginePackageDir, 'dist', 'bundle', 'cli.js');
    if (!fs.existsSync(engineEntry)) {
      fail(`packaged senpi engine missing beside the plugin: ${engineEntry}`);
    }
    const engineBytes = fs.statSync(engineEntry).size;
    if (engineBytes < 10_000) {
      fail(`packaged senpi engine entry implausibly small: ${engineEntry} (${engineBytes} bytes)`);
    }
    const engineChunks = path.join(enginePackageDir, 'dist', 'bundle', 'chunks');
    const engineChunkCount = fs.existsSync(engineChunks) ? fs.readdirSync(engineChunks).length : 0;
    if (engineChunkCount === 0) {
      fail(`packaged senpi engine carries no chunks: ${engineDir}`);
    }
    // A staged bundle that cannot import its own dependencies crash-loops the host at module resolution.
    const engineRequire = createRequire(path.join(enginePackageDir, 'package.json'));
    try {
      engineRequire.resolve('@earendil-works/chord/package.json');
    } catch {
      fail(`packaged senpi engine cannot import @earendil-works/chord: ${engineDir}`);
    }
    const mismatch = findTaskDaemonContractMismatch(candidate, enginePackageDir);
    if (mismatch !== undefined) fail(mismatch);
    console.log(
      `[electron] packaged senpi engine ok: ${engineEntry} `
      + `(${engineBytes} bytes, ${engineChunkCount} chunks, closure resolves, task-daemon contract matches)`,
    );
  }
};

const invokedAsScript = (() => {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  const entry = path.resolve(invoked);
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self;
})();
if (invokedAsScript) main();
