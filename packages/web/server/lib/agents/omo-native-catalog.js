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

// Model head for a static entry. `plan` inherits the prometheus chain, same
// as the demoted plan entry built by the assembly.
const headModelForStaticEntry = (configKey) => {
  const requirement = AGENT_MODEL_REQUIREMENTS[configKey === 'plan' ? 'prometheus' : configKey];
  const head = requirement?.fallbackChain?.[0];
  return head ? `${head.providers[0]}/${head.model}` : null;
};

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
export function buildNativeAgentConfigMap() {
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
    const model = headModelForStaticEntry(configKey);
    map[configKey] = { ...entry, ...(model ? { model } : {}) };
  }
  return map;
}

export const OMO_NATIVE_AGENT_CONFIG = buildNativeAgentConfigMap();

// Version 2: the bump itself is the staleness signal. The senpi-sourced
// bundle this replaces shipped version 1 with no way to tell a stale
// copy from a fresh one; any consumer seeing 1 after this lands is stale.
export const OMO_NATIVE_CATALOG_VERSION = 2;
