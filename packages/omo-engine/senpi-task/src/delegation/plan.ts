import { createHash } from "node:crypto"

import type { DagDefinition, DagNodeInput } from "../dag/graph"
import type { DagNode, DagNodeId, DagNodeState } from "../dag/types"

// A delegation plan is a plain DAG definition for the existing engine. Nothing here schedules,
// queues, persists, or runs work: buildEngineeringDelegationPlan only produces the definition and
// collectDelegationResults only reads node records the engine already produced.

export const DELEGATION_ROLES = ["investigate", "review", "implement", "verify"] as const

export type DelegationRole = (typeof DELEGATION_ROLES)[number]

export type RoleSpec = {
  readonly key: DelegationRole
  readonly assignment: string
  // Role keys this node must wait for. A review role replaces its default with this list; every
  // other role adds these to its defaults so the ordering invariants below still hold.
  readonly dependsOn?: readonly string[]
}

export type EngineeringDelegationRequest = {
  readonly objective: string
  readonly workingDirectory: string
  readonly roles: readonly RoleSpec[]
  readonly maxNodes?: number
}

export type DelegationPlanRejectionCode =
  | "empty_roles"
  | "empty_objective"
  | "empty_working_directory"
  | "empty_assignment"
  | "invalid_max_nodes"
  | "node_count_exceeded"
  | "conflicting_implement_roles"
  | "unknown_dependency"
  | "self_dependency"
  | "cycle"

export type DelegationPlanRejection = {
  readonly ok: false
  readonly code: DelegationPlanRejectionCode
  readonly message: string
  readonly roleKeys: readonly string[]
}

export type DelegationPlan = {
  readonly ok: true
  readonly definition: DagDefinition
}

export type DelegationPlanResult = DelegationPlan | DelegationPlanRejection

const DEFAULT_MAX_NODES = 6

// Implementers are general executors; the other three roles use the shipped read-only agents.
// A plan is a definition, so these names are resolved by the engine at run time, not here.
const IMPLEMENT_CATEGORY = "unspecified-high"

const READ_ONLY_AGENT_BY_ROLE = {
  investigate: "explore",
  review: "omo-native-code-reviewer",
  verify: "omo-native-qa-executor",
} satisfies Readonly<Record<Exclude<DelegationRole, "implement">, string>>

const DEFAULT_DEPENDENCIES = {
  investigate: [],
  review: ["investigate"],
  implement: ["investigate"],
  verify: ["implement"],
} satisfies Readonly<Record<DelegationRole, readonly DelegationRole[]>>

const ROLE_OUTPUT_CONTRACT = {
  investigate:
    "Return a findings report with concrete file paths and line references, the current behavior, and the risks or unknowns that review and implementation must account for.",
  review:
    "Return findings ordered by severity with file and line references, plus what you could not prove from the available evidence.",
  implement:
    "Return the files you changed, a concise summary of each change, and the commands you ran.",
  verify:
    "Return the exact commands you ran, their observed output, and any failure. Report observed evidence only.",
} satisfies Readonly<Record<DelegationRole, string>>

const ROLE_BOUNDARY = {
  investigate: "Do not edit, create, or delete files in the working directory; leave the working tree unchanged.",
  review: "Do not edit, create, or delete files in the working directory; leave the working tree unchanged.",
  implement:
    "Before editing, name every file you may touch and edit only those files. Leave every other file unchanged.",
  verify: "Do not modify the working tree; report observed evidence only.",
} satisfies Readonly<Record<DelegationRole, string>>

type PlannedRole = {
  readonly spec: RoleSpec
  readonly ordinal: number
  readonly id: DagNodeId
}

type TerminalDagNodeState = Extract<DagNodeState, "completed" | "failed" | "cancelled" | "skipped">

export type DelegationOutcome = "completed" | "failed" | "cancelled" | "skipped" | "unusable"

export type DelegationNodeOutcome = {
  readonly nodeId: DagNodeId
  readonly role: DelegationRole | undefined
  readonly state: DagNodeState
  readonly outcome: DelegationOutcome
  readonly outputBytes: number
}

// Deliberately only per-node results. There is no run-level pass/fail, approval, or verification
// verdict here: the engine's evidence and acceptance gate own that judgement.
export type DelegationResultCollection = {
  readonly results: readonly DelegationNodeOutcome[]
  // Duplicate terminal records for one node id are collapsed, and the count is surfaced rather
  // than swallowed: a repeated delivery must not become a second outcome for that role.
  readonly duplicatesIgnored: number
}

function reject(
  code: DelegationPlanRejectionCode,
  message: string,
  roleKeys: readonly string[] = [],
): DelegationPlanRejection {
  return { ok: false, code, message, roleKeys }
}

// The ordinal is part of the id so repeated roles stay distinct while the id remains derived from
// the role key. The same request always produces the same sequence, so a retried plan fingerprints
// the same run.
export function delegationNodeId(role: DelegationRole, ordinal = 1): DagNodeId {
  // SAFETY: every caller passes a member of the closed DelegationRole union and a positive ordinal,
  // so the template is a valid branded node id.
  return `delegation-${role}-${ordinal}` as DagNodeId
}

