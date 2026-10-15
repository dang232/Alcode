/**
 * Stage the internal ulw-loop CLI for desktop packaging.
 *
 * Builds the workspace ulw-loop component from source (so the staged copy
 * always matches this checkout) and mirrors `dist/cli.js` plus the generated
 * `directive.md` into `resources/ulw-loop-cli/` (same relative layout: the
 * bundle reads directive.md module-relative, parent of the cli file). The
 * packaged app exports the staged path as `OMO_ULW_LOOP_CLI` (see
 * `main.mjs`), which loop agents inherit and resolve internal-first via the
 * skill doc's override branch — no download, no PATH, no drive search.
 * Everything here is bounded: one component build, one file copy, one
 * `--help` smoke run. Fail-closed with a clear error, never a partial stage.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const componentDir = path.join(
  electronRoot,
  '..',
  'omo-engine',
  'omo-codex',
  'plugin',
  'components',
  'ulw-loop',
);
const outputDir = path.join(electronRoot, 'resources', 'ulw-loop-cli');
const outputFile = path.join(outputDir, 'dist', 'cli.js');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${String(result.stderr).trim()}` : '';
    const stdout = result.stdout ? `\n${String(result.stdout).trim()}` : '';
    throw new Error(`Command failed: ${command} ${args.join(' ')}${stderr}${stdout}`);
  }
  return result;
};

const main = () => {
  // `npm.cmd` needs a shell on Windows; everywhere else runs direct.
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npmCommand, ['run', 'build'], {
    cwd: componentDir,
    shell: process.platform === 'win32',
  });
  const builtFile = path.join(componentDir, 'dist', 'cli.js');
  const directiveFile = path.join(componentDir, 'directive.md');
  if (!fs.existsSync(builtFile)) {
    throw new Error(`ulw-loop dist missing after build: ${builtFile}`);
  }
  if (!fs.existsSync(directiveFile)) {
    throw new Error(`ulw-loop directive.md missing (generated, never hand-edited): ${directiveFile}`);
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.copyFileSync(builtFile, outputFile);
  fs.copyFileSync(directiveFile, path.join(outputDir, 'directive.md'));
  const smoke = run(process.execPath, [outputFile, 'ulw-loop', 'help'], {});
  if (!/create-goals/.test(String(smoke.stdout))) {
    throw new Error(`Staged ulw-loop CLI failed its help smoke run: ${outputFile}`);
  }
  console.log(`[electron] staged internal ulw-loop CLI: ${outputFile}`);
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
