/**
 * Activity workspace view models, built from the live run model.
 *
 * Every row traces to a record in `DagRunModel` (which itself traces to
 * sync-store sessions, statuses, messages, and parts). States the engine
 * never reported stay `unknown`; nothing here invents progress, blockers,
 * or rationale.
 */
import type { DagChildState, DagRunChild, DagRunModel } from '@/lib/dagRunModel';
import { findSubagentRun, readSubagentRun } from '@/lib/opencode/subagent-run';
import { isFileChangeTool, isSubagentTool, normalizeToolName, OPENCODE_TOOLS, patchInputFiles, toolInputPath } from '@/lib/opencode/tools';
import type { Message, Part } from '@/lib/opencode/model';

export type ActivityNodeState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'unknown';

export type ActivityTreeRow = {
  id: string;
  kind: 'session' | 'task';
  label: string;
  detail: string | null;
  state: ActivityNodeState;
  agent: string | null;
  /** Settled children over total children; null when not applicable. */
  progress: { settled: number; total: number } | null;
};

export type RunGraphNode = {
  id: string;
  label: string;
  state: ActivityNodeState;
  wave: number;
  x: number;
  y: number;
};

export type RunGraphEdge = {
  from: string;
  to: string;
  /** True when the target cannot start until the source settles. */
  blocking: boolean;
};

export type RunGraph = {
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
  width: number;
  height: number;
};

export type InspectorEvent = {
  id: string;
  at: number | null;
  kind:
    | 'state'
    | 'tool'
    | 'note'
    | 'dependency'
    | 'result';
  label: string;
  detail: string | null;
  /** Source record: message id, part id, or session id. Null when unknown. */
  receiptId: string | null;
};

export type InspectorSummary = {
  id: string;
  /** Where the words came from: the model or a subagent report. */
  source: 'model' | 'subagent';
  label: string;
  text: string;
  receiptId: string;
};

const childStateOf = (state: DagRunChild['state']): ActivityNodeState => state;

const assistantTextOf = (messages: Message[], parts: Record<string, Part[]>): { text: string; id: string }[] => {
  const out: { text: string; id: string }[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const texts = (parts[message.id] ?? [])
      .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text.trim())
      .filter((text) => text.length > 0);
    if (texts.length > 0) out.push({ text: texts.join('\n'), id: message.id });
  }
  return out;
};

/** Explorer rows: the session, its tasks, then synthesis. */
export const buildActivityTree = (model: DagRunModel | null): ActivityTreeRow[] => {
  if (!model) return [];
  const rows: ActivityTreeRow[] = [{
    id: model.parentSessionId,
    kind: 'session',
    label: model.label,
    detail: model.prompt,
    state: model.state === 'running' ? 'running' : model.state === 'failed' ? 'failed' : 'completed',
    agent: null,
    progress: model.children.length > 0
      ? { settled: model.progress.settled, total: model.progress.total }
      : null,
  }];
  for (const child of model.children) {
    rows.push({
      id: child.sessionId,
      kind: 'task',
      label: child.label,
      detail: child.description,
      state: childStateOf(child.state),
      agent: child.agent,
      progress: null,
    });
  }
  rows.push({
    id: 'synthesis',
    kind: 'task',
    label: 'Synthesis',
    detail: model.synthesis.text,
    state: model.synthesis.state === 'ready' ? 'completed' : 'pending',
    agent: null,
    progress: null,
  });
  return rows;
};

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 64;
const WAVE_GAP_X = 72;
const ROW_GAP_Y = 24;

/** Layered run graph: parent (wave 0), tasks (wave 1), synthesis (wave 2). */
export const buildRunGraph = (model: DagRunModel | null): RunGraph | null => {
  if (!model) return null;
  const nodes: RunGraphNode[] = [];
  const edges: RunGraphEdge[] = [];
  const place = (wave: number, index: number) => ({
    x: wave * (NODE_WIDTH + WAVE_GAP_X),
    y: index * (NODE_HEIGHT + ROW_GAP_Y),
  });
  const parent = { x: 0, y: 0 };
  nodes.push({ id: 'parent', label: model.label, state: model.state, wave: 0, ...parent });
  model.children.forEach((child, index) => {
    const at = place(1, index);
    nodes.push({ id: child.sessionId, label: child.label, state: childStateOf(child.state), wave: 1, ...at });
    edges.push({ from: 'parent', to: child.sessionId, blocking: false });
  });
  const synthIndex = Math.max(0, Math.floor((model.children.length - 1) / 2));
  const synth = place(2, synthIndex);
  nodes.push({ id: 'synthesis', label: 'Synthesis', state: model.synthesis.state === 'ready' ? 'completed' : 'pending', wave: 2, ...synth });
  for (const child of model.children) {
    edges.push({ from: child.sessionId, to: 'synthesis', blocking: true });
  }
  const rows = Math.max(1, model.children.length);
  return {
    nodes,
    edges,
    width: 3 * NODE_WIDTH + 2 * WAVE_GAP_X,
    height: rows * NODE_HEIGHT + (rows - 1) * ROW_GAP_Y,
  };
};

