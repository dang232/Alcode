import { transformModelForProvider, type DelegateFallbackEntry } from "../../../delegate-core/src/index.ts"
import type { OmoCategoryConfig } from "../../../omo-config-core/src/index.ts"

import { ANTHROPIC_CATEGORIES } from "./anthropic-categories"
import { GOOGLE_CATEGORIES } from "./google-categories"
import { KIMI_CATEGORIES } from "./kimi-categories"
import { OPENAI_CATEGORIES } from "./openai-categories"
import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import type { BuiltinCategoryDefinition } from "./types"

// Ported from packages/omo-opencode/src/tools/delegate-task/builtin-categories.ts.
export const BUILTIN_CATEGORY_DEFAULTS: readonly BuiltinCategoryDefinition[] = [
  ...GOOGLE_CATEGORIES,
  ...OPENAI_CATEGORIES,
  ...ANTHROPIC_CATEGORIES,
  ...KIMI_CATEGORIES,
] as const

export const DEFAULT_CATEGORIES: Readonly<Record<string, OmoCategoryConfig>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.config]),
)

export const CATEGORY_DESCRIPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.description]),
)

export const CATEGORY_CALLER_GUIDANCE: Readonly<Record<string, string | undefined>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.callerGuidance]),
)

export const CATEGORY_PROMPT_APPENDS: Readonly<Record<string, string>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.promptAppend]),
)

// A chain rung resolves when one of its own providers serves its model in the live registry:
// the registry spells it as omo's routing tables spell it (claude-fable-5-1) or through the
// provider-specific id transform delegate-core applies at resolution time (github-copilot:
// claude-fable-5.1, kimi-coding: k3). The provider is part of the check: a gateway re-publishing
// the model (openrouter/anthropic/claude-opus-5.5) resolves no builtin rung, because a builtin
// chain resolves only on the providers it lists (#9146).
export function isCategoryChainRungResolvable(
  entry: DelegateFallbackEntry,
  availableModels: ReadonlySet<string>,
): boolean {
  return entry.providers.some(
    (provider) =>
      availableModels.has(`${provider}/${entry.model}`)
      || availableModels.has(`${provider}/${transformModelForProvider(provider, entry.model)}`),
  )
}

// Dead-chain availability: a builtin-only category is usable only when at least one of its
// fallback-chain rungs resolves against the live registry. User-configured categories (any explicit
// categories.<name> entry) opt out - they are always listed and never gated.
export function isCategoryChainViable(
  categoryName: string,
  hasExplicitUserConfig: boolean,
  availableModels: ReadonlySet<string>,
): boolean {
  if (hasExplicitUserConfig) return true
  const chain = Object.hasOwn(CATEGORY_FALLBACK_CHAINS, categoryName)
    ? CATEGORY_FALLBACK_CHAINS[categoryName]
    : undefined
  if (chain === undefined || chain.length === 0) return true
  return chain.some((rung) => isCategoryChainRungResolvable(rung, availableModels))
}

export const CATEGORY_PROMPT_APPEND_RESOLVERS: Readonly<Record<string, (model: string | undefined) => string>> =
  Object.fromEntries(
    BUILTIN_CATEGORY_DEFAULTS
      .filter(hasPromptAppendResolver)
      .map((definition) => [definition.name, definition.resolvePromptAppend]),
  )

function hasPromptAppendResolver(
  definition: BuiltinCategoryDefinition,
): definition is BuiltinCategoryDefinition & { readonly resolvePromptAppend: (model: string | undefined) => string } {
  return definition.resolvePromptAppend !== undefined
}
