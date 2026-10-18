// Each MCP tool must invoke the shared AgentToolkit implementation — the
// same methods the CLI subcommands call — never a duplicated transition.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createUlwToolkit } from './toolkit-provider.js';
import { ULW_MCP_TOOL_DEFS, createUlwMcpTools } from './tools.js';

const CONTEXT = { cwd: '/work/project', sessionId: 'ses-test' };

const TOOLKIT_METHODS = [
  'createGoals',
  'criteria',
  'steer',
  'recordEvidence',
  'dispatchGoals',
  'recordChildResult',
  'recordChildFailure',
  'checkpoint',
  'completeGoals',
  'status',
];

const createStubToolkit = () => {
  const toolkit = {};
  for (const method of TOOLKIT_METHODS) {
    toolkit[method] = vi.fn(async (args) => ({ ok: true, operation: method, result: { method, args } }));
  }
  return toolkit;
};

const createHarness = () => {
  const toolkit = createStubToolkit();
  const toolkitProvider = vi.fn(() => toolkit);
  const tools = createUlwMcpTools({ toolkitProvider });
  return { toolkit, toolkitProvider, tools };
};

describe('ulw-mcp tool definitions', () => {
  it.each([
    'create-goals',
    'inspect',
    'revise-goals',
    'record-evidence',
    'dispatch',
    'record-child-result',
    'record-child-failure',
    'checkpoint',
    'complete',
    'status',
  ])('defines %s with a name, description, and object input schema', (name) => {
    const def = ULW_MCP_TOOL_DEFS.find((tool) => tool.name === name);
    expect(def).toBeDefined();
    expect(def.description.length).toBeGreaterThan(0);
    expect(def.inputSchema.type).toBe('object');
    expect(def.inputSchema.properties.cwd).toBeDefined();
    expect(def.inputSchema.properties.sessionId).toBeDefined();
  });
});

