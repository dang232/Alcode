import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadAgentDefinitions } from "../../../claude-code-compat-core/src/features/claude-code-agent-loader/agent-definitions-loader";
import type { ClaudeCodeAgentConfig } from "../../../claude-code-compat-core/src/features/claude-code-agent-loader/types";
import type {
  OmoApplyAgentConfig,
  OmoLoadedSkill,
  OmoSkillScope,
} from "../plugin-types";
import { resolveAgentDefinitionPaths, resolveBundledAgentsDir } from "../shared/resolve-agent-definition-paths";
import { AGENT_NAME_MAP } from "../shared/migration";
import {
  assembleAgentEntries,
  CORE_AGENT_KEYS,
  createProtectedAgentNameSet,
  describeCoreAgentResolution,
  normalizeCustomAgent,
  readBundledAgentNames,
  type CustomAgentRecord,
} from "./agent-config-assembly";
import { finalizeAgentConfig } from "./agent-config-finalizer";

const AGENT_FILE_PATTERN = /\.(md|json|jsonc)$/i;
const RESERVED_SKILL_KEYS = new Set(["sources", "enable", "disable"]);

/** Lowercase disabled-agent set with legacy display names migrated first. */
export function normalizeDisabledAgents(
  disabledAgents: readonly string[] | undefined,
): Set<string> {
  const normalized = new Set<string>();
  for (const name of disabledAgents ?? []) {
    const migrated = AGENT_NAME_MAP[name.toLowerCase()] ?? AGENT_NAME_MAP[name] ?? name;
    normalized.add(migrated.toLowerCase());
  }
  return normalized;
}

function normalizeDisabledSkills(disabledSkills: readonly string[] | undefined): Set<string> {
  return new Set((disabledSkills ?? []).map((name) => name.toLowerCase()));
}

function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

function opencodeGlobalDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return process.env.OPENCODE_CONFIG_DIR ?? join(xdg, "opencode");
}

function collectAgentFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && AGENT_FILE_PATTERN.test(entry.name))
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

function loadFileTier(
  root: string,
  scope: "user" | "project" | "opencode" | "opencode-project" | "definition-file",
  anthropicProvider: string | undefined,
): Record<string, CustomAgentRecord> {
  const paths = collectAgentFiles(root).filter((path) => existsSync(path));
  if (paths.length === 0) return {};
  const loaded = loadAgentDefinitions(paths, scope, anthropicProvider);
  return mapCustomTier(loaded);
}

function mapCustomTier(
  loaded: Record<string, ClaudeCodeAgentConfig>,
): Record<string, CustomAgentRecord> {
  const tier: Record<string, CustomAgentRecord> = {};
  for (const [name, config] of Object.entries(loaded)) {
    tier[name] = normalizeCustomAgent(config);
  }
  return tier;
}

