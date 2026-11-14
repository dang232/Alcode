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

export const createCapabilityAuthorizer = ({ token, createClient } = {}) => {
  const configured = asNonEmptyString(token);
  if (!configured) return async () => false;
  return async ({ token: presented, parentID, sessionID, directory } = {}) => {
    const candidate = asNonEmptyString(presented);
    if (!candidate || !sameSecret(candidate, configured)) return false;
    const named = asNonEmptyString(parentID) ?? asNonEmptyString(sessionID);
    if (!named) return false;
    if (createClient === undefined) return false;
    try {
      const client = await createClient({ directory: asNonEmptyString(directory) ?? undefined });
      const found = await client.session.get({ path: { id: named }, query: { directory } });
      return asNonEmptyString(found?.data?.id) === named;
    } catch {
      return false;
    }
  };
};