function planRoles(roles: readonly RoleSpec[]): readonly PlannedRole[] {
  const ordinals = new Map<DelegationRole, number>()
  return roles.map((spec) => {
    const ordinal = (ordinals.get(spec.key) ?? 0) + 1
    ordinals.set(spec.key, ordinal)
    return { spec, ordinal, id: delegationNodeId(spec.key, ordinal) }
  })
}

function validateDependencies(
  roles: readonly RoleSpec[],
  presentRoles: ReadonlySet<string>,
): DelegationPlanRejection | undefined {
  for (const role of roles) {
    for (const dependency of role.dependsOn ?? []) {
      if (dependency === role.key) {
        return reject(
          "self_dependency",
          `role "${role.key}" depends on itself`,
          [role.key],
        )
      }
      if (!presentRoles.has(dependency)) {
        return reject(
          "unknown_dependency",
          `role "${role.key}" depends on unknown role "${dependency}"`,
          [role.key, dependency],
        )
      }
    }
  }
  return undefined
}

function dependencyRoleKeys(spec: RoleSpec, presentRoles: ReadonlySet<string>): readonly string[] {
  const defaults = DEFAULT_DEPENDENCIES[spec.key].filter((role) => presentRoles.has(role))
  // Review's default is the one override the request may replace; the other roles keep their
  // invariant edges and treat dependsOn as additional ordering.
  if (spec.key === "review" && spec.dependsOn !== undefined) {
    return [...new Set(spec.dependsOn)]
  }
  return [...new Set([...defaults, ...(spec.dependsOn ?? [])])]
}

function dependencyNodeIds(
  roleKeys: readonly string[],
  planned: readonly PlannedRole[],
): readonly DagNodeId[] {
  const ids = planned
    .filter((entry) => roleKeys.includes(entry.spec.key))
    .map((entry) => entry.id)
  return [...new Set(ids)].sort()
}

function findDependencyCycle(
  planned: readonly PlannedRole[],
  dependencies: ReadonlyMap<DagNodeId, readonly DagNodeId[]>,
): readonly DagNodeId[] | undefined {
  const status = new Map<DagNodeId, "visiting" | "visited">()
  const path: DagNodeId[] = []

  const visit = (id: DagNodeId): readonly DagNodeId[] | undefined => {
    const current = status.get(id)
    if (current === "visited") {
      return undefined
    }
    if (current === "visiting") {
      const start = path.indexOf(id)
      return [...path.slice(start), id]
    }
    status.set(id, "visiting")
    path.push(id)
    for (const dependency of dependencies.get(id) ?? []) {
      const cycle = visit(dependency)
      if (cycle !== undefined) {
        return cycle
      }
    }
    path.pop()
    status.set(id, "visited")
    return undefined
  }

  for (const entry of planned) {
    const cycle = visit(entry.id)
    if (cycle !== undefined) {
      return cycle
    }
  }
  return undefined
}

function nodeInput(entry: PlannedRole, prompt: string, dependsOn: readonly DagNodeId[]): DagNodeInput {
  const shared = {
    id: entry.id,
    label: `delegation-${entry.spec.key}-${entry.ordinal}`,
    prompt,
    dependsOn,
  }
  if (entry.spec.key === "implement") {
    return { ...shared, category: IMPLEMENT_CATEGORY }
  }
  return { ...shared, subagent_type: READ_ONLY_AGENT_BY_ROLE[entry.spec.key] }
}

function renderNodePrompt(
  request: EngineeringDelegationRequest,
  entry: PlannedRole,
  dependsOn: readonly DagNodeId[],
): string {
  const role = entry.spec.key
  const dependencyLine =
    dependsOn.length === 0
      ? "Dependencies: none. Start from the objective and the working directory."
      : `Dependencies: ${dependsOn.join(", ")}. Those nodes complete before this one starts; inspect the working tree yourself instead of assuming their findings.`
  return [
    `You are the ${role} node of an engineering delegation plan.`,
    "",
    `Objective: ${request.objective}`,
    `Working directory: ${request.workingDirectory}`,
    `Node: ${entry.id}`,
    "",
    `Assignment: ${entry.spec.assignment}`,
    "",
    `Expected output: ${ROLE_OUTPUT_CONTRACT[role]}`,
    "",
    `Boundaries: ${ROLE_BOUNDARY[role]}`,
    "Do not claim the work is verified: verification is judged by the engine's evidence records, never by this plan or by a node's own report.",
    dependencyLine,
  ].join("\n")
}

function definitionKey(request: EngineeringDelegationRequest): string {
  const canonical = JSON.stringify({
    objective: request.objective,
    workingDirectory: request.workingDirectory,
    roles: request.roles.map((role) => ({
      key: role.key,
      assignment: role.assignment,
      dependsOn: role.dependsOn === undefined ? null : [...role.dependsOn],
    })),
  })
  return `delegation-${createHash("sha256").update(canonical, "utf8").digest("hex")}`
}

