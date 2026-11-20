// Security: the host's own answer is returned verbatim. An absent or unreachable host is
// TASK_MANAGER_UNAVAILABLE, never a fabricated empty result a caller could read as "no output yet".
import { asNonEmptyString } from '../shared/guards.js';

const TIMEOUT_MS = 30_000;

const unavailable = (reason) => {
  const error = new Error(`TASK_MANAGER_UNAVAILABLE: ${reason}`);
  error.code = 'TASK_MANAGER_UNAVAILABLE';
  return error;
};

export const createTaskOutputProxy = ({ url, token, parentSessionID: boundParent, fetchImpl } = {}) => {
  const base = asNonEmptyString(url);
  const secret = asNonEmptyString(token);
  const hostParent = asNonEmptyString(boundParent);
  const send = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  return async (request) => {
    if (!base || !secret) throw unavailable('no task host is configured');
    const parentSessionID = hostParent ?? asNonEmptyString(request?.parentSessionID);
    if (!parentSessionID) throw unavailable('no authenticated parent session was supplied');
    const taskID = asNonEmptyString(request?.taskID);
    if (!taskID) {
      const error = new Error('task_id is required');
      error.code = 'INVALID_ARGUMENT';
      throw error;
    }
    let response;
    try {
      response = await send(`${base}/capability/task/output`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify({ task_id: taskID, parentSessionID }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      throw unavailable(`the task host is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const text = await response.text();
    let payload = null;
    try {
      payload = text.length === 0 ? null : JSON.parse(text);
    } catch {
      throw unavailable('the task host answered with a body that is not JSON');
    }
    if (!response.ok) {
      const code = asNonEmptyString(payload?.error) ?? 'TASK_OUTPUT_REFUSED';
      const error = new Error(asNonEmptyString(payload?.message) ?? `the host refused the read (${response.status})`);
      error.code = code;
      throw error;
    }
    return payload ?? {};
  };
};
