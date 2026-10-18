/**
 * plugin-types.ts — frozen shared contracts for the native OpenCode plugin entry.
 *
 * Five parallel implementation lanes build against this file. Treat every
 * exported name as frozen: additions need a contract amendment, renames and
 * widening are not allowed without one.
 *
 * Rules for this module:
 * - Type-only code. No runtime imports, no runtime statements; only
 *   `import type` is permitted so the file bun-imports with zero side effects.
 * - `OhMyOpenCodeConfig`, `AvailableSkill`, and `HookName` are imported from
 *   their existing Alwork definitions, never redeclared here.
 * - Everything else is a precise structural interface written in our own
 *   words. Public contracts use no `any`, no `unknown`, and no
 *   `Record<string, unknown>`; genuinely JSON-shaped values use the bounded
 *   `OmoJsonValue` union below.
 * - Lanes adapt these structures to the host SDK at the entry boundary; this
 *   file never imports the SDK itself.
 */

import type { OhMyOpenCodeConfig } from "./config/schema/oh-my-opencode-config";
import type { AvailableSkill } from "./agents/dynamic-agent-prompt-types";
import type { HookName } from "./config/schema/hooks";

/** Stable alias so lanes reference hook names through this contract file. */
export type OmoHookName = HookName;

/* ------------------------------------------------------------------ */
/* JSON helpers: the only open-shaped values in these contracts.       */
/* ------------------------------------------------------------------ */

/** Any JSON value: primitives, arrays, or objects with JSON values. */
export type OmoJsonValue = string | number | boolean | null | readonly OmoJsonValue[] | OmoJsonObject;

/** A JSON object whose values are all JSON values. */
export interface OmoJsonObject {
  readonly [key: string]: OmoJsonValue;
}

/* ------------------------------------------------------------------ */
/* Plugin context: what every stage receives from the entry.           */
/* ------------------------------------------------------------------ */

export type OmoToastVariant = "info" | "success" | "warning" | "error";

export interface OmoToastBody {
  readonly title: string;
  readonly message: string;
  readonly variant: OmoToastVariant;
}

export interface OmoTuiHandle {
  showToast: (body: OmoToastBody) => Promise<void>;
}

export interface OmoSessionHandle {
  readonly id: string;
  readonly parentID?: string;
  readonly title?: string;
}

export interface OmoSessionDirectory {
  fetchSession: (sessionID: string) => Promise<OmoSessionHandle>;
}

/**
 * The host handle the plugin uses to talk back to OpenCode.
 * Surfaces stay optional because the host exposes them independently.
 */
export interface OmoPluginClient {
  readonly tui?: OmoTuiHandle;
  readonly sessions?: OmoSessionDirectory;
}

/** Entry input shared by every stage: project directory, config, host client. */
export interface OmoPluginContext {
  readonly directory: string;
  readonly pluginConfig: OhMyOpenCodeConfig;
  readonly client?: OmoPluginClient;
}

/* ------------------------------------------------------------------ */
/* Managers: created once by the managers lane, consumed downstream.   */
/* ------------------------------------------------------------------ */

export interface OmoSubagentBirth {
  readonly sessionID: string;
  readonly parentID: string;
  readonly title: string;
}

export interface OmoSubagentDeath {
  readonly sessionID: string;
}

/** Owns subagent session tracking and shuts down cleanly on dispose. */
export interface OmoBackgroundManager {
  shutdown: () => Promise<void>;
  noteSubagentBirth: (event: OmoSubagentBirth) => Promise<void>;
  noteSubagentDeath: (event: OmoSubagentDeath) => Promise<void>;
}

export interface OmoSkillToolRequest {
  readonly serverName: string;
  readonly toolName: string;
  readonly args: OmoJsonObject;
}

export interface OmoSkillToolResponse {
  readonly output: string;
  readonly isError: boolean;
}

/** Serves skill-embedded MCP tools and disconnects them on dispose. */
export interface OmoSkillMcpManager {
  disconnectAll: () => Promise<void>;
  callSkillTool: (request: OmoSkillToolRequest) => Promise<OmoSkillToolResponse>;
}

