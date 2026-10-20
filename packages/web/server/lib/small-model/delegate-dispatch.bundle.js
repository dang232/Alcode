/**
 * Generated from delegate-dispatch.js — DO NOT EDIT BY HAND.
 *
 * Regen with `bun ./delegate-dispatch.regen.js` in this directory. Bundled with
 * Bun.build (target node, format esm, external node:* builtins only) so the
 * engine TypeScript ships inline: the packaged web server runs under plain
 * Node with no transpile step, where a static `.ts` import fails.
 */
// ../../../../omo-engine/model-core/src/reasoning-level.ts
var REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
var REASONING_AUTO = "auto";
var REASONING_LEVEL_SET = new Set(REASONING_LEVELS);
var REASONING_LEVEL_OR_AUTO_SET = new Set([...REASONING_LEVELS, REASONING_AUTO]);
function isReasoningLevelOrAuto(value) {
  return REASONING_LEVEL_OR_AUTO_SET.has(value);
}
function splitReasoningSuffix(model, options) {
  if (typeof model !== "string")
    return { base: "" };
  const trimmed = model.trim();
  if (!trimmed)
    return { base: "" };
  const separatorIndex = trimmed.lastIndexOf(":");
  if (separatorIndex === -1)
    return { base: trimmed };
  const base = trimmed.slice(0, separatorIndex).trim();
  const token = trimmed.slice(separatorIndex + 1).trim().toLowerCase();
  if (!base || !isReasoningLevelOrAuto(token))
    return { base: trimmed };
  if (token === "max" && !(options?.allowMaxSuffix ?? base.includes("/")))
    return { base: trimmed };
  return { base, level: token };
}

