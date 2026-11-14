/**
 * task-proxy.js — the Express-side taskStarter when the canonical manager lives
 * in the dedicated task host.
 *
 * The route keeps its contract: a shaped { taskID, state } on success, and the
 * truthful TASK_MANAGER_UNAVAILABLE for an absent, unreachable or malformed
 * host. It forwards the authenticated parent verbatim and never invents an id.
 */

import { asNonEmptyString } from '../shared/guards.js';

const TIMEOUT_MS = 30_000;

const unavailable = (reason) => {
  const error = new Error(`TASK_MANAGER_UNAVAILABLE: ${reason}`);
  error.code = 'TASK_MANAGER_UNAVAILABLE';
  return error;
};

export const createTaskHostProxy = ({ url, token, fetchImpl } = {}) => {
  const base = asNonEmptyString(url);
  const secret = asNonEmptyString(token);
  const send = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  return async (request) => {
    if (!base || !secret) throw unavailable('no task host is configured');
    const parentSessionID = asNonEmptyString(request?.parentSessionID);
    if (!parentSessionID) throw unavailable('no authenticated parent session was supplied');
    let response;
    try {
      response = await send(`${base}/capability/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify({ ...request, parentSessionID }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      throw unavailable(`the task host is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!response.ok) throw unavailable(`the task host answered ${response.status}`);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw unavailable('the task host returned a non-JSON body');
    }
    const taskID = asNonEmptyString(payload?.taskID);
    const state = asNonEmptyString(payload?.state);
    if (!taskID || !state) throw unavailable('the task host returned no usable task identity');
    return { taskID, state };
  };
};
