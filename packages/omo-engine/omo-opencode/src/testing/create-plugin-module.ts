/**
 * create-plugin-module.ts — testable factory for the native plugin entry.
 *
 * The assembly order is fixed: agent-sort shim, config-context init, legacy
 * workspace migration, config validation, duplicate-plugin guard (a second
 * OMO entry disables this instance with empty hooks), live config load,
 * managers, tools, hooks, interface, then the final host Hooks table
 * (interface + session.compacting + compaction.autocontinue + dispose).
 *
 * Every collaborator is an injectable dep defaulting to the real Alwork
 * implementation, so tests can stub stages without touching the filesystem.
 * Only `import type` crosses into the host SDK; nothing here imports the
 * host at runtime.
 */

import { existsSync, readdirSync } from "node:fs";
import type {
  Hooks,
  Plugin,
  PluginInput,
  PluginModule,
  ToolContext,
  ToolDefinition,
} from "@opencode-ai/plugin";
import { createHooks as defaultCreateHooks } from "../create-hooks";
import { createManagers as defaultCreateManagers } from "../create-managers";
import { createTools as defaultCreateTools } from "../create-tools";
import { validatePluginConfig as defaultValidatePluginConfig } from "../config/validate";
import { loadPluginConfig as defaultLoadPluginConfig } from "../plugin-config";
import { createPluginDispose as defaultCreatePluginDispose } from "../plugin-dispose";
import { createPluginInterface as defaultCreatePluginInterface } from "../plugin-interface";
import type {
  OmoChatHeadersOutput,
  OmoChatParamsOutput,
  OmoCreateHooks,
  OmoCreateManagers,
  OmoCreatePluginDispose,
  OmoCreatePluginInterface,
  OmoCreateTools,
  OmoHookFlags,
  OmoJsonObject,
  OmoModelRef,
  OmoPluginContext,
  OmoPluginEvent,
  OmoPluginInterface,
  OmoSystemTransformOutput,
  OmoToolAfterOutput,
  OmoToolDefinition,
  OmoToolGuardOutput,
} from "../plugin-types";
import {
  detectDuplicateOmoPlugin as defaultDetectDuplicateOmoPlugin,
  getDuplicateOmoPluginWarning,
} from "../shared/external-plugin-detector";
import { readGateFacts } from "../shared/gate-facts";
import { checkForLegacyPluginEntry } from "../shared/legacy-plugin-warning";
import { migrateLegacyWorkspaceDirectory } from "../shared/legacy-workspace-migration";
import { log as defaultLog } from "../shared/logger";
import { migrateLegacyPluginEntry } from "../shared/migrate-legacy-plugin-entry";
import { PLUGIN_NAME } from "../shared/plugin-identity";
import { resolveBundledAgentsDir as defaultResolveBundledAgentsDir } from "../shared/resolve-agent-definition-paths";

export interface PluginModuleDeps {
  readonly installAgentSortShim: () => void;
  readonly initConfigContext: (harness: string, options: unknown) => void;
  readonly migrateLegacyWorkspace: (directory: string) => void;
  readonly validatePluginConfig: typeof defaultValidatePluginConfig;
  readonly detectDuplicateOmoPlugin: typeof defaultDetectDuplicateOmoPlugin;
  readonly loadPluginConfig: typeof defaultLoadPluginConfig;
  readonly resolveBundledAgentsDir: typeof defaultResolveBundledAgentsDir;
  readonly createManagers: OmoCreateManagers;
  readonly createTools: OmoCreateTools;
  readonly createHooks: OmoCreateHooks;
  readonly createPluginInterface: OmoCreatePluginInterface;
  readonly createPluginDispose: OmoCreatePluginDispose;
  readonly log: typeof defaultLog;
}

/**
 * Local stand-in for the agent-sort shim. Alwork assembles agents in
 * canonical order inside the agent-config lane, so no runtime re-sorting
 * is needed; this preserves the injection point for tests and policy.
 */
function installAgentSortShimLocal(): void {}

/**
 * Local stand-in for config-context init. Alwork loads config from the
 * .omo/ chain on every call, so there is no process-wide context to set up.
 */
