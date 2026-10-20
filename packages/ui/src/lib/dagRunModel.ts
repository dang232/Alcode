/**
 * DAG run model for the active conversation, built from the same sync-store
 * slices the chat timeline reads (sessions, statuses, messages, parts).
 *
 * Two run sources feed one card shape. Chat-path runs never write bridge
 * snapshots or loop state, so the service has nothing for them, while the
 * store already holds the parent record, the parentID-linked child
 * sessions, the subagent tool calls that named them, and the synthetic
 * reports that settled them. Native ULW runs are anchored instead by the
 * run id the send path mints into the run session's metadata
 * (`alcode.ulwRunId`): the run record, dispatch roster, and child-result
 * receipts arrive as the native `ulw_*` tool calls in the run transcript,
 * worker identity and liveness from the session records and status events,
 * and completion text from the dispatched-session reports, so every node
 * traces to a runtime record and never to CLI-output parsing. A
 * conversation with neither delegation evidence nor a run id answers `null`
 * (no run) instead of a fabricated pending graph.
 */
import { readDispatchedSessionResult } from '@/lib/opencode/dispatched-session';
import { findSubagentRun, readSubagentRun } from '@/lib/opencode/subagent-run';
import { isFileChangeTool, isShellTool, isSubagentTool, normalizeToolName, subagentDescription, subagentSessionId, toolDescription, toolFileDiffs, toolInputPath } from '@/lib/opencode/tools';
import type { JsonValue } from '@openchamber/sdk';
import type { Metadata, Message, Part, Session, SessionStatus, ToolInput, ToolPart } from '@/lib/opencode/model';

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

/** Where the run's evidence came from: the chat delegation trail or native ULW run events. */
export type DagRunSource = 'delegation' | 'native';

/**
 * The run's genuine lifecycle phase. Delegation runs map it from the card
 * state; native runs read it from the run record (`active` while the store
 * owns it, `complete`/`failed`/`blocked` once `ulw_complete` closes it).
 */
export type DagRunPhase = 'active' | 'complete' | 'failed' | 'blocked';

export type DagChildToolState = 'pending' | 'running' | 'completed' | 'failed';

export type DagChildToolCall = {
  id: string;
  tool: string;
  title: string;
  state: DagChildToolState;
  /** The call's failure text, sliced; null when the call did not fail. */
  error: string | null;
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
  /** Native goal (task) id the worker was dispatched for; null on chat-path runs. */
  goalId: string | null;
  /** Native worker's own tool calls, oldest first; orchestration bookkeeping excluded. */
  toolCalls: DagChildToolCall[];
  /** Receipt's artifact reference for the child's result; null when none was recorded. */
  resultRef: string | null;
  /** Receipt reason, failure report, or failed call text, sliced; null when nothing failed. */
  error: string | null;
  /** Unique file paths the child's completed file-change calls touched. */
  artifacts: string[];
};

