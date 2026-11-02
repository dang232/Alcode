/**
 * code-graph-packaged-accept.mjs — headless packaged acceptance for the
 * Code Graph index over a freshly built desktop package.
 *
 * Usage: node ./scripts/code-graph-packaged-accept.mjs --app-root <dir>
 *   [--arch <x64|arm64>] [--keep-tmp]
 *
 * app-root points at the directory holding the packaged app bundle layout
 * (win-unpacked, *.app/Contents/Resources, linux-unpacked): the script
 * finds resources/app.asar plus its unpacked twin, audits the TypeScript
 * compiler presence, extracts the engine and runtime beside the platform
 * compiler, and drives a deterministic fixture through cold index, all
 * query kinds, warm reuse, unreadable isolation, terminal failure,
 * explicit retry, restart restoration, and generation agreement.
   *
   * Contract A covers cold index, the query kinds, warm reuse, and
   * recovery in ten observable+persisted phases behind a genuine read
   * denial: (1) cold index+manifest, (2) status plus
   * search/context/trace/impact/tests, (3) warm reuse, (4) partial index
   * on unreadable, (5) failure memory+terminal state, (6) no uncontrolled
   * rebuild/retry, (7) restore+explicit retry, (8) zero unreadable after
   * recovery, (9) manifest/generation/persisted agreement, (10) a fresh
   * packaged instance restoring the recovered generation. The denial is a
   * real filesystem error (EACCES via icacls after backup-privilege drop
   * on Windows, chmod 000 elsewhere), verified by reading the file back
   * in this process and in a fresh Node process, never assumed. A missing
   * file fails loudly as deny-wrong-error and never passes as denied.
   * Contract B is a separate native ACL probe that never blocks Contract A.
 *
 * Plain Node only (no Electron, no display, no network): every assertion
 * names its evidence, and any failure exits non-zero with the step that
 * broke. No lock holder: the harness drops SeBackupPrivilege and
 * SeRestorePrivilege in-process before Contract A denies, so icacls binds
 * Node reads deterministically even for elevated hosted runners.
 */
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { typescriptNpmPlatform } from './prepare-typescript.mjs';

const run = promisify(execFile);
const args = {};
for (let index = 0; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const [key, inline] = arg.slice(2).split('=');
  args[key] = inline ?? process.argv[index + 1] ?? 'true';
}

const step = (name, detail) => {
  console.log(`[code-graph-packaged-accept] ${name}: ${detail}`);
};

const fail = (name, detail) => {
  console.error(`[code-graph-packaged-accept] FAIL ${name}: ${detail}`);
  process.exitCode = 1;
  throw new Error(`acceptance failed at ${name}: ${detail}`);
};

const expect = (name, condition, detail) => {
  if (!condition) fail(name, detail);
  step(name, detail);
};

const USERNAME = process.env.USERNAME || process.env.USER || 'Everyone';

const locateResources = (appRoot) => {
  const candidates = [
    path.join(appRoot, 'resources'),
    path.join(appRoot, 'Contents', 'Resources'),
  ];
  for (const resources of candidates) {
    if (fs.existsSync(path.join(resources, 'app.asar'))) return resources;
  }
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (fs.existsSync(path.join(full, 'resources', 'app.asar'))) found.push(path.join(full, 'resources'));
      else if (entry.name.endsWith('.app')) {
        const inner = path.join(full, 'Contents', 'Resources');
        if (fs.existsSync(path.join(inner, 'app.asar'))) found.push(inner);
      } else walk(full, depth + 1);
    }
  };
  walk(appRoot, 0);
  if (found.length === 0) fail('locate', `no app.asar under ${appRoot}`);
  return found[0];
};

/**
 * Minimal asar file extraction: the 16-byte prefix holds the header JSON
 * length at offset 12, and file payloads follow the header back to back at
 * their recorded offsets. Verified against known packaged content below by
 * checking the extracted TypeScript manifest parses.
 */
