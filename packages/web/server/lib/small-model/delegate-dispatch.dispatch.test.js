// Dispatch tests for the delegate-task guard wiring: delegated work
// resolves through the delegate fallback chain and a model that fails at
// dispatch falls back per chain instead of failing the call, while a
// malformed task() call answers the engine retry guidance (fix hint plus a
// corrected example) before anything dispatches. OpenCode is a stub over
// HTTP, exactly like `index.test.js` — no module substitution involved.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'small-model-delegate-dispatch-'));
// Saved/restored per file: sibling suites assign their own temp dir at import
// time, so without this the last-imported file wins for the whole process.
const PREV_DATA_DIR = process.env.OPENCHAMBER_DATA_DIR;

const {
  generateSmallModelText,
  setUnavailableRetryDelaysForTest,
} = await import('./index.js');
const { configureOpenCodeRuntimeProviders, resetOpenCodeRuntimeProviders } = await import('./client.js');
const { registerSmallModelRoutes } = await import('./routes.js');

const state = {
  models: [],
  providers: [],
  defaultModel: null,
  generate: () => ({ text: 'generated' }),
  requests: [],
  generateErrors: [],
};

const MODEL = (overrides = {}) => ({
  id: 'claude-haiku-4-5',
  modelID: 'claude-haiku-4-5',
  providerID: 'anthropic',
  name: 'Claude Haiku',
  enabled: true,
  limit: { context: 8_000, output: 4_000 },
  ...overrides,
});

const HAIKU = MODEL();
const LUNA = MODEL({
  id: 'gpt-5.6-luna',
  modelID: 'gpt-5.6-luna',
  providerID: 'openai',
  name: 'GPT Luna',
  family: 'gpt-luna',
});

const LOCATION = { directory: '/proj', project: { id: 'p', directory: '/proj', canonical: '/proj' } };

const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch {
      resolve({});
    }
  });
});

let server;
let baseUrl;

