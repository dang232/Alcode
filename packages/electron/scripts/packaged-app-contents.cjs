// Checks what electron-builder put into app.asar against what the packaged
// runtime needs. The `files` exclusions in package.json keep unused files out;
// this check stops a pattern change from shipping the web build twice, or from
// cutting something the server loads at startup.
const fs = require('node:fs');
const path = require('node:path');

const WEB_PACKAGE = 'node_modules/@alcode/web';

// Packaged builds serve the UI from Resources/web-dist (ALCODE_DIST_DIR),
// so the web package's own build output is dead weight inside the archive.
const FORBIDDEN_DIRECTORIES = [`${WEB_PACKAGE}/dist`];

// The app's own files, outside node_modules. Anything else there means the
// `files` patterns fell back to copying the whole package directory.
const APP_FILES = [
  'dist-bundle/entry.mjs',
  'dist-bundle/main.mjs',
  'dist-bundle/early-startup.mjs',
  'preload.mjs',
  // The browser panel session's preload, loaded from the app path.
  'browser-panel-preload.cjs',
  'package.json',
];

const REQUIRED_FILES = [
  ...APP_FILES,
  // server/index.js reads the version from the package manifest.
  `${WEB_PACKAGE}/package.json`,
  `${WEB_PACKAGE}/server/index.js`,
];

// ripgrep ships in Resources/ripgrep for the target architecture
// (prepare-ripgrep.mjs). The npm platform packages hold the build host's
// binary, so they stay out of the archive.
const RIPGREP_PLATFORM_PACKAGE = /(?:^|\/)node_modules\/@vscode\/ripgrep-[^/]+\//;
const RIPGREP_BINARY = process.platform === 'win32' ? 'rg.exe' : 'rg';

// Run by git and ssh as separate processes, so they must exist on disk.
const REQUIRED_UNPACKED_FILES = [
  `${WEB_PACKAGE}/server/lib/git/credential-helper.js`,
  `${WEB_PACKAGE}/server/lib/git/ssh-wrapper.js`,
  `${WEB_PACKAGE}/server/lib/git/repository-credential-helper.js`,
  // The DAG pane's native companions must ship beside its service, unpacked:
  // the plain-JS worker plus the compiled engine barrel. A service without
  // them probes OMO_ENGINE_ABSENT on machines with no bun and no checkout.
  `${WEB_PACKAGE}/server/built-in-extensions/dag-pane/service/worker.js`,
  `${WEB_PACKAGE}/server/built-in-extensions/dag-pane/service/vendor/omo-engine/omo-opencode/src/cli/run/index.js`,
];

// The staged loop CLI must ship complete: without dist/cli.js the managed
// env gets no OMO_ULW_LOOP_CLI and loop agents die on an asar guess.
const ULW_LOOP_CLI_FILES = ['dist/cli.js', 'resolve-ulw-loop-cli.mjs', 'directive.md'];

// The TypeScript platform compiler the code-graph engine spawns. The npm
// package name follows the target platform (host by default); the binary
// is tsc.exe on Windows and tsgo elsewhere (mirroring the resolver's
// ordered candidates). lib.d.ts must ride beside the binary or it panics
// on startup. Cross-builds set OPENCHAMBER_TARGET_ARCH (or
// ALCODE/ELECTRON_BUILDER_ARCH); the shared arch resolver is deliberately
// untouched, so this mapping lives here next to its only consumer.
const normalizeTargetArch = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'x64' || normalized === 'amd64' || normalized === 'x86_64') return 'x64';
  if (normalized === 'arm64' || normalized === 'aarch64') return 'arm64';
  return null;
};
const typescriptTargetPlatform = (environment = process.env) => {
  const arch = normalizeTargetArch(
    environment.ALCODE_TARGET_ARCH ??
      environment.OPENCHAMBER_TARGET_ARCH ??
      environment.ELECTRON_BUILDER_ARCH,
  ) ?? (process.arch === 'arm64' ? 'arm64' : 'x64');
  return { os: process.platform, arch };
};
const typescriptPlatformDir = (target = typescriptTargetPlatform()) =>
  `@typescript/typescript-${target.os}-${target.arch}`;
