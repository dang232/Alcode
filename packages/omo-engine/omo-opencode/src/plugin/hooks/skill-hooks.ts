/**
 * skill-hooks.ts — third hook tier: skill-driven reminders and commands.
 *
 * Both hooks are pure lookups over the skill inputs fanned in from the loader
 * lane: one reminds the session which skills exist when skill help is asked
 * for, the other resolves an explicit slash command (or leading `/token` in
 * the text) against the merged skill set. Each hook is gated by its own flag
 * and guarded at creation like every other tier. Neither hook owns state, so
 * this tier contributes no disposables.
 */

import { HookNameSchema } from "../../config/schema/hooks";
import type {
  OmoHookFlags,
  OmoHookHandler,
  OmoHookRegistry,
  OmoHookSkillInputs,
  OmoPluginContext,
} from "../../plugin-types";
import { log } from "../../shared/logger";
import { safeCreateHook } from "../../shared/safe-create-hook";

/** Registry plus cleanup callbacks produced by this tier (stateless: none). */
export interface SkillHookGroup {
  readonly hooks: OmoHookRegistry;
  readonly disposables: readonly (() => void)[];
}

/**
 * Publish one handler under a validated hook name. Names that drifted out of
 * the schema are skipped with a log instead of leaking an unknown key to the
 * interface lane.
 */
function registerHook(
  registry: { [hookName: string]: OmoHookHandler | undefined },
  name: string,
  handler: OmoHookHandler | null,
): void {
  if (handler === null) {
    return;
  }
  if (!HookNameSchema.safeParse(name).success) {
    log(`[skill-hooks] Skipping unknown hook name: ${name}`);
    return;
  }
  registry[name] = handler;
}

/**
 * When the session text asks about skills, list the available ones (bounded
 * so the note stays small). Silent when nothing mentions skills or when no
 * skills were loaded.
 */
function createCategorySkillReminderHook(skills: OmoHookSkillInputs): OmoHookHandler {
  return (input, output) => {
    const text = input.text;
    if (!text || !/skill/i.test(text)) {
      return;
    }
    const names = skills.availableSkills
      .map((skill) => skill.name)
      .filter((name) => name.length > 0);
    if (names.length === 0) {
      return;
    }
    const shown = names.slice(0, 5).join(", ");
    const remainder = names.length > 5 ? ` (+${names.length - 5} more)` : "";
    output.note?.(`Available skills: ${shown}${remainder}`);
  };
}

/** Read a leading `/token` out of free text, if present. */
function parseSlashCommand(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const token = trimmed.slice(1).split(/\s/, 1)[0];
  return token ? token : undefined;
}

/**
 * Resolve an explicit command name (or a leading `/token`) against the merged
 * skill set and announce the match. Silent when there is no command to
 * resolve or no skill by that name.
 */
function createAutoSlashCommandHook(
  directory: string,
  skills: OmoHookSkillInputs,
): OmoHookHandler {
  return (input, output) => {
    const commandName = input.commandName ?? parseSlashCommand(input.text);
    if (!commandName) {
      return;
    }
    const match = skills.mergedSkills.find(
      (skill) => skill.name === commandName || skill.definition.name === commandName,
    );
    if (!match) {
      return;
    }
    const description = match.definition.description ? ` — ${match.definition.description}` : "";
    output.note?.(`Auto slash command /${match.name}${description} (project: ${directory})`);
  };
}

export function createSkillHooks(
  ctx: OmoPluginContext,
  flags: OmoHookFlags,
  skills: OmoHookSkillInputs,
): SkillHookGroup {
  const directory = ctx.directory;
  const hooks: { [hookName: string]: OmoHookHandler | undefined } = {};
  const disposables: Array<() => void> = [];
  const guard = <T>(name: string, factory: () => T): T | null =>
    safeCreateHook(name, factory, { enabled: flags.safeHookEnabled });

  if (flags.isHookEnabled("category-skill-reminder")) {
    registerHook(
      hooks,
      "category-skill-reminder",
      guard("category-skill-reminder", () => createCategorySkillReminderHook(skills)),
    );
  }

  if (flags.isHookEnabled("auto-slash-command")) {
    registerHook(
      hooks,
      "auto-slash-command",
      guard("auto-slash-command", () => createAutoSlashCommandHook(directory, skills)),
    );
  }

  return { hooks, disposables };
}
