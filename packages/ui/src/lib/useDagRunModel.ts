import React from 'react';

import type { JsonValue } from '@alcode/sdk';
import {
  buildDagRunModel,
  dagRunModelToSnapshotDoc,
  type DagAttributionIndex,
  type DagParentState,
  type DagRunModel,
} from '@/lib/dagRunModel';
import { fetchDagAttributionIndex } from '@/lib/runGraphApi';
import { useDirectorySync } from '@/sync/sync-context';
import type { State } from '@/sync/types';

const sameModel = (left: DagRunModel | null, right: DagRunModel | null): boolean => {
  if (left === null || right === null) return left === right;
  return left.updatedAt === right.updatedAt
    && left.state === right.state
    && left.label === right.label
    && left.children.length === right.children.length
    && left.children.every((child, index) => {
      const other = right.children[index];
      return other !== undefined
        && child.sessionId === other.sessionId
        && child.state === other.state
        && child.label === other.label;
    })
    && left.synthesis.state === right.synthesis.state
    && left.synthesis.text === right.synthesis.text;
};

/**
 * The active conversation's DAG run model, stable across unrelated store
 * updates. `null` when the conversation holds no delegation evidence.
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
      });
      if (sameModel(previous, next)) return previous;
      previous = next;
      return next;
    };
  }, [conversationId, conversationTitle]);
  return useDirectorySync(selector, directory);
};

const isTerminalRunState = (state: DagParentState | null | undefined): boolean =>
  state === 'completed' || state === 'failed' || state === 'cancelled';

/**
 * The project's attribution index for the current conversation, or null when
 * it is unknown.
 *
 * The index is a read of the engine's task records, not UI state: a failed or
 * absent read leaves the producer's attribution fields out instead of blocking
 * the panel or guessing. A conversation switch invalidates the reading, so the
 * in-flight request is aborted and its late result ignored.
 *
 * `runState` is the state of the run the panel is showing. The engine writes a
 * child's task record only after that child ran, so a reading taken while the
 * run is live cannot name it; a terminal transition therefore refreshes the
 * index once. The refresh is an edge, not a poll: re-renders, later live
 * updates, and a run that stays live issue no extra request.
 */
export const useDagAttributionIndex = (
  conversationId: string | null,
  directory?: string,
  runState?: DagParentState | null,
): DagAttributionIndex | null => {
  const [attribution, setAttribution] = React.useState<DagAttributionIndex | null>(null);
  const [terminalEpoch, setTerminalEpoch] = React.useState(0);
  const terminal = isTerminalRunState(runState);
  const scopeRef = React.useRef<{ key: string; terminal: boolean } | null>(null);

  // A terminal transition is the only thing that refreshes an unchanged scope.
  // A scope change starts a fresh reading through the request effect below and
  // must not also count as a transition.
  React.useEffect(() => {
    const key = `${conversationId ?? ''}\u0000${directory ?? ''}`;
    const previous = scopeRef.current;
    scopeRef.current = { key, terminal };
    if (previous === null || previous.key !== key) {
      setAttribution(null);
      return;
    }
    if (terminal && !previous.terminal) setTerminalEpoch((epoch) => epoch + 1);
  }, [conversationId, directory, terminal]);

  React.useEffect(() => {
    if (!conversationId || !directory) return;
    const controller = new AbortController();
    let live = true;
    void fetchDagAttributionIndex(directory, { signal: controller.signal }).then((outcome) => {
      if (!live || outcome.kind !== 'index') return;
      setAttribution(outcome.index);
    });
    return () => {
      live = false;
      controller.abort();
    };
  }, [conversationId, directory, terminalEpoch]);

  return attribution;
};

/** The run model as a panel-parseable snapshot document, or null. */
export const useDagRunSnapshotDoc = (
  conversationId: string | null,
  conversationTitle: string | null | undefined,
  directory?: string,
): { conversationId: string; snapshot: JsonValue | null } | null => {
  const model = useDagRunModel(conversationId, conversationTitle, directory);
  const attribution = useDagAttributionIndex(conversationId, directory, model?.state);
  return React.useMemo(() => {
    if (!conversationId) return null;
    if (!model) return { conversationId, snapshot: null };
    return { conversationId, snapshot: dagRunModelToSnapshotDoc(model, attribution) };
  }, [conversationId, model, attribution]);
};
