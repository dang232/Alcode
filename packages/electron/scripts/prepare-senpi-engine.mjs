/**
 * Stage the senpi engine the supervised task host runs on.
 *
 * The task host is spawned as `<this install> <engine cli.js> host` (see
 * packages/web/server/lib/task-host/supervisor.js engineCandidates). In a
 * checkout `require.resolve("@code-yeongyu/senpi/dist/bundle/cli.js")` finds
 * the workspace engine, but a packaged install carries no such node_modules, so
 * the supervisor silently falls through to the globally installed `omo-ai`
 * engine. That foreign build runs its own startup phases against this app's
 * plugin, reports
 *   `RPC host startup timed out: phase=public_verified; phase_budget_ms=10000`
 * exits 1, and every delegation ends in TASK_MANAGER_UNAVAILABLE after a
 * relaunch loop. Staging this app's own engine removes the fallback.
 *
 * The copy is bounded to what the bundle needs at runtime (package.json plus
 * dist/bundle: cli.js, its chunks and the skill document). It fails closed when
 * the source or the entry is missing, so a stage can never ship a host that
 * only looks present.
 *
 * Override the source with OMO_SENPI_ENGINE_SRC when the engine lives outside
 * the workspace node_modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronRoot, '..', '..');
const outputDir = path.join(electronRoot, 'resources', 'senpi-engine');
const BUNDLE_RELATIVE = path.join('dist', 'bundle');
const ENTRY_RELATIVE = path.join(BUNDLE_RELATIVE, 'cli.js');
const MIN_ENTRY_BYTES = 10_000;

const sourceDir = process.env.OMO_SENPI_ENGINE_SRC
  ? path.resolve(process.env.OMO_SENPI_ENGINE_SRC)
  : path.join(repoRoot, 'node_modules', '@code-yeongyu', 'senpi');

const fail = (message) => {
  console.error(`[prepare-senpi-engine] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(sourceDir)) {
  fail(`engine source not found: ${sourceDir} (set OMO_SENPI_ENGINE_SRC)`);
}
const sourceEntry = path.join(sourceDir, ENTRY_RELATIVE);
if (!fs.existsSync(sourceEntry)) {
  fail(`engine entry missing in source: ${sourceEntry}`);
}
if (fs.statSync(sourceEntry).size < MIN_ENTRY_BYTES) {
  fail(`engine entry implausibly small: ${sourceEntry}`);
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

let files = 0;
let bytes = 0;
const copyTree = (from, to) => {
  const stats = fs.statSync(from);
  if (stats.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyTree(path.join(from, name), path.join(to, name));
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files += 1;
  bytes += stats.size;
};

copyTree(path.join(sourceDir, 'package.json'), path.join(outputDir, 'package.json'));
copyTree(path.join(sourceDir, BUNDLE_RELATIVE), path.join(outputDir, BUNDLE_RELATIVE));
for (const name of ['LICENSE', 'LICENSE.md', 'NOTICE', 'NOTICE.md']) {
  const candidate = path.join(sourceDir, name);
  if (fs.existsSync(candidate)) copyTree(candidate, path.join(outputDir, name));
}

const stagedEntry = path.join(outputDir, ENTRY_RELATIVE);
if (!fs.existsSync(stagedEntry)) fail(`staged entry missing after copy: ${stagedEntry}`);
const stagedEntryBytes = fs.statSync(stagedEntry).size;
if (stagedEntryBytes < MIN_ENTRY_BYTES) fail(`staged entry implausibly small: ${stagedEntryBytes} bytes`);
const chunks = path.join(outputDir, BUNDLE_RELATIVE, 'chunks');
const chunkCount = fs.existsSync(chunks) ? fs.readdirSync(chunks).length : 0;
if (chunkCount === 0) fail(`staged engine has no chunks: ${chunks}`);

console.log(`[prepare-senpi-engine] staged ${files} files (${bytes} bytes), entry ${stagedEntryBytes} bytes, ${chunkCount} chunks -> ${outputDir}`);