export type DagRunModel = {
  version: 1;
  conversationId: string;
  parentSessionId: string;
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
  source: DagRunSource;
  /** Native run id (`alcode.ulwRunId`); the parent session id on chat-path runs. */
  runId: string;
  phase: DagRunPhase;
  /** Goals dispatched vs goals with a recorded child result (native); children settled vs total (delegation). */
  progress: { total: number; settled: number };
  /** Native goal ids dispatched without a recorded child result, in roster order. */
  missingGoalIds: string[];
  /**
   * Parent transcript tool parts that are orchestration bookkeeping
   * (`ulw_*` calls, `ulw-loop` shell argv), in transcript order. Timelines
   * hide these rows; user-issued shell never lands here and stays visible.
   */
  bookkeepingToolCallIds: string[];
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
  /**
   * Full message index by session id, so native workers contribute their
   * own tool calls, results, and errors to the expanded details. Absent
   * reads as no child detail, never throws.
   */
  allMessages?: Record<string, Message[]>;
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

// --- Native ULW runs -----------------------------------------------------------
//
// A native run is anchored by the run id the send path mints into the run
// session's metadata (`alcode.ulwRunId`, see `ulwNativeRun`): metadata
// presence alone opens the card, so a freshly created run already reads
// `active` with empty progress instead of answering `null`.
//
// Everything else comes from the run's own transcript events, never from
// CLI output: `ulw_goal_create` / `ulw_status` / `ulw_complete` carry the run
// record (phase), `ulw_dispatch` carries the goal roster (goal id, worker
// session id, agent, prompt), and `ulw_evidence` carries the child-result
// receipts (goal id, worker session id, completed/failed, result reference,
// failure reason). A `ulw_status` output is the store's own snapshot at that
// point, so it replaces the folded state and later calls apply on top; every
// other event merges in transcript order with the latest recording winning
// per goal. Events naming another run id are ignored for state (they still
// count as orchestration rows below).
//
// Child sessions come from the roster, joined to the session records the
// sync store already holds: agent identity from the worker record (or the
// dispatch entry, or the completion report), completion text from the
// dispatched-session reports, liveness from session status events, and
// expanded tool calls, artifacts, and errors from the worker's own messages.
// A terminal run or a failed parent coerces still-live children to
// failed/cancelled, so a failed run never leaves zombie `running` nodes and
// never reports `completed` while receipts are still missing.

/** Session metadata bag + key carrying the native run id (see `ulwNativeRun`). */
const ULW_METADATA_BAG = 'alcode';
const ULW_RUN_ID_METADATA_KEY = 'ulwRunId';

/** Native ULW tool names (mirror of `ULW_TOOL_NAMES` in the engine's `tools/ulw`). */
const ULW_TOOL_NAMES = new Set([
  'ulw_goal_create',
  'ulw_status',
  'ulw_dispatch',
  'ulw_evidence',
  'ulw_checkpoint',
  'ulw_complete',
]);

export const isUlwTool = (toolName: string | undefined): boolean => ULW_TOOL_NAMES.has(normalizeToolName(toolName));

/**
 * Whether a shell command is orchestration bookkeeping (a `ulw-loop` CLI
 * argv from the old loop appendix) rather than user-issued shell. The match
 * is argv-shaped, never output-shaped: no command output is ever parsed.
 */
export const isUlwBookkeepingShellCommand = (command: string | null | undefined): boolean => {
  if (command === null || command === undefined) return false;
  return command.includes('ulw-loop') || command.includes('ulw_goal') || command.includes('ulw_dispatch')
    || command.includes('ulw_evidence') || command.includes('ulw_checkpoint') || command.includes('ulw_complete')
    || command.includes('ulw_status');
};

const toolInputCommand = (input: ToolInput | undefined): string | null => {
  if (!isSnapshotRecord(input)) return null;
  return jsonText(input.command);
};

/**
 * Whether a tool part is internal orchestration bookkeeping: a native
 * `ulw_*` call, or a shell call running the loop CLI. Timelines hide these
 * rows and fold them into the run card instead; user-issued shell never
 * matches and stays visible.
 */
export const isUlwOrchestrationPart = (part: Part): boolean => {
  if (part.type !== 'tool') return false;
  if (isUlwTool(part.tool)) return true;
  if (!isShellTool(part.tool)) return false;
  return isUlwBookkeepingShellCommand(toolInputCommand(part.state.input));
};

/** The run id anchoring a native run, from the run session's metadata. */
export const readNativeRunId = (session: Session | null | undefined): string | null => {
  if (session === null || session === undefined) return null;
  const metadata = session.metadata;
  if (!isSnapshotRecord(metadata)) return null;
  const bag = metadata[ULW_METADATA_BAG];
  if (!isSnapshotRecord(bag)) return null;
  return jsonText(bag[ULW_RUN_ID_METADATA_KEY]);
};

const jsonText = (value: JsonValue | null | undefined): string | null => {
  if (String(value) !== value) return null;
  // SAFETY: the check above holds only for strings, so the value is one.
  const trimmed = (value as string).trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Wire JSON at a field the caller already validated as present. */
type WireField = JsonValue | undefined;

type NativeRunStatus = 'active' | 'complete' | 'failed' | 'blocked';

const readNativeRunStatus = (value: WireField): NativeRunStatus | null => {
  const text = jsonText(value);
  if (text === 'active' || text === 'complete' || text === 'failed' || text === 'blocked') return text;
  return null;
};

type NativeReceipt = {
  goalId: string;
  childSessionId: string;
  status: 'completed' | 'failed';
  recordedAt: string | null;
  resultRef: string | null;
  reason: string | null;
};

const readNativeReceipt = (value: WireField): NativeReceipt | null => {
  if (!isSnapshotRecord(value)) return null;
  const goalId = jsonText(value.goalId);
  const childSessionId = jsonText(value.childSessionId);
  if (goalId === null || childSessionId === null) return null;
  return {
    goalId,
    childSessionId,
    status: jsonText(value.status) === 'failed' ? 'failed' : 'completed',
    recordedAt: jsonText(value.recordedAt),
    resultRef: jsonText(value.resultRef),
    reason: jsonText(value.reason),
  };
};

type NativeRosterGoal = {
  goalId: string;
  workers: string[];
  agent: string | null;
  prompt: string | null;
};

type NativeFold = {
  brief: string | null;
  status: NativeRunStatus | null;
  goals: NativeRosterGoal[];
  receipts: Map<string, NativeReceipt>;
  bookkeepingCallIds: string[];
};

const goalOf = (fold: NativeFold, goalId: string): NativeRosterGoal => {
  const existing = fold.goals.find((goal) => goal.goalId === goalId);
  if (existing) return existing;
  const created: NativeRosterGoal = { goalId, workers: [], agent: null, prompt: null };
  fold.goals.push(created);
  return created;
};

const addWorker = (fold: NativeFold, goalId: string, workerId: string): void => {
  const goal = goalOf(fold, goalId);
  if (!goal.workers.includes(workerId)) goal.workers.push(workerId);
};

const inputText = (input: ToolInput | undefined, key: string): string | null => {
  if (!isSnapshotRecord(input)) return null;
  return jsonText(input[key]);
};

const parseToolOutput = (output: string): { [key: string]: JsonValue } | null => {
  let raw: JsonValue | null;
  try {
    raw = JSON.parse(output);
  } catch {
    return null;
  }
  return isSnapshotRecord(raw) ? raw : null;
};

type NativeDispatchGoal = {
  goalId: string;
  workerSessionId: string | null;
  agent: string | null;
  prompt: string | null;
};

const readDispatchGoals = (value: WireField): NativeDispatchGoal[] | null => {
  if (!Array.isArray(value)) return null;
  const goals: NativeDispatchGoal[] = [];
  for (const entry of value) {
    if (!isSnapshotRecord(entry)) return null;
    const goalId = jsonText(entry.goalId);
    if (goalId === null) return null;
    goals.push({
      goalId,
      workerSessionId: jsonText(entry.workerSessionId),
      agent: jsonText(entry.agent),
      prompt: jsonText(entry.prompt),
    });
  }
  return goals;
};

const readWorkerList = (value: WireField): string[] | null => {
  if (!Array.isArray(value)) return null;
  const workers: string[] = [];
  for (const entry of value) {
    const worker = jsonText(entry);
    if (worker === null) return null;
    workers.push(worker);
  }
  return workers;
};

const applyDispatchEntry = (fold: NativeFold, entry: NativeDispatchGoal): void => {
  const goal = goalOf(fold, entry.goalId);
  if (entry.workerSessionId !== null) addWorker(fold, entry.goalId, entry.workerSessionId);
  if (entry.agent !== null) goal.agent = entry.agent;
  if (entry.prompt !== null) goal.prompt = entry.prompt;
};

/**
 * Fold one native tool call into the run state. State advances only on
 * completed calls: a pending or running call is intent, not a runtime fact.
 */
const applyNativeCall = (fold: NativeFold, runId: string, name: string, part: ToolPart): void => {
  const state = part.state;
  if (state.status !== 'completed') return;
  const input = state.input;
  const output = parseToolOutput(state.output);
  if (name === 'ulw_goal_create') {
    if (output) {
      const id = jsonText(output.id);
      if (id !== null && id !== runId) return;
      const brief = jsonText(output.brief);
      if (brief !== null) fold.brief = brief;
      const status = readNativeRunStatus(output.status);
      if (status !== null) fold.status = status;
    } else if (fold.brief === null) {
      const id = inputText(input, 'id');
      if (id !== null && id !== runId) return;
      const brief = inputText(input, 'brief');
      if (brief !== null) fold.brief = brief;
    }
    return;
  }
  if (name === 'ulw_status') {
    const inRun = inputText(input, 'runId');
    if (inRun !== null && inRun !== runId) return;
    if (!output) return;
    const run = isSnapshotRecord(output.run) ? output.run : null;
    if (!run || jsonText(run.id) !== runId) return;
    const brief = jsonText(run.brief);
    if (brief !== null) fold.brief = brief;
    const status = readNativeRunStatus(run.status);
    if (status !== null) fold.status = status;
    const roster = isSnapshotRecord(output.roster) ? output.roster : null;
    if (roster) {
      const goals: NativeRosterGoal[] = [];
      for (const goalId of Object.keys(roster)) {
        const workers = readWorkerList(roster[goalId]);
        if (workers === null) continue;
        const kept = goalOf(fold, goalId);
        goals.push({ goalId, workers, agent: kept.agent, prompt: kept.prompt });
      }
      fold.goals = goals;
    }
    const receipts = isSnapshotRecord(output.receipts) ? output.receipts : null;
    if (receipts) {
      const next = new Map<string, NativeReceipt>();
      for (const goalId of Object.keys(receipts)) {
        const receipt = readNativeReceipt(receipts[goalId]);
        if (receipt) next.set(goalId, receipt);
      }
      fold.receipts = next;
    }
    return;
  }
  const eventRunId = inputText(input, 'runId');
  if (eventRunId !== null && eventRunId !== runId) return;
  if (name === 'ulw_dispatch') {
    if (output && output.dispatches !== undefined) {
      const dispatches = readDispatchGoals(output.dispatches);
      if (dispatches) {
        for (const entry of dispatches) applyDispatchEntry(fold, entry);
        return;
      }
    }
    if (output && jsonText(output.goalId) !== null) {
      const goalId = jsonText(output.goalId);
      const worker = jsonText(output.workerSessionId);
      if (goalId !== null && worker !== null) addWorker(fold, goalId, worker);
      const workers = readWorkerList(output.workers);
      if (goalId !== null && workers !== null) {
        for (const workerId of workers) addWorker(fold, goalId, workerId);
      }
      return;
    }
    const goals = readDispatchGoals(isSnapshotRecord(input) ? input.goals : undefined);
    if (goals !== null) {
      for (const entry of goals) applyDispatchEntry(fold, entry);
      return;
    }
    const goalId = inputText(input, 'goalId');
    const worker = inputText(input, 'workerSessionId');
    if (goalId !== null && worker !== null) addWorker(fold, goalId, worker);
    return;
  }
  if (name === 'ulw_evidence') {
    const receipt = output ? readNativeReceipt(output) : null;
    const settled = receipt ?? ((): NativeReceipt | null => {
      const goalId = inputText(input, 'goalId');
      const childSessionId = inputText(input, 'childSessionId');
      if (goalId === null || childSessionId === null) return null;
      return {
        goalId,
        childSessionId,
        status: inputText(input, 'status') === 'failed' ? 'failed' : 'completed',
        recordedAt: null,
        resultRef: inputText(input, 'resultRef'),
        reason: inputText(input, 'reason'),
      };
    })();
    if (!settled) return;
    // Evidence settles a real dispatch; when the roster missed it (a
    // truncated history), the receipt still names its worker.
    addWorker(fold, settled.goalId, settled.childSessionId);
    fold.receipts.set(settled.goalId, settled);
    return;
  }
  if (name === 'ulw_complete') {
    if (output) {
      const id = jsonText(output.id);
      if (id !== null && id !== runId) return;
      const status = readNativeRunStatus(output.status);
      if (status !== null) fold.status = status;
      return;
    }
    const status = readNativeRunStatus(isSnapshotRecord(input) ? input.status : undefined);
    if (status !== null) fold.status = status;
  }
  // `ulw_checkpoint` confirms the gate but carries no run state of its own.
};

const foldNativeEvents = (runId: string, messages: Message[], parts: Record<string, Part[]>): NativeFold => {
  const fold: NativeFold = { brief: null, status: null, goals: [], receipts: new Map(), bookkeepingCallIds: [] };
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of parts[message.id] ?? []) {
      if (part.type !== 'tool') continue;
      const name = normalizeToolName(part.tool);
      if (ULW_TOOL_NAMES.has(name)) {
        fold.bookkeepingCallIds.push(part.id);
        applyNativeCall(fold, runId, name, part);
        continue;
      }
      if (isShellTool(part.tool) && isUlwBookkeepingShellCommand(toolInputCommand(part.state.input))) {
        fold.bookkeepingCallIds.push(part.id);
      }
    }
  }
  return fold;
};