function stripJsoncComments(content: string): string {
  let result = "";
  let index = 0;
  let inString = false;
  let quote = "";
  while (index < content.length) {
    const char = content[index];
    if (inString) {
      result += char;
      if (char === "\\") {
        result += content[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === quote) inString = false;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      result += char;
      index += 1;
      continue;
    }
    if (char === "/" && content[index + 1] === "/") {
      while (index < content.length && content[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && content[index + 1] === "*") {
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const parsed: unknown = JSON.parse(stripJsoncComments(readFileSync(path, "utf-8")));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function normalizeInlineAgent(agent: unknown): CustomAgentRecord | undefined {
  if (!agent || typeof agent !== "object") return undefined;
  const record = agent as Record<string, unknown>;
  const mode = record.mode === "primary" || record.mode === "all" ? record.mode : "subagent";
  const tools =
    record.tools && typeof record.tools === "object" && !Array.isArray(record.tools)
      ? (record.tools as Record<string, boolean>)
      : undefined;
  return {
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    mode,
    ...(typeof record.prompt === "string" ? { prompt: record.prompt } : {}),
    ...(typeof record.model === "string" && record.model.trim()
      ? { model: record.model.trim() }
      : {}),
    ...(tools ? { tools: { ...tools } } : {}),
  };
}

/**
 * Loads every agent source in ascending precedence: bundled product
 * definitions, plugin components, user, opencode-global, project,
 * opencode-project, agent_definitions files, then opencode-config maps with
 * the live host entries winning. The plugin tier is empty by contract: the
 * components index carries command and skill names only, so it reserves the
 * precedence slot without contributing bodies.
 */
export function loadAgentTiers(params: {
  directory: string;
  agentDefinitions: readonly string[] | undefined;
  anthropicProvider: string | undefined;
  includeClaudeAgents: boolean;
  hostAgents: Record<string, unknown>;
}): Array<Record<string, CustomAgentRecord>> {
  const bundledDir = resolveBundledAgentsDir();
  const bundledPaths = collectAgentFiles(bundledDir);
  const bundled = bundledPaths.length > 0
    ? mapCustomTier(loadAgentDefinitions(bundledPaths, "definition-file", params.anthropicProvider))
    : {};
  const plugin: Record<string, CustomAgentRecord> = {};
  const user = params.includeClaudeAgents
    ? loadFileTier(join(claudeConfigDir(), "agents"), "user", params.anthropicProvider)
    : {};
  const opencodeGlobal = loadFileTier(join(opencodeGlobalDir(), "agents"), "opencode", undefined);
  const project = params.includeClaudeAgents
    ? loadFileTier(join(params.directory, ".claude", "agents"), "project", params.anthropicProvider)
    : {};
  const opencodeProject = loadFileTier(
    join(params.directory, ".opencode", "agents"),
    "opencode-project",
    undefined,
  );
  const definitionFiles = loadAgentDefinitionTier(params);
  const opencodeConfig = loadOpencodeConfigTier(params.directory, params.hostAgents);
  return [bundled, plugin, user, opencodeGlobal, project, opencodeProject, definitionFiles, opencodeConfig];
}

function loadAgentDefinitionTier(params: {
  directory: string;
  agentDefinitions: readonly string[] | undefined;
  anthropicProvider: string | undefined;
}): Record<string, CustomAgentRecord> {
  if (!params.agentDefinitions || params.agentDefinitions.length === 0) return {};
  const resolved = resolveAgentDefinitionPaths([...params.agentDefinitions], params.directory, params.directory)
    .filter((path) => existsSync(path));
  if (resolved.length === 0) return {};
  return mapCustomTier(loadAgentDefinitions(resolved, "definition-file", params.anthropicProvider));
}

function loadOpencodeConfigTier(
  directory: string,
  hostAgents: Record<string, unknown>,
): Record<string, CustomAgentRecord> {
  const tier: Record<string, CustomAgentRecord> = {};
  const configPaths = [
    join(directory, ".opencode", "opencode.json"),
    join(directory, ".opencode", "opencode.jsonc"),
    join(opencodeGlobalDir(), "opencode.json"),
    join(opencodeGlobalDir(), "opencode.jsonc"),
  ];
  for (const configPath of configPaths) {
    const data = readJsonObject(configPath);
    if (!data) continue;
    const inline = data.agents ?? data.agent;
    if (inline && typeof inline === "object") {
      for (const [name, agent] of Object.entries(inline as Record<string, unknown>)) {
        if (Object.hasOwn(tier, name)) continue;
        const normalized = normalizeInlineAgent(agent);
        if (normalized) tier[name] = normalized;
      }
    }
    const nestedDefinitions = data.agent_definitions;
    const nestedPaths = typeof nestedDefinitions === "string"
      ? [nestedDefinitions]
      : Array.isArray(nestedDefinitions)
        ? nestedDefinitions.filter((entry): entry is string => typeof entry === "string")
        : [];
    if (nestedPaths.length > 0) {
      const configDir = join(configPath, "..");
      const resolved = resolveAgentDefinitionPaths(nestedPaths, configDir, directory)
        .filter((path) => existsSync(path));
      if (resolved.length > 0) {
        for (const [name, config] of Object.entries(loadAgentDefinitions(resolved, "opencode-config", undefined))) {
          if (!Object.hasOwn(tier, name)) tier[name] = normalizeCustomAgent(config);
        }
      }
    }
  }
  for (const [name, agent] of Object.entries(hostAgents)) {
    const normalized = normalizeInlineAgent(agent);
    if (normalized) tier[name] = normalized;
  }
  return tier;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split("\n")) {
    const nameMatch = /^name\s*:\s*(.+?)\s*$/.exec(line);
    if (nameMatch) result.name = nameMatch[1].replace(/^["']|["']$/g, "");
    const descriptionMatch = /^description\s*:\s*(.+?)\s*$/.exec(line);
    if (descriptionMatch) {
      result.description = descriptionMatch[1].replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

function discoverSkillFiles(roots: string[], scope: OmoSkillScope): OmoLoadedSkill[] {
  const found: OmoLoadedSkill[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries: Array<{ name: string } & { isDirectory(): boolean }>;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(root, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      let description: string | undefined;
      try {
        const frontmatter = parseSkillFrontmatter(readFileSync(skillFile, "utf-8"));
        if (frontmatter.name && frontmatter.name !== entry.name) continue;
        description = frontmatter.description;
      } catch {
        continue;
      }
      found.push({
        name: entry.name,
        path: skillFile,
        resolvedPath: skillFile,
        definition: {
          name: entry.name,
          template: "",
          ...(description ? { description } : {}),
        },
        scope,
      });
    }
  }
  return found;
}

function collectConfiguredSkillNames(skills: unknown): { names: string[]; disabled: string[] } {
  if (Array.isArray(skills)) {
    return {
      names: skills.filter((entry): entry is string => typeof entry === "string"),
      disabled: [],
    };
  }
  if (!skills || typeof skills !== "object") return { names: [], disabled: [] };
  const names: string[] = [];
  const disabled: string[] = [];
  for (const [key, value] of Object.entries(skills as Record<string, unknown>)) {
    if (RESERVED_SKILL_KEYS.has(key)) continue;
    if (value === false) {
      disabled.push(key);
      continue;
    }
    if (value && typeof value === "object" && (value as { disable?: unknown }).disable === true) {
      disabled.push(key);
      continue;
    }
    names.push(key);
  }
  const config = skills as { enable?: unknown; disable?: unknown };
  if (Array.isArray(config.enable)) {
    for (const name of config.enable) {
      if (typeof name === "string") names.push(name);
    }
  }
  if (Array.isArray(config.disable)) {
    for (const name of config.disable) {
      if (typeof name === "string") disabled.push(name);
    }
  }
  return { names, disabled };
}

/**
 * Discovers skills for core-agent prompt injection from skill files on the
 * conventional roots, names declared in plugin config, and the plugin
 * component index. Entries on any disabled list are dropped.
 */
export async function discoverSkillsForPromptInjection(params: {
  directory: string;
  pluginConfig: Parameters<OmoApplyAgentConfig>[0]["pluginConfig"];
  pluginComponents: Parameters<OmoApplyAgentConfig>[0]["pluginComponents"];
}): Promise<OmoLoadedSkill[]> {
  const includeClaudeSkills = params.pluginConfig.claude_code?.skills ?? true;
  const fileSkills = includeClaudeSkills
    ? [
        ...discoverSkillFiles(
          [join(params.directory, ".claude", "skills"), join(params.directory, ".agents", "skills")],
          "project",
        ),
        ...discoverSkillFiles([join(claudeConfigDir(), "skills")], "user"),
      ]
    : [];
  const configured = collectConfiguredSkillNames(params.pluginConfig.skills);
  const disabled = normalizeDisabledSkills([
    ...(params.pluginConfig.disabled_skills ?? []),
    ...configured.disabled,
  ]);
  const byName = new Map<string, OmoLoadedSkill>();
  const addSkill = (skill: OmoLoadedSkill) => {
    const key = skill.name.toLowerCase();
    if (disabled.has(key) || byName.has(key)) return;
    byName.set(key, skill);
  };
  for (const skill of fileSkills) addSkill(skill);
  for (const name of [...configured.names, ...params.pluginComponents.skillNames]) {
    addSkill({
      name,
      definition: { name, template: "" },
      scope: "shared",
    });
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export const applyAgentConfig: OmoApplyAgentConfig = async (params) => {
  const disabledAgentNames = normalizeDisabledAgents(params.pluginConfig.disabled_agents);
  const skills = await discoverSkillsForPromptInjection({
    directory: params.projectDirectory,
    pluginConfig: params.pluginConfig,
    pluginComponents: params.pluginComponents,
  });
  const customTiers = loadAgentTiers({
    directory: params.projectDirectory,
    agentDefinitions: params.pluginConfig.agent_definitions,
    anthropicProvider: params.pluginConfig.claude_code?.anthropic_provider,
    includeClaudeAgents: params.pluginConfig.claude_code?.agents ?? true,
    hostAgents: (params.hostConfig.agent ?? {}) as Record<string, unknown>,
  });
  const protectedNames = createProtectedAgentNameSet([
    ...CORE_AGENT_KEYS,
    "build",
    "plan",
    ...readBundledAgentNames(),
  ]);
  const entries = assembleAgentEntries({
    pluginConfig: params.pluginConfig,
    skills,
    customTiers,
    disabledAgentNames,
    protectedNames,
  });
  console.info(`[agent-config] resolved: ${describeCoreAgentResolution(params.pluginConfig, entries)}`);
  return finalizeAgentConfig({
    hostConfig: params.hostConfig,
    pluginConfig: params.pluginConfig,
    agents: entries,
  });
};
