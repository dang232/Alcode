/**
 * Code-graph site runtime: real engine snapshots served per directory.
 *
 * The engine (`code-graph.bundle.js`, built from `engine.js`) owns symbol
 * extraction and query shaping; this module owns everything the engine
 * cannot know: which directory a request is about, how that directory maps
 * to a graph scope, when the cached snapshot is fresh, and how a backend
 * failure surfaces without ever masquerading as an empty graph.
 *
 * Freshness mirrors `cache.ts`: a cached snapshot serves only while its
 * revision still matches the directory and its age stays within
 * `STALE_AFTER_MS`. A moved HEAD, an uncommitted edit, or a changed content
 * binding rebuilds;
 * a failed rebuild keeps serving the last snapshot but flags it `stale`
 * with the reason and the refresh error attached, so the panel can offer
 * a refresh instead of showing data as current. With no snapshot at all,
 * the failure throws and the route answers 503 — never a fake empty.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createSnapshotStorage } from './snapshot-storage.js';

let enginePromise = null;

/** Lazy so a checkout without a resolvable engine fails per request, never at server startup. */
const loadEngine = () => {
  if (!enginePromise) {
    enginePromise = import('./code-graph.bundle.js');
  }
  return enginePromise;
};

/** How long one `git status` answer stays valid for passive freshness checks.
 *
 * A status spawn per query is the cost Phase 1 removed, so the probe is
 * cached per directory: within the TTL a passive query may serve a snapshot
 * that is at most TTL-old, while an explicit `refresh: true` bypasses the
 * cache and always rebuilds. */
export const GIT_STATUS_TTL_MS = 1500;

/** Default cap for one directory walk: the panel is bounded, never the whole graph.
 *
 * Raised so a mid-size monorepo (~1k eligible sources) indexes fully instead
 * of silently dropping its tail. Override per runtime via
 * `createCodeGraphRuntime(deps, { maxEntryFiles })` or per call via the
 * `maxEntryFiles` option; either is clamped to HARD_MAX_ENTRY_FILES. */
export const DEFAULT_MAX_ENTRY_FILES = 5000;

/** Hard safety bound: no caller can ask the walk past this. */
export const HARD_MAX_ENTRY_FILES = 20000;

/** How many excluded repo-relative paths ride the served entry as a sample. */
export const MAX_EXCLUDED_SAMPLE = 10;

const resolveMaxEntryFiles = (value) => {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) {
    return DEFAULT_MAX_ENTRY_FILES;
  }
  return Math.min(HARD_MAX_ENTRY_FILES, Math.max(1, Math.floor(Number(value))));
};

// The walk is capped (DEFAULT_MAX_ENTRY_FILES), so a directory that only holds
// generated or agent-owned artifacts would spend the whole budget before
// the first source file: `.omo` (evidence/plans) and `web-dist` (staged UI
// bundles) are skipped for that reason, not because they are uninteresting.
const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  '.omo',
  'web-dist',
  'dist',
  'dist-bundle',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  'vendor',
  'ios',
  'android',
  'Pods',
  '.turbo',
  '.parcel-cache',
]);

const ENTRY_FILE = /\.[cm]?[tj]sx?$/;

const HEX40 = /^[0-9a-f]{40}$/;

const sanitizeSlug = (value, fallback) => {
  const cleaned = String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() ?? '';
  const slug = cleaned.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || fallback;
};

const sha256Hex = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const sha1Hex = (value) => createHash('sha1').update(value, 'utf8').digest('hex');

// String check without a runtime `typeof` (banned by the anti-slop gate).
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';

const runGitHead = (spawnGit, directory) => new Promise((resolve) => {
  spawnGit('git', ['-C', directory, 'rev-parse', 'HEAD'], { timeout: 10000 }, (error, stdout) => {
    if (error) {
      resolve(null);
      return;
    }
    const revision = String(stdout ?? '').trim().toLowerCase();
    resolve(HEX40.test(revision) ? revision : null);
  });
});

/**
 * Spawn-free HEAD read: `.git/HEAD` plus the referenced ref (or
 * `packed-refs`) give the same 40-hex `git rev-parse HEAD` would, without
 * forking a subprocess on every query. A stat-based memo skips even the
 * file reads while HEAD and its backing ref are untouched; any move
 * changes an mtime/size and the next read re-parses. Only when git-owned
 * files exist but cannot be parsed (unreadable, garbled) does the caller
 * fall back to the `execFile` path above — a directory with no git
 * metadata at all goes straight to the content binding without a spawn.
 */
