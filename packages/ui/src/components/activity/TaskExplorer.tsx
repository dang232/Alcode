import React from 'react';

import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { ActivityTreeRow } from './activityModel';

const rowIcon = (row: ActivityTreeRow): IconName | null => {
  if (row.kind === 'session') return null;
  switch (row.state) {
    case 'completed': return 'check';
    case 'failed': return 'close-circle';
    case 'blocked': return 'error-warning';
    case 'cancelled': return 'close';
    default: return null;
  }
};

type Props = {
  rows: ActivityTreeRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Session execution tree. Session first, delegated tasks next, synthesis
 * last; progress counts settled tasks only. Selecting a row drives both the
 * run graph highlight and the inspector.
 */
export const TaskExplorer: React.FC<Props> = ({ rows, selectedId, onSelect }) => {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-0.5" aria-label={t('activity.explorer.label')}>
      {rows.map((row) => {
        const icon = rowIcon(row);
        const selected = row.id === selectedId;
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onSelect(row.id)}
              aria-current={selected}
              className={cn(
                'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start',
                row.kind === 'task' && 'ms-3 w-[calc(100%-0.75rem)]',
                selected
                  ? 'bg-[var(--interactive-selection-background)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--interactive-hover)]',
              )}
            >
              {row.state === 'running' && (
                <span className="mt-1.5 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--status-info)]" aria-hidden="true" />
              )}
              {icon && <Icon name={icon} className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="typography-ui block truncate font-medium">{row.label}</span>
                <span className="typography-micro block truncate opacity-80">
                  {row.agent ? `${row.agent} · ` : ''}
                  {t(`activity.graph.state.${row.state}`)}
                  {row.progress ? ` · ${row.progress.settled}/${row.progress.total}` : ''}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};
