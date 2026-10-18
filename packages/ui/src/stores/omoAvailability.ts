import type { OmoCatalogItem } from './useAgentsStore';

// Availability of one catalog entry against the LIVE agent list of the
// active runtime. Dispatchability is name resolution plus enabled state.
// Cross-namespace model gates (senpi requiresModels) must never be matched
// here; they stay display-only requirements on the catalog item.
export type OmoAvailabilityStatus = 'available' | 'fallback_available' | 'unavailable' | 'unknown';

export type OmoAvailabilityReason =
  | { readonly key: 'notRegistered'; readonly params: { readonly name: string } }
  | { readonly key: 'disabled' }
  | { readonly key: 'modelNotConnected'; readonly params: { readonly model: string } }
  | { readonly key: 'categoryNoDispatch' }
  | { readonly key: 'fallback'; readonly params: { readonly name: string; readonly fallback: string } }
  | { readonly key: 'categoryFallback'; readonly params: { readonly fallback: string } }
  | { readonly key: 'unknown' };

export type OmoAvailability = {
  readonly status: OmoAvailabilityStatus;
  /** Display model: the agent's pinned model or the session default. */
  readonly resolvedModel?: string;
  readonly reason?: OmoAvailabilityReason;
  /** First live fallback candidate, when the entry itself cannot dispatch. */
  readonly fallback?: string;
  readonly actions: ReadonlyArray<'dispatch' | 'clone'>;
};

export type OmoAvailabilityContext = {
  /** Names the runtime resolves, from its live agent list. */
  readonly agentNames: ReadonlySet<string>;
  /** Names switched off with `disabled: true`. */
  readonly disabledNames: ReadonlySet<string>;
  /** True when the live list failed to load: failure is not empty. */
  readonly listUnknown: boolean;
  /** Pinned model of a live agent, when the list carries it. */
  readonly agentModel?: (name: string) => string | null;
  /** True when a pinned model id is connected. Absent check passes. */
  readonly isModelConnected?: (model: string) => boolean;
};

export function resolveOmoAvailability(
  entry: Pick<OmoCatalogItem, 'id' | 'kind' | 'fallback'>,
  ctx: OmoAvailabilityContext,
): OmoAvailability {
  if (ctx.listUnknown) {
    return { status: 'unknown', actions: [] };
  }
  if (ctx.agentNames.has(entry.id) && !ctx.disabledNames.has(entry.id)) {
    const pinned = ctx.agentModel?.(entry.id) ?? null;
    if (pinned && ctx.isModelConnected && !ctx.isModelConnected(pinned)) {
      return {
        status: 'unavailable',
        resolvedModel: pinned,
        reason: { key: 'modelNotConnected', params: { model: pinned } },
        actions: [],
      };
    }
    return {
      status: 'available',
      ...(pinned ? { resolvedModel: pinned } : { resolvedModel: 'session default' }),
      actions: ['dispatch'],
    };
  }
  if (ctx.disabledNames.has(entry.id)) {
    return { status: 'unavailable', reason: { key: 'disabled' }, actions: [] };
  }
  for (const candidate of entry.fallback ?? []) {
    if (ctx.agentNames.has(candidate) && !ctx.disabledNames.has(candidate)) {
      return {
        status: 'fallback_available',
        fallback: candidate,
        reason:
          entry.kind === 'category'
            ? { key: 'categoryFallback', params: { fallback: candidate } }
            : { key: 'fallback', params: { name: entry.id, fallback: candidate } },
        actions: entry.kind === 'agent' ? ['dispatch', 'clone'] : [],
      };
    }
  }
  return {
    status: 'unavailable',
    reason:
      entry.kind === 'category'
        ? { key: 'categoryNoDispatch' }
        : { key: 'notRegistered', params: { name: entry.id } },
    actions: entry.kind === 'agent' ? ['clone'] : [],
  };
}
