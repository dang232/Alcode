import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const workflowPath = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url));
const workflow = yaml.parse(fs.readFileSync(workflowPath, 'utf8'));

test('release verifies checks before platform builds ship untested code', () => {
  const verify = workflow.jobs.verify;
  assert.equal(verify.needs, 'create-release');
  assert.equal(verify['runs-on'], 'ubuntu-latest');
  assert.deepEqual(
    verify.steps.map((step) => step.run).filter(Boolean),
    ['bun install --frozen-lockfile', 'bun run type-check', 'bun run lint', 'bun run test'],
  );
  for (const job of [
    'build-desktop-electron-macos',
    'build-desktop-electron-windows',
    'build-desktop-electron-linux',
  ]) {
    assert.deepEqual(workflow.jobs[job].needs, ['create-release', 'verify']);
  }
});

test('manifests combine after partial build failures while publication stays strict', () => {
  assert.equal(
    workflow.jobs['combine-electron-manifests'].if,
    "${{ !cancelled() && needs.create-release.result == 'success' }}",
  );
  // Skipped jobs count as done; any failure still stops the release.
  assert.equal(workflow.jobs['finalize-release'].if, "${{ !cancelled() && !failure() }}");
});
