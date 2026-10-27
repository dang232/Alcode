import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import type { CodeGraphEvidence } from '@/lib/codeGraphApi';

/** One related symbol: a caller, a callee, or an impacted dependent. */
export interface CodeGraphInspectorRelation {
  id: string;
  file: string;
  line: number;
  name?: string;
  evidence: CodeGraphEvidence[];
}

export interface CodeGraphInspectorTest {
  id: string;
  file: string;
  line: number;
  name?: string;
}

export interface CodeGraphInspectorImpacted {
  id: string;
}

/**
 * Everything the inspector shows for a node. The panel assembles this from
 * its own answers (topology, context, impact, tests): the inspector renders
 * and never fetches.
 */
export interface CodeGraphInspectorNode {
  id: string;
  name?: string;
  kind: string;
  file: string | null;
  line: number | null;
  /** Snapshot-aware `path:line` label, formatted by the panel. */
  pathLabel: string;
  confidence: number | null;
  incoming: CodeGraphInspectorRelation[];
  outgoing: CodeGraphInspectorRelation[];
  evidence: CodeGraphEvidence[];
  tests: CodeGraphInspectorTest[];
  impactedCount: number | null;
  impacted: CodeGraphInspectorImpacted[];
}

/**
 * Everything the inspector shows for an edge, from the panel's topology plus
 * the evidence ref the canvas hands over on click.
 */
export interface CodeGraphInspectorEdge {
  id: string;
  kind: string;
  from: string;
  to: string;
  fromPath: string;
  toPath: string;
  fromFile: string | null;
  fromLine: number | null;
  toFile: string | null;
  toLine: number | null;
  confidence: number;
  sites: number;
  evidenceRef?: string;
}

export interface CodeGraphInspectorProps {
  selection: { kind: 'node' | 'edge'; id: string } | null;
  node: CodeGraphInspectorNode | null;
  edge: CodeGraphInspectorEdge | null;
  onTraceFrom(id: string): void;
  onTraceTo(id: string): void;
  onImpact(id: string): void;
  onOpenSource(file: string, line: number): void;
  /** Code peek through the panel's own peek state: no second viewer, no second fetch. */
  onPeek(file: string, line: number): void;
  onClose(): void;
  sourceError: string | null;
}

/**
 * The selected node or edge: identity, `path:line`, code peek, incoming and
 * outgoing relations with provenance and confidence, related tests, and the
 * trace/impact actions. Every row comes from the panel's loaded answers;
 * opening a file or peeking reuses the panel's own handlers.
 */
export const CodeGraphInspector: React.FC<CodeGraphInspectorProps> = ({
  selection,
  node,
  edge,
  onTraceFrom,
  onTraceTo,
  onImpact,
  onOpenSource,
  onPeek,
  onClose,
  sourceError,
}) => {
  const { t } = useI18n();
  if (!selection) return null;

  return (
    <div className="mt-1 flex flex-col gap-2" data-testid="code-graph-inspector" data-selection-kind={selection.kind}>
      {selection.kind === 'edge' ? (
        <EdgeView
          edge={edge}
          onTraceFrom={onTraceFrom}
          onImpact={onImpact}
          onOpenSource={onOpenSource}
          onClose={onClose}
        />
      ) : node ? (
        <NodeView
          node={node}
          onTraceFrom={onTraceFrom}
          onTraceTo={onTraceTo}
          onImpact={onImpact}
          onOpenSource={onOpenSource}
          onPeek={onPeek}
          onClose={onClose}
        />
      ) : (
        <p className="typography-micro text-muted-foreground">{t('codeGraph.state.unknown')}</p>
      )}
      {sourceError ? (
        <p className="typography-micro break-words text-[var(--status-warning)]" data-testid="code-graph-source-error">{sourceError}</p>
      ) : null}
    </div>
  );
};

const InspectorHeader: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2">
      <p dir="ltr" className="typography-ui min-w-0 flex-1 truncate text-start font-medium text-foreground">{title}</p>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        data-testid="code-graph-inspector-close"
        aria-label={t('codeGraph.explorer.reset')}
        onClick={onClose}
        className="shrink-0"
      >
        <Icon name="close" className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
};

const EvidenceLines: React.FC<{ evidence: CodeGraphEvidence[] }> = ({ evidence }) => {
  if (evidence.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {evidence.map((entry) => (
        <li key={`${entry.edge}-${entry.ref}`} className="typography-micro break-words text-muted-foreground">
          {`${entry.edge} · ${entry.ref} · ${entry.confidence.toFixed(2)}`}
        </li>
      ))}
    </ul>
  );
};

