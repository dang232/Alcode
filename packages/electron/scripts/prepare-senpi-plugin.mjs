/**
 * Stage the OmO senpi task-host plugin for desktop packaging.
 *
 * The supervised task host is started from `<plugin dir>/extensions/omo.js`
 * (see packages/web/server/lib/task-host/supervisor.js resolvePluginDir). In a
 * checkout that file resolves from the sibling oh-my-openAlcore tree, but a
 * packaged install has no sibling, so without this stage every delegation dies
 * with `task host plugin not found: extensions\omo.js` after a ~25 s wait and
 * `task` answers TASK_MANAGER_UNAVAILABLE.
 *
 * This script copies the plugin whole into `resources/senpi-plugin/` (the same
 * layout extraResources publishes as `senpi-plugin`), carrying its LICENSE and
 * NOTICE because the plugin is MIT and third-party noted. The copy is bounded:
 * node_modules is skipped, the entry point must exist and be plausibly sized,
 * and a missing source fails closed with the override named - never a partial
 * stage.
 *
 * Override the source with OMO_SENPI_PLUGIN_SRC when the engine checkout lives
 * somewhere other than `<migration root>/oh-my-openAlcore/packages/omo-senpi/plugin`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTaskDaemonContractMismatch } from './verify-senpi-plugin.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const migrationRoot = path.resolve(electronRoot, '..', '..', '..');
const outputDir = path.join(electronRoot, 'resources', 'senpi-plugin');
const ENTRY_RELATIVE = path.join('extensions', 'omo.js');
const MIN_ENTRY_BYTES = 100_000;
const LICENSE_FILES = ['LICENSE', 'NOTICE'];

const fail = (message) => {
  console.error(`[electron] prepare-senpi-plugin: ${message}`);
  process.exit(1);
};

const explicitSource = (process.env.OMO_SENPI_PLUGIN_SRC ?? '').trim();
const sourceDir = explicitSource.length > 0
  ? explicitSource
  : path.join(migrationRoot, 'oh-my-openAlcore', 'packages', 'omo-senpi', 'plugin');

const sourceEntry = path.join(sourceDir, ENTRY_RELATIVE);
if (!fs.existsSync(sourceEntry)) {
  fail(
    `source plugin not found: ${sourceEntry}\n`
    + '  the task host cannot start without it.\n'
    + '  set OMO_SENPI_PLUGIN_SRC to the omo-senpi plugin directory.',
  );
}

const countFiles = (dir) => {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    total += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1;
  }
  return total;
};

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(outputDir), { recursive: true });
fs.cpSync(sourceDir, outputDir, {
  recursive: true,
  filter: (source) => !/[\\/]node_modules([\\/]|$)/.test(source),
});

const stagedEntry = path.join(outputDir, ENTRY_RELATIVE);
if (!fs.existsSync(stagedEntry)) {
  fail(`staged plugin is missing its entry point after copy: ${stagedEntry}`);
}
const entryBytes = fs.statSync(stagedEntry).size;
if (entryBytes < MIN_ENTRY_BYTES) {
  fail(`staged entry point looks truncated (${entryBytes} bytes): ${stagedEntry}`);
}
const missingLicenses = LICENSE_FILES.filter((name) => !fs.existsSync(path.join(outputDir, name)));
if (missingLicenses.length > 0) {
  fail(`staged plugin is missing ${missingLicenses.join(', ')}: ${outputDir}`);
}

// The engine is staged after this script, so a fresh build cannot compare yet; when a staged engine is
// already present, refuse a plugin whose task-daemon protocol or capabilities it cannot serve.
const stagedEnginePackage = path.join(
  electronRoot, 'resources', 'senpi-engine', 'engine', 'node_modules', '@code-yeongyu', 'senpi',
);
let compatibility = 'engine not staged yet; verify:senpi-plugin checks the pair';
if (fs.existsSync(stagedEnginePackage)) {
  const mismatch = findTaskDaemonContractMismatch(outputDir, stagedEnginePackage);
  if (mismatch !== undefined) fail(mismatch);
  compatibility = 'task-daemon contract matches the staged engine';
}

const fileCount = countFiles(outputDir);
console.log(
  `[electron] staged senpi task-host plugin: ${outputDir} `
  + `(${fileCount} files, entry ${entryBytes} bytes, ${compatibility})`,
);