function initConfigContextLocal(_harness: string, _options: unknown): void {}

/**
 * Best-effort legacy migration: the old workspace directory first, then a
 * stale package entry in the OpenCode config. Either step may no-op; neither
 * may break startup.
 */
function migrateLegacyWorkspaceLocal(directory: string): void {
  try {
    migrateLegacyWorkspaceDirectory(directory);
  } catch {
    // Workspace migration is hygiene, never fatal.
  }
  try {
    const check = checkForLegacyPluginEntry();
    if (check.hasLegacyEntry && check.configPath) {
      migrateLegacyPluginEntry(check.configPath);
    }
  } catch {
    // Entry migration is hygiene, never fatal.
  }
}

const defaultPluginModuleDeps: PluginModuleDeps = {
  installAgentSortShim: installAgentSortShimLocal,
  initConfigContext: initConfigContextLocal,
  migrateLegacyWorkspace: migrateLegacyWorkspaceLocal,
  validatePluginConfig: defaultValidatePluginConfig,
  detectDuplicateOmoPlugin: defaultDetectDuplicateOmoPlugin,
  loadPluginConfig: defaultLoadPluginConfig,
  resolveBundledAgentsDir: defaultResolveBundledAgentsDir,
  createManagers: defaultCreateManagers,
  createTools: defaultCreateTools,
  createHooks: defaultCreateHooks,
  createPluginInterface: defaultCreatePluginInterface,
  createPluginDispose: defaultCreatePluginDispose,
  log: defaultLog,
};

function toJsonObject(value: unknown): OmoJsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as OmoJsonObject;
  }
  return {};
}

function fieldOf(value: unknown, field: string): unknown {
  if (typeof value === "object" && value !== null) {
    return (value as Record<string, unknown>)[field];
  }
  return undefined;
}

function stringFieldOf(value: unknown, field: string): string {
  const candidate = fieldOf(value, field);
  return typeof candidate === "string" ? candidate : "unknown";
}

function modelRefOf(model: unknown): OmoModelRef {
  if (typeof model === "object" && model !== null) {
    const providerID = fieldOf(model, "providerID");
    const modelID = fieldOf(model, "modelID") ?? fieldOf(model, "id");
    if (typeof providerID === "string" && typeof modelID === "string") {
      return { providerID, modelID };
    }
  }
  return { providerID: "unknown", modelID: "unknown" };
}

/**
 * User text for gate-fact observation. The host carries the prompt as text
 * parts (and sometimes a message text field), so both are scanned; model
 * echoes never flow through here.
 */
function extractUserText(message: unknown, parts: unknown): string {
  const chunks: string[] = [];
  const direct = fieldOf(message, "text");
  if (typeof direct === "string" && direct.length > 0) chunks.push(direct);
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (fieldOf(part, "type") !== "text") continue;
      const text = fieldOf(part, "text");
      if (typeof text === "string" && text.length > 0) chunks.push(text);
    }
  }
  return chunks.join("\n");
}

/**
 * Normalize a host SDK event ({ type, properties }) into the Omo event the
 * interface lane understands. Unrecognized shapes return undefined and are
 * skipped — the host fires many events this plugin does not observe.
 */
