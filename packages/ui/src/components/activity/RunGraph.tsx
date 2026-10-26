import React from 'react';

import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type ActivityNodeState,
  type RunGraph,
} from './activityModel';
import { computeFitView, graphNodeSignature, zoomGraphView, type GraphView } from './activityGraphView';
import { exceedsDragThreshold } from '@/lib/dragGesture';
import { useWaitingBlink } from '@/hooks/useDurationTicker';

const STATE_ICON = {
  pending: null,
  running: null,
  completed: 'check',
  failed: 'close-circle',
  cancelled: 'close',
  blocked: 'error-warning',
  unknown: null,
} satisfies Record<ActivityNodeState, IconName | null>;

const stateTone = (state: ActivityNodeState): string => {
  switch (state) {
    case 'completed':
      return 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]';
    case 'failed':
      return 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]';
    case 'blocked':
      return 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]';
    case 'running':
      return 'border-[var(--status-info-border)] bg-[var(--status-info-background)] text-[var(--status-info)]';
    default:
      return 'border-[var(--surface-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)]';
  }
};

type Props = {
  graph: RunGraph;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * One graph node. Its waiting dot blinks on the shared clock instead of running an
 * infinite CSS animation: a node can sit in `running` for minutes, which the
 * animation contract forbids for anything that stays on screen that long.
 */
const GraphNodeButton: React.FC<{
  node: RunGraph['nodes'][number];
  selected: boolean;
  onSelect: (id: string) => void;
}> = ({ node, selected, onSelect }) => {
  const { t } = useI18n();
  const blink = useWaitingBlink(node.state === 'running');
  const icon = STATE_ICON[node.state];
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      aria-pressed={selected}
      className={cn(
        'absolute flex flex-col justify-center gap-0.5 rounded-md border px-2 text-start',
        stateTone(node.state),
        selected && 'outline outline-2 outline-[var(--status-info)]',
      )}
      style={{ insetInlineStart: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <span className="typography-ui flex items-center gap-1 truncate font-medium">
        {node.state === 'running' && (
          <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full bg-current', blink)} aria-hidden="true" />
        )}
        {icon && <Icon name={icon} className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{node.label}</span>
      </span>
      <span className="typography-micro opacity-80">
        {t(`activity.graph.state.${node.state}`)}
        {selected ? ` · ${t('activity.graph.selected')}` : ''}
      </span>
    </button>
  );
};

/**
 * Interactive execution DAG. Nodes are HTML buttons positioned over an SVG
 * edge layer; pan drags the world, the wheel zooms at the cursor, and Fit
 * restores the whole graph. Layout is stable across updates because node
 * positions come from the model, keyed by id. The viewport is stable too:
 * refit runs only when the node set changes, never on state-only updates,
 * so live progress never yanks a zoomed or panned view (see DOCUMENTATION).
 */
export const RunGraphView: React.FC<Props> = ({ graph, selectedId, onSelect }) => {
  const { t } = useI18n();
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const [view, setView] = React.useState<GraphView>({ x: 16, y: 16, scale: 1 });
  const dragRef = React.useRef<{ startX: number; startY: number; base: GraphView; moved: boolean } | null>(null);
  // Node-set identity of the last refit. State-only updates keep the user's
  // pan and zoom; added or removed nodes (or a new conversation) refit.
  const fittedSignature = React.useRef<string | null>(null);

  const fit = React.useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const next = computeFitView(rect.width, rect.height, graph.width, graph.height);
    if (next) setView(next);
  }, [graph.width, graph.height]);

  React.useEffect(() => {
    const signature = graphNodeSignature(graph.nodes.map((node) => node.id));
    if (fittedSignature.current !== signature) {
      fittedSignature.current = signature;
      fit();
    }
  }, [graph, fit]);

  // Wheel has to be a native non-passive listener: a React onWheel prop is
  // attached passively at the root, so it cannot stop the panel scrolling while
  // it zooms, and the graph slides out from under the cursor.
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      setView((current) => zoomGraphView(current, event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0));
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, []);

  const nodeById = React.useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);

  return (
    <div className="flex h-full flex-col">
      <div className="typography-micro flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-2 text-[var(--text-secondary)]">
        {(['pending', 'running', 'completed', 'failed', 'blocked'] as const).map((state) => (
          <span key={state} className="inline-flex items-center gap-1">
            <span className={cn('inline-block h-2.5 w-2.5 rounded-full border', stateTone(state))} aria-hidden="true" />
            {t(`activity.graph.state.${state}`)}
          </span>
        ))}
        <button
          type="button"
          onClick={fit}
          className="typography-micro ms-auto rounded border border-[var(--surface-border)] px-2 py-0.5 text-[var(--text-secondary)]"
        >
          {t('activity.graph.fit')}
        </button>
      </div>
      <div
        ref={frameRef}
        role="application"
        aria-label={t('activity.graph.label')}
        className="relative min-h-64 flex-1 cursor-grab touch-none overflow-hidden rounded-md border border-[var(--surface-border)] select-none active:cursor-grabbing"
        onPointerDown={(event) => {
          dragRef.current = { startX: event.clientX, startY: event.clientY, base: view, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          if (!drag.moved) {
            if (!exceedsDragThreshold(drag.startX, drag.startY, event.clientX, event.clientY)) return;
            drag.moved = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }
          setView({ ...drag.base, x: drag.base.x + event.clientX - drag.startX, y: drag.base.y + event.clientY - drag.startY });
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <div
          className="absolute start-0 top-0"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}
        >
          <svg width={graph.width} height={graph.height} className="absolute start-0 top-0" aria-hidden="true">
            {graph.edges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              if (!from || !to) return null;
              const x1 = from.x + NODE_WIDTH;
              const y1 = from.y + NODE_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_HEIGHT / 2;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2 - 4} ${y2}`}
                  fill="none"
                  stroke="var(--text-tertiary)"
                  strokeWidth={edge.blocking ? 2 : 1.25}
                  strokeDasharray={edge.blocking ? '5 3' : undefined}
                  markerEnd="url(#activity-arrow)"
                />
              );
            })}
            <defs>
              <marker id="activity-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--text-tertiary)" />
              </marker>
            </defs>
          </svg>
          {graph.nodes.map((node) => (
            <GraphNodeButton
              key={node.id}
              node={node}
              selected={node.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
