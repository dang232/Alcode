import React from 'react';
import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs';

import { useI18n } from '@/lib/i18n';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { useGitStore } from '@/stores/useGitStore';
import { getLanguageFromExtension } from '@/lib/toolHelpers';
import { PierreDiffViewer } from '@/components/views/PierreDiffViewer';
import { changedFilesForTask, type StatusFile } from './taskChangesModel';

type Props = {
  directory: string | null | undefined;
  files: string[];
  onOpenFile: (file: string) => void;
};

const statusLetter = (entry: StatusFile): string => {
  const working = entry.working_dir?.trim();
  const staged = entry.index?.trim();
  if (working === '?') return '?';
  if (working && working !== ' ') return working;
  if (staged && staged !== ' ') return staged;
  return 'M';
};

const diffFor = (
  path: string,
  cached: { original: string; modified: string; isBinary?: boolean } | null,
): FileDiffMetadata | null => {
  if (!cached || cached.isBinary || cached.original === cached.modified) return null;
  try {
    return parseDiffFromFile({ name: path, contents: cached.original }, { name: path, contents: cached.modified });
  } catch {
    return null;
  }
};

/** The selected task's changed files, each with its inline diff; nothing at all when it changed none. */
export const TaskChanges: React.FC<Props> = ({ directory, files, onOpenFile }) => {
  const { t } = useI18n();
  const git = getRegisteredRuntimeAPIs()?.git ?? null;
  const status = useGitStore((state) => (directory ? state.directories.get(directory)?.status ?? null : null));
  const prefetchDiffs = useGitStore((state) => state.prefetchDiffs);
  const getDiff = useGitStore((state) => state.getDiff);

  const changed = React.useMemo(() => changedFilesForTask(files, status?.files ?? []), [files, status]);
  const changedKey = changed.map((entry) => `${entry.path}:${entry.index}:${entry.working_dir}`).join('|');
  const [diffs, setDiffs] = React.useState<Record<string, FileDiffMetadata | null>>({});

  const paths = React.useMemo(() => changed.map((entry) => entry.path), [changed]);

  React.useEffect(() => {
    if (!directory || !git || paths.length === 0) {
      setDiffs({});
      return;
    }
    let cancelled = false;
    void prefetchDiffs(directory, git, paths).then(() => {
      if (cancelled) return;
      const next: Record<string, FileDiffMetadata | null> = {};
      for (const path of paths) {
        next[path] = diffFor(path, getDiff(directory, path));
      }
      setDiffs(next);
    });
    return () => { cancelled = true; };
  }, [directory, git, prefetchDiffs, getDiff, paths, changedKey]);

  if (changed.length === 0) return null;

  return (
    <section aria-label={t('activity.changes.label')} className="border-t border-[var(--surface-border)] pt-2">
      <h3 className="typography-micro m-0 text-[var(--text-tertiary)]">
        {t('activity.changes.label')} ({changed.length})
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {changed.map((entry) => {
          const diff = diffs[entry.path] ?? null;
          return (
            <li key={entry.path}>
              <details className="group">
                <summary className="flex cursor-pointer items-center gap-2 py-1">
                  <span className="typography-micro w-3 shrink-0 text-[var(--text-tertiary)]">{statusLetter(entry)}</span>
                  <button
                    type="button"
                    onClick={(event) => { event.preventDefault(); onOpenFile(entry.path); }}
                    className="typography-micro min-w-0 flex-1 break-all text-start text-[var(--text-secondary)] hover:underline"
                  >
                    {entry.path}
                  </button>
                </summary>
                {diff ? (
                  <PierreDiffViewer
                    original=""
                    modified=""
                    fileDiff={diff}
                    language={getLanguageFromExtension(entry.path) || ''}
                    fileName={entry.path}
                    renderSideBySide={false}
                    wrapLines
                    layout="inline"
                  />
                ) : (
                  <p className="typography-micro m-0 py-1 text-[var(--text-tertiary)]">{t('activity.changes.unavailable')}</p>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
