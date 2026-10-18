// Compact activity card for a run of consecutive ULW control-plane calls:
// one header (phase + step counts) instead of a shell row per bookkeeping
// call. The raw tool rows stay expandable below it, so nothing auditable is
// hidden — the card only folds the noise.
import React from 'react';

import type { ToolPart as ToolPartType } from '@/lib/opencode/model';
import { expandUlvCalls, summarizeUlwActivity, type UlwCallStatus } from '@/lib/ulwActivity';

import ToolPart from './ToolPart';
import { ActivityHeader } from './ActivityHeader';
import type { ToolPopupContent } from '../types';

export interface ActivityCardCall {
  readonly id: string;
  readonly part: ToolPartType;
}

interface ActivityCardProps {
  readonly messageId: string;
  readonly calls: readonly ActivityCardCall[];
  readonly expandedTools: Set<string>;
  readonly onToggleTool: (toolId: string) => void;
  readonly isMobile: boolean;
  readonly alwaysShowActions: boolean;
  readonly onShowPopup: (content: ToolPopupContent) => void;
}

const callStatusOf = (part: ToolPartType): UlwCallStatus => part.state.status;

export function ActivityCard(props: ActivityCardProps): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  const summary = React.useMemo(
    () => summarizeUlwActivity(props.calls.flatMap((call) => expandUlvCalls(call.part, callStatusOf(call.part)))),
    [props.calls],
  );
  if (props.calls.length === 0) {
    return null;
  }
  return (
    <div
      className="tool-output-surface rounded-xl border p-2 space-y-2"
      style={summary.status === 'failed' ? { borderColor: 'var(--status-error-border)' } : undefined}
      data-ulw-activity-card=""
    >
      <ActivityHeader summary={summary} open={open} onToggle={() => setOpen((value) => !value)} />
      {open ? (
        <div className="pt-1">
          {props.calls.map((call) => (
            <ToolPart
              key={call.id}
              part={call.part}
              isExpanded={props.expandedTools.has(call.id)}
              onToggle={props.onToggleTool}
              isMobile={props.isMobile}
              alwaysShowActions={props.alwaysShowActions}
              onShowPopup={props.onShowPopup}
              animateTailText={false}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
