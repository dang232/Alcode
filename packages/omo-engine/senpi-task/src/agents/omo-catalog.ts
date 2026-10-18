import type { AgentDefinition } from "./types"

import { BUILTIN_AGENT_DEFAULTS } from "./builtin/index"
import { CATEGORY_DESCRIPTIONS } from "../category/builtins"

// Unified OmO agent catalog: every entry Alcode ships as an OmO-compatible
// default, in one place, with the facts the Settings UI needs (stable id,
// source label, edition, requirements, model policy) next to the definition
// the runtime already resolves.
//
// What this module does and does not do:
// - Lists agent entries by REFERENCE to the builtin definitions the
//   senpi-task manager already registers (no duplicated prompts/tools), plus
//   category entries that route through the existing category resolver, plus
//   opencode-edition descriptors for agents only the OpenCode engine serves.
// - Never changes resolution: `resolveAgent`/`resolveCategory` stay the sole
//   authority. `catalogAvailability` is a display-grade pre-check with the
//   same fail-closed shape (unavailable + reason, never a silent omission).
// - Engine-provided names (`build`/`general` via the OpenCode runtime) and
//   disk-discovered workspace/user agents are NOT listed here; the UI merges
//   those lists and labels them by origin. Merge-only: this catalog never
//   shadows them.

export type OmoCatalogSource = "omo-compatible"

export type OmoCatalogEdition = "senpi" | "opencode"

export type OmoCatalogEntryKind = "agent" | "category"

/**
 * Documented dispatch fallbacks for entries no chat runtime resolves
 * directly. Ordered candidates; the first name the live agent list
 * contains wins. These are same-capability approximations, never
 * silent substitutions: callers report the actual selection.
 *
 * Compatibility bar: a fallback must preserve the entry's essential role
 * (what it produces, what it never does) and must not widen its enforced
 * permissions. `plan` qualifies for `plan-consultant`: both do planning
 * analysis and never implement, and `plan` wraps its deliverable in the
 * `<plan>` envelope the planner consumes. `general` does not qualify —
 * full tools, wrong role — so it is deliberately absent even as a last
 * resort: with `plan` disabled or missing the entry reads unavailable.
 */
export const OMO_FALLBACK_AGENTS: Readonly<Record<string, readonly string[]>> = {
  librarian: ["librarian", "explore"],
  architect: ["architect", "plan", "explore"],
  "plan-reviewer": ["plan-reviewer"],
  oracle: ["oracle", "explore"],
  metis: ["metis", "explore"],
  momus: ["momus", "general"],
  "multimodal-looker": ["multimodal-looker", "general"],
  sisyphus: ["sisyphus", "build"],
  "sisyphus-junior": ["sisyphus-junior", "build"],
  hephaestus: ["hephaestus", "build"],
  prometheus: ["prometheus", "build"],
  atlas: ["atlas", "explore"],
  quick: ["explore"],
  "deep-low": ["build"],
  "deep-high": ["build"],
  "plan-consultant": ["plan"],
  explore: ["explore"],
  "omo-native-code-reviewer": [],
  "omo-native-qa-executor": [],
  "omo-native-gate-reviewer": [],
}

export type OmoCatalogEntry = {
  /** Stable catalog id; agent ids match the runtime agent name. */
  readonly id: string
  readonly kind: OmoCatalogEntryKind
  readonly description: string
  readonly source: OmoCatalogSource
  /** Which runtime actually executes this entry. */
  readonly edition: OmoCatalogEdition
  /** Model ids that must be present in the live registry, if any. */
  readonly requiresModels?: readonly string[]
  /** Runtime capabilities the host must provide (e.g. opencode-engine). */
  readonly requiresCapabilities?: readonly string[]
  /** Ordered dispatch-fallback candidates; first live-list hit wins. */
  readonly fallback?: readonly string[]
  /** Senpi-side definition, by reference. Absent for opencode-edition agents. */
  readonly definition?: AgentDefinition
}

export type OmoCatalogAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string }

const SENPI_CATALOG_IDS: readonly string[] = [
  "explore",
  "librarian",
  "plan-consultant",
  "plan-reviewer",
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer",
]