const TOOL_TITLE_MAX = 120;
const ERROR_MAX = 500;
const ARTIFACT_MAX = 20;

const childToolCallTitle = (part: ToolPart): string => {
  const metadata: Metadata | undefined = 'metadata' in part.state ? part.state.metadata : undefined;
  const described = toolDescription(part.tool, part.state.input, metadata);
  if (described === null) return normalizeToolName(part.tool) || 'tool';
  if (described.kind === 'text' || described.kind === 'path') return slice(described.value, TOOL_TITLE_MAX);
  if (described.kind === 'files') return `${String(described.count)} files`;
  if (described.kind === 'questions') return `${String(described.count)} questions`;
  const calls = described.calls.map((call) => `${call.name} ×${String(call.count)}`).join(', ');
  return slice(calls, TOOL_TITLE_MAX) || 'execute';
};

const childArtifactsOf = (part: ToolPart): string[] => {
  if (part.state.status !== 'completed') return [];
  if (!isFileChangeTool(part.tool)) return [];
  const metadata: Metadata | undefined = 'metadata' in part.state ? part.state.metadata : undefined;
  const paths = toolFileDiffs(metadata).map((file) => file.file);
  const direct = toolInputPath(part.state.input);
  return direct === undefined ? paths : [...paths, direct];
};

