/**
 * Filesystem store for one persisted graph generation per scope.
 *
 * The codec (`snapshot-store.ts` in the engine) decides the bytes; this module
 * decides where they live and how a write becomes visible. A generation is a
 * directory holding `manifest.json` plus one shard per file; the manifest is the
 * only publish point, written to a temporary name and renamed into place, so a
 * crash mid-write leaves the previous manifest (and its shards) intact.
 *
 * A read is fail-closed: an unreadable or torn store returns a miss with a
 * reason, never a graph missing files. Callers treat a miss as "build it".
 */
import crypto from 'node:crypto';

const STORE_VERSION = 1;

const safeSegment = (value) => String(value ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);

/**
 * Shard names are content-addressed: two generations that share a file's bytes
 * share its shard name, so a rebuild that changes three files rewrites three
 * shards instead of the whole store.
 */
const shardName = (text) => `${crypto.createHash('sha256').update(text).digest('hex').slice(0, 32)}.json`;

export const createSnapshotStorage = ({ fsPromises, path, engine, storeDir }) => {
  const enabled = typeof storeDir === 'string' && storeDir.length > 0;
  const scopeDir = (projectId, worktreeId) => path.join(storeDir, `${safeSegment(projectId)}--${safeSegment(worktreeId)}`);

  const writeAtomic = async (target, text) => {
    const temporary = `${target}.tmp-${process.pid}`;
    await fsPromises.writeFile(temporary, text, 'utf8');
    await fsPromises.rename(temporary, target);
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
        const manifest = engine.createSnapshotManifest(entry.snapshot, {
          scope: entry.scope,
          observedAtMs: entry.observedAtMs,
          entryCap: entry.entryCap ?? 0,
          entryCount: entry.entryCount ?? 0,
        });
        await writeAtomic(
          path.join(dir, 'manifest.json'),
          engine.serializeSnapshotManifest({ ...manifest, shards: names, storeVersion: STORE_VERSION }),
        );
        // Only after the manifest points at them: a shard no generation
        // references is dead weight, but pruning before publish would delete
        // files the current generation still needs.
        await this.prune(dir, new Set(names));
        return { written: true, shards: names.length, writtenShards: written, reusedShards: reused };
      } catch (error) {
        return { written: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    async prune(dir, keep) {
      if (!enabled) return 0;
      const shardsDir = path.join(dir, 'shards');
      const existing = await fsPromises.readdir(shardsDir).catch(() => []);
      let removed = 0;
      for (const name of existing) {
        if (keep.has(name)) continue;
        await fsPromises.rm(path.join(shardsDir, name), { force: true }).catch(() => undefined);
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
      return { status: 'hit', snapshot: joined.snapshot, manifest };
    },

    async clear(scope) {
      if (!enabled) return false;
      await fsPromises.rm(scopeDir(scope.projectId, scope.worktreeId), { recursive: true, force: true });
      return true;
    },
  };
};