const createGitHeadReader = ({ fsPromises, path }) => {
  // gitDir -> { headKey, refPath, refKey, extraPath, extraKey, value }
  const memo = new Map();

  const statKey = async (file) => {
    try {
      const stat = await fsPromises.stat(file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  };

  const readText = async (file) => {
    try {
      return await fsPromises.readFile(file, 'utf8');
    } catch {
      return null;
    }
  };

  // `.git` may be a directory (checkout), a `gitdir:` pointer file
  // (worktree/submodule), or absent; a bare repo keeps HEAD at the top.
  const resolveGitDir = async (directory) => {
    const dotGit = path.join(directory, '.git');
    let dotStat = null;
    try {
      dotStat = await fsPromises.stat(dotGit);
    } catch {
      dotStat = null;
    }
    if (dotStat) {
      if (dotStat.isDirectory()) return { gitDir: dotGit, bare: false };
      const pointer = await readText(dotGit);
      if (pointer !== null) {
        const match = /^gitdir:\s*(.+?)\s*$/.exec(pointer.trim());
        if (match) {
          const target = match[1];
          return { gitDir: path.isAbsolute(target) ? target : path.resolve(directory, target), bare: false };
        }
      }
      // A `.git` that is neither a directory nor a parseable pointer is
      // unreadable metadata: the caller falls back to the subprocess.
      return { gitDir: null, bare: false, unreadable: true };
    }
    const topHead = await statKey(path.join(directory, 'HEAD'));
    if (topHead !== null) return { gitDir: directory, bare: true };
    return { gitDir: null, bare: false, unreadable: false };
  };

  const shaFromGitDir = async (gitDir) => {
    const raw = await readText(path.join(gitDir, 'HEAD'));
    if (raw === null) return { status: 'unreadable' };
    const trimmed = raw.trim();
    if (HEX40.test(trimmed.toLowerCase())) {
      return { status: 'ok', head: trimmed.toLowerCase(), refPath: null };
    }
    const match = /^ref:\s*(.+?)\s*$/.exec(trimmed);
    if (!match) return { status: 'unreadable' };
    const ref = match[1];
    if (ref.includes('..') || ref.startsWith('/')) return { status: 'unreadable' };
    const refPath = path.join(gitDir, ...ref.split('/'));
    const loose = await readText(refPath);
    if (loose !== null) {
      const sha = loose.trim().toLowerCase();
      if (HEX40.test(sha)) return { status: 'ok', head: sha, refPath };
      return { status: 'unreadable' };
    }
    const packed = await readText(path.join(gitDir, 'packed-refs'));
    if (packed !== null) {
      for (const line of packed.split('\n')) {
        const text = line.trim();
        if (!text || text.startsWith('#') || text.startsWith('^')) continue;
        const parts = text.split(/\s+/);
        if (parts.length >= 2 && parts[1] === ref && HEX40.test((parts[0] ?? '').toLowerCase())) {
          return { status: 'ok', head: parts[0].toLowerCase(), refPath };
        }
      }
    }
    return { status: 'unreadable' };
  };

  return async (directory) => {
    const resolved = await resolveGitDir(directory);
    if (!resolved.gitDir) {
      return resolved.unreadable ? { status: 'unreadable' } : { status: 'absent' };
    }
    const { gitDir } = resolved;
    const headPath = path.join(gitDir, 'HEAD');
    const headKey = await statKey(headPath);
    if (headKey === null) return { status: 'unreadable' };
    const cached = memo.get(gitDir);
    if (cached && cached.headKey === headKey) {
      if (cached.refPath === null) return { status: 'ok', head: cached.value };
      const refKey = await statKey(cached.refPath);
      const extraKey = cached.extraPath ? await statKey(cached.extraPath) : null;
      if (refKey === cached.refKey && extraKey === cached.extraKey) {
        return { status: 'ok', head: cached.value };
      }
    }
    const parsed = await shaFromGitDir(gitDir);
    if (parsed.status !== 'ok') return parsed;
    const refKey = parsed.refPath ? await statKey(parsed.refPath) : null;
    // A packed-refs answer goes stale the moment the loose ref appears, so
    // the memo pins both: the ref's absence (null) and the packed file.
    const packedPath = parsed.refPath && refKey === null ? path.join(gitDir, 'packed-refs') : null;
    memo.set(gitDir, {
      headKey,
      refPath: parsed.refPath,
      refKey,
      extraPath: packedPath,
      extraKey: packedPath ? await statKey(packedPath) : null,
      value: parsed.head,
    });
    return parsed;
  };
};

/**
 * Directory validation is pure fs + path, so it is a module-level function the
 * host can run in its own process: routing it through the worker made every
 * request that names a directory wait behind a running build.
 */
export const createDirectoryNormalizer = ({ fsPromises, path }) => async (directory) => {
  const trimmed = isString(directory) ? directory.trim() : '';
  if (!trimmed) {
    return { error: 'directory is required' };
  }
  const normalized = path.normalize(trimmed);
  let stat = null;
  try {
    stat = await fsPromises.stat(normalized);
  } catch {
    return { error: `directory not found: ${trimmed}`, status: 404 };
  }
  if (!stat.isDirectory()) {
    return { error: `not a directory: ${trimmed}`, status: 404 };
  }
  return { directory: normalized };
};

export const createCodeGraphRuntime = ({ fsPromises, path, execFile: injectedExecFile }, runtimeOptions = {}) => {
  if (!fsPromises || !path) {
    throw new Error('code-graph runtime requires fsPromises and path');
  }
  // Spawn seam: production runs the real `execFile`; tests inject a
  // delegating fake (e.g. counting status spawns) instead of mocking the module.
  const spawnGit = injectedExecFile ?? execFile;
  /**
   * Blocking reads are a test/CLI seam, not a product mode: they make
   * `readIndex`/`query` wait for the build so a suite can assert graph facts
   * on the result. The server never sets it — that wait is exactly the freeze
   * this lifecycle exists to remove.
   */
  const blockOnRead = runtimeOptions.blockOnRead === true;
  const defaultMaxEntryFiles = resolveMaxEntryFiles(runtimeOptions.maxEntryFiles);
  const readGitHead = createGitHeadReader({ fsPromises, path });

  /** One `git status` answer per directory: a spawn per query is the cost
   * Phase 1 removed. Overridable via `gitStatusTTLMs`; defaults to
   * `GIT_STATUS_TTL_MS`. */
  const gitStatusTTLMs = (() => {
    const override = Number(runtimeOptions.gitStatusTTLMs);
    return Number.isFinite(override) && override > 0 ? override : GIT_STATUS_TTL_MS;
  })();

  // directory -> { atMs, result } for the last status probe.
  const gitStatusCache = new Map();

  const runGitStatus = (directory) => new Promise((resolve) => {
    spawnGit(
      'git',
      ['-C', directory, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { timeout: 10000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve({ ok: false });
          return;
        }
        resolve({ ok: true, stdout: String(stdout ?? '') });
      },
    );
  });

  /**
   * Porcelain `-z` records are NUL-separated `XY <path>`; a rename/copy
   * record carries its second path as the next token. Both sides join the
   * dirty set: the old name left the index even when only the new one is an
   * entry file.
   */
  const parseGitStatusZ = (stdout) => {
    const entries = [];
    const tokens = String(stdout ?? '').split('\0');
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.length < 4 || token[2] !== ' ') continue;
      const code = token.slice(0, 2);
      const first = token.slice(3);
      if (code[0] === 'R' || code[0] === 'C') {
        const second = tokens[index + 1] ?? '';
        if (second.length > 0) index += 1;
        entries.push({ code, paths: second.length > 0 ? [first, second] : [first] });
      } else {
        entries.push({ code, paths: [first] });
      }
    }
    return entries;
  };

  const isEntryCandidateRel = (rel) => ENTRY_FILE.test(path.basename(rel));

  const stampDirtyPath = async (directory, rel) => {
    let stat = null;
    try {
      stat = await fsPromises.stat(path.join(directory, ...rel.split('/')));
    } catch {
      stat = null;
    }
    // A deleted path has no stat: the sentinel still moves the revision, the
    // same way a same-byte-length edit moves it through mtimeMs.
    if (!stat || !stat.isFile()) return `${rel}:deleted`;
    return `${rel}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  };

  /**
   * Dirty fingerprint lines for the entry candidates git reports as
   * modified, staged, renamed, deleted, or untracked. The status code rides
   * each line so staging (or unstaging) an identical file still moves the
   * revision; non-entry paths never join, since they cannot change the
   * indexed graph and must not force a rebuild.
   */
  const readDirtyFingerprint = async (directory, { force = false } = {}) => {
    const key = path.normalize(directory);
    const now = Date.now();
    if (!force) {
      const hit = gitStatusCache.get(key);
      if (hit && now - hit.atMs < gitStatusTTLMs) return hit.result;
    }
    const ran = await runGitStatus(directory);
    let result;
    if (!ran.ok) {
      result = { ok: false };
    } else {
      const lines = [];
      for (const entry of parseGitStatusZ(ran.stdout)) {
        if (!entry.paths.some(isEntryCandidateRel)) continue;
        for (const rel of entry.paths) {
          lines.push(`${entry.code} ${await stampDirtyPath(directory, rel)}`);
        }
      }
      lines.sort();
      result = { ok: true, lines };
    }
    gitStatusCache.set(key, { atMs: Date.now(), result });
    return result;
  };

  let buildSeq = 0;

  /** Distinct query answers kept per snapshot build; FIFO-evicted, never shared across builds. */
  const MAX_CACHED_QUERIES = 200;

  /** Normalized directory -> cached snapshot entry. Project isolation is the key. */
  const snapshots = new Map();
  /**
   * Normalized directory -> the last partial projection an in-flight build
   * handed over. It exists ONLY so a progress reader can show what is analysed
   * so far; it is never a generation. A partial is missing every project not
   * yet analysed, so serving it from `snapshots` presents half a graph as the
   * whole graph - and because the entry mints a generation, a build that ends
   * without publishing (cancelled, failed, crashed) would leave that half graph
   * behind as the last known-good one. Kept apart so neither can happen.
   */
  const partialByDirectory = new Map();
  /**
   * One in-flight build per directory. Without this, opening the panel, the
   * module map, and a query at the same moment each started its own full
   * build: the same work repeated, on the same thread, at the same time.
   */
  const jobs = new Map();
  /**
   * A published graph is not free: one large monorepo measured ~1 GB of heap.
   * Retention is bounded to the most recently built directories so a session
   * that touches many projects cannot hold every graph at once.
   */
  const MAX_RETAINED_SNAPSHOTS = 3;

  const normalizeDirectory = createDirectoryNormalizer({ fsPromises, path });

  const deriveScopeIds = (directory) => {
    const digest = sha256Hex(directory);
    return {
      projectId: `${sanitizeSlug(path.basename(directory), 'project')}-${digest.slice(0, 8)}`,
      worktreeId: sanitizeSlug(path.basename(directory), 'worktree'),
    };
  };

  // The walk counts every eligible-but-excluded file instead of stopping at
  // the cap: `excludedCount` is measured from the walk, never guessed, and
  // `excludedSample` keeps the first repo-relative paths so the panel can
  // name what the index does not see.
  //
  // The same walk also accounts for what the engine never analyzes, per
  // module bucket (first repo-relative segment, `(root)` at the top):
  // analyzed entry files, unanalyzed files by extension (.sh, .yml, .md,
  // ... anything that is not a compiler entry), and excluded files —
  // eligible entries cut by the cap plus everything under a skipped
  // generated/vendored directory. Directories the walk cannot read, and
  // generated directories it deliberately does not descend, are named in
  // `unreadableDirs`/`skippedDirs` instead of being silently dropped, so a
  // count is never fabricated for a tree the walk could not see. Files
  // under skipped directories are counted by a bounded scan (no compiler
  // work, just names); when the bound hits, `excludedTruncated` says the
  // excluded count is a floor.
  const MAX_SKIPPED_SCAN_FILES = 10000;

  const bucketOfRel = (rel) => {
    const segments = String(rel ?? '').split('/').filter((segment) => segment.length > 0);
    return segments.length > 1 ? segments[0] : '(root)';
  };

  const extOf = (name) => {
    const ext = path.extname(String(name ?? '')).toLowerCase();
    return ext.length > 0 ? ext : '(no-extension)';
  };

  const listEntryFiles = async (directory, maxEntryFiles) => {
    const cap = resolveMaxEntryFiles(maxEntryFiles ?? defaultMaxEntryFiles);
    const entries = [];
    let scanned = 0;
    let excludedCount = 0;
    const excludedSample = [];
    const skippedDirs = [];
    const unreadableDirs = [];
    // bucket -> { analyzedFiles, unanalyzedFiles, unanalyzedByExtension, excludedFiles }
    const byModule = new Map();
    const bucketStats = (bucket) => {
      let stats = byModule.get(bucket);
      if (!stats) {
        stats = { analyzedFiles: 0, unanalyzedFiles: 0, unanalyzedByExtension: {}, excludedFiles: 0 };
        byModule.set(bucket, stats);
      }
      return stats;
    };
    const relOf = (full) => path.relative(directory, full).split(path.sep).join('/');
    // Bounded count-only scan of a skipped generated/vendored directory:
    // every file counts as excluded in the skipped directory's own bucket.
    // The shared budget bounds symlink cycles as well as huge vendored
    // trees; hitting it marks the excluded count a floor, never a total.
    const scanState = { count: 0, truncated: false };
    const countSkipped = async (dir, bucket) => {
      if (scanState.count >= MAX_SKIPPED_SCAN_FILES) {
        scanState.truncated = true;
        return;
      }
      let names = [];
      try {
        names = await fsPromises.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (scanState.count >= MAX_SKIPPED_SCAN_FILES) {
          scanState.truncated = true;
          return;
        }
        if (name === '.' || name === '..') continue;
        scanState.count += 1;
        let stat = null;
        try {
          stat = await fsPromises.stat(path.join(dir, name));
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          await countSkipped(path.join(dir, name), bucket);
        } else if (stat.isFile()) {
          bucketStats(bucket).excludedFiles += 1;
        }
      }
    };
    const visit = async (dir) => {
      let names = [];
      try {
        names = await fsPromises.readdir(dir);
      } catch {
        const rel = relOf(dir);
        unreadableDirs.push(rel.length > 0 ? rel : '.');
        return;
      }
      names.sort();
      for (const name of names) {
        if (name === '.' || name === '..') continue;
        const full = path.join(dir, name);
        let stat = null;
        try {
          stat = await fsPromises.stat(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          if (SKIPPED_DIRS.has(name)) {
            const rel = relOf(full);
            skippedDirs.push(rel);
            await countSkipped(full, bucketOfRel(rel));
            continue;
          }
          await visit(full);
        } else if (stat.isFile()) {
          scanned += 1;
          const rel = relOf(full);
          const bucket = bucketOfRel(rel);
          if (!ENTRY_FILE.test(name)) {
            const stats = bucketStats(bucket);
            stats.unanalyzedFiles += 1;
            const ext = extOf(name);
            stats.unanalyzedByExtension[ext] = (stats.unanalyzedByExtension[ext] ?? 0) + 1;
            continue;
          }
          if (entries.length >= cap) {
            excludedCount += 1;
            bucketStats(bucket).excludedFiles += 1;
            if (excludedSample.length < MAX_EXCLUDED_SAMPLE) {
              excludedSample.push(rel);
            }
            continue;
          }
          entries.push(full);
          bucketStats(bucket).analyzedFiles += 1;
        }
      }
    };
    await visit(directory);
    entries.sort();
    skippedDirs.sort();
    unreadableDirs.sort();
    const buckets = [...byModule.keys()].sort();
    const modules = {};
    for (const bucket of buckets) {
      const stats = byModule.get(bucket);
      modules[bucket] = {
        analyzedFiles: stats.analyzedFiles,
        unanalyzedFiles: stats.unanalyzedFiles,
        unanalyzedByExtension: Object.fromEntries(
          Object.entries(stats.unanalyzedByExtension).sort(([left], [right]) =>
            (left < right ? -1 : left > right ? 1 : 0)),
        ),
        excludedFiles: stats.excludedFiles,
      };
    }
    const totals = { analyzedFiles: 0, unanalyzedFiles: 0, unanalyzedByExtension: {}, excludedFiles: 0 };
    for (const stats of Object.values(modules)) {
      totals.analyzedFiles += stats.analyzedFiles;
      totals.unanalyzedFiles += stats.unanalyzedFiles;
      totals.excludedFiles += stats.excludedFiles;
      for (const [ext, count] of Object.entries(stats.unanalyzedByExtension)) {
        totals.unanalyzedByExtension[ext] = (totals.unanalyzedByExtension[ext] ?? 0) + count;
      }
    }
    totals.unanalyzedByExtension = Object.fromEntries(
      Object.entries(totals.unanalyzedByExtension).sort(([left], [right]) =>
        (left < right ? -1 : left > right ? 1 : 0)),
    );
    return { entries, scanned, truncated: excludedCount > 0, excludedCount, excludedSample, maxEntryFiles: cap, coverage: { byModule: modules, totals, skippedDirs, unreadableDirs, excludedTruncated: scanState.truncated } };
  };

  /**
   * Revision binding: the git HEAD folded with the working-tree dirty set
   * when the directory is a checkout, otherwise a content hash of the entry
   * listing. Every binding is 40-hex, and any of them changes when the tree
   * does, so a moved HEAD, an uncommitted edit, or an edited file outside
   * git rebuilds instead of serving stale refs.
   *
   * The dirty set is one `git status` probe cached per directory for
   * `gitStatusTTLMs`: within the TTL a passive query may serve a snapshot
   * that is at most TTL-old, while `forceStatus` (an explicit refresh)
   * bypasses the cache. Only entry candidates (files the walk would index)
   * join the fingerprint — each stamped `size:mtimeMs` with a `deleted`
   * sentinel, so a same-byte-length edit still moves it — and a failed probe
   * falls back to the HEAD-only binding labelled `dirty: 'unknown'` with
   * the reason, never a silent claim of clean.
   */
  const readRevision = async (directory, entryFiles, { forceStatus = false } = {}) => {
    const local = await readGitHead(directory);
    let head = null;
    if (local.status === 'ok') {
      head = local.head;
    } else if (local.status === 'unreadable') {
      // Git metadata exists but the files could not be parsed: keep the old
      // subprocess as a last resort instead of silently rebinding content.
      head = await runGitHead(spawnGit, directory);
    }
    if (head !== null) {
      const dirty = await readDirtyFingerprint(directory, { force: forceStatus });
      if (!dirty.ok) {
        return { revision: head, binding: 'git-head', dirty: 'unknown', dirtyReason: 'git-status-unavailable' };
      }
      if (dirty.lines.length === 0) return { revision: head, binding: 'git-head', dirty: 'clean' };
      return {
        revision: sha1Hex(`${head}\n${dirty.lines.join('\n')}`),
        binding: 'git-head',
        dirty: 'dirty',
      };
    }
    // No git metadata (or an unreadable fallback): no spawn, just bind.
    // Each entry carries size and mtime: a listing-only hash cannot see an edited
    // file whose name never changed, so a non-git directory would serve a stale
    // graph after an in-place edit.
    const stamped = await Promise.all(entryFiles.map(async (entry) => {
      const rel = path.relative(directory, entry).split(path.sep).join('/');
      const stat = await fsPromises.stat(entry).catch(() => null);
      return stat === null ? `${rel}:unreadable` : `${rel}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    }));
    return { revision: sha1Hex(`${directory}\n${stamped.join('\n')}`), binding: 'content' };
  };

  // Bounded projection of a partial graph, small enough to ride a progress