describe('ulw-mcp tools call the shared toolkit implementation', () => {
  it('create-goals invokes toolkit.createGoals with the brief', async () => {
    const { toolkit, toolkitProvider, tools } = createHarness();

    const result = await tools.callTool('create-goals', { ...CONTEXT, brief: 'Ship it', force: true });

    expect(toolkitProvider).toHaveBeenCalledWith(CONTEXT);
    expect(toolkit.createGoals).toHaveBeenCalledWith({ brief: 'Ship it', force: true });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      method: 'createGoals',
      args: { brief: 'Ship it', force: true },
    });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });

  it('inspect invokes toolkit.criteria for the goal', async () => {
    const { toolkit, tools } = createHarness();

    const result = await tools.callTool('inspect', { ...CONTEXT, goalId: 'goal-1' });

    expect(toolkit.criteria).toHaveBeenCalledWith({ goalId: 'goal-1' });
    expect(result.structuredContent.method).toBe('criteria');
  });

  it('revise-goals invokes toolkit.steer with the proposal minus context keys', async () => {
    const { toolkit, tools } = createHarness();

    await tools.callTool('revise-goals', {
      ...CONTEXT,
      kind: 'revise_pending_wording',
      source: 'cli',
      evidence: 'review notes',
      rationale: 'clearer scope',
      goalId: 'goal-1',
    });

    expect(toolkit.steer).toHaveBeenCalledWith({
      kind: 'revise_pending_wording',
      source: 'cli',
      evidence: 'review notes',
      rationale: 'clearer scope',
      goalId: 'goal-1',
    });
  });

  it('revise-goals forwards criterion revision fields to toolkit.steer', async () => {
    const { toolkit, tools } = createHarness();

    await tools.callTool('revise-goals', {
      ...CONTEXT,
      kind: 'revise_criterion',
      source: 'finding',
      evidence: 'survey needs observable proof',
      rationale: 'placeholder scenario is generic',
      goalId: 'goal-1',
      criterionId: 'crit-1',
      scenario: 'list top-level files read-only',
      expectedEvidence: 'file list captured without modifications',
    });

    expect(toolkit.steer).toHaveBeenCalledWith({
      kind: 'revise_criterion',
      source: 'finding',
      evidence: 'survey needs observable proof',
      rationale: 'placeholder scenario is generic',
      goalId: 'goal-1',
      criterionId: 'crit-1',
      scenario: 'list top-level files read-only',
      expectedEvidence: 'file list captured without modifications',
    });
  });

  it('record-evidence invokes toolkit.recordEvidence with the criterion outcome', async () => {
    const { toolkit, tools } = createHarness();

    const result = await tools.callTool('record-evidence', {
      ...CONTEXT,
      goalId: 'goal-1',
      criterionId: 'crit-1',
      status: 'pass',
      evidence: 'file list observed',
    });

    expect(toolkit.recordEvidence).toHaveBeenCalledWith({
      goalId: 'goal-1',
      criterionId: 'crit-1',
      status: 'pass',
      evidence: 'file list observed',
    });
    expect(result.isError).toBeUndefined();
  });

  it('record-evidence rejects a bad status without touching the shared implementation', async () => {
    const { toolkit, tools } = createHarness();

    const result = await tools.callTool('record-evidence', {
      ...CONTEXT,
      goalId: 'goal-1',
      criterionId: 'crit-1',
      status: 'done-ish',
      evidence: 'x',
    });

    expect(result.isError).toBe(true);
    expect(toolkit.recordEvidence).not.toHaveBeenCalled();
  });

  it('dispatch invokes toolkit.dispatchGoals, defaulting to all pending goals', async () => {
    const { toolkit, tools } = createHarness();

    await tools.callTool('dispatch', CONTEXT);
    expect(toolkit.dispatchGoals).toHaveBeenCalledWith({});

    await tools.callTool('dispatch', { ...CONTEXT, goalIds: ['goal-1'], childRole: 'worker' });
    expect(toolkit.dispatchGoals).toHaveBeenCalledWith({ goalIds: ['goal-1'], childRole: 'worker' });
  });

  it('record-child-result invokes toolkit.recordChildResult', async () => {
    const { toolkit, tools } = createHarness();

    await tools.callTool('record-child-result', {
      ...CONTEXT,
      goalId: 'goal-1',
      childId: 'child-1',
      resultRef: 'artifacts/result.json',
    });

    expect(toolkit.recordChildResult).toHaveBeenCalledWith({
      goalId: 'goal-1',
      childId: 'child-1',
      resultRef: 'artifacts/result.json',
    });
  });

  it('record-child-failure stays retryable unless retryable is false', async () => {
    const { toolkit, tools } = createHarness();

    // Default: omit retryable, so the shared implementation keeps the goal
    // retryable — the same default the CLI's absent --no-retry flag encodes.
    await tools.callTool('record-child-failure', {
      ...CONTEXT,
      goalId: 'goal-1',
      childId: 'child-1',
      reason: 'timeout',
    });
    expect(toolkit.recordChildFailure).toHaveBeenCalledWith({
      goalId: 'goal-1',
      childId: 'child-1',
      reason: 'timeout',
    });

    // Opt-out: retryable false reaches the shared implementation, which fails
    // the goal without a retry.
    await tools.callTool('record-child-failure', {
      ...CONTEXT,
      goalId: 'goal-1',
      childId: 'child-1',
      reason: 'bad approach',
      retryable: false,
    });
    expect(toolkit.recordChildFailure).toHaveBeenCalledWith({
      goalId: 'goal-1',
      childId: 'child-1',
      reason: 'bad approach',
      retryable: false,
    });
  });

  it('checkpoint invokes toolkit.checkpoint for a close with evidence', async () => {
    const { toolkit, tools } = createHarness();

    await tools.callTool('checkpoint', {
      ...CONTEXT,
      goalId: 'goal-1',
      status: 'complete',
      evidence: 'all green',
    });

    expect(toolkit.checkpoint).toHaveBeenCalledWith({
      goalId: 'goal-1',
      status: 'complete',
      evidence: 'all green',
    });
  });

  it('checkpoint with printTemplate returns the gate template instead of closing', async () => {
    const { toolkit, tools } = createHarness();

    await tools.callTool('checkpoint', { ...CONTEXT, goalId: 'goal-1', printTemplate: true });

    expect(toolkit.checkpoint).toHaveBeenCalledWith({ printTemplate: true, goalId: 'goal-1' });
  });

  it('checkpoint rejects an unknown status without touching the shared implementation', async () => {
    const { toolkit, tools } = createHarness();

    const result = await tools.callTool('checkpoint', {
      ...CONTEXT,
      goalId: 'goal-1',
      status: 'done-ish',
      evidence: 'x',
    });

    expect(result.isError).toBe(true);
    expect(toolkit.checkpoint).not.toHaveBeenCalled();
  });

  it('complete invokes toolkit.completeGoals, passing retryFailed through', async () => {
    const { toolkit, tools } = createHarness();

    await tools.callTool('complete', CONTEXT);
    expect(toolkit.completeGoals).toHaveBeenCalledWith({});

    await tools.callTool('complete', { ...CONTEXT, retryFailed: true });
    expect(toolkit.completeGoals).toHaveBeenCalledWith({ retryFailed: true });
  });

  it('status invokes toolkit.status with no operation args', async () => {
    const { toolkit, tools } = createHarness();

    await tools.callTool('status', CONTEXT);

    expect(toolkit.status).toHaveBeenCalledWith();
  });
});

