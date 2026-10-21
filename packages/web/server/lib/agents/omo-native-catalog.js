/**
 * OmO-native agent catalog — BUILD SOURCE ONLY.
 *
 * Never import this file at runtime. It imports engine `.ts` directly, which
 * plain Node cannot resolve in the packaged app (same constraint as
 * small-model/delegate-dispatch.js and omo-catalog.js). Runtime entries import
 * the committed `omo-native-catalog.bundle.js` instead (regen with
 * `bun ./omo-native-catalog.regen.js` in this directory); only that bundle may
 * appear in a runtime import chain.
 *
 * Assembles the single OpenCode-native registry into plain JSON-safe items
 * for `GET /api/config/agents/catalog`:
 * - agent ids from BuiltinAgentNameSchema (config/schema/agent-names.ts),
 * - agent display labels from AGENT_DISPLAY_NAMES (shared/agent-display-names.ts),
 * - agent prompt/description/mode from the bundled omo-opencode/agents/*.md
 *   definitions (agents without a bundled file get prompt null: their prompts
 *   are built dynamically at runtime, so there is no static text to carry),
 * - model policy summaries from AGENT_MODEL_REQUIREMENTS + CATEGORY_MODEL_REQUIREMENTS
 *   (model-core: head-of-chain primary lane plus the distinct chain models),
 * - the 10 category name/descriptions from delegate-task/*-categories.ts.
 *
 * Plus the static host-shaped agent map (`buildNativeAgentConfigMap` /
 * `OMO_NATIVE_AGENT_CONFIG`) the managed OpenCode config file merges into
 * `content.agent`: the V2 agent editor has no add() (update/list/get/default/
 * remove only), so custom agents cannot register via transform and must ship
 * as static config.
 *
 * Resolution stays authoritative in the engines; these items are display truth
 * with the fail-closed shape the UI needs. This source is assembled clean-room
 * from the native registry only and must never gain a legacy-bundle import.
 */

import { AGENT_DISPLAY_NAMES } from '../../../../omo-engine/omo-opencode/src/shared/agent-display-names.ts';
import { BuiltinAgentNameSchema } from '../../../../omo-engine/omo-opencode/src/config/schema/agent-names.ts';
import { AGENT_MODEL_REQUIREMENTS } from '../../../../omo-engine/model-core/src/agent-model-requirements.ts';
import { resolveModelPipeline } from '../../../../omo-engine/model-core/src/model-resolution-pipeline.ts';
import { fuzzyMatchModel } from '../../../../omo-engine/model-core/src/model-availability.ts';
import { normalizeModel } from '../../../../omo-engine/model-core/src/model-normalization.ts';
import { CATEGORY_MODEL_REQUIREMENTS } from '../../../../omo-engine/model-core/src/category-model-requirements.ts';
import { GOOGLE_CATEGORIES } from '../../../../omo-engine/omo-opencode/src/tools/delegate-task/google-categories.ts';
import { OPENAI_CATEGORIES } from '../../../../omo-engine/omo-opencode/src/tools/delegate-task/openai-categories.ts';
import { KIMI_CATEGORIES } from '../../../../omo-engine/omo-opencode/src/tools/delegate-task/kimi-categories.ts';
import {
  assembleAgentEntries,
  CORE_AGENT_KEYS,
  createProtectedAgentNameSet,
} from '../../../../omo-engine/omo-opencode/src/plugin-handlers/agent-config-assembly.ts';
import { finalizeAgentConfig } from '../../../../omo-engine/omo-opencode/src/plugin-handlers/agent-config-finalizer.ts';
import { applyToolConfig } from '../../../../omo-engine/omo-opencode/src/plugin-handlers/tool-config-handler.ts';
import { getAgentConfigKey } from '../../../../omo-engine/omo-opencode/src/shared/agent-display-names.ts';

import exploreMd from '../../../../omo-engine/omo-opencode/agents/explore.md' with { type: 'text' };
import librarianMd from '../../../../omo-engine/omo-opencode/agents/librarian.md' with { type: 'text' };
import omoNativeCodeReviewerMd from '../../../../omo-engine/omo-opencode/agents/omo-native-code-reviewer.md' with { type: 'text' };
import omoNativeGateReviewerMd from '../../../../omo-engine/omo-opencode/agents/omo-native-gate-reviewer.md' with { type: 'text' };
import omoNativeQaExecutorMd from '../../../../omo-engine/omo-opencode/agents/omo-native-qa-executor.md' with { type: 'text' };
import planConsultantMd from '../../../../omo-engine/omo-opencode/agents/plan-consultant.md' with { type: 'text' };
import planReviewerMd from '../../../../omo-engine/omo-opencode/agents/plan-reviewer.md' with { type: 'text' };

