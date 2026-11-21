/**
 * index.js — mounts the capability routes onto the existing express app.
 *
 * The surface stays dark unless a token is configured, so an unconfigured
 * server cannot be probed for it. Wiring is one call from the shared route
 * assembly; the client factory and the task starter are injected so this module
 * never reaches for a global.
 */

import { asNonEmptyString } from '../shared/guards.js';

import { createCapabilityAuthorizer } from './authorization.js';
import { createCapabilityRouter } from './routes.js';

export const CAPABILITY_MOUNT_PATH = '/capability';

export const registerCapabilityRoutes = (app, { token, createClient, taskStarter, taskOutput, readSession, runMonitor, allowedAgents, boundParent, hostState, ensureHostLive, resolveDefaultModel, waitReady } = {}) => {
  // A resolver mounts the surface before the supervised host is ready: requests are then refused
  // until it produces a secret, which is truthful rather than pretending the surface is absent.
  const mounted = typeof token === 'function' || Boolean(asNonEmptyString(token));
  if (!mounted) return false;
  const authorize = createCapabilityAuthorizer({ token, createClient, boundParent });
  app.use(CAPABILITY_MOUNT_PATH, createCapabilityRouter({ createClient, taskStarter, taskOutput, readSession, runMonitor, authorize, allowedAgents, boundParent, hostState, ensureHostLive, resolveDefaultModel, waitReady }));
  return true;
};
