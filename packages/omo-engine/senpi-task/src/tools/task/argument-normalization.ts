import { Type, type Static } from "typebox"
import { Value } from "typebox/value"

import { clampTaskSummary } from "../../task-summary"
import type { TaskToolParamsStatic } from "./params"

type TaskItem = NonNullable<TaskToolParamsStatic["tasks"]>[number]
type DelegationParams = NonNullable<TaskToolParamsStatic["delegation"]>
type DelegationRole = DelegationParams["roles"][number]
type DelegationRoleKey = DelegationRole["key"]
type IsolationArguments = Pick<TaskToolParamsStatic, "isolated" | "apply" | "merge">

const DELEGATION_ROLE_KEYS = [
  "investigate",
  "review",
  "implement",
  "verify",
] as const satisfies readonly DelegationRoleKey[]

const PROVIDER_PADDING_PROMPTS = new Set(["unused", "placeholder", "not used", "n/a"])

// `prepareArguments` runs before schema validation, so every field is an arbitrary value. These
// schemas are the boundary parser: the container checks establish the shape, and each field is
// decoded with its owner schema instead of being trusted by a representation check.
const EXTERNAL_OBJECT_SCHEMA = Type.Record(Type.String(), Type.Unknown())
const EXTERNAL_ARRAY_SCHEMA = Type.Array(Type.Unknown())
const TEXT_SCHEMA = Type.String()
const BOOLEAN_SCHEMA = Type.Boolean()
const POSITIVE_INTEGER_SCHEMA = Type.Integer({ minimum: 1 })
const NON_NEGATIVE_NUMBER_SCHEMA = Type.Number({ minimum: 0 })

type ExternalObject = Static<typeof EXTERNAL_OBJECT_SCHEMA>

function isExternalObject<Raw>(value: Raw): value is Raw & ExternalObject {
  return Value.Check(EXTERNAL_OBJECT_SCHEMA, value)
}

function nonBlankText<Value>(value: Value): string | undefined {
  if (!Value.Check(TEXT_SCHEMA, value)) return undefined
  return value.trim().length > 0 ? value : undefined
}

