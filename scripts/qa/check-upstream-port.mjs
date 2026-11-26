#!/usr/bin/env node
// Checks whether an upstream commit can be ported into this fork, and optionally runs its package tests.
//   node scripts/qa/check-upstream-port.mjs <hash> [--run]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const hash = process.argv[2];
if (!hash) {
  console.error('Usage: check-upstream-port.mjs <commit-hash> [--run]');
  process.exit(2);
}
const runTests = process.argv.includes('--run');
const root = process.cwd();

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const head = git('rev-parse', '--short', 'HEAD');
const subject = git('show', '-s', '--format=%s', hash);
const files = git('show', '--name-only', '--format=', hash).split('\n').filter(Boolean);
const source = files.filter((file) => /\.(ts|tsx|js|mjs)$/.test(file));
const present = source.filter((file) => fs.existsSync(path.join(root, file)));
const orphan = files.filter((file) => !fs.existsSync(path.join(root, file)));
const patch = execFileSync('git', ['show', '--format=', '--binary', hash], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const apply = spawnSync('git', ['apply', '--3way', '--check'], { cwd: root, input: patch, encoding: 'utf8' });
const applyDetail = `${apply.stdout ?? ''}${apply.stderr ?? ''}`.trim().split('\n').filter(Boolean).slice(0, 4);
const conflicted = /with conflicts/.test(`${apply.stdout ?? ''}${apply.stderr ?? ''}`);
const pkg = files.find((file) => file.startsWith('packages/'))?.split('/')[1];
const testPlans = {
  ui: ['bun', ['test', 'src']],
  web: ['bun', ['test', 'server/lib']],
  electron: ['node', ['--test', 'scripts/verify-senpi-plugin.test.mjs', 'scripts/verify-release-publication.test.mjs']],
  sdk: ['bun', ['test', 'src']],
  vscode: ['bun', ['test', 'src']],
  mobile: ['bun', ['run', 'type-check']],
};
const plan = pkg === undefined ? null : testPlans[pkg] ?? null;

console.log(`commit:       ${hash.slice(0, 10)} ${subject}`);
console.log(`fork HEAD:    ${head}`);
console.log(`source files: ${present.length}/${source.length} still exist here`);
if (orphan.length > 0) console.log(`orphan files: ${orphan.join(', ')}`);
console.log(`apply --3way: ${apply.status === 0 && !conflicted ? 'clean' : `FAILED (status ${apply.status}${conflicted ? ', conflicts' : ''})`}`);
if (applyDetail.length > 0) console.log(`  ${applyDetail.join('\n  ')}`);
console.log(`package:      ${pkg ?? '(none)'}`);
console.log(`test plan:    ${plan ? `${plan[0]} ${plan[1].join(' ')}` : 'none mapped'}`);
console.log(`verdict:      ${orphan.length === 0 && apply.status === 0 && !conflicted ? 'PORTABLE' : 'NOT PORTABLE AS-IS'}`);

if (!runTests) process.exit(0);
if (plan === null) {
  console.error('No test command for that package; run the owning suite manually.');
  process.exit(2);
}
const cwd = pkg === 'electron' ? path.join(root, 'packages', pkg) : path.join(root, 'packages', pkg);
const result = spawnSync(plan[0], plan[1], { cwd, stdio: 'inherit' });
process.exit(result.status ?? 1);
