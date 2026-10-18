// Activity-card data for in-app ULW runs: which control-plane calls a turn
// made, what phase the loop is in, and the concise overall status. Pure
// data, no rendering: the card component owns copy, grouping, and locale.
// Tool identity comes from `@/lib/opencode/tools` (isUlwTool); operation
// stages mirror the server's nine control-plane tools. Non-ULW calls are
// ignored entirely, so totals count control-plane activity only.
import type { Metadata, ToolState } from '@/lib/opencode/model';
import { executeToolCalls, isExecuteTool, isUlwTool, normalizeToolName, type ToolName } from '@/lib/opencode/tools';

export type UlwCallStatus = 'completed' | 'failed' | 'error' | 'running' | 'pending';

export interface UlwToolCall {
  readonly tool: ToolName;
  readonly status: UlwCallStatus;
}

export type UlwPhase = 'idle' | 'planning' | 'investigating' | 'synthesizing' | 'completed';
export type UlwRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface UlwActivitySummary {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly active: number;
  readonly phase: UlwPhase;
  readonly status: UlwRunStatus;
}

const PLANNING_OPS = new Set(['create-goals', 'inspect', 'revise-goals']);
const INVESTIGATING_OPS = new Set(['dispatch', 'record-child-result', 'record-child-failure', 'record-evidence']);
const SYNTHESIZING_OPS = new Set(['checkpoint', 'complete', 'status']);

const opOf = (tool: ToolName): string => {
  const name = normalizeToolName(tool);
  return name.startsWith('ulw_') ? name.slice('ulw_'.length) : name;
};

/**
 * Summarize one turn's ULW control-plane calls. Phase is the highest
 * recognized stage with activity; `complete` succeeding closes the run.
 * Unrecognized `ulw_*` calls count toward the total but advance no stage.
 * Empty input is idle, never a verdict.
 */
export function summarizeUlwActivity(calls: readonly UlwToolCall[]): UlwActivitySummary {
  const ulw = calls.filter((call) => isUlwTool(call.tool));
  if (ulw.length === 0) {
    return { total: 0, completed: 0, failed: 0, active: 0, phase: 'idle', status: 'pending' };
  }
  let completed = 0;
  let failed = 0;
  let active = 0;
  let stage = 0;
  let completeOk = false;
  for (const call of ulw) {
    if (call.status === 'failed' || call.status === 'error') failed += 1;
    else if (call.status === 'completed') completed += 1;
    else active += 1;
    const op = opOf(call.tool);
    if (op === 'complete' && call.status === 'completed') completeOk = true;
    else if (SYNTHESIZING_OPS.has(op)) stage = Math.max(stage, 3);
    else if (INVESTIGATING_OPS.has(op)) stage = Math.max(stage, 2);
    else if (PLANNING_OPS.has(op)) stage = Math.max(stage, 1);
  }
  const phase: UlwPhase = completeOk ? 'completed' : stage === 3 ? 'synthesizing' : stage === 2 ? 'investigating' : 'planning';
  const status: UlwRunStatus = failed > 0 ? 'failed' : phase === 'completed' ? 'completed' : 'running';
  return { total: ulw.length, completed, failed, active, phase, status };
}

export interface UlwRunPart {
  readonly id?: string;
  readonly type: string;
  readonly tool?: ToolName;
  readonly state?: ToolState;
}

const partMetadata = (state: ToolState | undefined): Metadata | undefined =>
  state && 'metadata' in state ? state.metadata : undefined;

const asCallStatus = (status: string | undefined): UlwCallStatus =>
  status === 'completed' || status === 'failed' || status === 'error' || status === 'running' ? status : 'pending';

/**
 * True when the part is a Code Mode `execute` script whose every reported
 * call is a ULW control-plane call. Mixed scripts (ULW plus ordinary tools)
 * and scripts that called nothing stay ordinary Script rows, so user-issued
 * commands are never folded into the card.
 */
export function isAllUlwExecutePart(part: UlwRunPart): boolean {
  if (part.type !== 'tool' || !isExecuteTool(part.tool)) return false;
  const calls = executeToolCalls(partMetadata(part.state));
  return calls.length > 0 && calls.every((call) => isUlwTool(call.tool));
}

/**
 * Summary entries for one collected part: an all-ULW execute script counts
 * once per control-plane call it made (with each call's own status),
 * everything else counts once with the row status.
 */
export function expandUlvCalls(part: UlwRunPart, status: UlwCallStatus): UlwToolCall[] {
  if (!isAllUlwExecutePart(part)) return [{ tool: part.tool ?? '', status }];
  return executeToolCalls(partMetadata(part.state)).map((call) => ({ tool: call.tool, status: asCallStatus(call.status) }));
}

/**
 * Collect the consecutive run of visible ULW tool parts starting at `start`.
 * Pure scan over the message's parts: the renderer maps the returned
 * indexes back to rows and flushes each consumed id through its segment
 * queue. A non-tool part, a non-ULW tool, or an invisible part ends the run.
 */
export function collectUlvRun(
  parts: readonly UlwRunPart[],
  start: number,
  messageId: string,
  isVisible: (part: UlwRunPart) => boolean,
): { run: { id: string; index: number }[]; next: number } {
  const run: { id: string; index: number }[] = [];
  let j = start;
  while (j < parts.length) {
    const next = parts[j];
    if (next.type !== 'tool' || (!isUlwTool(next.tool) && !isAllUlwExecutePart(next)) || !isVisible(next)) break;
    run.push({ id: next.id ?? `${messageId}-part-${j}-${next.type}`, index: j });
    j += 1;
  }
  return { run, next: j };
}