describe('ulw-mcp failure policy', () => {
  it('surfaces a toolkit failure envelope as an isError result without throwing', async () => {
    const { toolkit, tools } = createHarness();
    toolkit.status.mockImplementationOnce(async () => ({
      ok: false,
      operation: 'status',
      error: { code: 'ULW_LOOP_PLAN_MISSING', message: 'no plan' },
    }));

    const result = await tools.callTool('status', CONTEXT);

    expect(toolkit.status).toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('ULW_LOOP_PLAN_MISSING');
  });

  it('keeps a thrown shared-implementation error as an isError result', async () => {
    const { toolkit, tools } = createHarness();
    toolkit.dispatchGoals.mockImplementationOnce(async () => {
      throw Object.assign(new Error('lock busy'), { code: 'ULW_LOOP_LOCKED' });
    });

    const result = await tools.callTool('dispatch', CONTEXT);

    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('ULW_LOOP_LOCKED');
  });

  it('rejects a missing brief without invoking the shared implementation', async () => {
    const { toolkit, tools } = createHarness();

    const result = await tools.callTool('create-goals', { ...CONTEXT, brief: '  ' });

    expect(result.isError).toBe(true);
    expect(toolkit.createGoals).not.toHaveBeenCalled();
  });

  it('rejects a missing session context without building a toolkit', async () => {
    const { toolkitProvider, tools } = createHarness();

    const result = await tools.callTool('status', { cwd: '/work/project' });

    expect(result.isError).toBe(true);
    expect(toolkitProvider).not.toHaveBeenCalled();
  });

  it('rejects an unknown tool without invoking anything', async () => {
    const { toolkitProvider, tools } = createHarness();

    const result = await tools.callTool('launch-missiles', CONTEXT);

    expect(result.isError).toBe(true);
    expect(toolkitProvider).not.toHaveBeenCalled();
  });
});

