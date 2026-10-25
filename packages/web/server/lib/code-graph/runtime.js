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
 * `STALE_AFTER_MS`. A moved HEAD (or changed content binding) rebuilds;
 * a failed rebuild keeps serving the last snapshot but flags it `stale`
 * with the reason and the refresh error attached, so the panel can offer
 * a refresh instead of showing data as current. With no snapshot at all,
 * the failure throws and the route answers 503 — never a fake empty.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

let enginePromise = null;

/** Lazy so a checkout without a resolvable engine fails per request, never at server startup. */
const loadEngine = () => {
  if (!enginePromise) {
    enginePromise = import('./code-graph.bundle.js');
  }
  return enginePromise;
};

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

const runGitHead = (directory) => new Promise((resolve) => {
  execFile('git', ['-C', directory, 'rev-parse', 'HEAD'], { timeout: 10000 }, (error, stdout) => {
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

export const createCodeGraphRuntime = ({ fsPromises, path }, runtimeOptions = {}) => {
  if (!fsPromises || !path) {
    throw new Error('code-graph runtime requires fsPromises and path');
  }
  const defaultMaxEntryFiles = resolveMaxEntryFiles(runtimeOptions.maxEntryFiles);
  const readGitHead = createGitHeadReader({ fsPromises, path });
  let buildSeq = 0;

  /** Distinct query answers kept per snapshot build; FIFO-evicted, never shared across builds. */
  const MAX_CACHED_QUERIES = 200;

  /** Normalized directory -> cached snapshot entry. Project isolation is the key. */
  const snapshots = new Map();

  const normalizeDirectory = async (directory) => {
    const trimmed = typeof directory === 'string' ? directory.trim() : '';
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
  const listEntryFiles = async (directory, maxEntryFiles) => {
    const cap = resolveMaxEntryFiles(maxEntryFiles ?? defaultMaxEntryFiles);
    const entries = [];
    let scanned = 0;
    let excludedCount = 0;
    const excludedSample = [];
    const visit = async (dir) => {
      let names = [];
      try {
        names = await fsPromises.readdir(dir);
      } catch {
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
          if (SKIPPED_DIRS.has(name)) continue;
          await visit(full);
        } else if (stat.isFile()) {
          scanned += 1;
          if (!ENTRY_FILE.test(name)) continue;
          if (entries.length >= cap) {
            excludedCount += 1;
            if (excludedSample.length < MAX_EXCLUDED_SAMPLE) {
              excludedSample.push(path.relative(directory, full).split(path.sep).join('/'));
            }
            continue;
          }
          entries.push(full);
        }
      }
    };
    await visit(directory);
    entries.sort();
    return { entries, scanned, truncated: excludedCount > 0, excludedCount, excludedSample, maxEntryFiles: cap };
  };

  /**
   * Revision binding: the git HEAD when the directory is a checkout,
   * otherwise a content hash of the entry listing. Both are 40-hex, and
   * either changes when the tree does, so a moved HEAD (or an edited file
   * outside git) rebuilds instead of serving stale refs.
   */
  const readRevision = async (directory, entryFiles) => {
    const local = await readGitHead(directory);
    if (local.status === 'ok') return { revision: local.head, binding: 'git-head' };
    if (local.status === 'unreadable') {
      // Git metadata exists but the files could not be parsed: keep the old
      // subprocess as a last resort instead of silently rebinding content.
      const head = await runGitHead(directory);
      if (head) return { revision: head, binding: 'git-head' };
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

  const buildSnapshot = async (directory, maxEntryFiles) => {
    const engine = await loadEngine();
    const { entries, truncated, excludedCount, excludedSample, maxEntryFiles: cap } = await listEntryFiles(directory, maxEntryFiles);
    const { revision, binding } = await readRevision(directory, entries);
    const { projectId, worktreeId } = deriveScopeIds(directory);
    const fingerprint = engine.computeScopeFingerprint(projectId, worktreeId, revision);
    const snapshot = engine.indexFiles(entries);
    buildSeq += 1;
    return {
      snapshot,
      scope: { projectId, worktreeId, revision, fingerprint },
      observedAtMs: Date.now(),
      binding,
      truncated,
      indexTruncated: truncated,
      excludedCount,
      excludedSample,
      entryCap: cap,
      entryCount: entries.length,
      entryFiles: entries,
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
  };

  const ensureIndex = async (directory, { refresh = false, maxEntryFiles } = {}) => {
    const engine = await loadEngine();
    const cap = resolveMaxEntryFiles(maxEntryFiles ?? defaultMaxEntryFiles);
    const cached = snapshots.get(directory);
    if (!refresh && cached && cached.entryCap === cap) {
      const { revision } = await readRevision(directory, cached.entryFiles ?? []);
      if (revision === cached.scope.revision && Date.now() - cached.observedAtMs <= engine.STALE_AFTER_MS) {
        const { entryFiles: _droppedFiles, queryCache: _droppedCache, ...served } = cached;
        return { ...served, freshness: 'fresh' };
      }
    }
    try {
      const entry = await buildSnapshot(directory, cap);
      snapshots.set(directory, entry);
      const { entryFiles: _droppedFiles, queryCache: _droppedCache, ...served } = entry;
      return { ...served, freshness: 'fresh' };
    } catch (error) {
      if (cached) {
        const { revision } = await readRevision(directory, cached.entryFiles ?? []).catch(() => ({ revision: null }));
        const { entryFiles: _droppedFiles, queryCache: _droppedCache, ...served } = cached;
        return {
          ...served,
          freshness: 'stale',
          staleReason: revision && revision !== cached.scope.revision ? 'HEAD-MOVE' : 'EVID-STALE',
          refreshError: error instanceof Error ? error.message : String(error),
        };
      }
      throw error;
    }
  };

  // Index-level facts ride every envelope under their own names, never as
  // `truncated`: that field belongs to the kind's own result cut, so a
  // complete answer (one exact symbol, a two-hop trace) is not misread as
  // a cut index. `coverage: indexed` would lie the same way, so the query
  // path downgrades it to `partial` with a note naming the exclusion count.
  const freshnessFields = (entry) => ({
    projectId: entry.scope.projectId,
    worktreeId: entry.scope.worktreeId,
    revision: entry.scope.revision,
    fingerprint: entry.scope.fingerprint,
    freshness: entry.freshness,
    observedAtMs: entry.observedAtMs,
    staleAfterMs: entry.staleAfterMs,
    ...(entry.staleReason ? { staleReason: entry.staleReason } : {}),
    ...(entry.refreshError ? { refreshError: entry.refreshError } : {}),
    indexTruncated: entry.indexTruncated === true,
    excludedCount: entry.excludedCount ?? 0,
    excludedSample: entry.excludedSample ?? [],
  });

  const indexExclusionNote = (entry) =>
    `index incomplete: ${entry.excludedCount ?? 0} files excluded by the entry cap (${entry.entryCap ?? defaultMaxEntryFiles} max)`;

  // A kind that cannot see the excluded files must not claim `indexed`
  // when the index itself is incomplete: downgrade to `partial` and name
  // the exclusion count once. An already-`partial` answer keeps its own cut
  // and gains the same note; `unindexed` stays as-is (still carrying the
  // index facts) since it never claimed completeness.
  const applyIndexCoverage = (envelope, entry) => {
    if (!entry.indexTruncated) return envelope;
    const note = indexExclusionNote(entry);
    const unresolved = Array.isArray(envelope.unresolved) ? envelope.unresolved : [];
    if (envelope.coverage === 'indexed') {
      return { ...envelope, coverage: 'partial', unresolved: [...unresolved, note] };
    }
    if (envelope.coverage === 'partial' && !unresolved.some((line) => line.includes('index incomplete'))) {
      return { ...envelope, unresolved: [...unresolved, note] };
    }
    return envelope;
  };

  const readIndex = async (directory, options = {}) => {
    const engine = await loadEngine();
    const entry = await ensureIndex(directory, options);
    const fields = freshnessFields({ ...entry, staleAfterMs: engine.STALE_AFTER_MS });
    return {
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
      // Published generation: monotonic per rebuild of this directory, so a client
      // can tell one snapshot from the next and never mix their rows.
      generation: entry.buildSeq,
    };
  };

  /**
   * Snapshot ids are rooted at the entry list's common directory, not the
   * project root, so a repo-relative file id can miss an indexed file. A
   * unique suffix match resolves it; ambiguity or no match answers null and
   * the caller stays unindexed instead of guessing.
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
    const toItem = (node, evidence) => ({
      id: node.id,
      file: node.file,
      line: node.line,
      ...(node.name === undefined ? {} : { name: node.name }),
      evidence,
      confidence: 1,
      knowledgeIds: knowledgeByNode.get(node.id) ?? [],
    });
    const items = [];
    for (const edge of snapshot.edges) {
      if (edge.kind !== 'DEFINES' && edge.kind !== 'IMPORTS' && edge.kind !== 'EXPORTS' && edge.kind !== 'TESTS') continue;
      if (edge.from !== resolvedId && edge.to !== resolvedId) continue;
      const otherId = edge.from === resolvedId ? edge.to : edge.from;
      const other = nodeById.get(otherId);
      if (!other) continue;
      items.push(toItem(other, [{ edge: edge.kind, ref: edge.ref, confidence: edge.confidence }]));
    }
    items.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
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
    if (fileNodes.length === 0) {
      return {
        ...base,
        coverage: 'unindexed',
        truncated: false,
        knowledgeIds: [],
        unresolved: ['empty index: no files in this snapshot'],
        unsupported: [],
        items: [],
        modules: [],
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
    const names = [...fileIdsByBucket.keys()].sort();
    const modules = names.map((name) => {
      const fileIds = fileIdsByBucket.get(name);
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
        sampleSymbols: symbols.slice(0, 5).map((node) => ({
          id: node.id,
          ...(node.name === undefined ? {} : { name: node.name }),
          file: node.file,
          line: node.line,
        })),
      };
    });
    const limited = modules.slice(0, limit);
    return {
      ...base,
      coverage: 'indexed',
      truncated: modules.length > limit,
      knowledgeIds: [],
      unresolved: modules.length > limit ? [`truncated to ${limit} of ${modules.length} modules`] : [],
      unsupported: [],
      items: [],
      modules: limited,
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
      return {
        id: node.id,
        kind: node.kind,
        subject: id === subjectId,
        ...(node.name === undefined ? {} : { name: node.name }),
        ...(node.file === undefined ? {} : { file: node.file }),
        ...(node.line === undefined ? {} : { line: node.line }),
      };
    });
    return { subjectId, nodes, edges, truncated };
  };

  const query = async (directory, input = {}) => {
    const engine = await loadEngine();
    const kind = input.kind;
    const limit = input.limit === undefined ? 20 : Math.min(50, Math.max(1, Math.floor(input.limit)));
    const entry = await ensureIndex(directory, { refresh: input.refresh === true });
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
    ]);
    const stored = snapshots.get(directory);
    const queryCache = stored && stored.buildSeq === entry.buildSeq && stored.queryCache instanceof Map
      ? stored.queryCache
      : null;
    const cachedAnswer = queryCache?.get(cacheKey);
    if (cachedAnswer !== undefined) return cachedAnswer;
    const options = { scope: entry.scope, freshness: entry.freshness, limit };
    let envelope = null;
    if (kind === 'context') {
      if (!input.symbol) return { error: 'symbol is required for kind=context', status: 400 };
      envelope = engine.symbolContext(entry.snapshot, input.symbol, options);
    } else if (kind === 'impact') {
      if (!input.symbol) return { error: 'symbol is required for kind=impact', status: 400 };
      envelope = engine.impact(entry.snapshot, input.symbol, options);
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
      envelope = engine.trace(entry.snapshot, input.from, input.to, options);
    } else if (kind === 'content') {
      if (!input.query) return { error: 'query is required for kind=content', status: 400 };
      // Source-text search runs over the extraction-time content index: no
      // filesystem read happens inside this call, which is what makes it safe
      // to answer a text query on every keystroke.
      envelope = engine.searchContent(entry.snapshot, input.query, {
        limit,
        ...(input.pathPrefix === undefined ? {} : { pathPrefix: String(input.pathPrefix) }),
        ...(input.language === undefined ? {} : { language: String(input.language) }),
        ...(input.contentKind === 'test' || input.contentKind === 'source' ? { kind: input.contentKind } : {}),
        ...(input.directory === undefined ? {} : { directory: String(input.directory) }),
      });
    } else {
      return { error: 'kind must be context, impact, search, content, tests, file, explore, or trace', status: 400 };
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
      ...(graph === null ? {} : { graph }),
      snapshotRoot: entry.snapshot.root ?? null,
      ...freshnessFields({ ...entry, staleAfterMs: engine.STALE_AFTER_MS }),
    };
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
    const raw = typeof file === 'string' ? file.trim() : '';
    if (raw.length === 0) {
      return { ok: false, reason: 'missing-file-id' };
    }
    const relative = raw;
    const entry = await ensureIndex(directory, {});
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
  };
};