const typescriptBinaryName = (target = typescriptTargetPlatform()) => (target.os === 'win32' ? 'tsc.exe' : 'tsgo');
const typescriptPlatformLib = (target) => `node_modules/${typescriptPlatformDir(target)}/lib`;

/**
 * Copies every installed TypeScript platform lib (compiler binary plus the
 * bundled lib.*.d.ts it panics without) into the unpacked tree beside the
 * archive, so the engine can spawn a real path. The asar filter strips
 * `*.d.ts` unconditionally, so this cannot ride the normal file patterns.
 * Returns the copied relative paths. Throws with an actionable message
 * when the platform packages are absent.
 */
const copyTypescriptPlatformLibs = (resourcesPath, tsDir) => {
  const platformRoot = path.join(tsDir, '..', '@typescript');
  if (!fs.existsSync(platformRoot)) {
    throw new Error(
      `TypeScript platform packages missing beside ${tsDir}; code-graph indexing would fail in the packaged app. ` +
      `Install the typescript workspace dependency before packaging.`,
    );
  }
  const names = fs.readdirSync(platformRoot).filter((name) =>
    fs.statSync(path.join(platformRoot, name)).isDirectory(),
  );
  if (names.length === 0) {
    throw new Error(
      `No TypeScript platform package installed under ${platformRoot}; code-graph indexing would fail in the packaged app.`,
    );
  }
  const copied = [];
  const unpackedRoot = path.join(resourcesPath, 'app.asar.unpacked');
  for (const name of names) {
    const sourceLib = path.join(platformRoot, name, 'lib');
    const destLib = path.join(unpackedRoot, 'node_modules', '@typescript', name, 'lib');
    fs.mkdirSync(destLib, { recursive: true });
    for (const file of fs.readdirSync(sourceLib)) {
      const source = path.join(sourceLib, file);
      if (!fs.statSync(source).isFile()) continue;
      const dest = path.join(destLib, file);
      fs.copyFileSync(source, dest);
      if (process.platform !== 'win32' && !path.extname(file)) {
        fs.chmodSync(dest, 0o755);
      }
      copied.push(`node_modules/@typescript/${name}/lib/${file}`);
    }
  }
  if (!copied.some((file) => file.endsWith('/lib.d.ts'))) {
    throw new Error(
      `TypeScript platform libs under ${platformRoot} carry no lib.d.ts; the packaged compiler would panic on startup.`,
    );
  }
  return copied;
};

/**
 * Lists the files recorded in an asar header.
 * Layout: a pickle holding the header size, then a pickle holding the header
 * JSON string (payload size at offset 8, string length at 12, string at 16).
 */
const readAsarFiles = (asarPath) => {
  const descriptor = fs.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(descriptor, prefix, 0, prefix.length, 0);
    const headerLength = prefix.readUInt32LE(12);
    const header = Buffer.alloc(headerLength);
    fs.readSync(descriptor, header, 0, headerLength, 16);
    const files = [];
    const visit = (node, prefixPath) => {
      for (const [name, entry] of Object.entries(node.files)) {
        const entryPath = prefixPath ? `${prefixPath}/${name}` : name;
        if (entry.files) {
          visit(entry, entryPath);
        } else {
          files.push({ path: entryPath, unpacked: entry.unpacked === true });
        }
      }
    };
    visit(JSON.parse(header.toString('utf8')), '');
    return files;
  } finally {
    fs.closeSync(descriptor);
  }
};

