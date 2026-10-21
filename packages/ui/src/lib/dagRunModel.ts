/**
 * DAG run model for the active conversation, built from the same sync-store
 * slices the chat timeline reads (sessions, statuses, messages, parts).
 *
 * This is the panel's primary source for chat-path runs: those runs never
 * write bridge snapshots or loop state, so the service has nothing for them,
 * while the store already holds the parent record, the parentID-linked child
 * sessions, the subagent tool calls that named them, and the synthetic
 * reports that settled them. Every node below traces to one of those
 * records; nothing is invented, and a conversation with no delegation
 * evidence answers `null` (no run) instead of a fabricated pending graph.
 */
import { findSubagentRun, readSubagentRun } from '@/lib/opencode/subagent-run';
import { isSubagentTool, subagentDescription, subagentSessionId } from '@/lib/opencode/tools';
import type { JsonValue } from '@alcode/sdk';
import type { Message, Part, Session, SessionStatus } from '@/lib/opencode/model';

export type DagChildState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type DagParentState = 'running' | 'completed' | 'failed';

// Narrowing follows the panel's isWireRecord idiom (no typeof operators on
// the value itself): only a real record passes, arrays never do.
const isSnapshotRecord = (value: JsonValue | null | undefined): value is { [key: string]: JsonValue } => (
  Object(value) === value && !Array.isArray(value)
);

/**
 * First-run status of a panel-shape snapshot doc, or null when unreadable.
 * Drives the persist throttle: terminal states always flush to durable
 * storage, running states at most every 30s.
 */
export const dagRunSnapshotStatus = (snapshot: JsonValue | null): string | null => {
  if (!isSnapshotRecord(snapshot)) return null;
  const dag = snapshot.dag;
  if (!isSnapshotRecord(dag)) return null;
  const runs = dag.runs;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const run = runs[0];
  if (!isSnapshotRecord(run)) return null;
  const status = run.status;
  // SAFETY: only strings stringify to themselves; every other JSON value
  // stringifies to something unequal to itself under `===`.
  return String(status) === status && (status as string).length > 0 ? (status as string) : null;
};

export type DagRunChild = {
  sessionId: string;
  label: string;
  agent: string | null;
  description: string | null;
  state: DagChildState;
  startedAt: number;
  endedAt: number | null;
  /** The child's final answer (or failure text) when reported, sliced. */
  output: string | null;
};

export type DagRunModel = {
  version: 1;
  conversationId: string;
  parentSessionId: string;
  /** Run anchor: chat-path runs anchor by parent session id. */
  runId: string;
  /** Settled = children out of pending/running. */
  progress: { total: number; settled: number };
  label: string;
  prompt: string;
  state: DagParentState;
  startedAt: number;
  endedAt: number | null;
  children: DagRunChild[];
  synthesis: { state: 'pending' | 'ready'; text: string | null };
  counts: { pending: number; running: number; completed: number };
  /** Max record time in the model: stable across unrelated store updates. */
  updatedAt: number;
};

export type DagRunModelInput = {
  conversationId: string;
  /** Host-known conversation title (priority 1 label). */
  conversationTitle?: string | null;
  /** Store slices may be partial (bootstrap, directory switches); missing reads as empty, never throws. */
  sessions?: Session[];
  statuses?: Record<string, SessionStatus>;
  /** Parent session messages, oldest first. */
  messages?: Message[];
  /** Parts by message id, parent session only. */
  parts?: Record<string, Part[]>;
};

const UNTITLED = 'Untitled session';
const LABEL_MAX = 80;
const PROMPT_MAX = 240;
const SYNTHESIS_MAX = 500;
const OUTPUT_MAX = 2000;

const clean = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const slice = (value: string, max: number): string => (
  value.length > max ? `${value.slice(0, max - 1)}…` : value
);

const textPartsOf = (parts: Part[] | undefined): string => {
  if (!parts) return '';
  return parts
    .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
};

const firstUserText = (messages: Message[], parts: Record<string, Part[]>): string | null => {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = clean(textPartsOf(parts[message.id]));
    if (text) return text;
  }
  return null;
};