type NativeChildDetail = {
  toolCalls: DagChildToolCall[];
  artifacts: string[];
  callError: string | null;
};

/**
 * A worker's own tool calls, artifacts, and first failure, oldest first.
 * Orchestration bookkeeping never renders as ordinary rows here: `ulw_*`
 * calls and `ulw-loop` shell argv are skipped, while user-issued shell the
 * worker ran stays visible.
 */
const expandNativeChild = (messages: Message[], parts: Record<string, Part[]>): NativeChildDetail => {
  const toolCalls: DagChildToolCall[] = [];
  const artifacts: string[] = [];
  const seenArtifacts = new Set<string>();
  let callError: string | null = null;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of parts[message.id] ?? []) {
      if (part.type !== 'tool') continue;
      if (isUlwOrchestrationPart(part)) continue;
      const status = part.state.status;
      const error = status === 'error' ? slice(part.state.error, ERROR_MAX) : null;
      if (error !== null && callError === null) callError = error;
      toolCalls.push({
        id: part.id,
        tool: part.tool,
        title: childToolCallTitle(part),
        state: status === 'completed' ? 'completed' : status === 'error' ? 'failed' : status === 'running' ? 'running' : 'pending',
        error,
      });
      for (const file of childArtifactsOf(part)) {
        if (seenArtifacts.has(file)) continue;
        seenArtifacts.add(file);
        if (artifacts.length < ARTIFACT_MAX) artifacts.push(file);
      }
    }
  }
  return { toolCalls, artifacts, callError };
};

