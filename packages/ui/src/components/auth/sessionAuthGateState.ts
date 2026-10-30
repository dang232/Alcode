export type GateState = 'pending' | 'authenticated' | 'locked' | 'error' | 'rate-limited';

export type RuntimeIdentity = {
  apiBaseUrl: string;
  runtimeKey: string;
};

export const runtimeIdentityMatches = (left: RuntimeIdentity, right: RuntimeIdentity): boolean => {
  return left.apiBaseUrl === right.apiBaseUrl && left.runtimeKey === right.runtimeKey;
};

/**
 * A confirmed expiry has to leave the workspace for the sign-in view: the
 * server already dropped the stored pair when the refresh failed, so keeping
 * the authenticated gate on screen only shows a workspace whose every request
 * will 401. Any other auth state leaves the gate where it is.
 */
export const nextGateStateForAuthSession = (
  current: GateState,
  authSession: 'ok' | 'expired' | 'reauthenticating',
): GateState => {
  if (authSession === 'expired' && current === 'authenticated') return 'locked';
  return current;
};

/**
 * The gate heals the shared auth store when its own state still says
 * authenticated - except for a confirmed expiry, which the gate answers by
 * locking, so healing here would erase the very signal that says the session is
 * dead before the lock renders.
 */
export const shouldHealAuthSession = (
  current: GateState,
  authSession: 'ok' | 'expired' | 'reauthenticating',
): boolean => current === 'authenticated' && authSession === 'reauthenticating';