const extractAsarFiles = (asarPath, entries, destDir) => {
  const { entries: all, dataStart } = readAsarHeader(asarPath);
  const byPath = new Map(all.map((entry) => [entry.path, entry]));
  const descriptor = fs.openSync(asarPath, 'r');
  try {
    for (const name of entries) {
      const entry = byPath.get(name);
      if (!entry) fail('extract', `${name} absent from the archive`);
      // Payload offsets are located by content, not by format folklore:
      // every stored block carries a SHA256 in the header, so the exact
      // start is the candidate whose bytes verify. Small files are one block.
      const size = entry.size;
      const want = Array.isArray(entry.integrity?.blocks) && entry.integrity.blocks.length > 0
        ? entry.integrity.blocks[0]
        : null;
      const { createHash } = crypto;
      let placed = false;
      for (let delta = -64; delta <= 64 && !placed; delta += 1) {
        const buffer = Buffer.alloc(size);
        fs.readSync(descriptor, buffer, 0, size, dataStart + entry.offset + delta);
        if (want !== null) {
          const actual = crypto.createHash('sha256').update(buffer).digest('hex');
          if (actual !== want) continue;
        }
        const dest = path.join(destDir, ...name.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buffer);
        placed = true;
      }
      if (!placed) fail('extract', `${name} bytes do not verify against the archive header`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
};

const readAsarHeader = (asarPath) => {
  const descriptor = fs.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(descriptor, prefix, 0, prefix.length, 0);
    const headerLength = prefix.readUInt32LE(12);
    const header = Buffer.alloc(headerLength);
    fs.readSync(descriptor, header, 0, headerLength, 16);
    const entries = [];
    const visit = (node, prefixPath) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const entryPath = prefixPath ? `${prefixPath}/${name}` : name;
        if (entry.files) visit(entry, entryPath);
        else entries.push({ path: entryPath, offset: Number(entry.offset), size: Number(entry.size), integrity: entry.integrity ?? null });
      }
    };
    visit(JSON.parse(header.toString('utf8')), '');
    // File payloads follow the header padded to 8-byte alignment.
    const dataStart = 16 + headerLength + ((8 - ((16 + headerLength) % 8)) % 8);
    return { entries, dataStart };
  } finally {
    fs.closeSync(descriptor);
  }
};

const isDenied = async (file) => {
  try {
    await fs.promises.readFile(file);
    return false;
  } catch {
    return true;
  }
};

/**
 * Genuine-denial probing: any read error (including ENOENT for a missing
 * file) looks like denial to a boolean check, so every recovery phase
 * depends on this probe instead. `statCode` proves the file exists;
 * `code` names the denial for the log. A missing file fails loudly as
 * deny-wrong-error and never passes as denied.
 */
const denialProbe = async (file) => {
  let statCode = 'unknown';
  try {
    await fs.promises.stat(file);
    statCode = 'exists';
  } catch (error) {
    statCode = (error && error.code) || 'UNKNOWN';
  }
  try {
    await fs.promises.readFile(file);
    return { denied: false, code: 'readable', statCode };
  } catch (error) {
    return { denied: true, code: (error && error.code) || 'UNKNOWN', statCode };
  }
};

/**
 * Persisted-agreement assertions: the manifest is the only publish point,
 * so every complete generation must agree with it on buildSeq, nodeCount
 * and edgeCount. Partial (truncated) builds never persist, which phases 4
 * and 9 assert from opposite sides.
 */
const readStoreManifests = (storeDir) => {
  const out = [];
  for (const scope of fs.readdirSync(storeDir)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(storeDir, scope, 'manifest.json'), 'utf8'));
    out.push({ scope, manifest });
  }
  return out;
};

const expectStoreAgrees = (tag, storeDir, summary) => {
  let manifests = null;
  try {
    manifests = readStoreManifests(storeDir);
  } catch (error) {
    fail(tag, `store unreadable at ${storeDir}: ${String(error).slice(0, 120)}`);
  }
  expect(`${tag}-scopes`, manifests.length > 0, `no scope manifests under ${storeDir}`);
  for (const { scope, manifest } of manifests) {
    expect(`${tag}-buildSeq`, manifest.buildSeq === summary.generation, `${scope}: manifest buildSeq=${manifest.buildSeq} generation=${summary.generation}`);
    expect(`${tag}-nodes`, manifest.nodeCount === summary.nodeCount, `${scope}: manifest nodes=${manifest.nodeCount} observed=${summary.nodeCount}`);
    expect(`${tag}-edges`, manifest.edgeCount === summary.edgeCount, `${scope}: manifest edges=${manifest.edgeCount} observed=${summary.edgeCount}`);
  }
  step(tag, `persisted agrees: ${manifests.length} scope(s) gen=${summary.generation} nodes=${summary.nodeCount} edges=${summary.edgeCount}`);
};

