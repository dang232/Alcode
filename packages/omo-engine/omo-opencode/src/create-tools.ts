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
import { createCodeGraphTools } from "./tools/code-graph/index.ts";
import { createDelegationTools, CALL_OMO_AGENT_TOOL_NAME, MONITOR_TOOL_NAME, TASK_OUTPUT_TOOL_NAME, TASK_TOOL_NAME } from "./tools/delegation/delegation-tools.ts";
import { createWorkspaceBashTool, BASH_TOOL_NAME } from "./tools/workspace/bash.ts";
import { createWorkspaceEditTool, EDIT_TOOL_NAME } from "./tools/workspace/edit.ts";
import { createWorkspaceGlobTool, GLOB_TOOL_NAME } from "./tools/workspace/glob.ts";
import { createWorkspaceGrepTool, GREP_TOOL_NAME } from "./tools/workspace/grep.ts";
import { createWorkspaceReadTool, READ_TOOL_NAME } from "./tools/workspace/read.ts";
import { createWorkspaceWriteTool, WRITE_TOOL_NAME } from "./tools/workspace/write.ts";
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

  // Every advertised name carries a real implementation: a name the model can call must be a name that executes.
  // Unknown names stay absent from the map rather than becoming stubs, so the model reaches for tools that exist
  // instead of failing against ones that only look like they do.
  const filteredTools: OmoCreatedTools["filteredTools"] = {};
  const install = (name: string, tool: OmoCreatedTools["filteredTools"][string]): void => {
    if (registry[name] !== undefined) filteredTools[name] = tool;
  };

  // Native ULW tools keep their registry names and gating (user disables,
  // per-agent denies, and the size cap all applied above) but run the real
  // store-backed executes. A name the registry dropped stays dropped.
  const ulwTools = createUlwTools();
  for (const [name, tool] of Object.entries(ulwTools)) install(name, tool);

  // The native code-graph tool follows the same merge: registry-gated name,
  // real engine-backed execute. A dropped name stays dropped.
  const codeGraphTools = createCodeGraphTools({ directory: ctx.directory });
  for (const [name, tool] of Object.entries(codeGraphTools)) install(name, tool);

  // Native workspace tools follow the same registry gate: the catalog decides
  // whether an agent may see the name, the implementation decides what it does.
  const workspaceTools: Record<string, ReturnType<typeof createWorkspaceReadTool> | ReturnType<typeof createWorkspaceWriteTool> | ReturnType<typeof createWorkspaceBashTool> | ReturnType<typeof createWorkspaceGrepTool> | ReturnType<typeof createWorkspaceEditTool> | ReturnType<typeof createWorkspaceGlobTool>> = {
    [READ_TOOL_NAME]: createWorkspaceReadTool({ directory: ctx.directory }),
    [WRITE_TOOL_NAME]: createWorkspaceWriteTool({ directory: ctx.directory }),
    [BASH_TOOL_NAME]: createWorkspaceBashTool({ directory: ctx.directory }),
    [GREP_TOOL_NAME]: createWorkspaceGrepTool({ directory: ctx.directory }),
    [EDIT_TOOL_NAME]: createWorkspaceEditTool({ directory: ctx.directory }),
    [GLOB_TOOL_NAME]: createWorkspaceGlobTool({ directory: ctx.directory }),
  };
  // Delegation tools own request authority only; the host owns orchestration.
  // The catalog may list the name either way; the capability decides whether the
  // tool can act, and a host that supplies none leaves it refusing.
  const delegation = createDelegationTools({ directory: ctx.directory, capabilities: ctx.hostCapabilities });
  const delegationTools: Record<string, ReturnType<typeof createDelegationTools>["task"]> = {
    [TASK_TOOL_NAME]: delegation.task,
    [CALL_OMO_AGENT_TOOL_NAME]: delegation.callOmoAgent,
    [TASK_OUTPUT_TOOL_NAME]: delegation.taskOutput,
    [MONITOR_TOOL_NAME]: delegation.monitor,
  };
  for (const [name, tool] of Object.entries(workspaceTools)) install(name, tool);
  for (const [name, tool] of Object.entries(delegationTools)) install(name, tool);

  return { filteredTools, mergedSkills, availableSkills };
}
