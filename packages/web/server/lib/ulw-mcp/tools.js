// Bundled ULW MCP tool definitions and dispatcher.
//
// Each tool calls the SAME AgentToolkit method the matching CLI subcommand
// in `ulw-loop/src/cli-subcommands.ts` calls (via `createAgentToolkit` from
// `ulw-loop/src/sdk/factory.ts`). The mapping is:
//
//   create-goals       -> toolkit.createGoals        (CLI: createGoals)
//   inspect            -> toolkit.criteria            (CLI: criteria; goal-level inspection)
//   revise-goals       -> toolkit.steer              (CLI: steer; plan revisions)
//   record-evidence    -> toolkit.recordEvidence     (CLI: record-evidence; criterion evidence)
//   dispatch           -> toolkit.dispatchGoals      (CLI: dispatchGoals)
//   record-child-result  -> toolkit.recordChildResult  (CLI: reportChildResult)
//   record-child-failure -> toolkit.recordChildFailure (CLI: reportChildFailure)
//   checkpoint         -> toolkit.checkpoint         (CLI: checkpoint)
//   complete           -> toolkit.completeGoals      (CLI: completeGoals)
//   status             -> toolkit.status             (CLI: status)
//
// `status` reads the plan; `inspect` reads one goal's criteria. `complete`
// acquires the next eligible goal. This module adds no state machine: it
// validates transport-level inputs, forwards to the toolkit, and renders the
// toolkit envelope ({ ok, result } / { ok: false, error }) as an MCP result.
import { createUlwToolkit } from './toolkit-provider.js';

const CONTEXT_PROPERTIES = {
  cwd: { type: 'string', description: 'Repository root the ULW loop state lives under' },
  sessionId: { type: 'string', description: 'Owning session id; scopes the plan directory' },
  surface: {
    type: 'string',
    enum: ['omo-senpi', 'lazycodex'],
    description: 'Toolkit surface; omit to use the same resolver the CLI uses',
  },
};

export const ULW_MCP_TOOL_DEFS = [
  {
    name: 'create-goals',
    description: 'Create the session plan from a brief; one goal per bullet.',
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        brief: { type: 'string', description: 'Plan brief text' },
        force: { type: 'boolean', description: 'Recreate when a plan already exists' },
      },
      required: ['cwd', 'sessionId', 'brief'],
    },
  },
  {
    name: 'inspect',
    description: "Inspect one goal's success criteria with status and captured evidence.",
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        goalId: { type: 'string', description: 'Goal to inspect' },
      },
      required: ['cwd', 'sessionId', 'goalId'],
    },
  },
  {
    name: 'revise-goals',
    description: 'Propose an evidence-backed plan revision (wording, criteria, order, blockers).',
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        kind: { type: 'string', description: 'Steering kind, e.g. revise_criterion or revise_pending_wording' },
        source: { type: 'string', description: 'Proposal source, e.g. cli' },
        evidence: { type: 'string', description: 'Evidence backing the revision' },
        rationale: { type: 'string', description: 'Why the revision is needed' },
        goalId: { type: 'string', description: 'Affected goal, when the kind targets one' },
        criterionId: { type: 'string', description: 'Criterion to revise; required when kind is revise_criterion' },
        scenario: { type: 'string', description: 'Replacement observable scenario; revise_criterion needs scenario, expectedEvidence, or userModel' },
        expectedEvidence: { type: 'string', description: 'Replacement proof description; revise_criterion needs scenario, expectedEvidence, or userModel' },
        userModel: { type: 'string', enum: ['happy', 'edge', 'regression', 'adversarial'], description: 'Replacement verification model; revise_criterion needs scenario, expectedEvidence, or userModel' },
      },
      required: ['cwd', 'sessionId', 'kind', 'source', 'evidence', 'rationale'],
    },
  },
  {
    name: 'record-evidence',
    description: "Record a criterion's pass, fail, or blocked evidence.",
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        goalId: { type: 'string', description: 'Goal owning the criterion' },
        criterionId: { type: 'string', description: 'Criterion receiving evidence' },
        status: { type: 'string', enum: ['pass', 'fail', 'blocked'], description: 'Criterion outcome' },
        evidence: { type: 'string', description: 'Observed proof for the outcome' },
        notes: { type: 'string', description: 'Optional reviewer notes' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'Optional evidence artifact paths, resolved against the session cwd' },
      },
      required: ['cwd', 'sessionId', 'goalId', 'criterionId', 'status', 'evidence'],
    },
  },
  {
    name: 'dispatch',
    description: 'Open one dispatch attempt per pending goal and return per-goal handoffs.',
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        goalIds: { type: 'array', items: { type: 'string' }, description: 'Goals to dispatch; omit for all pending' },
        childRole: { type: 'string', description: 'Role the dispatched child runs as' },
      },
      required: ['cwd', 'sessionId'],
    },
  },
  {
    name: 'record-child-result',
    description: "Record a dispatched goal's child result by artifact reference; completes the goal.",
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        goalId: { type: 'string', description: 'Dispatched goal' },
        childId: { type: 'string', description: 'Child that produced the result' },
        resultRef: { type: 'string', description: 'Artifact reference to the child result' },
      },
      required: ['cwd', 'sessionId', 'goalId', 'childId', 'resultRef'],
    },
  },
  {
    name: 'record-child-failure',
    description: "Record a dispatched goal's child failure; the goal fails, retryable unless retryable is false.",
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        goalId: { type: 'string', description: 'Dispatched goal' },
        childId: { type: 'string', description: 'Child that failed' },
        reason: { type: 'string', description: 'Why the child failed' },
        retryable: { type: 'boolean', description: 'Pass false when the goal must not be retried' },
      },
      required: ['cwd', 'sessionId', 'goalId', 'childId', 'reason'],
    },
  },
  {
    name: 'checkpoint',
    description: 'Close a goal as complete, failed, or blocked with evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        goalId: { type: 'string', description: 'Goal to close' },
        status: { type: 'string', enum: ['complete', 'failed', 'blocked'], description: 'Closing status' },
        evidence: { type: 'string', description: 'Evidence for the close' },
        codexGoalJson: { type: 'string', description: 'Inline codex goal snapshot JSON, when required' },
        qualityGateJson: { type: 'string', description: 'Quality gate JSON for final completion' },
        printTemplate: { type: 'boolean', description: 'Return the gate template instead of closing' },
      },
      required: ['cwd', 'sessionId', 'goalId'],
    },
  },
  {
    name: 'complete',
    description: 'Acquire the next eligible goal or resume the in-progress one.',
    inputSchema: {
      type: 'object',
      properties: {
        ...CONTEXT_PROPERTIES,
        retryFailed: { type: 'boolean', description: 'Re-acquire failed goals when nothing else is eligible' },
      },
      required: ['cwd', 'sessionId'],
    },
  },
  {
    name: 'status',
    description: 'Read the plan, its summary, next actions, and evidence root.',
    inputSchema: {
      type: 'object',
      properties: { ...CONTEXT_PROPERTIES },
      required: ['cwd', 'sessionId'],
    },
  },
];

