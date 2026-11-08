import { describe, expect, it } from "bun:test"

import type { DagRunResult } from "../dag/handle"
import type { DagManager, DagRunRecordV1, DagStartParams } from "../dag/manager"
import type {
  DagNode,
  DagNodeCounts,
  DagNodeId,
  DagNodeState,
  DagRunId,
  DagRunSnapshot,
  DagRunStatus,
} from "../dag/types"

import {
  buildEngineeringDelegationPlan,
  delegationNodeId,
  type RoleSpec,
} from "./plan"
import {
  DelegationRunError,
  runEngineeringDelegation,
  type EngineeringDelegationRunCompletion,
  type EngineeringDelegationRunDeps,
  type EngineeringDelegationRunRequest,
  type EngineeringDelegationRunResult,
} from "./run"

const OBJECTIVE = "Fix the failing parser test without changing public behavior."
const WORKING_DIRECTORY = "/repo/packages/parser"
const PARENT_SESSION_ID = "ses_parent"
const ROOT_SESSION_ID = "ses_root"
const CREATED_AT = "2026-01-01T00:00:00.000Z"

function role(key: RoleSpec["key"], assignment: string): RoleSpec {
  return { key, assignment }
}

function request(overrides?: Partial<EngineeringDelegationRunRequest>): EngineeringDelegationRunRequest {
  return {
    objective: OBJECTIVE,
    workingDirectory: WORKING_DIRECTORY,
    roles: [role("investigate", "Locate the failing assertion."), role("review", "Review the findings.")],
    parentSessionId: PARENT_SESSION_ID,
    rootSessionId: ROOT_SESSION_ID,
    ...overrides,
  }
}

function completionOf(result: EngineeringDelegationRunResult): EngineeringDelegationRunCompletion {
  if (!result.ok) {
    throw new Error(`expected a run completion, received ${result.rejection.code}`)
  }
  return result
}

function countsOf(nodes: readonly DagNode[]): DagNodeCounts {
  const tally = {
    pending: 0,
    blocked: 0,
    scheduled: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
  }
  for (const node of nodes) tally[node.state] += 1
  return { total: nodes.length, ...tally }
}

function snapshotOf(
  runId: DagRunId,
  nodes: readonly DagNode[],
  status: DagRunStatus,
): DagRunSnapshot {
  return {
    schemaVersion: 1,
    runId,
    runKey: `key-${runId}`,
    name: "engineering-delegation",
    parentSessionId: PARENT_SESSION_ID,
    rootSessionId: ROOT_SESSION_ID,
    status,
    generation: 1,
    createdAt: CREATED_AT,
    definitionFingerprint: "fingerprint",
    lastSeq: 1,
    nodes,
    edges: [],
    waves: [],
    criticalPath: [],
    bottlenecks: [],
    diagnostics: [],
    counts: countsOf(nodes),
  }
}

function recordOf(
  runId: DagRunId,
  nodes: readonly DagNode[],
  status: DagRunStatus,
): DagRunRecordV1 {
  return {
    schemaVersion: 1,
    checkpointSeq: 1,
    runId,
    runKey: `key-${runId}`,
    name: "engineering-delegation",
    parentSessionId: PARENT_SESSION_ID,
    rootSessionId: ROOT_SESSION_ID,
    definitionFingerprint: "fingerprint",
    definition: { key: `key-${runId}`, name: "engineering-delegation", nodes: [] },
    status,
    generation: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    nodes,
    edges: [],
    waves: [],
    criticalPath: [],
    bottlenecks: [],
    diagnostics: [],
  }
}

function dagNodeIdOf(value: string): DagNodeId {
  // SAFETY: DagNodeId is a branded string; the engine accepts any non-empty submitted node id.
  return value as DagNodeId
}

function nodeRecord(id: DagNodeId, state: DagNodeState, output?: string): DagNode {
  const base: DagNode = {
    id,
    prompt: `execute ${id}`,
    route: { kind: "category", category: "unspecified-high" },
    dependsOn: [],
    writeScopes: [],
    state,
    attempt: 1,
    createdAt: CREATED_AT,
  }
  return output === undefined ? base : { ...base, output, outputBytes: Buffer.byteLength(output, "utf8") }
}