const lastAssistantText = (messages: Message[], parts: Record<string, Part[]>): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    const text = clean(textPartsOf(parts[message.id]));
    if (text) return text;
  }
  return null;
};

type NamedCall = { childId?: string; description: string | null; status: string };

const subagentCallsOf = (messages: Message[], parts: Record<string, Part[]>): NamedCall[] => {
  const calls: NamedCall[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of parts[message.id] ?? []) {
      if (part.type !== 'tool' || !isSubagentTool(part.tool)) continue;
      const status = part.state.status;
      const childId = status === 'completed' || status === 'error'
        ? subagentSessionId(part.state.metadata) ?? undefined
        : undefined;
      calls.push({ childId, description: clean(subagentDescription(part.state.input)), status });
    }
  }
  return calls;
};

const isBusyStatus = (statuses: Record<string, SessionStatus>, sessionId: string): boolean => {
  const status = statuses[sessionId];
  return status !== undefined && status.type !== 'idle';
};

const reportStateOf = (state: string): DagChildState => {
  if (state === 'completed') return 'completed';
  if (state === 'error') return 'failed';
  if (state === 'cancelled') return 'cancelled';
  return 'running';
};

/**
 * Build the run model for one conversation, or `null` when it holds no
 * delegation evidence. A busy parent with no named calls, reports, or child
 * records is an ordinary chat turn, not a DAG run.
 */
export const buildDagRunModel = (input: DagRunModelInput): DagRunModel | null => {
  const sessions = input.sessions ?? [];
  const messages = input.messages ?? [];
  const parts = input.parts ?? {};
  const statuses = input.statuses ?? {};
  const parent = sessions.find((session) => session.id === input.conversationId) ?? null;
  if (!parent) return null;
  const calls = subagentCallsOf(messages, parts);
  const namedIds = new Set<string>();
  for (const call of calls) {
    if (call.childId) namedIds.add(call.childId);
  }
  const reports = new Set<string>();
  for (const message of messages) {
    const run = readSubagentRun(message);
    if (run) reports.add(run.childSessionID);
  }
  const candidates = sessions.filter((session) => session.parentID === input.conversationId);
  const children: DagRunChild[] = [];
  for (const child of candidates) {
    const named = namedIds.has(child.id);
    const reported = reports.has(child.id);
    const busy = isBusyStatus(statuses, child.id);
    // Idle orphans with no call and no report are not this run's delegation
    // (forks, shares, or history outside the loaded messages).
    if (!named && !reported && !busy && !child.agent) continue;
    const report = reported ? findSubagentRun(messages, child.id) ?? null : null;
    const liveCall = calls.find((call) => call.childId === child.id && (call.status === 'pending' || call.status === 'running')) ?? null;
    const finishedCall = calls.find((call) => call.childId === child.id && (call.status === 'completed' || call.status === 'error')) ?? null;
    const description = liveCall?.description ?? finishedCall?.description ?? null;
    let state: DagChildState;
    if (report) state = reportStateOf(report.state);
    else if (liveCall) state = liveCall.status === 'pending' ? 'pending' : 'running';
    else if (busy) state = 'running';
    else if (finishedCall || named) state = 'completed';
    else state = child.agent ? 'completed' : 'pending';
    children.push({
      sessionId: child.id,
      label: slice(description ?? clean(child.title) ?? UNTITLED, LABEL_MAX),
      agent: clean(child.agent) ?? null,
      description,
      state,
      startedAt: child.time?.created ?? 0,
      endedAt: report ? report.reportedAt : null,
      output: report && report.output ? slice(clean(report.output) ?? '', OUTPUT_MAX) || null : null,
    });
  }
  const hasEvidence = calls.length > 0 || reports.size > 0 || children.length > 0;
  if (!hasEvidence) return null;
  children.sort((a, b) => a.startedAt - b.startedAt);

  const parentBusy = isBusyStatus(statuses, parent.id);
  const anyRunning = children.some((child) => child.state === 'running' || child.state === 'pending');
  let state: DagParentState;
  if (parent.outcome === 'failed') state = 'failed';
  else if (anyRunning || parentBusy) state = 'running';
  else state = 'completed';

  const userText = firstUserText(messages, parts);
  const label = clean(input.conversationTitle) ?? clean(parent.title) ?? (userText ? slice(userText, LABEL_MAX) : null) ?? UNTITLED;
  const prompt = userText ? slice(userText, PROMPT_MAX) : label;
  const allTerminal = children.length > 0 && children.every((child) => child.state !== 'running' && child.state !== 'pending');
  const synthesisText = allTerminal && !parentBusy ? lastAssistantText(messages, parts) : null;
  const counts = { pending: 0, running: 0, completed: 0 };
  for (const child of children) {
    if (child.state === 'pending') counts.pending += 1;
    else if (child.state === 'running') counts.running += 1;
    else if (child.state === 'completed') counts.completed += 1;
  }
  const updatedAt = Math.max(
    parent.time?.updated ?? 0,
    ...children.map((child) => child.endedAt ?? child.startedAt),
  );
  return {
    version: 1,
    conversationId: input.conversationId,
    parentSessionId: parent.id,
    runId: parent.id,
    progress: {
      total: children.length,
      settled: children.filter((child) => child.state !== 'running' && child.state !== 'pending').length,
    },
    label,
    prompt,
    state,
    startedAt: parent.time?.created ?? 0,
    endedAt: state === 'completed' ? (parent.time?.updated ?? null) : null,
    children,
    synthesis: allTerminal && !parentBusy
      ? { state: 'ready', text: synthesisText ? slice(synthesisText, SYNTHESIS_MAX) : null }
      : { state: 'pending', text: null },
    counts,
    updatedAt,
  };
};

