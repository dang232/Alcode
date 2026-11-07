import { z } from 'zod';

import type { JsonValue } from '@alcode/sdk';

import { runtimeFetch } from './runtime-fetch';
import { parseSnapshotDoc, type SnapshotDoc } from '@/components/activity/snapshotDoc';

const errorSchema = z.object({ error: z.string().min(1) });
const directorySchema = z.string().trim().min(1);

/**
 * Repair lifecycle vocabulary. Deliberately disjoint from VerificationStatus:
 * a repair state says what the attempt did, never what the gate decided.
 */
export const REPAIR_STATES = [
  'diagnosing',
  'repair_planned',
  'repairing',
  'reverifying',
  'repaired',
  'repair_failed',
  'repair_cancelled',
] as const;

export type RepairState = (typeof REPAIR_STATES)[number];

/**
 * One repair attempt as the run/tasks API projects it from durable state.
 *
 * `verificationStatus` is read only from the persisted completion gate record
 * (`verification_status` on the task record); it is never inferred from
 * `state`. `hostFacts` / `modelHypotheses` stay empty when the durable attempt
 * record does not carry them - callers must not read an empty array as proof
 * that no fact existed.
 */
export type RepairBlock = {
  attemptId: string;
  taskId: string;
  epoch: number;
  state: RepairState;
  failedChecks: string[];
  rerunChecks: string[];
  changedFiles: string[];
  verificationStatus: 'verified' | 'unverified' | 'blocked' | null;
  hostFacts: string[];
  modelHypotheses: string[];
  updatedAt: number;
};

/** `repair` when a current-epoch attempt exists; `repairError` when the store could not be read. */
export type RepairEntry = { repair?: RepairBlock; repairError?: string };

export type SnapshotRepairIndex = {
  runs: Record<string, RepairEntry>;
  tasks: Record<string, RepairEntry>;
};

const repairBlockSchema = z.object({
  attemptId: z.string().min(1),
  taskId: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  state: z.enum(REPAIR_STATES),
  failedChecks: z.array(z.string()),
  rerunChecks: z.array(z.string()),
  changedFiles: z.array(z.string()),
  verificationStatus: z.enum(['verified', 'unverified', 'blocked']).nullable(),
  hostFacts: z.array(z.string()),
  modelHypotheses: z.array(z.string()),
  updatedAt: z.number().finite(),
});

type WireRecord = { [key: string]: JsonValue };

const isWireRecord = (value: JsonValue | undefined): value is WireRecord =>
  Object(value) === value && !Array.isArray(value);

const wireString = (value: JsonValue | undefined): string | null => {
  // SAFETY: only a string primitive stringifies to itself under `===`; every
  // other JSON value stringifies to something unequal, so the cast is exact.
  return String(value) === value ? (value as string) : null;
};

const indexRepairEntries = (
  raw: JsonValue,
  rootKey: 'dag' | 'tasks',
  listKey: 'runs' | 'tasks',
  idKey: 'run_id' | 'task_id',
): SnapshotRepairIndex['runs'] => {
  const index: SnapshotRepairIndex['runs'] = {};
  if (!isWireRecord(raw)) return index;
  const container = raw[rootKey];
  if (!isWireRecord(container)) return index;
  const entries = container[listKey];
  if (!Array.isArray(entries)) return index;
  for (const entry of entries) {
    if (!isWireRecord(entry)) continue;
    const id = wireString(entry[idKey]);
    if (id === null || id.length === 0) continue;
    if (entry.repair === undefined) {
      const error = wireString(entry.repairError);
      if (error !== null && error.length > 0) index[id] = { repairError: error };
      continue;
    }
    const parsedRepair = repairBlockSchema.safeParse(entry.repair);
    // A malformed block is a read error, not "no repair": the caller must be
    // able to say the state exists but is unreadable.
    index[id] = parsedRepair.success
      ? { repair: parsedRepair.data }
      : { repairError: `repair state payload is malformed for ${id}` };
  }
  return index;
};

/**
 * Repair state keyed by the run/task id it belongs to. The server omits the
 * field entirely when an attempt is absent or fenced as stale, so a missing
 * key means "no current repair" and a `repairError` key means "unknown".
 */
export const parseSnapshotRepairIndex = (raw: JsonValue): SnapshotRepairIndex => ({
  runs: indexRepairEntries(raw, 'dag', 'runs', 'run_id'),
  tasks: indexRepairEntries(raw, 'tasks', 'tasks', 'task_id'),
});

/**
 * A 404 from the run-graph route: this conversation has no persisted
 * snapshot. Absence is a normal state (chat-path runs are often never
 * persisted), not a failure, so callers must route it to the no-run
 * fallback instead of the error card.
 */
export class RunSnapshotMissingError extends Error {
  readonly directory: string;
  readonly conversationId: string;
  constructor(directory: string, conversationId: string) {
    super(`No persisted run snapshot for conversation ${conversationId}`);
    this.name = 'RunSnapshotMissingError';
    this.directory = directory;
    this.conversationId = conversationId;
  }
}

/**
 * Read-only client for the persisted engine run snapshot.
 *
 * A missing snapshot answers 404 and a malformed one throws: both stay
 * "unknown" to the caller, never an empty run, so the panel falls back to
 * the live chat-path model instead of rendering nothing.
 */
export const fetchRunSnapshot = async (
  directory: string | null | undefined,
  conversationId: string,
  options: { signal?: AbortSignal } = {},
): Promise<SnapshotDoc & { repairIndex: SnapshotRepairIndex }> => {
  const dir = directorySchema.safeParse(directory);
  if (!dir.success) {
    throw new Error('Run snapshot needs a project directory');
  }
  const trimmed = dir.data;
  const response = await runtimeFetch('/api/run-graph/snapshot', {
    query: { directory: trimmed, conversationId },
    directory: trimmed,
    cache: 'no-store',
    signal: options.signal,
  });
  if (response.status === 404) {
    throw new RunSnapshotMissingError(trimmed, conversationId);
  }
  if (!response.ok) {
    const parsedError = errorSchema.safeParse(await response.json());
    throw new Error(
      parsedError.success ? parsedError.data.error : `Failed to load run snapshot (${response.status})`,
    );
  }
  const payload: JsonValue = await response.json();
  const parsed = parseSnapshotDoc(payload);
  if (!parsed) {
    throw new Error('Run snapshot is malformed');
  }
  return { ...parsed, repairIndex: parseSnapshotRepairIndex(payload) };
};
