import React from 'react';

import {
  computeFitView,
  graphNodeSignature,
  zoomGraphView,
  type GraphView,
} from '@/components/activity/activityGraphView';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { CodeGraphTopology } from '@/lib/codeGraphApi';
import { NODE_HEIGHT, NODE_WIDTH, layoutCodeGraph, type CodeGraphDrawnNode } from './codeGraphLayout';

export interface CodeGraphSelectedEdge {
  from: string;
  to: string;
  kind: string;
  confidence: number;
  sites: number;
}

type Props = {
  graph: CodeGraphTopology;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedEdge: { from: string; to: string; kind: string } | null;
  onSelectEdge: (edge: CodeGraphSelectedEdge | null) => void;
  preview: boolean;
  previewLabel: string;
  truncatedLabel: string;
  edgesLabel: string;
};

const nodeTone = (kind: string, subject: boolean): string => {
  if (subject) {
    return 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]';
  }
  if (kind === 'file') {
    return 'border-[var(--status-info-border)] bg-[var(--status-info-background)] text-[var(--status-info)]';
  }
  return 'border-[var(--surface-border)] bg-[var(--surface-raised)] text-[var(--text-secondary)]';
};

/** Maximum kind swatches before the legend collapses the rest into `+N`. */
const LEGEND_LIMIT = 5;

/**
 * One-line disambiguator under the display name: `file:line` when both are
 * known, plain `file` when only the file is, the kind name otherwise. Short
 * display names collide (several symbols can share one letter), so the
 * source location is what tells two boxes apart.
 */
const nodeSubtitle = (node: CodeGraphDrawnNode): string => {
  if (node.fileName && typeof node.line === 'number') return `${node.fileName}:${node.line}`;
  return node.fileName ?? node.kind;
};

/**
 * Interactive dependency graph: the subject in the middle, callers left,
 * dependents right, every edge directed with an arrowhead. Drag pans, the
 * wheel zooms at the cursor, Fit restores the whole neighbourhood, and
 * picking a node selects it without moving the viewport. Refit runs only
 * when the node set changes, so selecting a node never yanks the view.
 */
export const CodeGraphCanvas: React.FC<Props> = ({
  graph,
  selectedId,
  onSelect,
  selectedEdge,
  onSelectEdge,
  preview,
  previewLabel,
  truncatedLabel,
  edgesLabel,
}) => {
  const { t } = useI18n();
  const markerId = React.useId();
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const [view, setView] = React.useState<GraphView>({ x: 16, y: 16, scale: 1 });
  const fittedSignature = React.useRef<string | null>(null);
  const dragRef = React.useRef<{ startX: number; startY: number; base: GraphView } | null>(null);
  const layout = React.useMemo(() => layoutCodeGraph(graph), [graph]);

  // Kinds actually present, first-seen order, plus the subject's kind when a
  // subject node exists: its warning tone differs from its kind tone, so it
  // needs its own entry to stay explained.
  const legend = React.useMemo(() => {
    const kinds: string[] = [];
    let subjectKind: string | null = null;
    for (const node of graph.nodes) {
      if (!kinds.includes(node.kind)) kinds.push(node.kind);
      if (subjectKind === null && node.subject) subjectKind = node.kind;
    }
    return { kinds, subjectKind };
  }, [graph.nodes]);
  const shownKinds = legend.kinds.slice(0, LEGEND_LIMIT);
  const hiddenKindCount = legend.kinds.length - shownKinds.length;

  const fit = React.useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const next = computeFitView(rect.width, rect.height, layout.width, layout.height);
    if (next) setView(next);
  }, [layout.width, layout.height]);

  React.useEffect(() => {
    const signature = graphNodeSignature(layout.nodes.map((node) => node.id));
    if (fittedSignature.current !== signature) {
      fittedSignature.current = signature;
      fit();
    }
  }, [layout, fit]);

  const onWheel = React.useCallback((event: React.WheelEvent) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    setView((current) => zoomGraphView(current, event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0));
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <div className="typography-micro flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
        {preview ? (
          <span className="rounded border border-[var(--surface-border)] px-1.5 py-0.5">{previewLabel}</span>
        ) : null}
        <span aria-live="off">
          {edgesLabel} {layout.edges.length}
        </span>
        {graph.truncated ? <span>{truncatedLabel} · {t('codeGraph.graph.expand')}</span> : null}
        {legend.kinds.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {legend.subjectKind !== null ? (
              <span className="flex items-center gap-1">
                <span aria-hidden="true" className={cn('size-2 rounded-sm border', nodeTone(legend.subjectKind, true))} />
                subject
              </span>
            ) : null}
            {shownKinds.map((kind) => (
              <span key={kind} className="flex items-center gap-1">
                <span aria-hidden="true" className={cn('size-2 rounded-sm border', nodeTone(kind, false))} />
                {kind}
              </span>
            ))}
            {hiddenKindCount > 0 ? <span>+{hiddenKindCount}</span> : null}
          </span>
        ) : null}
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
        aria-label={t('codeGraph.section.graph')}
        className="relative min-h-64 flex-1 cursor-grab overflow-hidden rounded-md border border-[var(--surface-border)] active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragRef.current = { startX: event.clientX, startY: event.clientY, base: view };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          setView({ ...drag.base, x: drag.base.x + event.clientX - drag.startX, y: drag.base.y + event.clientY - drag.startY });
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <div
          className="absolute start-0 top-0"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}
        >
          <svg width={layout.width} height={layout.height} className="absolute start-0 top-0 dag-code-graph-canvas" aria-hidden="true">
            <defs>
              <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--text-tertiary)" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const midX = (edge.x1 + edge.x2) / 2;
              const active = selectedEdge !== null
                && selectedEdge.from === edge.from
                && selectedEdge.to === edge.to
                && selectedEdge.kind === edge.kind;
              const pick = () => {
                onSelectEdge(active
                  ? null
                  : { from: edge.from, to: edge.to, kind: edge.kind, confidence: edge.confidence, sites: edge.sites });
              };
              return (
                <g key={`${edge.from}->${edge.to}|${edge.kind}` }>
                  <path
                    d={`M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2 - 4} ${edge.y2}`}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    onClick={pick}
                    style={{ cursor: 'pointer' }}
                  >
                    <title>{`${edge.kind} · ${edge.sites}`}</title>
                  </path>
                  <path
                    d={`M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2 - 4} ${edge.y2}`}
                    fill="none"
                    stroke={active ? 'var(--status-info)' : 'var(--text-tertiary)'}
                    strokeWidth={active ? 2.5 : edge.sites > 1 ? 2 : 1.25}
                    strokeDasharray={edge.kind === 'TESTS' ? '5 3' : undefined}
                    markerEnd={`url(#${markerId})`}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
          </svg>
          {layout.nodes.map((node) => {
            const selected = node.id === selectedId;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelect(node.id)}
                aria-pressed={selected}
                title={node.id}
                className={cn(
                  'absolute flex flex-col justify-center gap-0.5 rounded-md border px-2 text-start',
                  nodeTone(node.kind, node.subject),
                  selected && 'outline outline-2 outline-[var(--status-info)]',
                )}
                style={{ insetInlineStart: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              >
                <span className="typography-ui truncate font-medium">{node.label}</span>
                <span className="typography-micro truncate opacity-80">{nodeSubtitle(node)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
