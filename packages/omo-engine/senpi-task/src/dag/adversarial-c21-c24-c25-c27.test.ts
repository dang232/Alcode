/**
 * Adversarial execution-chain tests C21, C24, C25, C27.
 *
 * Production paths exercised:
 * - C21: `code-graph/src/graph.ts#indexFiles/symbolContext/impact` (code-graph
 *        barrel) -> `memory-core/.../project-knowledge/retrieve.ts`
 *        #retrieveProjectKnowledge -> `senpi-task/.../tools/task/execute-spec.ts`
 *        #buildStartSpec/#singleSpawnParams/#taskTargetOf; the assertion reads
 *        the worker-visible prompt string.
 * - C24: `memory-core/.../project-knowledge/record.ts#createRecord` +
 *        `ProjectKnowledgeStore`, `supersede.ts#planSupersedeBatch/
 *        commitSupersedeBatch`, `retrieve.ts#retrieveProjectKnowledge`.
 * - C25: the same pure production functions run with the network surface
 *        stubbed out; no remote indexing call exists to consult.
 * - C27: `dag/verification.ts#buildVerificationRecord` (owning module, as in
 *        `scheduler-verification.test.ts`) + `dag/index.ts#evaluateAcceptance`.
 *
 * Precedent: `memory-core/.../supersede.test.ts` and `retrieve.test.ts`
 * (given/when/then, real record creation and retrieval). The fake manager is
 * not needed here: `buildStartSpec` is pure and takes stub deps with no
 * execution surface.
 */

import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  impact,
  indexFiles,
  symbolContext,
  type GraphSnapshot,
  type QueryOptions,
} from "../../../code-graph/src/graph";
import {
  createRecord,
  ProjectKnowledgeStore,
  type NewKnowledgeInput,
  type ProjectKnowledgeRecord,
} from "../../../memory-core/src/project-knowledge/record";
import { retrieveProjectKnowledge } from "../../../memory-core/src/project-knowledge/retrieve";
import {
  commitSupersedeBatch,
  planSupersedeBatch,
} from "../../../memory-core/src/project-knowledge/supersede";
import type { PromotionEvidence } from "../../../memory-core/src/project-knowledge/validator";
import { evaluateAcceptance } from "./index";
import { buildVerificationRecord } from "./verification";
import {
  buildStartSpec,
  singleSpawnParams,
  taskTargetOf,
  type InjectedGraphContext,
  type InjectedKnowledgeBlock,
} from "../tools/task/execute-spec";
import type { TaskToolDeps } from "../tools/task/types";
import type { OmoConfig } from "../../../omo-config-core/src/index";

const TEST_TIMEOUT_MS = 60000;

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "code-graph",
  "src",
  "__fixtures__",
  "graph-basic",
);

const PROJECT_A = "demo-12345678";
const REVISION_A = "a".repeat(40);
const BLOB_A = "b".repeat(64);
const OBSERVED_AT = "2026-10-01T00:00:00.000Z";
const VALIDATED_AT = "2026-10-02T00:00:00.000Z";
const NOW_MS = Date.parse("2026-10-02T00:00:00.000Z");

function graphOptions(): QueryOptions {
  return {
    scope: {
      projectId: PROJECT_A,
      worktreeId: "wt-adversarial-chain",
      revision: REVISION_A,
      fingerprint: "f".repeat(64),
    },
  };
}

let cachedSnapshot: GraphSnapshot | undefined;
function realSnapshot(): GraphSnapshot {
  if (cachedSnapshot === undefined) {
    cachedSnapshot = indexFiles([
      join(FIXTURE_DIR, "main.ts"),
      join(FIXTURE_DIR, "reexport.ts"),
      join(FIXTURE_DIR, "main.test.ts"),
    ]);
  }
  return cachedSnapshot;
}

function baseInput(claim: string, sourceFile: string): NewKnowledgeInput {
  return {
    projectId: PROJECT_A,
    claim,
    sourceFile,
    sourceSymbol: "fn:retry",
    sourceRevision: REVISION_A,
    sourceBlobSha256: BLOB_A,
    observedAt: OBSERVED_AT,
    validationMethod: "rg-resolve",
    confidence: 0.9,
    scope: { writeScopes: ["memory"] },
    invalidationConditions: ["SRC-EDIT", "SUPERSEDE-CHAIN"],
  };
}

function mustCreate(claim: string, sourceFile: string): ProjectKnowledgeRecord {
  const result = createRecord(baseInput(claim, sourceFile));
  if (result.kind !== "created") throw new Error(`fixture refused: ${result.reason}`);
  return result.record;
}

function evidenceFor(record: ProjectKnowledgeRecord, blobSha256: string): PromotionEvidence {
  return {
    probe: {
      source: "head-tree",
      revision: record.sourceRevision,
      symbolResolved: true,
      blobSha256,
      revisionReachable: true,
    },
    secretClean: true,
  };
}

