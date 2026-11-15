/**
 * routes.js — the bearer-authenticated delegation capability surface.
 *
 * The V2 plugin consumes exactly these three endpoints (see
 * .omo/evidence/phase3/r1-5-engine-capability-injection/endpoint-contract.md).
 * The router owns authentication, parent scoping, argument validation and
 * response shaping; it never invents a session or a task, and it never puts the
 * bearer token in a response body or an error message.
 */

import express from 'express';

import { asNonEmptyString, isPlainObject } from '../shared/guards.js';

const OUTCOMES = new Set(['accepted', 'refused', 'unknown']);
const STATES = new Set(['accepted', 'running', 'completed', 'failed', 'cancelled', 'unknown']);

const NO_MANAGER_BODY = {
  error: 'TASK_MANAGER_UNAVAILABLE',
  reason: 'no-manager',
  message: 'This server process hosts no canonical senpi-task manager, so no task was started.',
};

const bearerOf = (header) => {
  const value = asNonEmptyString(header);
  if (!value) return null;
  const parts = value.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== 'bearer') return null;
  return asNonEmptyString(parts[1]);
};

const bodyOf = (request) => (isPlainObject(request.body) ? request.body : {});

const fail = (response, status, error, message) => response.status(status).json({ error, message });

const allowed = async (authorize, input) => {
  if (authorize === undefined) return false;
  try {
    return (await authorize(input)) === true;
  } catch {
    return false;
  }
};

const agentAllowed = (allowedAgents, agent) => {
  if (agent === undefined) return true;
  if (allowedAgents === undefined) return true;
  return allowedAgents.includes(agent);
};