// ../../../../omo-engine/model-core/src/model-string-parser.ts
function parseVariantFromModelID(rawModelID, options) {
  if (typeof rawModelID !== "string") {
    return { modelID: "" };
  }
  const trimmedModelID = rawModelID.trim();
  if (!trimmedModelID) {
    return { modelID: "" };
  }
  const parenthesizedVariant = trimmedModelID.match(/^(.*)\(([^()]+)\)\s*$/);
  if (parenthesizedVariant) {
    const modelID = parenthesizedVariant[1]?.trim() ?? "";
    const variant = parenthesizedVariant[2]?.trim();
    return variant ? { modelID, variant } : { modelID };
  }
  const suffixedModel = splitReasoningSuffix(trimmedModelID, options);
  if (suffixedModel.level) {
    return { modelID: suffixedModel.base, variant: suffixedModel.level };
  }
  const spaceVariant = trimmedModelID.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i);
  if (spaceVariant) {
    const modelID = spaceVariant[1]?.trim() ?? "";
    const variant = spaceVariant[2]?.trim().toLowerCase();
    if (variant) {
      return { modelID, variant };
    }
  }
  return { modelID: trimmedModelID };
}
function parseModelString(model) {
  if (typeof model !== "string")
    return;
  const trimmedModel = model.trim();
  if (!trimmedModel)
    return;
  const separatorIndex = trimmedModel.indexOf("/");
  if (separatorIndex === -1) {
    return;
  }
  const providerID = trimmedModel.slice(0, separatorIndex).trim();
  const rawModelID = trimmedModel.slice(separatorIndex + 1).trim();
  if (!providerID || !rawModelID) {
    return;
  }
  const parsedModel = parseVariantFromModelID(rawModelID, { allowMaxSuffix: true });
  if (!parsedModel.modelID) {
    return;
  }
  return parsedModel.variant ? { providerID, modelID: parsedModel.modelID, variant: parsedModel.variant } : { providerID, modelID: parsedModel.modelID };
}
// ../../../../omo-engine/model-core/src/model-normalization.ts
function normalizeModel(model) {
  const trimmed = model?.trim();
  return trimmed || undefined;
}
// ../../../../omo-engine/model-core/src/model-availability.ts
function normalizeModelName(name) {
  return name.toLowerCase().replace(/claude-(opus|sonnet|haiku)-(\d+)[.-](\d+)/g, "claude-$1-$2.$3").replace(/kimi-k2[.-](\d+)/g, "kimi-k2.$1").replace(/\b(glm|gpt)-(\d+)[.-](\d+)/g, "$1-$2.$3");
}
function modelIdOf(model) {
  return model.split("/").slice(1).join("/");
}
function closestMatch(matches, providers) {
  const providerRank = (model) => providers === undefined || providers.length === 0 ? 0 : providers.indexOf(model.split("/")[0] ?? "");
  return matches.reduce((best, current) => {
    const rankDelta = providerRank(current) - providerRank(best);
    if (rankDelta !== 0)
      return rankDelta < 0 ? current : best;
    return modelIdOf(current).length < modelIdOf(best).length ? current : best;
  });
}
function fuzzyMatchModel(target, available, providers) {
  if (available.size === 0) {
    return null;
  }
  const targetNormalized = normalizeModelName(target);
  let candidates = Array.from(available);
  if (providers && providers.length > 0) {
    const providerSet = new Set(providers);
    candidates = candidates.filter((model) => {
      const [provider] = model.split("/");
      return providerSet.has(provider);
    });
  }
  if (candidates.length === 0) {
    return null;
  }
  const matches = candidates.filter((model) => normalizeModelName(model).includes(targetNormalized));
  if (matches.length === 0) {
    return null;
  }
  const exactMatch = matches.find((model) => normalizeModelName(model) === targetNormalized);
  if (exactMatch) {
    return exactMatch;
  }
  const exactModelIdMatches = matches.filter((model) => normalizeModelName(modelIdOf(model)) === targetNormalized);
  if (exactModelIdMatches.length > 0) {
    return closestMatch(exactModelIdMatches, providers);
  }
  return closestMatch(matches, providers);
}
// ../../../../omo-engine/model-core/src/provider-model-id-transform.ts
function inferSubProvider(model) {
  if (model.startsWith("claude-"))
    return "anthropic";
  if (model.startsWith("gpt-"))
    return "openai";
  if (model.startsWith("gemini-"))
    return "google";
  if (model.startsWith("grok-"))
    return "xai";
  if (model.startsWith("minimax-"))
    return "minimax";
  if (model.startsWith("kimi-"))
    return "moonshotai";
  if (model.startsWith("k3"))
    return "moonshotai";
  if (model.startsWith("glm-"))
    return "zai";
  return;
}
var CLAUDE_VERSION_DOT = /claude-(\w+)-(\d+)-(\d+)/g;
var GEMINI_31_PRO_PREVIEW = /gemini-3\.1-pro(?!-)/g;
var GEMINI_3_FLASH_PREVIEW = /(?<!antigravity-)gemini-3-flash(?!-)/g;
function claudeVersionDot(model) {
  return model.replace(CLAUDE_VERSION_DOT, "claude-$1-$2.$3");
}
function applyGatewayTransforms(model) {
  return claudeVersionDot(model).replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview");
}
function transformModelForProviderUsingAnthropicBehavior(provider, model) {
  if (provider === "vercel") {
    const slashIndex = model.indexOf("/");
    if (slashIndex !== -1) {
      const subProvider = model.substring(0, slashIndex);
      const subModel = model.substring(slashIndex + 1);
      return `${subProvider}/${applyGatewayTransforms(subModel)}`;
    }
    const subProvider = inferSubProvider(model);
    if (subProvider) {
      return `${subProvider}/${applyGatewayTransforms(model)}`;
    }
    return model;
  }
  if (provider === "github-copilot") {
    return claudeVersionDot(model).replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview").replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview");
  }
  if (provider === "google") {
    return model.replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview").replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview");
  }
  if (provider === "anthropic") {
    return model;
  }
  if (provider === "kimi-coding" || provider === "kimi-for-coding") {
    if (model === "kimi-k3")
      return "k3";
    if (model === "kimi-k3-256k")
      return "k3-256k";
  }
  return model;
}
function transformModelForProvider(provider, model) {
  return transformModelForProviderUsingAnthropicBehavior(provider, model);
}
// ../../../../omo-engine/delegate-core/src/model-selection.ts
function modelIDForProvider(provider, model) {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}
function isExplicitHighModel(model) {
  return /(?:^|\/)[^/]+-high$/.test(model);
}
function getExplicitHighBaseModel(model) {
  return isExplicitHighModel(model) ? model.replace(/-high$/, "") : null;
}
function parseUserFallbackModel(fallbackModel) {
  const normalizedFallback = normalizeModel(fallbackModel);
  if (!normalizedFallback) {
    return;
  }
  const parsedFullModel = parseModelString(normalizedFallback);
  if (parsedFullModel) {
    return {
      baseModel: `${parsedFullModel.providerID}/${parsedFullModel.modelID}`,
      providerHint: [parsedFullModel.providerID],
      variant: parsedFullModel.variant
    };
  }
  const parsedModel = parseVariantFromModelID(normalizedFallback);
  if (!parsedModel.modelID) {
    return;
  }
  return {
    baseModel: parsedModel.modelID,
    variant: parsedModel.variant
  };
}
function resolveModelForDelegateTask(input, deps) {
  const userModel = normalizeModel(input.userModel);
  if (userModel) {
    const parsed = parseUserFallbackModel(userModel);
    const userResult = parsed?.variant ? { model: parsed.baseModel, variant: parsed.variant } : { model: userModel };
    const userFallbackModels = input.userFallbackModels;
    if (input.availableModels.size > 0 && userFallbackModels && userFallbackModels.length > 0) {
      const providerHint = parsed?.providerHint;
      const primaryMatch = fuzzyMatchModel(userResult.model, new Set(input.availableModels), providerHint);
      if (!primaryMatch) {
        for (const fallbackModel of userFallbackModels) {
          const parsedFallback = parseUserFallbackModel(fallbackModel);
          if (!parsedFallback)
            continue;
          const fbMatch = fuzzyMatchModel(parsedFallback.baseModel, new Set(input.availableModels), parsedFallback.providerHint);
          if (fbMatch) {
            deps.log?.("[resolveModelForDelegateTask] user primary model unreachable; promoting user fallback_models entry", {
              userPrimary: userResult.model,
              selectedFallback: fbMatch
            });
            return {
              model: fbMatch,
              variant: parsedFallback.variant,
              matchedFallback: true
            };
          }
        }
      }
    }
    return userResult;
  }
  const connectedProviders = input.availableModels.size === 0 ? deps.connectedProviders : null;
  if (input.availableModels.size === 0 && connectedProviders === null && !deps.hasProviderModelsCache && !deps.hasConnectedProvidersCache) {
    return { skipped: true };
  }
  const categoryDefault = normalizeModel(input.categoryDefaultModel);
  const explicitHighBaseModel = categoryDefault ? getExplicitHighBaseModel(categoryDefault) : null;
  const explicitHighModel = explicitHighBaseModel ? categoryDefault : undefined;
  if (categoryDefault) {
    if (input.isUserConfiguredCategoryModel) {
      deps.log?.("[resolveModelForDelegateTask] using user-configured category model (bypass validation)", {
        categoryDefaultModel: categoryDefault
      });
      const parsed = parseUserFallbackModel(categoryDefault);
      if (parsed?.variant) {
        return { model: parsed.baseModel, variant: parsed.variant };
      }
      return { model: categoryDefault };
    }
    if (input.availableModels.size === 0) {
      const categoryProvider = categoryDefault.includes("/") ? categoryDefault.split("/")[0] : undefined;
      if (!connectedProviders || !categoryProvider || connectedProviders.includes(categoryProvider)) {
        return { model: categoryDefault };
      }
      deps.log?.("[resolveModelForDelegateTask] skipping disconnected category default on cold cache", {
        categoryDefault,
        connectedProviders
      });
    }
    const parts = categoryDefault.split("/");
    const providerHint = parts.length >= 2 && parts[0] ? [parts[0]] : undefined;
    const match = fuzzyMatchModel(categoryDefault, new Set(input.availableModels), providerHint);
    if (match) {
      if (isExplicitHighModel(categoryDefault) && match !== categoryDefault) {
        return { model: categoryDefault };
      }
      return { model: match };
    }
  }
  const userFallbackModels = input.userFallbackModels;
  if (userFallbackModels && userFallbackModels.length > 0) {
    if (input.availableModels.size === 0) {
      for (const fallbackModel of userFallbackModels) {
        const parsedFallback = parseUserFallbackModel(fallbackModel);
        if (!parsedFallback)
          continue;
        if (connectedProviders && parsedFallback.providerHint && !parsedFallback.providerHint.some((provider) => connectedProviders.includes(provider))) {
          continue;
        }
        return { model: parsedFallback.baseModel, variant: parsedFallback.variant, matchedFallback: true };
      }
    } else {
      for (const fallbackModel of userFallbackModels) {
        const parsedFallback = parseUserFallbackModel(fallbackModel);
        if (!parsedFallback)
          continue;
        const match = fuzzyMatchModel(parsedFallback.baseModel, new Set(input.availableModels), parsedFallback.providerHint);
        if (match) {
          return { model: match, variant: parsedFallback.variant, matchedFallback: true };
        }
      }
    }
  }
  const fallbackChain = input.fallbackChain;
  if (fallbackChain && fallbackChain.length > 0) {
    if (input.availableModels.size === 0) {
      if (connectedProviders) {
        const connectedSet = new Set(connectedProviders);
        for (const entry of fallbackChain) {
          for (const provider of entry.providers) {
            if (connectedSet.has(provider)) {
              const transformedModelId = transformModelForProvider(provider, modelIDForProvider(provider, entry.model));
              deps.log?.("[resolveModelForDelegateTask] fallback chain resolved via connected provider", {
                provider,
                model: entry.model
              });
              return { model: `${provider}/${transformedModelId}`, variant: entry.variant, fallbackEntry: entry, matchedFallback: true };
            }
          }
        }
        deps.log?.("[resolveModelForDelegateTask] no connected provider found in fallback chain");
      } else {
        const first = fallbackChain[0];
        const provider = first?.providers?.[0];
        if (first && provider) {
          const transformedModelId = transformModelForProvider(provider, first.model);
          return { model: `${provider}/${transformedModelId}`, variant: first.variant, fallbackEntry: first, matchedFallback: true };
        }
      }
    } else {
      for (const [entryIndex, entry] of fallbackChain.entries()) {
        for (const provider of entry.providers) {
          const entryModelId = modelIDForProvider(provider, entry.model);
          const transformedModelId = transformModelForProvider(provider, entryModelId);
          const candidateIds = transformedModelId === entryModelId ? [entryModelId] : [transformedModelId, entryModelId];
          const match = candidateIds.map((modelId) => fuzzyMatchModel(`${provider}/${modelId}`, new Set(input.availableModels), [provider])).find((candidate) => candidate !== null);
          if (match) {
            if (explicitHighModel && entry.variant === "high" && match === explicitHighBaseModel) {
              return { model: explicitHighModel, fallbackEntry: entry, matchedFallback: true };
            }
            return { model: match, variant: entry.variant, fallbackEntry: entry, matchedFallback: true };
          }
        }
        if (input.allowUnlistedProviders !== true)
          continue;
        const laterRungProviders = new Set(fallbackChain.slice(entryIndex + 1).filter((candidate) => candidate.model === entry.model).flatMap((candidate) => candidate.providers));
        const crossProviderCandidates = new Set([...input.availableModels].filter((model) => {
          const [provider] = model.split("/");
          return provider !== undefined && !laterRungProviders.has(provider);
        }));
        const crossProviderMatch = fuzzyMatchModel(entry.model, crossProviderCandidates);
        if (crossProviderMatch) {
          if (explicitHighModel && entry.variant === "high" && crossProviderMatch === explicitHighBaseModel) {
            return { model: explicitHighModel, fallbackEntry: entry, matchedFallback: true };
          }
          return { model: crossProviderMatch, variant: entry.variant, fallbackEntry: entry, matchedFallback: true };
        }
      }
    }
  }
  const systemDefaultModel = normalizeModel(input.systemDefaultModel);
  if (systemDefaultModel) {
    return { model: systemDefaultModel };
  }
  return;
}