const TOOL_NAMES = new Set(ULW_MCP_TOOL_DEFS.map((tool) => tool.name));

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const usageError = (message) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: 'ULW_MCP_USAGE', message } }) }],
  structuredContent: { ok: false, error: { code: 'ULW_MCP_USAGE', message } },
});

const toolkitFailure = (response) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify(response) }],
  structuredContent: response,
});

const toolkitSuccess = (response) => ({
  content: [{ type: 'text', text: JSON.stringify(response.result) }],
  structuredContent: response.result,
});

const toMcpResult = (response) => (response.ok ? toolkitSuccess(response) : toolkitFailure(response));

const fromThrown = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error?.code && typeof error.code === 'string' ? error.code : 'ULW_MCP_RUNTIME';
  return toolkitFailure({ ok: false, operation: 'unknown', error: { code, message } });
};

/**
 * Call one MCP tool through the shared AgentToolkit.
 *
 * Never throws: toolkit failure envelopes and unexpected throws both come
 * back as MCP `isError` results, so a failed transition stays observable on
 * the wire instead of dropping the JSON-RPC call.
 */
export const createUlwMcpTools = ({ toolkitProvider = createUlwToolkit } = {}) => {
  const callTool = async (name, args = {}) => {
    if (!TOOL_NAMES.has(name)) return usageError(`Unknown ULW tool: ${name}.`);
    const input = args ?? {};
    const cwd = asNonEmptyString(input.cwd);
    const sessionId = asNonEmptyString(input.sessionId);
    if (!cwd || !sessionId) return usageError('cwd and sessionId are required.');
    const context = { cwd, sessionId };
    if (input.surface !== undefined) context.surface = input.surface;

    try {
      const toolkit = toolkitProvider(context);
      switch (name) {
        case 'create-goals': {
          const brief = asNonEmptyString(input.brief);
          if (!brief) return usageError('brief is required.');
          const createArgs = { brief };
          if (input.force !== undefined) createArgs.force = input.force;
          return toMcpResult(await toolkit.createGoals(createArgs));
        }
        case 'inspect': {
          const goalId = asNonEmptyString(input.goalId);
          if (!goalId) return usageError('goalId is required.');
          return toMcpResult(await toolkit.criteria({ goalId }));
        }
        case 'revise-goals': {
          for (const field of ['kind', 'source', 'evidence', 'rationale']) {
            if (!asNonEmptyString(input[field])) return usageError(`${field} is required.`);
          }
          const { cwd: _cwd, sessionId: _sessionId, surface: _surface, ...steerArgs } = input;
          return toMcpResult(await toolkit.steer(steerArgs));
        }
        case 'record-evidence': {
          for (const field of ['goalId', 'criterionId']) {
            if (!asNonEmptyString(input[field])) return usageError(`${field} is required.`);
          }
          if (!['pass', 'fail', 'blocked'].includes(input.status)) {
            return usageError('status must be pass, fail, or blocked.');
          }
          if (!asNonEmptyString(input.evidence)) return usageError('evidence is required.');
          const evidenceArgs = {
            goalId: input.goalId.trim(),
            criterionId: input.criterionId.trim(),
            status: input.status,
            evidence: input.evidence.trim(),
          };
          if (asNonEmptyString(input.notes)) evidenceArgs.notes = input.notes.trim();
          if (input.artifacts !== undefined) {
            const artifacts = Array.isArray(input.artifacts) ? input.artifacts : null;
            if (artifacts === null || artifacts.some((entry) => asNonEmptyString(entry) === null)) {
              return usageError('artifacts must be an array of non-empty strings.');
            }
            evidenceArgs.artifacts = artifacts;
          }
          return toMcpResult(await toolkit.recordEvidence(evidenceArgs));
        }
        case 'dispatch': {
          const dispatchArgs = {};
          if (input.goalIds !== undefined) dispatchArgs.goalIds = input.goalIds;
          if (asNonEmptyString(input.childRole)) dispatchArgs.childRole = input.childRole.trim();
          return toMcpResult(await toolkit.dispatchGoals(dispatchArgs));
        }
        case 'record-child-result': {
          for (const field of ['goalId', 'childId', 'resultRef']) {
            if (!asNonEmptyString(input[field])) return usageError(`${field} is required.`);
          }
          return toMcpResult(
            await toolkit.recordChildResult({
              goalId: input.goalId.trim(),
              childId: input.childId.trim(),
              resultRef: input.resultRef.trim(),
            }),
          );
        }
        case 'record-child-failure': {
          // Failure policy: the goal stays retryable unless the caller opts
          // out with retryable false — the same default the CLI's --no-retry
          // flag encodes (absent flag means retryable).
          for (const field of ['goalId', 'childId', 'reason']) {
            if (!asNonEmptyString(input[field])) return usageError(`${field} is required.`);
          }
          const failureArgs = {
            goalId: input.goalId.trim(),
            childId: input.childId.trim(),
            reason: input.reason.trim(),
          };
          if (input.retryable !== undefined) failureArgs.retryable = input.retryable;
          return toMcpResult(await toolkit.recordChildFailure(failureArgs));
        }
        case 'checkpoint': {
          const goalId = asNonEmptyString(input.goalId);
          if (!goalId) return usageError('goalId is required.');
          if (input.printTemplate === true) {
            return toMcpResult(await toolkit.checkpoint({ printTemplate: true, goalId }));
          }
          if (!['complete', 'failed', 'blocked'].includes(input.status)) {
            return usageError('status must be complete, failed, or blocked.');
          }
          if (!asNonEmptyString(input.evidence)) return usageError('evidence is required.');
          const checkpointArgs = {
            goalId,
            status: input.status,
            evidence: input.evidence.trim(),
          };
          if (input.codexGoalJson !== undefined) checkpointArgs.codexGoalJson = input.codexGoalJson;
          if (input.qualityGateJson !== undefined) checkpointArgs.qualityGateJson = input.qualityGateJson;
          return toMcpResult(await toolkit.checkpoint(checkpointArgs));
        }
        case 'complete': {
          const completeArgs = {};
          if (input.retryFailed !== undefined) completeArgs.retryFailed = input.retryFailed;
          return toMcpResult(await toolkit.completeGoals(completeArgs));
        }
        case 'status': {
          return toMcpResult(await toolkit.status());
        }
        default:
          return usageError(`Unknown ULW tool: ${name}.`);
      }
    } catch (error) {
      return fromThrown(error);
    }
  };

  return { toolDefs: ULW_MCP_TOOL_DEFS, callTool };
};