const NodeView: React.FC<{
  node: CodeGraphInspectorNode;
  onTraceFrom(id: string): void;
  onTraceTo(id: string): void;
  onImpact(id: string): void;
  onOpenSource(file: string, line: number): void;
  onPeek(file: string, line: number): void;
  onClose(): void;
}> = ({ node, onTraceFrom, onTraceTo, onImpact, onOpenSource, onPeek, onClose }) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2" data-testid="code-graph-inspector-node">
      <InspectorHeader title={node.name ?? node.id} onClose={onClose} />
      {node.name ? (
        <p dir="ltr" className="typography-micro truncate text-start text-muted-foreground">{node.id}</p>
      ) : null}
      <p dir="ltr" className="typography-micro truncate text-start text-muted-foreground">{node.pathLabel}</p>
      {node.file !== null && node.line !== null ? (
        <div className="flex flex-wrap gap-1">
          <Button
            variant="outline"
            size="sm"
            type="button"
            data-testid="code-graph-open-source"
            className="h-auto max-w-full whitespace-normal text-start"
            onClick={() => { if (node.file !== null && node.line !== null) onOpenSource(node.file, node.line); }}
          >
            {`${t('codeGraph.peek.read')} · ${node.pathLabel}`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            data-testid="code-graph-peek-file"
            className="h-auto max-w-full whitespace-normal text-start"
            aria-label={t('codeGraph.section.file')}
            onClick={() => { if (node.file !== null && node.line !== null) onPeek(node.file, node.line); }}
          >
            {`${t('codeGraph.section.file')} · ${node.pathLabel}`}
          </Button>
        </div>
      ) : null}
      <dl className="flex flex-col gap-0.5">
        <div className="flex gap-2">
          <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.confidence')}</dt>
          <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">
            {node.confidence !== null ? node.confidence.toFixed(2) : '—'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.impact')}</dt>
          <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">{node.impactedCount ?? '—'}</dd>
        </div>
      </dl>
      {node.evidence.length > 0 ? (
        <section aria-label={t('codeGraph.inspector.evidence')} className="flex flex-col gap-0.5">
          <h4 className="typography-ui-header text-foreground">{t('codeGraph.inspector.evidence')}</h4>
          <ul className="flex flex-col gap-0.5" data-testid="code-graph-evidence">
            {node.evidence.map((entry) => (
              <li key={`${entry.edge}-${entry.ref}`} className="typography-micro break-words text-muted-foreground">
                {`${entry.edge} · ${entry.ref} · ${entry.confidence.toFixed(2)}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label={t('codeGraph.trace.incoming')} className="flex flex-col gap-0.5">
        <h4 className="typography-ui-header text-foreground">{`${t('codeGraph.trace.incoming')} · ${node.incoming.length}`}</h4>
        {node.incoming.length === 0 ? (
          <p className="typography-micro text-muted-foreground">{t('codeGraph.trace.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {node.incoming.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5">
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    data-testid={`code-graph-inspector-trace-to-${entry.id}`}
                    onClick={() => onTraceTo(entry.id)}
                    className="typography-micro min-w-0 flex-1 break-words text-start text-muted-foreground hover:underline"
                  >
                    <span dir="ltr" className="block truncate">{`${entry.name ?? entry.id} · ${entry.file}:${entry.line}`}</span>
                  </button>
                  <button
                    type="button"
                    data-testid={`code-graph-inspector-open-${entry.id}`}
                    onClick={() => onOpenSource(entry.file, entry.line)}
                    className="typography-micro shrink-0 text-[var(--text-tertiary)] hover:underline"
                  >
                    {t('codeGraph.peek.read')}
                  </button>
                </div>
                <EvidenceLines evidence={entry.evidence} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t('codeGraph.trace.outgoing')} className="flex flex-col gap-0.5">
        <h4 className="typography-ui-header text-foreground">{`${t('codeGraph.trace.outgoing')} · ${node.outgoing.length}`}</h4>
        {node.outgoing.length === 0 ? (
          <p className="typography-micro text-muted-foreground">{t('codeGraph.trace.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {node.outgoing.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5">
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    data-testid={`code-graph-trace-fwd-${entry.id}`}
                    onClick={() => onTraceFrom(entry.id)}
                    className="typography-micro min-w-0 flex-1 break-words text-start text-muted-foreground hover:underline"
                  >
                    <span dir="ltr" className="block truncate">{`${entry.name ?? entry.id} · ${entry.file}:${entry.line}`}</span>
                  </button>
                  <button
                    type="button"
                    data-testid={`code-graph-inspector-open-${entry.id}`}
                    onClick={() => onOpenSource(entry.file, entry.line)}
                    className="typography-micro shrink-0 text-[var(--text-tertiary)] hover:underline"
                  >
                    {t('codeGraph.peek.read')}
                  </button>
                </div>
                <EvidenceLines evidence={entry.evidence} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {node.impacted.length > 0 ? (
        <div className="flex flex-col gap-1">
          {node.impacted.map((target) => (
            <div key={target.id} className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                data-testid={`code-graph-trace-to-${target.id}`}
                onClick={() => onTraceTo(target.id)}
              >
                <span dir="ltr" className="block truncate">{target.id}</span>
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          type="button"
          data-testid="code-graph-inspector-impact"
          onClick={() => onImpact(node.id)}
        >
          {t('codeGraph.mode.impact')}
        </Button>
      </div>
      {node.tests.length > 0 ? (
        <section aria-label={t('codeGraph.explorer.tests')} className="flex flex-col gap-1">
          <h4 className="typography-ui-header text-foreground">{t('codeGraph.explorer.tests')}</h4>
          <ul className="flex flex-col gap-0.5">
            {node.tests.map((test) => (
              <li key={`${test.file}:${test.line}:${test.id}`}>
                <button
                  type="button"
                  data-testid={`code-graph-open-test-${test.file}`}
                  onClick={() => onOpenSource(test.file, test.line)}
                  className="typography-micro w-full break-words text-start text-muted-foreground hover:underline"
                >
                  <span dir="ltr" className="block truncate">{`${test.name ?? test.id} · ${test.file}:${test.line}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

const EdgeView: React.FC<{
  edge: CodeGraphInspectorEdge | null;
  onTraceFrom(id: string): void;
  onImpact(id: string): void;
  onOpenSource(file: string, line: number): void;
  onClose(): void;
}> = ({ edge, onTraceFrom, onImpact, onOpenSource, onClose }) => {
  const { t } = useI18n();
  if (!edge) {
    return (
      <div className="flex flex-col gap-2" data-testid="code-graph-inspector-edge">
        <InspectorHeader title="—" onClose={onClose} />
        <p className="typography-micro text-muted-foreground">{t('codeGraph.state.unknown')}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="code-graph-inspector-edge">
      <InspectorHeader title={edge.kind} onClose={onClose} />
      <p dir="ltr" className="typography-micro break-words text-start text-muted-foreground">{`${edge.from} → ${edge.to}`}</p>
      <dl className="flex flex-col gap-0.5">
        <div className="flex gap-2">
          <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.confidence')}</dt>
          <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">{edge.confidence.toFixed(2)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.graph.edges')}</dt>
          <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">{`${edge.sites} · ${t('codeGraph.graph.edges')}`}</dd>
        </div>
        {edge.evidenceRef ? (
          <div className="flex gap-2">
            <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.evidence')}</dt>
            <dd dir="ltr" className="typography-micro min-w-0 flex-1 break-words text-start text-foreground">{edge.evidenceRef}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          disabled={edge.fromFile === null || edge.fromLine === null}
          onClick={() => { if (edge.fromFile !== null && edge.fromLine !== null) onOpenSource(edge.fromFile, edge.fromLine); }}
          className="typography-micro w-full break-words text-start text-muted-foreground hover:underline disabled:no-underline disabled:opacity-60"
        >
          <span dir="ltr" className="block truncate">{edge.fromPath}</span>
        </button>
        <button
          type="button"
          disabled={edge.toFile === null || edge.toLine === null}
          onClick={() => { if (edge.toFile !== null && edge.toLine !== null) onOpenSource(edge.toFile, edge.toLine); }}
          className="typography-micro w-full break-words text-start text-muted-foreground hover:underline disabled:no-underline disabled:opacity-60"
        >
          <span dir="ltr" className="block truncate">{edge.toPath}</span>
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          type="button"
          data-testid="code-graph-inspector-trace-from"
          onClick={() => onTraceFrom(edge.from)}
        >
          {t('codeGraph.trace.outgoing')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          data-testid="code-graph-inspector-impact"
          onClick={() => onImpact(edge.from)}
        >
          {t('codeGraph.mode.impact')}
        </Button>
      </div>
    </div>
  );
};
