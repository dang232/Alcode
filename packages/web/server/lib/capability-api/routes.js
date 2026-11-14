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

export const createCapabilityRouter = ({ createClient, taskStarter, authorize } = {}) => {
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
    const parentSessionID = asNonEmptyString(body.parentSessionID);
    if (!description || !prompt || !parentSessionID) {
      fail(response, 400, 'INVALID_ARGUMENT', 'description, prompt and parentSessionID are required strings.');
      return;
    }
    const directory = asNonEmptyString(body.directory) ?? undefined;
    if (!(await allowed(authorize, { token: request.capabilityToken, parentID: parentSessionID, directory }))) {
      fail(response, 403, 'FORBIDDEN', 'This token may not start a task under that parent session.');
      return;
    }
    if (taskStarter === undefined) {
      response.status(503).json(NO_MANAGER_BODY);
      return;
    }
    try {
      const started = await taskStarter({ ...body, parentSessionID });
      const taskID = asNonEmptyString(started?.taskID);
      const state = asNonEmptyString(started?.state);
      if (!taskID || !state || !STATES.has(state)) {
        fail(response, 502, 'TASK_MANAGER_UNAVAILABLE', 'The task manager returned no usable task.');
        return;
      }
      response.status(200).json({ taskID, state });
    } catch {
      response.status(503).json(NO_MANAGER_BODY);
    }
  });

  return router;
};

export const capabilityOutcomes = Object.freeze([...OUTCOMES]);
