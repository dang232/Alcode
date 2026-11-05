const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { readAsarFiles, findPackagedAppContentProblems, verifyPackagedAppContents, copyTypescriptPlatformLibs, typescriptPlatformLib, typescriptBinaryName, typescriptTargetPlatform } = require('./packaged-app-contents.cjs');

const web = 'node_modules/@alcode/web';
const helpers = [
  `${web}/server/lib/git/credential-helper.js`,
  `${web}/server/lib/git/ssh-wrapper.js`,
  `${web}/server/lib/git/repository-credential-helper.js`,
];

const companions = [
  `${web}/server/built-in-extensions/dag-pane/service/worker.js`,
  `${web}/server/built-in-extensions/dag-pane/service/vendor/omo-engine/omo-opencode/src/cli/run/index.js`,
];

const platformBinary = `${typescriptPlatformLib()}/${typescriptBinaryName()}`;

const completeApp = () => [
  ...['dist-bundle/entry.mjs', 'dist-bundle/main.mjs', 'dist-bundle/early-startup.mjs', 'preload.mjs', 'browser-panel-preload.cjs', 'package.json'],
  `${web}/package.json`,
  `${web}/server/index.js`,
].map((filePath) => ({ path: filePath, unpacked: false }))
  .concat(helpers.map((filePath) => ({ path: filePath, unpacked: true })))
  .concat(companions.map((filePath) => ({ path: filePath, unpacked: true })))
  .concat([{ path: platformBinary, unpacked: true }]);

