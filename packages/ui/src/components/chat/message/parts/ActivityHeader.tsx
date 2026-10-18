// Header for the ULW activity card: the literal loop name, the translated
// phase, and the step counts. Kept free of tool-row imports so the header
// renders in isolation; the card owns the rows. Status travels as text plus
// a failed border on the card — never color alone.
import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import type { UlwActivitySummary, UlwPhase } from '@/lib/ulwActivity';

interface ActivityHeaderProps {
  readonly summary: UlwActivitySummary;
  readonly open: boolean;
  readonly onToggle: () => void;
}

const phaseKey = (phase: UlwPhase): 'chat.ulwActivity.phase.planning' | 'chat.ulwActivity.phase.investigating' | 'chat.ulwActivity.phase.synthesizing' | 'chat.ulwActivity.phase.completed' => {
  if (phase === 'investigating') return 'chat.ulwActivity.phase.investigating';
  if (phase === 'synthesizing') return 'chat.ulwActivity.phase.synthesizing';
  if (phase === 'completed') return 'chat.ulwActivity.phase.completed';
  return 'chat.ulwActivity.phase.planning';
};

export function ActivityHeader(props: ActivityHeaderProps): React.ReactElement {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={props.onToggle}
      aria-expanded={props.open}
      aria-label={t(props.open ? 'chat.ulwActivity.collapse' : 'chat.ulwActivity.expand')}
      className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left hover:bg-interactive-hover"
    >
      <Icon name="tools" className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="typography-meta font-medium">ULW</span>
      <span className="typography-meta font-medium">{t(phaseKey(props.summary.phase))}</span>
      <span className="typography-meta text-muted-foreground">
        {t('chat.ulwActivity.steps', { completed: props.summary.completed, total: props.summary.total })}
      </span>
      <span className="ml-auto flex-shrink-0">
        <Icon name={props.open ? 'arrow-down-s' : 'arrow-right-s'} className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}
