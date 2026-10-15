/**
 * Verify the staged (or packaged) internal ulw-loop CLI.
 *
 * `--staged` checks `resources/ulw-loop-cli/cli.js` (what
 * `prepare-ulw-loop-cli.mjs` produces). `--packaged` walks
 * `packages/electron/dist` for the same file inside built app output.
 * Both modes assert the file exists and answers `ulw-loop help` with the
 * expected command table. Mirrors `verify-opencode-cli.mjs`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');

const assertCli = (cliPath) => {
  if (!fs.existsSync(cliPath)) {
    throw new Error(`Internal ulw-loop CLI not found: ${cliPath}`);
  }
  const directivePath = path.join(path.dirname(cliPath), '..', 'directive.md');
  if (!fs.existsSync(directivePath)) {
    throw new Error(`Internal ulw-loop directive missing next to CLI: ${directivePath}`);
  }
  const stat = fs.statSync(cliPath);
  if (!stat.isFile()) {
    throw new Error(`Internal ulw-loop CLI is not a file: ${cliPath}`);
  }
  const result = spawnSync(process.execPath, [cliPath, 'ulw-loop', 'help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${String(result.stderr).trim()}` : '';
    throw new Error(`Internal ulw-loop CLI failed its help run: ${cliPath}${stderr}`);
  }
  if (!/create-goals/.test(String(result.stdout))) {
    throw new Error(`Internal ulw-loop CLI help output unexpected: ${cliPath}`);
  }
  console.log(`[electron] verified internal ulw-loop CLI: ${cliPath}`);
};

const findPackagedClis = () => {
  const found = [];
  const distDir = path.join(electronRoot, 'dist');
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
      if (entry.name === 'cli.js' && path.basename(path.dirname(fullPath)) === 'dist' && path.basename(path.dirname(path.dirname(fullPath))) === 'ulw-loop-cli') {
        found.push(fullPath);
      }
    }
  };
  visit(distDir);
  return found;
};

const usage = () => {
  console.error('Usage: node scripts/verify-ulw-loop-cli.mjs --staged|--packaged');
  process.exit(2);
};

const main = () => {
  const mode = process.argv[2];
  if (mode !== '--staged' && mode !== '--packaged') usage();

  if (mode === '--staged') {
    assertCli(path.join(electronRoot, 'resources', 'ulw-loop-cli', 'dist', 'cli.js'));
    return;
  }

  const packagedClis = findPackagedClis();
  if (packagedClis.length === 0) {
    throw new Error('No packaged internal ulw-loop CLI found under packages/electron/dist');
  }
  for (const packagedCli of packagedClis) {
    assertCli(packagedCli);
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
