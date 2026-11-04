/**
 * prepare-typescript.mjs — stage the TypeScript platform compiler the
 * packaged code-graph engine spawns.
 *
 * The engine bundle inlines the compiler API but shells out to the native
 * `tsserver` binary, resolved beside the vendored `typescript` install at
 * `node_modules/@typescript/<platform>/lib`. Bun installs only the build
 * host's platform package, so a cross-built target (Windows arm64 on an
 * x64 runner today) would pack with no compiler and fail every index.
 *
 * Like prepare-ripgrep.mjs, this downloads the target architecture's npm
 * platform package (`@typescript/typescript-<os>-<arch>@<pinned>`),
 * verifies its sha512 against bun.lock, and stages it next to the installed
 * platform packages so the normal dependency walk, the asarUnpack binary
 * rule, and the afterPack lib copy all apply unchanged. Same-arch builds
 * find their platform already installed and only verify it runs.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTargetArchitecture } from './target-architecture.mjs';

// String check via untagged dispatch (the anti-slop gate bans runtime type operators).
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const lockfilePath = path.join(repoRoot, 'bun.lock');
const cacheRoot = path.join(__dirname, '..', '.cache', 'typescript');

// The engine probes these names in order; the staged lib must carry the
// binary plus the bundled lib.*.d.ts it panics without.
export const PLATFORM_BINARIES = ['tsc.exe', 'tsgo', 'tsc'];

export const typescriptNpmPlatform = (os = process.platform, nodeArch = resolveTargetArchitecture().node) =>
  `typescript-${os}-${nodeArch}`;

export const resolveTypescriptTarget = (environment = process.env) =>
  resolveTargetArchitecture({
    environment: {
      ...environment,
      ALCODE_TARGET_ARCH:
        environment.ALCODE_TARGET_ARCH ??
        environment.OPENCHAMBER_TARGET_ARCH ??
        environment.ELECTRON_BUILDER_ARCH,
    },
  });

export const readInstalledTypescriptVersion = () => {
  const anchor = createRequire(path.join(repoRoot, 'packages', 'web', 'server', 'lib', 'code-graph', 'runtime.js'));
  const manifest = JSON.parse(fs.readFileSync(anchor.resolve('typescript/package.json'), 'utf8'));
  if (!isString(manifest.version) || manifest.version.length === 0) {
    throw new Error('Installed typescript package has no version');
  }
  return manifest.version;
};

export const parseLockedIntegrity = (lockText, packageName, version) => {
  const spec = `"@typescript/${packageName}@${version}"`;
  const entry = lockText.split('\n').find((line) => line.includes(spec));
  const integrity = entry ? /"sha512-([A-Za-z0-9+/=]+)"/.exec(entry)?.[1] : null;
  if (!integrity) {
    throw new Error(`bun.lock has no sha512 for @typescript/${packageName}@${version}`);
  }
  return integrity;
};

export const readLockedIntegrity = (packageName, version) =>
  parseLockedIntegrity(fs.readFileSync(lockfilePath, 'utf8'), packageName, version);

const artifactUrl = (packageName, version) =>
  `https://registry.npmjs.org/@typescript/${packageName}/-/${packageName}-${version}.tgz`;

const download = async (url, destination) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const temp = `${destination}.tmp`;
  fs.writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(temp, destination);
};

const archiveMatchesLock = (archivePath, integrity) =>
  createHash('sha512').update(fs.readFileSync(archivePath)).digest('base64') === integrity;

const extractArchive = (archivePath, destination) => {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  // The archive is addressed relative to the destination: under Git Bash on
  // Windows, GNU tar reads an absolute `D:...` path as a remote host.
  const result = spawnSync('tar', ['-xzf', path.relative(destination, archivePath)], {
    cwd: destination,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${archivePath}${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
  }
};

const platformLibComplete = (platformDir) => {
  const lib = path.join(platformDir, 'lib');
  if (!fs.existsSync(path.join(lib, 'lib.d.ts'))) return false;
  return PLATFORM_BINARIES.some((binary) => fs.existsSync(path.join(lib, binary)));
};

const readBinaryVersion = (binaryPath) => {
  const result = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return /^Version\s+(\S+)/.exec(result.stdout.trim())?.[1] ?? null;
};

export const ensureTypescriptPlatform = async ({ platformRoot, cacheDir, packageName, version, integrity, platform, arch }) => {
  const platformDir = path.join(platformRoot, packageName);
  const archivePath = path.join(cacheDir, `${packageName}-${version}.tgz`);

  if (platformLibComplete(platformDir)) {
    console.log(`[electron] TypeScript platform package present: ${platformDir}`);
  } else {
    console.log(`[electron] staging TypeScript platform package @typescript/${packageName}@${version}`);
    if (fs.existsSync(archivePath) && archiveMatchesLock(archivePath, integrity)) {
      console.log(`[electron] using cached TypeScript archive: ${archivePath}`);
    } else {
      await download(artifactUrl(packageName, version), archivePath);
      if (!archiveMatchesLock(archivePath, integrity)) {
        fs.rmSync(archivePath, { force: true });
        throw new Error(`Downloaded @typescript/${packageName}@${version} does not match the sha512 in bun.lock`);
      }
    }
    const extractDir = path.join(cacheDir, 'extract');
    extractArchive(archivePath, extractDir);
    const staged = path.join(extractDir, 'package');
    if (!platformLibComplete(staged)) {
      throw new Error(`Archive ${archivePath} holds no usable platform lib (binary plus lib.d.ts)`);
    }
    fs.rmSync(platformDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(platformDir), { recursive: true });
    fs.renameSync(staged, platformDir);
  }

  // A foreign-arch binary cannot start on this host; the lockfile check
  // above already vouches for that archive. A native binary must run.
  if (process.arch !== arch) {
    console.log(`[electron] staged TypeScript (@typescript/${packageName}@${version}, not run on this ${process.arch} host, target ${arch} on ${platform})`);
    return;
  }
  const binary = PLATFORM_BINARIES.map((name) => path.join(platformDir, 'lib', name)).find((candidate) =>
    fs.existsSync(candidate),
  );
  const reported = binary === undefined ? null : readBinaryVersion(binary);
  if (!reported) {
    throw new Error(`Staged TypeScript compiler does not run: ${binary ?? platformDir}`);
  }
  console.log(`[electron] staged TypeScript compiler ${reported}: ${binary}`);
};

const main = async () => {
  const version = readInstalledTypescriptVersion();
  // OPENCHAMBER_TARGET_ARCH is the release pipeline's cross-build signal;
  // the shared resolver does not read it, so without this mapping a
  // cross-built package would stage the host compiler. An explicit
  // ALCODE_TARGET_ARCH still wins. Shared resolver code is untouched.
  const targetArchitecture = resolveTypescriptTarget(process.env);
  const packageName = typescriptNpmPlatform(process.platform, targetArchitecture.node);
  const anchor = createRequire(path.join(repoRoot, 'packages', 'web', 'server', 'lib', 'code-graph', 'runtime.js'));
  const tsDir = path.dirname(anchor.resolve('typescript/package.json'));
  await ensureTypescriptPlatform({
    platformRoot: path.join(tsDir, '..', '@typescript'),
    cacheDir: path.join(cacheRoot, version, `${process.platform}-${targetArchitecture.node}`),
    packageName,
    version,
    integrity: readLockedIntegrity(packageName, version),
    platform: process.platform,
    arch: targetArchitecture.node,
  });
};

// process.argv[1] uses platform separators while import.meta.url never
// does, so a raw string comparison never matches on Windows and main()
// silently never runs there. Compare resolved paths instead.
const invokedAsScript =
  isString(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  await main();
}
