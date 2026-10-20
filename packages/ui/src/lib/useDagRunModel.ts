import React from 'react';

import type { JsonValue } from '@openchamber/sdk';
import { buildDagRunModel, dagRunModelToSnapshotDoc, type DagRunModel } from '@/lib/dagRunModel';
import { useDirectorySync } from '@/sync/sync-context';
import type { State } from '@/sync/types';

const sameModel = (left: DagRunModel | null, right: DagRunModel | null): boolean => {
  if (left === null || right === null) return left === right;
  return left.updatedAt === right.updatedAt
    && left.state === right.state
    && left.label === right.label
    && left.source === right.source
    && left.runId === right.runId
    && left.phase === right.phase
    && left.progress.total === right.progress.total
    && left.progress.settled === right.progress.settled
    && left.missingGoalIds.join(',') === right.missingGoalIds.join(',')
    && left.bookkeepingToolCallIds.length === right.bookkeepingToolCallIds.length
    && left.children.length === right.children.length
    && left.children.every((child, index) => {
      const other = right.children[index];
      return other !== undefined
        && child.sessionId === other.sessionId
        && child.state === other.state
        && child.label === other.label
        && child.goalId === other.goalId
        && child.output === other.output
        && child.error === other.error
        && child.resultRef === other.resultRef
        && child.toolCalls.length === other.toolCalls.length
        && child.artifacts.join(',') === other.artifacts.join(',');
    })
    && left.synthesis.state === right.synthesis.state
    && left.synthesis.text === right.synthesis.text;
};

/**
 * The active conversation's DAG run model, stable across unrelated store
 * updates. `null` when the conversation holds no delegation evidence and
 * no native run id. Native workers contribute their own messages, so the
 * full message index travels alongside the parent slices.
 */
export const useDagRunModel = (
  conversationId: string | null,
  conversationTitle: string | null | undefined,
  directory?: string,
): DagRunModel | null => {
  const selector = React.useMemo(() => {
    let previous: DagRunModel | null = null;
    return (state: State): DagRunModel | null => {
      if (!conversationId) return previous;
      // A selector must never throw on partial store scopes (bootstrap,
      // directory switches): missing slices read as empty, never crash.
      const messages = (state.message ?? {})[conversationId] ?? [];
      const next = buildDagRunModel({
        conversationId,
        conversationTitle,
        sessions: state.session ?? [],
        statuses: state.session_status ?? {},
        messages,
        parts: state.part ?? {},
        allMessages: state.message ?? {},
      });
      if (sameModel(previous, next)) return previous;
      previous = next;
      return next;
    };
  }, [conversationId, conversationTitle]);
  return useDirectorySync(selector, directory);
};

/** The run model as a panel-parseable snapshot document, or null. */
export const useDagRunSnapshotDoc = (
  conversationId: string | null,
  conversationTitle: string | null | undefined,
  directory?: string,
): { conversationId: string; snapshot: JsonValue | null } | null => {
  const model = useDagRunModel(conversationId, conversationTitle, directory);
  return React.useMemo(() => {
    if (!conversationId) return null;
    if (!model) return { conversationId, snapshot: null };
    return { conversationId, snapshot: dagRunModelToSnapshotDoc(model) };
  }, [conversationId, model]);
};