function identifier<Value>(value: Value): string | undefined {
  if (!Value.Check(TEXT_SCHEMA, value)) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function stringList<Value>(value: Value): string[] | undefined {
  if (!Value.Check(EXTERNAL_ARRAY_SCHEMA, value)) return undefined
  const strings = value.flatMap((entry) => {
    const normalized = identifier(entry)
    return normalized === undefined ? [] : [normalized]
  })
  return strings.length > 0 ? strings : undefined
}

function summaryText<Value>(value: Value): string | undefined {
  return clampTaskSummary(Value.Check(TEXT_SCHEMA, value) ? value : undefined)
}

function isolationBoolean<Value>(value: Value, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (!Value.Check(BOOLEAN_SCHEMA, value)) throw new TypeError(`${field} must be a boolean`)
  return value
}

function isolationMerge<Value>(value: Value): "patch" | "branch" | undefined {
  if (value === undefined) return undefined
  if (!Value.Check(TEXT_SCHEMA, value)) throw new TypeError("merge must be patch or branch")
  if (value === "patch") return "patch"
  if (value === "branch") return "branch"
  throw new TypeError("merge must be patch or branch")
}

function isolationArguments(value: ExternalObject): IsolationArguments {
  const parsed: IsolationArguments = {}
  const isolated = isolationBoolean(value.isolated, "isolated")
  if (isolated !== undefined) parsed.isolated = isolated
  const apply = isolationBoolean(value.apply, "apply")
  if (apply !== undefined) parsed.apply = apply
  const merge = isolationMerge(value.merge)
  if (merge !== undefined) parsed.merge = merge
  return parsed
}

function taskItem<Value>(value: Value): TaskItem | undefined {
  if (!isExternalObject(value)) return undefined
  const prompt = nonBlankText(value.prompt)
  if (prompt === undefined) return undefined

  const item: TaskItem = { prompt }
  const isolation = isolationArguments(value)
  if (isolation.isolated !== undefined) item.isolated = isolation.isolated
  if (isolation.apply !== undefined) item.apply = isolation.apply
  if (isolation.merge !== undefined) item.merge = isolation.merge
  const taskSummary = summaryText(value.task_summary)
  if (taskSummary !== undefined) item.task_summary = taskSummary
  const description = nonBlankText(value.description)
  if (description !== undefined) item.description = description
  const category = identifier(value.category)
  if (category !== undefined) item.category = category
  const subagentType = identifier(value.subagent_type)
  if (subagentType !== undefined) item.subagent_type = subagentType
  const name = identifier(value.name)
  if (name !== undefined) item.name = name
  const model = identifier(value.model)
  if (model !== undefined) item.model = model
  const loadSkills = stringList(value.load_skills)
  if (loadSkills !== undefined) item.load_skills = loadSkills
  const runInBackground = booleanFlag(value.run_in_background)
  if (runInBackground !== undefined) item.run_in_background = runInBackground
  return item
}

function booleanFlag<Value>(value: Value): boolean | undefined {
  return Value.Check(BOOLEAN_SCHEMA, value) ? value : undefined
}

function delegationRoleKey<Value>(value: Value): DelegationRoleKey | undefined {
  if (!Value.Check(TEXT_SCHEMA, value)) return undefined
  switch (value) {
    case "investigate":
      return "investigate"
    case "review":
      return "review"
    case "implement":
      return "implement"
    case "verify":
      return "verify"
    default:
      return undefined
  }
}

function positiveInteger<Value>(value: Value): number | undefined {
  if (value === undefined) return undefined
  if (!Value.Check(POSITIVE_INTEGER_SCHEMA, value)) {
    throw new TypeError("delegation.max_nodes must be a positive integer")
  }
  return value
}

function nonNegativeNumber<Value>(value: Value): number | undefined {
  if (value === undefined) return undefined
  if (!Value.Check(NON_NEGATIVE_NUMBER_SCHEMA, value)) {
    throw new TypeError("delegation.deadline_ms must be a finite non-negative number")
  }
  return value
}

// Delegation is a new top-level field, so normalization must carry it intact: dropping it here would
// silently turn a delegated request into an ordinary spawn. Invalid shapes throw the same way the
// isolation fields do, instead of spawning with a half-read plan.
function delegationArguments(value: ExternalObject): DelegationParams | undefined {
  const raw = value.delegation
  if (raw === undefined) return undefined
  if (!isExternalObject(raw)) throw new TypeError("delegation must be an object")

  const objective = nonBlankText(raw.objective)
  if (objective === undefined) throw new TypeError("delegation.objective must be a non-empty string")

  const rawRoles = raw.roles
  if (!Value.Check(EXTERNAL_ARRAY_SCHEMA, rawRoles)) {
    throw new TypeError("delegation.roles must contain at least one role")
  }
  if (rawRoles.length === 0) {
    throw new TypeError("delegation.roles must contain at least one role")
  }
  const roles = rawRoles.map((entry, index): DelegationRole => {
    if (!isExternalObject(entry)) throw new TypeError(`delegation.roles[${index}] must be an object`)
    const key = delegationRoleKey(entry.key)
    if (key === undefined) {
      throw new TypeError(
        `delegation.roles[${index}].key must be one of ${DELEGATION_ROLE_KEYS.join(", ")}`,
      )
    }
    const assignment = nonBlankText(entry.assignment)
    if (assignment === undefined) {
      throw new TypeError(`delegation.roles[${index}].assignment must be a non-empty string`)
    }
    const role: DelegationRole = { key, assignment }
    const dependsOn = stringList(entry.depends_on)
    if (dependsOn !== undefined) role.depends_on = dependsOn
    return role
  })

  const parsed: DelegationParams = { objective, roles }
  const workingDirectory = nonBlankText(raw.working_directory)
  if (workingDirectory !== undefined) parsed.working_directory = workingDirectory
  const maxNodes = positiveInteger(raw.max_nodes)
  if (maxNodes !== undefined) parsed.max_nodes = maxNodes
  const deadlineMs = nonNegativeNumber(raw.deadline_ms)
  if (deadlineMs !== undefined) parsed.deadline_ms = deadlineMs
  return parsed
}

function taskItems<Value>(value: Value): TaskItem[] | undefined {
  if (!Value.Check(EXTERNAL_ARRAY_SCHEMA, value)) return undefined
  return value.flatMap((entry) => {
    const normalized = taskItem(entry)
    return normalized === undefined ? [] : [normalized]
  })
}

function isProviderPaddingTask(item: TaskItem): boolean {
  return PROVIDER_PADDING_PROMPTS.has(item.prompt.trim().toLowerCase())
}

export function normalizeTaskToolArguments<Raw>(raw: Raw): TaskToolParamsStatic {
  if (!isExternalObject(raw)) return {}

  const prompt = nonBlankText(raw.prompt)
  const normalizedTasks = taskItems(raw.tasks)
  const tasksAreSinglePadding =
    prompt !== undefined &&
    normalizedTasks !== undefined &&
    (normalizedTasks.length === 0 || normalizedTasks.every(isProviderPaddingTask))
  const tasks = tasksAreSinglePadding ? undefined : normalizedTasks
  const taskSummary = summaryText(raw.task_summary)
  const description = nonBlankText(raw.description)
  const category = identifier(raw.category)
  const subagentType = identifier(raw.subagent_type)
  const name = identifier(raw.name)
  const model = identifier(raw.model)
  const loadSkills = stringList(raw.load_skills)
  // Parent kernel-tool names must survive normalization: dropping them here would silently spawn a
  // child WITHOUT the tools the caller asked for instead of granting or refusing them.
  const tools = stringList(raw.tools)
  const runInBackground = booleanFlag(raw.run_in_background)
  const delegation = delegationArguments(raw)

  const normalized: TaskToolParamsStatic = {}
  if (prompt !== undefined) normalized.prompt = prompt
  const isolation = isolationArguments(raw)
  if (isolation.isolated !== undefined) normalized.isolated = isolation.isolated
  if (isolation.apply !== undefined) normalized.apply = isolation.apply
  if (isolation.merge !== undefined) normalized.merge = isolation.merge
  if (taskSummary !== undefined) normalized.task_summary = taskSummary
  if (description !== undefined) normalized.description = description
  if (category !== undefined) normalized.category = category
  if (subagentType !== undefined) normalized.subagent_type = subagentType
  if (runInBackground !== undefined) normalized.run_in_background = runInBackground
  if (name !== undefined) normalized.name = name
  if (model !== undefined) normalized.model = model
  if (loadSkills !== undefined) normalized.load_skills = loadSkills
  if (tools !== undefined) normalized.tools = tools
  if (tasks !== undefined) normalized.tasks = tasks
  if (delegation !== undefined) normalized.delegation = delegation
  return normalized
}
