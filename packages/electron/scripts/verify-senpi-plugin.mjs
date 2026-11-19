import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const ENTRY = path.join('extensions', 'omo.js');
const MIN_ENTRY_BYTES = 100_000;
const REQUIRED_FILES = ['LICENSE', 'NOTICE', 'package.json'];
const PACKAGE_NAME = '@code-yeongyu/omo-senpi';

const fail = (message) => {
  console.error(`[electron] verify-senpi-plugin: ${message}`);
  process.exit(1);
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

const mode = process.argv.includes('--packaged') ? 'packaged' : 'staged';
if (mode === 'staged') {
  const { entry, entryBytes } = assertPluginDir(path.join(electronRoot, 'resources', 'senpi-plugin'));
  console.log(`[electron] staged task host plugin ok: ${entry} (${entryBytes} bytes)`);
  process.exit(0);
}

const distDir = path.join(electronRoot, 'dist');
if (!fs.existsSync(distDir)) {
  fail(`packaged output directory not found: ${distDir}`);
}
const candidates = fs.readdirSync(distDir, { withFileTypes: true })
  .filter((child) => child.isDirectory() && child.name.includes('unpacked'))
  .map((child) => path.join(distDir, child.name, 'resources', 'senpi-plugin'))
  .filter((candidate) => fs.existsSync(candidate));
if (candidates.length === 0) {
  fail(`no packaged resources/senpi-plugin under ${distDir}/*unpacked/resources`);
}
for (const candidate of candidates) {
  const { entry, entryBytes } = assertPluginDir(candidate);
  console.log(`[electron] packaged task host plugin ok: ${entry} (${entryBytes} bytes)`);
}