// ../../../../omo-engine/delegate-core/src/retry-patterns.ts
var DELEGATE_TASK_ERROR_PATTERNS = [
  {
    pattern: "run_in_background",
    errorType: "missing_run_in_background",
    fixHint: "Add run_in_background=true (the standard spawn) or run_in_background=false for a short child whose result gates your very next call"
  },
  {
    pattern: "load_skills",
    errorType: "missing_load_skills",
    fixHint: "Add load_skills=[] parameter (empty array if no skills needed). Note: Calling Skill tool does NOT populate this."
  },
  {
    pattern: "category OR subagent_type",
    errorType: "mutual_exclusion",
    fixHint: "Provide ONLY one of: category (e.g., 'general', 'quick') OR subagent_type (e.g., 'oracle', 'explore')"
  },
  {
    pattern: "Must provide either category or subagent_type",
    errorType: "missing_category_or_agent",
    fixHint: "Add either category='general' OR subagent_type='explore'"
  },
  {
    pattern: "Unknown category",
    errorType: "unknown_category",
    fixHint: "Use a valid category from the Available list in the error message"
  },
  {
    pattern: "Agent name cannot be empty",
    errorType: "empty_agent",
    fixHint: "Provide a non-empty subagent_type value"
  },
  {
    pattern: "Unknown agent",
    errorType: "unknown_agent",
    fixHint: "Use a valid agent from the Available agents list in the error message"
  },
  {
    pattern: "Cannot call primary agent",
    errorType: "primary_agent",
    fixHint: "Primary agents cannot be called via task. Use a subagent like 'explore', 'oracle', or 'librarian'"
  },
  {
    pattern: "Skills not found",
    errorType: "unknown_skills",
    fixHint: "Use valid skill names from the Available list in the error message"
  }
];
function detectDelegateTaskError(output) {
  if (!output.includes("[ERROR]") && !output.includes("Invalid arguments"))
    return null;
  for (const errorPattern of DELEGATE_TASK_ERROR_PATTERNS) {
    if (output.includes(errorPattern.pattern)) {
      return {
        errorType: errorPattern.errorType,
        originalOutput: output
      };
    }
  }
  return null;
}

