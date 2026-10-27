import React from 'react';

import {
  computeFitView,
  graphNodeSignature,
  zoomGraphView,
  type GraphView,
} from '@/components/activity/activityGraphView';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { exceedsDragThreshold } from '@/lib/dragGesture';
import type { CodeGraphJsonField, CodeGraphSelectedEdge, CodeGraphTopology } from '@/lib/codeGraphApi';
import { asNonEmptyText } from '@/lib/codeGraphApi';
import { NODE_HEIGHT, NODE_WIDTH, layoutCodeGraph, type CodeGraphDrawnNode, type CodeGraphDrawnEdge } from './codeGraphLayout';

type Props = {
  graph: CodeGraphTopology;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedEdge: { from: string; to: string; kind: string } | null;
  onSelectEdge?: ((edge: CodeGraphSelectedEdge | null) => void) | undefined;
  preview: boolean;
  previewLabel: string;
  truncatedLabel: string;
  edgesLabel: string;
};

/** The topology layout spreads the wire edge through, so the id (and a future
 * evidence ref) rides along at runtime even though the drawn-edge type only
 * names the geometry. Read it defensively: out-of-scope layout types stay
 * untouched. */
type DrawnEdgeRuntime = CodeGraphDrawnEdge & {
  id?: CodeGraphJsonField;
  evidenceRef?: CodeGraphJsonField;
  ref?: CodeGraphJsonField;
};

const edgeIdOf = (edge: CodeGraphDrawnEdge): string => {
  // SAFETY: the layout spreads the wire edge through, so the id rides along at runtime; the probe validates it.
  const raw = (edge as DrawnEdgeRuntime).id;
  return asNonEmptyText(raw) ?? `${edge.from}->${edge.to}|${edge.kind}`;
};

const evidenceRefOf = (edge: CodeGraphDrawnEdge): string | undefined => {
  // SAFETY: the layout spreads the wire edge through, so the refs ride along at runtime; the probe validates them.
  const runtime = edge as DrawnEdgeRuntime;
  const raw = runtime.evidenceRef ?? runtime.ref;
  return asNonEmptyText(raw);
};

const UNRESOLVED_PATTERN = /UNRESOLVED/i;
const TEST_PATH_PATTERN = /(^|\/)((__tests__)|(tests?))\//;
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * An edge is unresolved when its kind says so: exactly CALLS_UNRESOLVED, or an
 * unresolved flavour carrying uncertainty. A plain low-confidence CALLS_STATIC
 * stays resolved — confidence alone never unresolves a compiler edge.
 */
const isUnresolvedEdge = (kind: string, confidence: number): boolean => (
  kind === 'CALLS_UNRESOLVED' || (confidence < 1 && UNRESOLVED_PATTERN.test(kind))
);

const isTestEdge = (kind: string): boolean => kind === 'TESTS';

const isTestNode = (id: string, fileName: string | undefined): boolean => (
  TEST_PATH_PATTERN.test(id)
  || TEST_FILE_PATTERN.test(id)
  || (fileName !== undefined && (TEST_PATH_PATTERN.test(fileName) || TEST_FILE_PATTERN.test(fileName)))
);

type EdgeTone = 'resolved' | 'unresolved' | 'import' | 'test';

const edgeTone = (kind: string, confidence: number): EdgeTone => {
  if (isTestEdge(kind)) return 'test';
  if (isUnresolvedEdge(kind, confidence)) return 'unresolved';
  if (kind === 'IMPORTS') return 'import';
  return 'resolved';
};

const edgeStroke = (tone: EdgeTone): string => {
  if (tone === 'test') return 'var(--status-success)';
  if (tone === 'unresolved') return 'var(--status-warning)';
  if (tone === 'import') return 'var(--status-info)';
  return 'var(--text-tertiary)';
};

/** Unresolved and test edges dash with different rhythms so they never read as each other. */
const edgeDash = (tone: EdgeTone): string | undefined => {
  if (tone === 'unresolved') return '6 3';
  if (tone === 'test') return '2 3';
  return undefined;
};

/** Confidence reads as presence: certain edges paint fully, guesses recede. */
const edgeConfidenceOpacity = (confidence: number): number => {
  if (!Number.isFinite(confidence) || confidence >= 1) return 1;
  if (confidence >= 0.6) return 0.8;
  return 0.55;
};

