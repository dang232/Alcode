/**
 * task-starter.js — the seam between the capability route and a host-owned
 * task manager.
 *
 * The route never sees a manager. It sees this function, which forwards the
 * authenticated parent verbatim and refuses loudly when no manager is present,
 * so the route's 503 body is produced by a missing backend rather than by a
 * fabricated task identity.
 */

import { asNonEmptyString } from '../shared/guards.js';

export const TASK_MANAGER_UNAVAILABLE_CODE = 'TASK_MANAGER_UNAVAILABLE';

const unavailable = (reason) => {
  const error = new Error(`${TASK_MANAGER_UNAVAILABLE_CODE}: ${reason}`);
  error.code = TASK_MANAGER_UNAVAILABLE_CODE;
  return error;
};

export const createTaskStarter = (manager) => async (request) => {
  const parentSessionID = asNonEmptyString(request?.parentSessionID);
  if (!parentSessionID) {
    throw unavailable('no authenticated parent session was supplied');
  }
  if (manager === undefined || manager === null) {
    throw unavailable('this server process hosts no canonical senpi-task manager');
  }
  let started;
  try {
    started = await manager.start({ ...request, parentSessionID });
  } catch (cause) {
    throw unavailable(cause instanceof Error ? cause.message : String(cause));
  }
  const taskID = asNonEmptyString(started?.taskID);
  const state = asNonEmptyString(started?.state);
  if (!taskID || !state) {
    throw unavailable('the manager returned no usable task identity');
  }
  return { taskID, state };
};
