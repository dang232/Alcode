/**
 * Adversarial scheduler + verification tests C13, C15, C22, C23.
 *
 * Production paths exercised through the dag barrel at
 * `packages/omo-engine/senpi-task/src/dag/index.ts` (the `./dag` export-map
 * surface per `src/dag/AGENTS.md`):
 * - C13: `scheduler.ts#createDagScheduler` (writeScopes admission) +
 *        `graph-assist.ts#isGraphSafeToParallelize` (graph "safe" verdict)
 * - C15: `verification.ts#selectVerificationChecks` +
 *        `graph-assist.ts#recommendExtraVerification/withGraphAssistChecks`
 * - C22: `graph-assist.ts#recommendExtraSerialization/applyGraphSerialization`
 *        folded by the real `scheduler.ts` admission pass
 * - C23: `verification.ts#selectVerificationChecks/buildVerificationRecord/evaluateAcceptance` +
 *        `graph-assist.ts#recommendExtraVerification/withGraphAssistChecks`
 *
 * Harness mirrors `scheduler-conflict.test.ts`: the fake manager stands in
 * for child execution only (the precedent set by
 * `scheduler-production-boundary.test.ts`); admission, serialization, check
 * selection, and acceptance all run on real production code.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ManagerStartSpec, TaskManager } from "../manager/types";
import type { TaskRecord, TaskStatus } from "../state";
import {
  applyGraphSerialization,
  compileDag,
  createDagFileStore,
  createDagScheduler,
  evaluateAcceptance,
  isGraphSafeToParallelize,
  recommendExtraSerialization,
  recommendExtraVerification,
  selectVerificationChecks,
  withGraphAssistChecks,
  type DagAcceptanceRequirement,
  type DagChangeScope,
  type DagDefinition,
  type DagNodeId,
  type DagNodeInput,
  type DagRunId,
  type DagRunRecordV1,
  type DagTaskOwner,
  type DagVerificationRecord,
  type DagVerifyCheck,
  type GraphAssistNeighbor,
  type GraphImpactNeighborhood,
  type OwnedStartResult,
} from "./index";
import { buildVerificationRecord } from "./verification";

// See scheduler-frontier.test.ts: Bun honours a preload's setDefaultTimeout only for the first
// test file of a run.
setDefaultTimeout(process.platform === "win32" ? 60_000 : 20_000);

// SAFETY: test-only brands for fixed fixture ids; nothing at runtime inspects their shape.
const runId = "run-adversarial-sched" as DagRunId;
const parentSessionId = "ses-adversarial-sched-parent";
const rootSessionId = "ses-adversarial-sched-root";
const REVISION = "a".repeat(40);

const cleanupRoots: string[] = [];

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempProject(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "senpi-dag-adversarial-"));
  cleanupRoots.push(directory);
  return directory;
}

function node(id: string, options: { readonly writeScopes?: readonly string[] } = {}): DagNodeInput {
  const entry: DagNodeInput = { id, prompt: `do ${id}`, category: "quick" };
  if (options.writeScopes === undefined) return entry;
  return { ...entry, writeScopes: [...options.writeScopes] };
}

function definition(nodes: DagDefinition["nodes"]): DagDefinition {
  return { key: "adversarial-test", name: "adversarial test", nodes };
}

function recordFor(input: DagDefinition, id: DagRunId = runId): DagRunRecordV1 {
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

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Test-only stand-in for child execution (mirrors scheduler-conflict.test.ts).
class AdversarialFakeManager implements TaskManager {
  readonly starts: string[] = [];
  readonly #tasks = new Map<string, {
    record: TaskRecord;
    readonly completion: Promise<TaskRecord>;
    readonly resolveCompletion: (record: TaskRecord) => void;
  }>();
  readonly #startedSignals = new Map<string, ReturnType<typeof deferred<void>>>();
  #taskCounter = 0;

  whenStarted(nodeId: string): Promise<void> {
    let signal = this.#startedSignals.get(nodeId);
    if (signal === undefined) {
      signal = deferred<void>();
      this.#startedSignals.set(nodeId, signal);
    }
    if (this.starts.includes(nodeId)) signal.resolve();
    return signal.promise;
  }

  residencyChanged(): Promise<void> {
    return new Promise<void>(() => undefined);
  }

  recordOf(nodeId: string): TaskRecord | undefined {
    return [...this.#tasks.values()].find((entry) => String(entry.record.owner?.nodeId) === nodeId)?.record;
  }

  complete(nodeId: string, status: TaskStatus = "completed"): void {
    const entry = [...this.#tasks.values()].find((candidate) => String(candidate.record.owner?.nodeId) === nodeId);
    if (entry === undefined) throw new Error(`unknown fake task for ${nodeId}`);
    entry.record = {
      ...entry.record,
      status,
      updated_at: "2026-10-22T00:00:01.000Z",
      ...(status === "completed" ? { final_response: `done ${nodeId}` } : { error_message: `${status} ${nodeId}` }),
    };
    entry.resolveCompletion(entry.record);
  }

  async startOwned(_spec: ManagerStartSpec, owner: DagTaskOwner): Promise<OwnedStartResult> {
    const nodeId = String(owner.nodeId);
    this.#taskCounter += 1;
    const taskId = `task-${this.#taskCounter}`;
    const completion = deferred<TaskRecord>();
    this.#tasks.set(taskId, {
      record: {
        task_id: taskId,
        name: nodeId,
        parent_session_id: parentSessionId,
        root_session_id: rootSessionId,
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
      completion: completion.promise,
      resolveCompletion: completion.resolve,
    });
    this.starts.push(nodeId);
    this.#startedSignals.get(nodeId)?.resolve();
    return { kind: "started", reused: false, task_id: taskId, status: "running", name: nodeId };
  }

  findOwnedTask(owner: Pick<DagTaskOwner, "kind" | "runId" | "nodeId">): TaskRecord | undefined {
    return this.recordOf(String(owner.nodeId));
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

function neighbor(symbol: string): GraphAssistNeighbor {
  return { symbol, confidence: 1, resolved: true };
}

function check(overrides: Partial<DagVerifyCheck> = {}): DagVerifyCheck {
  return {
    checkId: "unit-core",
    category: "unit",
    command: ["bun", "test"],
    timeoutMs: 30_000,
    criteria: ["AC-1"],
    ...overrides,
  };
}

const schedulerScope: DagChangeScope = {
  changedFiles: ["src/dag/scheduler.ts"],
  touchesScheduler: true,
  touchesCompletionGate: false,
  touchesWorkerLifecycle: false,
  touchesPersistedState: false,
  isDocsOnly: false,
};

function whenNodeState(
  scheduler: ReturnType<typeof createDagScheduler>,
  nodeId: string,
  state: string,
): Promise<void> {
  const current = scheduler.snapshot().nodes.find((entry) => String(entry.id) === nodeId);
  if (current?.state === state) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsubscribe = scheduler.subscribe((event) => {
      if (event.type !== "dag.node.transitioned" || String(event.nodeId) !== nodeId || event.to !== state) return;
      unsubscribe();
      resolve();
    });
  });
}

describe("adversarial scheduler and verification C13,C15,C22,C23", () => {
  test("C13 #given overlapping writeScopes #when the graph verdict is safe #then admission still serializes", async () => {
    // given: the graph affirmatively proves the symbols independent...
    // (production path: graph-assist.ts#isGraphSafeToParallelize via the dag barrel)
    const neighborhood: GraphImpactNeighborhood = {
      changedSymbols: ["sym-x"],
      impactedBy: new Map([
        ["sym-a", [neighbor("sym-a-out")]],
        ["sym-b", [neighbor("sym-b-out")]],
        ["sym-x", []],
      ]),
      unresolvedSymbols: [],
    };
    expect(isGraphSafeToParallelize(["sym-a"], ["sym-b"], neighborhood)).toBe(true);

    // given: ...but both nodes declare the same write scope (production path:
    // scheduler.ts#createDagScheduler via the dag barrel, graph assist wired in)
    const manager = new AdversarialFakeManager();
    const store = createDagFileStore({ project_dir: tempProject() });
    const initialRecord = recordFor(
      definition([node("a", { writeScopes: ["db"] }), node("b", { writeScopes: ["db"] })]),
    );
    store.writeCheckpoint(runId, initialRecord);
    let eventTime = Date.parse("2026-10-22T00:00:02.000Z");
    const scheduler = createDagScheduler({
      store,
      taskManager: manager,
      initialRecord,
      now: () => eventTime++,
      graphAssist: {
        neighborhood,
        // SAFETY: test-only brands for fixed fixture ids; nothing at runtime inspects their shape.
        nodeSymbols: new Map([["a" as DagNodeId, ["sym-a"]], ["b" as DagNodeId, ["sym-b"]]]),
        candidateChecks: [],
      },
    });

    // when: the run admits its frontier while the graph claims parallelism is safe
    const running = scheduler.run();
    await manager.whenStarted("a");

    // then: the writeScopes gate holds anyway — b never overlaps a
    expect(manager.starts).toEqual(["a"]);

    // when: the scope holder settles
    manager.complete("a");
    await manager.whenStarted("b");
    await whenNodeState(scheduler, "b", "running");

    // then: b serialized behind a on the real admission path
    expect(manager.starts).toEqual(["a", "b"]);

    // cleanup
    manager.complete("b");
    const result = await running;
    expect(result.status).toBe("completed");
  });

  test("C15 #given a scheduler change #when the graph predicts low risk #then every required check still runs", () => {
    // given: the base plan for a scheduler change (production path:
    // verification.ts#selectVerificationChecks via the dag barrel)
    const available = [
      check({ checkId: "build-dag", category: "build" }),
      check({ checkId: "typecheck", category: "typecheck" }),
      check({ checkId: "unit-core", category: "unit" }),
    ];
    const selected = selectVerificationChecks(schedulerScope, available);

    // when: the graph reports fully-attributed, resolved, disjoint impact (lowest risk:
    // production path: graph-assist.ts#recommendExtraVerification/withGraphAssistChecks)
    const calm: GraphImpactNeighborhood = {
      changedSymbols: ["sym-a"],
      impactedBy: new Map([["sym-a", [neighbor("sym-a-out")]]]),
      unresolvedSymbols: [],
    };
    // SAFETY: test-only brands for fixed fixture ids; nothing at runtime inspects their shape.
    const nodeA = "node-a" as DagNodeId;
    const { extraChecks } = recommendExtraVerification({
      neighborhood: calm,
      nodeSymbols: new Map([[nodeA, ["sym-elsewhere"]]]),
      admittable: [nodeA],
      available,
    });
    const merged = withGraphAssistChecks(selected.required, extraChecks);

    // then: the low-risk graph adds nothing, and the base plan is byte-identical
    expect(extraChecks).toEqual([]);
    expect(merged).toBe(selected.required);
    expect(selected.required.map((entry) => entry.checkId).sort()).toEqual(
      ["build-dag", "typecheck", "unit-core"].sort(),
    );
  });

  test("C22 #given a graph-discovered overlap #when scope-free nodes admit #then the frontier serializes without touching writeScopes", async () => {
    // given: two scope-free roots the base partition would admit together...
    // (production path: graph-assist.ts#recommendExtraSerialization/applyGraphSerialization)
    // SAFETY: test-only brands for fixed fixture ids; nothing at runtime inspects their shape.
    const nodeA = "a" as DagNodeId;
    const nodeB = "b" as DagNodeId;
    const risky: GraphImpactNeighborhood = {
      changedSymbols: ["sym-a", "sym-b"],
      impactedBy: new Map([
        ["sym-a", [neighbor("sym-a-out")]],
        ["sym-b", [neighbor("sym-b-out")]],
      ]),
      unresolvedSymbols: [],
    };
    const nodeSymbols = new Map([[nodeA, ["sym-a"]], [nodeB, ["sym-b"]]]);
    const { extraSerialized } = recommendExtraSerialization({
      admittable: [nodeA, nodeB],
      nodeSymbols,
      neighborhood: risky,
    });
    expect(extraSerialized).toEqual([nodeB]);

    // ...and the merge is append-only: parked nodes stay parked, never released
    const merged = applyGraphSerialization([nodeA, nodeB], [], extraSerialized);
    expect(merged).toEqual({ admittable: [nodeA], conflicted: [nodeB] });
    const held = applyGraphSerialization([nodeA], [nodeB], []);
    expect(held).toEqual({ admittable: [nodeA], conflicted: [nodeB] });

    // when: the real scheduler admits the same frontier with the same graph input
    // (production path: scheduler.ts#createDagScheduler via the dag barrel)
    const manager = new AdversarialFakeManager();
    const store = createDagFileStore({ project_dir: tempProject() });
    const initialRecord = recordFor(definition([node("a"), node("b")]));
    store.writeCheckpoint(runId, initialRecord);
    let eventTime = Date.parse("2026-10-22T00:00:02.000Z");
    const scheduler = createDagScheduler({
      store,
      taskManager: manager,
      initialRecord,
      now: () => eventTime++,
      graphAssist: { neighborhood: risky, nodeSymbols, candidateChecks: [] },
    });
    const running = scheduler.run();
    await manager.whenStarted("a");

    // then: the graph held b back even though no writeScope conflict exists
    expect(manager.starts).toEqual(["a"]);

    // when: the first node settles
    manager.complete("a");
    await manager.whenStarted("b");

    // then: the held node runs after, and the run completes
    expect(manager.starts).toEqual(["a", "b"]);
    manager.complete("b");
    const result = await running;
    expect(result.status).toBe("completed");
  });

  test("C23 #given impact-derived candidate checks #when the verification plan merges #then mandatory gates stay first and unchanged", () => {
    // given: the base plan plus an impacted graph that recommends every candidate
    // (production paths: verification.ts#selectVerificationChecks,
    // graph-assist.ts#recommendExtraVerification/withGraphAssistChecks)
    const available = [
      check({ checkId: "build-dag", category: "build" }),
      check({ checkId: "typecheck", category: "typecheck" }),
      check({ checkId: "unit-core", category: "unit" }),
      // Omitted from the base plan (needs worker-lifecycle touch), so the
      // graph is the only path that can recommend it.
      check({ checkId: "native-graph-probe", category: "native" }),
    ];
    const selected = selectVerificationChecks(schedulerScope, available);
    expect(selected.required.some((entry) => entry.checkId === "native-graph-probe")).toBe(false);
    const impacted: GraphImpactNeighborhood = {
      changedSymbols: ["sym-a"],
      impactedBy: new Map([["sym-a", [neighbor("sym-a-out")]]]),
      unresolvedSymbols: [],
    };
    // SAFETY: test-only brands for fixed fixture ids; nothing at runtime inspects their shape.
    const nodeA = "node-a" as DagNodeId;
    const { extraChecks } = recommendExtraVerification({
      neighborhood: impacted,
      nodeSymbols: new Map([[nodeA, ["sym-a"]]]),
      admittable: [nodeA],
      available,
    });
    expect(extraChecks.length).toBeGreaterThan(0);

    // when: the plan mechanism merges them
    const merged = withGraphAssistChecks(selected.required, extraChecks);

    // then: mandatory gates keep their order and identity up front; impact joins behind
    expect(merged.slice(0, selected.required.length)).toEqual([...selected.required]);
    const baseIds = new Set(selected.required.map((entry) => entry.checkId));
    for (const extra of extraChecks) {
      // every recommended check is considered: base ones in place, new ones behind
      expect(merged.some((entry) => entry.checkId === extra.checkId)).toBe(true);
      if (!baseIds.has(extra.checkId)) {
        expect(merged.slice(selected.required.length).some((entry) => entry.checkId === extra.checkId)).toBe(true);
      }
    }
    // ...and the graph-only candidate genuinely joined the plan
    expect(merged.some((entry) => entry.checkId === "native-graph-probe")).toBe(true);

    // when: only the mandatory gates leave genuine passed records
    // (production paths: verification.ts#buildVerificationRecord/evaluateAcceptance)
    const projectDir = tempProject();
    const records = new Map<string, DagVerificationRecord>();
    for (const required of selected.required) {
      const record = buildVerificationRecord({
        runId: String(runId),
        parentSessionId,
        rootSessionId,
        check: required,
        cwd: projectDir,
        projectDir,
        sourceRevision: REVISION,
        generation: 1,
        repairAttempt: 0,
        result: {
          started: true,
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          output: "ok",
          outputBytes: 2,
          durationMs: 5,
          uncertainEffect: false,
        },
      });
      records.set(required.checkId, record);
    }
    const current = { sourceRevision: REVISION, nodeFingerprints: new Map(), generation: 1 };
    const latestAttempts = new Map<string, number>();

    // then: the impact-derived candidates are genuinely required once recommended...
    const withImpact: DagAcceptanceRequirement[] = merged.map((entry) => ({ check: entry }));
    const blocked = evaluateAcceptance({ requirements: withImpact, records, current, latestAttempts });
    expect(blocked.accepted).toBe(false);
    expect(blocked.reasons.some((reason) => reason.includes("missing verification record"))).toBe(true);

    // ...while the mandatory gate alone is unchanged and accepts on the same evidence
    const mandatoryOnly: DagAcceptanceRequirement[] = selected.required.map((entry) => ({ check: entry }));
    const accepted = evaluateAcceptance({ requirements: mandatoryOnly, records, current, latestAttempts });
    expect(accepted).toEqual({ accepted: true, reasons: [] });
  });
});
