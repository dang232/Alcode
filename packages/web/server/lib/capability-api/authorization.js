/**
 * authorization.js — who may call the capability routes.
 *
 * Two independent checks, both required: the presented bearer must equal the
 * configured secret (compared in constant time), and the session the body names
 * must actually exist in this workspace. A valid token alone never authorizes a
 * caller-chosen parent, so a leaked token cannot mint a child under an arbitrary
 * session, and the token itself is never logged.
 */

import { timingSafeEqual } from 'node:crypto';

import { asNonEmptyString } from '../shared/guards.js';

const sameSecret = (presented, configured) => {
  const left = Buffer.from(presented, 'utf8');
  const right = Buffer.from(configured, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export const createCapabilityAuthorizer = ({ token, createClient, boundParent } = {}) => {
  // A resolver lets a supervised host that becomes ready after boot mint its own secret; a string
  // stays the operator-configured case. Both go through the same constant-time comparison.
  const configuredOf = typeof token === 'function' ? token : () => token;
  if (typeof token !== 'function' && !asNonEmptyString(token)) return async () => false;
  return async ({ token: presented, parentID, sessionID, directory } = {}) => {
    const configured = asNonEmptyString(configuredOf());
    if (!configured) return false;
    const candidate = asNonEmptyString(presented);
    if (!candidate || !sameSecret(candidate, configured)) return false;
    const named = asNonEmptyString(parentID) ?? asNonEmptyString(sessionID);
    if (!named) return false;
    // The supervisor's own host session is authority this server can verify without the client: it opened the session
    // and it is the parent every gateway task is recorded under.
    const bound = typeof boundParent === 'function' ? asNonEmptyString(boundParent()) : asNonEmptyString(boundParent);
    if (bound && named === bound) return true;
    if (createClient === undefined) return false;
    try {
      const client = await createClient({ directory: asNonEmptyString(directory) ?? undefined });
      const found = await client.session.get({ sessionID: named });
      return asNonEmptyString(found?.id) === named;
    } catch (cause) {
      // A wiring failure (for example a base URL that cannot be built) must not read as an authorization
      // decision: say so once per refusal instead of swallowing it.
      console.warn('[capability] parent authorization failed', { parent: named, error: cause instanceof Error ? cause.message : String(cause) });
      return false;
    }
  };
};
