/**
 * plugin-setup.ts — OpenCode V2 `setup(ctx)` translation for the native plugin.
 *
 * The V1 object entry (`server()`) is invisible to the V2 host, so this
 * module runs the SAME init chain as
 * `testing/create-plugin-module.ts` — validate → loadPluginConfig →
 * managers → tools → hooks → interface builders — and translates the
 * resulting host-facing hook table onto the V2 `ctx` domains instead of
 * returning it.
 *
 * Reuse rule: entry SHAPES come from the existing lanes
 * (`assembleAgentEntries` / `finalizeAgentConfig` / `tool-config`, the
 * interface builders, `gate-facts`). Only the host-registration calls
 * (`editor.add`, `session.hook`, `tool.hook`, `event.subscribe`, the cleanup
 * return) are new here.
 *
 * Agents are NOT registered here: the V2 agent editor has no add()
 * (update/list/get/default/remove only), so the transform path throws on the
 * real host. Custom agents ship as static entries through the managed
 * OpenCode config file (`OMO_NATIVE_AGENT_CONFIG`) instead.
 *
 * Deliberately dependency-free: no `@opencode/plugin` import (unavailable
 * in this workspace). The V2 host accepts any default export shaped as
 * `{ id, setup }`, so this file defines the minimal structural ctx types it
 * touches instead of importing the host SDK.
 */

import { validatePluginConfig } from "./config/validate";
import { createHooks } from "./create-hooks";
import { createManagers } from "./create-managers";
import { createTools } from "./create-tools";
import { loadPluginConfig } from "./plugin-config";
import { createPluginDispose } from "./plugin-dispose";
import { createPluginInterface } from "./plugin-interface";
import { applyCommandConfig } from "./plugin-handlers/command-config-handler";
import { applyMcpConfig } from "./plugin-handlers/mcp-config-handler";
import { loadPluginComponents } from "./plugin-handlers/plugin-components-loader";
import { applyProviderConfig } from "./plugin-handlers/provider-config-handler";
import type {
  OmoCreatedHooks,
  OmoHostConfig,
  OmoJsonObject,
  OmoPluginEvent,
  OmoPluginInterface,
  OmoToolDefinition,
  OmoToolParametersSchema,
} from "./plugin-types";
import {
  detectDuplicateOmoPlugin,
  getDuplicateOmoPluginWarning,
} from "./shared/external-plugin-detector";
import {
  isExplicitPlanRequest,
  noteExecutionStart,
  notePlanArtifact,
  noteUserPlanRequest,
  readGateFacts,
} from "./shared/gate-facts";
import { checkForLegacyPluginEntry } from "./shared/legacy-plugin-warning";
import { evaluatePlanGate, invocationGateDenial } from "./guards/plan-gate";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { migrateLegacyWorkspaceDirectory } from "./shared/legacy-workspace-migration";
import { log } from "./shared/logger";
import { migrateLegacyPluginEntry } from "./shared/migrate-legacy-plugin-entry";
import { PLUGIN_NAME } from "./shared/plugin-identity";

/* ------------------------------------------------------------------ */
/* Minimal V2 ctx shapes (structural; no host SDK import).              */
/* ------------------------------------------------------------------ */

export interface V2Registration {
  dispose(): void | Promise<void>;
}

export type V2TransformCallback<TEditor> = (editor: TEditor) => void;

// The real V2 host exposes update/list/get/default/remove only: there is no
// add(), so this plugin never registers agents through the editor. The
// interface keeps the proven surface exactly.
export interface V2AgentEditor {
  update(id: string, update: (agent: Record<string, unknown>) => void): void;
  remove(id: string): void;
  get(id: string): Record<string, unknown> | undefined;
  list(): readonly Record<string, unknown>[];
  default(id: string | undefined): void;
}

export interface V2ToolEditor {
  add(tool: Record<string, unknown>): void;
  update(id: string, update: (tool: Record<string, unknown>) => void): void;
  remove(id: string): void;
  get(id: string): Record<string, unknown> | undefined;
  list(): readonly Record<string, unknown>[];
  namespace(namespace: { name: string; description: string }): void;
}

export interface V2CommandEditor {
  add(definition: Record<string, unknown>): void;
}

export interface V2SkillEditor {
  add(skill: Record<string, unknown>): void;
}

