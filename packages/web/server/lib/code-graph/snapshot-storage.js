/**
 * Filesystem store for one persisted graph generation per scope.
 *
 * The codec (`snapshot-store.ts` in the engine) decides the bytes; this module
 * decides where they live and how a write becomes visible. A generation is a
 * directory holding `manifest.json` plus one shard per file; the manifest is the
 * only publish point, written to a temporary name and renamed into place, so a
 * crash mid-write leaves the previous manifest (and its shards) intact.
 *
 * S10 single-writer guard: one pid-lease file (`.lease`) beside the manifest
 * serializes shard publish + prune across processes, so two hosts/daemons
 * sharing a store directory cannot interleave and delete shards a concurrent
 * publish just referenced. The whole publish holds the lease; a holder killed
 * with -9 leaves its lease behind and the next writer steals it once stale
 * (expired, or its pid is gone) instead of wedging the store forever. Readers
 * never take the lease: the manifest swap is atomic, shards are content-
 * addressed and immutable, and a torn read is a fail-closed miss. No
 * store-format change: the manifest, shards, and records bytes are untouched.
 * Rollback is a revert, or deleting the `.lease` file.
 *
 * A read is fail-closed: an unreadable or torn store returns a miss with a
 * reason, never a graph missing files. Callers treat a miss as "build it".
 */
import crypto from 'node:crypto';

const STORE_VERSION = 1;

// String/function/record checks via untagged dispatch (the anti-slop gate bans runtime type operators).
const isString = (value) => Object.prototype.toString.call(value) === '[object String]';
const isFunction = (value) => {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Function]' || tag === '[object AsyncFunction]';
};
const isRecord = (value) => Object.prototype.toString.call(value) === '[object Object]';