describe('ulw-mcp against the real shared implementation', () => {
  it('creates goals then reads them back through the same transitions the CLI uses', async () => {
    // No stub toolkit: the default provider builds the real AgentToolkit, so
    // this observes the shared transition itself, not a mock of it.
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ulw-mcp-'));
    try {
      const tools = createUlwMcpTools();
      const context = { cwd, sessionId: 'ulw-mcp-test' };

      const created = await tools.callTool('create-goals', {
        ...context,
        brief: '- Alpha goal\n- Beta goal',
      });
      expect(created.isError).toBeUndefined();

      const status = await tools.callTool('status', context);
      expect(status.isError).toBeUndefined();
      expect(status.structuredContent.plan.goals).toHaveLength(2);

      const [first] = status.structuredContent.plan.goals;
      const inspected = await tools.callTool('inspect', { ...context, goalId: first.id });
      expect(inspected.isError).toBeUndefined();
      expect(inspected.structuredContent.goalId).toBe(first.id);
      expect(inspected.structuredContent.criteria.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('revises a placeholder criterion, records evidence, and completes the goal', async () => {
    // Full native lifecycle against the real toolkit: revise one seeded
    // placeholder criterion through the documented revise-goals args, pass
    // every criterion through record-evidence, then close the goal.
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ulw-mcp-lifecycle-'));
    try {
      const tools = createUlwMcpTools();
      const context = { cwd, sessionId: 'ulw-mcp-lifecycle' };

      const revisedDef = ULW_MCP_TOOL_DEFS.find((tool) => tool.name === 'revise-goals');
      for (const field of ['criterionId', 'scenario', 'expectedEvidence', 'userModel']) {
        expect(revisedDef.inputSchema.properties[field]).toBeDefined();
      }
      const evidenceDef = ULW_MCP_TOOL_DEFS.find((tool) => tool.name === 'record-evidence');
      expect(evidenceDef.inputSchema.required).toEqual(
        expect.arrayContaining(['cwd', 'sessionId', 'goalId', 'criterionId', 'status', 'evidence']),
      );

      const created = await tools.callTool('create-goals', {
        ...context,
        brief: '- Survey the widget read-only\n- Note follow-ups',
      });
      expect(created.isError).toBeUndefined();

      const status = await tools.callTool('status', context);
      const [goal] = status.structuredContent.plan.goals;
      const [first, ...rest] = goal.successCriteria;
      expect(goal.successCriteria).toHaveLength(3);

      const revised = await tools.callTool('revise-goals', {
        ...context,
        kind: 'revise_criterion',
        source: 'finding',
        evidence: 'survey needs observable file proof',
        rationale: 'seeded scenario is generic',
        goalId: goal.id,
        criterionId: first.id,
        scenario: 'list top-level widget files read-only',
        expectedEvidence: 'file list captured without modifications',
      });
      expect(revised.isError).toBeUndefined();

      const inspected = await tools.callTool('inspect', { ...context, goalId: goal.id });
      expect(inspected.structuredContent.criteria.find((criterion) => criterion.id === first.id).scenario).toBe(
        'list top-level widget files read-only',
      );

      for (const criterion of [first.id, ...rest.map((item) => item.id)]) {
        const recorded = await tools.callTool('record-evidence', {
          ...context,
          goalId: goal.id,
          criterionId: criterion,
          status: 'pass',
          evidence: `observed proof for ${criterion}`,
        });
        expect(recorded.isError).toBeUndefined();
      }

      const closed = await tools.callTool('checkpoint', {
        ...context,
        goalId: goal.id,
        status: 'complete',
        evidence: 'survey complete, no modifications',
      });
      expect(closed.isError).toBeUndefined();

      const final = await tools.callTool('status', context);
      const done = final.structuredContent.plan.goals.find((item) => item.id === goal.id);
      expect(done.status).toBe('complete');
      expect(done.successCriteria.every((criterion) => criterion.status === 'pass')).toBe(true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it('builds the default toolkit through the shared factory', () => {
    const toolkit = createUlwToolkit({ cwd: '/work/project', sessionId: 'ses-1', surface: 'lazycodex' });
    for (const method of TOOLKIT_METHODS) {
      expect(typeof toolkit[method]).toBe('function');
    }
  });
});
