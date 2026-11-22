/**
 * Stage the senpi engine the supervised task host runs on, together with its dependency closure.
 *
 * Two failures shaped this script:
 *
 * 1. A packaged install carries no node_modules, so `require.resolve("@code-yeongyu/senpi/dist/bundle/cli.js")`
 *    fails inside the asar and supervisor.engineCandidates falls through to a globally installed engine, which
 *    runs its own startup phases and dies (`phase=public_verified`).
 * 2. Staging `dist/bundle` alone is not enough either: the engine hands itself off to
 *    `<agent dir>/runtime/<hash>/dist/bundle/` and its bare imports resolve by walking up from there, so a
 *    bundle-only stage dies with `ERR_MODULE_NOT_FOUND: @earendil-works/chord` and retries forever.
 *
 * The engine is therefore staged in a real package layout,
 * `<out>/node_modules/@code-yeongyu/senpi/{package.json,dist}` with every declared dependency copied beside it
 * into `<out>/node_modules/`, so resolution from
 * `…/node_modules/@code-yeongyu/senpi/dist/bundle/chunks/` walks up into the staged tree. The script fails closed
 * unless `@earendil-works/chord` — the package that actually crashed the host — resolves from the staged engine.
 *
 * Sources: the workspace engine by default, or `OMO_SENPI_ENGINE_SRC` (the engine package directory, e.g. a
 * complete global install) when the workspace copy has no installed dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronRoot, '..', '..');
const outputDir = path.join(electronRoot, 'resources', 'senpi-engine');
const ENGINE_NAME = '@code-yeongyu/senpi';
const REQUIRED_DEPENDENCY = '@earendil-works/chord';
const MAX_DEPTH = 4;

const sourceCandidates = [
  process.env.OMO_SENPI_ENGINE_SRC ? path.resolve(process.env.OMO_SENPI_ENGINE_SRC) : undefined,
  path.join(repoRoot, 'node_modules', ENGINE_NAME),
  process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm', 'node_modules', 'omo-ai', 'node_modules', ENGINE_NAME)
    : undefined,
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

// A source is usable only if its own dependency closure resolves: the workspace engine declares 29 dependencies
// that this checkout never installs, so copying it produces a host that cannot import itself.
const sourceResolves = (candidate) => {
  const manifest = path.join(candidate, 'package.json');
  if (!fs.existsSync(manifest)) return false;
  try {
    createRequire(manifest).resolve(`${REQUIRED_DEPENDENCY}/package.json`);
    return true;
  } catch {
    return false;
  }
};

const sourceDir = sourceCandidates.find(sourceResolves);
if (sourceDir === undefined) {
  console.error(
    `[prepare-senpi-engine] no engine source can import ${REQUIRED_DEPENDENCY}; tried ${sourceCandidates.join(', ')}. ` +
      'Set OMO_SENPI_ENGINE_SRC to an engine package whose dependencies are installed.',
  );
  process.exit(1);
}

const fail = (message) => {
  console.error(`[prepare-senpi-engine] ${message}`);
  process.exit(1);
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
  fail(`engine source has no package.json: ${sourceDir} (set OMO_SENPI_ENGINE_SRC)`);
}
const sourceEntry = path.join(sourceDir, 'dist', 'bundle', 'cli.js');
if (!fs.existsSync(sourceEntry)) fail(`engine entry missing in source: ${sourceEntry}`);

fs.rmSync(outputDir, { recursive: true, force: true });
const stagedModules = path.join(outputDir, 'engine', 'node_modules');
const stagedEngine = path.join(stagedModules, ENGINE_NAME);
fs.mkdirSync(stagedEngine, { recursive: true });

let files = 0;
let bytes = 0;
const copyPath = (from, to) => {
  const stats = fs.statSync(from);
  if (stats.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyPath(path.join(from, name), path.join(to, name));
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files += 1;
  bytes += stats.size;
};

// The engine itself: manifest plus the bundle it runs from.
copyPath(path.join(sourceDir, 'package.json'), path.join(stagedEngine, 'package.json'));
copyPath(path.join(sourceDir, 'dist', 'bundle'), path.join(stagedEngine, 'dist', 'bundle'));
for (const name of ['LICENSE', 'LICENSE.md', 'NOTICE', 'NOTICE.md']) {
  const candidate = path.join(sourceDir, name);
  if (fs.existsSync(candidate)) copyPath(candidate, path.join(stagedEngine, name));
}

// The closure: every declared dependency, copied beside the engine, then its own dependencies.
const staged = new Set();
let dependencies = 0;
let unresolved = [];
const stageDependencies = (fromPackageJson, depth) => {
  if (depth > MAX_DEPTH) return;
  let declared = {};
  try {
    declared = readJson(fromPackageJson)?.dependencies ?? {};
  } catch {
    return;
  }
  const requireFrom = createRequire(fromPackageJson);
  for (const name of Object.keys(declared)) {
    const target = path.join(stagedModules, name);
    if (staged.has(name)) continue;
    let resolved;
    try {
      resolved = requireFrom.resolve(`${name}/package.json`);
    } catch {
      unresolved.push(name);
      continue;
    }
    staged.add(name);
    copyPath(path.dirname(resolved), target);
    dependencies += 1;
    stageDependencies(path.join(target, 'package.json'), depth + 1);
  }
};
stageDependencies(path.join(sourceDir, 'package.json'), 0);

// The staged engine must be able to import the package that actually crashed the host.
const stagedRequire = createRequire(path.join(stagedEngine, 'package.json'));
let requiredCopy = 'missing';
try {
  stagedRequire.resolve(`${REQUIRED_DEPENDENCY}/package.json`);
  requiredCopy = 'resolves';
} catch {
  fail(
    `staged engine cannot import ${REQUIRED_DEPENDENCY}; source ${sourceDir} declares ${unresolved.length} unresolved ` +
      `dependenc${unresolved.length === 1 ? 'y' : 'ies'}${unresolved.length > 0 ? `: ${unresolved.slice(0, 6).join(', ')}` : ''}`,
  );
}

console.log(
  `[prepare-senpi-engine] staged ${files} files (${bytes} bytes) in ${dependencies} dependencies -> ${outputDir}; ` +
    `${REQUIRED_DEPENDENCY} ${requiredCopy}` +
    (unresolved.length > 0 ? `; unresolved (optional or absent): ${unresolved.slice(0, 8).join(', ')}` : ''),
);