function normalizeEvent(event: unknown): OmoPluginEvent | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const record = event as Record<string, unknown>;
  if (typeof record["type"] !== "string") return undefined;
  const type = record["type"];
  const properties =
    typeof record["properties"] === "object" && record["properties"] !== null
      ? (record["properties"] as Record<string, unknown>)
      : {};
  const sessionString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

  switch (type) {
    case "session.created": {
      const info =
        typeof properties["info"] === "object" && properties["info"] !== null
          ? (properties["info"] as Record<string, unknown>)
          : {};
      const sessionID = sessionString(info["id"]);
      if (!sessionID) return undefined;
      const parentID = sessionString(info["parentID"]);
      const title = sessionString(info["title"]);
      return {
        name: "session.created",
        sessionID,
        ...(parentID === undefined ? {} : { parentID }),
        ...(title === undefined ? {} : { title }),
      };
    }
    case "session.deleted": {
      const info =
        typeof properties["info"] === "object" && properties["info"] !== null
          ? (properties["info"] as Record<string, unknown>)
          : {};
      const sessionID = sessionString(info["id"]);
      if (!sessionID) return undefined;
      return { name: "session.deleted", sessionID };
    }
    case "session.status": {
      const sessionID = sessionString(properties["sessionID"]);
      if (!sessionID) return undefined;
      const status = properties["status"];
      const label =
        typeof status === "object" && status !== null && typeof (status as Record<string, unknown>)["type"] === "string"
          ? ((status as Record<string, unknown>)["type"] as string)
          : "unknown";
      return { name: "session.status", sessionID, status: label };
    }
    case "session.idle": {
      const sessionID = sessionString(properties["sessionID"]);
      if (!sessionID) return undefined;
      return { name: "session.idle", sessionID };
    }
    case "session.error": {
      const sessionID = sessionString(properties["sessionID"]);
      if (!sessionID) return undefined;
      const data = fieldOf(properties["error"], "data");
      const message = typeof data === "object" && data !== null ? stringFieldOf(data, "message") : undefined;
      return {
        name: "session.error",
        sessionID,
        ...(message === undefined || message === "unknown" ? {} : { message }),
      };
    }
    default:
      return undefined;
  }
}

/**
 * Bridge one Omo tool into the host registry. Host context (session,
 * message, abort signal) is re-expressed as the Omo tool context, and the
 * Omo outcome maps onto the host result: strings pass through, structured
 * outcomes split into title/output/metadata plus file attachments.
 */
function adaptTool(directory: string, worktree: string, entry: OmoToolDefinition): ToolDefinition {
  // The host validates definitions at registration time, so this
  // structural bridge is checked where it is consumed. Omo args stay
  // schema-free here; richer parameter schemas arrive via tool.definition.
  return {
    description: entry.description,
    args: {},
    execute: async (rawArgs: unknown, context: ToolContext) => {
      const outcome = await entry.execute(toJsonObject(rawArgs), {
        sessionID: context.sessionID,
        messageID: context.messageID,
        agent: context.agent,
        directory,
        worktree,
        aborted: () => context.abort.aborted,
      });
      if (typeof outcome === "string") return outcome;
      return {
        ...(outcome.title === undefined ? {} : { title: outcome.title }),
        output: outcome.output,
        metadata: outcome.note === undefined ? {} : { note: outcome.note },
        ...(outcome.attachments === undefined
          ? {}
          : {
              attachments: outcome.attachments.map((attachment) => ({
                type: "file",
                mime: attachment.mime,
                url: attachment.url,
                ...(attachment.filename === undefined ? {} : { filename: attachment.filename }),
              })),
            }),
      };
    },
  } as ToolDefinition;
}

/**
 * Count the bundled agent definitions for the startup log. The agents/*.md
 * files ship beside the built bundle — that is a packaging dependency of
 * the agent-config lane, which falls back to inline defaults when the
 * directory is absent. A missing dir is therefore empty, never fatal.
 */
