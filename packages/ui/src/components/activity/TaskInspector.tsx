import React from 'react';

import { useI18n } from '@/lib/i18n';
import type { ExplanationCard, InspectorEvent, InspectorSummary } from './activityModel';

const formatTime = (at: number | null): string => {
  if (at === null || !Number.isFinite(at)) return '';
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return '';
  }
};

type Props = {
  selectedLabel: string | null;
  events: InspectorEvent[];
  summaries: InspectorSummary[];
  files: string[];
  onOpenFile: (file: string) => void;
  card: ExplanationCard | null;
};

const NEXT_KEY = {
  settled: 'activity.inspector.next.settled',
  running: 'activity.inspector.next.running',
  failed: 'activity.inspector.next.failed',
  cancelled: 'activity.inspector.next.cancelled',
  pending: 'activity.inspector.next.pending',
} as const;

/**
 * Timeline plus model-worded summaries for the selected row. Events render
 * with their timestamp and source receipt id; summaries are split from tool
 * logs so the model's own words never mix with verification evidence.
 */
export const TaskInspector: React.FC<Props> = ({ selectedLabel, events, summaries, files, onOpenFile, card }) => {
  const { t } = useI18n();
  if (!selectedLabel) {
    return <p className="typography-ui text-[var(--text-tertiary)]">{t('activity.inspector.hint')}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {card && (
        <section aria-label={t('activity.inspector.explanation')}>
          <h3 className="typography-micro mb-1 font-medium uppercase text-[var(--text-tertiary)]">
            {t('activity.inspector.explanation')}
          </h3>
          <dl className="flex flex-col gap-2">
            {card.objective && (
              <div>
                <dt className="typography-micro text-[var(--text-tertiary)]">{t('activity.inspector.objective')}</dt>
                <dd className="typography-ui break-words">{card.objective.text}</dd>
              </div>
            )}
            {card.outcome && (
              <div>
                <dt className="typography-micro text-[var(--text-tertiary)]">{t('activity.inspector.outcome')}</dt>
                <dd className="typography-ui break-words">
                  {card.outcome.text}
                  {card.outcome.receiptId && (
                    <span className="typography-micro ms-2 text-[var(--text-tertiary)]">
                      <span className="oc-surface-code rounded px-1">{card.outcome.receiptId}</span>
                    </span>
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt className="typography-micro text-[var(--text-tertiary)]">{t('activity.inspector.evidence')}</dt>
              <dd className="typography-ui break-words">
                {card.evidence.length === 0 ? (
                  <span className="text-[var(--text-tertiary)]">{t('activity.inspector.noEvidence')}</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {card.evidence.map((item) => (
                      <li key={`${item.text}-${item.receiptId ?? 'none'}`}>
                        {item.text}
                        {item.receiptId && (
                          <span className="typography-micro ms-2 text-[var(--text-tertiary)]">
                            <span className="oc-surface-code rounded px-1">{item.receiptId}</span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {card.next && (
              <div>
                <dt className="typography-micro text-[var(--text-tertiary)]">{t('activity.inspector.next')}</dt>
                <dd className="typography-ui break-words">{t(NEXT_KEY[card.next])}</dd>
              </div>
            )}
            <div>
              <dt className="typography-micro text-[var(--text-tertiary)]">{t('activity.inspector.rationale')}</dt>
              <dd className="typography-ui break-words text-[var(--text-tertiary)]">
                {card.rationale ?? t('activity.inspector.noRationale')}
              </dd>
            </div>
          </dl>
        </section>
      )}
      <section aria-label={t('activity.inspector.summaries')}>
        <h3 className="typography-micro mb-1 font-medium uppercase text-[var(--text-tertiary)]">
          {t('activity.inspector.summaries')}
        </h3>
        {summaries.length === 0 ? (
          <p className="typography-ui text-[var(--text-tertiary)]">{t('activity.inspector.noSummaries')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summaries.map((summary) => (
              <li key={summary.id} className="rounded-md border border-[var(--surface-border)] p-2">
                <p className="typography-micro text-[var(--text-tertiary)]">
                  {summary.source === 'model' ? t('activity.inspector.modelUpdate') : t('activity.inspector.subagentResult')}
                  {' · '}
                  <span className="oc-surface-code rounded px-1">{summary.receiptId}</span>
                </p>
                <p className="typography-ui mt-1 whitespace-pre-wrap break-words">{summary.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t('activity.inspector.timeline')}>
        <h3 className="typography-micro mb-1 font-medium uppercase text-[var(--text-tertiary)]">
          {t('activity.inspector.timeline')}
        </h3>
        {events.length === 0 ? (
          <p className="typography-ui text-[var(--text-tertiary)]">{t('activity.inspector.noEvents')}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {events.map((event) => (
              <li key={event.id} className="flex items-baseline gap-2">
                {event.at !== null && (
                  <time className="typography-micro shrink-0 text-[var(--text-tertiary)]">{formatTime(event.at)}</time>
                )}
                <div className="min-w-0">
                  <p className="typography-ui break-words">{event.label}</p>
                  {event.detail && (
                    <p className="typography-micro whitespace-pre-wrap break-words text-[var(--text-secondary)]">{event.detail}</p>
                  )}
                  {event.receiptId && (
                    <p className="typography-micro text-[var(--text-tertiary)]">
                      <span className="oc-surface-code rounded px-1">{event.receiptId}</span>
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label={t('activity.inspector.files')}>
        <h3 className="typography-micro mb-1 font-medium uppercase text-[var(--text-tertiary)]">
          {t('activity.inspector.files')}
        </h3>
        {files.length === 0 ? (
          <p className="typography-ui text-[var(--text-tertiary)]">{t('activity.inspector.noFiles')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {files.map((file) => (
              <li key={file}>
                <button
                  type="button"
                  onClick={() => onOpenFile(file)}
                  className="typography-micro oc-surface-code rounded px-1.5 py-0.5 break-all hover:bg-interactive-hover"
                >
                  {file}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