beforeAll(async () => {
  process.env.OPENCHAMBER_DATA_DIR = TEMP_DATA_DIR;
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const body = req.method === 'POST' ? await readBody(req) : {};
    state.requests.push({ method: req.method, path: url.pathname, body, headers: req.headers });
    const send = (payload) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/api/model') return send({ location: LOCATION, data: state.models });
    if (url.pathname === '/api/model/default') return send({ location: LOCATION, data: state.defaultModel });
    if (url.pathname === '/api/provider') return send({ location: LOCATION, data: state.providers });
    if (url.pathname === '/api/agent/title') {
      return send({
        location: LOCATION,
        data: {
          id: 'title', name: 'Title', mode: 'primary', hidden: true, permissions: [],
          request: { settings: {}, headers: {}, body: {} },
        },
      });
    }
    if (url.pathname === '/api/experimental/generate') {
      const error = state.generateErrors.shift();
      if (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(error));
      }
      return send({ location: LOCATION, data: state.generate(body) });
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  if (PREV_DATA_DIR === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
  else process.env.OPENCHAMBER_DATA_DIR = PREV_DATA_DIR;
});

beforeEach(() => {
  state.models = [HAIKU, LUNA];
  state.providers = [
    { id: 'anthropic', name: 'Anthropic', activation: 'auto', package: 'x' },
    { id: 'openai', name: 'OpenAI', activation: 'auto', package: 'x' },
  ];
  state.defaultModel = HAIKU;
  state.generate = () => ({ text: 'generated' });
  state.requests = [];
  state.generateErrors = [];
  configureOpenCodeRuntimeProviders({
    buildOpenCodeUrl: (requestPath) => `${baseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`,
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Basic test' }),
  });
  resetOpenCodeRuntimeProviders();
  setUnavailableRetryDelaysForTest([1, 1, 1]);
});

afterEach(() => {
  setUnavailableRetryDelaysForTest();
});

const generateCalls = () => state.requests.filter((entry) => entry.path === '/api/experimental/generate');

const CHAIN = [
  { providers: ['anthropic'], model: 'claude-haiku-4-5' },
  { providers: ['openai'], model: 'gpt-5.6-luna' },
];

describe('bad-model-falls-back-per-chain', () => {
  it('downgrades delegated work down the delegate chain when the model fails', async () => {
    // The primary and the first chain entry both stay unavailable through
    // the cold-catalog backoff; the call lands on the second chain entry.
    const ghostDown = { _tag: 'InvalidRequestError', message: 'Model unavailable: bad/ghost-1' };
    const haikuDown = { _tag: 'InvalidRequestError', message: 'Model unavailable: anthropic/claude-haiku-4-5' };
    state.generateErrors = [ghostDown, ghostDown, ghostDown, ghostDown, haikuDown, haikuDown, haikuDown, haikuDown];

    const result = await generateSmallModelText({
      prompt: 'summarize this',
      directory: '/proj',
      model: 'bad/ghost-1',
      fallbackChain: CHAIN,
    });

    expect(result).toMatchObject({
      text: 'generated',
      providerID: 'openai',
      modelID: 'gpt-5.6-luna',
      downgradedFrom: 'bad/ghost-1',
    });
    expect(result.downgradeAttempted).toEqual(['bad/ghost-1', 'anthropic/claude-haiku-4-5']);
    const tried = generateCalls().map((call) => `${call.body.model.providerID}/${call.body.model.id}`);
    expect(tried).toEqual([
      'bad/ghost-1',
      'bad/ghost-1',
      'bad/ghost-1',
      'bad/ghost-1',
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-haiku-4-5',
      'openai/gpt-5.6-luna',
    ]);
  });

  it('fails with the dispatch error and the downgrade trail when the chain is exhausted', async () => {
    state.generateErrors = Array.from({ length: 12 }, () => ({
      _tag: 'InvalidRequestError',
      message: 'Model unavailable: bad/ghost-1',
    }));
    // Every model answers unavailable: the primary plus both chain entries.
    for (let index = 4; index < 12; index += 1) {
      state.generateErrors[index] = {
        _tag: 'InvalidRequestError',
        message: index < 8
          ? 'Model unavailable: anthropic/claude-haiku-4-5'
          : 'Model unavailable: openai/gpt-5.6-luna',
      };
    }

    const error = await generateSmallModelText({
      prompt: 'summarize this',
      directory: '/proj',
      model: 'bad/ghost-1',
      fallbackChain: CHAIN,
    }).catch((cause) => cause);

    expect(error?.code).toBe('small-model-unavailable');
    expect(error?.message).toContain('openai/gpt-5.6-luna');
    // The trail names every ref gone through before the final failure; the
    // final error itself names the last chain entry.
    expect(error?.downgradeAttempted).toEqual([
      'bad/ghost-1',
      'anthropic/claude-haiku-4-5',
    ]);
  });

  it('keeps the single-model shape when no chain is given', async () => {
    state.generateErrors = [
      { _tag: 'InvalidRequestError', message: 'Model unavailable: bad/ghost-1' },
      { _tag: 'InvalidRequestError', message: 'Model unavailable: bad/ghost-1' },
      { _tag: 'InvalidRequestError', message: 'Model unavailable: bad/ghost-1' },
      { _tag: 'InvalidRequestError', message: 'Model unavailable: bad/ghost-1' },
    ];

    const error = await generateSmallModelText({
      prompt: 'summarize this',
      directory: '/proj',
      model: 'bad/ghost-1',
    }).catch((cause) => cause);

    expect(error?.code).toBe('small-model-unavailable');
    expect(error?.downgradeAttempted).toBeUndefined();
    expect(generateCalls()).toHaveLength(4);
  });
});

describe('malformed-task-returns-guidance', () => {
  const captureRoute = (service) => {
    const handlers = {};
    const app = {
      get: (routePath, handler) => { handlers[`GET ${routePath}`] = handler; },
      post: (routePath, handler) => { handlers[`POST ${routePath}`] = handler; },
    };
    registerSmallModelRoutes(app, { getSmallModelService: service });
    return handlers['POST /api/small-model/generate'];
  };

  const runHandler = async (handler, body) => {
    const res = {
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await handler({ body }, res);
    return res;
  };

  it('answers a malformed task() call with the engine retry guidance', async () => {
    let dispatched = 0;
    const handler = captureRoute(async () => ({
      generateSmallModelText: async () => { dispatched += 1; return { text: 'generated' }; },
    }));

    const res = await runHandler(handler, {
      prompt: 'summarize this',
      directory: '/proj',
      task: {
        description: 'Summarize the diff',
        prompt: 'Summarize these changes in one line.',
        category: 'quick',
      },
    });

    // Missing run_in_background: nothing dispatches, and the guidance names
    // the fix plus a corrected example call to retry with.
    expect(res.statusCode).toBe(400);
    expect(res.payload?.code).toBe('delegate-task-malformed');
    expect(res.payload?.errorType).toBe('missing_run_in_background');
    expect(res.payload?.guidance).toContain('run_in_background=true');
    expect(res.payload?.guidance).toContain('Example of CORRECT call');
    expect(res.payload?.guidance).toContain('task(');
    expect(dispatched).toBe(0);
  });

  it('dispatches a well-formed task() call with its chain', async () => {
    let seen = null;
    const handler = captureRoute(async () => ({
      generateSmallModelText: async (options) => { seen = options; return { text: 'generated' }; },
    }));

    const res = await runHandler(handler, {
      prompt: 'summarize this',
      directory: '/proj',
      fallbackChain: CHAIN,
      task: {
        description: 'Summarize the diff',
        prompt: 'Summarize these changes in one line.',
        category: 'quick',
        run_in_background: true,
        load_skills: [],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ text: 'generated' });
    expect(seen?.fallbackChain).toEqual(CHAIN);
  });
});
