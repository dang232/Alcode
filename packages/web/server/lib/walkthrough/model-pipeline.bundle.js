/**
 * Generated from model-pipeline.js — DO NOT EDIT BY HAND.
 *
 * Regen by running Bun.build on model-pipeline.js in this directory
 * (target node, format esm, external node:* + *.js so the engine TypeScript
 * ships inline while the plain-JS small-model bridge stays a shared runtime
 * import). The packaged web server runs under plain Node with no transpile
 * step, where a static `.ts` import fails.
 */
// Alwork-wt/engine-merge-train/packages/omo-engine/model-core/src/category-model-requirements.ts
var CATEGORY_MODEL_REQUIREMENTS = {
  "visual-engineering": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max"
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max"
      }
    ]
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-astra", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-6-astra", variant: "max" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
      { providers: ["openai", "chatgpt-subscription", "opencode"], model: "gpt-5.6-sol", variant: "max" }
    ]
  },
  "deep-low": {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6.1-sol", variant: "medium" },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6.1-sol-fast", variant: "medium" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-sol",
        variant: "medium"
      },
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-5.6-sol-fast", variant: "medium" }
    ]
  },
  "deep-high": {
    fallbackChain: [
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-6-astra",
        variant: "high"
      }
    ]
  },
  artistry: {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-fable-5-1",
        variant: "max"
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "max"
      },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max"
      }
    ]
  },
  quick: {
    fallbackChain: [
      { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
      { providers: ["deepseek"], model: "deepseek-flash", variant: "off" },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"],
        model: "qwen3.6-flash",
        variant: "low"
      },
      { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
      { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
      { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot"],
        model: "claude-haiku-4-5",
        variant: "off"
      },
      { providers: ["zai-coding-plan"], model: "glm-5.3-flash", variant: "low" },
      { providers: ["xiaomi"], model: "mimo-v2.6-flash", variant: "low" }
    ]
  },
  "unspecified-low": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-sonnet-5-5",
        variant: "medium"
      },
      { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.6-pro", variant: "max" },
      { providers: ["xai", "github-copilot", "opencode-go"], model: "grok-4.7", variant: "xhigh" },
      {
        providers: ["openai", "chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-terra",
        variant: "high"
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-sonnet-5",
        variant: "low"
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
        model: "qwen3.8-max-preview",
        variant: "max"
      },
      { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
      { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "max" }
    ]
  },
  "unspecified-high": {
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "medium"
      },
      { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
      {
        providers: ["kimi-for-coding", "moonshotai", "opencode-go", "opencode"],
        model: "kimi-k3",
        variant: "max"
      }
    ]
  },
  writing: {
    requiresAnyModel: true,
    fallbackChain: [
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-5-5",
        variant: "low"
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-opus-4-6",
        variant: "max"
      }
    ]
  }
};
// Alwork-wt/engine-merge-train/packages/omo-engine/model-core/src/model-normalization.ts
function normalizeModel(model) {
  const trimmed = model?.trim();
  return trimmed || undefined;
}
// Alwork-wt/engine-merge-train/packages/omo-engine/model-core/src/model-availability.ts
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

// Alwork-wt/engine-merge-train/packages/omo-engine/model-core/src/provider-model-id-transform.ts
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

