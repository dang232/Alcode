import type { Metadata, Session } from '@/lib/opencode/model';

export type SessionMetadataRecord = Metadata;

type AlcodeMetadata = {
  kind?: 'review';
  originalSessionID?: string;
  reviewSessionID?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const getSessionMetadata = (session: Session | null | undefined): SessionMetadataRecord => (
  session?.metadata ?? {}
);

const getAlcodeMetadata = (metadata: SessionMetadataRecord): AlcodeMetadata => {
  const value = metadata.alcode;
  return isRecord(value) ? value as AlcodeMetadata : {};
};

export const getReviewSessionID = (session: Session | null | undefined): string | null => {
  const value = getAlcodeMetadata(getSessionMetadata(session)).reviewSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const getOriginalSessionID = (session: Session | null | undefined): string | null => {
  const value = getAlcodeMetadata(getSessionMetadata(session)).originalSessionID;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

export const isReviewSession = (session: Session | null | undefined): boolean =>
  getAlcodeMetadata(getSessionMetadata(session)).kind === 'review' && Boolean(getOriginalSessionID(session));

export const withReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getAlcodeMetadata(metadata);
  return {
    ...metadata,
    alcode: {
      ...current,
      reviewSessionID,
    },
  };
};

export const withReviewSessionMarker = (
  metadata: SessionMetadataRecord,
  originalSessionID: string,
): SessionMetadataRecord => {
  const current = getAlcodeMetadata(metadata);
  return {
    ...metadata,
    alcode: {
      ...current,
      kind: 'review' as const,
      originalSessionID,
    },
  };
};

export const withoutReviewSessionLink = (
  metadata: SessionMetadataRecord,
  reviewSessionID: string,
): SessionMetadataRecord => {
  const current = getAlcodeMetadata(metadata);
  if (current.reviewSessionID !== reviewSessionID) return metadata;

  const restAlcode = { ...current };
  delete restAlcode.reviewSessionID;
  const next: SessionMetadataRecord = { ...metadata };
  if (Object.keys(restAlcode).length > 0) {
    next.alcode = restAlcode;
  } else {
    delete next.alcode;
  }
  return next;
};