const parseAgentFile = (text) => {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const header = match?.[1] ?? '';
  const prompt = (match?.[2] ?? text).trim();
  const fields = Object.fromEntries(
    header.split(/\r?\n/).map((line) => {
      const separator = line.indexOf(':');
      return separator === -1
        ? [line.trim(), '']
        : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
  );
  return {
    name: fields.name ?? '',
    description: fields.description ?? '',
    mode: fields.mode ?? '',
    prompt,
  };
};

const BUNDLED_AGENT_DEFINITIONS = new Map(
  [
    exploreMd,
    librarianMd,
    omoNativeCodeReviewerMd,
    omoNativeGateReviewerMd,
    omoNativeQaExecutorMd,
    planConsultantMd,
    planReviewerMd,
  ].map((text) => {
    const parsed = parseAgentFile(text);
    return [parsed.name, parsed];
  }),
);

const summarizeModelPolicy = (requirement) => {
  const chain = requirement?.fallbackChain ?? [];
  const requiresModels = [...new Set(chain.map((entry) => entry.model).filter(Boolean))];
  const head = chain[0];
  const model = head ? `${head.providers[0]}/${head.model}` : null;
  return { model, requiresModels };
};

// Every native entry resolves on the OpenCode engine only; the capability tag
// is the display-grade gate the UI needs, mirroring the old bundle's oracle entry.
const NATIVE_CAPABILITIES = ['opencode-engine'];

const agentItems = BuiltinAgentNameSchema.options.map((id) => {
  const bundled = BUNDLED_AGENT_DEFINITIONS.get(id);
  const { model, requiresModels } = summarizeModelPolicy(AGENT_MODEL_REQUIREMENTS[id]);
  return {
    id,
    kind: 'agent',
    source: 'omo-compatible',
    edition: 'opencode',
    description: bundled?.description || AGENT_DISPLAY_NAMES[id] || id,
    requiresCapabilities: [...NATIVE_CAPABILITIES],
    ...(requiresModels.length > 0 ? { requiresModels } : {}),
    ...(model ? { model } : {}),
    prompt: bundled?.prompt ?? null,
    ...(bundled?.mode ? { mode: bundled.mode } : {}),
  };
});

const categoryItems = [...GOOGLE_CATEGORIES, ...OPENAI_CATEGORIES, ...KIMI_CATEGORIES].map((definition) => {
  const { model, requiresModels } = summarizeModelPolicy(CATEGORY_MODEL_REQUIREMENTS[definition.name]);
  return {
    id: definition.name,
    kind: 'category',
    source: 'omo-compatible',
    edition: 'opencode',
    description: definition.description,
    requiresCapabilities: [...NATIVE_CAPABILITIES],
    ...(requiresModels.length > 0 ? { requiresModels } : {}),
    ...(model ? { model } : {}),
  };
});

export const OMO_NATIVE_CATALOG_ITEMS = [...agentItems, ...categoryItems];

/**
 * Config keys that ship as static entries in the managed OpenCode config file.
 *
 * The 9 core agents (sisyphus, hephaestus, prometheus, atlas,
 * sisyphus-junior, oracle, metis, momus, multimodal-looker) plus the
 * ungated bundled scouts (explore, librarian) plus the demoted plan entry
 * plus the plan-gated advisers and final-gate trio (plan-consultant,
 * plan-reviewer, omo-native-code-reviewer, omo-native-qa-executor,
 * omo-native-gate-reviewer).
 *
 * The gated five ship as static entries so every identity is dispatchable
 * under its own name. Their ordering guarantees stay enforced at dispatch:
 * plan-consultant/plan-reviewer are denied by the plugin task-tool hook
 * without the user-requested-planning triple, and trio staging is enforced
 * in the team and MCP dispatch paths (direct user invocation of the trio
 * is an explicit choice, not a gate bypass).
 */
export const NATIVE_STATIC_AGENT_KEYS = [
  'sisyphus',
  'hephaestus',
  'prometheus',
  'atlas',
  'sisyphus-junior',
  'explore',
  'librarian',
  'oracle',
  'metis',
  'momus',
  'multimodal-looker',
  'plan',
  'plan-consultant',
  'plan-reviewer',
  'omo-native-code-reviewer',
  'omo-native-qa-executor',
  'omo-native-gate-reviewer',
];

export const NATIVE_AGENT_MODEL_CHAINS = Object.fromEntries(
  NATIVE_STATIC_AGENT_KEYS.map((configKey) => [
    configKey,
    AGENT_MODEL_REQUIREMENTS[configKey === 'plan' ? 'prometheus' : configKey]?.fallbackChain ?? [],
  ]),
);

// Boundary parser: a user-supplied override ref is trimmed "provider/model"
// text or absent. Anything else (wrong type, missing slash) is not an
// override at all, so downstream code branches on the domain value.
const modelOverrideAsRef = (value) => {
  if (value?.constructor !== String) return undefined;
  const trimmed = value.trim();
  return trimmed.includes('/') ? trimmed : undefined;
};

// Boundary parser: model ref collections become a Set of strings.
const modelRefSet = (value) => {
  const out = new Set();
  const items = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  for (const ref of items) {
    if (ref?.constructor !== String) continue;
    out.add(ref);
  }
  return out;
};

/**
 * No-eligible-model sentinel: every resolution failure returns
 * `{ noEligible: true, reason, configKey, ... }` instead of silent
 * `undefined`, so callers can distinguish misconfiguration
 * (`empty-chain`), a pinned override naming a dead provider/model
 * (`override-provider-unavailable` / `override-model-unavailable`),
 * and chain exhaustion (`chain-exhausted`, with the tried chain).
 * `connectedProviders: null` means unknown (fail-open): an override is
 * only rejected when providers are KNOWN and exclude it.
 */
export function getOverrideIneligibility(override, { connectedProviders = null, models = new Set() } = {}) {
  const normalized = normalizeModel(override);
  const [provider, ...rest] = String(normalized ?? override).split('/');
  if (!provider || rest.length === 0) return 'malformed-override';
  if (Array.isArray(connectedProviders) && !connectedProviders.includes(provider)) {
    return 'override-provider-unavailable';
  }
  if (models instanceof Set && models.size > 0
    && !fuzzyMatchModel(normalized ?? override, models, [provider])) {
    return 'override-model-unavailable';
  }
  return undefined;
}

export function resolveStaticAgentModel(configKey, options = {}) {
  const { connectedProviders = null, availableModels, modelOverride } = options ?? {};
  const chain = NATIVE_AGENT_MODEL_CHAINS[configKey];
  if (!chain || chain.length === 0) return { noEligible: true, reason: 'empty-chain', configKey };
  const override = modelOverrideAsRef(modelOverride);
  const models = modelRefSet(availableModels);
  if (override) {
    const ineligible = getOverrideIneligibility(override, { connectedProviders, models });
    if (ineligible) return { noEligible: true, reason: ineligible, configKey, override };
  }
  const intent = {};
  if (override) intent.userModel = override;
  const constraints = { availableModels: models };
  if (connectedProviders) constraints.connectedProviders = connectedProviders;
  const picked = resolveModelPipeline({
    intent,
    constraints,
    policy: { fallbackChain: chain },
  });
  if (!picked?.model) {
    return {
      noEligible: true,
      reason: 'chain-exhausted',
      configKey,
      chain: chain.map((entry) => `${(entry?.providers ?? []).join('|')}/${entry?.model ?? ''}`),
    };
  }
  const resolved = {
    model: picked.variant ? `${picked.model}#${picked.variant}` : picked.model,
    provenance: picked.provenance,
  };
  if (picked.variant) resolved.variant = picked.variant;
  return resolved;
}

/**
 * Build the static `{ configKey: host-shaped entry }` agent map for the
 * managed OpenCode config file. Keys are lowercase config-key ids (never
 * display names); values are the exact host shapes the config lanes produce
 * (flat tools plus permission denies).
 *
 * Runs the same lanes as the live plugin pipeline (assemble -> finalize ->
 * tool permissions) over a static default plugin config with the bundled
 * tier built from the `.md` texts embedded above. It deliberately does NOT
 * go through `applyAgentConfig`: that entry reads ambient filesystem tiers
 * (user/project agent dirs, global opencode configs) and local skill files,
 * neither of which exists deterministically inside the packaged bundle. The
 * embedded texts are the same bodies the bundled tier would load, so the
 * result matches the live assembly for every shipped key.
 *
 * Synchronous and side-effect-free (no filesystem, no network), so the
 * prebuilt `OMO_NATIVE_AGENT_CONFIG` below is safe to compute at import.
 */
export function buildNativeAgentConfigMap(resolution = {}) {
  const { connectedProviders = null, availableModels, modelOverrides = {} } = resolution ?? {};
  const bundledTier = {};
  for (const parsed of BUNDLED_AGENT_DEFINITIONS.values()) {
    bundledTier[parsed.name] = {
      // Same scope tag the file tier applies: the loader formats every file
      // description as `(${scope}) ${original}`, and the bundled tier loads
      // with scope `definition-file` (agent-definitions-loader).
      ...(parsed.description ? { description: `(definition-file) ${parsed.description}` } : {}),
      mode: parsed.mode || 'subagent',
      ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
    };
  }
  const protectedNames = createProtectedAgentNameSet([
    ...CORE_AGENT_KEYS,
    'build',
    'plan',
    ...BUNDLED_AGENT_DEFINITIONS.keys(),
  ]);
  const staticPluginConfig = {};
  const hostConfig = { agent: {} };
  const entries = assembleAgentEntries({
    pluginConfig: staticPluginConfig,
    skills: [],
    customTiers: [bundledTier],
    disabledAgentNames: new Set(),
    protectedNames,
  });
  finalizeAgentConfig({ hostConfig, pluginConfig: staticPluginConfig, agents: entries });
  applyToolConfig({ hostConfig, pluginConfig: staticPluginConfig });
  const byConfigKey = {};
  for (const [displayName, entry] of Object.entries(hostConfig.agent)) {
    byConfigKey[getAgentConfigKey(displayName)] = entry;
  }
  const map = {};
  for (const configKey of NATIVE_STATIC_AGENT_KEYS) {
    const entry = byConfigKey[configKey];
    if (!entry) {
      throw new Error(`[omo-native-catalog] static agent entry missing for "${configKey}"`);
    }
    const resolved = resolveStaticAgentModel(configKey, {
      connectedProviders,
      availableModels,
      modelOverride: modelOverrides?.[configKey],
    });
    // Model-less entries never ship once providers are KNOWN: a child
    // would dispatch them onto a doomed model (or the wrong agent).
    // Unknown providers (null) stay fail-open — discovery may simply not
    // have run yet — so the entry ships unresolved as before. Known gaps
    // surface separately through getNativeAgentModelGaps: loud, not silent.
    if (resolved?.model || connectedProviders == null) {
      const agentEntry = { ...entry };
      if (resolved?.model) agentEntry.model = resolved.model;
      map[configKey] = agentEntry;
    }
  }
  return map;
}

/**
 * Machine-readable model gaps for a resolution: one entry per static key
 * with no eligible model (`{ configKey, reason, chain?, override? }`).
 * Same loop as buildNativeAgentConfigMap; the map drops these keys while
 * this reports them, so diagnostics and the pre-spawn gate see exactly
 * what the child will not get.
 */
export function getNativeAgentModelGaps(resolution = {}) {
  const { connectedProviders = null, availableModels, modelOverrides = {} } = resolution ?? {};
  // Unknown providers: nothing is KNOWN missing (fail-open, as shipped).
  if (connectedProviders == null) return [];
  const gaps = [];
  for (const configKey of NATIVE_STATIC_AGENT_KEYS) {
    const resolved = resolveStaticAgentModel(configKey, {
      connectedProviders,
      availableModels,
      modelOverride: modelOverrides?.[configKey],
    });
    if (!resolved?.model) {
      const gap = { configKey, reason: resolved?.reason ?? 'unknown' };
      if (resolved?.chain) gap.chain = resolved.chain;
      if (resolved?.override) gap.override = resolved.override;
      gaps.push(gap);
    }
  }
  return gaps;
}

export const OMO_NATIVE_AGENT_CONFIG = buildNativeAgentConfigMap();

// Version 4: model-less static entries are dropped from the shipped map
// (see getNativeAgentModelGaps) instead of riding along without a model.
// Any consumer seeing 3 or earlier after this lands is stale.
export const OMO_NATIVE_CATALOG_VERSION = 4;
