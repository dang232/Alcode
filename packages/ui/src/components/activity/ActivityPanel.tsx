import React from 'react';

import { useI18n } from '@/lib/i18n';
import { useDirectorySync } from '@/sync/sync-context';
import type { Message, Part } from '@/lib/opencode/model';
import { useDagRunModel } from '@/lib/useDagRunModel';
import { fetchRunSnapshot, RunSnapshotMissingError } from '@/lib/runGraphApi';
import type { SnapshotDoc } from '@/components/activity/snapshotDoc';
import { engineSnapshotToView } from './engineSnapshotModel';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  buildActivityTree,
  buildExplanationCard,
  buildInspectorSummaries,
  buildInspectorTimeline,
  buildRunGraph,
  taskAssociatedFiles,
} from './activityModel';
import { RunGraphView } from './RunGraph';
import { TaskExplorer } from './TaskExplorer';
import { TaskInspector } from './TaskInspector';

type Props = {
  directory: string | null | undefined;
  conversationId: string | null | undefined;
  conversationTitle?: string | null | undefined;
};

type View = 'run' | 'code';

// Stable identities for missing slices. A fresh `[]` or `{}` here returns a
// new snapshot on every store read, and useSyncExternalStore treats each
// new identity as a change: the panel re-renders forever (React #185) on
// any conversation without messages yet. These constants keep the empty
// case referentially stable.
const EMPTY_CONVERSATION_MESSAGES: Message[] = [];
const EMPTY_PARTS: Record<string, Part[]> = {};

/**
 * Live activity workspace for one conversation. The run model comes from the
 * sync store (live, no polling); the inspector reads the same store slices.
 * With no delegation evidence the panel says so instead of drawing a graph.
 */