// Alwork-wt/engine-merge-train/packages/omo-engine/model-core/src/model-resolution-pipeline.ts
var logImplementationForTesting;
function log(message, data) {
  const logImplementation = logImplementationForTesting;
  if (!logImplementation) {
    return;
  }
  if (arguments.length === 1) {
    logImplementation(message);
    return;
  }
  logImplementation(message, data);
}
var DEFAULT_MODEL_RESOLUTION_DEPS = {
  fuzzyMatchModel,
  transformModelForProvider
};
function modelIDForProvider(provider, model) {
  const prefix = `${provider}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}
function findFallbackVariantForModel(model, fallbackChain, transformModelForProvider) {
  const [provider, ...modelParts] = model.split("/");
  if (!provider || modelParts.length === 0) {
    return;
  }
  const modelID = modelParts.join("/");
  return fallbackChain?.find((entry) => entry.providers.includes(provider) && transformModelForProvider(provider, modelIDForProvider(provider, entry.model)) === modelID && entry.variant)?.variant;
}
function resolveModelPipeline(request, providerCache = {
  readConnectedProvidersCache: () => null,
  findProviderModelMetadata: () => {
    return;
  }
}, deps = DEFAULT_MODEL_RESOLUTION_DEPS) {
  const attempted = [];
  const { intent, constraints, policy } = request;
  const availableModels = constraints.availableModels;
  const fallbackChain = policy?.fallbackChain;
  const systemDefaultModel = policy?.systemDefaultModel;
  const normalizedUiModel = normalizeModel(intent?.uiSelectedModel);
  if (normalizedUiModel) {
    log("Model resolved via UI selection", { model: normalizedUiModel });
    return { model: normalizedUiModel, provenance: "override" };
  }
  const normalizedUserModel = normalizeModel(intent?.userModel);
  if (normalizedUserModel) {
    const inheritedVariant = findFallbackVariantForModel(normalizedUserModel, fallbackChain, deps.transformModelForProvider);
    log("Model resolved via config override", { model: normalizedUserModel });
    return inheritedVariant ? { model: normalizedUserModel, provenance: "override", variant: inheritedVariant } : { model: normalizedUserModel, provenance: "override" };
  }
  const normalizedCategoryDefault = normalizeModel(intent?.categoryDefaultModel);
  if (normalizedCategoryDefault) {
    attempted.push(normalizedCategoryDefault);
    if (availableModels.size > 0) {
      const parts = normalizedCategoryDefault.split("/");
      const providerHint = parts.length >= 2 ? [parts[0]] : undefined;
      const match = deps.fuzzyMatchModel(normalizedCategoryDefault, availableModels, providerHint);
      if (match) {
        log("Model resolved via category default (fuzzy matched)", {
          original: normalizedCategoryDefault,
          matched: match
        });
        return { model: match, provenance: "category-default", attempted };
      }
    } else {
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache();
      if (connectedProviders === null) {
        log("Model resolved via category default (no cache, first run)", {
          model: normalizedCategoryDefault
        });
        return { model: normalizedCategoryDefault, provenance: "category-default", attempted };
      }
      const parts = normalizedCategoryDefault.split("/");
      if (parts.length >= 2) {
        const provider = parts[0];
        if (connectedProviders.includes(provider)) {
          const modelName = parts.slice(1).join("/");
          const transformedModel = `${provider}/${deps.transformModelForProvider(provider, modelName)}`;
          log("Model resolved via category default (connected provider)", {
            model: transformedModel,
            original: normalizedCategoryDefault
          });
          return { model: transformedModel, provenance: "category-default", attempted };
        }
      }
    }
    log("Category default model not available, falling through to fallback chain", {
      model: normalizedCategoryDefault
    });
  }
  const userFallbackModels = intent?.userFallbackModels;
  if (userFallbackModels && userFallbackModels.length > 0) {
    if (availableModels.size === 0) {
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache();
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null;
      if (connectedSet !== null) {
        for (const model of userFallbackModels) {
          attempted.push(model);
          const parts = model.split("/");
          if (parts.length >= 2) {
            const provider = parts[0];
            if (connectedSet.has(provider)) {
              const modelName = parts.slice(1).join("/");
              const transformedModel = `${provider}/${deps.transformModelForProvider(provider, modelName)}`;
              log("Model resolved via user fallback_models (connected provider)", { model: transformedModel, original: model });
              return { model: transformedModel, provenance: "provider-fallback", attempted };
            }
          }
        }
        log("No connected provider found in user fallback_models, falling through to hardcoded chain");
      }
    } else {
      for (const model of userFallbackModels) {
        attempted.push(model);
        const parts = model.split("/");
        const providerHint = parts.length >= 2 ? [parts[0]] : undefined;
        const match = deps.fuzzyMatchModel(model, availableModels, providerHint);
        if (match) {
          log("Model resolved via user fallback_models (availability confirmed)", { model, match });
          return { model: match, provenance: "provider-fallback", attempted };
        }
      }
      log("No available model found in user fallback_models, falling through to hardcoded chain");
    }
  }
  if (fallbackChain && fallbackChain.length > 0) {
    if (availableModels.size === 0) {
      const connectedProviders = constraints.connectedProviders ?? providerCache.readConnectedProvidersCache();
      const connectedSet = connectedProviders ? new Set(connectedProviders) : null;
      if (connectedSet === null) {
        log("Model fallback chain skipped (no connected providers cache) - falling through to system default");
      } else {
        for (const entry of fallbackChain) {
          for (const provider of entry.providers) {
            if (connectedSet.has(provider)) {
              const entryModelID = modelIDForProvider(provider, entry.model);
              const transformedModelId = deps.transformModelForProvider(provider, entryModelID);
              const model = `${provider}/${transformedModelId}`;
              log("Model resolved via fallback chain (connected provider)", {
                provider,
                model: transformedModelId,
                variant: entry.variant
              });
              return {
                model,
                provenance: "provider-fallback",
                variant: entry.variant,
                attempted
              };
            }
          }
        }
        log("No connected provider found in fallback chain, falling through to system default");
      }
    } else {
      for (const entry of fallbackChain) {
        for (const provider of entry.providers) {
          const entryModelID = modelIDForProvider(provider, entry.model);
          const transformedModelId = deps.transformModelForProvider(provider, entryModelID);
          const candidateModelIds = transformedModelId === entryModelID ? [entryModelID] : [entryModelID, transformedModelId];
          for (const modelID of candidateModelIds) {
            const fullModel = `${provider}/${modelID}`;
            const match = deps.fuzzyMatchModel(fullModel, availableModels, [provider]);
            if (match) {
              log("Model resolved via fallback chain (availability confirmed)", {
                provider,
                model: entry.model,
                match,
                variant: entry.variant
              });
              return {
                model: match,
                provenance: "provider-fallback",
                variant: entry.variant,
                attempted
              };
            }
          }
        }
      }
      log("No available model found in fallback chain, falling through to system default");
    }
  }
  if (systemDefaultModel === undefined) {
    log("No model resolved - systemDefaultModel not configured");
    return;
  }
  log("Model resolved via system default", { model: systemDefaultModel });
  return { model: systemDefaultModel, provenance: "system-default", attempted };
}
// Alwork-wt/engine-merge-train/packages/web/server/lib/walkthrough/model-pipeline.js
import { describeSmallModel } from "../small-model/index.js";
import {
  getDefaultModelInfo,
  getSmallModelClient,
  listModelInfos,
  listProviderInfos
} from "../small-model/client.js";
import { readWalkthroughModelOverride } from "./model-settings.js";
var WALKTHROUGH_MODEL_CHAIN = CATEGORY_MODEL_REQUIREMENTS?.quick?.fallbackChain ?? [];
var parseModelRef = (value) => {
  if (typeof value !== "string")
    return null;
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1)
    return null;
  return {
    providerID: trimmed.slice(0, slash),
    modelID: trimmed.slice(slash + 1)
  };
};
var modelRefString = (model) => model && model.providerID && model.modelID ? `${model.providerID}/${model.modelID}` : null;
var normalizeRef = (value) => {
  const parsed = parseModelRef(value);
  return parsed ? `${parsed.providerID}/${parsed.modelID}` : undefined;
};
function buildWalkthroughPipelineRequest({
  explicitModel,
  settingsOverride,
  providerID,
  modelID,
  userFallbackModels,
  availableModels,
  systemDefaultModel,
  forceDowngrade = false
}) {
  const composerDefault = typeof providerID === "string" && providerID && typeof modelID === "string" && modelID ? normalizeRef(`${providerID}/${modelID}`) : undefined;
  const fallbacks = Array.isArray(userFallbackModels) ? userFallbackModels.map(normalizeRef).filter(Boolean) : [];
  return {
    intent: {
      ...!forceDowngrade && normalizeRef(explicitModel) ? { uiSelectedModel: normalizeRef(explicitModel) } : {},
      ...!forceDowngrade && normalizeRef(settingsOverride) ? { userModel: normalizeRef(settingsOverride) } : {},
      ...!forceDowngrade && composerDefault ? { categoryDefaultModel: composerDefault } : {},
      ...fallbacks.length > 0 ? { userFallbackModels: fallbacks } : {}
    },
    constraints: {
      availableModels: availableModels ?? new Set
    },
    policy: {
      fallbackChain: WALKTHROUGH_MODEL_CHAIN,
      ...systemDefaultModel ? { systemDefaultModel } : {}
    }
  };
}
var catalogRefStrings = (models) => {
  const refs = [];
  for (const model of models ?? []) {
    if (typeof model?.providerID !== "string" || !model.providerID)
      continue;
    for (const id of [model.id, model.modelID]) {
      if (typeof id === "string" && id)
        refs.push(`${model.providerID}/${id}`);
    }
  }
  return refs;
};
var readCatalogModelRefs = async (directory) => {
  const client = getSmallModelClient(directory);
  if (!client)
    return [];
  const models = await listModelInfos(client, directory).catch(() => []);
  return catalogRefStrings(models);
};
var readConnectedProviderIDs = async (directory) => {
  const client = getSmallModelClient(directory);
  if (!client)
    return [];
  try {
    const [providers, models] = await Promise.all([
      listProviderInfos(client).catch(() => []),
      listModelInfos(client, directory).catch(() => [])
    ]);
    const enabled = new Set;
    for (const model of models) {
      if (model?.enabled === false)
        continue;
      if (typeof model?.providerID === "string" && model.providerID)
        enabled.add(model.providerID);
    }
    const ids = new Set;
    for (const provider of providers) {
      if (typeof provider?.id === "string" && enabled.has(provider.id))
        ids.add(provider.id);
    }
    for (const id of enabled)
      ids.add(id);
    return [...ids];
  } catch {
    return [];
  }
};
var readDefaultModelRef = async (directory) => {
  const client = getSmallModelClient(directory);
  if (!client)
    return null;
  const info = await getDefaultModelInfo(client).catch(() => null);
  if (!info || typeof info.providerID !== "string" || typeof info.id !== "string")
    return null;
  return `${info.providerID}/${info.id}`;
};
var isExplicitlyChosenModel = (described) => {
  if (described?.pipeline)
    return described.pipeline.provenance === "override";
  return described?.source === "request" || described?.source === "settings";
};
async function resolveWalkthroughModel({
  directory,
  explicitModel,
  providerID,
  modelID,
  userFallbackModels,
  outputReserveTokens,
  forceDowngrade = false,
  deps = {}
}) {
  const {
    readOverride = () => readWalkthroughModelOverride(),
    listCatalogModels = (dir) => readCatalogModelRefs(dir),
    listConnectedProviders = (dir) => readConnectedProviderIDs(dir),
    readDefaultModel = (dir) => readDefaultModelRef(dir),
    describe = (options) => describeSmallModel(options)
  } = deps;
  const settingsOverride = await Promise.resolve().then(() => readOverride()).catch(() => null);
  const [catalogRefs, connectedProviders, defaultRef] = await Promise.all([
    Promise.resolve().then(() => listCatalogModels(directory)).catch(() => []),
    Promise.resolve().then(() => listConnectedProviders(directory)).catch(() => []),
    Promise.resolve().then(() => readDefaultModel(directory)).catch(() => null)
  ]);
  const availableModels = new Set((Array.isArray(catalogRefs) ? catalogRefs : []).filter((ref) => typeof ref === "string"));
  const defaultParsed = parseModelRef(defaultRef);
  const systemDefaultModel = defaultParsed && (!providerID || defaultParsed.providerID === providerID) ? `${defaultParsed.providerID}/${defaultParsed.modelID}` : undefined;
  const request = buildWalkthroughPipelineRequest({
    explicitModel,
    settingsOverride,
    providerID,
    modelID,
    userFallbackModels,
    availableModels,
    systemDefaultModel,
    forceDowngrade
  });
  const picked = resolveModelPipeline(request, {
    readConnectedProvidersCache: () => connectedProviders ?? null,
    findProviderModelMetadata: () => {
      return;
    }
  });
  const describeOptions = (overrideModel) => ({
    directory,
    overrideModel,
    preferredProviderID: providerID || undefined,
    preferredModelID: modelID || undefined,
    outputReserveTokens
  });
  if (picked?.model) {
    const described = await Promise.resolve().then(() => describe(describeOptions(picked.model))).catch(() => null);
    if (described) {
      return {
        ...described,
        pipeline: {
          provenance: picked.provenance,
          variant: picked.variant,
          attempted: picked.attempted ?? []
        }
      };
    }
  }
  if (forceDowngrade)
    return null;
  const legacy = await Promise.resolve().then(() => describe(describeOptions(normalizeRef(explicitModel) || normalizeRef(settingsOverride) || undefined))).catch(() => null);
  return legacy ?? null;
}
var bareModelID = (providerID, model) => {
  const prefix = `${providerID}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
};
function walkthroughDowngradeRefs({
  resolvedRef,
  attempted = [],
  chain = WALKTHROUGH_MODEL_CHAIN
} = {}) {
  const skip = new Set([resolvedRef, ...Array.isArray(attempted) ? attempted : []].map((ref) => typeof ref === "string" ? ref.trim().toLowerCase() : null).filter(Boolean));
  const refs = [];
  const seen = new Set(skip);
  for (const entry of chain ?? []) {
    const model = typeof entry?.model === "string" ? entry.model.trim() : "";
    if (!model)
      continue;
    for (const provider of entry?.providers ?? []) {
      const providerID = typeof provider === "string" ? provider.trim() : "";
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
var RETRYABLE_DISPATCH_CODES = new Set([
  "small-model-unavailable",
  "structured-output-unsupported",
  "no-provider-login"
]);
function isWalkthroughDispatchRetryable(error) {
  if (!error || typeof error !== "object")
    return false;
  if (error.name === "AbortError")
    return false;
  if (error.downgrade === false)
    return false;
  if (typeof error.code === "string" && RETRYABLE_DISPATCH_CODES.has(error.code))
    return true;
  if (error.statusCode === 404 || error.statusCode === 503)
    return true;
  if (error._tag === "InvalidRequestError")
    return true;
  return false;
}
async function advanceThroughWalkthroughCandidates({
  refs,
  attempt,
  shouldRetry = isWalkthroughDispatchRetryable
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
      if (attempted.length > 0 && error && typeof error === "object") {
        throw Object.assign(error, { downgradeAttempted: [...attempted] });
      }
      throw error;
    }
  }
  if (lastError) {
    if (typeof lastError === "object" && lastError !== null) {
      throw Object.assign(lastError, { downgradeAttempted: [...attempted] });
    }
    throw lastError;
  }
  throw new Error("No walkthrough model candidates to try");
}
export {
  WALKTHROUGH_MODEL_CHAIN,
  advanceThroughWalkthroughCandidates,
  buildWalkthroughPipelineRequest,
  isExplicitlyChosenModel,
  isWalkthroughDispatchRetryable,
  modelRefString,
  parseModelRef,
  resolveWalkthroughModel,
  walkthroughDowngradeRefs
};