export function buildEngineeringDelegationPlan(
  request: EngineeringDelegationRequest,
): DelegationPlanResult {
  const maxNodes = request.maxNodes ?? DEFAULT_MAX_NODES
  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    return reject("invalid_max_nodes", `maxNodes must be a positive integer, received ${maxNodes}`)
  }
  if (request.roles.length === 0) {
    return reject("empty_roles", "a delegation plan needs at least one role")
  }
  if (request.objective.trim().length === 0) {
    return reject("empty_objective", "a delegation plan needs a non-empty objective")
  }
  if (request.workingDirectory.trim().length === 0) {
    return reject("empty_working_directory", "a delegation plan needs a non-empty working directory")
  }
  const emptyAssignment = request.roles.find((role) => role.assignment.trim().length === 0)
  if (emptyAssignment !== undefined) {
    return reject(
      "empty_assignment",
      `role "${emptyAssignment.key}" needs a non-empty assignment`,
      [emptyAssignment.key],
    )
  }
  if (request.roles.length > maxNodes) {
    return reject(
      "node_count_exceeded",
      `delegation plan has ${request.roles.length} roles, exceeding maxNodes ${maxNodes}`,
    )
  }
  const implementRoles = request.roles.filter((role) => role.key === "implement")
  if (implementRoles.length > 1) {
    return reject(
      "conflicting_implement_roles",
      `delegation plan has ${implementRoles.length} implement roles; at most one is allowed`,
      implementRoles.map((role) => role.key),
    )
  }

  const presentRoles: ReadonlySet<string> = new Set(request.roles.map((role) => role.key))
  const dependencyRejection = validateDependencies(request.roles, presentRoles)
  if (dependencyRejection !== undefined) {
    return dependencyRejection
  }

  const planned = planRoles(request.roles)
  const dependencies = new Map<DagNodeId, readonly DagNodeId[]>()
  for (const entry of planned) {
    dependencies.set(
      entry.id,
      dependencyNodeIds(dependencyRoleKeys(entry.spec, presentRoles), planned),
    )
  }

  const cycle = findDependencyCycle(planned, dependencies)
  if (cycle !== undefined) {
    return reject("cycle", `dependency cycle detected: ${cycle.join(" -> ")}`, cycle)
  }

  // A verify node is a WORKER assignment, not evidence. Nothing in this builder may set `verify`
  // checks or a verdict/verified flag: the engine records and judges verification evidence after
  // the node runs, and a plan that pre-judged it would be inventing the outcome it asked for.
  const nodes = planned.map((entry) =>
    nodeInput(
      entry,
      renderNodePrompt(request, entry, dependencies.get(entry.id) ?? []),
      dependencies.get(entry.id) ?? [],
    ),
  )

  return {
    ok: true,
    definition: {
      key: definitionKey(request),
      name: "engineering-delegation",
      nodes,
    },
  }
}

function roleOfDelegationNode(id: DagNodeId): DelegationRole | undefined {
  for (const role of DELEGATION_ROLES) {
    if (id.startsWith(`delegation-${role}-`)) {
      return role
    }
  }
  return undefined
}

function isTerminalNodeState(state: DagNodeState): state is TerminalDagNodeState {
  return state === "completed" || state === "failed" || state === "cancelled" || state === "skipped"
}

function classifyOutcome(state: TerminalDagNodeState, outputBytes: number): DelegationOutcome {
  switch (state) {
    case "completed":
      // A completed node with an empty preview produced no usable output evidence.
      return outputBytes > 0 ? "completed" : "unusable"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "skipped":
      return "skipped"
  }
}

export function collectDelegationResults(nodes: readonly DagNode[]): DelegationResultCollection {
  // One outcome per node id: a duplicate terminal record (a repeated delivery, a redelivered
  // engine event) replaces the earlier entry instead of adding a second one. The last terminal
  // record is the current truth for that node, and the replacement count is reported.
  const byNodeId = new Map<string, DelegationNodeOutcome>()
  let duplicatesIgnored = 0
  for (const node of nodes) {
    // Only a terminal node carries a result. Reporting a running node as completed/failed would
    // invent an outcome, and omitting it keeps `unusable` meaning exactly "completed but empty".
    if (!isTerminalNodeState(node.state)) {
      continue
    }
    const outputBytes = node.outputBytes ?? Buffer.byteLength(node.output ?? "utf8")
    if (byNodeId.has(node.id)) duplicatesIgnored += 1
    byNodeId.set(node.id, {
      nodeId: node.id,
      role: roleOfDelegationNode(node.id),
      state: node.state,
      outcome: classifyOutcome(node.state, outputBytes),
      outputBytes,
    })
  }
  return { results: [...byNodeId.values()], duplicatesIgnored }
}
