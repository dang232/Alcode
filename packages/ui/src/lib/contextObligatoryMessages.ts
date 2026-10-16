import type { Session } from '@/lib/opencode/model';

import { getSessionMetadata, type SessionMetadataRecord } from './sessionReviewMetadata';

export type ContextObligatoryMessage = {
  id: string;
  createdAt: number;
  role: 'user' | 'assistant';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

// Pins are stored in the order they were pinned; they read in conversation
// order, the way the compaction re-injection already sends them.
export const getContextObligatoryMessages = (
  session: Session | null | undefined,
): ContextObligatoryMessage[] => {
  const alcode = getSessionMetadata(session).alcode;
  if (!isRecord(alcode) || !Array.isArray(alcode.context_obligatory_messages)) return [];

  return alcode.context_obligatory_messages
    .filter((value): value is ContextObligatoryMessage =>
      isRecord(value)
      && typeof value.id === 'string'
      && typeof value.createdAt === 'number'
      && Number.isFinite(value.createdAt)
      && (value.role === 'user' || value.role === 'assistant'))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

export const withContextObligatoryMessage = (
  metadata: SessionMetadataRecord,
  message: ContextObligatoryMessage,
  pinned: boolean,
): SessionMetadataRecord => {
  const alcode = isRecord(metadata.alcode) ? metadata.alcode : {};
  const current = Array.isArray(alcode.context_obligatory_messages)
    ? alcode.context_obligatory_messages.filter((value): value is ContextObligatoryMessage =>
      isRecord(value) && typeof value.id === 'string')
    : [];
  const withoutMessage = current.filter((value) => value.id !== message.id);
  const nextMessages = pinned ? [...withoutMessage, message] : withoutMessage;

  return {
    ...metadata,
    alcode: {
      ...alcode,
      context_obligatory_messages: nextMessages,
    },
  };
};