const nativeChildReport = (messages: Message[], workerId: string): { state: string; output: string; reportedAt: number; agent?: string } | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const dispatched = readDispatchedSessionResult(message);
    if (dispatched && dispatched.sessionID === workerId) return dispatched;
  }
  const run = findSubagentRun(messages, workerId);
  if (run) return { state: run.state, output: run.output, reportedAt: run.reportedAt, agent: run.agent };
  return null;
};

const isoToMillis = (value: string | null): number | null => {
  if (value === null) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
};

type NativeChildInput = {
  workerId: string;
  goal: NativeRosterGoal;
  receipt: NativeReceipt | null;
  superseded: boolean;
};

const buildNativeChild = (options: {
  input: NativeChildInput;
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  messages: Message[];
  allMessages: Record<string, Message[]>;
  parts: Record<string, Part[]>;
}): DagRunChild => {
  const { workerId, goal, receipt, superseded } = options.input;
  const child = options.sessions.find((session) => session.id === workerId) ?? null;
  const report = nativeChildReport(options.messages, workerId);
  const busy = isBusyStatus(options.statuses, workerId);
  const detail = expandNativeChild(options.allMessages[workerId] ?? [], options.parts);
  const agent = clean(child?.agent) ?? goal.agent ?? report?.agent ?? null;
  const description = clean(goal.prompt) ?? null;
  let state: DagChildState;
  if (receipt && receipt.childSessionId === workerId) {
    state = receipt.status === 'failed' ? 'failed' : 'completed';
  } else if (superseded) {
    // The goal settled on a newer worker; this attempt no longer owns it.
    state = 'cancelled';
  } else if (report) {
    state = reportStateOf(report.state);
  } else if (busy) {
    state = 'running';
  } else if (child?.outcome === 'failed') {
    state = 'failed';
  } else if (child?.outcome === 'interrupted') {
    state = 'cancelled';
  } else if (child) {
    state = 'pending';
  } else {
    // The roster names a worker whose record never loaded: dispatched, but
    // with nothing observable yet. Never invent completion for it.
    state = 'pending';
  }
  const output = report && report.output ? slice(clean(report.output) ?? '', OUTPUT_MAX) || null : null;
  const failureOutput = output !== null && (state === 'failed' || state === 'cancelled') ? output : null;
  return {
    sessionId: workerId,
    label: slice(description ?? clean(child?.title) ?? goal.goalId, LABEL_MAX),
    agent,
    description,
    state,
    startedAt: child?.time?.created ?? 0,
    endedAt: (receipt ? isoToMillis(receipt.recordedAt) : null) ?? report?.reportedAt ?? null,
    output,
    goalId: goal.goalId,
    toolCalls: detail.toolCalls,
    resultRef: receipt?.resultRef ?? null,
    error: receipt?.reason ?? failureOutput ?? detail.callError,
    artifacts: detail.artifacts,
  };
};