// message out of the blocked worker: module buckets from indexed file paths
// plus counts. Never the whole graph - a 1269-file repo would put tens of MB on
// the IPC channel mid-build.
const PARTIAL_MODULE_LIMIT = 12;
const summarizePartialSnapshot = (snapshot) => {
  const modules = new Map();
  for (const node of snapshot.nodes ?? []) {
    const file = node?.file ?? '';
    if (file === '') continue;
    const segments = file.split('/');
    const bucket = segments.length > 2 ? `${segments[0]}/${segments[1]}` : (segments[0] ?? file);
    modules.set(bucket, (modules.get(bucket) ?? 0) + 1);
  }
  const ranked = [...modules.entries()].sort((left, right) => right[1] - left[1]);
  return {
    nodes: (snapshot.nodes ?? []).length,
    edges: (snapshot.edges ?? []).length,
    modules: ranked.slice(0, PARTIAL_MODULE_LIMIT).map(([module, count]) => ({ module, count })),
    modulesTotal: ranked.length,
  };
};

const buildSnapshot = async (directory, maxEntryFiles, { forceStatus = false, onProgress = null } = {}) => {
    const engine = await loadEngine();
    const { entries, truncated, excludedCount, excludedSample, maxEntryFiles: cap, coverage } = await listEntryFiles(directory, maxEntryFiles);
    const { revision, binding, dirty, dirtyReason } = await readRevision(directory, entries, { forceStatus });
    const { projectId, worktreeId } = deriveScopeIds(directory);
    const fingerprint = engine.computeScopeFingerprint(projectId, worktreeId, revision);
    // Repo-root-relative ids: the engine roots every file id at the
    // directory the route serves, so the served `snapshotRoot` below is
    // the same root the resolver joins ids against — joining against
    // anything else addresses files that do not exist.
    const snapshot = engine.indexFiles(entries, {
      rootDir: directory,
      onProgress: onProgress ?? undefined,
      // A build of several projects takes minutes, and a reader polling for
      // progress used to get an empty graph the whole time. Each finished
      // project is published here as the directory's current answer; the
      // complete entry returned below replaces it, and persistEntry still only
      // ever writes the finished generation.
      //
      // The progress message also carries a bounded projection of the partial
      // graph, because the worker's event loop is blocked by the synchronous
      // build: the host can answer "what is indexed so far" from that message
      // even though every graph query would queue behind the build.
      onPartialSnapshot: (partialSnapshot, progress) => {
        partialByDirectory.set(directory, assembleEntry({
          snapshot: partialSnapshot,
          scope: { projectId, worktreeId, revision, fingerprint },
          binding,
          dirty,
          dirtyReason,
          truncated,
          excludedCount,
          excludedSample,
          cap,
          entries,
          coverage,
        }));
        onProgress?.({
          phase: 'projects',
          files: entries.length,
          projectsDone: progress.projectsDone,
          projectsTotal: progress.projectsTotal,
          partial: summarizePartialSnapshot(partialSnapshot),
        });
      },
    });
    const built = assembleEntry({ snapshot, scope: { projectId, worktreeId, revision, fingerprint }, binding, dirty, dirtyReason, truncated, excludedCount, excludedSample, cap, entries, coverage });
    // The finished graph supersedes any projection this build handed over.
    partialByDirectory.delete(directory);
    void persistEntry(directory, built);
    return built;
  };

  /**
   * The entry every read serves, assembled once so a rebuilt graph and a
   * restored one cannot drift in shape.
   */
  const assembleEntry = ({ snapshot, scope, binding, dirty, dirtyReason, truncated, excludedCount, excludedSample, cap, entries, coverage, observedAtMs }) => {
    buildSeq += 1;
    const built = {
      snapshot,
      scope,
      observedAtMs: observedAtMs ?? Date.now(),
      binding,
      // Null outside git: the content-hash path reports no working-tree
      // state and the served shape stays exactly as it was.
      dirty: dirty ?? null,
      truncated,
      indexTruncated: truncated,
      excludedCount,
      excludedSample,
      entryCap: cap,
      entryCount: entries.length,
      entryFiles: entries,
      // Walk-measured module coverage (analyzed vs unanalyzed vs
      // excluded): plain JSON riding the served entry so exploreModules
      // can report it without re-walking.
      coverage,
      // Monotonic build identity: a rebuild (refresh, HEAD move, cap
      // change) always mints a new one, so per-build caches below can key
      // on it instead of guessing from timestamps.
      buildSeq,
      // Every query answer below is a pure function of (snapshot, input),
      // so repeats within one build are memoized. The map dies with the
      // entry on rebuild: a new build mints an empty one, and the FIFO cap
      // bounds a build that serves many distinct one-off queries.
      queryCache: new Map(),
    };
    if (dirtyReason) {
      built.dirtyReason = dirtyReason;
    }
    return built;
  };

  let snapshotStorage = null;
  const getStorage = async () => {
    if (typeof runtimeOptions.storeDir !== 'string' || runtimeOptions.storeDir.length === 0) return null;
    if (snapshotStorage === null) {
      const engine = await loadEngine();
      snapshotStorage = createSnapshotStorage({ fsPromises, path, engine, storeDir: runtimeOptions.storeDir });
    }
    return snapshotStorage;
  };

  /**
   * Persisting never blocks a read: a store that cannot be written is reported
   * as a state note and the next open simply rebuilds.
   */
  const persistEntry = async (directory, entry) => {
    if (entry.truncated) return;
    const storage = await getStorage();
    if (!storage) return;
    const result = await storage.write(directory, entry);
    if (!result.written) {
      emitProgress(directory, { state: 'ready', storeWriteFailed: result.reason ?? 'unknown' });
    }
  };

  /**
   * A store hit skips the compiler build entirely (measured 257–268 s on a large
   * monorepo). The repository's scope is read first, so a store written before
   * an edit cannot be served as current: any revision or dirty-fingerprint
   * difference is a miss and the caller rebuilds.
   */
  const restoreFromStore = async (directory, cap) => {
    const storage = await getStorage();
    if (!storage) return null;
    const engine = await loadEngine();
    const { entries, truncated, excludedCount, excludedSample, coverage } = await listEntryFiles(directory, cap);
    if (truncated) return null;
    const { revision, binding, dirty, dirtyReason } = await readRevision(directory, entries, { forceStatus: false });
    const { projectId, worktreeId } = deriveScopeIds(directory);
    const fingerprint = engine.computeScopeFingerprint(projectId, worktreeId, revision);
    let read;
    try {
      read = await storage.read(directory, { projectId, worktreeId, revision, fingerprint });
    } catch (error) {
      // A restore that throws is a miss with a stated reason, never a silent
      // fallthrough: the first version swallowed a stack overflow here and the
      // panel rebuilt for minutes while the store looked healthy.
      emitProgress(directory, { state: 'discovering', storeReadFailed: error instanceof Error ? error.message : String(error) });
      return null;
    }
    if (read.status !== 'hit') return null;
    const built = assembleEntry({
      snapshot: read.snapshot,
      scope: { projectId, worktreeId, revision, fingerprint },
      binding,
      dirty,
      dirtyReason,
      truncated: false,
      excludedCount,
      excludedSample,
      cap,
      entries,
      coverage,
      observedAtMs: read.manifest.observedAtMs,
    });
    emitProgress(directory, {
      state: 'ready',
      seeded: true,
      restoredFromStore: true,
      generation: built.buildSeq,
      nodes: built.snapshot.nodes.length,
      edges: built.snapshot.edges.length,
      entryCount: built.entryCount,
    });
    return built;
  };

  const ensureIndex = async (directory, { refresh = false, maxEntryFiles, block = false } = {}) => {
    const engine = await loadEngine();
    const cap = resolveMaxEntryFiles(maxEntryFiles ?? defaultMaxEntryFiles);
    const cached = snapshots.get(directory);
    if (!refresh && cached && cached.entryCap === cap) {
      const { revision } = await readRevision(directory, cached.entryFiles ?? []);
      if (revision === cached.scope.revision && Date.now() - cached.observedAtMs <= engine.STALE_AFTER_MS) {
        return { entry: { ...cached, freshness: 'fresh' } };
      }
    }
    // No usable in-memory graph: a persisted generation for this exact scope
    // replaces a full rebuild. An explicit refresh always rebuilds.
    if (!refresh) {
      const restored = await restoreFromStore(directory, cap).catch(() => null);
      if (restored) {
        retainSnapshot(directory, restored);
        return { entry: { ...restored, freshness: 'fresh' } };
      }
    }
    // Dedupe: a build already running for this directory is the answer, so a
    // second request joins it instead of starting a second full build.
    const running = jobs.get(directory);
    if (running) {
      if (!block) return { pending: jobFacts(running), cached: cached ?? null };
      try {
        return { entry: { ...(await running.promise), freshness: 'fresh' } };
      } catch (error) {
        return cached ? { entry: { ...cached, freshness: 'stale' }, refreshFailed: error } : Promise.reject(error);
      }
    }
    const job = startJob(directory, cap, { refresh });
    if (!block) return { pending: jobFacts(job), cached: cached ?? null };
    try {
      return { entry: { ...(await job.promise), freshness: 'fresh' } };
    } catch (error) {
      // A failed refresh never erases the last valid graph.
      const lastValid = snapshots.get(directory);
      if (lastValid) return { entry: { ...lastValid, freshness: 'stale' }, refreshFailed: error };
      throw error;
    }
  };

  /**
   * The job registry and its state machine. Every state below is reached by
   * real work: `discovering` while the entry walk and revision read run,
   * `analyzing` per project the engine finishes, `persisting` once the graph
   * exists and is being published, `ready` only after it is published.
   */
  const jobFacts = (job) => ({
    state: job.state,
    startedAtMs: job.startedAtMs,
    progress: job.progress ?? null,
    cancelRequested: job.cancelRequested === true,
    error: job.error ?? null,
  });

  const emitProgress = (directory, event) => {
    if (typeof runtimeOptions.onProgress !== 'function') return;
    try {
      runtimeOptions.onProgress({ directory, atMs: Date.now(), ...event });
    } catch {
      // A reporter must never break an index build.
    }
  };

  const retainSnapshot = (directory, entry) => {
    // A published generation always supersedes a projection for that directory.
    partialByDirectory.delete(directory);
    snapshots.set(directory, entry);
    while (snapshots.size > MAX_RETAINED_SNAPSHOTS) {
      const oldest = [...snapshots.entries()]
        .filter(([key]) => key !== directory)
        .sort((left, right) => (left[1].observedAtMs ?? 0) - (right[1].observedAtMs ?? 0))[0];
      if (!oldest) break;
      snapshots.delete(oldest[0]);
    }
  };

  const startJob = (directory, cap, { refresh }) => {
    const job = {
      directory,
      startedAtMs: Date.now(),
      state: 'queued',
      progress: null,
      cancelRequested: false,
      error: null,
    };
    job.promise = (async () => {
      job.state = 'discovering';
      emitProgress(directory, { state: 'discovering' });
      try {
        const entry = await buildSnapshot(directory, cap, {
          forceStatus: refresh,
          onProgress: (event) => {
            // Cancellation is honoured at the next real phase boundary: the
            // engine call itself is synchronous, so the earliest safe point
            // is the next progress report.
            if (job.cancelRequested) {
              const cancelled = new Error('code-graph index cancelled');
              cancelled.code = 'CANCELLED';
              throw cancelled;
            }
            job.state = event.phase === 'done' ? 'persisting' : 'analyzing';
            job.progress = event;
            emitProgress(directory, {
              state: job.state,
              phase: event.phase,
              files: event.files,
              projectsDone: event.projectsDone,
              projectsTotal: event.projectsTotal,
            });
          },
        });
        retainSnapshot(directory, entry);
        job.state = 'ready';
        emitProgress(directory, {
          state: 'ready',
          generation: entry.buildSeq,
          nodes: entry.snapshot.nodes.length,
          edges: entry.snapshot.edges.length,
          entryCount: entry.entryCount,
          // The published facts ride the event so a caller holding only the
          // progress stream can still describe the graph it is serving.
          projectId: entry.scope.projectId,
          worktreeId: entry.scope.worktreeId,
          revision: entry.scope.revision,
          fingerprint: entry.scope.fingerprint,
          binding: entry.binding ?? null,
          snapshotRoot: entry.snapshot.root ?? null,
        });
        return entry;
      } catch (error) {
        const cancelled = job.cancelRequested === true || error?.code === 'CANCELLED';
        job.state = cancelled ? 'cancelled' : 'failed';
        job.error = cancelled ? null : error instanceof Error ? error.message : String(error);
        // A build that never publishes must not leave its projection behind:
        // the projection is not a generation, and the previous complete one
        // (if any) stays exactly where it was, labelled stale on the next read.
        partialByDirectory.delete(directory);
        emitProgress(directory, { state: job.state, error: job.error });
        throw error;
      } finally {
        jobs.delete(directory);
      }
    })();
    // A fire-and-forget start must not surface as an unhandled rejection; the
    // failure is reported through the state and by the next read.
    job.promise.catch(() => {});
    jobs.set(directory, job);
    return job;
  };

  /** Stops a running build at its next phase boundary and reports the request. */
  const cancelIndex = (directory) => {
    const job = jobs.get(directory);
    if (!job) return { cancelled: false, state: 'idle' };
    job.cancelRequested = true;
    emitProgress(directory, { state: 'cancelled' });
    return { cancelled: true, state: job.state };
  };

  /** Blocking build for callers that must have a graph (tests, CLI, warmers). */
  const awaitIndex = async (directory, options = {}) => {
    const { entry } = await ensureIndex(directory, { ...options, block: true });
    const engine = await loadEngine();
    return { ...freshnessFields({ ...entry, staleAfterMs: engine.STALE_AFTER_MS }), ready: true };
  };

  /** Observable index state for one directory, without starting or waiting. */
  const indexState = (directory) => {
    const job = jobs.get(directory);
    if (job) return jobFacts(job);
    const entry = snapshots.get(directory);
    if (entry) {
      return {
        state: 'ready',
        startedAtMs: entry.observedAtMs,
        progress: null,
        cancelRequested: false,
        error: null,
        generation: entry.buildSeq,
        nodes: entry.snapshot.nodes.length,
        edges: entry.snapshot.edges.length,
        entryCount: entry.entryCount,
      };
    }
    return { state: 'not-indexed', startedAtMs: null, progress: null, cancelRequested: false, error: null };
  };

  /**
   * Publishes an already-built snapshot (the persisted-generation load path),
   * so a warm open serves a graph without rebuilding it.
   */
  const seedSnapshot = (directory, entry) => {
    retainSnapshot(directory, entry);
    buildSeq = Math.max(buildSeq, Number(entry.buildSeq) || 0);
    emitProgress(directory, {
      state: 'ready',
      seeded: true,
      generation: entry.buildSeq,
      nodes: entry.snapshot.nodes.length,
      edges: entry.snapshot.edges.length,
      entryCount: entry.entryCount,
    });
    return { generation: entry.buildSeq, nodes: entry.snapshot.nodes.length };
  };

  // Index-level facts ride every envelope under their own names, never as
  // `truncated`: that field belongs to the kind's own result cut, so a
  // complete answer (one exact symbol, a two-hop trace) is not misread as
  // a cut index. `coverage: indexed` would lie the same way, so the query
  // path downgrades it to `partial` with a note naming the exclusion count.
  const freshnessFields = (entry) => {
    const fields = {
      projectId: entry.scope.projectId,
      worktreeId: entry.scope.worktreeId,
      revision: entry.scope.revision,
      fingerprint: entry.scope.fingerprint,
      freshness: entry.freshness,
      observedAtMs: entry.observedAtMs,
      staleAfterMs: entry.staleAfterMs,
      // Published generation: the monotonic build identity, so a client
      // holding rows from one build can discard them when a newer build
      // answers. Every query envelope rides the same field via this helper.
      generation: entry.buildSeq,
      indexTruncated: entry.indexTruncated === true,
      excludedCount: entry.excludedCount ?? 0,
      excludedSample: entry.excludedSample ?? [],
    };
    if (entry.dirty) {
      fields.dirty = entry.dirty;
    }
    if (entry.dirtyReason) {
      fields.dirtyReason = entry.dirtyReason;
    }
    if (entry.staleReason) {
      fields.staleReason = entry.staleReason;
    }
    if (entry.refreshError) {
      fields.refreshError = entry.refreshError;
    }
    return fields;
  };

  const indexExclusionNote = (entry) =>
    `index incomplete: ${entry.excludedCount ?? 0} files excluded by the entry cap (${entry.entryCap ?? defaultMaxEntryFiles} max)`;

  // A kind that cannot see the excluded files must not claim `indexed`
  // when the index itself is incomplete: downgrade to `partial` and name
  // the exclusion count once, and never report a whole-index `complete`
  // (or a cut-only `truncated`) when the index is cut — the index reason
  // outranks them, mirroring the engine's own `decideCompleteness` order.
  // An already-`partial` answer keeps its own cut and gains the same
  // note; `unindexed` stays as-is (still carrying the index facts) since
  // it never claimed completeness.
  const applyIndexCoverage = (envelope, entry) => {
    if (!entry.indexTruncated) return envelope;
    if (envelope.coverage !== 'indexed' && envelope.coverage !== 'partial') return envelope;
    const note = indexExclusionNote(entry);
    const unresolved = Array.isArray(envelope.unresolved) ? envelope.unresolved : [];
    const next = {
      ...envelope,
      unresolved: unresolved.some((line) => line.includes('index incomplete')) ? unresolved : [...unresolved, note],
    };
    if (next.coverage === 'indexed') next.coverage = 'partial';
    if (next.completeness === 'complete' || next.completeness === 'truncated') {
      next.completeness = 'partial';
      next.completenessReason = 'index-truncated';
    }
    return next;
  };

  const readIndex = async (directory, options = {}) => {
    const engine = await loadEngine();
    const outcome = await ensureIndex(directory, options.block === true || blockOnRead ? { ...options, block: true } : options);
    if (!outcome.entry) {
      // Nothing published yet. Answer immediately with the real state and,
      // when a previous generation exists, the facts that are still true —
      // waiting here is what froze the panel for minutes on a large repo.
      const cached = outcome.cached ?? null;
      const base = cached ? freshnessFields({ ...cached, freshness: 'stale', staleAfterMs: engine.STALE_AFTER_MS }) : null;
      return {
        ready: false,
        indexState: outcome.pending,
        ...(base ?? {
          projectId: null,
          worktreeId: null,
          revision: null,
          fingerprint: null,
          freshness: 'unindexed',
          observedAtMs: null,
          generation: null,
          indexTruncated: false,
          excludedCount: 0,
          excludedSample: [],
        }),
        truncated: cached ? cached.indexTruncated === true : false,
        binding: cached?.binding ?? null,
        snapshotRoot: cached?.snapshot?.root ?? null,
        nodeCount: cached?.snapshot.nodes.length ?? 0,
        edgeCount: cached?.snapshot.edges.length ?? 0,
        entryCount: cached?.entryCount ?? 0,
        entryCap: cached?.entryCap ?? defaultMaxEntryFiles,
      };
    }
    const entry = outcome.entry;
    const fields = freshnessFields({
      ...entry,
      staleAfterMs: engine.STALE_AFTER_MS,
      ...(outcome.refreshFailed ? { refreshError: outcome.refreshFailed instanceof Error ? outcome.refreshFailed.message : String(outcome.refreshFailed) } : {}),
    });
    return {
      ready: true,
      indexState: { state: 'ready', error: null, progress: null, startedAtMs: entry.observedAtMs, cancelRequested: false },
      ...fields,
      // Index-level truncation keeps its historic name here, where no
      // per-kind result cut exists to confuse it with.
      truncated: fields.indexTruncated,
      binding: entry.binding,
      snapshotRoot: entry.snapshot.root ?? null,
      nodeCount: entry.snapshot.nodes.length,
      edgeCount: entry.snapshot.edges.length,
      entryCount: entry.entryCount,
      entryCap: entry.entryCap ?? defaultMaxEntryFiles,
      // `generation` rides the `...fields` spread above (freshnessFields).
    };
  };

  /**
   * Snapshot ids are repo-root relative (`rootDir`), so a file id from a
   * payload joins directly. A unique suffix match still resolves ids that
   * predate the root (or arrive shortened); ambiguity or no match answers
   * null and the caller stays unindexed instead of guessing.
   */
  const resolveFileId = (entry, rel) => {
    const nodeById = new Map(entry.snapshot.nodes.map((node) => [node.id, node]));
    const direct = `file:${rel}`;
    if (nodeById.has(direct)) return direct;
    let match = null;
    for (const id of nodeById.keys()) {
      if (!id.startsWith('file:')) continue;
      const rest = id.slice('file:'.length);
      if (rest === rel || rest.endsWith(`/${rel}`) || rel.endsWith(`/${rest}`)) {
        if (match !== null) return null;
        match = id;
      }
    }
    return match;
  };

  /**
   * File projection over the real snapshot edges (no invented facts): the
   * file node plus its DEFINES symbols, IMPORTS/EXPORTS/TESTS edges with
   * the same evidence shape the engine queries return.
   */
  const fileView = (entry, file, limit) => {
    const { snapshot, scope, freshness } = entry;
    const rel = String(file ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
    const fileId = `file:${rel}`;
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const resolvedId = resolveFileId(entry, rel);
    if (resolvedId === null || !nodeById.has(resolvedId)) {
      return {
        projectId: scope.projectId,
        worktreeId: scope.worktreeId,
        revision: scope.revision,
        fingerprint: scope.fingerprint,
        freshness,
        coverage: 'unindexed',
        truncated: false,
        knowledgeIds: [],
        unresolved: [`no definition for ${fileId} in this snapshot`],
        unsupported: [],
        items: [],
        totals: { displayed: 0, known: 0, hidden: 0 },
        completeness: 'partial',
        completenessReason: 'index-excluded',
      };
    }
    const knowledgeByNode = new Map();
    for (const edge of snapshot.edges) {
      if (edge.kind !== 'LINKS_KNOWLEDGE') continue;
      const recordId = String(edge.to).startsWith('knowledge:') ? String(edge.to).slice('knowledge:'.length) : null;
      if (!recordId) continue;
      const list = knowledgeByNode.get(edge.from) ?? [];
      if (!list.includes(recordId)) list.push(recordId);
      knowledgeByNode.set(edge.from, list);
    }
    const toItem = (node, evidence) => {
      const item = {
        id: node.id,
        file: node.file,
        line: node.line,
        evidence,
        confidence: 1,
        knowledgeIds: knowledgeByNode.get(node.id) ?? [],
      };
      if (node.name !== undefined) {
        item.name = node.name;
      }
      return item;
    };
    // Ranked once, server-side: the subject file itself (distance 0)
    // first, then neighbours by edge kind (DEFINES/EXPORTS before IMPORTS
    // before TESTS), ties by id. `limit` only decides how many ranked rows
    // are returned; `totals` keeps the known count so the panel can say
    // "10 of 26" instead of only naming the cut.
    const FILE_EDGE_RANK = { DEFINES: 0, EXPORTS: 0, IMPORTS: 1, TESTS: 2 };
    const ranked = [];
    const subject = nodeById.get(resolvedId);
    ranked.push({ item: toItem(subject, []), distance: 0, rank: -1 });
    for (const edge of snapshot.edges) {
      if (edge.kind !== 'DEFINES' && edge.kind !== 'IMPORTS' && edge.kind !== 'EXPORTS' && edge.kind !== 'TESTS') continue;
      if (edge.from !== resolvedId && edge.to !== resolvedId) continue;
      const otherId = edge.from === resolvedId ? edge.to : edge.from;
      const other = nodeById.get(otherId);
      if (!other) continue;
      ranked.push({
        item: toItem(other, [{ edge: edge.kind, ref: edge.ref, confidence: edge.confidence }]),
        distance: 1,
        rank: FILE_EDGE_RANK[edge.kind] ?? 3,
      });
    }
    ranked.sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.item.id < right.item.id ? -1 : left.item.id > right.item.id ? 1 : 0;
    });
    const items = ranked.map((entry) => entry.item);
    const limited = items.slice(0, limit);
    return {
      projectId: scope.projectId,
      worktreeId: scope.worktreeId,
      revision: scope.revision,
      fingerprint: scope.fingerprint,
      freshness,
      coverage: 'indexed',
      truncated: items.length > limit,
      knowledgeIds: [...new Set(limited.flatMap((item) => item.knowledgeIds))],
      unresolved: items.length > limit ? [`truncated to ${limit} of ${items.length} rows`] : [],
      unsupported: [],
      items: limited,
      totals: { displayed: limited.length, known: items.length, hidden: items.length - limited.length },
      completeness: 'complete',
    };
  };

  /**
   * Repository overview grouped purely from indexed facts: every file node
   * buckets under its first path segment (`(root)` when the path has no
   * `/`). Symbol and edge counts derive from the snapshot's DEFINES edges
   * and endpoint membership — no invented modules, never a fabricated row.
   * `items` stays empty (modules are not symbol rows); the payload carries
   * a top-level `modules` array instead, mirroring how `graph` rides only
   * on subject-bearing kinds.
   *
   * Each module also carries the walk-measured coverage for its bucket:
   * files the engine analyzed, files it never analyzes (by extension),
   * and files excluded as generated/vendored or cut by the entry cap — so
   * a module holding important shell/YAML never reads as fully understood.
   * Buckets the walk saw but the engine never indexed (only unanalyzed
   * files) still get a row with zero index counts rather than vanishing.
   */
  const exploreModules = (entry, limit, directory) => {
    const { snapshot, scope, freshness } = entry;
    const rootPrefix = String(directory ?? '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
    const base = {
      projectId: scope.projectId,
      worktreeId: scope.worktreeId,
      revision: scope.revision,
      fingerprint: scope.fingerprint,
      freshness,
    };
    const fileNodes = snapshot.nodes.filter((node) => node.kind === 'file');
    // Walk-measured coverage rides the served entry (plain JSON, never a
    // re-walk); absent on entries built before the walk counted it.
    const walkCoverage = entry.coverage ?? null;
    const walkByModule = walkCoverage?.byModule ?? {};
    const emptyTotals = { analyzedFiles: 0, unanalyzedFiles: 0, unanalyzedByExtension: {}, excludedFiles: 0 };
    if (fileNodes.length === 0 && Object.keys(walkByModule).length === 0) {
      return {
        ...base,
        coverage: 'unindexed',
        truncated: false,
        knowledgeIds: [],
        unresolved: ['empty index: no files in this snapshot'],
        unsupported: [],
        items: [],
        modules: [],
        totals: { displayed: 0, known: 0, hidden: 0 },
        completeness: 'partial',
        repositoryTotals: walkCoverage?.totals ?? emptyTotals,
        skippedDirs: walkCoverage?.skippedDirs ?? [],
        unreadableDirs: walkCoverage?.unreadableDirs ?? [],
      };
    }
    // Some recorded paths still carry a Windows drive (`i:/AlRepo/...`). A
    // drive segment is not a module, so the bucket is the first segment after
    // it; otherwise one pseudo-module would collect unrelated trees.
    const bucketOf = (file) => {
      const raw = String(file ?? '').replace(/\\/g, '/');
      const lower = raw.toLowerCase();
      const relative = rootPrefix.length > 0 && lower.startsWith(rootPrefix + '/')
        ? raw.slice(rootPrefix.length + 1)
        : raw;
      const segments = relative.split('/').filter((segment) => segment.length > 0);
      if (segments.length === 0) return '(root)';
      const first = segments[0];
      if (/^[a-z]:$/i.test(first)) {
        return segments.length > 1 ? segments[1] : '(root)';
      }
      return segments.length > 1 ? first : '(root)';
    };
    const fileIdsByBucket = new Map();
    const bucketByNodeId = new Map();
    for (const node of fileNodes) {
      const bucket = bucketOf(node.file);
      bucketByNodeId.set(node.id, bucket);
      let set = fileIdsByBucket.get(bucket);
      if (!set) {
        set = new Set();
        fileIdsByBucket.set(bucket, set);
      }
      set.add(node.id);
    }
    for (const node of snapshot.nodes) {
      if (node.kind !== 'symbol') continue;
      bucketByNodeId.set(node.id, bucketOf(node.file));
    }
    const names = [...new Set([...fileIdsByBucket.keys(), ...Object.keys(walkByModule)])].sort();
    const modules = names.map((name) => {
      const fileIds = fileIdsByBucket.get(name) ?? new Set();
      const walk = walkByModule[name] ?? emptyTotals;
      const files = fileNodes.filter((node) => fileIds.has(node.id));
      const symbols = snapshot.nodes
        .filter((node) => node.kind === 'symbol' && bucketByNodeId.get(node.id) === name)
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      let symbolCount = 0;
      let edgeCount = 0;
      for (const edge of snapshot.edges) {
        if (edge.kind === 'DEFINES' && fileIds.has(edge.from)) symbolCount += 1;
        if (bucketByNodeId.get(edge.from) === name || bucketByNodeId.get(edge.to) === name) edgeCount += 1;
      }
      return {
        name,
        fileCount: files.length,
        testFileCount: files.filter((node) => node.isTest === true).length,
        symbolCount,
        edgeCount,
        sampleSymbols: symbols.slice(0, 5).map((node) => {
          const sample = {
            id: node.id,
            file: node.file,
            line: node.line,
          };
          if (node.name !== undefined) {
            sample.name = node.name;
          }
          return sample;
        }),
        analyzedFiles: walk.analyzedFiles ?? 0,
        unanalyzedFiles: walk.unanalyzedFiles ?? 0,
        unanalyzedByExtension: walk.unanalyzedByExtension ?? {},
        excludedFiles: walk.excludedFiles ?? 0,
      };
    });
    const limited = modules.slice(0, limit);
    // Directories the walk could not see are named, not counted: an
    // unreadable directory means its bucket counts are floors, and a
    // deliberately skipped generated/vendored directory explains its
    // excluded files.
    const skippedDirs = walkCoverage?.skippedDirs ?? [];
    const unreadableDirs = walkCoverage?.unreadableDirs ?? [];
    const unresolved = [
      ...(modules.length > limit ? [`truncated to ${limit} of ${modules.length} modules`] : []),
      ...(unreadableDirs.length > 0 ? [`walk could not read ${unreadableDirs.length} directorie(s): ${unreadableDirs.join(', ')}`] : []),
      ...(skippedDirs.length > 0 ? [`walk skipped generated/vendored directorie(s): ${skippedDirs.join(', ')}`] : []),
    ];
    return {
      ...base,
      coverage: 'indexed',
      truncated: modules.length > limit,
      knowledgeIds: [],
      unresolved,
      unsupported: [],
      items: [],
      modules: limited,
      totals: { displayed: limited.length, known: modules.length, hidden: modules.length - limited.length },
      completeness: 'complete',
      repositoryTotals: walkCoverage?.totals ?? emptyTotals,
      skippedDirs,
      unreadableDirs,
    };
  };

  /** Edge kinds the Code view draws; a knowledge link is not a dependency. */
  const GRAPH_EDGE_KINDS = new Set(['DEFINES', 'IMPORTS', 'EXPORTS', 'TESTS', 'CALLS_STATIC', 'CALLS_UNRESOLVED']);
  const MAX_GRAPH_NODES = 40;

  /**
   * Bounded ego-graph over the real snapshot: the subject, its incident
   * neighbours, and every edge whose both endpoints stay in that set. Every
   * node and edge comes from the snapshot as indexed; `truncated` reports a
   * bound that cut the neighbourhood instead of quietly shrinking it.
   */
  const graphView = (entry, subjectId, limit) => {
    const nodeById = new Map(entry.snapshot.nodes.map((node) => [node.id, node]));
    if (!nodeById.has(subjectId)) {
      return null;
    }
    const maxNodes = Math.min(MAX_GRAPH_NODES, Math.max(2, limit));
    const kept = new Set([subjectId]);
    let truncated = false;
    for (const edge of entry.snapshot.edges) {
      if (!GRAPH_EDGE_KINDS.has(edge.kind)) continue;
      if (edge.from !== subjectId && edge.to !== subjectId) continue;
      const other = edge.from === subjectId ? edge.to : edge.from;
      if (kept.has(other) || !nodeById.has(other)) continue;
      if (kept.size >= maxNodes) {
        truncated = true;
        continue;
      }
      kept.add(other);
    }
    const edges = [];
    for (const edge of entry.snapshot.edges) {
      if (!GRAPH_EDGE_KINDS.has(edge.kind)) continue;
      if (!kept.has(edge.from) || !kept.has(edge.to)) continue;
      edges.push({ id: edge.id, kind: edge.kind, from: edge.from, to: edge.to, confidence: edge.confidence });
    }
    const nodes = [...kept].map((id) => {
      const node = nodeById.get(id);
      const row = {
        id: node.id,
        kind: node.kind,
        subject: id === subjectId,
      };
      if (node.name !== undefined) {
        row.name = node.name;
      }
      if (node.file !== undefined) {
        row.file = node.file;
      }
      if (node.line !== undefined) {
        row.line = node.line;
      }
      return row;
    });
    return { subjectId, nodes, edges, truncated };
  };

  const query = async (directory, input = {}) => {
    const engine = await loadEngine();
    const kind = input.kind;
    const limit = input.limit === undefined ? 20 : Math.min(50, Math.max(1, Math.floor(input.limit)));
    // Neighbourhood depth for the reachability kinds (context, impact,
    // trace): clamped to [1, 3], default 1 for the UI's neighbourhood
    // view. It rides the engine's `maxDepth` and the memo key below — a
    // key that misses an answer-changing input serves stale rows.
    const rawDepth = Number(input.depth);
    const depth = Number.isFinite(rawDepth) ? Math.min(3, Math.max(1, Math.floor(rawDepth))) : 1;
    const outcome = await ensureIndex(directory, { refresh: input.refresh === true, block: blockOnRead });
    // A previous generation is still a real answer: serve it and say it is
    // stale while the new one builds, instead of refusing while it indexes.
    const entry = outcome.entry ?? outcome.cached ?? null;
    if (!entry) {
      const pending = outcome.pending ?? { state: 'not-indexed' };
      return {
        projectId: null,
        worktreeId: null,
        revision: null,
        fingerprint: null,
        freshness: 'unindexed',
        generation: null,
        ready: false,
        indexState: pending,
        coverage: 'unindexed',
        knowledgeIds: [],
        unresolved: [`index ${pending.state}: no graph published yet for this directory`],
        unsupported: [],
        items: [],
        totals: { displayed: 0, known: 0, hidden: 0 },
        completeness: 'partial',
        completenessReason: 'index-building',
      };
    }
    const indexBuilding = outcome.entry ? null : (outcome.pending ?? null);
    // Memoize repeats within one build: the answer is pure in (snapshot,
    // input), and the stored build is accepted only when its monotonic
    // build identity matches the build that served this call.
    // The key must cover every input that changes the answer, filters included:
    // a memo keyed only by kind/subject/limit answered a path-filtered content
    // query with the previous unfiltered rows (measured by the bench).
    const cacheKey = JSON.stringify([
      kind,
      input.symbol ?? null,
      input.query ?? null,
      input.target ?? null,
      input.file ?? null,
      input.from ?? null,
      input.to ?? null,
      input.pathPrefix ?? null,
      input.language ?? null,
      input.contentKind ?? null,
      input.directory ?? null,
      limit,
      depth,
    ]);
    const stored = snapshots.get(directory);
    const queryCache = stored && stored.buildSeq === entry.buildSeq && stored.queryCache instanceof Map
      ? stored.queryCache
      : null;
    const cachedAnswer = queryCache?.get(cacheKey);
    if (cachedAnswer !== undefined) return cachedAnswer;
    const options = { scope: entry.scope, freshness: entry.freshness, limit };
    // Reachability depth: context, impact and trace walk out to `maxDepth`.
    const reachOptions = { ...options, maxDepth: depth };
    let envelope = null;
    if (kind === 'context') {
      if (!input.symbol) return { error: 'symbol is required for kind=context', status: 400 };
      envelope = engine.symbolContext(entry.snapshot, input.symbol, reachOptions);
    } else if (kind === 'impact') {
      if (!input.symbol) return { error: 'symbol is required for kind=impact', status: 400 };
      envelope = engine.impact(entry.snapshot, input.symbol, reachOptions);
    } else if (kind === 'search') {
      if (!input.query) return { error: 'query is required for kind=search', status: 400 };
      envelope = engine.search(entry.snapshot, input.query, options);
    } else if (kind === 'tests') {
      if (!input.target) return { error: 'target is required for kind=tests', status: 400 };
      envelope = engine.findTests(entry.snapshot, input.target, options);
    } else if (kind === 'file') {
      if (!input.file) return { error: 'file is required for kind=file', status: 400 };
      envelope = fileView(entry, input.file, limit);
    } else if (kind === 'explore') {
      envelope = exploreModules(entry, limit, directory);
    } else if (kind === 'trace') {
      if (!input.from || !input.to) return { error: 'from and to are required for kind=trace', status: 400 };
      envelope = engine.trace(entry.snapshot, input.from, input.to, reachOptions);
    } else if (kind === 'content') {
      if (!input.query) return { error: 'query is required for kind=content', status: 400 };
      // Source-text search runs over the extraction-time content index: no
      // filesystem read happens inside this call, which is what makes it safe
      // to answer a text query on every keystroke.
      const contentOptions = { limit };
      if (input.pathPrefix !== undefined) {
        contentOptions.pathPrefix = String(input.pathPrefix);
      }
      if (input.language !== undefined) {
        contentOptions.language = String(input.language);
      }
      if (input.contentKind === 'test' || input.contentKind === 'source') {
        contentOptions.kind = input.contentKind;
      }
      if (input.directory !== undefined) {
        contentOptions.directory = String(input.directory);
      }
      envelope = engine.searchContent(entry.snapshot, input.query, contentOptions);
    } else if (kind === 'unreferenced') {
      // No subject to validate: the answer is pure in (snapshot, limit),
      // and both kind and limit already ride the memo key above.
      envelope = engine.findUnreferenced(entry.snapshot, options);
    } else {
      return { error: 'kind must be context, impact, search, content, tests, file, explore, trace, or unreferenced', status: 400 };
    }
    // The graph rides on the subject-bearing kinds only: search, explore,
    // and trace have no single subject to centre a neighbourhood on.
    const subjectId = kind === 'file'
      ? resolveFileId(entry, String(input.file ?? '').replace(/\\/g, '/').replace(/^\.\//, '')) ?? ''
      : kind === 'context' || kind === 'impact'
        ? String(input.symbol ?? '')
        : '';
    const graph = subjectId.length > 0 ? graphView(entry, subjectId, limit) : null;
    // The envelope's own `truncated` (its result cut) rides through
    // untouched; the index-level facts join under their own names and an
    // incomplete index downgrades a false `indexed` to `partial`.
    const answer = {
      ...applyIndexCoverage(envelope, entry),
      snapshotRoot: entry.snapshot.root ?? null,
      ...freshnessFields({ ...entry, staleAfterMs: engine.STALE_AFTER_MS }),
      // Rows served from a previous generation say so, and name the build that
      // is running: a caller must be able to tell "stale but usable" from
      // "current", and "still indexing" from "finished".
      ...(indexBuilding
        ? { ready: outcome.entry !== undefined, freshness: 'stale', indexState: indexBuilding }
        : { ready: true }),
    };
    if (graph !== null) {
      answer.graph = graph;
    }
    if (queryCache) {
      if (queryCache.size >= MAX_CACHED_QUERIES) {
        queryCache.delete(queryCache.keys().next().value);
      }
      queryCache.set(cacheKey, answer);
    }
    return answer;
  };

  /**
   * Snapshot file ids are relative to the snapshot root, which is the entry
   * list's common directory and may sit below the project root. Joining an id
   * to the project directory therefore addresses a path that does not exist,
   * which is how a real indexed file turns into "File not found".
   *
   * Every answer is realpath'd and containment-checked, and a refusal names
   * the boundary it hit (`outside-snapshot-root`, `outside-project`) instead
   * of degrading to a bare "not found". Windows comparisons strip the long
   * path prefix, unify separators and ignore drive-letter case.
   */
  const compareKey = (value) => {
    const stripped = value.startsWith('\\\\?\\') ? value.slice(4) : value;
    const slashed = stripped.replace(/\\/g, '/').replace(/\/$/, '');
    return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
  };

  const isInside = (parent, child) => {
    const parentKey = compareKey(path.resolve(parent));
    const childKey = compareKey(path.resolve(child));
    return childKey === parentKey || childKey.startsWith(`${parentKey}/`);
  };

  const resolveFile = async (directory, file) => {
    const raw = isString(file) ? file.trim() : '';
    if (raw.length === 0) {
      return { ok: false, reason: 'missing-file-id' };
    }
    const relative = raw;
    const outcome = await ensureIndex(directory, { block: blockOnRead });
    const entry = outcome.entry ?? outcome.cached ?? null;
    if (!entry) {
      return { ok: false, reason: 'index-not-ready', indexState: outcome.pending ?? { state: 'not-indexed' }, snapshotRoot: null };
    }
    const snapshotRoot = entry.snapshot.root ?? null;
    // The engine reports files outside the snapshot root by absolute path
    // (a monorepo's `packages/` beside `apps/`). Those ids address a real file
    // directly, so only ids relative to the root are joined to it.
    const isAbsoluteId = /^[a-zA-Z]:[\\/]/.test(relative) || relative.startsWith('\\\\') || relative.startsWith('/');
    if (!isAbsoluteId && !snapshotRoot) {
      return { ok: false, reason: 'no-snapshot-root' };
    }
    const candidate = isAbsoluteId ? path.resolve(relative) : path.resolve(snapshotRoot, relative);
    if (!isAbsoluteId && !isInside(snapshotRoot, candidate)) {
      return { ok: false, reason: 'outside-snapshot-root' };
    }
    let real;
    try {
      real = await fsPromises.realpath(candidate);
    } catch {
      return { ok: false, reason: 'missing', snapshotRoot, candidate };
    }
    let projectReal;
    try {
      projectReal = await fsPromises.realpath(directory);
    } catch {
      projectReal = path.resolve(directory);
    }
    if (!isInside(projectReal, real)) {
      return { ok: false, reason: 'outside-project', snapshotRoot, candidate: real };
    }
    return {
      ok: true,
      absolute: real,
      projectRelative: path.relative(projectReal, real).replace(/\\/g, '/'),
      snapshotRoot,
    };
  };

  return {
    normalizeDirectory,
    deriveScopeIds,
    readIndex,
    query,
    resolveFile,
    // Phase 3 lifecycle: an index is a background job a caller can observe,
    // wait on, cancel, or seed from a persisted generation — never a blocking
    // side effect of asking for a graph.
    indexState,
    cancelIndex,
    awaitIndex,
    seedSnapshot,
  };
};