export const createCapabilityRouter = ({ createClient, taskStarter, authorize, allowedAgents, boundParent, hostState, ensureHostLive, resolveDefaultModel, waitReady } = {}) => {
  // The supervisor's bound session is the only parent the host can actually run a task under.
  const boundParentOf = () => (typeof boundParent === 'function' ? boundParent() : boundParent);
  const router = express.Router();

  router.use(express.json({ limit: '1mb' }));

  router.use((request, response, next) => {
    const token = bearerOf(request.get('authorization'));
    if (!token) {
      fail(response, 401, 'UNAUTHORIZED', 'A bearer token is required.');
      return;
    }
    request.capabilityToken = token;
    next();
  });

  router.post('/session', async (request, response) => {
    const body = bodyOf(request);
    const parentID = asNonEmptyString(body.parentID);
    const title = asNonEmptyString(body.title);
    const directory = asNonEmptyString(body.directory);
    if (!parentID || !title || !directory) {
      fail(response, 400, 'INVALID_ARGUMENT', 'parentID, title and directory are required strings.');
      return;
    }
    if (!(await allowed(authorize, { token: request.capabilityToken, parentID, directory }))) {
      fail(response, 403, 'FORBIDDEN', 'This token may not create a child under that parent session.');
      return;
    }
    if (createClient === undefined) {
      fail(response, 503, 'SESSION_CAPABILITY_UNAVAILABLE', 'This server exposes no session client.');
      return;
    }
    const client = await createClient({ directory });
    const created = await client.session.create({ body: { parentID, title }, query: { directory } });
    if (created?.error !== undefined && created?.error !== null) {
      fail(response, 502, 'SESSION_CREATE_FAILED', 'The engine rejected the session request.');
      return;
    }
    const sessionID = asNonEmptyString(created?.data?.id);
    if (!sessionID) {
      fail(response, 502, 'SESSION_CREATE_FAILED', 'The engine returned no session identity.');
      return;
    }
    response.status(200).json({ sessionID, parentID });
  });

  router.post('/session/start', async (request, response) => {
    const body = bodyOf(request);
    const sessionID = asNonEmptyString(body.sessionID);
    const prompt = asNonEmptyString(body.prompt);
    const directory = asNonEmptyString(body.directory);
    const agent = body.agent === undefined ? undefined : asNonEmptyString(body.agent);
    if (!sessionID || !prompt || !directory || agent === null) {
      fail(response, 400, 'INVALID_ARGUMENT', 'sessionID, prompt and directory are required strings.');
      return;
    }
    if (!agentAllowed(allowedAgents, agent)) {
      fail(response, 403, 'AGENT_NOT_ALLOWED', `${agent} is not in this host's allowlist.`);
      return;
    }
    if (!(await allowed(authorize, { token: request.capabilityToken, sessionID, directory }))) {
      fail(response, 403, 'FORBIDDEN', 'This token may not start that session.');
      return;
    }
    if (createClient === undefined) {
      fail(response, 503, 'SESSION_CAPABILITY_UNAVAILABLE', 'This server exposes no session client.');
      return;
    }
    const client = await createClient({ directory });
    const parts = [{ type: 'text', text: prompt }];
    try {
      const sent = await client.session.promptAsync({
        path: { id: sessionID },
        body: agent === undefined ? { parts } : { parts, agent },
        query: { directory },
      });
      if (sent?.error !== undefined && sent?.error !== null) {
        response.status(200).json({ outcome: 'refused' });
        return;
      }
      response.status(200).json({ outcome: 'accepted' });
    } catch {
      // A thrown dispatch cannot prove the prompt never reached the engine.
      response.status(200).json({ outcome: 'unknown' });
    }
  });

  router.post('/task', async (request, response) => {
    const body = bodyOf(request);
    const description = asNonEmptyString(body.description);
    const prompt = asNonEmptyString(body.prompt);
    // The host this gateway owns is the gateway's to wait for. A plugin caller cannot interpret a bare 503, so a
    // transient (starting, rebinding, listener lost) is absorbed here instead of being returned as a refusal.
    const deferralStartedAt = Date.now();
    let deferred = typeof waitReady === 'function' ? await waitReady() : undefined;
    if (deferred === false) {
      console.warn('[capability] task deferred', { reason: 'host-not-ready', lifecycle: asNonEmptyString(hostState?.()) ?? null, waitedMs: Date.now() - deferralStartedAt });
      response.status(503).json({ error: 'TASK_MANAGER_UNAVAILABLE', reason: 'host-starting', message: 'The task host did not become ready in time.' });
      return;
    }
    deferred = undefined;
    // Read the binding once, before anything can fall back to the caller's id: a relaunched host binds its session a
    // moment after it reports ready, and authorizing with the caller's stale id refuses a caller that is not at fault.
    const boundParentID = asNonEmptyString(boundParentOf());
    const lifecycleNow = typeof hostState === 'function' ? asNonEmptyString(hostState()) : undefined;
    if (lifecycleNow === 'ready' && typeof boundParent === 'function' && boundParentID == null) {
      response.status(503).json({ error: 'TASK_MANAGER_UNAVAILABLE', reason: 'host-rebinding', message: 'The task host is binding its session; retry once it is ready.' });
      return;
    }
    const parentSessionID = boundParentID ?? asNonEmptyString(body.parentSessionID);
    if (!description || !prompt || !parentSessionID) {
      fail(response, 400, 'INVALID_ARGUMENT', 'description, prompt and parentSessionID are required strings.');
      return;
    }
    const directory = asNonEmptyString(body.directory) ?? undefined;
    const requestedAgent = body.agent === undefined ? undefined : asNonEmptyString(body.agent) ?? undefined
    if (!agentAllowed(allowedAgents, requestedAgent)) {
      fail(response, 403, 'AGENT_NOT_ALLOWED', `${requestedAgent} is not in this host's allowlist.`)
      return
    }
    // While the host is starting there is no parent to bind, and answering 403 would report a refusal that never
    // happened. That case is a retryable 503 that names itself.
    const lifecycle = typeof hostState === 'function' ? asNonEmptyString(hostState()) : undefined;
    // These two only apply when no waiter is wired: with one, the host was just proven serveable above.
    if (typeof waitReady !== 'function' && (lifecycle === 'starting' || lifecycle === 'stopping')) {
      response.status(503).json({ error: 'TASK_MANAGER_UNAVAILABLE', reason: 'host-starting', message: `The task host is ${lifecycle}; retry once it is ready.` });
      return;
    }
    if (typeof waitReady !== 'function' && typeof ensureHostLive === 'function' && lifecycle != null && lifecycle !== 'ready') {
      response.status(503).json({ error: 'TASK_MANAGER_UNAVAILABLE', reason: 'host-unreachable', message: `The task host is ${lifecycle}; it did not start.` });
      return;
    }
    // A host can be "ready" and still have lost its listener. Ask it to prove itself (and relaunch once) before the task
    // is handed over, because otherwise the caller gets "unreachable: fetch failed" with no way back.
    const live = typeof ensureHostLive === 'function' ? await ensureHostLive() : undefined;
    if (live === false) {
      response.status(503).json({ error: 'TASK_MANAGER_UNAVAILABLE', reason: 'host-unreachable', message: 'The task host stopped answering and could not be restarted.' });
      return;
    }
    if (!(await allowed(authorize, { token: request.capabilityToken, parentID: parentSessionID, directory }))) {
      // The caller only sees a bare 403 (the plugin discards the body), so the server records WHICH check refused.
      // No secret is printed: only whether a token was presented and which parent was resolved.
      console.warn('[capability] refused task start', {
        tokenPresented: asNonEmptyString(request.capabilityToken) != null,
        resolvedParent: parentSessionID,
        boundParent: asNonEmptyString(boundParentOf()) ?? null,
      });
      fail(response, 403, 'FORBIDDEN', 'This token may not start a task under that parent session.');
      return;
    }
    if (taskStarter === undefined) {
      response.status(503).json(NO_MANAGER_BODY);
      return;
    }
    try {
      // A host refuses a task that names no target at all ("requires a category, subagent_type, or model"). A caller
      // that omits every one of them means "the product's default", so the gateway supplies the configured model.
      const targeted = ['category', 'subagent_type', 'model'].some((key) => asNonEmptyString(body[key]) != null);
      const fallbackModel = targeted ? undefined : await resolveDefaultModel?.();
      const started = await taskStarter(
        fallbackModel === undefined ? { ...body, parentSessionID } : { ...body, parentSessionID, model: fallbackModel },
      );
      const taskID = asNonEmptyString(started?.taskID);
      const state = asNonEmptyString(started?.state);
      if (!taskID || !state || !STATES.has(state)) {
        fail(response, 502, 'TASK_MANAGER_UNAVAILABLE', 'The task manager returned no usable task.');
        return;
      }
      response.status(200).json({ taskID, state });
    } catch (error) {
      // A refusal that carries the host's own code is reported as such; only an absent or unreachable manager is 503.
      const code = typeof error?.code === 'string' ? error.code : undefined
      const message = typeof error?.message === 'string' ? error.message : undefined
      console.warn('[capability] task start failed', { code, message })
      if (code !== undefined && code !== 'TASK_MANAGER_UNAVAILABLE' && message !== undefined) {
        fail(response, 502, code, message)
        return
      }
      response.status(503).json(NO_MANAGER_BODY);
    }
  });

  return router;
};

const capabilityOutcomes = Object.freeze([...OUTCOMES]);