// Task-routing categories as a distinct kind, not fake agent objects.
// Gate models come from the category table itself, so the catalog cannot
// drift from the resolver's fail-closed behavior.
const CATEGORY_CATALOG_IDS: readonly string[] = [
  "quick",
  "architect",
  "deep-low",
  "deep-high",
]

// Agents served only by the OpenCode engine side. Descriptions name the
// specialty; tool restrictions live in omo-opencode's AGENT_RESTRICTIONS and
// are enforced there, not restated here.
const OPENCODE_CATALOG: ReadonlyArray<{
  id: string
  description: string
}> = [
  { id: "oracle", description: "Deep codebase oracle: read-only research questions with cited evidence." },
  { id: "metis", description: "Code architect: designs and reviews structural changes." },
  { id: "momus", description: "Code critic: adversarial review of a change or design." },
  { id: "sisyphus", description: "Primary builder: implements changes end to end." },
  { id: "sisyphus-junior", description: "Lightweight builder for small scoped changes." },
  { id: "hephaestus", description: "Backend specialist: APIs, services, data flow." },
  { id: "prometheus", description: "Frontend specialist: UI, styling, interaction." },
  { id: "multimodal-looker", description: "Visual specialist: inspects rendered output and screenshots." },
  { id: "atlas", description: "Navigator: maps unfamiliar repositories at breadth." },
]

function senpiDefinition(name: string): AgentDefinition {
  const found = BUILTIN_AGENT_DEFAULTS.find((definition) => definition.name === name)
  if (!found) throw new Error(`OmO catalog references unknown senpi builtin: ${name}`)
  return found
}

function categoryDescription(name: string): string {
  return CATEGORY_DESCRIPTIONS[name] ?? `Task-routing category: ${name}.`
}

export const OMO_AGENT_CATALOG: readonly OmoCatalogEntry[] = [
  ...SENPI_CATALOG_IDS.map((id): OmoCatalogEntry => {
    const definition = senpiDefinition(id)
    const fallback = OMO_FALLBACK_AGENTS[id] ?? []
    return {
      id,
      kind: "agent",
      description: definition.description ?? id,
      source: "omo-compatible",
      edition: "senpi",
      ...(fallback.length > 0 ? { fallback } : {}),
      definition,
    }
  }),
  ...CATEGORY_CATALOG_IDS.map((id): OmoCatalogEntry => {
    const fallback = OMO_FALLBACK_AGENTS[id] ?? []
    return {
      id,
      kind: "category",
      description: categoryDescription(id),
      source: "omo-compatible",
      edition: "senpi",
      ...(fallback.length > 0 ? { fallback } : {}),
    }
  }),
  ...OPENCODE_CATALOG.map((entry): OmoCatalogEntry => {
    const fallback = OMO_FALLBACK_AGENTS[entry.id] ?? []
    return {
      id: entry.id,
      kind: "agent",
      description: entry.description,
      source: "omo-compatible",
      edition: "opencode",
      requiresCapabilities: ["opencode-engine"],
      ...(fallback.length > 0 ? { fallback } : {}),
    }
  }),
]

const CATALOG_BY_ID: ReadonlyMap<string, OmoCatalogEntry> = new Map(
  OMO_AGENT_CATALOG.map((entry) => [entry.id, entry]),
)

export function omoCatalogEntry(id: string): OmoCatalogEntry | undefined {
  return CATALOG_BY_ID.get(id)
}

/** Display-grade availability pre-check over live registry ids and host capabilities. Spawn-time resolution stays authoritative. */
export function catalogAvailability(
  entry: OmoCatalogEntry,
  available: { readonly models?: ReadonlySet<string>; readonly capabilities?: ReadonlySet<string> },
): OmoCatalogAvailability {
  for (const model of entry.requiresModels ?? []) {
    if (!available.models?.has(model)) {
      return { available: false, reason: `requires model ${model}` }
    }
  }
  for (const capability of entry.requiresCapabilities ?? []) {
    if (!available.capabilities?.has(capability)) {
      return { available: false, reason: `requires ${capability}` }
    }
  }
  return { available: true }
}
