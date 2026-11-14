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

export const resolveCapabilityToken = (env = process.env) => {
  const provided = asNonEmptyString(env.ALCODE_CAPABILITY_TOKEN);
  if (provided) return provided;
  if (generatedToken === null) generatedToken = randomBytes(24).toString('hex');
  return generatedToken;
};

export const buildCapabilityDescriptor = ({ url, token } = {}) => {
  const base = asNonEmptyString(url);
  const secret = asNonEmptyString(token);
  if (!base || !secret) return null;
  if (!base.startsWith('http://') && !base.startsWith('https://')) return null;
  return { hostCapabilities: { version: 1, url: base, token: secret } };
};

export const resolveCapabilityDescriptor = (env = process.env) =>
  buildCapabilityDescriptor({ url: env.ALCODE_CAPABILITY_URL, token: resolveCapabilityToken(env) });

const NATIVE_PLUGIN_SUFFIX = /(^|[\\/])omo-native[\\/]omo-native$/;

/** The plugin options for one managed plugin directory; only the native plugin gets them. */
export const descriptorForDirectory = (directory, env = process.env) => {
  const candidate = asNonEmptyString(directory);
  if (!candidate || !NATIVE_PLUGIN_SUFFIX.test(candidate)) return null;
  return resolveCapabilityDescriptor(env);
};