export interface OmoModelFallbackDecision {
  readonly fallbackModelID?: string;
  readonly reason: string;
}

export interface OmoModelFallbackController {
  decideFallback: (failedModelID: string) => OmoModelFallbackDecision;
}

/** Indirection so hooks always reach the current fallback controller. */
export interface OmoModelFallbackControllerAccessor {
  current: () => OmoModelFallbackController | undefined;
}

/** Present only when monitoring is enabled in plugin config. */
export interface OmoMonitorManager {
  readonly enabled: boolean;
  shutdown: () => Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Host config view: the mutable object the config stage fills in.     */
/* ------------------------------------------------------------------ */

/**
 * Per-tool allow/deny map in host shape (`tools: Record<string, boolean>`).
 * Matches the OpenCode AgentConfig tools field exactly so entries register
 * without host-side rejection.
 */
export type OmoAgentToolPolicy = Record<string, boolean>;

/** Per-tool permission gates in host shape (`permission` object). */
export interface OmoAgentPermission {
  readonly [tool: string]: "allow" | "ask" | "deny";
}

/** One agent entry as written into the host `agent` map. */
export interface OmoAgentConfigEntry {
  readonly model?: string;
  readonly description?: string;
  readonly mode?: string;
  readonly color?: string;
  readonly temperature?: number;
  readonly prompt?: string;
  readonly promptAppend?: string;
  readonly tools?: OmoAgentToolPolicy;
  readonly permission?: OmoAgentPermission;
  readonly disable?: boolean;
}

export interface OmoAgentConfigMap {
  [agentName: string]: OmoAgentConfigEntry;
}

/** One MCP server entry as written into the host `mcp` map. */
export interface OmoMcpServerEntry {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly enabled?: boolean;
}

export interface OmoMcpServerMap {
  [serverName: string]: OmoMcpServerEntry;
}

export interface OmoCommandConfigMap {
  [commandName: string]: OmoCommandDefinition;
}

/**
 * Structural view of the host config object. The config stage fills the
 * `agent`, `command`, and `mcp` sections and may set `default_agent`; keys
 * outside this view pass through untouched.
 */
export interface OmoHostConfig {
  agent: OmoAgentConfigMap;
  default_agent?: string;
  command?: OmoCommandConfigMap;
  mcp?: OmoMcpServerMap;
}

/** Applies the staged config pipeline to one mutable host config object. */
export type OmoConfigHandler = (hostConfig: OmoHostConfig) => Promise<void>;

/** The five manager handles shared across lanes. */
export interface OmoManagers {
  readonly backgroundManager: OmoBackgroundManager;
  readonly skillMcpManager: OmoSkillMcpManager;
  readonly modelFallbackControllerAccessor: OmoModelFallbackControllerAccessor;
  readonly monitorManager?: OmoMonitorManager;
  readonly configHandler: OmoConfigHandler;
}

/* ------------------------------------------------------------------ */
/* Skills and commands: loader output shared by tools and hooks.       */
/* ------------------------------------------------------------------ */

export type OmoSkillScope = "builtin" | "config" | "user" | "project" | "opencode" | "opencode-project" | "shared";

export interface OmoWorkflowHandoff {
  readonly label: string;
  readonly agent: string;
  readonly prompt: string;
  readonly send?: boolean;
}

/** A slash-command definition: prompt template plus routing metadata. */
export interface OmoCommandDefinition {
  readonly name: string;
  readonly description?: string;
  readonly template: string;
  readonly agent?: string;
  readonly model?: string;
  readonly subtask?: boolean;
  readonly argumentHint?: string;
  readonly handoffs?: readonly OmoWorkflowHandoff[];
}

export interface OmoSkillMetadata {
  readonly [key: string]: string;
}

/** One discovered skill: its command definition plus where it came from. */
export interface OmoLoadedSkill {
  readonly name: string;
  readonly path?: string;
  readonly resolvedPath?: string;
  readonly definition: OmoCommandDefinition;
  readonly scope: OmoSkillScope;
  readonly license?: string;
  readonly compatibility?: string;
  readonly allowedTools?: readonly string[];
  readonly metadata?: OmoSkillMetadata;
}

/* ------------------------------------------------------------------ */
/* Tools: the filtered registry handed to the host.                    */
/* ------------------------------------------------------------------ */

export type OmoToolArgumentFieldType = "string" | "number" | "boolean" | "array" | "object";

export interface OmoToolArgumentField {
  readonly type: OmoToolArgumentFieldType;
  readonly description?: string;
  readonly allowedValues?: readonly string[];
}

/** JSON-schema-style shape describing one tool's accepted arguments. */
export interface OmoToolParametersSchema {
  readonly properties: { readonly [argumentName: string]: OmoToolArgumentField };
  readonly required?: readonly string[];
}

export interface OmoToolContext {
  readonly sessionID: string;
  readonly messageID: string;
  readonly agent: string;
  readonly directory: string;
  readonly worktree: string;
  readonly aborted: () => boolean;
}

export interface OmoToolAttachment {
  readonly kind: "file";
  readonly mime: string;
  readonly url: string;
  readonly filename?: string;
}

export interface OmoToolStructuredOutcome {
  readonly title?: string;
  readonly output: string;
  readonly note?: string;
  readonly attachments?: readonly OmoToolAttachment[];
}

export type OmoToolOutcome = string | OmoToolStructuredOutcome;

export type OmoToolExecute = (args: OmoJsonObject, context: OmoToolContext) => Promise<OmoToolOutcome>;

/** One registry entry: documentation, argument shape, and executor. */
export interface OmoToolDefinition {
  readonly description: string;
  readonly args: OmoToolParametersSchema;
  readonly execute: OmoToolExecute;
}

export interface OmoToolMap {
  [toolName: string]: OmoToolDefinition;
}

/** Tools-lane output: the gated registry plus the skill inputs behind it. */
export interface OmoCreatedTools {
  readonly filteredTools: OmoToolMap;
  readonly mergedSkills: OmoLoadedSkill[];
  readonly availableSkills: AvailableSkill[];
}

/* ------------------------------------------------------------------ */
/* Hooks: tiered registries assembled by the hooks lane.                */
/* ------------------------------------------------------------------ */

/**
 * Envelope carried into every hook handler. Fields are optional because
 * tiers inspect different slices; handlers narrow on what they need.
 */
export interface OmoHookInput {
  readonly sessionID?: string;
  readonly agentName?: string;
  readonly modelID?: string;
  readonly providerID?: string;
  readonly toolName?: string;
  readonly commandName?: string;
  readonly text?: string;
}

/** Mutation surface a hook handler may use on the host output object. */
export interface OmoHookOutput {
  readonly note?: (text: string) => void;
  readonly replaceText?: (text: string) => void;
}

export type OmoHookHandler = (input: OmoHookInput, output: OmoHookOutput) => void | Promise<void>;

/** One tier's hook table, keyed by hook name. */
export interface OmoHookRegistry {
  readonly [hookName: string]: OmoHookHandler | undefined;
}

/** Gates for hook assembly: per-hook enablement plus safe-creation mode. */
export interface OmoHookFlags {
  isHookEnabled: (hookName: OmoHookName) => boolean;
  safeHookEnabled: boolean;
}

/** Skill inputs fanned into hook assembly (category reminders, commands). */
export interface OmoHookSkillInputs {
  readonly mergedSkills: OmoLoadedSkill[];
  readonly availableSkills: AvailableSkill[];
}

/** Live manager handles the hooks lane subscribes to. */
export type OmoHookManagers = Pick<OmoManagers, "backgroundManager" | "modelFallbackControllerAccessor" | "monitorManager">;

/**
 * Hooks-lane output, grouped by composition tier. `disposeHooks` releases
 * every disposable hook and is consumed by the dispose stage.
 */
export interface OmoCreatedHooks {
  readonly coreHooks: OmoHookRegistry;
  readonly continuationHooks: OmoHookRegistry;
  readonly skillHooks: OmoHookRegistry;
  readonly disposeHooks: () => void;
}

/* ------------------------------------------------------------------ */
/* Plugin interface: the host-facing hook table.                        */
/* ------------------------------------------------------------------ */

export interface OmoModelRef {
  readonly providerID: string;
  readonly modelID: string;
}

export interface OmoHeaderMap {
  [headerName: string]: string;
}

export interface OmoUserMessage {
  readonly text: string;
  readonly label?: string;
}

export interface OmoMessagePart {
  readonly type: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly toolCallID?: string;
}

export interface OmoChatMessageInput {
  readonly sessionID: string;
  readonly agent?: string;
  readonly model?: OmoModelRef;
  readonly messageID?: string;
  readonly variant?: string;
}

export interface OmoChatMessageOutput {
  message: OmoUserMessage;
  parts: OmoMessagePart[];
}

export interface OmoChatParamsInput {
  readonly sessionID: string;
  readonly agent: string;
  readonly model: OmoModelRef;
}

export interface OmoChatParamsOutput {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  providerOptions?: OmoJsonObject;
}

export interface OmoChatHeadersInput {
  readonly sessionID: string;
  readonly agent: string;
  readonly model: OmoModelRef;
  readonly providerID: string;
}

export interface OmoChatHeadersOutput {
  headers: OmoHeaderMap;
}

export interface OmoCommandInput {
  readonly command: string;
  readonly sessionID: string;
  readonly argsText: string;
}

export interface OmoCommandOutput {
  parts: OmoMessagePart[];
}

export interface OmoToolGuardInput {
  readonly tool: string;
  readonly sessionID: string;
  readonly callID: string;
}

export interface OmoToolGuardOutput {
  args: OmoJsonObject;
}

export interface OmoToolAfterInput extends OmoToolGuardInput {
  readonly args: OmoJsonObject;
}

export interface OmoToolAfterOutput {
  title: string;
  output: string;
  truncated: boolean;
  note?: string;
}

export interface OmoToolDefinitionInput {
  readonly toolID: string;
}

export interface OmoToolDefinitionOutput {
  description: string;
  parameters: OmoToolParametersSchema;
}

export interface OmoChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly parts: OmoMessagePart[];
}