const writeAsar = (directory, header) => {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(json.length + 8, 4);
  prefix.writeUInt32LE(json.length + 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  const asarPath = path.join(directory, 'app.asar');
  fs.writeFileSync(asarPath, Buffer.concat([prefix, json]));
  return asarPath;
};

test('a complete app has no problems', () => {
  assert.deepEqual(findPackagedAppContentProblems(completeApp()), []);
});

test('the web build output inside the archive is rejected', () => {
  const files = [...completeApp(), { path: `${web}/dist/assets/index.js`, unpacked: false }];
  assert.deepEqual(findPackagedAppContentProblems(files), [`${web}/dist must not be packaged (1 files found)`]);
});

test('ripgrep platform packages inside the archive are rejected', () => {
  const files = [...completeApp(), { path: 'node_modules/@vscode/ripgrep-darwin-arm64/bin/rg', unpacked: false }];
  assert.deepEqual(findPackagedAppContentProblems(files), [
    '@vscode/ripgrep platform packages must not be packaged (1 files found); the binary ships in Resources/ripgrep',
  ]);
  assert.deepEqual(findPackagedAppContentProblems([...completeApp(), { path: 'node_modules/@vscode/ripgrep/lib/index.js', unpacked: false }]), []);
});

test('files copied from outside the allowlist are rejected', () => {
  const files = [...completeApp(), ...['main.mjs', '.cache/opencode-cli/opencode'].map((filePath) => ({ path: filePath, unpacked: false }))];
  assert.deepEqual(findPackagedAppContentProblems(files), ['2 unexpected files outside node_modules (main.mjs, .cache/opencode-cli/opencode)']);
});

test('a missing server entry or a packed git helper is reported', () => {
  const files = completeApp()
    .filter((file) => file.path !== `${web}/server/index.js`)
    .map((file) => (file.path === helpers[0] ? { ...file, unpacked: false } : file));
  assert.deepEqual(findPackagedAppContentProblems(files), [
    `${web}/server/index.js is missing`,
    `${helpers[0]} must be unpacked from the asar`,
  ]);
});

test('a service without its native companions is reported', () => {
  const files = completeApp().filter((file) => file.path !== companions[0])
    .map((file) => (file.path === companions[1] ? { ...file, unpacked: false } : file));
  assert.deepEqual(findPackagedAppContentProblems(files), [
    `${companions[0]} is missing`,
    `${companions[1]} must be unpacked from the asar`,
  ]);
});

test('a packaged tree without the staged loop CLI is reported', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-contents-'));
  try {
    const header = { files: {} };
    for (const file of completeApp()) {
      const parts = file.path.split('/');
      let node = header.files;
      for (let i = 0; i < parts.length - 1; i++) {
        node[parts[i]] = node[parts[i]] || { files: {} };
        node = node[parts[i]].files;
      }
      const leaf = { size: 1, offset: '0' };
      if (file.unpacked) leaf.unpacked = true;
      node[parts[parts.length - 1]] = leaf;
    }
    writeAsar(directory, header);
    const unpacked = completeApp().filter((file) => file.unpacked).map((file) => file.path);
    for (const file of unpacked) {
      const full = path.join(directory, 'app.asar.unpacked', ...file.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
    const libDts = path.join(directory, 'app.asar.unpacked', ...typescriptPlatformLib().split('/'), 'lib.d.ts');
    fs.mkdirSync(path.dirname(libDts), { recursive: true });
    fs.writeFileSync(libDts, '');
    const ripgrep = path.join(directory, 'ripgrep', process.platform === 'win32' ? 'rg.exe' : 'rg');
    fs.mkdirSync(path.dirname(ripgrep), { recursive: true });
    fs.writeFileSync(ripgrep, '');
    const cliFiles = ['dist/cli.js', 'resolve-ulw-loop-cli.mjs', 'directive.md'];
    for (const file of cliFiles) {
      const full = path.join(directory, 'ulw-loop-cli', ...file.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
    verifyPackagedAppContents(directory);
    fs.rmSync(path.join(directory, 'ulw-loop-cli', 'dist', 'cli.js'));
    assert.throws(
      () => verifyPackagedAppContents(directory),
      /resources\/ulw-loop-cli\/dist\/cli\.js is missing/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('target platform mapping honors the cross-build signal', () => {
  const host = typescriptTargetPlatform({});
  assert.equal(host.os, process.platform);
  assert.deepEqual(typescriptTargetPlatform({ OPENCHAMBER_TARGET_ARCH: 'arm64' }), { os: process.platform, arch: 'arm64' });
  assert.deepEqual(
    typescriptTargetPlatform({ ALCODE_TARGET_ARCH: 'x64', OPENCHAMBER_TARGET_ARCH: 'arm64' }),
    { os: process.platform, arch: 'x64' },
  );
  assert.equal(typescriptPlatformLib({ os: 'darwin', arch: 'arm64' }), 'node_modules/@typescript/typescript-darwin-arm64/lib');
  assert.equal(typescriptBinaryName({ os: 'darwin', arch: 'arm64' }), 'tsc');
});

test('a foreign target binary is required by path, not by host layout', () => {
  const target = { os: 'darwin', arch: 'arm64' };
  const binary = `${typescriptPlatformLib(target)}/${typescriptBinaryName(target)}`;
  assert.equal(binary, 'node_modules/@typescript/typescript-darwin-arm64/lib/tsc');
  assert.deepEqual(findPackagedAppContentProblems(completeApp(), target).filter((problem) =>
    problem.includes('typescript-darwin-arm64'),
  ), [`${binary} is missing`]);
});

test('a platform compiler binary inside the archive must be unpacked', () => {
  const files = completeApp().map((file) => (
    file.path === platformBinary ? { ...file, unpacked: false } : file
  ));
  assert.deepEqual(findPackagedAppContentProblems(files), [
    `${platformBinary} must be unpacked from the asar`,
  ]);
});

test('copyTypescriptPlatformLibs stages the binary plus its lib declarations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-tslib-'));
  try {
    const platform = `typescript-${process.platform}-${process.arch}`;
    const sourceLib = path.join(directory, 'tree', '@typescript', platform, 'lib');
    fs.mkdirSync(sourceLib, { recursive: true });
    fs.writeFileSync(path.join(sourceLib, process.platform === 'win32' ? 'tsc.exe' : 'tsc'), '');
    fs.writeFileSync(path.join(sourceLib, 'lib.d.ts'), '');
    const resources = path.join(directory, 'resources');
    fs.mkdirSync(resources, { recursive: true });
    const copied = copyTypescriptPlatformLibs(resources, path.join(directory, 'tree', 'typescript'));
    assert.equal(copied.length, 2);
    assert.ok(fs.existsSync(path.join(resources, 'app.asar.unpacked', 'node_modules', '@typescript', platform, 'lib', 'lib.d.ts')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('copyTypescriptPlatformLibs refuses a platform tree without lib declarations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-tslib-'));
  try {
    const platform = `typescript-${process.platform}-${process.arch}`;
    const sourceLib = path.join(directory, 'tree', '@typescript', platform, 'lib');
    fs.mkdirSync(sourceLib, { recursive: true });
    fs.writeFileSync(path.join(sourceLib, process.platform === 'win32' ? 'tsc.exe' : 'tsc'), '');
    assert.throws(
      () => copyTypescriptPlatformLibs(path.join(directory, 'resources'), path.join(directory, 'tree', 'typescript')),
      /no lib\.d\.ts/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('verify fails loudly without the unpacked lib declarations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-contents-'));
  try {
    const header = { files: {} };
    for (const file of completeApp()) {
      const parts = file.path.split('/');
      let node = header.files;
      for (let i = 0; i < parts.length - 1; i++) {
        node[parts[i]] = node[parts[i]] || { files: {} };
        node = node[parts[i]].files;
      }
      const leaf = { size: 1, offset: '0' };
      if (file.unpacked) leaf.unpacked = true;
      node[parts[parts.length - 1]] = leaf;
    }
    writeAsar(directory, header);
    for (const file of completeApp().filter((item) => item.unpacked)) {
      const full = path.join(directory, 'app.asar.unpacked', ...file.path.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
    const ripgrep = path.join(directory, 'ripgrep', process.platform === 'win32' ? 'rg.exe' : 'rg');
    fs.mkdirSync(path.dirname(ripgrep), { recursive: true });
    fs.writeFileSync(ripgrep, '');
    for (const file of ['dist/cli.js', 'resolve-ulw-loop-cli.mjs', 'directive.md']) {
      const full = path.join(directory, 'ulw-loop-cli', ...file.split('/'));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
    assert.throws(
      () => verifyPackagedAppContents(directory),
      /lib\.d\.ts is missing/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reads nested files and the unpacked flag from an asar header', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-asar-'));
  try {
    const asarPath = writeAsar(directory, {
      files: {
        'preload.mjs': { size: 1, offset: '0' },
        node_modules: { files: { pkg: { files: { 'index.js': { size: 1, unpacked: true } } } } },
      },
    });
    assert.deepEqual(readAsarFiles(asarPath), [
      { path: 'preload.mjs', unpacked: false },
      { path: 'node_modules/pkg/index.js', unpacked: true },
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
