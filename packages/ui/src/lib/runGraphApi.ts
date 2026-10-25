import { z } from 'zod';

import type { JsonValue } from '@alcode/sdk';

import { runtimeFetch } from './runtime-fetch';
import { parseSnapshotDoc, type SnapshotDoc } from '@/components/activity/snapshotDoc';

const errorSchema = z.object({ error: z.string().min(1) });
const directorySchema = z.string().trim().min(1);

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
): Promise<SnapshotDoc> => {
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
  return parsed;
};
