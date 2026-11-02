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

/** Cooldown before a plain read retries a terminally failed build. While the
 * memory is fresh, status reads serve the recorded failure instead of
 * relaunching the doomed build on every poll. An explicit refresh always
 * retries immediately; a new attempt after the cooldown re-arms the memory
 * when it fails, and a published generation clears it. */
export const FAILURE_RETRY_COOLDOWN_MS = 60_000;

/** Cap for stored per-file unreadable rels: the count stays exact past it. */
export const MAX_UNREADABLE_FILES = 100;

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

/** Bound for compiler configuration files remembered per walk (config-change gate). */
export const MAX_CONFIG_FILES_SEEN = 64;

/** Default bound for directories visited during one discovery walk. */
export const DEFAULT_MAX_DIRS_VISITED = 25000;

/** Hard bound for directories visited: discovery stops safely past this. */
export const HARD_MAX_DIRS_VISITED = 100000;

/** Default bound for filesystem entries examined (files + dirs) during discovery. */
export const DEFAULT_MAX_FILES_DISCOVERED = 120000;

/** Hard bound for filesystem entries examined. */
export const HARD_MAX_FILES_DISCOVERED = 500000;

/** Default bound for candidate source files collected before parsing. */
export const DEFAULT_MAX_CANDIDATE_FILES = 20000;

/** Default maximum directory depth below the scope root (root is depth 0). */
export const DEFAULT_MAX_TRAVERSAL_DEPTH = 25;

/** Hard maximum directory depth. */
export const HARD_MAX_TRAVERSAL_DEPTH = 64;

/** Files larger than this are counted but never parsed as entries. */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;

/** Default wall-clock budget for one discovery walk. */
export const DEFAULT_TRAVERSAL_TIME_BUDGET_MS = 30000;

const clampInt = (value, fallback, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
};

const resolveMaxEntryFiles = (value) => {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) {
    return DEFAULT_MAX_ENTRY_FILES;
  }
  return Math.min(HARD_MAX_ENTRY_FILES, Math.max(1, Math.floor(Number(value))));
};

const resolveTraversalBudgets = (options = {}) => ({
  maxDirsVisited: clampInt(options.maxDirsVisited, DEFAULT_MAX_DIRS_VISITED, 1, HARD_MAX_DIRS_VISITED),
  maxFilesDiscovered: clampInt(options.maxFilesDiscovered, DEFAULT_MAX_FILES_DISCOVERED, 1, HARD_MAX_FILES_DISCOVERED),
  maxCandidateFiles: clampInt(options.maxCandidateFiles, DEFAULT_MAX_CANDIDATE_FILES, 1, HARD_MAX_ENTRY_FILES),
  maxDepth: clampInt(options.maxDepth, DEFAULT_MAX_TRAVERSAL_DEPTH, 1, HARD_MAX_TRAVERSAL_DEPTH),
  maxFileSizeBytes: clampInt(options.maxFileSizeBytes, DEFAULT_MAX_FILE_SIZE_BYTES, 1, 32 * 1024 * 1024),
  timeBudgetMs: clampInt(options.timeBudgetMs, DEFAULT_TRAVERSAL_TIME_BUDGET_MS, 1000, 300000),
});

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
  // TypeScript build-mode declaration caches: generated `.d.ts` output that
  // would otherwise index as duplicate sources beside the real files.
  '.tsbuild',
]);

const ENTRY_FILE = /\.[cm]?[tj]sx?$/;

/** Compiler configuration basenames: edits here move the revision and force full reanalysis. */
const isConfigBasename = (name) => /^tsconfig(\..*)?\.json$/i.test(name);

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

// Function check without a runtime `typeof`: `shouldCancel` rides untyped
// options across the runtime boundary, so the check must accept sync and
// async callbacks and reject every non-callable without throwing.
const isFunction = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Function]' || tag === '[object AsyncFunction]';
};

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
const stripTrailingSep = (value, sep) => {
  if (value.length > 1 && value.endsWith(sep)) return value.replace(/[/\\]+$/, '') || sep;
  return value;
};

/**
 * Canonical map key for one index scope: normalized, no trailing separator,
 * case-folded on Windows (where `I:/x` and `i:/x` address the same scope).
 * Every cache lookup, job registration, and snapshot below keys on this so
 * the requested directory and the resolved scope root cannot drift apart.
 */
const scopeKeyOf = (value, pathLike) => {
  const canonical = stripTrailingSep(pathLike.normalize(String(value ?? '')), pathLike.sep);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
};

export const createDirectoryNormalizer = ({ fsPromises, path }) => async (directory) => {
  const trimmed = isString(directory) ? directory.trim() : '';
  if (!trimmed) {
    return { error: 'directory is required' };
  }
  const normalized = stripTrailingSep(path.normalize(trimmed), path.sep);
  let canonical = normalized;
  try {
    canonical = stripTrailingSep(path.normalize(await fsPromises.realpath(normalized)), path.sep);
  } catch {
    canonical = normalized;
  }
  let stat = null;
  try {
    stat = await fsPromises.stat(canonical);
  } catch {
    return { error: `directory not found: ${trimmed}`, status: 404 };
  }
  if (!stat.isDirectory()) {
    return { error: `not a directory: ${trimmed}`, status: 404 };
  }
  return { directory: canonical };
};