const whoamiPriv = () => {
  if (process.platform !== 'win32') return 'non-windows';
  try {
    const out = spawnSync('whoami', ['/priv'], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
    const text = String(out.stdout ?? '');
    const backup = /SeBackupPrivilege[^\n]*Enabled/.test(text) ? 'BackupEnabled' : (/SeBackupPrivilege/.test(text) ? 'BackupDisabledOrNotHeld' : 'BackupAbsent');
    const restore = /SeRestorePrivilege[^\n]*Enabled/.test(text) ? 'RestoreEnabled' : (/SeRestorePrivilege/.test(text) ? 'RestoreDisabledOrNotHeld' : 'RestoreAbsent');
    return backup + '/' + restore;
  } catch {
    return 'whoami-failed';
  }
};

const setBackupPrivilege = async (enable) => {
  if (process.platform !== 'win32') return 'non-windows-skip';
  const want = enable ? 2 : 0;
  const ps = [
    '$pidToAdjust = ' + process.pid,
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class Tok {',
    '  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);',
    '  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr tok);',
    '  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern bool LookupPrivilegeValue(string sys, string name, out long luid);',
    '  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct LUID_AND_ATTR { public long Luid; public uint Attr; }',
    '  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct TOKEN_PRIVS { public uint Count; public LUID_AND_ATTR Priv; }',
    '  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool AdjustTokenPrivileges(IntPtr tok, bool disAll, ref TOKEN_PRIVS newState, uint len, System.IntPtr prev, System.IntPtr retLen);',
    '}',
    '"@',
    '$h = [Tok]::OpenProcess(0x0400, $false, $pidToAdjust)',
    '$tok = [System.IntPtr]::Zero',
    '$ok = [Tok]::OpenProcessToken($h, 0x0028, [ref]$tok)',
    'foreach($name in @("SeBackupPrivilege","SeRestorePrivilege")){',
    '  $luid = 0',
    '  [Tok]::LookupPrivilegeValue($null, $name, [ref]$luid) | Out-Null',
    '  $tp = New-Object Tok+TOKEN_PRIVS',
    '  $tp.Count = 1',
    '  $tp.Priv = New-Object Tok+LUID_AND_ATTR',
    '  $tp.Priv.Luid = $luid',
    '  $tp.Priv.Attr = ' + want,
    '  [Tok]::AdjustTokenPrivileges($tok, $false, [ref]$tp, 0, [System.IntPtr]::Zero, [System.IntPtr]::Zero) | Out-Null',
    '  Write-Output ($name + " set=" + ' + want + ' + " err=" + [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())',
    '}',
    'Write-Output "PRIV-DONE"',
  ].join("\n");
  const before = whoamiPriv();
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
  const transcript = String(result.stdout ?? '').trim().slice(0, 400) || 'empty';
  const after = whoamiPriv();
  step(enable ? 'priv-enable' : 'priv-disable', 'before=' + before + ' after=' + after + ' transcript=' + transcript.slice(0, 200));
  return after;
};

const runIcacls = (args, attempts) => {
  const result = spawnSync('icacls', args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
  if (Array.isArray(attempts)) {
    attempts.push(
      args.join(' ') + ' -> exit ' + (result.status ?? ('spawn-failed: ' + (result.error ? String(result.error).slice(0, 80) : 'unknown'))) + (result.stderr ? ' ' + result.stderr.trim().slice(0, 120) : ''),
    );
  }
  return result;
};

const freshNodeDenied = (file) => {
  try {
    const probe = spawnSync(process.execPath, ['-e', 'require("fs").readFileSync(process.argv[1])', file], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
    return { exit: probe.status, stderr: String(probe.stderr ?? '').trim().slice(0, 160) };
  } catch (error) {
    return { exit: 'spawn-failed', stderr: String(error).slice(0, 120) };
  }
};

const denyRead = async (file) => {
  const attempts = [];
  if (process.platform === 'win32') {
    try {
      const aceDump = spawnSync('icacls', [file], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
      step('deny-aces', path.basename(file) + ': ' + (aceDump.stdout ?? '').trim().split('\n').slice(0, 6).join(' | ').slice(0, 300) || 'icacls query empty');
    } catch { /* diagnostics only */ }
    step('deny-priv', 'whoami=' + whoamiPriv() + ' user=' + (process.env.USERNAME ?? '?'));
    runIcacls([file, '/deny', USERNAME + ':(R)'], attempts);
    {
      const probe = await denialProbe(file);
      const fresh = freshNodeDenied(file);
      step('deny-verify', path.basename(file) + ': denied=' + probe.denied + ' code=' + probe.code + ' stat=' + probe.statCode + ' freshExit=' + fresh.exit + (fresh.stderr ? ' freshErr=' + fresh.stderr.slice(0, 80) : ''));
      if (probe.statCode === 'ENOENT') fail('deny-wrong-error', file + ' is missing; a missing file must never pass as denied');
      if (probe.denied) {
        step('deny-ok', path.basename(file) + ': genuine EACCES-class denial code=' + probe.code + ' stat=' + probe.statCode + ' via user deny');
        return async () => {
          runIcacls([file, '/remove:d', USERNAME], attempts);
          if (await isDenied(file)) {
            fail('restore', 'icacls /remove:d did not restore readability for ' + file + ' [' + attempts.join(' | ') + ']');
          }
          step('deny-restore', path.basename(file) + ': readable after /remove:d');
        };
      }
      try {
        const postDump = spawnSync('icacls', [file], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
        step('deny-postaces', path.basename(file) + ': ' + (postDump.stdout ?? '').trim().split('\n').slice(0, 8).join(' | ').slice(0, 400));
      } catch { /* diagnostics only */ }
      step('deny-everyone', path.basename(file) + ': user deny ineffective (Full via Administrators), trying Everyone deny');
      runIcacls([file, '/deny', '*S-1-1-0:(R)'], attempts);
      const probe2 = await denialProbe(file);
      const fresh2 = freshNodeDenied(file);
      step('deny-verify2', path.basename(file) + ': denied=' + probe2.denied + ' code=' + probe2.code + ' stat=' + probe2.statCode + ' freshExit=' + fresh2.exit);
      if (probe2.statCode === 'ENOENT') fail('deny-wrong-error', file + ' is missing; a missing file must never pass as denied');
      if (probe2.denied) {
        step('deny-ok', path.basename(file) + ': genuine EACCES-class denial code=' + probe2.code + ' stat=' + probe2.statCode + ' via Everyone deny');
        return async () => {
          runIcacls([file, '/remove:d', USERNAME], attempts);
          runIcacls([file, '/remove:d', '*S-1-1-0'], attempts);
          if (await isDenied(file)) {
            fail('restore', 'icacls /remove:d did not restore readability for ' + file + ' [' + attempts.join(' | ') + ']');
          }
          step('deny-restore', path.basename(file) + ': readable after /remove:d');
        };
      }
    }
  } else {
    spawnSync('chmod', ['000', file], { stdio: 'ignore' });
    {
      const probe = await denialProbe(file);
      step('deny-verify', path.basename(file) + ': denied=' + probe.denied + ' code=' + probe.code + ' stat=' + probe.statCode);
      if (probe.statCode === 'ENOENT') fail('deny-wrong-error', file + ' is missing; a missing file must never pass as denied');
      if (probe.denied) {
        step('deny-ok', path.basename(file) + ': genuine denial code=' + probe.code);
        return async () => {
          spawnSync('chmod', ['644', file], { stdio: 'ignore' });
          if (await isDenied(file)) {
            fail('restore', 'chmod 644 did not restore readability for ' + file);
          }
          step('deny-restore', path.basename(file) + ': readable after chmod 644');
        };
      }
    }
  }
  fail('deny', 'OS read denial unsupported for ' + file + ' (user=' + (process.env.USERNAME ?? '?') + ', domain=' + (process.env.USERDOMAIN ?? '?') + ', priv=' + whoamiPriv() + '; attempts: ' + (attempts.join(' | ') || 'none') + ')');
};

const probeNativeAclDenial = async (file) => {
  const attempts = [];
  if (process.platform !== 'win32') {
    spawnSync('chmod', ['000', file], { stdio: 'ignore' });
    const probe = await denialProbe(file);
    const restore = async () => { spawnSync('chmod', ['644', file], { stdio: 'ignore' }); };
    try {
      if (probe.statCode === 'ENOENT') fail('deny-wrong-error', file + ' is missing; a missing file must never pass as denied');
      if (probe.denied) {
        step('contract-b-native', 'PASS: native chmod denial genuine code=' + probe.code + ' stat=' + probe.statCode);
        await restore();
        expect('contract-b-native-restore', (await denialProbe(file)).denied === false, 'probe file readable after restore');
        return 'pass';
      }
      await restore();
      step('contract-b-native', 'BLOCKED: chmod left file readable (unexpected on posix)');
      return 'blocked';
    } catch (error) {
      try { await restore(); } catch { /* best effort */ }
      throw error;
    }
  }
  step('contract-b-native-priv', 'whoami=' + whoamiPriv() + ' user=' + (process.env.USERNAME ?? '?'));
  runIcacls([file, '/deny', USERNAME + ':(R)'], attempts);
  const probe = await denialProbe(file);
  const fresh = freshNodeDenied(file);
  step('contract-b-native-probe', path.basename(file) + ': denied=' + probe.denied + ' code=' + probe.code + ' stat=' + probe.statCode + ' freshExit=' + fresh.exit);
  const restoreNative = async () => {
    runIcacls([file, '/remove:d', USERNAME], attempts);
    runIcacls([file, '/remove:d', '*S-1-1-0'], attempts);
  };
  try {
    if (probe.statCode === 'ENOENT') fail('deny-wrong-error', file + ' is missing; a missing file must never pass as denied');
    if (probe.denied) {
      step('contract-b-native', 'PASS: native icacls denial genuine code=' + probe.code + ' stat=' + probe.statCode + ' via user deny');
      await restoreNative();
      expect('contract-b-native-restore', (await denialProbe(file)).denied === false, 'probe file readable after restore');
      return 'pass';
    }
    runIcacls([file, '/deny', '*S-1-1-0:(R)'], attempts);
    const probe2 = await denialProbe(file);
    const fresh2 = freshNodeDenied(file);
    step('contract-b-native-probe2', path.basename(file) + ': denied=' + probe2.denied + ' code=' + probe2.code + ' stat=' + probe2.statCode + ' freshExit=' + fresh2.exit);
    if (probe2.statCode === 'ENOENT') fail('deny-wrong-error', file + ' is missing; a missing file must never pass as denied');
    if (probe2.denied) {
      step('contract-b-native', 'PASS: native icacls denial genuine code=' + probe2.code + ' stat=' + probe2.statCode + ' via Everyone deny (user Full required broader deny)');
      await restoreNative();
      expect('contract-b-native-restore', (await denialProbe(file)).denied === false, 'probe file readable after restore');
      return 'pass';
    }
    step('contract-b-native', 'BLOCKED: hosted runner bypasses ACL (icacls exit 0 but fresh-node exit=' + fresh.exit + '/' + fresh2.exit + ', priv=' + whoamiPriv() + '); Contract A will use isolated denial, this does not block it [' + attempts.join(' | ') + ']');
    await restoreNative();
    return 'blocked';
  } catch (error) {
    try { await restoreNative(); } catch { /* best effort */ }
    throw error;
  }
};


const main = async () => {
  const appRoot = args['app-root'];
  if (!appRoot) fail('args', '--app-root <dir> is required');
  const requestedArch = args.arch ?? process.arch;
  const arch = requestedArch === 'arm64' || requestedArch === 'aarch64' ? 'arm64' : 'x64';
  const platformPackage = typescriptNpmPlatform(process.platform, arch);
  const foreignArch = arch !== process.arch;
  if (foreignArch) {
    step('arch', `target ${arch} differs from host ${process.arch}: artifact checks only, runtime runs on target hardware`);
  }
  const resources = locateResources(appRoot);
  step('locate', `resources at ${resources}`);
  const asarPath = path.join(resources, 'app.asar');
  const unpacked = `${asarPath}.unpacked`;

  const { entries } = readAsarHeader(asarPath);
  const names = new Set(entries.map((entry) => entry.path));
  expect('asar-typescript', names.has('node_modules/typescript/package.json'), 'typescript package manifest ships');
  const binary = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
  const binaryPath = `node_modules/@typescript/${platformPackage}/lib/${binary}`;
  expect('asar-binary', names.has(binaryPath), `${platformPackage} compiler binary ships`);

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pkg-accept-'));
  const keepTmp = args['keep-tmp'] === 'true' || args['keep-tmp'] === true;
  try {
    extractAsarFiles(asarPath, [
      'node_modules/@alcode/web/server/lib/code-graph/runtime.js',
      'node_modules/@alcode/web/server/lib/code-graph/snapshot-storage.js',
      'node_modules/@alcode/web/server/lib/code-graph/code-graph.bundle.js',
      'node_modules/typescript/package.json',
    ], workdir);
    const stagedLib = path.join(workdir, 'node_modules', '@typescript', platformPackage, 'lib');
    const sourceLib = path.join(unpacked, 'node_modules', '@typescript', platformPackage, 'lib');
    if (!fs.existsSync(path.join(sourceLib, 'lib.d.ts'))) {
      fail('stage-compiler', `unpacked platform lib lacks lib.d.ts at ${sourceLib}`);
    }
    fs.mkdirSync(stagedLib, { recursive: true });
    for (const file of fs.readdirSync(sourceLib)) {
      fs.copyFileSync(path.join(sourceLib, file), path.join(stagedLib, file));
    }
    if (!fs.existsSync(path.join(stagedLib, binary))) fail('stage-compiler', `platform binary missing at ${stagedLib}`);
    step('stage-compiler', `platform lib staged from ${sourceLib}`);
    if (foreignArch) {
      step('runtime', 'SKIP-RUNTIME: foreign-arch binary cannot start on this host; target hardware runs the full battery');
      return;
    }

    const { createCodeGraphRuntime } = await import(
      pathToFileURL(path.join(workdir, 'node_modules', '@alcode', 'web', 'server', 'lib', 'code-graph', 'runtime.js')).href
    );
    const fixtureBase = process.env.GITHUB_WORKSPACE ? path.dirname(process.env.GITHUB_WORKSPACE) : os.tmpdir();
    step('fixture-base', 'GITHUB_WORKSPACE=' + (process.env.GITHUB_WORKSPACE ?? 'unset') + ' base=' + fixtureBase);
    let root = fs.mkdtempSync(path.join(fixtureBase, 'cg-pkg-fx-'));
    // Normalize to the long path once: on hosts where 8.3 spellings
    // resolve per-runtime, every later path (engine walks, denial
    // targets, verification) must name one identical object. Prefer the
    // workspace volume (D: on hosted runners) because C: Temp ignores
    // even Everyone DENY entries with backup absent (proven by post-deny
    // ACEs showing DENY yet readable).
    try {
      const canonical = fs.realpathSync(root);
      if (canonical !== root) step('fixture-canonical', `${root} -> ${canonical}`);
      root = canonical;
    } catch { /* keep the mkdtemp spelling */ }
    try {
      const write = (rel, content) => {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      };
      write('a.ts', 'export function alpha(): number { return 1; }\n');
      write('b.ts', 'export function beta(): number { return 2; }\n');
      write('c.ts', "import { alpha } from './a';\nexport function gamma(): number { return alpha(); }\n");
      execFileSync('git', ['init', '-q', '.'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
      const store = path.join(workdir, 'store');
      fs.mkdirSync(store, { recursive: true });
      const scriptEvents = [];
      const dumpStore = (tag) => {
        try {
          const scopes = fs.readdirSync(store);
          for (const sc of scopes) {
            const m = JSON.parse(fs.readFileSync(path.join(store, sc, 'manifest.json'), 'utf8'));
            step(tag, `manifest buildSeq=${m.buildSeq} nodes=${m.nodeCount}`);
          }
        } catch (e) { step(tag, `store unreadable: ${String(e).slice(0, 80)}`); }
      };
      const runtime = createCodeGraphRuntime(
        { fsPromises: fs.promises, path, execFile: (await import('node:child_process')).execFile },
        { storeDir: store, blockOnRead: true, onProgress: (e) => { if (e.storeWriteFailed !== undefined) scriptEvents.push(`writeFailed:${e.storeWriteFailed}`); } },
      );
      const pick = (s) => ({ gen: s.generation ?? null, ready: s.ready });
      const cold = await runtime.readIndex(root, { block: true });
      expect('cold', cold.ready === true && cold.incremental?.reanalyzed === 3, `gen ${cold.generation}, reanalyzed 3`);
      expect('cold-status', cold.indexState?.state === 'ready' && cold.generation !== null && cold.nodeCount > 0, `state=${cold.indexState?.state ?? 'none'} gen=${cold.generation} nodes=${cold.nodeCount}`);
      dumpStore('store-after-cold');
      expectStoreAgrees('cold-persisted', store, cold);
      const search = await runtime.query(root, { kind: 'search', query: 'alpha' });
      expect('search', search.items.some((item) => item.name === 'alpha'), 'alpha found');
      const context = await runtime.query(root, { kind: 'context', symbol: 'fn:alpha@a.ts', depth: 1 });
      expect('context', context.items.length > 0, `${context.items.length} rows`);
      const trace = await runtime.query(root, { kind: 'trace', from: 'fn:gamma@c.ts', to: 'fn:alpha@a.ts', depth: 2 });
      expect('trace', trace.items.length > 0, `${trace.items.length} rows`);
      const impact = await runtime.query(root, { kind: 'impact', symbol: 'fn:alpha@a.ts', depth: 1 });
      expect('impact', impact.items.length > 0, `${impact.items.length} rows`);
      const tests = await runtime.query(root, { kind: 'tests', target: 'fn:alpha@a.ts' });
      expect('tests', Array.isArray(tests.items), 'tests answered');
      for (const pair of [['search', search], ['context', context], ['trace', trace], ['impact', impact], ['tests', tests]]) {
        expect(`query-gen-${pair[0]}`, pair[1].generation === cold.generation, `${pair[0]} served gen ${pair[1].generation} (cold ${cold.generation})`);
      }
      const warm = await runtime.readIndex(root, { block: true });
      expect('warm', warm.ready === true && warm.generation === cold.generation, 'served without rebuild, same generation');
      expectStoreAgrees('warm-persisted', store, warm);
      step('contract-a', `Contract A green: cold gen ${cold.generation}, query kinds agree, warm reuse same generation`);

      write('a.ts', 'export function alpha(): number { return 11; }\n');
      const bumped = new Date('2026-02-02T00:00:00Z');
      fs.utimesSync(path.join(root, 'b.ts'), bumped, bumped);
      step('contract-b-native-start', 'Contract B native probe (no privilege change): hosted runners may bypass, isolated Contract A does not depend on it');
      write('deny-probe.tmp', 'probe\n');
      const probeFile = path.join(root, 'deny-probe.tmp');
      const nativeResult = await probeNativeAclDenial(probeFile);
      step('contract-b-native-result', 'native=' + nativeResult + ' (pass=genuine EACCES, blocked=host bypass with evidence, never ENOENT)');
      fs.rmSync(probeFile, { force: true });
      step('contract-a-isolate', 'Contract A isolation: dropping SeBackupPrivilege/SeRestorePrivilege so icacls denies bind Node reads (fixes runneradmin bypass)');
      await setBackupPrivilege(false);
      step('contract-a-recovery', 'Contract A recovery: isolated EACCES denial now drives all phases; error codes are real filesystem codes, never fabricated');
      const restoreB = await denyRead(path.join(root, 'b.ts'));
      try {
        const partial = await runtime.readIndex(root, { block: true, refresh: true });
        expect('partial', partial.ready === true && (partial.incremental?.unreadableFileCount ?? 0) >= 1, 'partial with unreadable recorded');
        expect('partial-names', (partial.incremental?.unreadableFiles ?? []).some((name) => String(name).includes('b.ts')), `unreadable=${(partial.incremental?.unreadableFiles ?? []).join(',')}`);
        expectStoreAgrees('partial-persisted', store, cold);
        // Refresh-forced: plain reads inside the git-status TTL window may
        // still serve the pre-edit complete generation as fresh, which is
        // correct serving behavior but nondeterministic for assertions.
        const explored = await runtime.query(root, { kind: 'explore', limit: 50, refresh: true });
        expect('partial-coverage', explored.coverage === 'partial' && explored.unresolved.some((line) => line.includes('b.ts')), 'partial names b.ts');
        const retraced = await runtime.query(root, { kind: 'trace', from: 'fn:gamma@c.ts', to: 'fn:alpha@a.ts', depth: 2, refresh: true });
        expect('partial-trace', retraced.items.length > 0, 'relationships survive the exclusion');
      } finally {
        await restoreB();
      }
      const bumped2 = new Date('2026-03-03T00:00:00Z');
      write('c.ts', "import { alpha } from './a';\nexport function gamma(): number { return alpha() + 1; }\n");
      fs.utimesSync(path.join(root, 'a.ts'), bumped2, bumped2);
      fs.utimesSync(path.join(root, 'b.ts'), bumped2, bumped2);
      fs.utimesSync(path.join(root, 'c.ts'), bumped2, bumped2);
      const restoreA = await denyRead(path.join(root, 'a.ts'));
      const restoreStormB = await denyRead(path.join(root, 'b.ts'));
      const restoreC = await denyRead(path.join(root, 'c.ts'));
      const events = [];
      const failing = createCodeGraphRuntime(
        { fsPromises: fs.promises, path, execFile: (await import('node:child_process')).execFile },
        { storeDir: path.join(workdir, 'store-fail'), blockOnRead: true, onProgress: (event) => events.push(event.state) },
      );
      let threw = null;
      try {
        await failing.readIndex(root, { block: true, refresh: true });
      } catch (error) {
        threw = String((error && error.message) || error).slice(0, 80);
      }
      expect('terminal-failure', threw !== null && /readable/i.test(threw ?? ''), `failed loudly with the right reason (${threw})`);
      const terminals = events.filter((state) => state === 'failed').length;
      expect('terminal-events', terminals >= 1, `${terminals} terminal event(s) observed`);
      expect('terminal-no-ready', !events.some((state) => state === 'ready'), 'failed build never published ready');
      {
        const leaked = [];
        const walkFail = (dir) => {
          for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, dirent.name);
            if (dirent.isDirectory()) walkFail(full);
            else if (dirent.name === 'manifest.json') leaked.push(full);
          }
        };
        try {
          walkFail(path.join(workdir, 'store-fail'));
        } catch {
          // Absent store is the expected case: nothing was persisted.
        }
        expect('terminal-no-persist', leaked.length === 0, leaked.length === 0 ? 'failed build persisted nothing' : `failed build leaked manifests: ${leaked.join(',')}`);
      }
      for (let i = 0; i < 3; i += 1) {
        const polled = await failing.readIndex(root);
        if (polled.ready !== false || polled.indexState?.state !== 'failed') {
          fail('failure-memory', `poll ${i} escaped the failed state`);
        }
        if (!/readable/i.test(String(polled.indexState?.error ?? ''))) {
          fail('failure-memory', `poll ${i} lost the terminal reason: ${String(polled.indexState?.error ?? 'none').slice(0, 80)}`);
        }
      }
      expect('failure-memory', events.filter((state) => state === 'failed').length === terminals, `${terminals} terminal(s), no poll rebuilds`);
      await restoreA();
      await restoreStormB();
      await restoreC();
      let recovered = await runtime.readIndex(root, { block: true, refresh: true });
      if ((recovered.incremental?.unreadableFileCount ?? 0) > 0) {
        step('retry-transient', `unreadable=${(recovered.incremental?.unreadableFiles ?? []).join(',') || recovered.incremental?.unreadableFileCount}; one refresh to clear transient locks`);
        recovered = await runtime.readIndex(root, { block: true, refresh: true });
      }
      expect('retry', recovered.ready === true && (recovered.incremental?.unreadableFileCount ?? 0) === 0, `gen ${recovered.generation}, unr=${recovered.incremental?.unreadableFileCount ?? 'n/a'}`);
      expect('retry-clean', (recovered.incremental?.unreadableFiles ?? []).length === 0, 'no unreadable files remain');
      expect('retry-status', recovered.indexState?.state === 'ready', `state=${recovered.indexState?.state ?? 'none'}`);
      dumpStore('store-after-retry');
      expectStoreAgrees('retry-persisted', store, recovered);
      step('contract-a-priv-restore', 're-enabling backup privileges after isolated denies; readability no longer depends on them');
      await setBackupPrivilege(true);
      step('write-events', scriptEvents.length === 0 ? 'none' : scriptEvents.join(' | '));
      const found = await runtime.query(root, { kind: 'search', query: 'beta' });
      expect('retry-search', found.items.some((item) => item.name === 'beta'), 'beta searchable again');
      const revived = createCodeGraphRuntime(
        { fsPromises: fs.promises, path, execFile: (await import('node:child_process')).execFile },
        { storeDir: store, blockOnRead: true },
      );
      try {
        const scopes = fs.readdirSync(store);
        for (const sc of scopes) {
          const m = JSON.parse(fs.readFileSync(path.join(store, sc, 'manifest.json'), 'utf8'));
          step('store-pre-revive', `manifest buildSeq=${m.buildSeq} nodes=${m.nodeCount}`);
        }
      } catch (e) { step('store-pre-revive', `unreadable: ${String(e).slice(0, 80)}`); }
      const revivedSummary = await revived.readIndex(root);
      try {
        const scopes = fs.readdirSync(store);
        for (const sc of scopes) {
          const m = JSON.parse(fs.readFileSync(path.join(store, sc, 'manifest.json'), 'utf8'));
          step('store-final', `manifest buildSeq=${m.buildSeq} nodes=${m.nodeCount}`);
        }
      } catch (e) { step('store-final', `unreadable: ${String(e).slice(0, 80)}`); }
      step('restart-observed', `ready=${revivedSummary.ready} gen=${revivedSummary.generation ?? null} state=${revivedSummary.indexState?.state ?? null}`);
      expect('restart', revivedSummary.ready === true && revivedSummary.generation === recovered.generation, `same generation ${recovered.generation} after restart`);
      expect('restart-status', revivedSummary.indexState?.state === 'ready', `state=${revivedSummary.indexState?.state ?? 'none'}`);
      expectStoreAgrees('restart-persisted', store, revivedSummary);
      step('contract-a-done', `Contract A green: partial isolated, terminal remembered, retry clean, restart gen ${revivedSummary.generation} (native=${nativeResult})`);
      step('done', `packaged acceptance green on ${process.platform}-${arch}`);
    } finally {
      try {
        for (const name of ['a.ts', 'b.ts', 'c.ts']) {
          if (process.platform === 'win32') {
            spawnSync('icacls', [path.join(root, name), '/remove:d', USERNAME], { stdio: 'ignore' });
          } else {
            spawnSync('chmod', ['644', path.join(root, name)], { stdio: 'ignore' });
          }
        }
      } catch { /* best effort */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  } finally {
    if (!keepTmp) fs.rmSync(workdir, { recursive: true, force: true });
  }
};

try {
  await main();
} catch (error) {
  if (process.exitCode === 0) process.exitCode = 1;
  console.error(String((error && error.stack) || error).slice(0, 500));
}