export interface OmoMessagesTransformOutput {
  messages: OmoChatMessage[];
}

export interface OmoSystemTransformInput {
  readonly sessionID?: string;
  readonly model: OmoModelRef;
}

export interface OmoSystemTransformOutput {
  system: string[];
}

export type OmoPluginEvent =
  | { readonly name: "session.created"; readonly sessionID: string; readonly parentID?: string; readonly title?: string }
  | { readonly name: "session.deleted"; readonly sessionID: string }
  | { readonly name: "session.idle"; readonly sessionID: string }
  | { readonly name: "session.error"; readonly sessionID: string; readonly message?: string }
  | { readonly name: "session.status"; readonly sessionID: string; readonly status: string };

export interface OmoEventInput {
  readonly event: OmoPluginEvent;
}

export interface OmoCompactingInput {
  readonly sessionID: string;
}

export interface OmoCompactingOutput {
  context: string[];
  prompt?: string;
}

export interface OmoAutocontinueInput {
  readonly sessionID: string;
  readonly agent: string;
  readonly model: OmoModelRef;
  readonly overflow: boolean;
}

export interface OmoAutocontinueOutput {
  enabled: boolean;
}

/**
 * The host-facing hook table. Every key mirrors one hook the OpenCode host
 * consumes; the entry lane adapts this table to the host plugin type.
 * First-message variant state is owned inside the interface lane, so no
 * gate object crosses this contract.
 */