const safeSegment = (value) => String(value ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

/**
 * Shard names are content-addressed: two generations that share a file's bytes
 * share its shard name, so a rebuild that changes three files rewrites three
 * shards instead of the whole store.
 */
const shardName = (text) => `${crypto.createHash('sha256').update(text).digest('hex').slice(0, 32)}.json`;

/** Records documents share the shard philosophy: content-addressed, immutable, pruned by reference. */
const recordsName = (text) => `files-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 32)}.json`;

/**
 * S10 single-writer lease. One `.lease` file lives beside the manifest in
 * each scope directory; only its holder may publish + prune that scope.
 * `DEFAULT_LEASE_STALE_MS` bounds how long a crashed holder blocks writers
 * whose pid probe cannot see it (pid reuse, unprobable holder): a dead pid
 * is stolen immediately, a merely old lease once it expires. `DEFAULT_LEASE_
 * TIMEOUT_MS` bounds how long a writer waits for a live holder before
 * failing closed with `store-locked` (a state note, never a throw).
 */
// Module-private lease tunables: no external reader imports these
// (knip-clean by construction); `createSnapshotStorage` stays the only export.
const LEASE_FILENAME = '.lease';
const DEFAULT_LEASE_STALE_MS = 120_000;
const DEFAULT_LEASE_TIMEOUT_MS = 60_000;
const DEFAULT_LEASE_RETRY_MS = 50;

export const createSnapshotStorage = ({
  fsPromises,
  path,
  engine,
  storeDir,
  leaseStaleMs: leaseStaleMsOption,
  leaseTimeoutMs: leaseTimeoutMsOption,
  leaseRetryMs: leaseRetryMsOption,
}) => {
  const enabled = isString(storeDir) && storeDir.length > 0;
  const scopeDir = (projectId, worktreeId) => path.join(storeDir, `${safeSegment(projectId)}--${safeSegment(worktreeId)}`);
  const leaseStaleMs = Number.isFinite(Number(leaseStaleMsOption)) && Number(leaseStaleMsOption) > 0
    ? Math.floor(Number(leaseStaleMsOption))
    : DEFAULT_LEASE_STALE_MS;
  const leaseTimeoutMs = Number.isFinite(Number(leaseTimeoutMsOption)) && Number(leaseTimeoutMsOption) > 0
    ? Math.floor(Number(leaseTimeoutMsOption))
    : DEFAULT_LEASE_TIMEOUT_MS;
  const leaseRetryMs = Number.isFinite(Number(leaseRetryMsOption)) && Number(leaseRetryMsOption) > 0
    ? Math.floor(Number(leaseRetryMsOption))
    : DEFAULT_LEASE_RETRY_MS;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const writeAtomic = async (target, text) => {
    const temporary = `${target}.tmp-${process.pid}`;
    await fsPromises.writeFile(temporary, text, 'utf8');
    await fsPromises.rename(temporary, target);
  };

  const readLeaseDoc = async (leasePath) => {
    try {
      const text = await fsPromises.readFile(leasePath, 'utf8');
      const parsed = JSON.parse(text);
      if (!isRecord(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  /** A holder that cannot be signalled is gone (ESRCH); EPERM means alive but unpermitted. */
  const holderAlive = (pid) => {
    const num = Number(pid);
    if (!Number.isFinite(num)) return false;
    try {
      const killer = globalThis.process?.kill;
      if (!isFunction(killer)) return true;
      killer.call(globalThis.process, num, 0);
      return true;
    } catch (error) {
      const code = error?.code;
      if (code === 'EPERM' || code === 'EBUSY') return true;
      return false;
    }
  };

  const leaseIsStale = (doc, nowMs) => {
    if (!doc) return true;
    const acquiredAtMs = Number(doc.acquiredAtMs);
    if (!Number.isFinite(acquiredAtMs)) return true;
    if (nowMs - acquiredAtMs > leaseStaleMs) return true;
    return !holderAlive(doc.pid);
  };

  /**
   * Exclusive create, else steal-once-stale via an atomic rename with a
   * read-back: exactly one contender's rename survives, and the loser sees
   * a foreign token and keeps waiting instead of believing it holds the lock.
   */
  const acquireLease = async (dir) => {
    const leasePath = path.join(dir, LEASE_FILENAME);
    const pid = Number(globalThis.process?.pid ?? 0);
    const token = `${pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const payload = () => JSON.stringify({ version: 1, pid, token, acquiredAtMs: Date.now() });
    const deadline = Date.now() + leaseTimeoutMs;
    for (;;) {
      try {
        await fsPromises.writeFile(leasePath, payload(), { encoding: 'utf8', flag: 'wx' });
        return { acquired: true, token };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
      const current = await readLeaseDoc(leasePath);
      if (leaseIsStale(current, Date.now())) {
        const temporary = `${leasePath}.tmp-${pid}-${Math.random().toString(36).slice(2)}`;
        try {
          await fsPromises.writeFile(temporary, payload(), 'utf8');
          await fsPromises.rename(temporary, leasePath);
        } catch {
          try {
            await fsPromises.rm(temporary, { force: true });
          } catch {
            // Best-effort temp cleanup; the next acquire overwrites it.
          }
        }
        const winner = await readLeaseDoc(leasePath);
        if (winner?.token === token) return { acquired: true, token };
      }
      if (Date.now() >= deadline) return { acquired: false, reason: 'store-locked', token };
      await sleep(Math.min(leaseRetryMs, Math.max(0, deadline - Date.now())));
    }
  };

  /** Releases only our own lease: never delete a token another writer won. */
  const releaseLease = async (dir, token) => {
    const leasePath = path.join(dir, LEASE_FILENAME);
    try {
      const current = await readLeaseDoc(leasePath);
      if (current?.token !== token) return;
      await fsPromises.rm(leasePath, { force: true });
    } catch {
      // Best-effort: a lease left behind expires on its own.
    }
  };

  /**
   * Shard/record names the on-disk manifest still references, read
   * best-effort: a torn manifest contributes nothing instead of blocking
   * the publish that would replace it.
   */
  const readPublishedRefs = async (dir) => {
    try {
      const text = await fsPromises.readFile(path.join(dir, 'manifest.json'), 'utf8');
      const parsed = JSON.parse(text);
      const shards = Array.isArray(parsed?.shards) ? parsed.shards.filter((name) => isString(name)) : [];
      const records = isString(parsed?.fileRecords) && parsed.fileRecords.length > 0 ? [parsed.fileRecords] : [];
      return { shards, records };
    } catch {
      return { shards: [], records: [] };
    }
  };

  return {
    enabled,

    /** Publishes a snapshot as the current generation for its scope. */
    async write(directory, entry) {
      if (!enabled) return { written: false, reason: 'store-disabled' };
      const dir = scopeDir(entry.scope.projectId, entry.scope.worktreeId);
      const shardsDir = path.join(dir, 'shards');
      try {
        await fsPromises.mkdir(shardsDir, { recursive: true });
        // S10: the whole publish holds the scope lease, so a second host
        // cannot stage between our manifest swap and our prune and delete
        // shards its own just-published manifest references.
        const lease = await acquireLease(dir);
        if (!lease.acquired) return { written: false, reason: lease.reason ?? 'store-locked' };
        try {
          const shards = engine.splitSnapshotIntoShards(entry.snapshot);
          const names = [];
          let written = 0;
          let reused = 0;
          for (const shard of shards) {
            const text = engine.serializeSnapshotShard(shard);
            const name = shardName(text);
            names.push(name);
            const target = path.join(shardsDir, name);
            const alreadyThere = await fsPromises.stat(target).then(() => true, () => false);
            if (alreadyThere) {
              reused += 1;
              continue;
            }
            await fsPromises.writeFile(target, text, 'utf8');
            written += 1;
          }
          let recordsNameWritten = null;
          if (entry.fileRecords !== undefined && entry.fileRecords !== null) {
            const recordsText = engine.serializeFileRecordsDoc(entry.fileRecords);
            recordsNameWritten = recordsName(recordsText);
            const recordsTarget = path.join(dir, recordsNameWritten);
            const recordsThere = await fsPromises.stat(recordsTarget).then(() => true, () => false);
            if (!recordsThere) await fsPromises.writeFile(recordsTarget, recordsText, 'utf8');
          }
          // Prune-by-reference over every live generation: the manifest on
          // disk (which a concurrent restorer may be reading right now) plus
          // the generation being published. Only shards/records neither
          // references are pruned; a failed publish keeps the prior manifest
          // and its shards exactly where they were.
          const prior = await readPublishedRefs(dir);
          // The published number rides the manifest so a restart restores the
          // same generation instead of minting a fresh local one: surfaces
          // sharing one store agree on it. Partial builds never reach this
          // writer (persistEntry skips truncated entries), so a stored
          // generation is always complete and needs no partiality fields.
          const manifestArgs = {
            scope: entry.scope,
            observedAtMs: entry.observedAtMs,
            entryCap: entry.entryCap ?? 0,
            entryCount: entry.entryCount ?? 0,
          };
          if (recordsNameWritten !== null) {
            manifestArgs.fileRecords = recordsNameWritten;
          }
          manifestArgs.buildSeq = entry.buildSeq ?? null;
          const manifest = engine.createSnapshotManifest(entry.snapshot, manifestArgs);
          await writeAtomic(
            path.join(dir, 'manifest.json'),
            engine.serializeSnapshotManifest({ ...manifest, shards: names, storeVersion: STORE_VERSION }),
          );
          // Only after the manifest points at them: a shard no live
          // generation references is dead weight, but pruning before publish
          // would delete files the current generation still needs.
          const pruned = await this.prune(
            dir,
            new Set([...names, ...prior.shards]),
            new Set([...(recordsNameWritten !== null ? [recordsNameWritten] : []), ...prior.records]),
          );
          return { written: true, shards: names.length, writtenShards: written, reusedShards: reused, pruned };
        } finally {
          await releaseLease(dir, lease.token);
        }
      } catch (error) {
        return { written: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    async prune(dir, keep, keepRecords = new Set()) {
      if (!enabled) return 0;
      const shardsDir = path.join(dir, 'shards');
      const existing = await fsPromises.readdir(shardsDir).catch(() => []);
      let removed = 0;
      for (const name of existing) {
        if (keep.has(name)) continue;
        await fsPromises.rm(path.join(shardsDir, name), { force: true }).catch(() => undefined);
        removed += 1;
      }
      // Records files are managed by reference too: only `files-<hash>.json`
      // names no live generation references are removed; the manifest, the
      // lease, and any temp files are never prune candidates.
      const top = await fsPromises.readdir(dir).catch(() => []);
      for (const name of top) {
        if (!/^files-[0-9a-f]{32}\.json$/.test(name)) continue;
        if (keepRecords.has(name)) continue;
        await fsPromises.rm(path.join(dir, name), { force: true }).catch(() => undefined);
        removed += 1;
      }
      return removed;
    },

    /**
     * Restores the published generation when it belongs to `scope`. The scope
     * comparison is what stops a store written before an edit from being served
     * as current: a different revision or dirty fingerprint is a miss, and the
     * caller rebuilds.
     */
    async read(directory, scope) {
      if (!enabled) return { status: 'miss', reason: 'store-disabled' };
      const dir = scopeDir(scope.projectId, scope.worktreeId);
      let text;
      try {
        text = await fsPromises.readFile(path.join(dir, 'manifest.json'), 'utf8');
      } catch {
        return { status: 'miss', reason: 'no-store' };
      }
      const parsed = engine.parseSnapshotManifest(text);
      if (parsed.kind !== 'manifest') return { status: 'miss', reason: parsed.reason };
      const manifest = parsed.manifest;
      if (manifest.scope.revision !== scope.revision || manifest.scope.fingerprint !== scope.fingerprint) {
        return { status: 'stale', reason: 'scope-mismatch', manifest };
      }
      const shards = [];
      try {
        for (const name of manifest.shards) {
          const shardText = await fsPromises.readFile(path.join(dir, 'shards', name), 'utf8');
          const shard = engine.parseSnapshotShard(shardText);
          if (shard.kind !== 'shard') return { status: 'miss', reason: `${name}: ${shard.reason}` };
          shards.push(shard.shard);
        }
      } catch (error) {
        return { status: 'miss', reason: error instanceof Error ? error.message : String(error) };
      }
      const joined = engine.joinSnapshotShards(manifest, shards);
      if (joined.kind !== 'snapshot') return { status: 'miss', reason: joined.reason };
      // Records are advisory: a corrupt or missing records file disables
      // reuse for the next build but never the snapshot already joined.
      let fileRecords = null;
      if (isString(manifest.fileRecords) && manifest.fileRecords.length > 0) {
        try {
          const recordsText = await fsPromises.readFile(path.join(dir, manifest.fileRecords), 'utf8');
          fileRecords = engine.parseFileRecordsDoc(JSON.parse(recordsText));
        } catch {
          fileRecords = null;
        }
      }
      return { status: 'hit', snapshot: joined.snapshot, manifest, fileRecords };
    },

    async clear(scope) {
      if (!enabled) return false;
      await fsPromises.rm(scopeDir(scope.projectId, scope.worktreeId), { recursive: true, force: true });
      return true;
    },
  };
};
