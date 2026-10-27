/**
 * Snapshot store: a persisted graph must come back exactly as built.
 *
 * Every case drives the real compiler over the co-located fixture, so the
 * round-trip is proven on ids that carry line numbers, on edges whose owner file
 * is derived from those ids, and on the content index `searchContent` reads —
 * the three things the baseline store cannot represent.
 */
import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexFiles } from "./extract";
import { searchContent } from "./schema";
import {
  SNAPSHOT_STORE_VERSION,
  createSnapshotManifest,
  joinSnapshotShards,
  parseSnapshotManifest,
  parseSnapshotShard,
  serializeSnapshotManifest,
  serializeSnapshotShard,
  splitSnapshotIntoShards,
} from "./snapshot-store";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "graph-basic");
const TEST_TIMEOUT_MS = 60000;
const scope = {
  projectId: "demo-12345678",
  worktreeId: "graph-basic",
  revision: "0123456789abcdef0123456789abcdef01234567",
  fingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

const buildSnapshot = () =>
  indexFiles(
    ["main.ts", "math.ts", "reexport.ts", "main.test.ts"].map((name) => join(FIXTURE_DIR, name)),
    { rootDir: FIXTURE_DIR },
  );

const roundTrip = (snapshot: ReturnType<typeof buildSnapshot>) => {
  const shards = splitSnapshotIntoShards(snapshot);
  const manifest = createSnapshotManifest(snapshot, {
    scope,
    observedAtMs: 1_700_000_000_000,
    entryCap: 5000,
    entryCount: 4,
  });
  const parsedManifest = parseSnapshotManifest(serializeSnapshotManifest(manifest));
  expect(parsedManifest.kind).toBe("manifest");
  if (parsedManifest.kind !== "manifest") throw new Error("manifest did not parse");
  const parsedShards = shards.map((shard) => {
    const parsed = parseSnapshotShard(serializeSnapshotShard(shard));
    if (parsed.kind !== "shard") throw new Error(`shard ${shard.file} did not parse: ${parsed.reason}`);
    return parsed.shard;
  });
  return { manifest: parsedManifest.manifest, joined: joinSnapshotShards(parsedManifest.manifest, parsedShards) };
};

describe("snapshot store", () => {
  it(
    "#given a built snapshot #when it is sharded and rejoined #then every node, edge and content entry survives",
    () => {
      const snapshot = buildSnapshot();
      const { manifest, joined } = roundTrip(snapshot);

      expect(manifest.version).toBe(SNAPSHOT_STORE_VERSION);
      expect(manifest.scope.fingerprint).toBe(scope.fingerprint);
      expect(joined.kind).toBe("snapshot");
      if (joined.kind !== "snapshot") throw new Error(joined.reason);

      expect(joined.snapshot.nodes.length).toBe(snapshot.nodes.length);
      expect(joined.snapshot.edges.length).toBe(snapshot.edges.length);
      expect([...joined.snapshot.nodes].map((node) => node.id).sort()).toEqual(
        [...snapshot.nodes].map((node) => node.id).sort(),
      );
      expect([...joined.snapshot.edges].map((edge) => edge.id).sort()).toEqual(
        [...snapshot.edges].map((edge) => edge.id).sort(),
      );
      expect(joined.snapshot.root).toBe(snapshot.root);
      // Line numbers ride the ids the panel opens source with; losing them is
      // exactly what a baseline-shaped store would have cost.
      expect([...joined.snapshot.nodes].every((node) => node.kind === "file" || node.line >= 1)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a restored snapshot #when content search runs #then it finds the same source as the live index",
    () => {
      const snapshot = buildSnapshot();
      const { joined } = roundTrip(snapshot);
      if (joined.kind !== "snapshot") throw new Error(joined.reason);

      const live = searchContent(snapshot, "export", { limit: 5 });
      const restored = searchContent(joined.snapshot, "export", { limit: 5 });

      expect(restored.items.length).toBe(live.items.length);
      expect(restored.items.map((item) => `${item.file}:${item.line}`)).toEqual(
        live.items.map((item) => `${item.file}:${item.line}`),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "#given a store missing a shard #when it is joined #then the tear is reported instead of a partial graph",
    () => {
      const snapshot = buildSnapshot();
      const shards = splitSnapshotIntoShards(snapshot);
      const manifest = createSnapshotManifest(snapshot, {
        scope,
        observedAtMs: 1_700_000_000_000,
        entryCap: 5000,
        entryCount: 4,
      });

      const joined = joinSnapshotShards(manifest, shards.slice(0, -1));

      expect(joined.kind).toBe("torn");
      if (joined.kind === "torn") expect(joined.reason).toContain("shards");
    },
    TEST_TIMEOUT_MS,
  );

  it("#given an unknown manifest version #when it is parsed #then it is refused, never guessed", () => {
    const parsed = parseSnapshotManifest(JSON.stringify({ ...{ version: 99 }, scope }));
    expect(parsed.kind).toBe("corrupt");
  });

  it(
    "#given a shard larger than the argument limit #when it is joined #then it restores instead of throwing",
    () => {
      // A large monorepo's biggest file shard held enough nodes to overflow
      // `push(...nodes)`; the restore then threw, the caller read it as a miss,
      // and the panel rebuilt for minutes while the store looked healthy.
      const nodes = Array.from({ length: 200_000 }, (_, index) => ({
        id: `fn:s${index}@big.ts:${index + 1}`,
        kind: "symbol" as const,
        file: "big.ts",
        line: index + 1,
      }));
      const manifest = createSnapshotManifest(
        { nodes, edges: [], root: "/repo" },
        { scope, observedAtMs: 1_700_000_000_000, entryCap: 5000, entryCount: 1 },
      );
      const shards = splitSnapshotIntoShards({ nodes, edges: [], root: "/repo" });

      const joined = joinSnapshotShards(manifest, shards);

      expect(joined.kind).toBe("snapshot");
      if (joined.kind === "snapshot") expect(joined.snapshot.nodes.length).toBe(200_000);
    },
    TEST_TIMEOUT_MS,
  );
});
