import { OMO_NATIVE_CATALOG_ITEMS } from '../agents/omo-native-catalog.bundle.js';

export const resolveAllowedAgents = (env = process.env) => {
  const configured = env.OMO_CAPABILITY_ALLOWED_AGENTS;
  if (configured === undefined) return undefined;
  return configured
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
};

export const nativeAgentIds = () => OMO_NATIVE_CATALOG_ITEMS
  .filter((item) => item?.kind === 'agent')
  .map((item) => item?.id?.trim?.() ?? '')
  .filter((id) => id.length > 0);

export const resolveEffectiveAllowedAgents = (env = process.env) => (
  resolveAllowedAgents(env) ?? nativeAgentIds()
);