/**
 * One compact parent activity card per native run: the run id from the
 * session metadata, the genuine phase and progress from the run record and
 * child receipts, and expanded per-worker details (agent identities, task
 * ids, tool calls, results, artifacts, errors) from the runtime records.
 */
const buildNativeRunModel = (options: {
  parent: Session;
  runId: string;
  conversationId: string;
  conversationTitle?: string | null;
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  messages: Message[];
  parts: Record<string, Part[]>;
  allMessages: Record<string, Message[]>;
}): DagRunModel => {
  const fold = foldNativeEvents(options.runId, options.messages, options.parts);
  const missingGoalIds = fold.goals.filter((goal) => !fold.receipts.has(goal.goalId)).map((goal) => goal.goalId);
  const children = fold.goals.flatMap((goal) => {
    const receipt = fold.receipts.get(goal.goalId) ?? null;
    return goal.workers.map((workerId) => buildNativeChild({
      input: {
        workerId,
        goal,
        receipt,
        superseded: receipt !== null && receipt.childSessionId !== workerId,
      },
      sessions: options.sessions,
      statuses: options.statuses,
      messages: options.messages,
      allMessages: options.allMessages,
      parts: options.parts,
    }));
  });
  const parentBusy = isBusyStatus(options.statuses, options.parent.id);
  const anyLive = children.some((child) => child.state === 'running' || child.state === 'pending');
  const status = fold.status;
  let state: DagParentState;
  if (status === 'failed' || options.parent.outcome === 'failed') state = 'failed';
  else if (status === 'complete' && missingGoalIds.length === 0 && !parentBusy && !anyLive) state = 'completed';
  else state = 'running';
  // A terminal run never leaves zombie `running` nodes: live children are
  // coerced to the run's own outcome (failed work fails, abandoned work
  // cancels), and a failed parent settles its live children the same way.
  if (state === 'failed' || options.parent.outcome === 'interrupted') {
    const terminal: DagChildState = status === 'blocked' ? 'cancelled' : 'failed';
    for (const child of children) {
      if (child.state === 'running' || child.state === 'pending') child.state = terminal;
    }
  }
  const phase: DagRunPhase = status ?? (state === 'completed' ? 'complete' : state === 'failed' ? 'failed' : 'active');
  const userText = firstUserText(options.messages, options.parts);
  const label = clean(options.conversationTitle) ?? fold.brief ?? clean(options.parent.title)
    ?? (userText ? slice(userText, LABEL_MAX) : null) ?? UNTITLED;
  const prompt = userText ? slice(userText, PROMPT_MAX) : (fold.brief ? slice(fold.brief, PROMPT_MAX) : label);
  // Synthesis is a completion summary: it is ready only on a genuinely
  // completed run, never on a failed one, even with every node settled.
  const synthesisReady = state === 'completed';
  const synthesisText = synthesisReady ? lastAssistantText(options.messages, options.parts) : null;
  const counts = { pending: 0, running: 0, completed: 0 };
  for (const child of children) {
    if (child.state === 'pending') counts.pending += 1;
    else if (child.state === 'running') counts.running += 1;
    else if (child.state === 'completed') counts.completed += 1;
  }
  const allTerminal = children.length > 0 && children.every((child) => child.state !== 'running' && child.state !== 'pending');
  const receiptTimes = [...fold.receipts.values()].map((receipt) => isoToMillis(receipt.recordedAt) ?? 0);
  const updatedAt = Math.max(
    options.parent.time?.updated ?? 0,
    ...children.map((child) => child.endedAt ?? child.startedAt),
    ...receiptTimes,
  );
  return {
    version: 1,
    conversationId: options.conversationId,
    parentSessionId: options.parent.id,
    label,
    prompt,
    state,
    startedAt: options.parent.time?.created ?? 0,
    endedAt: state === 'completed' ? (options.parent.time?.updated ?? null) : null,
    children,
    synthesis: synthesisReady && allTerminal && !parentBusy
      ? { state: 'ready', text: synthesisText ? slice(synthesisText, SYNTHESIS_MAX) : null }
      : { state: 'pending', text: null },
    counts,
    updatedAt,
    source: 'native',
    runId: options.runId,
    phase,
    progress: { total: fold.goals.length, settled: fold.goals.length - missingGoalIds.length },
    missingGoalIds,
    bookkeepingToolCallIds: fold.bookkeepingCallIds,
  };
};

