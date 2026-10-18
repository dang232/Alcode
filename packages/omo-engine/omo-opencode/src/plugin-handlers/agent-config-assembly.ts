import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeCodeAgentConfig } from "../../../claude-code-compat-core/src/features/claude-code-agent-loader/types";
import { buildAgentIdentitySection } from "../agents/dynamic-agent-prompt-builder";
import type { CategoryConfig } from "../config/schema/categories";
import type { OhMyOpenCodeConfig } from "../config/schema/oh-my-opencode-config";
import type { OmoAgentConfigEntry, OmoAgentConfigMap, OmoLoadedSkill } from "../plugin-types";
import { stripInvisibleAgentCharacters } from "../shared/agent-display-names";
import { resolveBundledAgentsDir } from "../shared/resolve-agent-definition-paths";
import { METIS_CORE_AGENT } from "../tools/delegate-task/metis-agent";
import { MOMUS_CORE_AGENT } from "../tools/delegate-task/momus-agent";
import { MULTIMODAL_LOOKER_CORE_AGENT } from "../tools/delegate-task/multimodal-looker-agent";
import { ORACLE_CORE_AGENT } from "../tools/delegate-task/oracle-agent";
import { resolveAgentVariant } from "../shared/agent-variant";
import {
  CATEGORY_PROMPT_APPEND_RESOLVERS,
  DEFAULT_CATEGORIES,
} from "../tools/delegate-task/builtin-categories";

export type AgentOverride = NonNullable<NonNullable<OhMyOpenCodeConfig["agents"]>[string]>;

export interface CustomAgentRecord {
  readonly description?: string;
  readonly mode?: string;
  readonly prompt?: string;
  readonly model?: string;
  readonly tools?: Record<string, boolean>;
}

export const CORE_AGENT_KEYS = [
  "sisyphus",
  "hephaestus",
  "prometheus",
  "atlas",
  "sisyphus-junior",
  "oracle",
  "metis",
  "momus",
  "multimodal-looker",
] as const;

const FALLBACK_BUNDLED_AGENT_NAMES = [
  "explore",
  "librarian",
  "omo-native-code-reviewer",
  "omo-native-gate-reviewer",
  "omo-native-qa-executor",
  "plan-consultant",
  "plan-reviewer",
];

const MODELISH_KEYS = ["model", "temperature"] as const;

/**
 * Normalizes an agent name for protected-name comparison: invisible
 * characters and display suffixes (" - ...", "(...)") are stripped so a
 * custom entry cannot slip past the guard by dressing up a builtin name.
 */
export function normalizeProtectedAgentName(name: string): string {
  return stripInvisibleAgentCharacters(name)
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/\s+-\s+.+$/g, "")
    .replace(/[-_]/g, "")
    .trim();
}

export function createProtectedAgentNameSet(names: Iterable<string>): Set<string> {
  const protectedNames = new Set<string>();
  for (const name of names) {
    const normalized = normalizeProtectedAgentName(name);
    if (normalized) protectedNames.add(normalized);
  }
  return protectedNames;
}

export function isProtectedAgentName(name: string, protectedNames: ReadonlySet<string>): boolean {
  return protectedNames.has(normalizeProtectedAgentName(name));
}

/** Stems of the Markdown definitions bundled with the product. */
export function readBundledAgentNames(): string[] {
  try {
    const bundledDir = resolveBundledAgentsDir();
    if (!existsSync(bundledDir)) return [...FALLBACK_BUNDLED_AGENT_NAMES];
    const stems = readdirSync(bundledDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.slice(0, -".md".length));
    return stems.length > 0 ? stems : [...FALLBACK_BUNDLED_AGENT_NAMES];
  } catch {
    return [...FALLBACK_BUNDLED_AGENT_NAMES];
  }
}

function firstModelString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstModelString(
        typeof item === "object" && item !== null
          ? (item as { model?: unknown }).model
          : item,
      );
      if (found) return found;
    }
    return undefined;
  }
  return undefined;
}

function resolveCategorySettings(
  categoryName: string | undefined,
  userCategories: Record<string, CategoryConfig> | undefined,
): CategoryConfig | undefined {
  if (!categoryName) return undefined;
  const builtin = DEFAULT_CATEGORIES[categoryName];
  const user = userCategories?.[categoryName];
  if (!builtin && !user) return undefined;
  return { ...builtin, ...user };
}

