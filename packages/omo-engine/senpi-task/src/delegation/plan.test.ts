import { describe, expect, it } from "bun:test"

import { compileDag, type DagNodeInput } from "../dag/graph"
import type { DagNode, DagNodeState } from "../dag/types"

import {
  DELEGATION_ROLES,
  buildEngineeringDelegationPlan,
  collectDelegationResults,
  delegationNodeId,
  type DelegationNodeOutcome,
  type DelegationOutcome,
  type DelegationPlan,
  type DelegationPlanRejection,
  type DelegationPlanRejectionCode,
  type DelegationPlanResult,
  type DelegationResultCollection,
  type DelegationRole,
  type EngineeringDelegationRequest,
  type RoleSpec,
} from "./plan"

const OBJECTIVE = "Fix the failing parser test without changing public behavior."
const WORKING_DIRECTORY = "/repo/packages/parser"
const CREATED_AT = "2026-01-01T00:00:00.000Z"

function role(
  key: DelegationRole,
  assignment: string,
  dependsOn?: readonly string[],
): RoleSpec {
  if (dependsOn === undefined) {
    return { key, assignment }
  }
  return { key, assignment, dependsOn }
}

function request(
  roles: readonly RoleSpec[],
  maxNodes?: number,
): EngineeringDelegationRequest {
  if (maxNodes === undefined) {
    return { objective: OBJECTIVE, workingDirectory: WORKING_DIRECTORY, roles }
  }
  return { objective: OBJECTIVE, workingDirectory: WORKING_DIRECTORY, roles, maxNodes }
}

function planOf(roles: readonly RoleSpec[], maxNodes?: number): DelegationPlan {
  const result = buildEngineeringDelegationPlan(request(roles, maxNodes))
  if (!result.ok) {
    throw new Error(`expected a plan, received ${result.code}: ${result.message}`)
  }
  return result
}

function rejectionOf(result: DelegationPlanResult): DelegationPlanRejection {
  if (result.ok) {
    throw new Error("expected a rejection, received a plan")
  }
  return result
}

function expectRejection(
  result: DelegationPlanResult,
  code: DelegationPlanRejectionCode,
): DelegationPlanRejection {
  const rejection = rejectionOf(result)
  expect(rejection.code).toBe(code)
  return rejection
}

function nodeOf(plan: DelegationPlan, key: DelegationRole, ordinal = 1): DagNodeInput {
  const id = delegationNodeId(key, ordinal)
  const node = plan.definition.nodes.find((entry) => entry.id === id)
  if (node === undefined) {
    throw new Error(`missing node ${id}`)
  }
  return node
}

function nodeFixture(
  key: DelegationRole,
  state: DagNodeState,
  output: string,
  outputBytes?: number,
  ordinal = 1,
): DagNode {
  const bytes = outputBytes ?? Buffer.byteLength(output, "utf8")
  return {
    id: delegationNodeId(key, ordinal),
    prompt: "fixture prompt",
    route: { kind: "agent", agent: "explore" },
    dependsOn: [],
    writeScopes: [],
    state,
    attempt: 0,
    createdAt: CREATED_AT,
    output,
    outputBytes: bytes,
  }
}

describe("buildEngineeringDelegationPlan identity", () => {
  it("#given the same request twice #when planned #then the definitions and node ids are byte-identical", () => {
    // given
    const roles = [
      role("investigate", "map the parser failure"),
      role("implement", "fix the failing branch"),
      role("verify", "run the parser test"),
    ]

    // when
    const first = planOf(roles)
    const second = planOf(roles)

    // then
    expect(JSON.stringify(second.definition)).toBe(JSON.stringify(first.definition))
    expect(second.definition.key).toBe(first.definition.key)
    expect(first.definition.nodes.map((node) => node.id)).toEqual([
      delegationNodeId("investigate"),
      delegationNodeId("implement"),
      delegationNodeId("verify"),
    ])
  })

  it("#given repeated roles #when planned #then ordinal ids stay deterministic and distinct", () => {
    // given
    const roles = [
      role("investigate", "find the parser entry point"),
      role("investigate", "find the parser test harness"),
      role("review", "review both investigations"),
    ]

    // when
    const plan = planOf(roles)

    // then
    expect(plan.definition.nodes.map((node) => node.id)).toEqual([
      delegationNodeId("investigate", 1),
      delegationNodeId("investigate", 2),
      delegationNodeId("review", 1),
    ])
  })

  it("#given the role vocabulary #when each role is planned alone #then its stable node id is derived from the key", () => {
    // when
    for (const key of DELEGATION_ROLES) {
      const plan = planOf([role(key, `handle ${key}`)])

      // then
      expect(plan.definition.nodes.map((node) => node.id)).toEqual([delegationNodeId(key)])
    }
  })
})