export interface OmoPluginInterface {
  tool?: OmoToolMap;
  "chat.params"?: (input: OmoChatParamsInput, output: OmoChatParamsOutput) => Promise<void> | void;
  "chat.headers"?: (input: OmoChatHeadersInput, output: OmoChatHeadersOutput) => Promise<void> | void;
  "chat.message"?: (input: OmoChatMessageInput, output: OmoChatMessageOutput) => Promise<void> | void;
  "command.execute.before"?: (input: OmoCommandInput, output: OmoCommandOutput) => Promise<void> | void;
  "experimental.chat.messages.transform"?: (input: OmoJsonObject, output: OmoMessagesTransformOutput) => Promise<void> | void;
  "experimental.chat.system.transform"?: (input: OmoSystemTransformInput, output: OmoSystemTransformOutput) => Promise<void> | void;
  config?: OmoConfigHandler;
  event?: (input: OmoEventInput) => Promise<void> | void;
  "tool.definition"?: (input: OmoToolDefinitionInput, output: OmoToolDefinitionOutput) => Promise<void> | void;
  "tool.execute.before"?: (input: OmoToolGuardInput, output: OmoToolGuardOutput) => Promise<void> | void;
  "tool.execute.after"?: (input: OmoToolAfterInput, output: OmoToolAfterOutput) => Promise<void> | void;
  "experimental.session.compacting"?: (input: OmoCompactingInput, output: OmoCompactingOutput) => Promise<void> | void;
  "experimental.compaction.autocontinue"?: (input: OmoAutocontinueInput, output: OmoAutocontinueOutput) => Promise<void> | void;
  dispose?: OmoPluginDispose;
}