type TimelineInput = {
  model: DagRunModel;
  /** Parent session messages, oldest first. */
  messages: Message[];
  parts: Record<string, Part[]>;
  /** Selected row id: parent session id, child session id, or 'synthesis'. */
  selectedId: string;
};

const toolEventsOf = (messages: Message[], parts: Record<string, Part[]>, sessionId: string): InspectorEvent[] => {
  const events: InspectorEvent[] = [];
  for (const message of messages) {
    if (message.sessionID !== sessionId || message.role !== 'assistant') continue;
    for (const part of parts[message.id] ?? []) {
      if (part.type !== 'tool' || isSubagentTool(part.tool)) continue;
      const status = part.state.status;
      const started = 'time' in part.state ? part.state.time.start : null;
      events.push({
        id: `tool:${part.id}`,
        at: started ?? message.time.created ?? null,
        kind: 'tool',
        label: `${part.tool} — ${status}`,
        detail: status === 'error' ? (part.state.output || null) : null,
        receiptId: part.id,
      });
    }
  }
  return events;
};

/**
 * Timeline for the selected row, newest last. Origins:
 * - session/parent: assistant text updates + subagent tool calls + reports.
 * - task/child: the spawn call, the settlement report, and the child's own
 *   tool calls when its transcript is loaded (absent otherwise, never filled in).
 * - synthesis: the settling reports plus the final assistant text.
 */
export const buildInspectorTimeline = (input: TimelineInput): InspectorEvent[] => {
  const { model, messages, parts, selectedId } = input;
  const events: InspectorEvent[] = [];
  if (selectedId === 'synthesis') {
    for (const message of messages) {
      const run = readSubagentRun(message);
      if (!run) continue;
      events.push({
        id: `report:${message.id}`,
        at: run.reportedAt,
        kind: 'result',
        label: `Subagent ${run.childSessionID} ${run.state}`,
        detail: run.output ? run.output.slice(0, 500) : null,
        receiptId: message.id,
      });
    }
    const finals = assistantTextOf(messages, parts);
    const last = finals[finals.length - 1];
    if (last && model.synthesis.state === 'ready') {
      events.push({
        id: `synthesis:${last.id}`,
        at: null,
        kind: 'result',
        label: 'Final summary',
        detail: last.text.slice(0, 500),
        receiptId: last.id,
      });
    }
    return events;
  }
  const child = model.children.find((entry) => entry.sessionId === selectedId) ?? null;
  if (!child) {
    for (const update of assistantTextOf(messages, parts)) {
      events.push({
        id: `note:${update.id}`,
        at: null,
        kind: 'note',
        label: 'Model progress update',
        detail: update.text.slice(0, 500),
        receiptId: update.id,
      });
    }
    return events;
  }
  events.push({
    id: `spawn:${child.sessionId}`,
    at: child.startedAt || null,
    kind: 'dependency',
    label: `Spawned${child.agent ? ` as ${child.agent}` : ''}`,
    detail: child.description,
    receiptId: null,
  });
  const report = findSubagentRun(messages, child.sessionId);
  if (report) {
    events.push({
      id: `report:${child.sessionId}`,
      at: report.reportedAt,
      kind: 'result',
      label: `Settled: ${report.state}`,
      detail: report.output ? report.output.slice(0, 500) : null,
      receiptId: child.sessionId,
    });
  } else {
    events.push({
      id: `state:${child.sessionId}`,
      at: null,
      kind: 'state',
      label: `Current state: ${child.state}`,
      detail: null,
      receiptId: null,
    });
  }
  events.push(...toolEventsOf(messages, parts, child.sessionId));
  return events;
};

/** Cap: the evidence row names results, the timeline below holds them all. */
const MAX_CARD_EVIDENCE = 5;

export type ExplanationNext = 'settled' | 'running' | 'failed' | 'cancelled' | 'pending';

export type ExplanationField = {
  text: string;
  /** Source record, or null when the text is derived rather than quoted. */
  receiptId: string | null;
};

export type ExplanationCard = {
  /** What this task is supposed to accomplish, from its own records. */
  objective: ExplanationField | null;
  /** What actually happened, with its settlement record when present. */
  outcome: ExplanationField | null;
  /** Tool results backing the outcome, each with its receipt. */
  evidence: ExplanationField[];
  /** The current step or blocker, derived from the recorded state. */
  next: ExplanationNext | null;
  /**
   * Recorded per-decision rationale, or null: the engine emits progress
   * text and settlement reports but no decision rationale, so the card says
   * so instead of inventing one.
   */
  rationale: string | null;
};