describe("buildEngineeringDelegationPlan dependencies", () => {
  it("#given investigate, review, implement, verify #when planned #then compileDag accepts the default edges", () => {
    // given
    const plan = planOf([
      role("investigate", "map the failure"),
      role("review", "review the investigation"),
      role("implement", "apply the fix"),
      role("verify", "run the tests"),
    ])

    // when
    const compiled = compileDag(plan.definition)

    // then
    expect(compiled.ok).toBe(true)
    const edges = compiled.edges.map((edge) => `${edge.from}->${edge.to}`).sort()
    expect(edges).toEqual(
      [
        "delegation-investigate-1->delegation-implement-1",
        "delegation-investigate-1->delegation-review-1",
        "delegation-implement-1->delegation-verify-1",
      ].sort(),
    )
  })

  it("#given several investigate roles #when reviewed #then review waits for every investigation", () => {
    // given
    const plan = planOf([
      role("investigate", "find the parser entry point"),
      role("investigate", "find the parser test harness"),
      role("review", "review both investigations"),
    ])

    // when
    const review = nodeOf(plan, "review")

    // then
    expect(review.dependsOn).toEqual([
      delegationNodeId("investigate", 1),
      delegationNodeId("investigate", 2),
    ])
  })

  it("#given an explicit review dependency #when planned #then it replaces the investigate default", () => {
    // given
    const plan = planOf([
      role("investigate", "map the failure"),
      role("review", "review the fix", ["implement"]),
      role("implement", "apply the fix"),
    ])

    // when
    const review = nodeOf(plan, "review")

    // then
    expect(review.dependsOn).toEqual([delegationNodeId("implement")])
  })

  it("#given an empty review dependency list #when planned #then review has no dependencies", () => {
    // given
    const plan = planOf([
      role("investigate", "map the failure"),
      role("review", "review independently", []),
    ])

    // when
    const review = nodeOf(plan, "review")

    // then
    expect(review.dependsOn).toEqual([])
  })

  it("#given extra implement and verify dependencies #when planned #then the invariant edges remain", () => {
    // given
    const plan = planOf([
      role("investigate", "map the failure"),
      role("review", "review the investigation"),
      role("implement", "apply the fix", ["review"]),
      role("verify", "verify the fix", ["review"]),
    ])

    // then
    expect(nodeOf(plan, "implement").dependsOn).toEqual([
      delegationNodeId("investigate"),
      delegationNodeId("review"),
    ])
    expect(nodeOf(plan, "verify").dependsOn).toEqual([
      delegationNodeId("implement"),
      delegationNodeId("review"),
    ])
  })
})

describe("buildEngineeringDelegationPlan prompts", () => {
  it("#given a full plan #when prompts are read #then each carries objective, assignment, contract, and boundary", () => {
    // given
    const plan = planOf([
      role("investigate", "map the parser failure"),
      role("review", "review the investigation"),
      role("implement", "fix the failing branch"),
      role("verify", "run the parser test"),
    ])

    // when
    const investigate = nodeOf(plan, "investigate")
    const review = nodeOf(plan, "review")
    const implement = nodeOf(plan, "implement")
    const verify = nodeOf(plan, "verify")

    // then
    expect(investigate.prompt).toContain(OBJECTIVE)
    expect(investigate.prompt).toContain(WORKING_DIRECTORY)
    expect(investigate.prompt).toContain("map the parser failure")
    expect(investigate.prompt).toContain("file paths and line references")
    expect(investigate.prompt).toContain("Do not edit, create, or delete files")

    expect(review.prompt).toContain("review the investigation")
    expect(review.prompt).toContain("ordered by severity")
    expect(review.prompt).toContain("Do not edit, create, or delete files")

    expect(implement.prompt).toContain("fix the failing branch")
    expect(implement.prompt).toContain("files you changed")
    expect(implement.prompt).toContain("name every file you may touch")

    expect(verify.prompt).toContain("run the parser test")
    expect(verify.prompt).toContain("exact commands you ran")
    expect(verify.prompt).toContain("Do not modify the working tree")
  })

  it("#given any plan #when nodes are inspected #then none carries a verification verdict or verified marker", () => {
    // given
    const plan = planOf([
      role("investigate", "map the parser failure"),
      role("implement", "fix the failing branch"),
      role("verify", "run the parser test"),
    ])

    // then
    for (const node of plan.definition.nodes) {
      expect("verify" in node).toBe(false)
      expect("verified" in node).toBe(false)
      expect("verdict" in node).toBe(false)
    }
  })
})