type NodeUpdate = {
  readonly id: DagNodeId
  readonly state: DagNodeState
  readonly output?: string
}

type FakeDag = {
  readonly dagManager: Pick<DagManager, "start" | "attach" | "record">
  readonly starts: DagStartParams[]
  readonly attaches: { readonly runId: DagRunId; readonly parentSessionId: string }[]
  readonly records: { readonly runId: DagRunId; readonly parentSessionId: string }[]
  readonly runIdsByKey: Map<string, DagRunId>
  readonly childrenByKey: Map<string, readonly DagNodeId[]>
  complete: (runId: DagRunId, status: DagRunStatus, updates: readonly NodeUpdate[]) => void
  result: (runId: DagRunId) => DagRunResult
  nodesOf: (runId: DagRunId) => readonly DagNode[]
}

// The double mirrors the real manager members exactly (start/attach/record), so a change to
// DagManager's start params, attach handle, or record shape breaks this file at type-check time.
function createFakeDag(): FakeDag {
  const starts: DagStartParams[] = []
  const attaches: FakeDag["attaches"] = []
  const records: FakeDag["records"] = []
  const runIdsByKey = new Map<string, DagRunId>()
  const childrenByKey = new Map<string, readonly DagNodeId[]>()
  const nodesByRun = new Map<DagRunId, DagNode[]>()
  const statusByRun = new Map<DagRunId, DagRunStatus>()

  const nodesOf = (runId: DagRunId): readonly DagNode[] => nodesByRun.get(runId) ?? []
  const statusOf = (runId: DagRunId): DagRunStatus => statusByRun.get(runId) ?? "pending"

  const dagManager: Pick<DagManager, "start" | "attach" | "record"> = {
    async start(params) {
      starts.push(params)
      const existing = runIdsByKey.get(params.definition.key)
      if (existing !== undefined) {
        return { reused: true, snapshot: snapshotOf(existing, nodesOf(existing), statusOf(existing)) }
      }
      // SAFETY: the fake owns the id format, so every generated string is a valid branded run id.
      const runId = `dag_fake_${runIdsByKey.size + 1}` as DagRunId
      runIdsByKey.set(params.definition.key, runId)
      childrenByKey.set(params.definition.key, params.definition.nodes.map((node) => dagNodeIdOf(node.id)))
      nodesByRun.set(runId, params.definition.nodes.map((node) => nodeRecord(dagNodeIdOf(node.id), "running")))
      statusByRun.set(runId, "running")
      return { reused: false, snapshot: snapshotOf(runId, nodesOf(runId), "running") }
    },
    attach(runId, parentSessionId) {
      attaches.push({ runId, parentSessionId })
      return { runId, snapshot: () => snapshotOf(runId, nodesOf(runId), statusOf(runId)) }
    },
    record(runId, parentSessionId) {
      records.push({ runId, parentSessionId })
      return recordOf(runId, nodesOf(runId), statusOf(runId))
    },
  }

  return {
    dagManager,
    starts,
    attaches,
    records,
    runIdsByKey,
    childrenByKey,
    complete(runId, status, updates) {
      const byId = new Map(updates.map((update) => [update.id, update]))
      nodesByRun.set(
        runId,
        nodesOf(runId).map((node) => {
          const update = byId.get(node.id)
          return update === undefined ? node : nodeRecord(node.id, update.state, update.output)
        }),
      )
      statusByRun.set(runId, status)
    },
    result(runId) {
      const status = statusOf(runId)
      return { runId, status, snapshot: snapshotOf(runId, nodesOf(runId), status), nodes: {} }
    },
    nodesOf,
  }
}

const INVESTIGATE = delegationNodeId("investigate")
const REVIEW = delegationNodeId("review")

