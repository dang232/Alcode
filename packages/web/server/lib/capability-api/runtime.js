/**
 * runtime.js — the one place that decides the capability token and the
 * descriptor published to the plugin.
 *
 * The token is read from `ALCODE_CAPABILITY_TOKEN` when the deployment supplies
 * one, otherwise a per-process secret is generated so a fresh server is never
 * unauthenticated. The descriptor is published only when a base URL is
 * configured: an address the plugin cannot reach would turn every delegation
 * into a failed call, so an absent URL publishes nothing and the tools keep
 * refusing instead.
 */

import { randomBytes } from 'node:crypto';

import { asNonEmptyString } from '../shared/guards.js';

let generatedToken = null;
let configuredBaseUrl = null;

/**
 * The capability endpoints live on the Alcode server that launches the managed plugin, so the base URL is that
 * server's own loopback address. Configuring it here keeps the descriptor intact while the port is decided at listen
 * time; an explicit ALCODE_CAPABILITY_URL still wins, because a deployment may front the server itself.
 */
export const configureCapabilityBaseUrl = (url) => {
  configuredBaseUrl = asNonEmptyString(url);
};

export const resolveCapabilityToken = (env = process.env) => {
  const provided = asNonEmptyString(env.ALCODE_CAPABILITY_TOKEN);
  if (provided) return provided;
  if (generatedToken === null) generatedToken = randomBytes(24).toString('hex');
  return generatedToken;
};

/**
 * The one agent allowlist. Unset means "no policy"; a set value is split and
 * normalized, and a set-but-empty value stays an empty list so every named
 * agent is refused instead of silently allowed.
 */
export { nativeAgentIds, resolveAllowedAgents, resolveEffectiveAllowedAgents } from './allowed-agents.js';
import { resolveEffectiveAllowedAgents } from './allowed-agents.js';

export const buildCapabilityDescriptor = ({ url, token, allowedAgents } = {}) => {
  const base = asNonEmptyString(url);
  const secret = asNonEmptyString(token);
  if (!base || !secret) return null;
  if (!base.startsWith('http://') && !base.startsWith('https://')) return null;
  const hostCapabilities = { version: 1, url: base, token: secret };
  if (allowedAgents !== undefined) hostCapabilities.allowedAgents = allowedAgents;
  return { hostCapabilities };
};

export const resolveCapabilityDescriptor = (env = process.env) =>
  buildCapabilityDescriptor({
    url: env.ALCODE_CAPABILITY_URL ?? configuredBaseUrl,
    token: resolveCapabilityToken(env),
    allowedAgents: resolveEffectiveAllowedAgents(env),
  });

const NATIVE_PLUGIN_SUFFIX = /(^|[\\/])omo-native[\\/]omo-native$/;

/** The plugin options for one managed plugin directory; only the native plugin gets them. */
export const descriptorForDirectory = (directory, env = process.env, baseUrl = null) => {
  const candidate = asNonEmptyString(directory);
  if (!candidate || !NATIVE_PLUGIN_SUFFIX.test(candidate)) return null;
  return buildCapabilityDescriptor({
    url: asNonEmptyString(env.ALCODE_CAPABILITY_URL) ?? asNonEmptyString(baseUrl) ?? configuredBaseUrl,
    token: resolveCapabilityToken(env),
    allowedAgents: resolveEffectiveAllowedAgents(env),
  });
};
