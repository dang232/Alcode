import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ensureTypescriptPlatform, parseLockedIntegrity, readInstalledTypescriptVersion, readLockedIntegrity, resolveTypescriptTarget, typescriptNpmPlatform } from './prepare-typescript.mjs';

test('platform names mirror the resolver formula on every desktop OS', () => {
  assert.equal(typescriptNpmPlatform('win32', 'x64'), 'typescript-win32-x64');
  assert.equal(typescriptNpmPlatform('win32', 'arm64'), 'typescript-win32-arm64');
  assert.equal(typescriptNpmPlatform('darwin', 'arm64'), 'typescript-darwin-arm64');
  assert.equal(typescriptNpmPlatform('darwin', 'x64'), 'typescript-darwin-x64');
  assert.equal(typescriptNpmPlatform('linux', 'x64'), 'typescript-linux-x64');
  assert.equal(typescriptNpmPlatform('linux', 'arm64'), 'typescript-linux-arm64');
});

test('download path stages a runnable platform lib into an empty root', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-tsdl-'));
  try {
    const version = readInstalledTypescriptVersion();
    const packageName = typescriptNpmPlatform(process.platform, process.arch);
    const events = [];
    const originalLog = console.log;
    console.log = (line) => events.push(String(line));
    try {
      await ensureTypescriptPlatform({
        platformRoot: path.join(directory, 'stage', '@typescript'),
        cacheDir: path.join(directory, 'cache'),
        packageName,
        version,
        integrity: readLockedIntegrity(packageName, version),
        platform: process.platform,
        arch: process.arch,
      });
    } finally {
      console.log = originalLog;
    }
    const lib = path.join(directory, 'stage', '@typescript', packageName, 'lib');
    assert.ok(fs.existsSync(path.join(lib, 'lib.d.ts')));
    assert.ok(events.some((line) => line.includes('staged TypeScript compiler')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 180000);

test('cross-build signal resolves the target arch, explicit config still wins', () => {
  const base = { ALCODE_TARGET_ARCH: undefined, OPENCHAMBER_TARGET_ARCH: undefined, ELECTRON_BUILDER_ARCH: undefined };
  const other = process.arch === 'arm64' ? 'x64' : 'arm64';
  // Explicit config wins over the pipeline signal on every OS (and stays
  // native here, so the platform rule below never fires for this case).
  assert.equal(
    resolveTypescriptTarget({ ...base, ALCODE_TARGET_ARCH: process.arch, OPENCHAMBER_TARGET_ARCH: other }).node,
    process.arch === 'arm64' ? 'arm64' : 'x64',
  );
  if (process.platform === 'linux') {
    // Linux AppImages build natively only: a cross-arch request must fail
    // loudly through the shared resolver instead of staging a foreign
    // compiler (CI covers arm64 on a native arm64 runner).
    assert.throws(
      () => resolveTypescriptTarget({ ...base, OPENCHAMBER_TARGET_ARCH: other }),
      /must be built natively/,
    );
  } else {
    assert.equal(resolveTypescriptTarget({ ...base, OPENCHAMBER_TARGET_ARCH: 'arm64' }).node, 'arm64');
  }
  assert.equal(resolveTypescriptTarget(base).node, process.arch === 'arm64' ? 'arm64' : 'x64');
});

test('lockfile integrity parses the pinned platform entry and refuses unknown ones', () => {
  const lockText = [
    'header',
    '    "@typescript/typescript-linux-arm64": ["@typescript/typescript-linux-arm64@7.0.2", "", { "os": "linux", "cpu": "arm64" }, "sha512-abc123"],',
    'footer',
  ].join('\n');
  assert.equal(parseLockedIntegrity(lockText, 'typescript-linux-arm64', '7.0.2'), 'abc123');
  assert.throws(
    () => parseLockedIntegrity(lockText, 'typescript-win32-arm64', '7.0.2'),
    /has no sha512/,
  );
});