const nextOfChild = (state: DagChildState): ExplanationNext => {
  switch (state) {
    case 'completed': return 'settled';
    case 'running': return 'running';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'pending';
  }
};

/**
 * The five answers for the selected row, every line traced to a record.
 * Objective quotes the spawn description or run prompt; outcome quotes the
 * settlement report or current state; evidence lists tool results with
 * receipts; next derives from the recorded state; rationale is null until
 * the engine records one.
 */
export const buildExplanationCard = (input: Omit<TimelineInput, 'model'> & { model: DagRunModel | null }): ExplanationCard | null => {
  const { model, messages, parts, selectedId } = input;
  if (!model) return null;
  const timeline = buildInspectorTimeline({ model, messages, parts, selectedId });
  const evidence = timeline
    .filter((event) => event.kind === 'tool')
    .slice(0, MAX_CARD_EVIDENCE)
    .map((event) => ({ text: event.label, receiptId: event.receiptId }));
  if (selectedId === 'synthesis') {
    return {
      objective: { text: model.prompt || model.label, receiptId: null },
      outcome: model.synthesis.state === 'ready'
        ? { text: model.synthesis.text ?? 'Ready', receiptId: null }
        : { text: 'Pending', receiptId: null },
      evidence,
      next: model.synthesis.state === 'ready' ? 'settled' : 'pending',
      rationale: null,
    };
  }
  const child = model.children.find((entry) => entry.sessionId === selectedId) ?? null;
  if (child) {
    const settledReport = findSubagentRun(messages, child.sessionId);
    return {
      objective: { text: child.description ?? child.label, receiptId: null },
      outcome: settledReport
        ? { text: `Settled: ${settledReport.state}`, receiptId: child.sessionId }
        : { text: `Current state: ${child.state}`, receiptId: null },
      evidence,
      next: nextOfChild(child.state),
      rationale: null,
    };
  }
  return {
    objective: { text: model.prompt || model.label, receiptId: null },
    outcome: { text: `Current state: ${model.state}`, receiptId: null },
    evidence,
    next: model.state === 'running' ? 'running' : 'settled',
    rationale: null,
  };
};

/** Cap: the files section links entry points, it does not list a checkout. */
const MAX_TASK_FILES = 10;

/**
 * File paths the selected task provably touched, from its own recorded tool
 * calls (read, edit, write, patch `path` inputs plus patch headers).
 * Reports, summaries, and other tools never contribute: their text may name
 * files without the task ever opening them, and the panel never guesses.
 * Empty when the transcript holds no file calls (or is not loaded).
 */
export const taskAssociatedFiles = (
  messages: Message[],
  parts: Record<string, Part[]>,
  sessionId: string,
): string[] => {
  const files: string[] = [];
  const take = (file: string | undefined): void => {
    const trimmed = file?.trim();
    if (trimmed && !files.includes(trimmed)) files.push(trimmed);
  };
  for (const message of messages) {
    if (message.sessionID !== sessionId || message.role !== 'assistant') continue;
    for (const part of parts[message.id] ?? []) {
      if (part.type !== 'tool' || isSubagentTool(part.tool)) continue;
      const name = normalizeToolName(part.tool);
      if (name !== OPENCODE_TOOLS.read && !isFileChangeTool(part.tool)) continue;
      take(toolInputPath(part.state.input));
      if (name === OPENCODE_TOOLS.patch) {
        for (const file of patchInputFiles(part.state.input)) take(file);
      }
    }
  }
  return files.slice(0, MAX_TASK_FILES);
};

/**
 * Summaries in the model's own words, each labeled with its source.
 * Assistant text = "Model progress update"; subagent report output =
 * "Subagent result". Anything else is not a summary and is not listed.
 */
export const buildInspectorSummaries = (input: TimelineInput): InspectorSummary[] => {
  const { model, messages, parts, selectedId } = input;
  const summaries: InspectorSummary[] = [];
  if (selectedId === model.parentSessionId || selectedId === 'synthesis') {
    for (const update of assistantTextOf(messages, parts)) {
      summaries.push({
        id: `model:${update.id}`,
        source: 'model',
        label: 'Model progress update',
        text: update.text.slice(0, 500),
        receiptId: update.id,
      });
    }
  }
  const childIds = selectedId === 'synthesis'
    ? model.children.map((child) => child.sessionId)
    : [selectedId];
  for (const message of messages) {
    const run = readSubagentRun(message);
    if (!run || !childIds.includes(run.childSessionID) || !run.output) continue;
    summaries.push({
      id: `subagent:${message.id}`,
      source: 'subagent',
      label: `Subagent result (${run.childSessionID})`,
      text: run.output.slice(0, 500),
      receiptId: message.id,
    });
  }
  return summaries;
};
