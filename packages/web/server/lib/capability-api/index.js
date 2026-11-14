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

export const registerCapabilityRoutes = (app, { token, createClient, taskStarter } = {}) => {
  const configured = asNonEmptyString(token);
  if (!configured) return false;
  const authorize = createCapabilityAuthorizer({ token: configured, createClient });
  app.use(CAPABILITY_MOUNT_PATH, createCapabilityRouter({ createClient, taskStarter, authorize }));
  return true;
};
