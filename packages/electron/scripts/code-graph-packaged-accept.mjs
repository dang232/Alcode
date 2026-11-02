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
 * Plain Node only (no Electron, no display, no network): every assertion
 * names its evidence, and any failure exits non-zero with the step that
 * broke. OS-specific read denial uses icacls on Windows and chmod
 * elsewhere, verified effective by reading the file back, never assumed;
 * where ACLs cannot bind Node reads (elevated tokens bypass them),
 * Windows falls back to an exclusive lock holder for the same phases.
 */
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
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

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const denyRead = async (file) => {
  const attempts = [];
  const runIcacls = (args) => {
    const result = spawnSync('icacls', args, { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
    attempts.push(
      `${args.join(' ')} -> exit ${result.status ?? `spawn-failed: ${result.error ? String(result.error).slice(0, 80) : 'unknown'}`}${result.stderr ? ` ${result.stderr.trim().slice(0, 120)}` : ''}`,
    );
    return result;
  };
  if (process.platform === 'win32') {
    runIcacls([file, '/deny', `${USERNAME}:(R)`]);
    if (await isDenied(file)) {
      return async () => {
        runIcacls([file, '/remove:d', USERNAME]);
        if (await isDenied(file)) {
          fail('restore', `icacls /remove:d did not restore readability for ${file} [${attempts.join(' | ')}]`);
        }
      };
    }
    // A Node read can still succeed here when the token bypasses ACLs
    // (elevated hosts enable SeBackupPrivilege, and libuv opens carry
    // backup intent) — while plain opens such as the engine's spawned
    // compiler are still denied. ACLs therefore cannot isolate the
    // engine on such hosts, and any ACE we just added would only block
    // the lock helper below. Clear them, then deny with an exclusive
    // lock instead: sharing violations bind every opener, privileged
    // or not, and the engine classifies any read error as unreadable.
    runIcacls([file, '/remove:d', USERNAME]);
    runIcacls([file, '/remove:d', '*S-1-1-0']);
    // Exclusive OS lock held by a short-lived helper blocks every opener
    // regardless of ACLs and restores by killing the holder.
    // Attached with piped stdio: detached+ignored holders die on some
    // hosts before taking the lock; the command prints nothing on the
    // success path, so the pipes cannot fill.
    // Two launchers: Windows PowerShell misses on some hosts (no output,
    // never executes) while PowerShell 7 behaves there, or vice versa.
    // A START marker proves the script itself runs, so a silent helper
    // is distinguishable from a failing open.
    const holderCommand = (marker) =>
      `Write-Host ${marker}; $f=$null; for ($i=0; $i -lt 20 -and -not $f; $i++) { try { $f=[System.IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'Read', 'None') } catch { Write-Host $_.Exception.Message; Start-Sleep 1 } }; if (-not $f) { exit 1 }; Start-Sleep 120`;
    const launchHolder = (binary) => {
      const child = spawn(binary, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', holderCommand(`HELPER-START-${binary}`)], { stdio: 'pipe', windowsHide: true });
      child.stdout.resume();
      child.stderr.resume();
      return child;
    };
    // One attempt per engine: launch, watch for its START marker plus
    // the lock, and give up on early exit. State stays inside the
    // attempt so a killed helper cannot poison a later relaunch.
    const tryHolder = async (binary, budgetMs) => {
      const child = launchHolder(binary);
      let output = '';
      child.stdout.on('data', (chunk) => { output += String(chunk).slice(0, 400); });
      child.stderr.on('data', (chunk) => { output += String(chunk).slice(0, 400); });
      step('deny-holder', `spawned exclusive-lock helper pid=${child.pid ?? 'none'} (${binary}) for ${path.basename(file)}`);
      let gone = false;
      let exitNote = '';
      child.on('exit', (code, signal) => {
        gone = true;
        exitNote = `code=${code ?? 'none'} signal=${signal ?? 'none'} out=${output.trim().slice(0, 200) || 'empty'}`;
      });
      child.on('error', (error) => {
        gone = true;
        exitNote = `spawn-error ${String(error).slice(0, 160)}`;
      });
      for (let waited = 0; waited < budgetMs; waited += 1000) {
        await sleep(1000);
        if (gone) return { locked: false, child, note: exitNote };
        if (await isDenied(file)) return { locked: true, child, note: output.trim().slice(0, 120) };
      }
      return { locked: false, child, note: `no lock after ${budgetMs}ms, silent=${!output.includes('HELPER-START')}` };
    };
    const killChild = (child) => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ } };
    let attempt = await tryHolder('powershell', 12000);
    if (!attempt.locked) {
      step('deny-holder-note', `powershell: ${attempt.note}`);
      killChild(attempt.child);
      attempt = await tryHolder('pwsh', 12000);
    }
    if (!attempt.locked) {
      step('deny-holder-note', `pwsh: ${attempt.note}`);
      killChild(attempt.child);
    }
    const holder = attempt.locked ? attempt.child : null;
    if (holder !== null) {
      step('deny-fallback', `exclusive lock holder for ${path.basename(file)} (ACL denies ineffective on this host)`);
      return async () => {
        for (let killRound = 0; killRound < 3; killRound += 1) {
          try { process.kill(holder.pid, 'SIGKILL'); } catch { /* already gone */ }
          await sleep(500);
          if (!(await isDenied(file))) return;
        }
        fail('restore', `lock holder kill did not restore readability for ${file}`);
      };
    }
    if (holder !== null) { try { process.kill(holder.pid, 'SIGKILL'); } catch { /* never held the lock */ } }
  } else {
    spawnSync('chmod', ['000', file], { stdio: 'ignore' });
    if (await isDenied(file)) {
      return async () => {
        spawnSync('chmod', ['644', file], { stdio: 'ignore' });
        if (await isDenied(file)) {
          fail('restore', `chmod 644 did not restore readability for ${file}`);
        }
      };
    }
  }
  fail('deny', `OS read denial unsupported for ${file} (user=${process.env.USERNAME ?? '?'}, domain=${process.env.USERDOMAIN ?? '?'}; attempts: ${attempts.join(' | ') || 'none'})`);
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-pkg-fx-'));
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
      dumpStore('store-after-cold');
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
      const warm = await runtime.readIndex(root, { block: true });
      expect('warm', warm.ready === true && warm.generation === cold.generation, 'served without rebuild, same generation');

      write('a.ts', 'export function alpha(): number { return 11; }\n');
      const bumped = new Date('2026-02-02T00:00:00Z');
      fs.utimesSync(path.join(root, 'b.ts'), bumped, bumped);
      const restoreB = await denyRead(path.join(root, 'b.ts'));
      try {
        const partial = await runtime.readIndex(root, { block: true, refresh: true });
        expect('partial', partial.ready === true && (partial.incremental?.unreadableFileCount ?? 0) >= 1, 'partial with unreadable recorded');
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
      expect('terminal-failure', threw !== null, `failed loudly (${threw})`);
      const terminals = events.filter((state) => state === 'failed').length;
      for (let i = 0; i < 3; i += 1) {
        const polled = await failing.readIndex(root);
        if (polled.ready !== false || polled.indexState?.state !== 'failed') {
          fail('failure-memory', `poll ${i} escaped the failed state`);
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
      dumpStore('store-after-retry');
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
      const m = JSON.parse(fs.readFileSync(store + "/" + sc + "/manifest.json", "utf8"));
      step('store-final', `manifest buildSeq=${m.buildSeq} nodes=${m.nodeCount}`);
    }
  } catch (e) { step('store-final', `unreadable: ${String(e).slice(0, 80)}`); }
      step('restart-observed', `ready=${revivedSummary.ready} gen=${revivedSummary.generation ?? null} state=${revivedSummary.indexState?.state ?? null}`);
      expect('restart', revivedSummary.ready === true && revivedSummary.generation === recovered.generation, `same generation ${recovered.generation} after restart`);
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