describe("buildEngineeringDelegationPlan rejections", () => {
  it("#given no roles #when planned #then empty_roles is returned", () => {
    const result = buildEngineeringDelegationPlan(request([]))
    expectRejection(result, "empty_roles")
  })

  it("#given more roles than the default max #when planned #then node_count_exceeded is returned", () => {
    const roles = Array.from({ length: 7 }, (_, index) => role("investigate", `investigate ${index}`))
    const result = buildEngineeringDelegationPlan(request(roles))
    expectRejection(result, "node_count_exceeded")
  })

  it("#given more roles than an explicit max #when planned #then node_count_exceeded is returned", () => {
    const result = buildEngineeringDelegationPlan(
      request(
        [
          role("investigate", "one"),
          role("review", "two"),
          role("implement", "three"),
        ],
        2,
      ),
    )
    expectRejection(result, "node_count_exceeded")
  })

  it("#given an invalid max #when planned #then invalid_max_nodes is returned", () => {
    const result = buildEngineeringDelegationPlan(
      request([role("investigate", "one")], 0),
    )
    expectRejection(result, "invalid_max_nodes")
  })

  it("#given two implement roles #when planned #then conflicting_implement_roles is returned", () => {
    const result = buildEngineeringDelegationPlan(
      request([role("implement", "first edit"), role("implement", "second edit")]),
    )
    expectRejection(result, "conflicting_implement_roles")
  })

  it("#given an unknown dependency #when planned #then unknown_dependency is returned", () => {
    const result = buildEngineeringDelegationPlan(
      request([role("review", "review it", ["deploy"])]),
    )
    expectRejection(result, "unknown_dependency")
  })

  it("#given a self dependency #when planned #then self_dependency is returned", () => {
    const result = buildEngineeringDelegationPlan(
      request([role("review", "review it", ["review"])]),
    )
    expectRejection(result, "self_dependency")
  })

  it("#given a dependency cycle #when planned #then cycle is returned with the path", () => {
    const result = buildEngineeringDelegationPlan(
      request([
        role("investigate", "investigate it", ["review"]),
        role("review", "review it", ["investigate"]),
      ]),
    )
    const rejection = expectRejection(result, "cycle")
    expect(rejection.message).toContain("->")
  })

  it("#given an empty objective #when planned #then empty_objective is returned", () => {
    const result = buildEngineeringDelegationPlan({
      objective: "   ",
      workingDirectory: WORKING_DIRECTORY,
      roles: [role("investigate", "one")],
    })
    expectRejection(result, "empty_objective")
  })

  it("#given an empty working directory #when planned #then empty_working_directory is returned", () => {
    const result = buildEngineeringDelegationPlan({
      objective: OBJECTIVE,
      workingDirectory: "",
      roles: [role("investigate", "one")],
    })
    expectRejection(result, "empty_working_directory")
  })

  it("#given an empty assignment #when planned #then empty_assignment is returned", () => {
    const result = buildEngineeringDelegationPlan(
      request([role("investigate", "   ")]),
    )
    expectRejection(result, "empty_assignment")
  })
})

describe("collectDelegationResults", () => {
  it("#given one node per outcome #when collected #then the five classifications are reported", () => {
    // given
    const nodes = [
      nodeFixture("investigate", "completed", "found it"),
      nodeFixture("review", "failed", ""),
      nodeFixture("implement", "cancelled", ""),
      nodeFixture("verify", "skipped", ""),
      nodeFixture("investigate", "completed", "", 0, 2),
    ]

    // when
    const collection: DelegationResultCollection = collectDelegationResults(nodes)

    // then
    const expectedOutcomes = [
      "completed",
      "failed",
      "cancelled",
      "skipped",
      "unusable",
    ] satisfies DelegationOutcome[]
    expect(collection.results.map((result) => result.outcome)).toEqual(expectedOutcomes)
    const first: DelegationNodeOutcome | undefined = collection.results[0]
    expect(first).toEqual({
      nodeId: delegationNodeId("investigate"),
      role: "investigate",
      state: "completed",
      outcome: "completed",
      outputBytes: 8,
    })
    expect(collection.results[4]).toEqual({
      nodeId: delegationNodeId("investigate", 2),
      role: "investigate",
      state: "completed",
      outcome: "unusable",
      outputBytes: 0,
    })
  })

  it("#given a non-terminal node #when collected #then it is omitted instead of inventing an outcome", () => {
    // given
    const nodes = [nodeFixture("investigate", "running", "partial output")]

    // when
    const collection = collectDelegationResults(nodes)

    // then
    expect(collection.results).toEqual([])
  })

  it("#given collected results #when inspected #then no parent verdict is invented", () => {
    // given
    const nodes = [nodeFixture("verify", "completed", "tests passed")]

    // when
    const collection = collectDelegationResults(nodes)

    // then
    expect("verdict" in collection).toBe(false)
    expect("approved" in collection).toBe(false)
    expect("verified" in collection).toBe(false)
  })
})


// A repeated delivery must not become a second result for the same role. The engine should not
// emit duplicates, and this proves the collector does not create them either if it did.
describe("collectDelegationResults duplicate delivery", () => {
  it("#given the same node delivered twice #when collected #then one outcome is reported and the duplicate is counted", () => {
    const first = nodeFixture("review", "completed", "found it")
    const second = nodeFixture("review", "completed", "found it again")

    const collection = collectDelegationResults([first, second])

    expect(collection.results).toHaveLength(1)
    expect(collection.duplicatesIgnored).toBe(1)
    expect(collection.results[0]?.outputBytes).toBe(Buffer.byteLength("found it again", "utf8"))
  })
})
