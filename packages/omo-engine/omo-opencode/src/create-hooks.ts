/**
 * create-hooks.ts — native hook assembly for the OpenCode plugin entry.
 *
 * Fans the frozen hook inputs out to three tier factories — core, continuation,
 * and skill — then merges their registries into the tiered `OmoCreatedHooks`
 * output. Every hook inside every tier is already gated by its own
 * `flags.isHookEnabled` check and guarded at creation by `safeCreateHook`, so
 * a disabled hook is absent and a throwing factory degrades to absent instead
 * of breaking startup. `disposeHooks` releases each tier's disposables in
 * order, isolating failures so one bad cleanup cannot block the rest.
 */

import type { OmoCreateHooks, OmoCreatedHooks } from "./plugin-types";
import { log } from "./shared/logger";
import { createContinuationHooks } from "./plugin/hooks/continuation-hooks";
import { createCoreHooks } from "./plugin/hooks/core-hooks";
import { createSkillHooks } from "./plugin/hooks/skill-hooks";

export const createHooks: OmoCreateHooks = (ctx, flags, skills, managers) => {
  const core = createCoreHooks(ctx, flags, managers);
  const continuation = createContinuationHooks(ctx, flags, managers);
  const skill = createSkillHooks(ctx, flags, skills);

  const disposables: Array<() => void> = [
    ...core.disposables,
    ...continuation.disposables,
    ...skill.disposables,
  ];

  const created: OmoCreatedHooks = {
    coreHooks: core.hooks,
    continuationHooks: continuation.hooks,
    skillHooks: skill.hooks,
    disposeHooks: () => {
      for (const dispose of disposables) {
        try {
          dispose();
        } catch (error) {
          log("[create-hooks] Hook dispose failed", { error });
        }
      }
    },
  };
  return created;
};
