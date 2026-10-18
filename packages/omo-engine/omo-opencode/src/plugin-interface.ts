/**
 * plugin-interface.ts — host-facing hook table for the native plugin entry.
 *
 * Each handler does up to three things, in order:
 *
 * 1. Record gate facts. Only user-originated hooks (chat.message,
 *    command.execute.before, event, tool.execute) touch the session store,
 *    and only chat.message / plan-named commands may mark a plan request.
 *    The message/system transforms are the model-read path and stay out
 *    of the store entirely.
 * 2. Fan out to the assembled tier registries (core, continuation, skill)
 *    with a session-scoped envelope. Internal hooks self-filter on the
 *    envelope slices they understand; a throwing internal hook is caught
 *    so it can never break host delivery.
 * 3. Forward collected notes through the host output's natural channel:
 *    appended text parts for chat.message and command.execute.before, a
 *    note field for tool.execute.after, system lines for the system
 *    transform. Outputs without such a channel drop the notes.
 *
 * Subagent lifecycle also lands here: a session.created event carrying a
 * parent becomes a subagent birth, and session.deleted becomes a death.
 */

import type {
  OmoCreatedHooks,
  OmoCreatedTools,
  OmoCreatePluginInterface,
  OmoHookInput,
  OmoHookOutput,
  OmoHookRegistry,
  OmoPluginInterface,
} from "./plugin-types";
import {
  isExplicitPlanRequest,
  noteExecutionStart,
  notePlanArtifact,
  noteUserPlanRequest,
} from "./shared/gate-facts";

type TierRegistries = readonly OmoHookRegistry[];

function tiersOf(hooks: OmoCreatedHooks): TierRegistries {
  return [hooks.coreHooks, hooks.continuationHooks, hooks.skillHooks];
}

/**
 * Run every internal handler against one envelope, in tier order, awaiting
 * each in turn. Notes accumulate into `sink` when one is given.
 */
async function fanOut(
  registries: TierRegistries,
  input: OmoHookInput,
  sink?: string[],
): Promise<void> {
  const output: OmoHookOutput =
    sink === undefined ? {} : { note: (text: string) => sink.push(text) };
  for (const registry of registries) {
    for (const handler of Object.values(registry)) {
      if (typeof handler !== "function") continue;
      try {
        await handler(input, output);
      } catch {
        // Internal hooks are best-effort observations; host delivery wins.
      }
    }
  }
}

/** A command name counts as planning-related when it mentions plans. */
const PLAN_COMMAND_PATTERN = /plan/i;

/**
 * Only an explicit plan-execution command closes the plan-review window.
 * Ordinary commands (help, status, skills) are not execution: planning
 * turns themselves are busy, so coarse signals would veto the gate
 * before a consultant could ever dispatch.
 */
const PLAN_EXECUTION_COMMAND_PATTERN = /ulw[-_]?execute/i;