/**
 * Parent transcript parts that are orchestration bookkeeping, for timelines
 * that hide them. Used on the delegation path (which otherwise ignores
 * non-subagent tools); the native fold collects the same ids itself.
 */
const bookkeepingIdsOf = (messages: Message[], parts: Record<string, Part[]>): string[] => {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of parts[message.id] ?? []) {
      if (part.type !== 'tool') continue;
      if (isUlwOrchestrationPart(part)) ids.push(part.id);
    }
  }
  return ids;
};

/**
 * Build the run model for one conversation, or `null` when it holds no
 * delegation evidence and no native run id. A busy parent with no named
 * calls, reports, or child records is an ordinary chat turn, not a DAG run.
 * A run session carrying `alcode.ulwRunId` always builds the native card,
 * even before the first dispatch lands.
 */
export const buildDagRunModel = (input: DagRunModelInput): DagRunModel | null => {
  const sessions = input.sessions ?? [];
  const messages = input.messages ?? [];
  const parts = input.parts ?? {};
  const statuses = input.statuses ?? {};
  const parent = sessions.find((session) => session.id === input.conversationId) ?? null;
  if (!parent) return null;
  const nativeRunId = readNativeRunId(parent);
  if (nativeRunId) {
    return buildNativeRunModel({
      parent,
      runId: nativeRunId,
      conversationId: input.conversationId,
      conversationTitle: input.conversationTitle,
      sessions,
      statuses,
      messages,
      parts,
      allMessages: input.allMessages ?? {},
    });
  }
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
    else if (child.outcome === 'failed') state = 'failed';
    else if (child.outcome === 'interrupted') state = 'cancelled';
    else if (finishedCall) state = finishedCall.status === 'error' ? 'failed' : 'completed';
    else if (named) state = 'completed';
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
      goalId: null,
      toolCalls: [],
      resultRef: null,
      error: null,
      artifacts: [],
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
  const settled = children.filter((child) => child.state !== 'running' && child.state !== 'pending').length;
  return {
    version: 1,
    conversationId: input.conversationId,
    parentSessionId: parent.id,
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
    source: 'delegation',
    runId: parent.id,
    phase: state === 'completed' ? 'complete' : state === 'failed' ? 'failed' : 'active',
    progress: { total: children.length, settled },
    missingGoalIds: [],
    bookkeepingToolCallIds: bookkeepingIdsOf(messages, parts),
  };
};