/* ------------------------------------------------------------------ */
/* Stage signatures: the five lanes plus the agent-config step.         */
/* ------------------------------------------------------------------ */

/**
 * Builds the shared managers from the entry context. The managers lane
 * derives tmux settings, model-cache state, and notification gating from
 * `ctx.pluginConfig` internally; none of that crosses this contract.
 */
export type OmoCreateManagers = (ctx: OmoPluginContext) => OmoManagers;

/** Manager handles the tools lane consumes (tmux stays inside managers). */
export type OmoToolManagers = Pick<
  OmoManagers,
  "backgroundManager" | "skillMcpManager" | "modelFallbackControllerAccessor" | "monitorManager"
>;

/** Assembles the skill context and the config-gated tool registry. */
export type OmoCreateTools = (
  ctx: OmoPluginContext,
  pluginConfig: OhMyOpenCodeConfig,
  managers: OmoToolManagers,
) => Promise<OmoCreatedTools>;

/**
 * Assembles the tiered hook registries. The trailing `managers` carry the
 * live handles hook assembly subscribes to; model-cache state is owned
 * inside the hooks lane.
 */
export type OmoCreateHooks = (
  ctx: OmoPluginContext,
  flags: OmoHookFlags,
  skills: OmoHookSkillInputs,
  managers: OmoHookManagers,
) => OmoCreatedHooks;

/** Wires managers, hooks, and tools into the host-facing hook table. */
export type OmoCreatePluginInterface = (
  ctx: OmoPluginContext,
  pluginConfig: OhMyOpenCodeConfig,
  managers: OmoManagers,
  hooks: OmoCreatedHooks,
  tools: OmoCreatedTools,
) => OmoPluginInterface;

export interface OmoDisposeParts {
  readonly managers: Pick<OmoManagers, "backgroundManager" | "skillMcpManager">;
  readonly hooks: Pick<OmoCreatedHooks, "disposeHooks">;
}

/** Single cleanup callback run on plugin teardown. */
export type OmoPluginDispose = () => Promise<void>;

/** Builds the idempotent teardown from the live managers and hooks. */
export type OmoCreatePluginDispose = (parts: OmoDisposeParts) => OmoPluginDispose;

/** Plugin components discovered for agent assembly. */
export interface OmoPluginComponents {
  readonly retryableLoadFailure: boolean;
  readonly commandNames: readonly string[];
  readonly skillNames: readonly string[];
}

/** Inputs for the agent-config step of the config pipeline. */
export interface OmoApplyAgentConfigParams {
  readonly hostConfig: OmoHostConfig;
  readonly pluginConfig: OhMyOpenCodeConfig;
  readonly projectDirectory: string;
  readonly pluginComponents: OmoPluginComponents;
}

/** Merges agent sources into the final host agent map. */
export type OmoApplyAgentConfig = (params: OmoApplyAgentConfigParams) => Promise<OmoAgentConfigMap>;
