/**
 * Adversarial operations tests C20, C26, C28.
 *
 * Production paths exercised:
 * - C20: deferred to the site lane with reason. This file proves the
 *        deferral at the API level instead of faking it: it inspects the real
 *        dag barrel namespace (`senpi-task/src/dag/index.ts`) and the real
 *        engine file trees, asserting the engine lane exposes no site/HTTP
 *        route surface. HTTP routes live under `packages/web/src/api`
 *        (the site lane), which is outside this task's write scope
 *        (code-graph + senpi-task dag only), so a placeholder-free engine-side
 *        route test cannot exist here.
 * - C26: `code-graph/src/graph.ts` (barrel) #WorktreeGraphCache,
 *        #buildBaselineFromHeadFiles, #serializeIndex, #parseStoredIndex,
 *        #loadOrRebuild — restart revalidation of project/worktree/revision/
 *        fingerprint metadata.
 * - C28: the same cache functions (concurrent overlays over one shared
 *        baseline), `dag/index.ts` #createDagScheduler/#createDagFileStore
 *        (two sessions, one shared store dir), and
 *        `tools/task/execute-spec.ts` #buildStartSpec (context separation).
 *
 * Precedent: `code-graph/src/cache.test.ts` (drop-and-count, scope-keyed
 * storage) and `senpi-task/src/dag/scheduler-conflict.test.ts` (fake manager
 * stands in for child execution only).
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyDirtyOverlay,
  buildBaselineFromHeadFiles,
  computeEntityId,
  computeScopeFingerprint,
  loadOrRebuild,
  parseStoredIndex,
  serializeIndex,
  WorktreeGraphCache,
  type GraphScopeKey,
} from "../../../code-graph/src/graph";
import {
  compileDag,
  createDagFileStore,
  createDagScheduler,
  type DagDefinition,
  type DagNodeInput,
  type DagRunId,
  type DagRunRecordV1,
  type DagTaskOwner,
  type OwnedStartResult,
} from "./index";
import type { ManagerStartSpec, TaskManager } from "../manager/types";
import type { TaskRecord } from "../state";
import {
  buildStartSpec,
  singleSpawnParams,
  taskTargetOf,
} from "../tools/task/execute-spec";
import type { TaskToolDeps } from "../tools/task/types";
import type { OmoConfig } from "../../../omo-config-core/src/index";
import * as dagBarrel from "./index";

setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000);

const PROJECT_A = "demo-12345678";
const PROJECT_B = "other-abcdef12";
const WORKTREE_A = "wt-ops-alpha";
const WORKTREE_B = "wt-ops-beta";
const REVISION_A = "a".repeat(40);
const REVISION_B = "c".repeat(40);
const BLOB_A = "b".repeat(64);
const BLOB_B = "d".repeat(64);
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const cleanupRoots: string[] = [];

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-ops-"));
  cleanupRoots.push(directory);
  return directory;
}

function scopeFor(projectId: string, worktreeId: string, revision: string): GraphScopeKey {
  return {
    projectId,
    worktreeId,
    revision,
    fingerprint: computeScopeFingerprint(projectId, worktreeId, revision),
  };
}

function gatewayFiles(): { path: string; blobSha256: string; symbols: readonly string[] }[] {
  return [
    { path: "src/gateway.ts", blobSha256: BLOB_A, symbols: ["fn:retry"] },
    { path: "src/ledger.ts", blobSha256: BLOB_B, symbols: [] },
  ];
}

function mustBuild(scope: GraphScopeKey) {
  const built = buildBaselineFromHeadFiles(
    scope,
    gatewayFiles(),
    [
      {
        from: computeEntityId(scope.projectId, "src/gateway.ts", "file"),
        to: computeEntityId(scope.projectId, "src/gateway.ts", "fn:retry"),
        kind: "DEFINES",
        confidence: 1,
      },
    ],
    NOW_MS,
  );
  if (built.kind !== "built") throw new Error(`fixture refused: ${built.reason}`);
  return built.baseline;
}

function stubDeps(): TaskToolDeps {
  return {
    omoConfig: { categories: {}, agents: {} } as OmoConfig,
    agents: {},
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }),
  } as unknown as TaskToolDeps;
}

// Compact test-only stand-in for child execution (mirrors scheduler-conflict.test.ts).
class OpsFakeManager implements TaskManager {
  readonly starts: string[] = [];
  readonly #tasks = new Map<string, {
    record: TaskRecord;
    readonly completion: Promise<TaskRecord>;
    readonly resolveCompletion: (record: TaskRecord) => void;
  }>();
  readonly #startedSignals = new Map<string, { resolve: () => void; promise: Promise<void> }>();
  #taskCounter = 0;

  constructor(private readonly sessionId: string) {}

  whenStarted(nodeId: string): Promise<void> {
    let signal = this.#startedSignals.get(nodeId);
    if (signal === undefined) {
      let resolve = (): void => undefined;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      signal = { resolve, promise };
      this.#startedSignals.set(nodeId, signal);
    }
    if (this.starts.includes(nodeId)) signal.resolve();
    return signal.promise;
  }

  residencyChanged(): Promise<void> {
    return new Promise<void>(() => undefined);
  }

  complete(nodeId: string): void {
    const entry = [...this.#tasks.values()].find((candidate) => String(candidate.record.owner?.nodeId) === nodeId);
    if (entry === undefined) throw new Error(`unknown fake task for ${nodeId}`);
    entry.record = { ...entry.record, status: "completed", final_response: `done ${nodeId}` };
    entry.resolveCompletion(entry.record);
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    const nodeId = String(owner.nodeId);
    this.#taskCounter += 1;
    const taskId = `task-${this.sessionId}-${this.#taskCounter}`;
    let resolveCompletion = (_record: TaskRecord): void => undefined;
    const completion = new Promise<TaskRecord>((done) => {
      resolveCompletion = done;
    });
    this.#tasks.set(taskId, {
      record: {
        task_id: taskId,
        name: nodeId,
        parent_session_id: this.sessionId,
        root_session_id: this.sessionId,
        depth: 1,
        category: "quick",
        execution_mode: "in-process",
        model: "fake-model",
        notify_on_terminal: true,
        owner,
        status: "running",
        residency_state: "resident",
        created_at: "2026-10-22T00:00:00.000Z",
        updated_at: "2026-10-22T00:00:00.000Z",
        notification: { run_epoch: 1, notified_epoch: 0 },
      },
      completion,
      resolveCompletion,
    });
    this.starts.push(nodeId);
    this.#startedSignals.get(nodeId)?.resolve();
    return { kind: "started", reused: false, task_id: taskId, status: "running", name: nodeId };
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return [...this.#tasks.values()].find((entry) => String(entry.record.owner?.nodeId) === String(owner.nodeId))?.record;
  }

  waitFor(taskId: string): Promise<TaskRecord> {
    const entry = this.#tasks.get(taskId);
    if (entry === undefined) throw new Error(`unknown fake task ${taskId}`);
    return entry.completion;
  }

  start(): Promise<never> { throw new Error("not implemented"); }
  continueTask(): Promise<never> { throw new Error("not implemented"); }
  sendToTask(): Promise<never> { throw new Error("not implemented"); }
  interruptTask(): Promise<never> { throw new Error("not implemented"); }
  cancelTask(): Promise<never> { throw new Error("not implemented"); }
  list(): readonly [] { return []; }
  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId)?.record;
  }
  forget(): void {}
  getResidentHandle(): undefined { return undefined; }
  subscribeChild(): () => void { return () => undefined; }
  residentTaskIds(): readonly string[] { return []; }
  promoteToBackground(): boolean { return false; }
  wasBackground(): boolean { return true; }
}

function dagRecordFor(
  input: DagDefinition,
  id: DagRunId,
  parentSessionId: string,
  rootSessionId: string,
): DagRunRecordV1 {
  const createdAt = "2026-10-22T00:00:00.000Z";
  const compiled = compileDag(input, { at: createdAt });
  if (!compiled.ok) throw new Error("test DAG did not compile");
  return {
    schemaVersion: 1,
    checkpointSeq: 0,
    runId: id,
    runKey: input.key,
    name: input.name,
    parentSessionId,
    rootSessionId,
    definitionFingerprint: "definition-fingerprint",
    definition: {
      key: input.key,
      name: input.name,
      nodes: input.nodes.map((entry) => ({ ...entry, effectivePrompt: entry.prompt })),
    },
    status: "pending",
    generation: 1,
    createdAt,
    updatedAt: createdAt,
    nodes: compiled.nodes,
    edges: compiled.edges,
    waves: compiled.waves,
    criticalPath: compiled.criticalPath,
    bottlenecks: compiled.bottlenecks,
    diagnostics: compiled.diagnostics,
  };
}

function singleNode(name: string): DagDefinition {
  const entry: DagNodeInput = { id: name, prompt: `do ${name}`, category: "quick" };
  return { key: `ops-${name}`, name: `ops ${name}`, nodes: [entry] };
}

describe("adversarial operations C20,C26,C28", () => {
  test("C20 (deferred to the site lane) #given the engine barrels and file trees #when inspected #then no site route surface exists here", () => {
    // given: the real dag barrel namespace (the ./dag export-map surface)
    const names = Object.keys(dagBarrel);

    // then: no HTTP/site/endpoint surface is exported from the engine lane...
    expect(names.filter((name) => /site|http|handler|endpoint|serve/i.test(name))).toEqual([]);
    // ...and the only route-named runtime export is the task-route kind table
    // (DagRoute is a type-only category/agent union, erased at runtime, not a site route)
    expect(names.filter((name) => /route/i.test(name)).sort()).toEqual(["DAG_ROUTE_KINDS"]);

    // then: no site-named module exists anywhere in the writable engine trees...
    const roots = [
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "code-graph", "src"),
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "memory-core", "src", "project-knowledge"),
      dirname(fileURLToPath(import.meta.url)),
    ];
    const siteFiles: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = join(directory, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/site/i.test(entry.name)) siteFiles.push(full);
      }
    };
    for (const root of roots) visit(root);
    expect(siteFiles).toEqual([]);

    // then: the HTTP route surface lives in the site lane (packages/web/src/api),
    // which this task may not write to — so C20 defers there with reason:
    // engine refs (run/node/check ids) are already proven at the API level by
    // C13-C19 and C21-C27; the site route that renders them is site-lane owned.
    const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "web", "src", "api");
    expect(fs.existsSync(apiDir)).toBe(true);
    expect(fs.readdirSync(apiDir).length).toBeGreaterThan(0);
  });

  test("C26 #given a restart #when the index reloads #then project, worktree, revision, and fingerprint are all revalidated", () => {
    // given: a stored baseline from before the restart
    const scope = scopeFor(PROJECT_A, WORKTREE_A, REVISION_A);
    const baseline = mustBuild(scope);
    const storedText = serializeIndex(baseline);
    expect(parseStoredIndex(storedText).kind).toBe("index");

    // when: the same scope restarts (fresh cache, same stored text)
    const restarted = new WorktreeGraphCache();
    const same = loadOrRebuild(restarted, {
      projectId: PROJECT_A,
      worktreeId: WORKTREE_A,
      storedText,
      headFiles: gatewayFiles(),
      headRevision: REVISION_A,
      nowMs: NOW_MS,
    });

    // then: the stored snapshot is trusted only because every binding matches
    if (same.status !== "hit") throw new Error(`expected a hit, got ${same.status}`);
    expect(same.baseline.scope).toEqual(scope);

    // when: HEAD moved while the process was down
    const moved = loadOrRebuild(new WorktreeGraphCache(), {
      projectId: PROJECT_A,
      worktreeId: WORKTREE_A,
      storedText,
      headFiles: gatewayFiles(),
      headRevision: REVISION_B,
      nowMs: NOW_MS,
    });

    // then: the old revision is never served; the rebuild binds the new one
    if (moved.status !== "rebuilt") throw new Error(`expected a rebuild, got ${moved.status}`);
    expect(moved.reason).toBe("HEAD-MOVE");
    expect(moved.baseline.scope.revision).toBe(REVISION_B);
    expect(moved.baseline.scope.fingerprint).toBe(computeScopeFingerprint(PROJECT_A, WORKTREE_A, REVISION_B));

    // when: the stored snapshot names a different project
    const foreign = loadOrRebuild(new WorktreeGraphCache(), {
      projectId: PROJECT_B,
      worktreeId: WORKTREE_B,
      storedText,
      headFiles: gatewayFiles(),
      headRevision: REVISION_A,
      nowMs: NOW_MS,
    });

    // then: cross-project snapshots never load; the rebuild binds the requesting project
    if (foreign.status !== "rebuilt") throw new Error(`expected a rebuild, got ${foreign.status}`);
    expect(foreign.reason).toBe("scope-mismatch");
    expect(foreign.baseline.scope.projectId).toBe(PROJECT_B);

    // when: the stored fingerprint was tampered with
    const tampered = JSON.parse(storedText) as { scope: { fingerprint: string } };
    tampered.scope.fingerprint = "0".repeat(64);
    const forged = loadOrRebuild(new WorktreeGraphCache(), {
      projectId: PROJECT_A,
      worktreeId: WORKTREE_A,
      storedText: JSON.stringify(tampered),
      headFiles: gatewayFiles(),
      headRevision: REVISION_A,
      nowMs: NOW_MS,
    });

    // then: the forgery is reported as corruption, never trusted
    if (forged.status !== "rebuilt") throw new Error(`expected a rebuild, got ${forged.status}`);
    expect(forged.reason).toMatch(/^corrupt-/);

    // when: the evidence aged out while the process was down
    const cache = new WorktreeGraphCache();
    cache.store(baseline);
    const staleRead = cache.read(PROJECT_A, WORKTREE_A, REVISION_A, NOW_MS + STALE_AFTER_MS + 1);

    // then: staleness resolves to stale with no baseline attached, never served
    expect(staleRead.status).toBe("stale");
    if (staleRead.status === "stale") expect(staleRead.reason).toBe("EVID-STALE");
  });

  test("C28 #given two concurrent sessions on one repo #when they share the index, store, and prompt builder #then neither corrupts the other", async () => {
    // given: one repo, one shared baseline (production path: cache.ts storage)
    const scope = scopeFor(PROJECT_A, WORKTREE_A, REVISION_A);
    const baseline = mustBuild(scope);
    const shared = new WorktreeGraphCache();
    shared.store(baseline);
    const pristine = JSON.stringify(baseline);

    // when: both sessions layer different dirty overlays over the same baseline...
    const viewA = applyDirtyOverlay(baseline, [
      { filePath: "src/ledger.ts", blobSha256: null, symbolHits: 0, renameResolved: false },
    ]);
    const viewB = applyDirtyOverlay(baseline, [
      { filePath: "src/gateway.ts", blobSha256: "f".repeat(64), symbolHits: 0, renameResolved: false },
    ]);

    // then: each view drops only its own file, and the shared baseline is untouched
    expect(viewA.entities.some((entity) => entity.filePath === "src/ledger.ts")).toBe(false);
    expect(viewA.entities.some((entity) => entity.filePath === "src/gateway.ts")).toBe(true);
    expect(viewB.entities.some((entity) => entity.filePath === "src/gateway.ts")).toBe(false);
    expect(viewB.entities.some((entity) => entity.filePath === "src/ledger.ts")).toBe(true);
    expect(JSON.stringify(baseline)).toBe(pristine);
    expect(shared.get(PROJECT_A, WORKTREE_A)?.entities.length).toBe(baseline.entities.length);

    // when: both sessions run DAGs concurrently against one shared store dir...
    // (production path: dag/index.ts#createDagScheduler/#createDagFileStore)
    const projectDir = tempProject();
    const store = createDagFileStore({ project_dir: projectDir });
    // SAFETY: test-only brands for fixed fixture ids; nothing at runtime inspects their shape.
    const runA = "run-ops-a" as DagRunId;
    const runB = "run-ops-b" as DagRunId;
    const managerA = new OpsFakeManager("ses-ops-a");
    const managerB = new OpsFakeManager("ses-ops-b");
    let eventTime = Date.parse("2026-10-22T00:00:02.000Z");
    const recordA = dagRecordFor(singleNode("a"), runA, "ses-ops-a", "ses-ops-a");
    const recordB = dagRecordFor(singleNode("b"), runB, "ses-ops-b", "ses-ops-b");
    store.writeCheckpoint(runA, recordA);
    store.writeCheckpoint(runB, recordB);
    const schedulerA = createDagScheduler({ store, taskManager: managerA, initialRecord: recordA, now: () => eventTime++ });
    const schedulerB = createDagScheduler({ store, taskManager: managerB, initialRecord: recordB, now: () => eventTime++ });
    const runningA = schedulerA.run();
    const runningB = schedulerB.run();
    await Promise.all([managerA.whenStarted("a"), managerB.whenStarted("b")]);
    managerA.complete("a");
    managerB.complete("b");
    const [resultA, resultB] = await Promise.all([runningA, runningB]);

    // then: both runs complete and each session started only its own node
    expect(resultA.status).toBe("completed");
    expect(resultB.status).toBe("completed");
    expect(managerA.starts).toEqual(["a"]);
    expect(managerB.starts).toEqual(["b"]);

    // when: both sessions build worker prompts with different knowledge...
    // (production path: tools/task/execute-spec.ts#buildStartSpec)
    const itemFor = (prompt: string) => ({
      kind: "category" as const,
      category: "quick",
      prompt,
      load_skills: [] as readonly string[],
    });
    const itemA = itemFor("Session A work.");
    const itemB = itemFor("Session B work.");
    const specA = buildStartSpec(
      singleSpawnParams(itemA, undefined),
      taskTargetOf(itemA),
      "ses-ops-a",
      stubDeps(),
      "/work/project",
      undefined,
      { records: [{ id: "pk-aaaa00000001", category: "unverified-hypothesis", claim: "Alpha claim for session A.", sourceFile: "a.ts", sourceRevision: REVISION_A, fingerprint: "b".repeat(64) }] },
      undefined,
    );
    const specB = buildStartSpec(
      singleSpawnParams(itemB, undefined),
      taskTargetOf(itemB),
      "ses-ops-b",
      stubDeps(),
      "/work/project",
      undefined,
      { records: [{ id: "pk-bbbb00000002", category: "unverified-hypothesis", claim: "Beta claim for session B.", sourceFile: "b.ts", sourceRevision: REVISION_A, fingerprint: "b".repeat(64) }] },
      undefined,
    );

    // then: neither context leaks into the other
    expect(specA.prompt).toContain("Alpha claim for session A.");
    expect(specA.prompt.includes("Beta claim for session B.")).toBe(false);
    expect(specB.prompt).toContain("Beta claim for session B.");
    expect(specB.prompt.includes("Alpha claim for session A.")).toBe(false);
    expect(specA.parent_session_id).toBe("ses-ops-a");
    expect(specB.parent_session_id).toBe("ses-ops-b");
  });
});
