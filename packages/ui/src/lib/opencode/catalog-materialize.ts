import type { AgentConfig, PermissionRule } from '@/stores/useAgentsStore';
import type { OmoCatalogItem } from '@/stores/useAgentsStore';

/**
 * OpenCode-native catalog entries safe to register as live user subagents.
 * Explicit by id: plan-consultant, plan-reviewer, and the final-gate trio
 * (omo-native-code-reviewer, omo-native-qa-executor, omo-native-gate-reviewer)
 * are deliberately EXCLUDED — their dispatch preconditions live in the plugin
 * gate path (plan-gate guard / final quality-gate stage), and a plain user
 * subagent would bypass those gates. Only ungated research agents qualify.
 */
const MATERIALIZABLE_CATALOG_IDS: ReadonlySet<string> = new Set(['librarian', 'explore']);

/**
 * Read-only ruleset for a ported research agent. OpenCode 2 evaluates
 * last-match-wins, so broad denies come first and the narrow research
 * allows override them.
 */
export const CATALOG_MATERIALIZE_PERMISSIONS: readonly PermissionRule[] = [
  { action: 'read', resource: '*', effect: 'allow' },
  { action: 'edit', resource: '*', effect: 'deny' },
  { action: 'subagent', resource: '*', effect: 'deny' },
  { action: 'shell', resource: '*', effect: 'deny' },
  { action: 'shell', resource: 'gh *', effect: 'allow' },
  { action: 'shell', resource: 'curl *', effect: 'allow' },
  { action: 'webfetch', resource: '*', effect: 'allow' },
  { action: 'websearch', resource: '*', effect: 'allow' },
];

/**
 * Runtime note prepended to a ported native prompt. Prepend, never rewrite:
 * the bundled prompt text stays byte-identical so catalog edits flow
 * through without re-porting.
 */
export const CATALOG_MATERIALIZE_RUNTIME_NOTE =
  'Runtime note (OpenCode engine): this definition was ported from the OpenCode-native built-in of the same name. ' +
  'You run with a general shell and web tools: use `gh` and `curl` through the shell for remote research, ' +
  '`read`/`grep`/`glob` for local files, and `webfetch` for documentation pages. ' +
  'You cannot clone repositories. Your permission rules deny edits and non-research shell use; ' +
  'stay read-only and say so when a task needs writes.';

export function canMaterializeCatalogAgent(
  item: Pick<OmoCatalogItem, 'id' | 'kind' | 'edition' | 'prompt'>,
): boolean {
  const prompt = item.prompt ?? '';
  return (
    item.kind === 'agent'
    && item.edition === 'opencode'
    && MATERIALIZABLE_CATALOG_IDS.has(item.id)
    && prompt.length > 0
  );
}

export function buildCatalogAgentConfig(
  item: Pick<OmoCatalogItem, 'id' | 'description' | 'prompt'>,
): AgentConfig {
  return {
    name: item.id,
    scope: 'user',
    description: item.description,
    mode: 'subagent',
    system: `${CATALOG_MATERIALIZE_RUNTIME_NOTE}\n\n${item.prompt}`,
    permissions: [...CATALOG_MATERIALIZE_PERMISSIONS],
  };
}
