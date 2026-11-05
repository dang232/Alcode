export {
  BUILTIN_CATEGORY_DEFAULTS,
  BUILTIN_CATEGORY_REQUIRES_MODEL,
  CATEGORY_CALLER_GUIDANCE,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_PROMPT_APPENDS,
  DEFAULT_CATEGORIES,
  categoryGateModels,
} from "./builtins"

export { builtinCategoryChainCandidates, resolveAvailableCategoryNames, resolveCategory } from "./resolver"
export type {
  BuiltinCategoryDefinition,
  CategoryModelSelection,
  CategoryResolutionResult,
  ResolvedChildSpec,
  SenpiModelPort,
  SenpiModelRegistryPort,
} from "./types"
