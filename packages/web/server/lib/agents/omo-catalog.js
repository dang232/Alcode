/**
 * OmO-compatible agent catalog — BUILD SOURCE ONLY.
 *
 * Never import this file at runtime. It imports engine `.ts` directly, which
 * plain Node cannot resolve in the packaged app (same constraint as
 * small-model/delegate-dispatch.js). Runtime entries import the committed
 * `omo-catalog.bundle.js` instead (regen with `bun ./omo-catalog.regen.js`
 * in this directory); only that bundle may appear in a runtime import chain.
 *
 * Serializes the senpi-task `OMO_AGENT_CATALOG` into plain JSON-safe items
 * for `GET /api/config/agents/catalog`. Resolution stays authoritative in
 * the engines; these items are display truth (source labels, requirements,
 * model policy) with the fail-closed shape the UI needs.
 */
import { OMO_AGENT_CATALOG } from '../../../../omo-engine/senpi-task/src/agents/omo-catalog.ts';

const toToolSummary = (definition) => {
  const rules = definition?.tools ?? [];
  const allow = rules.filter((rule) => rule.allow).map((rule) => rule.pattern);
  const deny = rules.filter((rule) => !rule.allow).map((rule) => rule.pattern);
  return { allow, deny };
};

export const OMO_CATALOG_ITEMS = OMO_AGENT_CATALOG.map((entry) => ({
  id: entry.id,
  kind: entry.kind,
  description: entry.description,
  source: entry.source,
  edition: entry.edition,
  ...(entry.requiresModels ? { requiresModels: [...entry.requiresModels] } : {}),
  ...(entry.requiresCapabilities ? { requiresCapabilities: [...entry.requiresCapabilities] } : {}),
  ...(entry.fallback ? { fallback: [...entry.fallback] } : {}),
  ...(entry.definition
    ? {
      prompt: entry.definition.prompt ?? null,
      model: entry.definition.model ?? null,
      models: entry.definition.models ?? null,
      categories: entry.definition.categories ? [...entry.definition.categories] : null,
      executionMode: entry.definition.executionMode ?? null,
      tools: toToolSummary(entry.definition),
    }
    : { prompt: null }),
}));

export const OMO_CATALOG_VERSION = 1;