function resolveCategoryPromptAppend(
  categoryName: string | undefined,
  category: CategoryConfig | undefined,
  model: string | undefined,
): string | undefined {
  if (!categoryName || !category) return undefined;
  const resolver = CATEGORY_PROMPT_APPEND_RESOLVERS[categoryName];
  if (resolver) {
    try {
      return resolver(model);
    } catch {
      return category.prompt_append;
    }
  }
  return category.prompt_append;
}

function mergeToolsPolicy(
  ...sources: Array<Record<string, boolean> | undefined>
): Record<string, boolean> | undefined {
  const merged: Record<string, boolean> = {};
  for (const source of sources) {
    if (source) Object.assign(merged, source);
  }
  if (Object.keys(merged).length === 0) return undefined;
  return merged;
}

function buildSkillsAppendix(skills: readonly OmoLoadedSkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((skill) =>
    skill.definition.description
      ? `- ${skill.name}: ${skill.definition.description}`
      : `- ${skill.name}`,
  );
  return ["## Available skills", ...lines].join("\n");
}

interface CoreRoleSpec {
  readonly key: string;
  readonly role: string;
  readonly description: string;
  /**
   * Standing operating instructions, always appended to the entry prompt.
   * The builder's `config` (model head) is intentionally NOT consumed here:
   * the model stays resolver-driven, because a pinned entry model would win
   * over the whole model-core fallback chain. Static delivery pins the head
   * separately from the builder config.
   */
  readonly promptAppend?: string;
}

const CORE_ROLE_SPECS: readonly CoreRoleSpec[] = [
  {
    key: "sisyphus",
    role: "ultrawork orchestrator. Break complex goals into delegated work, verify every result, and drive the task to done.",
    description: "Ultrawork orchestrator: plans, delegates, and verifies complex work end to end.",
  },
  {
    key: "hephaestus",
    role: "deep implementation agent. Write and modify code carefully, run the relevant checks, and report exactly what changed.",
    description: "Deep implementation agent: writes code, runs checks, reports changes.",
  },
  {
    key: "prometheus",
    role: "plan builder. Research the codebase and produce a concrete, step-by-step implementation plan without editing code.",
    description: "Plan builder: researches and writes implementation plans.",
  },
  {
    key: "atlas",
    role: "plan executor. Carry out an approved plan step by step, verifying each step before moving on.",
    description: "Plan executor: carries out approved plans step by step.",
  },
  {
    key: "sisyphus-junior",
    role: "lightweight helper. Handle small, well-scoped follow-ups quickly and report back briefly.",
    description: "Lightweight helper for small, well-scoped follow-up tasks.",
  },
  {
    key: ORACLE_CORE_AGENT.key,
    role: ORACLE_CORE_AGENT.role,
    description: ORACLE_CORE_AGENT.description,
    promptAppend: ORACLE_CORE_AGENT.promptAppend,
  },
  {
    key: METIS_CORE_AGENT.key,
    role: METIS_CORE_AGENT.role,
    description: METIS_CORE_AGENT.description,
    promptAppend: METIS_CORE_AGENT.promptAppend,
  },
  {
    key: MOMUS_CORE_AGENT.key,
    role: MOMUS_CORE_AGENT.role,
    description: MOMUS_CORE_AGENT.description,
    promptAppend: MOMUS_CORE_AGENT.promptAppend,
  },
  {
    key: MULTIMODAL_LOOKER_CORE_AGENT.key,
    role: MULTIMODAL_LOOKER_CORE_AGENT.role,
    description: MULTIMODAL_LOOKER_CORE_AGENT.description,
    promptAppend: MULTIMODAL_LOOKER_CORE_AGENT.promptAppend,
  },
];

export interface CoreAgentBuildInput {
  readonly pluginConfig: OhMyOpenCodeConfig;
  readonly skills: readonly OmoLoadedSkill[];
}

