// Bundled ULW control-plane toolkit provider.
//
// Every MCP tool in this directory delegates to the SAME AgentToolkit the CLI
// path calls: `createAgentToolkit` from the ulw-loop SDK factory (the object
// `cli-subcommands.ts` reaches through `toolkitFor`). No transition logic is
// duplicated here; this module only builds the per-call toolkit context.
import { createAgentToolkit } from '../../../../omo-engine/omo-codex/plugin/components/ulw-loop/dist/sdk/factory.js';
import { resolveToolkitSurface } from '../../../../omo-engine/omo-codex/plugin/components/ulw-loop/dist/surface.js';

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Build the shared AgentToolkit for one control-plane call.
 *
 * `surface` defaults through `resolveToolkitSurface`, the same resolver the
 * CLI uses, so staged `surface.json` markers and OMO_AGENT_TOOLKIT_SURFACE
 * behave identically on both paths.
 */
export const createUlwToolkit = ({ cwd, sessionId, surface } = {}) => {
  const directory = asNonEmptyString(cwd);
  if (!directory) throw new Error('ulw-mcp: cwd is required.');
  const owner = asNonEmptyString(sessionId);
  if (!owner) throw new Error('ulw-mcp: sessionId is required.');
  return createAgentToolkit({
    cwd: directory,
    sessionId: owner,
    surface: surface ?? resolveToolkitSurface(),
  });
};

export { createAgentToolkit, resolveToolkitSurface };