/** Walk upward for the nearest `.git` entry: the worktree root for checkouts and linked worktrees. */
export const findGitRoot = async ({ fsPromises, path }, startDir) => {
  let current = startDir;
  const seen = new Set();
  for (let depth = 0; depth < HARD_MAX_TRAVERSAL_DEPTH; depth += 1) {
    const key = String(current).toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    try {
      await fsPromises.lstat(path.join(current, '.git'));
      return current;
    } catch {
      // No git marker here; keep walking upward.
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
};

/** Resolve the indexing scope: repository root in auto mode, requested dir in directory mode. */
export const resolveIndexScope = async ({ fsPromises, path }, directory, mode = 'auto') => {
  const requested = directory;
  if (mode === 'directory') return { scopeRoot: requested, gitRoot: await findGitRoot({ fsPromises, path }, requested), mode: 'directory' };
  const gitRoot = await findGitRoot({ fsPromises, path }, requested);
  if (gitRoot) return { scopeRoot: gitRoot, gitRoot, mode: 'repo' };
  return { scopeRoot: requested, gitRoot: null, mode: 'directory' };
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
        if (!entry.paths.some((rel) => isEntryCandidateRel(rel) || isConfigBasename(path.basename(rel)))) continue;
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

  /**
   * Scope key (canonical scope root) -> cached snapshot entry. Project
   * isolation is the key: every read, job, and restore below resolves the
   * requested directory to its scope root first, so one scope has exactly
   * one entry no matter which spelling or subdirectory opened it.
   */
  const snapshots = new Map();
  /**
   * Scope key -> last complete (non-truncated) generation. A truncated build
   * refines `snapshots` but never overwrites this: while a rebuild is
   * pending or has failed, reads serve the previous complete graph labelled
   * stale instead of a partial one. Bounded like `snapshots` below.
   */
  const completeSnapshots = new Map();
  /**
   * Requested-directory key -> scope key. Lets the synchronous status and
   * cancel paths resolve a scope without I/O: the entry is recorded on every
   * `ensureIndex` before any job starts, so an in-build cancel still lands.
   */
  const requestToScope = new Map();
  /** Requested-directory spellings are tiny strings, but still bounded. */
  const MAX_SCOPE_ALIASES = 200;
  const rememberScopeAlias = (requestedKey, key) => {
    requestToScope.delete(requestedKey);
    requestToScope.set(requestedKey, key);
    while (requestToScope.size > MAX_SCOPE_ALIASES) {
      requestToScope.delete(requestToScope.keys().next().value);
    }
  };
  /**
   * Scope key -> the last partial projection an in-flight build
   * handed over. It exists ONLY so a progress reader can show what is analysed
   * so far; it is never a generation. A partial is missing every project not
   * yet analysed, so serving it from `snapshots` presents half a graph as the
   * whole graph - and because the entry mints a generation, a build that ends
   * without publishing (cancelled, failed, crashed) would leave that half graph
   * behind as the last known-good one. Kept apart so neither can happen.
   */
  const partialByDirectory = new Map();
  /**
   * One in-flight build per scope key. Without this, opening the panel, the
   * module map, and a query at the same moment each started its own full
   * build: the same work repeated, on the same thread, at the same time.
   * Concurrent opens of different directories in one repo join one job.
   */
  const jobs = new Map();
  /**
   * Terminal build outcomes by scope key: a failed or cancelled build stays
   * terminal for plain reads until an explicit refresh or the retry
   * cooldown permits a new attempt. Without this, every status poll starts
   * a fresh build that fails again and only ever reports `discovering`.
   */
  const lastTerminalFailure = new Map();
  /**
   * Cancel intents for scopes with no job yet. A cancel that lands while the
   * pre-job checks run (revision probe, store restore walk — seconds on a
   * large scope) would otherwise report idle while the walk finishes and a
   * build the caller just refused starts anyway. The intent settles the next
   * ensureIndex for the scope as cancelled; an explicit refresh consumes it
   * and starts anew. Bounded like the scope aliases below.
   */
  const pendingCancels = new Set();
  const MAX_PENDING_CANCELS = 200;
  const rememberPendingCancel = (key) => {
    pendingCancels.delete(key);
    pendingCancels.add(key);
    while (pendingCancels.size > MAX_PENDING_CANCELS) {
      pendingCancels.delete(pendingCancels.values().next().value);
    }
  };
  const takePendingCancel = (key) => {
    if (!pendingCancels.has(key)) return false;
    pendingCancels.delete(key);
    return true;
  };
  /**
   * A published graph is not free: one large monorepo measured ~1 GB of heap.
   * Retention is bounded to the most recently built directories so a session
   * that touches many projects cannot hold every graph at once.
   */
  const MAX_RETAINED_SNAPSHOTS = 3;

  const normalizeDirectory = createDirectoryNormalizer({ fsPromises, path });

  const deriveScopeIds = (directory) => {
    const canonical = stripTrailingSep(path.normalize(String(directory ?? '')), path.sep);
    const digest = sha256Hex(canonical.toLowerCase());
    return {
      projectId: `${sanitizeSlug(path.basename(canonical), 'project')}-${digest.slice(0, 8)}`,
      worktreeId: sanitizeSlug(path.basename(canonical), 'worktree'),
    };
  };

  // Scope ids derive from the canonical scope root alone, never from the
  // requested directory: persistence and retrieval key on the scope, so any
  // subdirectory spelling of one repo shares one stored generation. (This
  // changes the worktree segment for scopes opened below their root; stores
  // written under the old scheme read as a miss once and are then reseeded.)
  const deriveScopeIdsForRoot = (scopeRoot) => {
    const canonicalRoot = stripTrailingSep(path.normalize(String(scopeRoot ?? '')), path.sep);
    const digest = sha256Hex(canonicalRoot.toLowerCase());
    return {
      projectId: `${sanitizeSlug(path.basename(canonicalRoot), 'project')}-${digest.slice(0, 8)}`,
      worktreeId: sanitizeSlug(path.basename(canonicalRoot), 'worktree'),
      scopeRoot: canonicalRoot,
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

  const listEntryFiles = async (directory, maxEntryFiles, walkOptions = {}) => {
    const cap = resolveMaxEntryFiles(maxEntryFiles ?? defaultMaxEntryFiles);
    const budgets = resolveTraversalBudgets({ ...runtimeOptions, ...walkOptions });
    const shouldCancel = walkOptions.shouldCancel;
    const checkCancelled = () => {
      if (isFunction(shouldCancel) && shouldCancel()) {
        const err = new Error('code-graph index cancelled');
        err.code = 'CANCELLED';
        throw err;
      }
    };
    let canonicalRoot = stripTrailingSep(path.normalize(String(directory ?? '')), path.sep);
    try {
      canonicalRoot = stripTrailingSep(path.normalize(await fsPromises.realpath(directory)), path.sep);
    } catch {
      canonicalRoot = stripTrailingSep(path.normalize(String(directory ?? '')), path.sep);
    }
    const canonicalRootLower = canonicalRoot.toLowerCase();
    const visitedInodes = new Set();
    const visitedReals = new Set([canonicalRootLower]);
    const deadlineMs = Date.now() + budgets.timeBudgetMs;
    let opsSinceYield = 0;
    const maybeYield = async () => {
      opsSinceYield += 1;
      if (opsSinceYield >= 200) {
        opsSinceYield = 0;
        checkCancelled();
        if (Date.now() > deadlineMs) {
          const err = new Error('code-graph discovery time budget exceeded');
          err.code = 'TRUNCATED';
          err.reason = 'time-budget';
          throw err;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    const isWithinRoot = (real) => {
      const lower = String(real ?? '').toLowerCase();
      return lower === canonicalRootLower || lower.startsWith(`${canonicalRootLower}${path.sep}`.toLowerCase()) || lower.startsWith(`${canonicalRootLower}/`);
    };
    const entries = [];
    let scanned = 0;
    let excludedCount = 0;
    const excludedSample = [];
    // Compiler configuration files seen during the walk (bounded): config
    // edits move the revision, and the build fingerprints them to force
    // full reanalysis under the new options. Past the bound the gate is
    // unmeasurable; the revision still moves but reuse cannot tell why.
    const configFiles = [];
    let configTruncated = false;
    const skippedDirs = [];
    const unreadableDirs = [];
    const skippedSymlinks = [];
    const nestedRepoRoots = [];
    let dirsVisited = 0;
    let filesDiscovered = 0;
    let symlinksSkipped = 0;
    let maxDepthSeen = 0;
    let truncationReason = null;
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
        await maybeYield();
        const full = path.join(dir, name);
        let linkStat = null;
        try {
          linkStat = await fsPromises.lstat(full);
        } catch {
          continue;
        }
        if (linkStat.isSymbolicLink()) {
          symlinksSkipped += 1;
          continue;
        }
        if (linkStat.isDirectory()) {
          let real = null;
          try {
            real = await fsPromises.realpath(full);
          } catch {
            continue;
          }
          if (!isWithinRoot(real)) continue;
          const lower = String(real).toLowerCase();
          if (visitedReals.has(lower)) continue;
          if (visitedReals.size > budgets.maxDirsVisited) {
            scanState.truncated = true;
            truncationReason = truncationReason ?? 'dirs-visited';
            return;
          }
          visitedReals.add(lower);
          await countSkipped(full, bucket);
        } else if (linkStat.isFile()) {
          bucketStats(bucket).excludedFiles += 1;
        }
      }
    };
    const visit = async (dir, depth) => {
      checkCancelled();
      if (depth > budgets.maxDepth) {
        truncationReason = truncationReason ?? 'max-depth';
        return;
      }
      if (dirsVisited >= budgets.maxDirsVisited) {
        truncationReason = truncationReason ?? 'dirs-visited';
        return;
      }
      if (filesDiscovered >= budgets.maxFilesDiscovered) {
        truncationReason = truncationReason ?? 'files-discovered';
        return;
      }
      if (Date.now() > deadlineMs) {
        truncationReason = truncationReason ?? 'time-budget';
        return;
      }
      let realDir = null;
      try {
        realDir = await fsPromises.realpath(dir);
      } catch {
        const rel = relOf(dir);
        unreadableDirs.push(rel.length > 0 ? rel : '.');
        return;
      }
      if (!isWithinRoot(realDir)) return;
      const realLower = String(realDir).toLowerCase();
      let dirStat = null;
      try {
        dirStat = await fsPromises.stat(realDir);
      } catch {
        const rel = relOf(dir);
        unreadableDirs.push(rel.length > 0 ? rel : '.');
        return;
      }
      const inodeKey = `${Number(dirStat.dev ?? 0)}:${Number(dirStat.ino ?? 0)}`;
      if (visitedInodes.has(inodeKey)) return;
      visitedInodes.add(inodeKey);
      dirsVisited += 1;
      maxDepthSeen = Math.max(maxDepthSeen, depth);
      let names = [];
      try {
        names = await fsPromises.readdir(dir);
      } catch {
        const rel = relOf(dir);
        unreadableDirs.push(rel.length > 0 ? rel : '.');
        return;
      }
      // Nested repository boundary: do not merge sibling checkouts into one graph.
      if (depth > 0 && names.includes('.git')) {
        const rel = relOf(dir);
        nestedRepoRoots.push(rel.length > 0 ? rel : '.');
        return;
      }
      names.sort();
      for (const name of names) {
        if (name === '.' || name === '..') continue;
        const full = path.join(dir, name);
        let linkStat = null;
        try {
          linkStat = await fsPromises.lstat(full);
        } catch {
          // A path that cannot even be statted is unreadable, not absent:
          // skipping it silently would present a partial tree as complete.
          const rel = relOf(full);
          unreadableDirs.push(rel.length > 0 ? rel : '.');
          continue;
        }
        if (linkStat.isSymbolicLink()) {
          symlinksSkipped += 1;
          const rel = relOf(full);
          if (skippedSymlinks.length < MAX_EXCLUDED_SAMPLE) skippedSymlinks.push(rel);
          continue;
        }
        await maybeYield();
        filesDiscovered += 1;
        if (filesDiscovered > budgets.maxFilesDiscovered) {
          truncationReason = truncationReason ?? 'files-discovered';
          return;
        }
        if (linkStat.isDirectory()) {
          if (SKIPPED_DIRS.has(name)) {
            const rel = relOf(full);
            skippedDirs.push(rel);
            await countSkipped(full, bucketOfRel(rel));
            continue;
          }
          let realChild = null;
          try {
            realChild = await fsPromises.realpath(full);
          } catch {
            const rel = relOf(full);
            unreadableDirs.push(rel.length > 0 ? rel : '.');
            continue;
          }
          // Escaped-scope and already-visited directories stay silent on
          // purpose: the first is a boundary doing its job, the second is
          // deduplication, and neither is a failed filesystem operation.
          if (!isWithinRoot(realChild)) continue;
          const childLower = String(realChild).toLowerCase();
          if (visitedReals.has(childLower)) continue;
          visitedReals.add(childLower);
          await visit(full, depth + 1);
        } else if (linkStat.isFile()) {
          scanned += 1;
          const rel = relOf(full);
          const bucket = bucketOfRel(rel);
          if (!ENTRY_FILE.test(name)) {
            if (isConfigBasename(name)) {
              if (configFiles.length < MAX_CONFIG_FILES_SEEN) configFiles.push(full);
              else configTruncated = true;
            }
            const stats = bucketStats(bucket);
            stats.unanalyzedFiles += 1;
            const ext = extOf(name);
            stats.unanalyzedByExtension[ext] = (stats.unanalyzedByExtension[ext] ?? 0) + 1;
            continue;
          }
          if (entries.length >= cap) {
            excludedCount += 1;
            truncationReason = truncationReason ?? 'entry-cap';
            bucketStats(bucket).excludedFiles += 1;
            if (excludedSample.length < MAX_EXCLUDED_SAMPLE) {
              excludedSample.push(rel);
            }
            continue;
          }
          if (entries.length >= budgets.maxCandidateFiles) {
            excludedCount += 1;
            truncationReason = truncationReason ?? 'candidate-cap';
            bucketStats(bucket).excludedFiles += 1;
            if (excludedSample.length < MAX_EXCLUDED_SAMPLE) {
              excludedSample.push(rel);
            }
            continue;
          }
          if (Number(linkStat.size ?? 0) > budgets.maxFileSizeBytes) {
            excludedCount += 1;
            truncationReason = truncationReason ?? 'file-size';
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
    let walkError = null;
    try {
      await visit(canonicalRoot, 0);
    } catch (error) {
      if (error?.code === 'CANCELLED') throw error;
      if (error?.code === 'TRUNCATED') {
        truncationReason = truncationReason ?? error.reason ?? 'time-budget';
      } else {
        walkError = error instanceof Error ? error.message : String(error);
      }
    }
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
    const truncated = excludedCount > 0 || truncationReason !== null || scanState.truncated;
    if (truncationReason === null && scanState.truncated) truncationReason = 'skipped-scan';
    if (truncationReason === null && excludedCount > 0) truncationReason = 'entry-cap';
    skippedSymlinks.sort();
    nestedRepoRoots.sort();
    return {
      entries,
      scanned,
      truncated,
      truncationReason,
      excludedCount,
      excludedSample,
      maxEntryFiles: cap,
      configFiles,
      configTruncated,
      dirsVisited,
      filesDiscovered,
      symlinksSkipped,
      skippedSymlinks,
      nestedRepoRoots,
      maxDepthSeen,
      scopeRoot: canonicalRoot,
      walkError,
      budgets: { maxDirsVisited: budgets.maxDirsVisited, maxFilesDiscovered: budgets.maxFilesDiscovered, maxDepth: budgets.maxDepth },
      coverage: { byModule: modules, totals, skippedDirs, unreadableDirs, excludedTruncated: scanState.truncated, skippedSymlinks, nestedRepoRoots, dirsVisited, filesDiscovered, symlinksSkipped, truncationReason },
    };
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

const buildSnapshot = async (key, requestedKey, scopeRoot, mode, maxEntryFiles, { forceStatus = false, onProgress = null, shouldCancel = null, scopeMode = 'auto', walkBudgets = {}, prewalked = null } = {}) => {
    const engine = await loadEngine();
    // The scope arrives resolved by ensureIndex: the walk, the revision, the
    // scope ids, and the reported scope all share this one root. Resolving it
    // again here from a different string is what let the cache lookup and the
    // build disagree about which directory was indexed.
    const indexRoot = scopeRoot;
    // A restore listing from this same call doubles as the build walk when
    // the inputs match; otherwise the build traverses as before.
    const walk = prewalked ?? await listEntryFiles(indexRoot, maxEntryFiles, { ...walkBudgets, shouldCancel });
    const { entries, truncated, truncationReason, excludedCount, excludedSample, maxEntryFiles: cap, coverage } = walk;
    const { revision, binding, dirty, dirtyReason } = await readRevision(indexRoot, entries, { forceStatus });
    if (isFunction(shouldCancel) && shouldCancel()) {
      const err = new Error('code-graph index cancelled');
      err.code = 'CANCELLED';
      throw err;
    }
    const ids = deriveScopeIdsForRoot(scopeRoot);
    const projectId = ids.projectId;
    const worktreeId = ids.worktreeId;
    const fingerprint = engine.computeScopeFingerprint(projectId, worktreeId, revision);
    // Repo-root-relative ids: the engine roots every file id at the
    // directory the route serves, so the served `snapshotRoot` below is
    // the same root the resolver joins ids against — joining against
    // anything else addresses files that do not exist.
    if (isFunction(shouldCancel) && shouldCancel()) {
      const err = new Error('code-graph index cancelled');
      err.code = 'CANCELLED';
      throw err;
    }
    // Incremental reuse plan: fingerprint the walked entries against the last
    // published generation's records. Unchanged files keep their shards; only
    // changed, added, and unrooted entries go through the compiler, and the
    // subset snapshot merges over the previous one. Fingerprinting yields and
    // honours cancellation like the walk does.
    // Posix spelling shared with the engine's root identity (including
    // drive-letter case): session matching and record keys must agree
    // exactly, or reuse silently disables instead of mixing scopes.
    const posixRootOf = (value) => {
      const slashed = String(value ?? '').replace(/\\/g, '/');
      return /^[a-zA-Z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed;
    };
    const relOfEntry = (abs) => {
      const prefix = `${posixRootOf(indexRoot).replace(/\/+$/, '')}/`;
      // Both sides share the spelling: the engine lowercases drive letters
      // when it derives the same relative paths, and a one-sided fold makes
      // every entry miss its record.
      const key = posixRootOf(abs);
      if (!key.startsWith(prefix)) return null;
      const rel = key.slice(prefix.length);
      return rel.length > 0 ? rel : null;
    };
    const previousForReuse = completeSnapshots.get(key) ?? snapshots.get(key) ?? null;
    const fingerprints = new Map();
    const fileStats = new Map();
    const relByAbs = new Map();
    const unreadableFiles = [];
    let statHits = 0;
    {
      // Stat fast path: size plus mtimeMs matching the record skips hashing
      // (git's own racy-clean trust model). Any stat difference falls back
      // to hashing raw bytes, so an mtime-only bump still reuses on equal
      // content and no byte change ever slips through.
      const previousRecords = previousForReuse?.fileRecords?.files ?? {};
      let fingerprinted = 0;
      for (const abs of entries) {
        if (isFunction(shouldCancel) && shouldCancel()) {
          const err = new Error('code-graph index cancelled');
          err.code = 'CANCELLED';
          throw err;
        }
        const rel = relOfEntry(abs);
        relByAbs.set(abs, rel);
        if (rel !== null) {
          const record = previousRecords[rel];
          let stat = null;
          try {
            stat = await fsPromises.stat(abs);
          } catch {
            stat = null;
          }
          const statMatch =
            stat !== null &&
            stat.isFile() &&
            record !== undefined &&
            Number.isFinite(record.size) &&
            Number.isFinite(record.mtimeMs) &&
            record.size === stat.size &&
            record.mtimeMs === stat.mtimeMs;
          if (statMatch && record !== undefined) {
            fingerprints.set(rel, record.blob);
            fileStats.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs });
            statHits += 1;
          } else {
            try {
              const bytes = await fsPromises.readFile(abs);
              fingerprints.set(rel, engine.fingerprintBytes(bytes));
              if (stat !== null && stat.isFile()) fileStats.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs });
            } catch {
              // Content unreadable and no reusable record: the file must stay
              // out of every compiler input (an unreadable entry aborts the
              // whole program with no project covering it). It is recorded
              // below and reported as partial coverage instead of failing
              // the build. A prior record reads as deleted through
              // validation, so dependents still re-resolve safely.
              unreadableFiles.push(rel);
            }
          }
        }
        fingerprinted += 1;
        if (fingerprinted % 200 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
    // Configuration files fingerprint into the same ledger so an options
    // edit invalidates: they never enter the analysis subset (the engine
    // would refuse them as entries) but their change forces full reanalysis
    // under the new options below.
    for (const abs of walk.configFiles ?? []) {
      if (isFunction(shouldCancel) && shouldCancel()) {
        const err = new Error('code-graph index cancelled');
        err.code = 'CANCELLED';
        throw err;
      }
      const rel = relOfEntry(abs);
      if (rel === null) continue;
      try {
        const bytes = await fsPromises.readFile(abs);
        fingerprints.set(rel, engine.fingerprintBytes(bytes));
        const stat = await fsPromises.stat(abs).catch(() => null);
        if (stat !== null && stat.isFile()) fileStats.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Unreadable config: no record, so any prior record for it reads
        // as deleted and forces reanalysis.
      }
    }
    const validated = engine.validateFileRecords(previousForReuse?.fileRecords ?? null, fingerprints);
    const configMoved = [...validated.changed, ...validated.added, ...validated.deleted]
      .some((rel) => isConfigBasename(rel.split('/').pop() ?? rel));
    // Compiler inputs are the walked entries minus files whose bytes could
    // not be read: entries keep the walk truth (binding, counts, coverage)
    // while only readable files reach a program. Rel-less entries stay in
    // (today's conservative behavior for unrooted paths is unchanged).
    const buildEntries = entries.filter((abs) => {
      const rel = relByAbs.get(abs);
      return rel === null || rel === undefined || fingerprints.has(rel);
    });
    const unreadableFileSet = new Set(unreadableFiles);
    const unreadableFileRels = [...unreadableFileSet].sort().slice(0, MAX_UNREADABLE_FILES);
    const buildCoverage = unreadableFileSet.size === 0 ? coverage : {
      ...coverage,
      unreadableFiles: unreadableFileRels,
      unreadableFileCount: unreadableFileSet.size,
    };
    const buildTruncationReason = truncationReason ?? (unreadableFileSet.size > 0 ? 'unreadable-files' : null);
    const buildTruncated = truncated || unreadableFileSet.size > 0;
    if (entries.length > 0 && buildEntries.length === 0) {
      // Every listed file is unreadable: publishing an empty graph would
      // masquerade as complete, so this stays a distinguishable failure.
      const error = new Error(`code-graph: no readable source files in scope (${entries.length} listed, all unreadable)`);
      error.code = 'NO_READABLE_ENTRIES';
      throw error;
    }
    // Dependents reanalyze too, transitively: a file importing or calling
    // into a reanalyzed file resolves against new content, so its edges are
    // recomputed rather than carried. Direction matters: an edit never
    // changes the files it depends on, so only importers and callers join,
    // never dependencies. Kinds are the cross-file relationship set;
    // file-local and advisory kinds never pull dependents in. When the
    // closure covers every entry the build falls back to a full rebuild
    // below instead of merging a subset that equals the whole scope.
    const triggerRels = new Set([...validated.changed, ...validated.added, ...validated.deleted]);
    // Direct importers/callers of a seed set, from the previous graph.
    // Direction matters: an edit never changes the files it depends on, so
    // only importers and callers join, never dependencies. Exactly one
    // level: a joined file with unchanged content re-emits identical
    // exports (deterministic extraction), so its own importers resolve
    // identically and need no analysis. Deeper cascades would only repeat
    // byte-identical work.
    const expandDependents = (seed) => {
      const out = new Set();
      if (previousForReuse === null || seed.size === 0) return out;
      const fileByNodeId = new Map();
      for (const node of previousForReuse.snapshot.nodes ?? []) {
        if (typeof node?.id === 'string' && typeof node?.file === 'string' && node.file.length > 0) {
          fileByNodeId.set(node.id, node.file);
        }
      }
      const dependentKinds = new Set(['IMPORTS', 'EXPORTS', 'TESTS', 'CALLS_STATIC', 'CALLS_UNRESOLVED']);
      for (const edge of previousForReuse.snapshot.edges ?? []) {
        if (!dependentKinds.has(edge?.kind)) continue;
        const toFile = edge.to === 'unknown' ? null : (fileByNodeId.get(edge.to) ?? null);
        if (toFile === null || !seed.has(toFile)) continue;
        const fromFile = fileByNodeId.get(edge.from) ?? null;
        if (fromFile !== null && !seed.has(fromFile)) out.add(fromFile);
      }
      return out;
    };
    // A moved compiler configuration forces full reanalysis even when no
    // entry changed: the previous graph was resolved under other options.
    // Coverage is decided after phase A by export surfaces, not upfront:
    // an edge-based closure would always cover chained scopes and defeat
    // all narrowing before any evidence exists.
    const reuseActive =
      previousForReuse !== null &&
      !configMoved &&
      validated.reused.size > 0;
    const subsetFor = (rels) => entries.filter((abs) => {
      const rel = relByAbs.get(abs);
      return rel === null || rel === undefined || rels.has(rel);
    });
    const recordsDoc = {
      version: engine.FILE_RECORDS_VERSION,
      parser: engine.PARSER_RECORD_VERSION,
      schema: engine.SNAPSHOT_STORE_VERSION,
      files: Object.fromEntries(
        [...fingerprints].map(([file, blob]) => {
          const stat = fileStats.get(file);
          return stat !== undefined
            ? [file, { file, blob, size: stat.size, mtimeMs: stat.mtimeMs }]
            : [file, { file, blob }];
        }),
      ),
    };
    const runCompiler = (targetAbs) => engine.indexFiles(targetAbs, {
      rootDir: indexRoot,
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
        if (isFunction(shouldCancel) && shouldCancel()) {
          const err = new Error('code-graph index cancelled');
          err.code = 'CANCELLED';
          throw err;
        }
        partialByDirectory.set(key, assembleEntry({
          snapshot: partialSnapshot,
          scope: { projectId, worktreeId, revision, fingerprint, scopeRoot, scopeMode: mode, requestedDir: requestedKey },
          binding,
          dirty,
          dirtyReason,
          truncated,
          truncationReason,
          excludedCount,
          excludedSample,
          cap,
          entries: targetAbs,
          coverage,
          metrics: { dirsVisited: walk.dirsVisited, filesDiscovered: walk.filesDiscovered, symlinksSkipped: walk.symlinksSkipped, maxDepthSeen: walk.maxDepthSeen },
        }));
        onProgress?.({
          phase: 'projects',
          files: targetAbs.length,
          projectsDone: progress.projectsDone,
          projectsTotal: progress.projectsTotal,
          partial: summarizePartialSnapshot(partialSnapshot),
        });
      },
    });
    // Two-phase incremental analysis. Phase A compiles changed and added
    // entries; their export surfaces then decide which dependents must
    // follow in phase B. A file whose exports resolve identically needs no
    // dependent reanalysis: importers keep edges whose endpoints survive.
    // Full fallback (or no previous generation) compiles everything at once.
    const concatSnapshots = (left, right) => ({
      nodes: [...(left.nodes ?? []), ...(right.nodes ?? [])],
      edges: [...(left.edges ?? []), ...(right.edges ?? [])],
      root: left.root ?? right.root,
      dropped: [...(left.dropped ?? []), ...(right.dropped ?? [])],
      ...(((left.content ?? null) !== null || (right.content ?? null) !== null)
        ? {
            content: {
              tokenCap: left.content?.tokenCap ?? right.content?.tokenCap,
              files: { ...(left.content?.files ?? {}), ...(right.content?.files ?? {}) },
              skipped: [...(left.content?.skipped ?? []), ...(right.content?.skipped ?? [])],
            },
          }
        : {}),
    });
    const shardSurface = (shards, file) => {
      const shard = shards.get(file);
      if (shard === undefined) return null;
      return engine.exportSurfaceKey(shard);
    };
    let finalSnapshot;
    let incremental;
    let analyzedCount = 0;
    if (!reuseActive) {
      const snapshot = runCompiler(buildEntries);
      analyzedCount = buildEntries.length;
      finalSnapshot = snapshot;
      incremental = {
        statReused: statHits,
        reused: 0,
        reanalyzed: buildEntries.length,
        added: validated.added.size,
        deleted: validated.deleted.size,
        invalidatedEdges: 0,
        unreadableFiles: unreadableFileRels,
        unreadableFileCount: unreadableFileSet.size,
      };
    } else if (triggerRels.size === 0) {
      // Wholly-reused revision move: fingerprints identical, no compiler.
      finalSnapshot = previousForReuse.snapshot;
      incremental = {
        statReused: statHits,
        reused: validated.reused.size,
        reanalyzed: 0,
        added: 0,
        deleted: 0,
        invalidatedEdges: 0,
        unreadableFiles: [],
        unreadableFileCount: 0,
      };
    } else {
      const phaseASet = new Set([...validated.changed, ...validated.added]);
      const subsetA = subsetFor(phaseASet);
      const freshA = runCompiler(subsetA);
      analyzedCount += subsetA.length;
      const prevShards = new Map(engine.splitSnapshotIntoShards(previousForReuse.snapshot).map((shard) => [shard.file, shard]));
      const freshShards = new Map(engine.splitSnapshotIntoShards(freshA).map((shard) => [shard.file, shard]));
      const differers = new Set();
      for (const rel of validated.changed) {
        if (shardSurface(prevShards, rel) !== shardSurface(freshShards, rel)) differers.add(rel);
      }
      const dependents = expandDependents(new Set([...differers, ...validated.deleted]));
      const analysisRels = new Set([...triggerRels, ...dependents]);
      const reusedFiles = [...validated.reused].filter((file) => !analysisRels.has(file));
      if ([...fingerprints.keys()].every((file) => analysisRels.has(file))) {
        // Degenerate: the gated closure still covers the scope; one full
        // build instead of merging a subset that equals it. The phase-A
        // program above is discarded work in this corner.
        const snapshot = runCompiler(buildEntries);
        analyzedCount = buildEntries.length;
        finalSnapshot = snapshot;
        incremental = {
          statReused: statHits,
          reused: 0,
          reanalyzed: buildEntries.length,
          added: validated.added.size,
          deleted: validated.deleted.size,
          invalidatedEdges: 0,
          unreadableFiles: unreadableFileRels,
          unreadableFileCount: unreadableFileSet.size,
        };
      } else {
        if (isFunction(shouldCancel) && shouldCancel()) {
          const err = new Error('code-graph index cancelled');
          err.code = 'CANCELLED';
          throw err;
        }
        const subsetB = entries.filter((abs) => {
          const rel = relByAbs.get(abs);
          return rel !== null && rel !== undefined && dependents.has(rel) && !phaseASet.has(rel);
        });
        const freshB = subsetB.length > 0 ? runCompiler(subsetB) : null;
        analyzedCount += subsetB.length;
        const combined = freshB === null ? freshA : concatSnapshots(freshA, freshB);
        const merged = engine.rebuildIncremental(previousForReuse.snapshot, analysisRels, combined);
        finalSnapshot = merged.snapshot;
        incremental = {
          statReused: statHits,
          reused: reusedFiles.length,
          reanalyzed: analyzedCount,
          added: validated.added.size,
          deleted: validated.deleted.size,
          invalidatedEdges: merged.invalidatedEdges,
          unreadableFiles: unreadableFileRels,
          unreadableFileCount: unreadableFileSet.size,
        };
      }
    }
    const built = assembleEntry({ snapshot: finalSnapshot, scope: { projectId, worktreeId, revision, fingerprint, scopeRoot, scopeMode: mode, requestedDir: requestedKey }, binding, dirty, dirtyReason, truncated: buildTruncated, truncationReason: buildTruncationReason, excludedCount, excludedSample, cap, entries, coverage: buildCoverage, metrics: { dirsVisited: walk.dirsVisited, filesDiscovered: walk.filesDiscovered, symlinksSkipped: walk.symlinksSkipped, maxDepthSeen: walk.maxDepthSeen }, fileRecords: recordsDoc, incremental });
    // The finished graph supersedes any projection this build handed over.
    // Persistence is awaited, not backgrounded: a blocking caller observes
    // read-after-write durability, and the job's ready state means persisted.
    // Non-blocking callers already hold their pending answer, so they wait
    // on nothing. persistEntry never throws; a failed store is a state note.
    partialByDirectory.delete(key);
    await persistEntry(key, built);
    lastTerminalFailure.delete(key);
    return built;
  };

  /**
   * The entry every read serves, assembled once so a rebuilt graph and a
   * restored one cannot drift in shape.
   */
  const assembleEntry = ({ snapshot, scope, binding, dirty, dirtyReason, truncated, truncationReason = null, excludedCount, excludedSample, cap, entries, coverage, metrics = null, observedAtMs, fileRecords = null, incremental = null, buildSeq: buildSeqOverride = null }) => {
    // Restores adopt the persisted number so surfaces sharing one store
    // agree on it; fresh builds mint past the highest number seen.
    if (buildSeqOverride === null || !Number.isFinite(buildSeqOverride)) {
      buildSeq += 1;
    } else {
      buildSeq = Math.max(buildSeq, buildSeqOverride);
    }
    const built = {
      snapshot,
      scope,
      observedAtMs: observedAtMs ?? Date.now(),
      binding,
      // Null outside git: the content-hash path reports no working-tree
      // state and the served shape stays exactly as it was.
      dirty: dirty ?? null,
      truncated,
      truncationReason: truncationReason ?? null,
      indexTruncated: truncated,
      excludedCount,
      excludedSample,
      entryCap: cap,
      entryCount: entries.length,
      entryFiles: entries,
      // Per-file reuse ledger for the next incremental build (internal,
      // never served): fingerprints plus this build's measured work split.
      fileRecords: fileRecords ?? null,
      incremental: incremental ?? null,
      // Walk-measured module coverage (analyzed vs unanalyzed vs
      // excluded): plain JSON riding the served entry so exploreModules
      // can report it without re-walking.
      coverage,
      metrics,
      // Monotonic build identity: a rebuild (refresh, HEAD move, cap
      // change) always mints a new one, so per-build caches below can key
      // on it instead of guessing from timestamps. Restores carry the
      // persisted number instead (see above).
      buildSeq: buildSeqOverride === null || !Number.isFinite(buildSeqOverride) ? buildSeq : buildSeqOverride,
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
  const persistEntry = async (scopeKey, entry) => {
    if (entry.truncated) return;
    const storage = await getStorage();
    if (!storage) return;
    const result = await storage.write(scopeKey, entry);
    if (!result.written) {
      emitProgress(scopeKey, { state: 'ready', storeWriteFailed: result.reason ?? 'unknown' });
    }
  };

  /**
   * A store hit skips the compiler build entirely (measured 257–268 s on a large
   * monorepo). The repository's scope is read first, so a store written before
   * an edit cannot be served as current: any revision or dirty-fingerprint
   * difference is a miss and the caller rebuilds.
   */
  // A restore consults the same resolved scope the build used: the walk, the
  // revision, and the store ids all bind the scope root, never the requested
  // directory, so a persisted generation is found by any spelling of its scope.
  const restoreFromStore = async ({ requestedKey, scopeRoot, mode }, cap, shareWalk = false) => {
    const storage = await getStorage();
    if (!storage) return null;
    const engine = await loadEngine();
    const walk = await listEntryFiles(scopeRoot, cap);
    if (walk.truncated) return null;
    const { entries, excludedCount, excludedSample, coverage } = walk;
    const { revision, binding, dirty, dirtyReason } = await readRevision(scopeRoot, entries, { forceStatus: false });
    const ids = deriveScopeIdsForRoot(scopeRoot);
    const projectId = ids.projectId;
    const worktreeId = ids.worktreeId;
    const fingerprint = engine.computeScopeFingerprint(projectId, worktreeId, revision);
    let read;
    try {
      read = await storage.read(requestedKey, { projectId, worktreeId, revision, fingerprint });
    } catch (error) {
      // A restore that throws is a miss with a stated reason, never a silent
      // fallthrough: the first version swallowed a stack overflow here and the
      // panel rebuilt for minutes while the store looked healthy.
      emitProgress(requestedKey, { state: 'discovering', storeReadFailed: error instanceof Error ? error.message : String(error) });
      return shareWalk ? { miss: true, walk } : null;
    }
    if (read.status !== 'hit') return shareWalk ? { miss: true, walk } : null;
    // Restores are complete by construction: truncated builds never persist
    // (persistEntry skips them so a partial can neither overwrite nor pose
    // as a complete generation), and a cap-truncated walk misses restore
    // above. Only the published number is adopted, so surfaces sharing one
    // store agree on the generation instead of minting fresh local ones.
    const built = assembleEntry({
      snapshot: read.snapshot,
      scope: { projectId, worktreeId, revision, fingerprint, scopeRoot, scopeMode: mode, requestedDir: requestedKey },
      binding,
      dirty,
      dirtyReason,
      truncated: false,
      truncationReason: null,
      excludedCount,
      excludedSample,
      cap,
      entries,
      coverage,
      metrics: { dirsVisited: walk.dirsVisited, filesDiscovered: walk.filesDiscovered, symlinksSkipped: walk.symlinksSkipped, maxDepthSeen: walk.maxDepthSeen },
      observedAtMs: read.manifest.observedAtMs,
      fileRecords: read.fileRecords ?? null,
      buildSeq: read.manifest?.buildSeq ?? null,
    });
    emitProgress(requestedKey, {
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

  // One serve for a finished build: complete graphs are fresh, truncated
  // graphs are never advertised as fresh or complete - they ride along
  // labelled stale with the reason, and the query path downgrades their
  // coverage to partial under the existing contract.
  const serveBuilt = (entry) => entry.truncated
    ? { ...entry, freshness: 'stale', staleReason: 'index-truncated' }
    : { ...entry, freshness: 'fresh' };

  const ensureIndex = async (directory, { refresh = false, maxEntryFiles, block = false, scopeMode = 'auto', walkBudgets = {} } = {}) => {
    const engine = await loadEngine();
    const cap = resolveMaxEntryFiles(maxEntryFiles ?? defaultMaxEntryFiles);
    // The scope is resolved exactly once, the way the build resolves it: the
    // requested directory maps to its scope root, and that one root keys the
    // cache, the freshness check, the revision, the jobs, and the restore.
    // In auto mode a subdirectory shares its repo root's index; in directory
    // mode it keeps its own. Either way the lookup below binds the same root
    // the build walked, so an unchanged scope reuses instead of rebuilding.
    // Canonicalize without folding case first: the walk, the revision, the
    // engine's rootDir, and status reporting all need the real on-disk
    // spelling (a case-folded rootDir makes the engine match zero entries).
    // Only the map key below folds case (Windows: `I:/x` and `i:/x` share
    // one entry); the work itself always uses this real-cased root.
    const rawCanonical = stripTrailingSep(path.normalize(String(directory ?? '')), path.sep);
    const rawKey = scopeKeyOf(rawCanonical, path);
    let scopeRoot = rawCanonical;
    try {
      scopeRoot = stripTrailingSep(path.normalize(await fsPromises.realpath(scopeRoot)), path.sep);
    } catch {
      // Unresolvable here (routes validate first); the walk reports it.
    }
    const requestedKey = scopeKeyOf(scopeRoot, path);
    const resolved = await resolveIndexScope({ fsPromises, path }, scopeRoot, scopeMode);
    let resolvedRoot = stripTrailingSep(path.normalize(String(resolved.scopeRoot ?? scopeRoot)), path.sep);
    try {
      resolvedRoot = stripTrailingSep(path.normalize(await fsPromises.realpath(resolvedRoot)), path.sep);
    } catch {
      // Keep the normalized spelling; the walk reports unreadable roots.
    }
    scopeRoot = resolvedRoot;
    const key = scopeKeyOf(scopeRoot, path);
    const mode = resolved.mode;
    // Alias both spellings: the synchronous cancel/status paths key on the
    // raw requested directory (no I/O there), which may differ from the
    // realpath'd spelling by symlinks or case.
    rememberScopeAlias(rawKey, key);
    rememberScopeAlias(requestedKey, key);
    const cached = snapshots.get(key);
    // A cached entry is reusable while its cap matches, its revision still
    // matches a fresh read on the scope root, and its age stays within the
    // freshness window. The revision is the scope root's, computed over the
    // cached entry files - the same inputs the build bound.
    const revisionMatches = async (entry) => {
      if (!entry || entry.entryCap !== cap) return false;
      const { revision } = await readRevision(scopeRoot, entry.entryFiles ?? []);
      return revision === entry.scope.revision && Date.now() - entry.observedAtMs <= engine.STALE_AFTER_MS;
    };
    // The fallback every serve below prefers: the previous complete
    // generation when one exists, else the latest entry. A whole older graph
    // reads better than a partial newer one while a rebuild runs.
    const fallbackEntry = () => completeSnapshots.get(key) ?? snapshots.get(key) ?? null;
    const serveFallback = (staleReason, extra = {}) => {
      const fallback = fallbackEntry();
      if (!fallback) return null;
      return {
        ...fallback,
        freshness: 'stale',
        staleReason: fallback.truncated ? 'index-truncated' : staleReason,
        ...extra,
      };
    };
    const refreshErrorOf = (error) => (error instanceof Error ? error.message : String(error));
    // A cancel that landed while the checks below ran settles here: serving
    // a fresh graph is success and consumes it, while no usable graph settles
    // cancelled instead of starting a build the caller just refused.
    const cancelBeforeStart = !refresh && takePendingCancel(key);
    let prewalked = null;
    if (!refresh) {
      // A complete generation whose revision still matches serves fresh -
      // the latest entry or, when the latest build truncated, the previous
      // complete one (e.g. reopening under a cap that already indexed fully).
      const complete = (!cached || cached.truncated) ? completeSnapshots.get(key) : cached;
      if (complete && (await revisionMatches(complete))) {
        return { entry: { ...complete, freshness: 'fresh' }, scopeKey: key, scopeRoot, scopeMode: mode };
      }
      // An unchanged truncated index settles instead of rebuilding forever:
      // it is served explicitly partial/stale, and only a moved revision, a
      // changed cap, an expired TTL, or an explicit refresh starts another
      // single build attempt. The stated reason rides `staleReason`.
      if (cached && cached.truncated && (await revisionMatches(cached))) {
        return { entry: serveFallback('index-truncated'), scopeKey: key, scopeRoot, scopeMode: mode };
      }
      // No usable in-memory graph: a persisted generation for this exact scope
      // replaces a full rebuild. An explicit refresh always rebuilds.
      // One walk per build: the restore listing is handed to the job when
      // the build would walk identically (default budgets), so a rebuild
      // traverses the tree once instead of twice.
      const shareWalk = Object.keys(walkBudgets).length === 0;
      const restored = await restoreFromStore({ requestedKey, scopeRoot, mode }, cap, shareWalk).catch(() => null);
      if (restored !== null && restored.miss !== true) {
        retainSnapshot(key, restored);
        return { entry: { ...restored, freshness: 'fresh' }, scopeKey: key, scopeRoot, scopeMode: mode };
      }
      if (restored !== null && restored.miss === true) prewalked = restored.walk ?? null;
    }
    // Dedupe: one build per scope, so concurrent opens of different
    // directories in the same repo join the same job instead of starting
    // parallel full builds.
    // An explicit refresh is a new intent: it consumes a pending cancel and
    // supersedes the running build instead of settling cancelled.
    if (refresh) takePendingCancel(key);
    else if (cancelBeforeStart) {
      if (block) {
        const cancelled = new Error('code-graph index cancelled');
        cancelled.code = 'CANCELLED';
        throw cancelled;
      }
      return { pending: { state: 'cancelled', startedAtMs: Date.now(), progress: null, cancelRequested: true, superseded: false, error: null, truncationReason: null }, cached: serveFallback('rebuild-cancelled'), scopeKey: key, scopeRoot, scopeMode: mode };
    }
    // An explicit refresh supersedes the running build: cancel it and start anew.
    const running = jobs.get(key);
    if (running && refresh) {
      running.superseded = true;
      running.cancelRequested = true;
      jobs.delete(key);
      emitProgress(running.directory, { state: 'superseded', supersededBy: 'refresh' });
    }
    const active = jobs.get(key);
    if (active) {
      active.requesters.add(requestedKey);
      announceJobState(active, requestedKey);
      if (!block) return { pending: jobFacts(active), cached: serveFallback('rebuild-pending'), scopeKey: key, scopeRoot, scopeMode: mode };
      try {
        return { entry: serveBuilt(await active.promise), scopeKey: key, scopeRoot, scopeMode: mode };
      } catch (error) {
        const fallback = fallbackEntry();
        return fallback
          ? { entry: serveFallback('rebuild-failed', { refreshError: refreshErrorOf(error) }), refreshFailed: error, scopeKey: key, scopeRoot, scopeMode: mode }
          : Promise.reject(error);
      }
    }
    if (!refresh) {
      // A terminally failed build stays failed for plain reads: relaunching
      // here is what turned every status poll into a fresh doomed build.
      // Refresh retries now, the cooldown retries later, and a published
      // generation clears the memory above. The fallback still serves the
      // previous complete generation as stale underneath the failed state.
      const failure = lastTerminalFailure.get(key);
      if (failure !== undefined && Date.now() - failure.atMs < FAILURE_RETRY_COOLDOWN_MS) {
        return { pending: { state: failure.state, startedAtMs: failure.atMs, progress: null, cancelRequested: false, superseded: false, error: failure.error, truncationReason: null }, cached: serveFallback('rebuild-failed'), scopeKey: key, scopeRoot, scopeMode: mode };
      }
      if (failure !== undefined) lastTerminalFailure.delete(key);
    } else {
      lastTerminalFailure.delete(key);
    }
    const job = startJob(key, requestedKey, scopeRoot, mode, cap, { refresh, scopeMode, walkBudgets, prewalked });
    if (!block) return { pending: jobFacts(job), cached: serveFallback('rebuild-pending'), scopeKey: key, scopeRoot, scopeMode: mode };
    try {
      return { entry: serveBuilt(await job.promise), scopeKey: key, scopeRoot, scopeMode: mode };
    } catch (error) {
      // A failed build never erases the last good graph: serve the previous
      // complete generation (or the latest entry) labelled stale instead.
      const fallback = fallbackEntry();
      if (fallback) {
        return { entry: serveFallback('rebuild-failed', { refreshError: refreshErrorOf(error) }), refreshFailed: error, scopeKey: key, scopeRoot, scopeMode: mode };
      }
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
    superseded: job.superseded === true,
    error: job.error ?? null,
    truncationReason: job.truncationReason ?? null,
  });

  const emitProgress = (directory, event) => {
    if (typeof runtimeOptions.onProgress !== 'function') return;
    try {
      runtimeOptions.onProgress({ directory, atMs: Date.now(), ...event });
    } catch {
      // A reporter must never break an index build.
    }
  };

  const evictOldest = (map, protectKey) => {
    const oldest = [...map.entries()]
      .filter(([mapKey]) => mapKey !== protectKey)
      .sort((left, right) => (left[1].observedAtMs ?? 0) - (right[1].observedAtMs ?? 0))[0];
    if (!oldest) return;
    map.delete(oldest[0]);
    return oldest[0];
  };

  const retainSnapshot = (key, entry) => {
    // A published generation always supersedes a projection for that scope.
    partialByDirectory.delete(key);
    snapshots.set(key, entry);
    // A truncated build refines the served entry but never overwrites the
    // previous complete generation: only a complete build replaces it.
    if (!entry.truncated) {
      completeSnapshots.set(key, entry);
      while (completeSnapshots.size > MAX_RETAINED_SNAPSHOTS) {
        evictOldest(completeSnapshots, key);
      }
    }
    while (snapshots.size > MAX_RETAINED_SNAPSHOTS) {
      const evicted = evictOldest(snapshots, key);
      if (!evicted) break;
      completeSnapshots.delete(evicted);
      for (const [requestedKey, scopeKey] of requestToScope) {
        if (scopeKey === evicted) requestToScope.delete(requestedKey);
      }
    }
  };

  // A joiner opened the same scope under a different requested directory:
  // announce the running job under their spelling too, so a status reader
  // that never started the build still finds the live state by its own key.
  const announceJobState = (job, requestedKey) => {
    emitProgress(requestedKey, {
      state: job.state,
      phase: job.progress?.phase ?? null,
      files: job.progress?.files ?? null,
      projectsDone: job.progress?.projectsDone ?? null,
      projectsTotal: job.progress?.projectsTotal ?? null,
    });
  };

  const startJob = (key, requestedKey, scopeRoot, mode, cap, { refresh, scopeMode = 'auto', walkBudgets = {}, prewalked = null } = {}) => {
    const job = {
      key,
      directory: requestedKey,
      scopeRoot,
      scopeMode: mode,
      // Every requested spelling that joined this build: progress is
      // announced under each one, because the host answers status readers
      // by the directory they asked about.
      requesters: new Set([requestedKey]),
      startedAtMs: Date.now(),
      state: 'queued',
      progress: null,
      cancelRequested: false,
      superseded: false,
      truncationReason: null,
      error: null,
    };
    const emitJob = (event) => {
      for (const requester of job.requesters) emitProgress(requester, event);
    };
    // Registered before the promise runs its synchronous prefix: a cancel
    // arriving with the first `discovering` emit still finds the job. No
    // await runs between this line and the assignment below, so a joiner
    // can never observe a registered job without its promise.
    jobs.set(key, job);
    job.promise = (async () => {
      job.state = 'discovering';
      emitJob({ state: 'discovering', elapsedMs: 0 });
      try {
        const entry = await buildSnapshot(key, requestedKey, scopeRoot, mode, cap, {
          forceStatus: refresh,
          scopeMode,
          walkBudgets,
          prewalked,
          shouldCancel: () => job.cancelRequested === true,
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
            emitJob({
              state: job.state,
              phase: event.phase,
              files: event.files,
              projectsDone: event.projectsDone,
              projectsTotal: event.projectsTotal,
              elapsedMs: event.elapsedMs ?? (Date.now() - job.startedAtMs),
              generation: event.generation ?? null,
              // Bounded projection (12 modules max) of the projects finished
              // so far: the only live answer available while the synchronous
              // build holds the worker loop. Dropped here, the panel shows an
              // empty canvas until the whole build lands.
              partial: event.partial ?? null,
            });
          },
        });
        retainSnapshot(key, entry);
        job.truncationReason = entry.truncationReason ?? null;
        job.state = entry.truncated ? 'truncated' : 'ready';
        // A truncated discovery still retains its partial entry for context, but it
        // is never persisted as a complete generation (persistEntry skips it),
        // never overwrites the previous complete generation, and an unchanged
        // scope settles on serving it labelled stale instead of rebuilding.
        emitJob({
          state: job.state,
          truncationReason: job.truncationReason,
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
        if (job.superseded === true) {
          job.state = 'superseded';
          job.error = null;
        } else {
          const cancelled = job.cancelRequested === true || error?.code === 'CANCELLED';
          job.state = cancelled ? 'cancelled' : 'failed';
          job.error = cancelled ? null : error instanceof Error ? error.message : String(error);
        }
        if (job.state === 'failed') {
          // A failed build gates the next plain read: without this memory,
          // every status poll starts a fresh build that fails again and only
          // ever reports `discovering`. Cancelled jobs record nothing: a
          // cancel is consumed intent, and the next plain read must be free
          // to rebuild (a cancelled refresh must still recover the previous
          // complete generation). Superseded jobs are replaced, not
          // terminal, so they record nothing either.
          lastTerminalFailure.set(key, { atMs: Date.now(), state: job.state, error: job.error });
          while (lastTerminalFailure.size > MAX_RETAINED_SNAPSHOTS * 8) {
            lastTerminalFailure.delete(lastTerminalFailure.keys().next().value);
          }
        }
        // A build that never publishes must not leave its projection behind:
        // the projection is not a generation, and the previous complete one
        // (if any) stays exactly where it was, labelled stale on the next read.
        partialByDirectory.delete(key);
        emitJob({ state: job.state, error: job.error });
        throw error;
      } finally {
        jobs.delete(key);
      }
    })();
    // A fire-and-forget start must not surface as an unhandled rejection; the
    // failure is reported through the state and by the next read.
    job.promise.catch(() => {});
    return job;
  };

  /**
   * Stops a running build at its next phase boundary and reports the request.
   * Synchronous by design: it runs inside the engine's progress callback while
   * the build holds the event loop, so it resolves the scope from the alias
   * recorded before the job started instead of awaiting any I/O.
   */
  const cancelIndex = (directory) => {
    const wanted = scopeKeyOf(directory, path);
    const key = requestToScope.get(wanted) ?? wanted;
    const job = jobs.get(key);
    if (!job) {
      // No job yet: the scope may be inside its pre-job checks, so the
      // intent is recorded for the next ensureIndex instead of reporting
      // idle while a refused build starts anyway. The return shape is
      // unchanged: callers learn the terminal state from the next read.
      rememberPendingCancel(key);
      return { cancelled: false, state: 'idle' };
    }
    job.cancelRequested = true;
    emitProgress(job.directory, { state: 'cancelled' });
    return { cancelled: true, state: job.state };
  };

  /** Blocking build for callers that must have a graph (tests, CLI, warmers). */
  const awaitIndex = async (directory, options = {}) => {
    const { entry } = await ensureIndex(directory, { ...options, block: true });
    const engine = await loadEngine();
    return { ...freshnessFields({ ...entry, staleAfterMs: engine.STALE_AFTER_MS }), ready: true };
  };

  /**
   * Observable index state for one directory, without starting or waiting.
   * Synchronous like the cancel path: the scope resolves through the alias
   * recorded by the last read, falling back to the directory itself (which
   * is the scope key in directory mode and before any read in auto mode).
   */
  const indexState = (directory) => {
    const wanted = scopeKeyOf(directory, path);
    const key = requestToScope.get(wanted) ?? wanted;
    const job = jobs.get(key);
    if (job) return jobFacts(job);
    const entry = snapshots.get(key);
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
        scopeRoot: entry.scope?.scopeRoot ?? null,
        scopeMode: entry.scope?.scopeMode ?? null,
      };
    }
    return { state: 'not-indexed', startedAtMs: null, progress: null, cancelRequested: false, error: null };
  };

  /**
   * Publishes an already-built snapshot (the persisted-generation load path),
   * so a warm open serves a graph without rebuilding it.
   */
  const seedSnapshot = (directory, entry) => {
    const key = entry?.scope?.scopeRoot ? scopeKeyOf(entry.scope.scopeRoot, path) : scopeKeyOf(directory, path);
    rememberScopeAlias(scopeKeyOf(directory, path), key);
    retainSnapshot(key, entry);
    buildSeq = Math.max(buildSeq, Number(entry.buildSeq) || 0);
    emitProgress(key, {
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
      truncationReason: entry.truncationReason ?? null,
      excludedCount: entry.excludedCount ?? 0,
      excludedSample: entry.excludedSample ?? [],
      scopeRoot: entry.scope?.scopeRoot ?? null,
      scopeMode: entry.scope?.scopeMode ?? null,
      metrics: entry.metrics ?? null,
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

  const indexExclusionNote = (entry) => {
    const reason = entry.truncationReason ? ` (${entry.truncationReason})` : '';
    return `index incomplete: ${entry.excludedCount ?? 0} files excluded by the entry cap (${entry.entryCap ?? defaultMaxEntryFiles} max)${reason}`;
  };

  // A kind that cannot see the excluded files must not claim `indexed`
  // when the index itself is incomplete: downgrade to `partial` and name
  // the exclusion count once, and never report a whole-index `complete`
  // (or a cut-only `truncated`) when the index is cut — the index reason
  // outranks them, mirroring the engine's own `decideCompleteness` order.
  // An already-`partial` answer keeps its own cut and gains the same
  // note; `unindexed` stays as-is (still carrying the index facts) since
  // it never claimed completeness.
  const applyUnreadableCoverage = (envelope, entry) => {
    const unreadable = entry.coverage?.unreadableDirs;
    const unreadableFiles = entry.coverage?.unreadableFiles;
    const fileCount = Number.isFinite(entry.coverage?.unreadableFileCount)
      ? entry.coverage.unreadableFileCount
      : (Array.isArray(unreadableFiles) ? unreadableFiles.length : 0);
    const hasDirs = Array.isArray(unreadable) && unreadable.length > 0;
    const hasFiles = Array.isArray(unreadableFiles) && unreadableFiles.length > 0;
    if (!hasDirs && !hasFiles) return envelope;
    if (envelope.coverage !== 'indexed' && envelope.coverage !== 'partial') return envelope;
    const unresolved = Array.isArray(envelope.unresolved) ? envelope.unresolved : [];
    const notes = [];
    if (hasDirs) notes.push(`walk could not read ${unreadable.length} directorie(s): ${unreadable.join(', ')}`);
    if (hasFiles) notes.push(`${fileCount} file(s) unreadable: ${unreadableFiles.join(', ')}`);
    const next = {
      ...envelope,
      unresolved: [...unresolved],
    };
    const kinds = notes.map((note) => (note.startsWith('walk could not read') ? 'walk could not read' : 'file(s) unreadable'));
    notes.forEach((note, index) => {
      if (!next.unresolved.some((line) => typeof line === 'string' && line.includes(kinds[index]))) next.unresolved.push(note);
    });
    if (next.coverage === 'indexed') next.coverage = 'partial';
    if (next.completeness === 'complete' || next.completeness === 'truncated') {
      next.completeness = 'partial';
      next.completenessReason = hasFiles ? 'unreadable-files' : 'unreadable-dirs';
    }
    return next;
  };

  const applyIndexCoverage = (envelope, entry) => {
    if (!entry.indexTruncated) return applyUnreadableCoverage(envelope, entry);
    if (envelope.coverage !== 'indexed' && envelope.coverage !== 'partial') return applyUnreadableCoverage(envelope, entry);
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
    return applyUnreadableCoverage(next, entry);
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
        scopeRoot: outcome.scopeRoot ?? null,
        scopeMode: outcome.scopeMode ?? null,
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
      // Internal build telemetry for tests and diagnostics (files reused
      // versus reanalyzed); the panel renders counts, never this object.
      incremental: entry.incremental ?? null,
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
    // An unreadable directory means the module buckets are floors: the
    // answer reports partial with the same note the query path attaches,
    // never a complete graph over a tree the walk could not see.
    const unreadable = unreadableDirs.length > 0;
    return {
      ...base,
      coverage: unreadable ? 'partial' : 'indexed',
      truncated: modules.length > limit,
      knowledgeIds: [],
      unresolved,
      unsupported: [],
      items: [],
      modules: limited,
      totals: { displayed: limited.length, known: modules.length, hidden: modules.length - limited.length },
      completeness: unreadable ? 'partial' : 'complete',
      ...(unreadable ? { completenessReason: 'unreadable-dirs' } : {}),
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
    const outcome = await ensureIndex(directory, { refresh: input.refresh === true, block: blockOnRead, scopeMode: input.scopeMode ?? 'auto' });
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
    const stored = snapshots.get(outcome.scopeKey ?? scopeKeyOf(directory, path));
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

  const resolveFile = async (directory, file, { scopeMode = 'auto' } = {}) => {
    const raw = isString(file) ? file.trim() : '';
    if (raw.length === 0) {
      return { ok: false, reason: 'missing-file-id' };
    }
    const relative = raw;
    const outcome = await ensureIndex(directory, { block: blockOnRead, scopeMode });
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
    listEntryFiles: (directory, maxEntryFiles, walkOptions) => listEntryFiles(directory, maxEntryFiles, walkOptions),
    resolveIndexScope: (directory, mode) => resolveIndexScope({ fsPromises, path }, directory, mode),
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