/** Resolves one core agent entry from base spec, category, and override. */
function buildCoreAgentEntry(
  spec: CoreRoleSpec,
  input: CoreAgentBuildInput,
  atlasModel: string | undefined,
): OmoAgentConfigEntry {
  const overrides = input.pluginConfig.agents as
    | Record<string, AgentOverride | undefined>
    | undefined;
  const override = overrides?.[spec.key];
  const userCategories = input.pluginConfig.categories as
    | Record<string, CategoryConfig>
    | undefined;
  const category = resolveCategorySettings(override?.category, userCategories);
  const model =
    firstModelString(override?.models) ??
    firstModelString(override?.model) ??
    firstModelString(category?.models) ??
    firstModelString(category?.model) ??
    firstModelString(category?.fallback_models) ??
    (spec.key === "sisyphus-junior" ? atlasModel : undefined);
  const skillsAppendix = buildSkillsAppendix(input.skills);
  const categoryAppend = resolveCategoryPromptAppend(override?.category, category, model);
  const promptAppend = [spec.promptAppend, skillsAppendix, categoryAppend, override?.prompt_append]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");
  const toolsPolicy = mergeToolsPolicy(category?.tools, override?.tools);
  const temperature = override?.temperature ?? category?.temperature;
  return {
    description: override?.description ?? spec.description,
    mode: override?.mode ?? "subagent",
    ...(model ? { model } : {}),
    ...(override?.color ? { color: override.color } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    prompt: override?.prompt
      ?? [buildAgentIdentitySection(spec.key, spec.role), spec.role].join("\n\n"),
    ...(promptAppend ? { promptAppend } : {}),
    ...(toolsPolicy ? { tools: toolsPolicy } : {}),
  };
}

/**
 * Builds the nine core agent entries. Sisyphus is omitted when the
 * orchestrator family is disabled, and Prometheus is omitted when the
 * planner is disabled; both default to enabled.
 */
export function buildCoreAgentEntries(input: CoreAgentBuildInput): OmoAgentConfigMap {
  const familyDisabled = input.pluginConfig.sisyphus_agent?.disabled === true;
  const plannerEnabled = input.pluginConfig.sisyphus_agent?.planner_enabled ?? true;
  const entries: OmoAgentConfigMap = {};
  let atlasModel: string | undefined;
  for (const spec of CORE_ROLE_SPECS) {
    if (spec.key === "sisyphus" && familyDisabled) continue;
    if (spec.key === "prometheus" && !plannerEnabled) continue;
    const entry = buildCoreAgentEntry(spec, input, atlasModel);
    entries[spec.key] = entry;
    if (spec.key === "atlas" && entry.model) atlasModel = entry.model;
  }
  return entries;
}

/**
 * One-line startup summary of effective core-agent resolution. Reasoning
 * variants are resolved live per message by the interface lane, so they are
 * reported here for observability rather than persisted on the entry.
 */
export function describeCoreAgentResolution(
  pluginConfig: OhMyOpenCodeConfig,
  entries: OmoAgentConfigMap,
): string {
  return Object.entries(entries)
    .map(([key, entry]) => {
      const variant = resolveAgentVariant(pluginConfig, key) ?? "none";
      return `${key}: model=${entry.model ?? "host-default"} variant=${variant}`;
    })
    .join("; ");
}

/** Converts a file-loaded agent record into a host agent entry. */
export function normalizeCustomAgent(raw: ClaudeCodeAgentConfig): CustomAgentRecord {
  const model =
    typeof raw.model === "string"
      ? raw.model.trim() || undefined
      : raw.model
        ? `${raw.model.providerID}/${raw.model.modelID}`
        : undefined;
  return {
    ...(raw.description ? { description: raw.description } : {}),
    mode: raw.mode ?? "subagent",
    ...(raw.prompt ? { prompt: raw.prompt } : {}),
    ...(model ? { model } : {}),
    ...(raw.tools ? { tools: { ...raw.tools } } : {}),
  };
}

export function customRecordToEntry(record: CustomAgentRecord): OmoAgentConfigEntry {
  const toolsPolicy = mergeToolsPolicy(record.tools);
  return {
    ...(record.description ? { description: record.description } : {}),
    mode: record.mode ?? "subagent",
    ...(record.model ? { model: record.model } : {}),
    ...(record.prompt ? { prompt: record.prompt } : {}),
    ...(toolsPolicy ? { tools: toolsPolicy } : {}),
  };
}

/**
 * Merges custom tiers in ascending precedence (later tiers win), dropping
 * entries that shadow a protected builtin name or sit on the disabled list.
 */
export function selectCustomAgents(
  tiers: ReadonlyArray<Readonly<Record<string, CustomAgentRecord>>>,
  protectedNames: ReadonlySet<string>,
  disabledAgentNames: ReadonlySet<string>,
): OmoAgentConfigMap {
  const merged: Record<string, CustomAgentRecord> = {};
  const bundled: Record<string, CustomAgentRecord> = {};
  tiers.forEach((tier, index) => {
    // Tier 0 is the product-bundled tier: it owns the bundled names, so it is
    // exempt from the protected-name filter that blocks later custom tiers
    // from shadowing them.
    if (index === 0) Object.assign(bundled, tier);
    else Object.assign(merged, tier);
  });
  const selected: OmoAgentConfigMap = {};
  for (const [name, record] of Object.entries(bundled)) {
    if (disabledAgentNames.has(stripInvisibleAgentCharacters(name).toLowerCase())) continue;
    selected[name] = customRecordToEntry(record);
  }
  for (const [name, record] of Object.entries(merged)) {
    if (isProtectedAgentName(name, protectedNames)) continue;
    if (disabledAgentNames.has(stripInvisibleAgentCharacters(name).toLowerCase())) continue;
    selected[name] = customRecordToEntry(record);
  }
  return selected;
}

/**
 * Builds the demoted `plan` subagent entry. It inherits the model-shaped
 * settings from the resolved Prometheus entry, with the plan override
 * winning on every key it sets.
 */
export function buildPlanEntry(
  prometheusEntry: OmoAgentConfigEntry | undefined,
  planOverride: AgentOverride | undefined,
): OmoAgentConfigEntry {
  const inherited: Partial<Record<(typeof MODELISH_KEYS)[number], string | number>> = {};
  for (const key of MODELISH_KEYS) {
    const overrideValue = planOverride?.[key] as string | number | undefined;
    const baseValue = prometheusEntry?.[key] as string | number | undefined;
    const value = overrideValue ?? baseValue;
    if (value !== undefined) inherited[key] = value;
  }
  const toolsPolicy = mergeToolsPolicy(
    prometheusEntry?.tools,
    planOverride?.tools,
  );
  return {
    description: planOverride?.description ?? "Plan subagent: drafts implementation plans.",
    mode: "subagent",
    ...inherited,
    ...(planOverride?.prompt ? { prompt: planOverride.prompt } : {}),
    ...(planOverride?.prompt_append ? { promptAppend: planOverride.prompt_append } : {}),
    ...(toolsPolicy ? { tools: toolsPolicy } : {}),
  };
}

export interface AssembleAgentInput extends CoreAgentBuildInput {
  readonly customTiers: ReadonlyArray<Readonly<Record<string, CustomAgentRecord>>>;
  readonly disabledAgentNames: ReadonlySet<string>;
  readonly protectedNames: ReadonlySet<string>;
}

/**
 * Assembles the config-keyed agent map: core entries first, then custom
 * tiers in ascending precedence, then the demoted plan entry when the
 * planner is enabled. Disabled agents are removed last so no path can
 * reintroduce them.
 */
export function assembleAgentEntries(input: AssembleAgentInput): OmoAgentConfigMap {
  const core = buildCoreAgentEntries(input);
  const customs = selectCustomAgents(input.customTiers, input.protectedNames, input.disabledAgentNames);
  const plannerEnabled = input.pluginConfig.sisyphus_agent?.planner_enabled ?? true;
  const replacePlan = input.pluginConfig.sisyphus_agent?.replace_plan ?? true;
  const overrides = input.pluginConfig.agents as
    | Record<string, AgentOverride | undefined>
    | undefined;
  const entries: OmoAgentConfigMap = { ...core, ...customs };
  if (plannerEnabled && replacePlan && core.prometheus) {
    entries.plan = buildPlanEntry(core.prometheus, overrides?.plan);
  }
  for (const name of Object.keys(entries)) {
    if (input.disabledAgentNames.has(stripInvisibleAgentCharacters(name).toLowerCase())) {
      delete entries[name];
    }
  }
  return entries;
}
