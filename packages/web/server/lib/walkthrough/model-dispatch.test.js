// Dispatch tests for the walkthrough bridge migration: generation resolves
// through the engine model-core pipeline, and a model that fails at dispatch
// falls back per chain (the forced-downgrade path) instead of failing the
// review. The small-model bridge and git are substituted with `mock.module`;
// everything else — pipeline, orchestration, cache, schema — is real.
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-dispatch-'));
// Assigned at import (not in beforeAll): walkthrough/store.js pins DATA_DIR
// at module load, so the dir must be set before the `await import` below.
// Saved and restored in afterAll so sibling suites keep their own dir.
const PREV_DATA_DIR = process.env.OPENCHAMBER_DATA_DIR;
process.env.OPENCHAMBER_DATA_DIR = TEMP_DATA_DIR;

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
+const added = true;
`;

// Same shape the jobs suite proves parses: one chapter, one stop, one hunk.
const RESPONSE = JSON.stringify({
  title: 'Change',
  focus: 'why',
  chapters: [{
    title: 'Data',
    icon: 'doc',
    blurb: '',
    stops: [{ title: 'Adds a flag', hunks: ['h1'], importance: 'normal', prose: 'It adds a flag.' }],
  }],
});

// Mock state lives on globalThis because module mock factories cannot close
// over this file's locals.
globalThis.__walkthroughDispatchState = {
  generateCalls: [],
  badModels: new Set(),
  noLoginModels: new Set(),
  rejectAllDispatches: false,
};

const parseRef = (ref) => {
  const slash = String(ref).indexOf('/');
  return { providerID: ref.slice(0, slash), modelID: ref.slice(slash + 1) };
};

mock.module('../small-model/index.js', () => ({
  describeSmallModel: async (options) => {
    const ref = options.overrideModel ?? 'anthropic/claude-haiku-4-5';
    const { providerID, modelID } = parseRef(ref);
    return {
      providerID,
      modelID,
      source: options.overrideModel ? 'request' : 'config',
      inputCharBudget: 1_000_000,
      contextTokens: 250_000,
      outputTokens: 24_000,
      outputTokenLimit: 32_768,
      // A model with no credential behind it: the bridge reports it so the
      // caller can refuse before spending a request.
      hasLogin: !globalThis.__walkthroughDispatchState.noLoginModels.has(ref),
      structuredOutput: null,
    };
  },
  generateSmallModelText: async (options) => {
    globalThis.__walkthroughDispatchState.generateCalls.push(options);
    if (
      globalThis.__walkthroughDispatchState.rejectAllDispatches
      || globalThis.__walkthroughDispatchState.badModels.has(options.model)
    ) {
      throw Object.assign(new Error(`Model unavailable: ${options.model}`), {
        statusCode: 503,
        code: 'small-model-unavailable',
      });
    }
    return { text: RESPONSE };
  },
}));

mock.module('../git/service.js', () => ({
  getRepositoryRoot: async (directory) => directory,
  getDiff: async (_directory, options) => (options?.staged ? '' : PATCH),
  getRangeDiff: async () => PATCH,
  getCommitDiff: async () => PATCH,
  getUntrackedDiffs: async () => [],
  listUntrackedPaths: async () => [],
}));

const { generateWalkthrough } = await import('./index.js');

const state = () => globalThis.__walkthroughDispatchState;

beforeEach(() => {
  fs.rmSync(path.join(TEMP_DATA_DIR, 'walkthroughs'), { recursive: true, force: true });
  state().generateCalls = [];
  state().badModels = new Set();
  state().noLoginModels = new Set();
  state().rejectAllDispatches = false;
});

afterAll(() => {
  fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  mock.restore();
  if (PREV_DATA_DIR === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
  else process.env.OPENCHAMBER_DATA_DIR = PREV_DATA_DIR;
});

// `mock.module` only substitutes modules under Bun. Under any other runner
// (the workspace `vitest run`) the bridge cannot be substituted, so these
// dispatch tests skip there instead of failing against real git and OpenCode.
const describeDispatch = globalThis.Bun !== undefined ? describe : describe.skip;

describeDispatch('bridge dispatch through the model-core pipeline', () => {
  it('falls back per chain when the resolved model fails at dispatch', async () => {
    state().badModels.add('bad/ghost-1');

    const result = await generateWalkthrough({
      directory: '/repo-dispatch-fallback',
      source: { kind: 'working-tree', scope: 'all' },
      model: 'bad/ghost-1',
    });

    expect(result.walkthrough.title).toBe('Change');
    expect(result.fromCache).toBeFalsy();
    const tried = state().generateCalls.map((call) => call.model);
    // The bad model is tried first, then the downgrade chain — never the bad
    // model twice, and the review lands on an engine chain entry.
    expect(tried[0]).toBe('bad/ghost-1');
    expect(tried.length).toBeGreaterThan(1);
    expect(tried.slice(1).every((model) => model !== 'bad/ghost-1')).toBe(true);
    expect(result.model.providerID).not.toBe('bad');
    expect(`${result.model.providerID}/${result.model.modelID}`).toBe(tried.at(-1));
  });

  it('refuses an explicitly chosen model with no login instead of spending another provider', async () => {
    state().noLoginModels.add('nolog/pro-1');

    const error = await generateWalkthrough({
      directory: '/repo-dispatch-nologin',
      source: { kind: 'working-tree', scope: 'all' },
      model: 'nolog/pro-1',
    }).catch((cause) => cause);

    expect(error?.code).toBe('no-provider-login');
    expect(error?.statusCode).toBe(401);
    expect(state().generateCalls).toHaveLength(0);
  });

  it('fails with the dispatch error when every chain model is bad', async () => {
    // Every dispatch rejects: the primary and the whole downgrade chain.
    state().rejectAllDispatches = true;

    const error = await generateWalkthrough({
      directory: '/repo-dispatch-all-bad',
      source: { kind: 'working-tree', scope: 'all' },
      model: 'bad/ghost-9',
    }).catch((cause) => cause);

    // The chain is walked to exhaustion: more than one model attempted, and
    // the surfaced error is the dispatch failure with the downgrade trail.
    const tried = state().generateCalls.map((call) => call.model);
    expect(tried.length).toBeGreaterThan(1);
    expect(error?.code).toBe('small-model-unavailable');
    expect(error?.downgradeAttempted?.length).toBeGreaterThan(0);
  });
});