export const ActivityPanel: React.FC<Props> = ({ directory, conversationId, conversationTitle }) => {
  const { t } = useI18n();
  const [view, setView] = React.useState<View>('run');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const model = useDagRunModel(conversationId ?? null, conversationTitle, directory || undefined);
  const [snapshotDoc, setSnapshotDoc] = React.useState<SnapshotDoc | null | undefined>(undefined);
  const [snapshotAttempt, setSnapshotAttempt] = React.useState(0);
  const [snapshotFailed, setSnapshotFailed] = React.useState(false);
  React.useEffect(() => {
    setSnapshotDoc(undefined);
    setSnapshotFailed(false);
    if (!directory || !conversationId) {
      setSnapshotDoc(null);
      return;
    }
    const controller = new AbortController();
    fetchRunSnapshot(directory, conversationId, { signal: controller.signal })
      .then((doc) => { if (!controller.signal.aborted) setSnapshotDoc(doc); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSnapshotDoc(null);
        // A missing snapshot is not a failure: chat-path runs often persist
        // nothing, so the workspace falls through to the live model and, with
        // no live rows either, to the explicit no-run state.
        if (!(error instanceof RunSnapshotMissingError)) setSnapshotFailed(true);
      });
    return () => controller.abort();
  }, [directory, conversationId, snapshotAttempt]);
  const engineView = React.useMemo(
    () => (snapshotDoc === undefined || snapshotDoc === null || !conversationId
      ? null
      : engineSnapshotToView({ doc: snapshotDoc, conversationId })),
    [snapshotDoc, conversationId],
  );
  const messages = useDirectorySync(
    React.useCallback(
      (state: { message?: Record<string, Message[]> }) =>
        (conversationId && state.message?.[conversationId]) || EMPTY_CONVERSATION_MESSAGES,
      [conversationId],
    ),
    directory || undefined,
  );
  const parts = useDirectorySync(
    React.useCallback(
      (state: { part?: Record<string, Part[]> }) => state.part ?? EMPTY_PARTS,
      [],
    ),
    directory || undefined,
  );
  // The selected task's own transcript lives under its session id, not the
  // parent conversation's: without this the file links only ever see parent
  // messages. Falls back to the shared empty constant, never a literal.
  const selectedMessages = useDirectorySync(
    React.useCallback(
      (state: { message?: Record<string, Message[]> }) =>
        (selectedId && selectedId !== conversationId && state.message?.[selectedId]) || EMPTY_CONVERSATION_MESSAGES,
      [selectedId, conversationId],
    ),
    directory || undefined,
  );

  React.useEffect(() => {
    setSelectedId(null);
  }, [conversationId]);
  const openFileInCode = React.useCallback((file: string) => {
    // One surface owns the graph: this view hands the file to the dockable
    // Code Graph tab instead of mounting a second graph inside the panel.
    if (!directory) {
      return;
    }
    useUIStore.getState().openCodeGraphAt(directory, file);
  }, [directory]);

  const rows = React.useMemo(
    () => engineView?.rows ?? buildActivityTree(model),
    [engineView, model],
  );
  const graph = React.useMemo(
    () => engineView?.graph ?? buildRunGraph(model),
    [engineView, model],
  );
  const selectedLabel = rows.find((row) => row.id === selectedId)?.label ?? null;
  // Freshness comes from the store, not the fetch: a 'persisted' session list
  // was restored from cache and has not been confirmed live yet.
  const storeBootstrapping = useDirectorySync((state) => state.status === 'loading', directory || undefined);
  const storeStale = useDirectorySync((state) => state.sessionListSource === 'persisted', directory || undefined);
  const timeline = React.useMemo(
    () => (model && selectedId ? buildInspectorTimeline({ model, messages, parts, selectedId }) : []),
    [model, messages, parts, selectedId],
  );
  const summaries = React.useMemo(
    () => (model && selectedId ? buildInspectorSummaries({ model, messages, parts, selectedId }) : []),
    [model, messages, parts, selectedId],
  );
  const files = React.useMemo(() => {
    if (!model || !selectedId) return [];
    const scope = selectedMessages.length > 0 ? [...messages, ...selectedMessages] : messages;
    return taskAssociatedFiles(scope, parts, selectedId);
  }, [model, messages, parts, selectedId, selectedMessages]);
  const card = React.useMemo(
    () => (model && selectedId ? buildExplanationCard({ model, messages, parts, selectedId }) : null),
    [model, messages, parts, selectedId],
  );

  if (!conversationId) {
    return <p className="typography-ui p-3 text-[var(--text-tertiary)]">{t('activity.state.noSession')}</p>;
  }
  const snapshotLoading = snapshotDoc === undefined && !snapshotFailed;
  if (rows.length === 0) {
    if (storeBootstrapping || snapshotLoading) {
      return (
        <div className="flex h-full items-center justify-center gap-2 p-3 text-[var(--text-tertiary)]">
          <Spinner aria-label={t('common.loading')} />
          <span className="typography-ui">{t('common.loading')}</span>
        </div>
      );
    }
    if (snapshotFailed) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
          <p className="typography-ui text-[var(--text-secondary)]">{t('activity.state.snapshotError')}</p>
          <Button variant="outline" size="sm" onClick={() => setSnapshotAttempt((attempt) => attempt + 1)}>
            {t('contextPanel.preview.actions.retry')}
          </Button>
        </div>
      );
    }
    return <p className="typography-ui p-3 text-[var(--text-tertiary)]">{t('activity.state.noRun')}</p>;
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex items-center gap-1" role="tablist" aria-label={t('activity.view.label')}>
        {(['run', 'code'] as const).map((entry) => (
          <Button
            key={entry}
            variant={view === entry ? 'secondary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={view === entry}
            onClick={() => setView(entry)}
          >
            {t(`activity.view.${entry}`)}
          </Button>
        ))}
        <span className="typography-micro ms-auto text-[var(--text-tertiary)]">
          {storeStale ? t('activity.source.stale') : engineView ? t('activity.source.snapshot') : t('activity.source.live')}
        </span>
      </div>
      {view === 'code' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-2" data-testid="activity-code-bridge">
          {files.map((file) => (
            <button
              key={file}
              type="button"
              onClick={() => openFileInCode(file)}
              className="typography-micro w-full break-words text-start text-[var(--text-secondary)] hover:underline"
            >
              {file}
            </button>
          ))}
        </div>
      ) : (
        <div className={cn('grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2')}>
          <section aria-label={t('activity.dag.label')} className="min-h-0">
            {graph && <RunGraphView graph={graph} selectedId={selectedId} onSelect={setSelectedId} />}
          </section>
          <section aria-label={t('activity.explorer.label')} className="overflow-auto border-t border-[var(--surface-border)] pt-2">
            <TaskExplorer rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
          </section>
          <section aria-label={t('activity.inspector.label')} className="overflow-auto border-t border-[var(--surface-border)] pt-2">
            <TaskInspector selectedLabel={selectedLabel} events={timeline} summaries={summaries} files={files} onOpenFile={openFileInCode} card={card} />
          </section>
        </div>
      )}
    </div>
  );
};
