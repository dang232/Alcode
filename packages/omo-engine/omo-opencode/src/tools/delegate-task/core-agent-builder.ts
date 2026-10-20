import type { CategoryConfig } from "../../config/schema"

/**
 * Shape of one core agent builder.
 *
 * Mirrors the builtin-category pattern (`config` + `description` +
 * `promptAppend`) with two agent-specific additions: the lowercase config
 * key and the one-line `role` used for the agent identity preamble.
 *
 * `config` pins the head of the agent's model-core fallback chain
 * (`AGENT_MODEL_REQUIREMENTS`), provider first (`provider/model`) plus the
 * head variant. It is consumed by static delivery (the managed OpenCode
 * config file), NOT by the live core assembly: there the model stays
 * resolver-driven, because a pinned entry model would win over the whole
 * fallback chain in the resolution pipeline.
 */
export interface CoreAgentBuilder {
  readonly key: string;
  readonly config: CategoryConfig;
  readonly description: string;
  readonly role: string;
  readonly promptAppend: string;
}