// ../../../../omo-engine/delegate-core/src/retry-guidance.ts
function extractAvailableList(output) {
  const availableMatch = output.match(/Available[^:]*:\s*(.+)$/m);
  return availableMatch ? availableMatch[1].trim() : null;
}
function buildRetryGuidance(errorInfo) {
  const pattern = DELEGATE_TASK_ERROR_PATTERNS.find((entry) => entry.errorType === errorInfo.errorType);
  if (!pattern) {
    return `[task ERROR] Fix the error and retry with correct parameters.`;
  }
  let guidance = `
 [task CALL FAILED - IMMEDIATE RETRY REQUIRED]

 **Error Type**: ${errorInfo.errorType}
 **Fix**: ${pattern.fixHint}
 `;
  const availableList = extractAvailableList(errorInfo.originalOutput);
  if (availableList) {
    guidance += `
**Available Options**: ${availableList}
`;
  }
  guidance += `
 **Action**: Retry task NOW with corrected parameters.

 Example of CORRECT call:
 \`\`\`
 task(
   description="Task description",
   prompt="Detailed prompt...",
   category="unspecified-low",  // OR subagent_type="explore"
   run_in_background=true,
   load_skills=[]
 )
 \`\`\`
 `;
  return guidance;
}

// delegate-dispatch.js
var isNonEmptyString = (value) => (value?.trim?.()?.length ?? 0) > 0;
var malformed = (errorType, originalOutput) => {
  const detected = detectDelegateTaskError(originalOutput);
  const error = detected ?? { errorType, originalOutput };
  return { ok: false, errorType: error.errorType, guidance: buildRetryGuidance(error) };
};
function validateDelegateTaskCall(input) {
  if (!input || Object(input) !== input || Array.isArray(input)) {
    return malformed("missing_category_or_agent", "[ERROR] Invalid arguments: Must provide either category or subagent_type (task call must be an object).");
  }
  if (!isNonEmptyString(input.description)) {
    return malformed("malformed_task_call", `[ERROR] Invalid task call: description is required, got ${JSON.stringify(input.description)}.`);
  }
  if (!isNonEmptyString(input.prompt)) {
    return malformed("malformed_task_call", "[ERROR] Invalid task call: prompt is required and must be a non-empty string.");
  }
  const hasCategory = isNonEmptyString(input.category);
  const hasAgent = input.subagent_type !== undefined && input.subagent_type !== null;
  if (!hasCategory && !hasAgent) {
    return malformed("missing_category_or_agent", "[ERROR] Invalid arguments: Must provide either category or subagent_type.");
  }
  if (hasCategory && hasAgent) {
    return malformed("mutual_exclusion", "[ERROR] Invalid arguments: provide category OR subagent_type, not both.");
  }
  if (hasAgent && !isNonEmptyString(input.subagent_type)) {
    return malformed("empty_agent", "[ERROR] Invalid arguments: Agent name cannot be empty.");
  }
  if (input.run_in_background !== true && input.run_in_background !== false) {
    return malformed("missing_run_in_background", "[ERROR] Invalid arguments: missing run_in_background flag (want run_in_background=true or false).");
  }
  if (!Array.isArray(input.load_skills)) {
    return malformed("missing_load_skills", "[ERROR] Invalid arguments: missing load_skills parameter (want load_skills=[], empty when no skills are needed).");
  }
  const task = {
    description: input.description.trim(),
    prompt: input.prompt.trim()
  };
  if (hasCategory)
    task.category = input.category.trim();
  if (hasAgent)
    task.subagent_type = input.subagent_type.trim();
  task.run_in_background = input.run_in_background;
  task.load_skills = [...input.load_skills];
  return { ok: true, task };
}
function resolveDelegateModel(input, deps) {
  return resolveModelForDelegateTask(input, deps);
}
var bareModelID = (providerID, model) => {
  const prefix = `${providerID}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
};
function delegateDowngradeRefs({ resolvedRef, attempted = [], fallbackChain = [] } = {}) {
  const skip = new Set([resolvedRef, ...Array.isArray(attempted) ? attempted : []].map((ref) => ref?.trim?.()?.toLowerCase?.() ?? null).filter(Boolean));
  const refs = [];
  const seen = new Set(skip);
  for (const entry of fallbackChain ?? []) {
    const model = entry?.model?.trim?.() ?? "";
    if (!model)
      continue;
    for (const provider of entry?.providers ?? []) {
      const providerID = provider?.trim?.() ?? "";
      if (!providerID)
        continue;
      const ref = `${providerID}/${bareModelID(providerID, model)}`;
      const key = ref.toLowerCase();
      if (seen.has(key))
        continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}
var RETRYABLE_DELEGATE_DISPATCH_CODES = new Set([
  "small-model-unavailable",
  "structured-output-unsupported",
  "no-provider-login"
]);
function isDelegateDispatchRetryable(error) {
  if (!error || Object(error) !== error)
    return false;
  if (error.name === "AbortError")
    return false;
  if (error.downgrade === false)
    return false;
  if (RETRYABLE_DELEGATE_DISPATCH_CODES.has(error.code))
    return true;
  if (error.statusCode === 404 || error.statusCode === 503)
    return true;
  if (error._tag === "InvalidRequestError")
    return true;
  return false;
}
async function advanceThroughDelegateCandidates({
  refs,
  attempt,
  shouldRetry = isDelegateDispatchRetryable
}) {
  const attempted = [];
  let lastError = null;
  const list = Array.isArray(refs) ? refs : [];
  for (const ref of list) {
    try {
      const result = await attempt(ref);
      return { ref, result, attempted };
    } catch (error) {
      if (error?.name === "AbortError")
        throw error;
      if (shouldRetry(error) && ref !== list.at(-1)) {
        attempted.push(ref);
        lastError = error;
        continue;
      }
      if (attempted.length > 0 && error && Object(error) === error) {
        throw Object.assign(error, { downgradeAttempted: [...attempted] });
      }
      throw error;
    }
  }
  if (lastError) {
    if (lastError && Object(lastError) === lastError) {
      throw Object.assign(lastError, { downgradeAttempted: [...attempted] });
    }
    throw lastError;
  }
  throw new Error("No delegate model candidates to try");
}
export {
  DELEGATE_TASK_ERROR_PATTERNS,
  advanceThroughDelegateCandidates,
  delegateDowngradeRefs,
  isDelegateDispatchRetryable,
  resolveDelegateModel,
  validateDelegateTaskCall
};