function stubDeps(): TaskToolDeps {
  return {
    omoConfig: { categories: {}, agents: {} } as OmoConfig,
    agents: {},
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }),
  } as unknown as TaskToolDeps;
}

describe("adversarial execution chain C21,C24,C25,C27", () => {
  it(
    "C21 #given a real graph query plus linked knowledge #when the start spec builds #then the worker-visible string carries both under the budget caps",
    () => {
      // given: the graph answers from the real compiler extraction...
      const snapshot = realSnapshot();
      const context = symbolContext(snapshot, "fn:add@math.ts", graphOptions());
      expect(context.definition?.id).toBe("fn:add@math.ts");
      const reached = impact(snapshot, "fn:add@math.ts", graphOptions());
      expect(reached.impacted.length).toBeGreaterThan(0);

      // ...and the linked knowledge retrieves through the real memory-core ranker chain
      const record = mustCreate("The math module adds two numbers for the main runner.", "math.ts");
      const retrieved = retrieveProjectKnowledge([record], {
        projectId: PROJECT_A,
        queryTexts: ["math add runner"],
        nodeWriteScopes: ["memory"],
        nowMs: NOW_MS,
      });
      expect(retrieved.ranked.map((entry) => entry.record.id)).toContain(record.id);

      // when: both flow through the real buildStartSpec into the worker prompt
      const symbols = [
        ...(context.definition === undefined ? [] : [context.definition]),
        ...context.callers,
      ].map((item) => ({ id: item.id, file: item.file, line: item.line }));
      const graphContext: InjectedGraphContext = {
        symbols,
        impacted: reached.impacted.map((item) => ({ id: item.id, file: item.file, line: item.line })),
        knowledgeIds: [record.id],
        freshness: "fresh",
        revision: REVISION_A,
      };
      const knowledge: InjectedKnowledgeBlock = {
        records: retrieved.ranked.slice(0, 1).map((entry) => ({
          id: entry.record.id,
          category: entry.record.category,
          claim: entry.record.claim,
          sourceFile: entry.record.sourceFile,
          sourceRevision: entry.record.sourceRevision,
          fingerprint: entry.record.fingerprint,
        })),
      };
      const item = {
        kind: "category" as const,
        category: "quick",
        prompt: "Fix the runner.",
        load_skills: [] as readonly string[],
      };
      const spec = buildStartSpec(
        singleSpawnParams(item, undefined),
        taskTargetOf(item),
        "ses-chain-parent",
        stubDeps(),
        "/work/project",
        undefined,
        knowledge,
        graphContext,
      );

      // then: the worker-visible string carries the graph rows, the linked rationale, and the claim
      expect(spec.prompt).toContain("Fix the runner.");
      expect(spec.prompt).toContain("Graph context");
      expect(spec.prompt).toContain("[fn:add@math.ts]");
      expect(spec.prompt).toContain("graph freshness: fresh@");
      expect(spec.prompt).toContain(`linked rationale: ${record.id}`);
      expect(spec.prompt).toContain("The math module adds two numbers for the main runner.");

      // then: the budget caps hold on the worker-visible string (12 rows max, tail shed first)
      const many: InjectedGraphContext = {
        symbols: Array.from({ length: 20 }, (_, index) => ({
          id: `fn:sym${index}@math.ts`,
          file: "math.ts",
          line: index + 1,
        })),
        impacted: [],
        knowledgeIds: [],
        freshness: "fresh",
        revision: REVISION_A,
      };
      const capped = buildStartSpec(
        singleSpawnParams(item, undefined),
        taskTargetOf(item),
        "ses-chain-parent",
        stubDeps(),
        "/work/project",
        undefined,
        undefined,
        many,
      );
      expect(capped.prompt).toContain("[fn:sym0@math.ts]");
      expect(capped.prompt).toContain("[fn:sym11@math.ts]");
      expect(capped.prompt.includes("[fn:sym12@math.ts]")).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it("C24 #given a verified finding that contradicts a live claim #when it supersedes #then history survives and retrieval hides the loser", () => {
    // given: a live claim and its contradiction (production path: record.ts#createRecord)
    const store = new ProjectKnowledgeStore();
    const predecessor = mustCreate("The gateway retries idempotent requests three times.", "src/gateway.ts");
    store.insert(predecessor);
    const successor = mustCreate("The gateway retries idempotent requests five times.", "src/gateway.ts");
    const chained: ProjectKnowledgeRecord = { ...successor, supersedes: predecessor.id };

    // when: the batch plans and commits (production path: supersede.ts)
    const planned = planSupersedeBatch(store, chained, predecessor.id, evidenceFor(chained, BLOB_A), VALIDATED_AT);
    if (planned.kind !== "planned") throw new Error(`plan refused: ${planned.reason}`);
    const committed = commitSupersedeBatch(store, planned.plan);

    // then: the contradiction lands atomically with history preserved
    expect(committed.kind).toBe("committed");
    if (committed.kind === "committed") {
      expect(committed.successor.category).toBe("source-verified");
      expect(committed.predecessor.category).toBe("superseded");
    }
    expect(store.get(predecessor.id)).toBeUndefined();
    expect(store.getForAudit(predecessor.id)?.category).toBe("superseded");
    expect(store.getForAudit(predecessor.id)?.claim).toBe(predecessor.claim);

    // then: retrieval serves the winner and never ranks the loser
    const retrieved = retrieveProjectKnowledge(store.eligible(), {
      projectId: PROJECT_A,
      queryTexts: ["gateway retries requests"],
      nodeWriteScopes: ["memory"],
      nowMs: NOW_MS,
    });
    expect(retrieved.ranked.map((entry) => entry.record.id)).toContain(chained.id);
    expect(retrieved.ranked.some((entry) => entry.record.id === predecessor.id)).toBe(false);
  });

  it("C25 #given a stubbed network surface #when the graph/knowledge/plan path runs #then everything succeeds offline", () => {
    // given: any network surface consult fails the test instead of reaching the network
    const realFetch = globalThis.fetch;
    const consulted: string[] = [];
    (globalThis as { fetch: unknown }).fetch = (...args: unknown[]): Promise<never> => {
      consulted.push(String(args[0]));
      throw new Error("network consulted during an offline test");
    };
    try {
      // when: the pure production path runs end to end with no index server to call
      const snapshot = realSnapshot();
      const context = symbolContext(snapshot, "fn:add@math.ts", graphOptions());
      expect(context.definition?.id).toBe("fn:add@math.ts");
      const record = mustCreate("The math module adds two numbers for the main runner.", "math.ts");
      const retrieved = retrieveProjectKnowledge([record], {
        projectId: PROJECT_A,
        queryTexts: ["math add runner"],
        nodeWriteScopes: ["memory"],
        nowMs: NOW_MS,
      });
      expect(retrieved.ranked.length).toBeGreaterThan(0);
      const item = {
        kind: "category" as const,
        category: "quick",
        prompt: "Fix the runner offline.",
        load_skills: [] as readonly string[],
      };
      const spec = buildStartSpec(
        singleSpawnParams(item, undefined),
        taskTargetOf(item),
        "ses-offline-parent",
        stubDeps(),
        "/work/project",
      );
      expect(spec.prompt).toContain("Fix the runner offline.");

      // then: no network surface was consulted anywhere on the path
      expect(consulted).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("C27 #given only a graph view and a rationale note #when acceptance evaluates #then nothing passes without verification evidence", () => {
    // given: a graph view with real rows plus a rationale note claiming a check passed...
    const snapshot = realSnapshot();
    const context = symbolContext(snapshot, "fn:add@math.ts", graphOptions());
    expect((context.items.length ?? 0)).toBeGreaterThan(0);
    const noted = mustCreate("The runner adds correctly; unit-core passed.", "math.ts");
    const rationale: ProjectKnowledgeRecord = {
      ...noted,
      rationale: {
        notes: [{ kind: "verification-ref", text: "unit-core passed", standing: "unverified-hypothesis", confidence: 0.9 }],
      },
    };
    expect(rationale.rationale?.notes.length).toBe(1);

    // ...but no verification record exists (production path: dag/index.ts#evaluateAcceptance)
    const requirement = {
      checkId: "unit-core",
      category: "unit",
      command: ["bun", "test"],
      timeoutMs: 30_000,
      criteria: ["AC-1"],
    } as const;
    const refused = evaluateAcceptance({
      requirements: [{ check: { ...requirement } }],
      records: new Map(),
      current: { sourceRevision: REVISION_A, nodeFingerprints: new Map(), generation: 1 },
      latestAttempts: new Map(),
    });
    expect(refused.accepted).toBe(false);
    expect(refused.reasons.some((reason) => reason.includes("missing verification record"))).toBe(true);

    // when: a record claims passed without a genuine execution behind it
    const hollow = buildVerificationRecord({
      runId: "run-adversarial-chain",
      parentSessionId: "ses-chain-parent",
      rootSessionId: "ses-chain-root",
      check: { ...requirement },
      cwd: "/work/project",
      projectDir: "/work/project",
      sourceRevision: REVISION_A,
      generation: 1,
      repairAttempt: 0,
      result: {
        started: false,
        timedOut: false,
        cancelled: false,
        output: "unit-core passed (asserted, never executed)",
        outputBytes: 44,
        durationMs: 1,
        uncertainEffect: false,
      },
    });
    const hollowVerdict = evaluateAcceptance({
      requirements: [{ check: { ...requirement } }],
      records: new Map([[requirement.checkId, hollow]]),
      current: { sourceRevision: REVISION_A, nodeFingerprints: new Map(), generation: 1 },
      latestAttempts: new Map(),
    });

    // then: the hollow record cannot accept either — only a genuine execution counts
    expect(hollow.status).not.toBe("passed");
    expect(hollowVerdict.accepted).toBe(false);
  });
});