export interface V2McpEditor {
  set(name: string, config: Record<string, unknown>): void;
  update(name: string, update: (config: Record<string, unknown>) => void): void;
  remove(name: string): void;
  get(name: string): Record<string, unknown> | undefined;
  list(): readonly (readonly [string, Record<string, unknown>])[];
}

export interface V2HookEvent {
  [key: string]: unknown;
}

export interface V2SetupContext {
  readonly location: {
    readonly directory: string;
    readonly project?: { readonly id?: string; readonly directory?: string };
  };
  readonly options?: unknown;
  readonly agent: {
    transform(callback: V2TransformCallback<V2AgentEditor>): Promise<V2Registration>;
    reload?(): Promise<void>;
  };
  readonly tool: {
    transform(callback: V2TransformCallback<V2ToolEditor>): Promise<V2Registration>;
    hook(name: string, handler: (event: V2HookEvent) => void | Promise<void>): Promise<V2Registration>;
  };
  readonly session: {
    hook(
      name: string,
      handler: (event: V2HookEvent) => void | Promise<void>,
      options?: { providerID?: string },
    ): Promise<V2Registration>;
    prompt?(input: Record<string, unknown>): Promise<unknown>;
  };
  readonly command: {
    transform(callback: V2TransformCallback<V2CommandEditor>): Promise<V2Registration>;
  };
  readonly skill: {
    transform(callback: V2TransformCallback<V2SkillEditor>): Promise<V2Registration>;
  };
  readonly mcp: {
    transform(callback: V2TransformCallback<V2McpEditor>): Promise<V2Registration>;
  };
  readonly event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<unknown>;
  };
}