function countBundledAgents(resolveDir: () => string): number {
  try {
    const dir = resolveDir();
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((name) => name.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * Translate the Omo interface table onto host Hooks. Most handlers share
 * input shapes and pass through; the mismatches get explicit bridges:
 * command arguments (`arguments` vs `argsText`), chat.params output
 * (`options` vs `providerOptions`), tool results (`metadata` vs
 * `truncated`/`note`), and SDK events (`{type, properties}` vs Omo names).
 */
function adaptInterface(iface: OmoPluginInterface, directory: string, worktree: string): Hooks {
  const adapted: Hooks = {};

  if (iface.tool) {
    const tools: Record<string, ToolDefinition> = {};
    for (const [name, entry] of Object.entries(iface.tool)) {
      tools[name] = adaptTool(directory, worktree, entry);
    }
    adapted.tool = tools;
  }

  if (iface["chat.params"]) {
    const handler = iface["chat.params"];
    adapted["chat.params"] = async (input, output) => {
      const omoOutput: OmoChatParamsOutput = {};
      await handler(
        { sessionID: input.sessionID, agent: input.agent, model: modelRefOf(input.model) },
        omoOutput,
      );
      if (omoOutput.temperature !== undefined) output.temperature = omoOutput.temperature;
      if (omoOutput.topP !== undefined) output.topP = omoOutput.topP;
      if (omoOutput.topK !== undefined) output.topK = omoOutput.topK;
      if (omoOutput.maxOutputTokens !== undefined) output.maxOutputTokens = omoOutput.maxOutputTokens;
      if (omoOutput.providerOptions !== undefined) {
        output.options = { ...output.options, ...omoOutput.providerOptions };
      }
    };
  }

  if (iface["chat.headers"]) {
    const handler = iface["chat.headers"];
    adapted["chat.headers"] = async (input, output) => {
      const omoOutput: OmoChatHeadersOutput = { headers: {} };
      await handler(
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: modelRefOf(input.model),
          providerID: stringFieldOf(fieldOf(input, "provider"), "id"),
        },
        omoOutput,
      );
      for (const [name, value] of Object.entries(omoOutput.headers)) {
        output.headers[name] = value;
      }
    };
  }

  if (iface["chat.message"]) {
    const handler = iface["chat.message"];
    adapted["chat.message"] = async (input, output) => {
      // The Omo handler reads user text from output.message.text, but the
      // host carries the prompt as text parts — synthesize the text side so
      // gate-fact observation sees the same prompt. Appended note parts land
      // in the live host array.
      const text = extractUserText(output.message, output.parts);
      await handler(
        {
          sessionID: input.sessionID,
          agent: input.agent,
          ...(input.model === undefined ? {} : { model: modelRefOf(input.model) }),
          ...(input.messageID === undefined ? {} : { messageID: input.messageID }),
          ...(input.variant === undefined ? {} : { variant: input.variant }),
        },
        { message: { text }, parts: output.parts },
      );
    };
  }

  if (iface["command.execute.before"]) {
    const handler = iface["command.execute.before"];
    adapted["command.execute.before"] = async (input, output) => {
      await handler(
        { command: input.command, sessionID: input.sessionID, argsText: input.arguments },
        { parts: output.parts },
      );
    };
  }

  if (iface["experimental.chat.messages.transform"]) {
    const handler = iface["experimental.chat.messages.transform"];
    adapted["experimental.chat.messages.transform"] = async (input) => {
      // Observation-only today: there is no host output to bridge.
      await handler(toJsonObject(input), { messages: [] });
    };
  }

  if (iface["experimental.chat.system.transform"]) {
    const handler = iface["experimental.chat.system.transform"];
    adapted["experimental.chat.system.transform"] = async (input, output) => {
      const omoOutput: OmoSystemTransformOutput = { system: [] };
      await handler(
        {
          ...(input.sessionID === undefined ? {} : { sessionID: input.sessionID }),
          model: modelRefOf(input.model),
        },
        omoOutput,
      );
      for (const line of omoOutput.system) output.system.push(line);
    };
  }

  if (iface.config) {
    const handler = iface.config;
    // The host config object is mutated in place; the Omo view shares the
    // same agent/command/mcp sections.
    adapted.config = async (input) => {
      await handler(input);
    };
  }

  if (iface.event) {
    const handler = iface.event;
    adapted.event = async (input) => {
      const normalized = normalizeEvent(input.event);
      if (normalized) await handler({ event: normalized });
    };
  }

  if (iface["tool.definition"]) {
    const handler = iface["tool.definition"];
    adapted["tool.definition"] = async (input, output) => {
      await handler({ toolID: input.toolID }, output);
    };
  }

  if (iface["tool.execute.before"]) {
    const handler = iface["tool.execute.before"];
    adapted["tool.execute.before"] = async (input, output) => {
      const omoOutput: OmoToolGuardOutput = { args: toJsonObject(output.args) };
      await handler(
        { tool: input.tool, sessionID: input.sessionID, callID: input.callID },
        omoOutput,
      );
      output.args = omoOutput.args;
    };
  }

  if (iface["tool.execute.after"]) {
    const handler = iface["tool.execute.after"];
    adapted["tool.execute.after"] = async (input, output) => {
      const omoOutput: OmoToolAfterOutput = {
        title: output.title,
        output: output.output,
        truncated: false,
      };
      await handler(
        {
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID,
          args: toJsonObject(input.args),
        },
        omoOutput,
      );
      output.title = omoOutput.title;
      output.output = omoOutput.output;
      const metadata =
        typeof output.metadata === "object" && output.metadata !== null
          ? (output.metadata as Record<string, unknown>)
          : {};
      output.metadata = {
        ...metadata,
        truncated: omoOutput.truncated,
        ...(omoOutput.note === undefined ? {} : { note: omoOutput.note }),
      };
    };
  }

  return adapted;
}

export function createPluginModule(overrides: Partial<PluginModuleDeps> = {}): PluginModule {
  const deps: PluginModuleDeps = { ...defaultPluginModuleDeps, ...overrides };

  const server: Plugin = async (input: PluginInput) => {
    deps.installAgentSortShim();
    deps.initConfigContext("opencode", null);
    deps.log(`[${PLUGIN_NAME}] plugin loading`, { directory: input.directory });
    deps.migrateLegacyWorkspace(input.directory);

    const validation = deps.validatePluginConfig(input.directory);
    if (!validation.valid) {
      deps.log(`[${PLUGIN_NAME}] config diagnostics`, { messages: validation.messages });
    }

    const duplicates = deps.detectDuplicateOmoPlugin(input.directory);
    if (duplicates.detected) {
      deps.log(`[${PLUGIN_NAME}] duplicate plugin entries — startup disabled for this instance`, {
        duplicates: duplicates.duplicatePlugins,
      });
      return {};
    }

    const pluginConfig = deps.loadPluginConfig(input.directory, { directory: input.directory });
    const bundledAgents = countBundledAgents(deps.resolveBundledAgentsDir);
    deps.log(`[${PLUGIN_NAME}] startup`, {
      directory: input.directory,
      bundledAgents,
    });

    const ctx: OmoPluginContext = {
      directory: input.directory,
      pluginConfig,
      // Presence marker: surface adapters attach lazily downstream.
      client: input.client ? {} : undefined,
    };

    const managers = deps.createManagers(ctx);
    const createdTools = await deps.createTools(ctx, pluginConfig, managers);

    const disabled = new Set(pluginConfig.disabled_hooks ?? []);
    const flags: OmoHookFlags = {
      isHookEnabled: (name) => !disabled.has(name),
      safeHookEnabled: pluginConfig.experimental?.safe_hook_creation ?? true,
    };

    const hooks = deps.createHooks(
      ctx,
      flags,
      { mergedSkills: createdTools.mergedSkills, availableSkills: createdTools.availableSkills },
      managers,
    );

    const iface = deps.createPluginInterface(ctx, pluginConfig, managers, hooks, createdTools);

    const disposePlugin = deps.createPluginDispose(
      {
        managers: {
          backgroundManager: managers.backgroundManager,
          skillMcpManager: managers.skillMcpManager,
        },
        hooks: { disposeHooks: hooks.disposeHooks },
      },
    );

    return {
      ...adaptInterface(iface, input.directory, input.worktree),

      "experimental.session.compacting": async (compactInput, compactOutput) => {
        const facts = readGateFacts(compactInput.sessionID);
        compactOutput.context.push(
          `[${PLUGIN_NAME}] compacting session ${compactInput.sessionID}: ` +
            `planRequested=${facts.userRequestedPlan} ` +
            `planArtifact=${facts.planArtifactTouched} ` +
            `executed=${facts.executeStarted}`,
        );
      },

      "experimental.compaction.autocontinue": async (autoInput, autoOutput) => {
        void autoInput;
        // Keep the host default; dispatch policy lives outside the entry.
        autoOutput.enabled = true;
      },

      dispose: async () => {
        await disposePlugin();
      },
    };
  };

  return { id: PLUGIN_NAME, server };
}