const NATIVE_CHILD_CALL_LINES = 12;

/**
 * Expanded native child details: the real task id, agent identity, tool
 * calls, result, artifacts, and errors the runtime recorded. Sections with
 * no evidence are omitted, so the card never invents detail.
 */
const nativeChildPrompt = (child: DagRunChild): string => {
  const sections: string[] = [`Task ${child.goalId ?? child.sessionId}`];
  if (child.agent) sections.push(`Agent: ${child.agent}`);
  if (child.toolCalls.length > 0) {
    const shown = child.toolCalls.slice(0, NATIVE_CHILD_CALL_LINES);
    const lines = shown.map((call) => {
      const failed = call.error ? ` [failed: ${call.error}]` : '';
      return `- ${call.tool} — ${call.title}${failed}`;
    });
    if (child.toolCalls.length > shown.length) lines.push(`- … +${String(child.toolCalls.length - shown.length)} more`);
    sections.push(`Calls (${String(child.toolCalls.length)}):\n${lines.join('\n')}`);
  }
  if (child.output) sections.push(`Result:\n${child.output}`);
  if (child.artifacts.length > 0) sections.push(`Artifacts:\n${child.artifacts.map((file) => `- ${file}`).join('\n')}`);
  if (child.error) sections.push(`Error:\n${child.error}`);
  if (child.resultRef) sections.push(`Result ref: ${child.resultRef}`);
  return sections.join('\n\n');
};

const nativeParentPrompt = (model: DagRunModel): string => {
  const lines = [`Progress: ${String(model.progress.settled)}/${String(model.progress.total)} goals settled`];
  if (model.missingGoalIds.length > 0) {
    const shown = model.missingGoalIds.slice(0, 10);
    const more = model.missingGoalIds.length > shown.length ? `, … +${String(model.missingGoalIds.length - shown.length)} more` : '';
    lines.push(`Missing: ${shown.join(', ')}${more}`);
  }
  return `${model.prompt}\n\n${lines.join('\n')}`;
};

/** A snapshot document carrying the run model, shaped for parseSnapshotDoc. */
export const dagRunModelToSnapshotDoc = (model: DagRunModel): JsonValue => {
  // Native nodes carry the runtime's own ids: the parent is the run
  // session, each child the dispatched worker session. Delegation keeps the
  // synthetic `parent` id the existing pane fixtures pin.
  const parentNodeId = model.source === 'native' ? model.parentSessionId : 'parent';
  const parentNode = {
    id: parentNodeId,
    label: model.label,
    state: model.phase === 'blocked' ? 'blocked' : model.state === 'completed' ? 'completed' : model.state === 'failed' ? 'failed' : 'running',
    attempt: 1,
    prompt: model.source === 'native' ? nativeParentPrompt(model) : model.prompt,
    depends_on: [],
    started_at: new Date(model.startedAt).toISOString(),
    completed_at: model.endedAt === null ? null : new Date(model.endedAt).toISOString(),
  };
  const childNodes = model.children.map((child) => ({
    id: child.sessionId,
    label: child.agent ? `${child.agent} — ${child.label}` : child.label,
    state: child.state,
    attempt: 1,
    prompt: model.source === 'native' && child.goalId !== null
      ? nativeChildPrompt(child)
      : child.output
        ? `${child.description ?? child.label}\n\nResult:\n${child.output}`
        : (child.description ?? child.label),
    depends_on: [parentNodeId],
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
        run_id: model.runId,
        run_key: model.source === 'native' ? `ulw:${model.runId}` : `chat:${model.parentSessionId}`,
        name: model.label,
        status: model.state,
        // The genuine lifecycle phase rides along for panes that render
        // it; the wire parser ignores unknown run keys.
        phase: model.phase,
        counts: model.counts,
        nodes: [parentNode, ...childNodes, synthesisNode],
        edges: [
          ...model.children.map((child) => ({ from: parentNodeId, to: child.sessionId })),
          ...model.children.map((child) => ({ from: child.sessionId, to: 'synthesis' })),
        ],
        waves: [
          { index: 0, node_ids: [parentNodeId] },
          { index: 1, node_ids: model.children.map((child) => child.sessionId) },
          { index: 2, node_ids: ['synthesis'] },
        ],
      }],
    },
    tasks: null,
  };
};