/* ------------------------------------------------------------------ */
/* Small structural helpers (same tolerance as the V1 entry boundary). */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFieldOf(value: unknown, field: string): string {
  if (isRecord(value)) {
    const candidate = value[field];
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function sessionIDOf(event: V2HookEvent): string {
  const direct = event["sessionID"];
  if (typeof direct === "string") return direct;
  const session = event["session"];
  if (isRecord(session) && typeof session["id"] === "string") return session["id"];
  return "";
}

/**
 * Extract the requested subagent name from task-tool args, scanning the
 * known fields and falling back to a whole-payload match. Returns null
 * when no agent identity is named.
 */
function extractRequestedSubagent(args: Record<string, unknown>): string | null {
  for (const field of ["subagent_type", "subagentType", "agent", "agentName"]) {
    const value = args[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const flat = JSON.stringify(args);
  const hit = /plan-consultant|plan-reviewer/i.exec(flat);
  return hit ? hit[0].toLowerCase() : null;
}

/**
 * True when the project holds a user-touched plan artifact. Best-effort
 * filesystem read; any failure closes toward denial (fail-closed).
 */
function planArtifactTouched(directory: string): boolean {
  try {
    if (!directory) return false;
    const plansDir = join(directory, ".omo", "plans");
    if (!existsSync(plansDir)) return false;
    return readdirSync(plansDir).some((entry) => entry.endsWith(".md"));
  } catch {
    return false;
  }
}

/**
 * Throw the plan-gate denial when a task dispatch names a plan-gated agent
 * without session evidence. Runs inside execute.before so the denial blocks
 * the dispatch; throwing is the hook's documented blocking mechanism.
 */
function denyWithoutPlanEvidence(sessionID: string, requested: string, pluginDirectory: string): void {
  const denial = invocationGateDenial(requested);
  if (!denial) return;
  const facts = readGateFacts(sessionID);
  const verdict = evaluatePlanGate({
    userRequestedPlan: facts.userRequestedPlan,
    planArtifactTouched: facts.planArtifactTouched || planArtifactTouched(pluginDirectory),
    executeStarted: facts.executeStarted,
  });
  if (!verdict.allowed) {
    throw new Error(denial);
  }
}

/**
 * Normalize one V2 server-stream event into the Omo event the interface
 * lane observes. Accepts the V1 SDK envelope (`{ type, properties }`) and
 * the flat V2 shape (`{ type, sessionID/info... }`); anything else returns
 * undefined and is skipped, mirroring the V1 entry.
 */
export function toOmoEvent(event: unknown): OmoPluginEvent | undefined {
  if (!isRecord(event) || typeof event["type"] !== "string") return undefined;
  const type = event["type"] as string;
  const properties = isRecord(event["properties"])
    ? event["properties"]
    : event;
  const sessionString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

  switch (type) {
    case "session.created": {
      const info = isRecord(properties["info"])
        ? (properties["info"] as Record<string, unknown>)
        : properties;
      const sessionID = sessionString(info["id"]) ?? sessionString(properties["sessionID"]);
      if (!sessionID) return undefined;
      const parentID = sessionString(info["parentID"]) ?? sessionString(properties["parentID"]);
      const title = sessionString(info["title"]) ?? sessionString(properties["title"]);
      return {
        name: "session.created",
        sessionID,
        ...(parentID === undefined ? {} : { parentID }),
        ...(title === undefined ? {} : { title }),
      };
    }
    case "session.deleted": {
      const sessionID =
        sessionString(properties["sessionID"]) ??
        (isRecord(properties["info"])
          ? sessionString((properties["info"] as Record<string, unknown>)["id"])
          : undefined);
      if (!sessionID) return undefined;
      return { name: "session.deleted", sessionID };
    }
    case "session.status": {
      const sessionID = sessionString(properties["sessionID"]);
      if (!sessionID) return undefined;
      const status = properties["status"];
      const label =
        isRecord(status) && typeof status["type"] === "string"
          ? (status["type"] as string)
          : typeof status === "string"
            ? status
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
      const data = properties["error"];
      const message = isRecord(data) ? stringFieldOf(data["data"] ?? data, "message") : "";
      return {
        name: "session.error",
        sessionID,
        ...(message === "" || message === "unknown" ? {} : { message }),
      };
    }
    default:
      return undefined;
  }
}

/**
 * Convert one Omo tool parameter schema into the JSON Schema the V2 tool
 * editor expects. `allowedValues` become `enum`; `required` passes through.
 */
export function toJsonSchemaInput(schema: OmoToolParametersSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    properties[name] = {
      type: field.type,
      ...(field.description === undefined ? {} : { description: field.description }),
      ...(field.allowedValues === undefined ? {} : { enum: [...field.allowedValues] }),
    };
  }
  return {
    type: "object",
    properties,
    ...(schema.required === undefined ? {} : { required: [...schema.required] }),
    additionalProperties: false,
  };
}

/** Run one tier registry fan-out through every handler, tier by tier. */
async function fanOutTiers(
  hooks: OmoCreatedHooks,
  input: { sessionID?: string; [key: string]: unknown },
  sink?: string[],
): Promise<void> {
  const output: { note?: (text: string) => void } =
    sink === undefined ? {} : { note: (text: string) => sink.push(text) };
  for (const registry of [hooks.coreHooks, hooks.continuationHooks, hooks.skillHooks]) {
    for (const handler of Object.values(registry)) {
      if (typeof handler !== "function") continue;
      try {
        await (handler as (input: unknown, output: unknown) => unknown)(input, output);
      } catch {
        // Internal hooks are best-effort observations; host delivery wins.
      }
    }
  }
}

function toJsonObject(value: unknown): OmoJsonObject {
  return isRecord(value) ? (value as OmoJsonObject) : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Best-effort legacy hygiene, mirroring the V1 entry: the old workspace
 * directory first, then a stale package entry in the OpenCode config.
 * Either step may no-op; neither may break setup.
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

/**
 * Build the V2 `setup(ctx)` function. The init chain mirrors
 * `createPluginModule().server`: validate → loadPluginConfig → managers →
 * tools → hooks → interface builders, then translation onto `ctx` domains.
 * promise resolves to the V2 cleanup function, which runs the same dispose
 * chain (background → skill MCP → hook disposables) and aborts the event
 * subscription.
 */
export function createPluginSetup(): (ctx: V2SetupContext) => Promise<() => Promise<void>> {
  return async (ctx) => {
    const directory = ctx.location.directory;
    const worktree = directory;
    log(`[${PLUGIN_NAME}] plugin loading (v2 setup)`, { directory });
    migrateLegacyWorkspaceLocal(directory);

    const validation = validatePluginConfig(directory);
    if (!validation.valid) {
      log(`[${PLUGIN_NAME}] config diagnostics`, { messages: validation.messages });
    }

    const duplicates = detectDuplicateOmoPlugin(directory);
    if (duplicates.detected) {
      log(getDuplicateOmoPluginWarning(duplicates.duplicatePlugins), {
        duplicates: duplicates.duplicatePlugins,
      });
      return async () => {};
    }

    const pluginConfig = loadPluginConfig(directory, { directory });

    // Same stage functions, same order as the V1 server chain.
    const managers = createManagers({ directory, pluginConfig });
    const createdTools = await createTools({ directory, pluginConfig }, pluginConfig, managers);
    const disabled = new Set(pluginConfig.disabled_hooks ?? []);
    const hooks = createHooks(
      { directory, pluginConfig },
      {
        isHookEnabled: (name) => !disabled.has(name),
        safeHookEnabled: pluginConfig.experimental?.safe_hook_creation ?? true,
      },
      { mergedSkills: createdTools.mergedSkills, availableSkills: createdTools.availableSkills },
      managers,
    );
    const iface: OmoPluginInterface = createPluginInterface(
      { directory, pluginConfig },
      pluginConfig,
      managers,
      hooks,
      createdTools,
    );
    const disposePlugin = createPluginDispose({
      managers: {
        backgroundManager: managers.backgroundManager,
        skillMcpManager: managers.skillMcpManager,
      },
      hooks: { disposeHooks: hooks.disposeHooks },
    });

    // Staged config pipeline on a scratch host config so the command, MCP,
    // and provider-model stages reuse the exact V1 lane logic; each
    // translated section below reads its result. Agent entries are
    // intentionally NOT assembled here: the V2 agent editor has no add(),
    // so agents ship as static config through the managed OpenCode config
    // file instead of transform registration.
    const hostConfig: OmoHostConfig = { agent: {} };
    const pluginComponents = await loadPluginComponents({ directory, pluginConfig });
    const promptSkills = createdTools.mergedSkills;
    applyCommandConfig({ hostConfig, pluginConfig, pluginComponents, skills: promptSkills });
    applyMcpConfig({ hostConfig, pluginConfig });
    applyProviderConfig({ hostConfig, pluginConfig });

    // --- tools: the gated registry, with JSON-Schema inputs. ---
    if (iface.tool) {
      const toolEntries = Object.entries(iface.tool);
      if (toolEntries.length > 0) {
        await ctx.tool.transform((editor) => {
          for (const [name, entry] of toolEntries) {
            const tool = entry as OmoToolDefinition;
            editor.add({
              name,
              description: tool.description,
              input: toJsonSchemaInput(tool.args),
              execute: async (rawArgs: unknown, toolContext: V2HookEvent) => {
                const outcome = await tool.execute(toJsonObject(rawArgs), {
                  sessionID: textOf(toolContext["sessionID"]) || "unknown",
                  messageID: textOf(toolContext["messageID"]),
                  agent: textOf(toolContext["agent"]),
                  directory,
                  worktree,
                  aborted: () => {
                    const signal = toolContext["signal"];
                    return (
                      typeof AbortSignal !== "undefined" &&
                      signal instanceof AbortSignal &&
                      signal.aborted
                    );
                  },
                });
                if (typeof outcome === "string") return { content: outcome };
                return {
                  content: outcome.output,
                  ...(outcome.title === undefined ? {} : { title: outcome.title }),
                  ...(outcome.note === undefined ? {} : { metadata: { note: outcome.note } }),
                  ...(outcome.attachments === undefined
                    ? {}
                    : {
                        attachments: outcome.attachments.map((attachment) => ({
                          type: "file",
                          mime: attachment.mime,
                          url: attachment.url,
                          ...(attachment.filename === undefined
                            ? {}
                            : { filename: attachment.filename }),
                        })),
                      }),
                };
              },
            });
          }
        });
      }
    }
    // --- skills: discovered skills register for host resolution. ---
    if (promptSkills.length > 0) {
      await ctx.skill.transform((editor) => {
        for (const skill of promptSkills) {
          editor.add({
            id: skill.name,
            name: skill.name,
            ...(skill.definition.description
              ? { description: skill.definition.description }
              : {}),
            ...(skill.path ? { path: skill.path } : {}),
            ...(skill.definition.template ? { content: skill.definition.template } : {}),
          });
        }
      });
    }

    // --- commands: skill/component commands register with a
    // template-forwarding executor. ---
    const commandEntries = Object.entries(hostConfig.command ?? {});
    if (commandEntries.length > 0) {
      await ctx.command.transform((editor) => {
        for (const [name, command] of commandEntries) {
          const template = typeof command.template === "string" ? command.template : "";
          const description =
            typeof command.description === "string" ? command.description : undefined;
          editor.add({
            name,
            ...(description ? { description } : {}),
            execute: async (invocation: V2HookEvent) => {
              if (typeof ctx.session.prompt === "function") {
                await ctx.session.prompt({
                  sessionID: textOf(invocation["sessionID"]),
                  text: template,
                  delivery: invocation["delivery"] ?? "steer",
                });
              }
            },
          });
        }
      });
    }

    // --- MCP: the plugin contributes no servers; disabled names are
    // removed so the host does not connect them. ---
    const disabledMcps = pluginConfig.disabled_mcps ?? [];
    if (disabledMcps.length > 0) {
      await ctx.mcp.transform((editor) => {
        for (const name of disabledMcps) {
          try {
            editor.remove(name);
          } catch {
            // A missing server is already gone; removal is idempotent intent.
          }
        }
      });
    }

    // --- session.prompt: gate-fact observation (the V2 equivalent of the
    // V1 chat.message user-text path) plus tier fan-out notes. ---
    await ctx.session.hook("prompt", async (event) => {
      const prompt = isRecord(event["prompt"]) ? event["prompt"] : {};
      const text = textOf(prompt["text"]);
      const sessionID = sessionIDOf(event);
      if (sessionID && isExplicitPlanRequest(text)) {
        noteUserPlanRequest(sessionID, text);
      }
      const parts: Array<{ type: string; text: string }> = [];
      await iface["chat.message"]?.(
        {
          sessionID,
          ...(typeof event["agent"] === "string" ? { agent: event["agent"] } : {}),
        },
        { message: { text }, parts },
      );
      if (parts.length > 0 && typeof prompt["text"] === "string") {
        prompt["text"] = `${prompt["text"]}\n${parts.map((part) => part.text).join("\n")}`;
      }
      await fanOutTiers(hooks, { sessionID, text });
    });

    // --- session.context: model-request params + system lines (V1
    // chat.params + experimental.chat.system.transform). ---
    await ctx.session.hook("context", async (event) => {
      const sessionID = sessionIDOf(event);
      const model = isRecord(event["model"])
        ? {
            providerID: textOf(event["model"]["providerID"]) || "unknown",
            modelID: textOf(event["model"]["id"] ?? event["model"]["modelID"]) || "unknown",
          }
        : { providerID: "unknown", modelID: "unknown" };
      const paramsOutput: {
        temperature?: number;
        topP?: number;
        topK?: number;
        maxOutputTokens?: number;
        providerOptions?: OmoJsonObject;
      } = {};
      await iface["chat.params"]?.(
        { sessionID, agent: textOf(event["agent"]) || "unknown", model },
        paramsOutput,
      );
      const options = isRecord(event["options"]) ? event["options"] : {};
      if (paramsOutput.temperature !== undefined) options["temperature"] = paramsOutput.temperature;
      if (paramsOutput.topP !== undefined) options["topP"] = paramsOutput.topP;
      if (paramsOutput.topK !== undefined) options["topK"] = paramsOutput.topK;
      if (paramsOutput.maxOutputTokens !== undefined) {
        options["maxTokens"] = paramsOutput.maxOutputTokens;
      }
      if (paramsOutput.providerOptions !== undefined) {
        Object.assign(options, paramsOutput.providerOptions);
      }
      event["options"] = options;
      const systemOutput = { system: [] as string[] };
      await iface["experimental.chat.system.transform"]?.({ sessionID, model }, systemOutput);
      const systemLines = systemOutput.system;
      if (systemLines.length > 0) {
        const system = Array.isArray(event["system"]) ? event["system"] : [];
        for (const line of systemLines) system.push({ type: "text", text: line });
        event["system"] = system;
      }
    });

    // --- session.model.request: header injection (V1 chat.headers). ---
    await ctx.session.hook("model.request", async (event) => {
      const sessionID = sessionIDOf(event);
      const model = isRecord(event["model"])
        ? {
            providerID: textOf(event["model"]["providerID"]) || "unknown",
            modelID: textOf(event["model"]["id"] ?? event["model"]["modelID"]) || "unknown",
          }
        : { providerID: "unknown", modelID: "unknown" };
      const headers: Record<string, string> = isRecord(event["headers"])
        ? { ...(event["headers"] as Record<string, string>) }
        : {};
      await iface["chat.headers"]?.(
        {
          sessionID,
          agent: textOf(event["agent"]) || "unknown",
          model,
          providerID: model.providerID,
        },
        { headers },
      );
      event["headers"] = headers;
    });

    // --- session.compaction: carry the gate-fact triple into the summary
    // input (V1 experimental.session.compacting). ---
    await ctx.session.hook("compaction", async (event) => {
      const sessionID = sessionIDOf(event);
      if (!sessionID) return;
      const facts = readGateFacts(sessionID);
      const line =
        `[${PLUGIN_NAME}] compacting session ${sessionID}: ` +
        `planRequested=${facts.userRequestedPlan} ` +
        `planArtifact=${facts.planArtifactTouched} ` +
        `executed=${facts.executeStarted}`;
      const messages = Array.isArray(event["messages"]) ? event["messages"] : [];
      messages.push({
        id: `${PLUGIN_NAME}-gate-facts`,
        role: "system",
        parts: [{ type: "text", text: line }],
      });
      event["messages"] = messages;
    });

    // --- tool hooks: execution observation (gate facts) + tier fan-out,
    // mirroring V1 tool.execute.before/after. ---
    await ctx.tool.hook("execute.before", async (event) => {
      const toolName = textOf(event["tool"] ?? event["toolName"]);
      const sessionID = sessionIDOf(event) || textOf(event["sessionID"]);
      // Native plan-gate enforcement (mirrors invocationGateDenial): a task
      // dispatch naming a plan-gated agent is denied unless the session
      // carries the user-requested-planning triple. Checked BEFORE anything
      // else so a denial never marks execution or fans out. The final-gate
      // trio is deliberately NOT denied here: direct user invocation is an
      // explicit choice; final-gate staging is enforced in the team and MCP
      // dispatch paths instead.
      if (/^(task|call_omo_agent|delegate)/i.test(toolName)) {
        const requested = extractRequestedSubagent(toJsonObject(event["input"] ?? event["args"]));
        if (requested) denyWithoutPlanEvidence(sessionID, requested, directory);
      }
      if (/^(write|edit|bash|apply|patch|run|execute|task|call_omo_agent)/i.test(toolName)) {
        noteExecutionStart(sessionID);
      }
      const args = toJsonObject(event["input"] ?? event["args"]);
      const output = { args };
      await iface["tool.execute.before"]?.(
        { tool: toolName, sessionID, callID: textOf(event["callID"] ?? event["id"]) },
        output,
      );
      if (isRecord(event["input"])) event["input"] = output.args;
      if (isRecord(event["args"])) event["args"] = output.args;
      await fanOutTiers(hooks, { sessionID, toolName });
    });

    await ctx.tool.hook("execute.after", async (event) => {
      const toolName = textOf(event["tool"] ?? event["toolName"]);
      const sessionID = sessionIDOf(event) || textOf(event["sessionID"]);
      const rawOutput = event["output"];
      const outputText =
        typeof rawOutput === "string"
          ? rawOutput
          : isRecord(rawOutput)
            ? textOf(rawOutput["output"] ?? rawOutput["content"])
            : "";
      if (/(?:\.omo\/plans|plans\/[^"'`\s]*\.md)/i.test(outputText)) {
        notePlanArtifact(sessionID);
      }
      const notes: string[] = [];
      const afterOutput = {
        title: isRecord(rawOutput) ? textOf(rawOutput["title"]) : "",
        output: outputText,
        truncated: false,
      };
      await iface["tool.execute.after"]?.(
        {
          tool: toolName,
          sessionID,
          callID: textOf(event["callID"] ?? event["id"]),
          args: toJsonObject(event["input"] ?? event["args"]),
        },
        afterOutput,
      );
      if (isRecord(rawOutput)) {
        rawOutput["output"] = afterOutput.output;
        if (afterOutput.title) rawOutput["title"] = afterOutput.title;
      }
      await fanOutTiers(hooks, { sessionID, toolName, text: outputText }, notes);
      if (notes.length > 0 && isRecord(rawOutput)) {
        const existing = textOf(rawOutput["note"]);
        rawOutput["note"] = existing ? `${existing}\n${notes.join("\n")}` : notes.join("\n");
      }
    });

    // --- events: the public server stream (V1 event hook). Hook
    // registrations are host-scoped and auto-disposed; only the stream
    // needs explicit teardown via the cleanup below. ---
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const raw of ctx.event.subscribe({ signal: controller.signal })) {
          if (controller.signal.aborted) break;
          const normalized = toOmoEvent(raw);
          if (normalized) {
            try {
              await iface.event?.({ event: normalized });
            } catch {
              // Event observation never breaks the stream.
            }
          }
        }
      } catch {
        // Aborted or disconnected streams end here; cleanup owns teardown.
      }
    })();

    return async () => {
      controller.abort();
      await disposePlugin();
    };
  };
}