const findPackagedAppContentProblems = (files, target = typescriptTargetPlatform()) => {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const problems = [];
  const strayAppFiles = files.filter((file) => !file.path.startsWith('node_modules/') && !APP_FILES.includes(file.path));
  if (strayAppFiles.length > 0) {
    const examples = strayAppFiles.slice(0, 5).map((file) => file.path).join(', ');
    problems.push(`${strayAppFiles.length} unexpected files outside node_modules (${examples})`);
  }
  for (const directory of FORBIDDEN_DIRECTORIES) {
    const count = files.filter((file) => file.path.startsWith(`${directory}/`)).length;
    if (count > 0) problems.push(`${directory} must not be packaged (${count} files found)`);
  }
  const platformPackageFiles = files.filter((file) => RIPGREP_PLATFORM_PACKAGE.test(file.path)).length;
  if (platformPackageFiles > 0) {
    problems.push(`@vscode/ripgrep platform packages must not be packaged (${platformPackageFiles} files found); the binary ships in Resources/ripgrep`);
  }
  for (const required of REQUIRED_FILES) {
    if (!byPath.has(required)) problems.push(`${required} is missing`);
  }
  for (const required of REQUIRED_UNPACKED_FILES) {
    const file = byPath.get(required);
    if (!file) problems.push(`${required} is missing`);
    else if (!file.unpacked) problems.push(`${required} must be unpacked from the asar`);
  }
  // The code-graph compiler binary travels the same unpacked path (spawned
  // at runtime, so the archive copy alone is not enough). The target
  // selects the cross-built platform; it defaults to this host.
  const platformBinary = `${typescriptPlatformLib(target)}/${typescriptBinaryName(target)}`;
  const headerBinary = byPath.get(platformBinary);
  if (!headerBinary) problems.push(`${platformBinary} is missing`);
  else if (!headerBinary.unpacked) problems.push(`${platformBinary} must be unpacked from the asar`);
  return problems;
};

const verifyPackagedAppContents = (resourcesPath, target = typescriptTargetPlatform()) => {
  const asarPath = path.join(resourcesPath, 'app.asar');
  const problems = findPackagedAppContentProblems(readAsarFiles(asarPath), target);
  for (const required of REQUIRED_UNPACKED_FILES) {
    if (!fs.existsSync(path.join(`${asarPath}.unpacked`, required))) {
      problems.push(`${required} is missing from app.asar.unpacked`);
    }
  }
  // The binary's on-disk presence plus its bundled lib.d.ts (which never
  // rides the archive file patterns that strip `*.d.ts`): the binary
  // panics without its sibling declarations.
  const platformBinary = `${typescriptPlatformLib(target)}/${typescriptBinaryName(target)}`;
  if (!fs.existsSync(path.join(`${asarPath}.unpacked`, platformBinary))) {
    problems.push(`${platformBinary} is missing from app.asar.unpacked`);
  }
  if (!fs.existsSync(path.join(`${asarPath}.unpacked`, typescriptPlatformLib(target), 'lib.d.ts'))) {
    problems.push(`${typescriptPlatformLib(target)}/lib.d.ts is missing from app.asar.unpacked; the packaged compiler would panic`);
  }
  const ripgrep = path.join(resourcesPath, 'ripgrep', RIPGREP_BINARY);
  if (!fs.existsSync(ripgrep)) {
    problems.push(`${ripgrep} is missing; run prepare:ripgrep before packaging`);
  }
  for (const file of ULW_LOOP_CLI_FILES) {
    if (!fs.existsSync(path.join(resourcesPath, 'ulw-loop-cli', file))) {
      problems.push(`resources/ulw-loop-cli/${file} is missing; run prepare:ulw-loop-cli before packaging`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Packaged app contents check failed for ${asarPath}:\n- ${problems.join('\n- ')}`);
  }
};

module.exports = {
  readAsarFiles,
  findPackagedAppContentProblems,
  verifyPackagedAppContents,
  copyTypescriptPlatformLibs,
  typescriptPlatformLib,
  typescriptBinaryName,
  typescriptTargetPlatform,
};