describe("runEngineeringDelegation", () => {
  it("starts the native run and collects every terminal role outcome", async () => {
    const fake = createFakeDag()
    let waitBudget: number | undefined
    const result = await runEngineeringDelegation(
      {
        dagManager: fake.dagManager,
        now: () => 0,
        wait: async (runId, deadlineMs) => {
          waitBudget = deadlineMs
          fake.complete(runId, "completed", [
            { id: INVESTIGATE, state: "completed", output: "findings" },
            { id: REVIEW, state: "completed", output: "review notes" },
          ])
          return fake.result(runId)
        },
      },
      request(),
    )

    const completion = completionOf(result)
    expect(String(completion.runId)).toBe("dag_fake_1")
    expect(completion.outcomes.map((outcome) => outcome.outcome)).toEqual(["completed", "completed"])
    expect(completion.outcomes.map((outcome) => outcome.role)).toEqual(["investigate", "review"])
    expect(completion.unresolved).toBe(false)
    expect(completion.deadlineExceeded).toBe(false)
    expect(completion.deadlineCancellation).toBe("not_needed")
    expect(waitBudget).toBe(Number.POSITIVE_INFINITY)

    expect(fake.starts).toHaveLength(1)
    expect(fake.starts[0]?.parentSessionId).toBe(PARENT_SESSION_ID)
    expect(fake.starts[0]?.rootSessionId).toBe(ROOT_SESSION_ID)
    expect(fake.records).toEqual([{ runId: completion.runId, parentSessionId: PARENT_SESSION_ID }])
    expect(fake.attaches).toHaveLength(0)

    const plan = buildEngineeringDelegationPlan(request())
    if (!plan.ok) throw new Error("expected the fixture plan to build")
    expect(fake.starts[0]?.definition.key).toBe(plan.definition.key)
  })

  it("reports a failed node as failed instead of ranking it", async () => {
    const fake = createFakeDag()
    const result = await runEngineeringDelegation(
      {
        dagManager: fake.dagManager,
        wait: async (runId) => {
          fake.complete(runId, "failed", [
            { id: INVESTIGATE, state: "completed", output: "findings" },
            { id: REVIEW, state: "failed" },
          ])
          return fake.result(runId)
        },
      },
      request(),
    )

    const completion = completionOf(result)
    expect(completion.outcomes).toEqual([
      expect.objectContaining({ nodeId: INVESTIGATE, outcome: "completed" }),
      expect.objectContaining({ nodeId: REVIEW, state: "failed", outcome: "failed" }),
    ])
    expect(completion.unresolved).toBe(false)
    expect(completion.deadlineExceeded).toBe(false)
  })

  it("marks a completed node with an empty output unusable", async () => {
    const fake = createFakeDag()
    const result = await runEngineeringDelegation(
      {
        dagManager: fake.dagManager,
        wait: async (runId) => {
          fake.complete(runId, "completed", [
            { id: INVESTIGATE, state: "completed", output: "" },
            { id: REVIEW, state: "completed", output: "review notes" },
          ])
          return fake.result(runId)
        },
      },
      request(),
    )

    const completion = completionOf(result)
    expect(completion.outcomes[0]).toEqual(
      expect.objectContaining({ nodeId: INVESTIGATE, state: "completed", outcome: "unusable", outputBytes: 0 }),
    )
    expect(completion.unresolved).toBe(false)
  })

  it("reports a deadline with real node records and no fabricated timed_out state", async () => {
    const fake = createFakeDag()
    const clock = [0, 150]
    let tick = 0
    let waitBudget: number | undefined
    const result = await runEngineeringDelegation(
      {
        dagManager: fake.dagManager,
        now: () => clock[Math.min(tick++, clock.length - 1)] ?? 0,
        wait: async (runId, deadlineMs) => {
          waitBudget = deadlineMs
          // One node finished before the deadline; the other is still running.
          fake.complete(runId, "running", [{ id: INVESTIGATE, state: "completed", output: "partial" }])
          return fake.result(runId)
        },
      },
      request({ deadlineMs: 100 }),
    )

    const completion = completionOf(result)
    expect(completion.deadlineExceeded).toBe(true)
    expect(completion.deadlineCancellation).toBe("unavailable_at_manager_seam")
    expect(completion.unresolved).toBe(true)
    expect(waitBudget).toBe(0)
    expect(completion.outcomes).toEqual([
      expect.objectContaining({ nodeId: INVESTIGATE, outcome: "completed" }),
    ])
    // The manager's attach handle carries only runId + snapshot (manager.ts:161-164): no cancel.
    expect(fake.attaches).toEqual([{ runId: completion.runId, parentSessionId: PARENT_SESSION_ID }])
    expect(fake.records).toHaveLength(0)
    expect("cancel" in fake.dagManager).toBe(false)
  })

  it("produces node observations only, never a verification verdict", async () => {
    const fake = createFakeDag()
    const result = await runEngineeringDelegation(
      {
        dagManager: fake.dagManager,
        wait: async (runId) => {
          fake.complete(runId, "completed", [
            { id: INVESTIGATE, state: "completed", output: "findings" },
            { id: REVIEW, state: "completed", output: "review notes" },
          ])
          return fake.result(runId)
        },
      },
      request(),
    )

    const completion = completionOf(result)
    expect(Object.keys(completion).sort()).toEqual([
      "deadlineCancellation",
      "deadlineExceeded",
      "ok",
      "outcomes",
      "runId",
      "unresolved",
    ])
    for (const outcome of completion.outcomes) {
      expect(Object.keys(outcome).sort()).toEqual(["nodeId", "outcome", "outputBytes", "role", "state"])
    }
  })

  it("relies on the engine's keyed reuse so a repeated request never duplicates children", async () => {
    const fake = createFakeDag()
    const deps: EngineeringDelegationRunDeps = {
      dagManager: fake.dagManager,
      wait: async (runId: DagRunId) => {
        fake.complete(runId, "completed", [
          { id: INVESTIGATE, state: "completed", output: "findings" },
          { id: REVIEW, state: "completed", output: "review notes" },
        ])
        return fake.result(runId)
      },
    }
    const first = completionOf(await runEngineeringDelegation(deps, request()))
    const second = completionOf(await runEngineeringDelegation(deps, request()))

    expect(second.runId).toBe(first.runId)
    expect(fake.starts).toHaveLength(2)
    expect(fake.starts[0]?.definition.key).toBe(fake.starts[1]?.definition.key)
    expect(fake.runIdsByKey.size).toBe(1)
    expect(fake.childrenByKey.size).toBe(1)
    expect(fake.childrenByKey.get(fake.starts[0]?.definition.key ?? "")).toEqual([INVESTIGATE, REVIEW])
  })

  it("returns the plan rejection without starting a run", async () => {
    const fake = createFakeDag()
    const result = await runEngineeringDelegation(
      { dagManager: fake.dagManager, wait: async (runId) => fake.result(runId) },
      request({ objective: "  " }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe("empty_objective")
    expect(fake.starts).toHaveLength(0)
  })

  it("refuses to invent a result when the wait surface is missing", async () => {
    const fake = createFakeDag()
    await expect(runEngineeringDelegation({ dagManager: fake.dagManager }, request())).rejects.toThrow(
      DelegationRunError,
    )
    expect(fake.starts).toHaveLength(0)
  })

  it("rejects an invalid deadline before starting a run", async () => {
    const fake = createFakeDag()
    await expect(
      runEngineeringDelegation(
        { dagManager: fake.dagManager, wait: async (runId) => fake.result(runId) },
        request({ deadlineMs: -1 }),
      ),
    ).rejects.toThrow(DelegationRunError)
    expect(fake.starts).toHaveLength(0)
  })
})


// The delegation layer must never speak for the completion gate. The result type has no verdict
// field by construction, and this asserts it at RUNTIME so a future field cannot slip in unnoticed.
describe("runEngineeringDelegation verdict boundary", () => {
  it("never carries a verification verdict on the returned completion", async () => {
    const fake = createFakeDag()
    const result = await runEngineeringDelegation(
      {
        dagManager: fake.dagManager,
        now: () => 0,
        wait: async (runId) => {
          fake.complete(runId, "completed", [
            { id: INVESTIGATE, state: "completed", output: "findings" },
            { id: REVIEW, state: "completed", output: "review notes" },
          ])
          return fake.result(runId)
        },
      },
      request(),
    )

    const keys = Object.keys(completionOf(result))
    for (const forbidden of ["verified", "verification", "verificationStatus", "verdict", "gateVerdict"]) {
      expect(keys).not.toContain(forbidden)
    }
  })
})