const edgeKey = (edge: CodeGraphDrawnEdge): string => `${edge.from}->${edge.to}|${edge.kind}`;

const nodeTone = (node: CodeGraphDrawnNode, subject: boolean): string => {
  if (subject) {
    return 'border-[var(--status-warning-border)] bg-[var(--status-warning-background)] text-[var(--status-warning)]';
  }
  if (isTestNode(node.id, node.fileName)) {
    return 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]';
  }
  if (node.kind === 'file') {
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
  if (node.fileName && node.line !== undefined) return `${node.fileName}:${node.line}`;
  return node.fileName ?? node.kind;
};

/**
 * Interactive dependency graph: the subject in the middle, callers left,
 * dependents on the right, every edge directed with an arrowhead. Drag pans,
 * the wheel zooms at the cursor, Fit restores the whole neighbourhood, and
 * picking a node selects it without moving the viewport. Refit runs only
 * when the node set changes, so selecting a node never yanks the view.
 *
 * Hover is preview only: a hovered node emphasises itself and its incident
 * edges with a tooltip (name, kind, path:line) and never calls `onSelect`.
 * A hovered edge emphasises both endpoints with kind and confidence. Clicks
 * commit: a node locks the selection through `onSelect`, an edge reports the
 * full edge object through the optional `onSelectEdge`.
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
  const [hoverNodeId, setHoverNodeId] = React.useState<string | null>(null);
  const [hoverEdgeKey, setHoverEdgeKey] = React.useState<string | null>(null);
  const fittedSignature = React.useRef<string | null>(null);
  const dragRef = React.useRef<{ startX: number; startY: number; base: GraphView; moved: boolean } | null>(null);
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

  const hoverEdge = React.useMemo(
    () => layout.edges.find((edge) => edgeKey(edge) === hoverEdgeKey) ?? null,
    [layout.edges, hoverEdgeKey],
  );
  const hoverNode = React.useMemo(
    () => layout.nodes.find((node) => node.id === hoverNodeId) ?? null,
    [layout.nodes, hoverNodeId],
  );

  /** Nodes that stay lit while a hover is active; null means no hover, dim nothing. */
  const litNodes = React.useMemo((): Set<string> | null => {
    if (hoverEdge) return new Set([hoverEdge.from, hoverEdge.to]);
    if (hoverNode) {
      const lit = new Set<string>([hoverNode.id]);
      for (const edge of layout.edges) {
        if (edge.from === hoverNode.id) lit.add(edge.to);
        if (edge.to === hoverNode.id) lit.add(edge.from);
      }
      return lit;
    }
    return null;
  }, [hoverEdge, hoverNode, layout.edges]);

  /** Edge keys that stay lit while a hover is active; null means no hover. */
  const litEdges = React.useMemo((): Set<string> | null => {
    if (hoverEdge) return new Set([edgeKey(hoverEdge)]);
    if (hoverNode) {
      const lit = new Set<string>();
      for (const edge of layout.edges) {
        if (edge.from === hoverNode.id || edge.to === hoverNode.id) lit.add(edgeKey(edge));
      }
      return lit;
    }
    return null;
  }, [hoverEdge, hoverNode, layout.edges]);

  const clearHover = React.useCallback(() => {
    setHoverNodeId(null);
    setHoverEdgeKey(null);
  }, []);

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
                <span aria-hidden="true" className={cn('size-2 rounded-sm border', nodeTone({ id: '', label: '', kind: legend.subjectKind, subject: false, x: 0, y: 0 }, true))} />
                subject
              </span>
            ) : null}
            {shownKinds.map((kind) => (
              <span key={kind} className="flex items-center gap-1">
                <span aria-hidden="true" className={cn('size-2 rounded-sm border', nodeTone({ id: '', label: '', kind, subject: false, x: 0, y: 0 }, false))} />
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
        className="relative min-h-64 flex-1 cursor-grab touch-none overflow-hidden rounded-md border border-[var(--surface-border)] select-none active:cursor-grabbing"
        onMouseLeave={clearHover}
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
          <svg width={layout.width} height={layout.height} className="absolute start-0 top-0 dag-code-graph-canvas" aria-hidden="true">
            <defs>
              <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--text-tertiary)" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const midX = (edge.x1 + edge.x2) / 2;
              const key = edgeKey(edge);
              const tone = edgeTone(edge.kind, edge.confidence);
              const dash = edgeDash(tone);
              const active = selectedEdge !== null
                && selectedEdge.from === edge.from
                && selectedEdge.to === edge.to
                && selectedEdge.kind === edge.kind;
              const lit = litEdges === null || litEdges.has(key);
              const pick = () => {
                if (!onSelectEdge) return;
                if (active) {
                  onSelectEdge(null);
                  return;
                }
                const evidenceRef = evidenceRefOf(edge);
                const selection: CodeGraphSelectedEdge = {
                  id: edgeIdOf(edge),
                  from: edge.from,
                  to: edge.to,
                  kind: edge.kind,
                  confidence: edge.confidence,
                  sites: edge.sites,
                };
                if (evidenceRef !== undefined) selection.evidenceRef = evidenceRef;
                onSelectEdge(selection);
              };
              return (
                <g key={key}>
                  <path
                    d={`M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2 - 4} ${edge.y2}`}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    onClick={pick}
                    onMouseEnter={() => setHoverEdgeKey(key)}
                    onMouseLeave={() => setHoverEdgeKey((current) => (current === key ? null : current))}
                    style={{ cursor: 'pointer' }}
                  >
                    <title>{`${edge.kind} · ${edge.confidence.toFixed(2)}`}</title>
                  </path>
                  <path
                    d={`M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2 - 4} ${edge.y2}`}
                    fill="none"
                    className={cn('code-graph-edge', `code-graph-edge-${tone}`, dash !== undefined && 'code-graph-edge-dashed')}
                    stroke={active ? 'var(--status-info)' : edgeStroke(tone)}
                    strokeWidth={active ? 2.5 : edge.sites > 1 ? 2 : 1.25}
                    strokeDasharray={dash}
                    opacity={lit ? edgeConfidenceOpacity(edge.confidence) : 0.2}
                    markerEnd={`url(#${markerId})`}
                    pointerEvents="none"
                  />
                </g>
              );
            })}
          </svg>
          {layout.nodes.map((node) => {
            const selected = node.id === selectedId;
            const dimmed = litNodes !== null && !litNodes.has(node.id);
            const hovered = hoverNodeId === node.id || (hoverEdge !== null && (hoverEdge.from === node.id || hoverEdge.to === node.id));
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelect(node.id)}
                onMouseEnter={() => setHoverNodeId(node.id)}
                onMouseLeave={() => setHoverNodeId((current) => (current === node.id ? null : current))}
                onFocus={() => setHoverNodeId(node.id)}
                onBlur={() => setHoverNodeId((current) => (current === node.id ? null : current))}
                aria-pressed={selected}
                title={node.id}
                className={cn(
                  'absolute flex flex-col justify-center gap-0.5 rounded-md border px-2 text-start',
                  nodeTone(node, node.subject),
                  selected && 'outline outline-2 outline-[var(--status-info)]',
                  hovered && !selected && 'outline outline-2 outline-offset-1 outline-[var(--primary)]',
                  dimmed && 'opacity-40',
                )}
                style={{ insetInlineStart: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              >
                <span className="typography-ui truncate font-medium">{node.label}</span>
                <span className="typography-micro truncate opacity-80">{nodeSubtitle(node)}</span>
                {hoverNode?.id === node.id ? (
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute start-full top-0 z-10 ms-2 w-max max-w-56 rounded-md border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1 text-start shadow-lg"
                  >
                    <span className="typography-ui block truncate font-medium">{node.label}</span>
                    <span className="typography-micro block truncate text-[var(--text-secondary)]">
                      {node.fileName ? `${node.kind} · ${nodeSubtitle(node)}` : node.kind}
                    </span>
                  </span>
                ) : null}
              </button>
            );
          })}
          {hoverEdge ? (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 w-max max-w-56 rounded-md border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1 shadow-lg"
              style={{ left: (hoverEdge.x1 + hoverEdge.x2) / 2 + 8, top: (hoverEdge.y1 + hoverEdge.y2) / 2 - 8 }}
            >
              <span className="typography-ui block truncate font-medium">{hoverEdge.kind}</span>
              <span className="typography-micro block truncate text-[var(--text-secondary)]">
                {t('codeGraph.inspector.confidence')}: {hoverEdge.confidence.toFixed(2)}
                {(() => {
                  const ref = evidenceRefOf(hoverEdge);
                  return ref ? ` · ${ref}` : '';
                })()}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
