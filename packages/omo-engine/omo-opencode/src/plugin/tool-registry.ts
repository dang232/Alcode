// tool-registry.ts — small registry builder with a hard-coded force-denylist.
//
// The force rules below are a local policy: certain tool families are never
// exposed to the host, no matter what the user config says. Everything else
// is filtered by user config (disabledTools), an optional size cap, and
// optional per-agent deny overrides.

export interface RegistryEntry {
  readonly description: string;
}

export type RegistryMap = Record<string, RegistryEntry>;

export interface BuildRegistryArgs {
  readonly skills: ReadonlyArray<{ readonly name: string }>;
  readonly disabledTools?: readonly string[];
  readonly maxTools?: number;
  readonly getRestrictions?: (agentName: string) => Record<string, boolean>;
}

// Inline base catalog, kept in a stable order so capping is deterministic.
const BASE_TOOLS: RegistryMap = {
  read: { description: "Read file contents from the workspace." },
  grep: { description: "Search file contents for a text pattern." },
  glob: { description: "Find files by name pattern." },
  bash: { description: "Run a shell command in the workspace." },
  write: { description: "Create or overwrite a file." },
  edit: { description: "Apply a targeted edit to an existing file." },
  task: { description: "Launch a follow-up sub-task." },
  call_omo_agent: { description: "Delegate work to a named helper agent." },
  teammate: { description: "Hand work to a teammate session." },
  todo_write: { description: "Record and update the task checklist." },
  LspHover: { description: "Show hover information for a code symbol." },
  grep_app_search: { description: "Search the companion app index." },
};

/**
 * Names that are never exposed. Matches the families the host cannot safely
 * offer: app-search helpers, nested task dispatchers, language-server tools,
 * the teammate handoff, and todo trackers (matched without case sensitivity).
 */
export function isForceDisabledTool(toolName: string): boolean {
  if (toolName.startsWith("grep_app_")) return true;
  if (toolName.startsWith("task_")) return true;
  if (toolName.startsWith("Lsp")) return true;
  if (toolName === "LspHover") return true;
  if (toolName === "teammate") return true;
  if (toolName.toLowerCase().startsWith("todo")) return true;
  return false;
}

/**
 * Build the exposable registry: start from the inline base catalog, drop
 * force-disabled names, drop user-disabled names, apply per-agent deny
 * overrides, then keep at most maxTools entries in base order.
 */
export function buildToolRegistry(args: BuildRegistryArgs): RegistryMap {
  const userDisabled = new Set<string>(args.disabledTools ?? []);
  const kept: RegistryMap = {};

  for (const [name, entry] of Object.entries(BASE_TOOLS)) {
    if (isForceDisabledTool(name)) continue;
    if (userDisabled.has(name)) continue;
    kept[name] = { description: entry.description };
  }

  if (args.getRestrictions) {
    const agents = new Set<string>([""]);
    for (const skill of args.skills ?? []) {
      if (skill && skill.name) agents.add(skill.name);
    }
    const denied = new Set<string>();
    for (const agent of agents) {
      let record: Record<string, boolean> | undefined;
      try {
        record = args.getRestrictions(agent);
      } catch {
        continue;
      }
      if (!record) continue;
      for (const [tool, allowed] of Object.entries(record)) {
        if (allowed === false) denied.add(tool);
      }
    }
    for (const name of denied) delete kept[name];
  }

  if (typeof args.maxTools === "number" && args.maxTools >= 0) {
    const overflow = Object.keys(kept).slice(args.maxTools);
    for (const name of overflow) delete kept[name];
  }

  return kept;
}