/** Tool output counts as a plan artifact when it points at one. */
const PLAN_ARTIFACT_PATTERN = /(?:\.omo\/plans|plans\/[^"'`\s]*\.md)/i;

/**
 * Tool calls that shape the workspace count as execution; pure reads
 * (read/grep/glob and friends) never do. This is the observation side of
 * the user/model split: a model reading a file must not close the
 * plan-review window, while an actual write or task dispatch does.
 */
const EXECUTION_TOOL_PATTERN = /^(write|edit|bash|apply|patch|run|execute|task|call_omo_agent)/i;

function appendNotes(parts: { push: (part: { type: string; text: string }) => void }, notes: readonly string[]): void {
  for (const note of notes) parts.push({ type: "text", text: note });
}

export const createPluginInterface: OmoCreatePluginInterface = (
  ctx,
  pluginConfig,
  managers,
  hooks,
  tools,
) => {
  // Reserved for future per-directory / per-config policy. Behavior ships
  // unconditionally today: every hook below always observes.
  void ctx;
  void pluginConfig;

  const tiers = tiersOf(hooks);

  const iface: OmoPluginInterface = {
    tool: { ...tools.filteredTools },

    "chat.params": async (input) => {
      await fanOut(tiers, {
        sessionID: input.sessionID,
        agentName: input.agent,
        modelID: input.model.modelID,
        providerID: input.model.providerID,
      });
    },

    "chat.headers": async (input) => {
      await fanOut(tiers, {
        sessionID: input.sessionID,
        agentName: input.agent,
        modelID: input.model.modelID,
        providerID: input.model.providerID,
      });
    },

    "chat.message": async (input, output) => {
      // The only user-text path into the gate store: a chat.message with
      // an explicit plan request proves the user asked for planning.
      const text = output.message.text;
      if (input.sessionID && isExplicitPlanRequest(text)) {
        noteUserPlanRequest(input.sessionID, text);
      }
      const notes: string[] = [];
      await fanOut(
        tiers,
        {
          sessionID: input.sessionID,
          agentName: input.agent,
          modelID: input.model?.modelID,
          providerID: input.model?.providerID,
          text,
        },
        notes,
      );
      appendNotes(output.parts, notes);
    },

    "command.execute.before": async (input, output) => {
      if (input.sessionID) {
        if (PLAN_COMMAND_PATTERN.test(input.command)) {
          // Already classified by name: no text needed.
          noteUserPlanRequest(input.sessionID);
        } else if (PLAN_EXECUTION_COMMAND_PATTERN.test(input.command)) {
          noteExecutionStart(input.sessionID);
        }
      }
      const notes: string[] = [];
      await fanOut(
        tiers,
        {
          sessionID: input.sessionID,
          commandName: input.command,
          text: input.argsText,
        },
        notes,
      );
      appendNotes(output.parts, notes);
    },

    "experimental.chat.messages.transform": async () => {
      // Model-read path: transforms reshape what the model sees, so they
      // never feed the gate store and carry no internal notes.
    },

    "experimental.chat.system.transform": async (input, output) => {
      const notes: string[] = [];
      await fanOut(
        tiers,
        {
          sessionID: input.sessionID,
          modelID: input.model.modelID,
          providerID: input.model.providerID,
        },
        notes,
      );
      for (const note of notes) output.system.push(note);
    },

    config: managers.configHandler,

    event: async (input) => {
      const event = input.event;
      // No gate writes here: session.status fires for planning turns too,
      // so it must never close the plan-review window. Execution is
      // observed at the command/tool layer instead.
      if (event.name === "session.created" && event.parentID) {
        try {
          await managers.backgroundManager.noteSubagentBirth({
            sessionID: event.sessionID,
            parentID: event.parentID,
            title: event.title ?? event.sessionID,
          });
        } catch {
          // Birth tracking is observational; the session still exists.
        }
      } else if (event.name === "session.deleted") {
        try {
          await managers.backgroundManager.noteSubagentDeath({
            sessionID: event.sessionID,
          });
        } catch {
          // Death tracking is observational; the session is already gone.
        }
      }
      await fanOut(tiers, { sessionID: event.sessionID });
    },

    "tool.definition": async (input, output) => {
      // A definition fetch is a model-side read: it resolves the schema
      // and never touches the gate store.
      const entry = tools.filteredTools[input.toolID];
      if (entry) {
        output.description = entry.description;
        output.parameters = entry.args;
      }
    },

    "tool.execute.before": async (input) => {
      // Skill-invocation observation with the user/model split: reads stay
      // silent, execution-shaped tools close the plan-review window, and a
      // plan request is never inferred from a tool call.
      if (EXECUTION_TOOL_PATTERN.test(input.tool)) {
        noteExecutionStart(input.sessionID);
      }
      await fanOut(tiers, {
        sessionID: input.sessionID,
        toolName: input.tool,
      });
    },

    "tool.execute.after": async (input, output) => {
      if (PLAN_ARTIFACT_PATTERN.test(output.output)) {
        notePlanArtifact(input.sessionID);
      }
      const notes: string[] = [];
      await fanOut(
        tiers,
        {
          sessionID: input.sessionID,
          toolName: input.tool,
          text: output.output,
        },
        notes,
      );
      if (notes.length > 0) {
        output.note = output.note ? `${output.note}\n${notes.join("\n")}` : notes.join("\n");
      }
    },
  };

  return iface;
};