/** A snapshot document carrying the run model, shaped for parseSnapshotDoc. */
export const dagRunModelToSnapshotDoc = (model: DagRunModel): JsonValue => {
  const parentNode = {
    id: 'parent',
    label: model.label,
    state: model.state === 'completed' ? 'completed' : model.state === 'failed' ? 'failed' : 'running',
    attempt: 1,
    prompt: model.prompt,
    depends_on: [],
    started_at: new Date(model.startedAt).toISOString(),
    completed_at: model.endedAt === null ? null : new Date(model.endedAt).toISOString(),
  };
  const childNodes = model.children.map((child) => ({
    id: child.sessionId,
    label: child.agent ? `${child.agent} — ${child.label}` : child.label,
    state: child.state,
    attempt: 1,
    prompt: child.output
      ? `${child.description ?? child.label}\n\nResult:\n${child.output}`
      : (child.description ?? child.label),
    depends_on: ['parent'],
    started_at: new Date(child.startedAt).toISOString(),
    completed_at: child.endedAt === null ? null : new Date(child.endedAt).toISOString(),
  }));
  const synthesisNode = {
    id: 'synthesis',
    label: 'Synthesis',
    state: model.synthesis.state === 'ready' ? 'completed' : 'pending',
    attempt: 1,
    prompt: model.synthesis.text ?? '',
    depends_on: model.children.map((child) => child.sessionId),
    started_at: null,
    completed_at: null,
  };
  return {
    schemaVersion: 1,
    sessionId: model.parentSessionId,
    updatedAt: new Date(model.updatedAt).toISOString(),
    dag: {
      runs: [{
        run_id: model.parentSessionId,
        run_key: `chat:${model.parentSessionId}`,
        name: model.label,
        status: model.state,
        counts: model.counts,
        nodes: [parentNode, ...childNodes, synthesisNode],
        edges: [
          ...model.children.map((child) => ({ from: 'parent', to: child.sessionId })),
          ...model.children.map((child) => ({ from: child.sessionId, to: 'synthesis' })),
        ],
        waves: [
          { index: 0, node_ids: ['parent'] },
          { index: 1, node_ids: model.children.map((child) => child.sessionId) },
          { index: 2, node_ids: ['synthesis'] },
        ],
      }],
    },
    tasks: null,
  };
};
