// create-tools.ts — assembles the skill context and the gated tool registry.
//
// Steps: discover skills through the shared loader, normalize them into the
// contract shapes, derive the per-agent availability list, then gate the
// tool registry with the user config and the agent restriction table.

import type {
  OmoCreatedTools,
  OmoPluginContext,
  OmoToolManagers,
} from "./plugin-types";
import type { OhMyOpenCodeConfig } from "./config/schema/oh-my-opencode-config";
import { buildToolRegistry } from "./plugin/tool-registry";
import { getAgentToolRestrictions } from "./shared/agent-tool-restrictions";
import { createUlwTools } from "./tools/ulw/index.ts";

// Candidate locations for the shared skills loader barrel. Tried in order;
// a miss just falls through to the next one so this module always imports
// cleanly even when the loader package is not installed.
const LOADER_CANDIDATES = [
  "skills-loader-core",
  "../../skills-loader-core",
  "../../skills-loader-core/src/index.ts",
  "../skills-loader-core",
  "../skills-loader-core/src/index.ts",
];

interface LoaderModule {
  readonly discoverSkills?: unknown;
  readonly skillsToCommandDefinitionRecord?: unknown;
}

async function resolveLoader(): Promise<LoaderModule | null> {
  for (const specifier of LOADER_CANDIDATES) {
    try {
      const mod = (await import(specifier)) as LoaderModule;
      if (mod && typeof mod.discoverSkills === "function") return mod;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function tryDiscover(
  discover: unknown,
  directory: string,
): Promise<unknown[]> {
  if (typeof discover !== "function") return [];
  const call = discover as (...callArgs: unknown[]) => Promise<unknown>;
  const attempts: unknown[][] = [
    [directory],
    [{ directory }],
    [{ projectDirectory: directory }],
    [directory, {}],
    [],
  ];
  for (const callArgs of attempts) {
    try {
      const out = await call(...callArgs);
      if (Array.isArray(out)) return out as unknown[];
      if (isRecord(out) && Array.isArray(out["skills"])) {
        return out["skills"] as unknown[];
      }
    } catch {
      // Try the next calling convention.
    }
  }
  return [];
}

function normalizeSkills(raw: unknown[]): OmoCreatedTools["mergedSkills"] {
  const merged: OmoCreatedTools["mergedSkills"] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name =
      typeof entry["name"] === "string" && entry["name"].length > 0
        ? (entry["name"] as string)
        : "skill";
    const def = isRecord(entry["definition"])
      ? (entry["definition"] as Record<string, unknown>)
      : {};
    const description =
      typeof def["description"] === "string"
        ? (def["description"] as string)
        : typeof entry["description"] === "string"
          ? (entry["description"] as string)
          : "";
    const template =
      typeof def["template"] === "string" ? (def["template"] as string) : "";
    merged.push({
      name,
      definition: { name, description, template },
      scope: "project",
    });
  }
  return merged;
}

/**
 * Assemble skills and the config-gated tool registry for the plugin entry.
 */
export async function createTools(
  ctx: OmoPluginContext,
  pluginConfig: OhMyOpenCodeConfig,
  managers: OmoToolManagers,
): Promise<OmoCreatedTools> {
  void managers;

  let mergedSkills: OmoCreatedTools["mergedSkills"] = [];
  try {
    const loader = await resolveLoader();
    if (loader) {
      const raw = await tryDiscover(loader.discoverSkills, ctx.directory);
      mergedSkills = normalizeSkills(raw);
      if (typeof loader.skillsToCommandDefinitionRecord === "function") {
        try {
          const toRecord = loader.skillsToCommandDefinitionRecord as (
            ...callArgs: unknown[]
          ) => Promise<unknown>;
          await toRecord(mergedSkills);
        } catch {
          // Command record is best-effort; skills still stand on their own.
        }
      }
    }
  } catch {
    mergedSkills = [];
  }

  const availableSkills = mergedSkills.map((skill) => ({
    name: skill.name,
    description: skill.definition.description ?? "",
  })) as OmoCreatedTools["availableSkills"];

  const experimental = pluginConfig.experimental as
    | { max_tools?: number }
    | undefined;

  const registry = buildToolRegistry({
    skills: mergedSkills.map((skill) => ({ name: skill.name })),
    disabledTools: pluginConfig.disabled_tools,
    maxTools: experimental?.max_tools,
    getRestrictions: (agentName: string) =>
      getAgentToolRestrictions(agentName),
  });

  const filteredTools: OmoCreatedTools["filteredTools"] = {};
  for (const [name, entry] of Object.entries(registry)) {
    filteredTools[name] = {
      description: entry.description,
      args: { properties: {} },
      execute: async () => "tool unavailable in this context",
    };
  }

  // Native ULW tools keep their registry names and gating (user disables,
  // per-agent denies, and the size cap all applied above) but run the real
  // store-backed executes. A name the registry dropped stays dropped.
  const ulwTools = createUlwTools();
  for (const [name, tool] of Object.entries(ulwTools)) {
    if (registry[name] !== undefined) {
      filteredTools[name] = tool;
    }
  }

  return { filteredTools, mergedSkills, availableSkills };
}
