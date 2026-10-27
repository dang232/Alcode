import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { useI18n, type I18nKey, type I18nParams } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type CodeGraphToolbarMode = 'explore' | 'trace' | 'impact';
export type CodeGraphToolbarSubjectKind = 'file' | 'symbol';
export type CodeGraphToolbarSubjectSource = 'active-file' | 'changes' | 'module-map' | 'manual';
export type CodeGraphToolbarScope = 'symbols' | 'content';
export type CodeGraphToolbarCompleteness = 'complete' | 'partial' | 'truncated';

export interface CodeGraphToolbarSubject {
  id: string;
  label: string;
  kind: CodeGraphToolbarSubjectKind;
  source: CodeGraphToolbarSubjectSource;
}

export interface CodeGraphToolbarFilters {
  kinds: string[];
  edgeKinds: string[];
  minConfidence: number;
}

export interface CodeGraphToolbarTotals {
  displayed: number;
  known: number | null;
  hidden: number | null;
}

export interface CodeGraphToolbarProps {
  directory: string;
  subject: CodeGraphToolbarSubject | null;
  mode: CodeGraphToolbarMode;
  depth: 1 | 2 | 3;
  search: string;
  scope: CodeGraphToolbarScope;
  filters: CodeGraphToolbarFilters;
  totals: CodeGraphToolbarTotals | null;
  completeness: CodeGraphToolbarCompleteness | null;
  busy: boolean;
  onModeChange: (mode: CodeGraphToolbarMode) => void;
  onDepthChange: (depth: 1 | 2 | 3) => void;
  onSearchSubmit: (query: string) => void;
  onScopeChange: (scope: CodeGraphToolbarScope) => void;
  onFiltersChange: (filters: CodeGraphToolbarFilters) => void;
  onRefresh: () => void;
  onFit: () => void;
  onReset: () => void;
}

const MODES: ReadonlyArray<{ id: CodeGraphToolbarMode; labelKey: string }> = [
  { id: 'explore', labelKey: 'codeGraph.toolbar.modeExplore' },
  { id: 'trace', labelKey: 'codeGraph.toolbar.modeTrace' },
  { id: 'impact', labelKey: 'codeGraph.toolbar.modeImpact' },
];

const DEPTHS: ReadonlyArray<1 | 2 | 3> = [1, 2, 3];

const NODE_KINDS: ReadonlyArray<keyof NodeKindLabelKeys> = ['function', 'class', 'interface', 'file'];
const EDGE_KINDS: ReadonlyArray<keyof EdgeKindLabelKeys> = ['calls', 'defines', 'imports', 'tests'];

/** i18n keys for the node-kind filter rows, one per kind the toolbar offers. */
interface NodeKindLabelKeys {
  function: string;
  class: string;
  interface: string;
  file: string;
}

const NODE_KIND_KEYS: NodeKindLabelKeys = {
  function: 'codeGraph.toolbar.kindFunction',
  class: 'codeGraph.toolbar.kindClass',
  interface: 'codeGraph.toolbar.kindInterface',
  file: 'codeGraph.toolbar.kindFile',
};

/** i18n keys for the edge-kind filter rows, one per edge group the toolbar offers. */
interface EdgeKindLabelKeys {
  calls: string;
  defines: string;
  imports: string;
  tests: string;
}

const EDGE_KIND_KEYS: EdgeKindLabelKeys = {
  calls: 'codeGraph.toolbar.edgeCalls',
  defines: 'codeGraph.toolbar.edgeDefines',
  imports: 'codeGraph.toolbar.edgeImports',
  tests: 'codeGraph.toolbar.edgeTests',
};

/** i18n keys for the subject-source chip, one per subject source. */
interface SubjectSourceLabelKeys {
  'active-file': string;
  changes: string;
  'module-map': string;
  manual: string;
}

const SUBJECT_SOURCE_KEYS: SubjectSourceLabelKeys = {
  'active-file': 'codeGraph.toolbar.subjectActiveFile',
  changes: 'codeGraph.toolbar.subjectChanges',
  'module-map': 'codeGraph.toolbar.subjectModuleMap',
  manual: 'codeGraph.toolbar.subjectManual',
};

const toggleValue = (values: string[], value: string): string[] => (
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
);

/**
 * The toolbar above the code graph. The three modes ask the graph's three
 * questions, depth walks 1–3 hops out from the subject, and kinds/edges/
 * confidence live in one filter popover — never a permanent column and never
 * a row-count control.
 */
export const CodeGraphToolbar: React.FC<CodeGraphToolbarProps> = ({
  directory,
  subject,
  mode,
  depth,
  search,
  scope,
  filters,
  totals,
  completeness,
  busy,
  onModeChange,
  onDepthChange,
  onSearchSubmit,
  onScopeChange,
  onFiltersChange,
  onRefresh,
  onFit,
  onReset,
}) => {
  const { t } = useI18n();
  // Toolbar copy lands in the locale catalogues through the owning lane; the
  // cast below is that forward reference, not a way around the catalogue.
  // SAFETY: the toolbar only formats keys that exist in the catalogue or fall
  // back to the key itself, so the narrowed key type is sound at runtime.
  // Until it lands, `formatMessage` falls back to the key itself.
  const text = React.useCallback(
    (key: string, params?: I18nParams): string => t(key as I18nKey, params),
    [t],
  );
  const [query, setQuery] = React.useState(search);
  const [filtersOpen, setFiltersOpen] = React.useState(false);

  React.useEffect(() => {
    setQuery(search);
  }, [search]);

  return (
    <div data-testid="code-graph-toolbar" className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={text('codeGraph.toolbar.modeLabel')} className="flex items-center gap-1">
        {MODES.map((entry) => (
          <Button
            key={entry.id}
            id={`code-graph-mode-${entry.id}`}
            type="button"
            variant="chip"
            size="sm"
            aria-pressed={mode === entry.id}
            onClick={() => onModeChange(entry.id)}
          >
            {text(entry.labelKey)}
          </Button>
        ))}
      </div>

      <div role="group" aria-label={text('codeGraph.toolbar.depthLabel')} className="flex items-center gap-1">
        {DEPTHS.map((value) => (
          <Button
            key={value}
            type="button"
            variant="chip"
            size="sm"
            data-testid={`code-graph-depth-${value}`}
            aria-label={text('codeGraph.toolbar.depthOption', { depth: value })}
            aria-pressed={depth === value}
            disabled={busy}
            onClick={() => onDepthChange(value)}
          >
            {value}
          </Button>
        ))}
      </div>

      {subject && (
        <span
          data-testid="code-graph-subject"
          title={subject.id}
          className="flex min-w-0 max-w-64 items-center gap-1.5 truncate rounded-md bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] px-2 py-1 typography-ui-label"
        >
          <Icon name={subject.kind === 'file' ? 'file-text' : 'braces'} className="size-4 shrink-0" />
          <span className="truncate">{subject.label}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0 text-muted-foreground">{text(SUBJECT_SOURCE_KEYS[subject.source])}</span>
        </span>
      )}

      <form
        role="search"
        className="flex min-w-32 flex-1 items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit(query);
        }}
      >
        <Input
          inputSize="compact"
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            // Emptying the box IS the clear: an empty query with the previous
            // answer still on screen would present stale results as current.
            // Submit keeps the same meaning for an explicit Enter on empty.
            if (next.length === 0) onSearchSubmit('');
          }}
          aria-label={text('codeGraph.toolbar.searchLabel')}
          placeholder={text('codeGraph.toolbar.searchPlaceholder')}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="ghost" size="sm" aria-label={text('codeGraph.toolbar.searchSubmit')} disabled={busy}>
          <Icon name="search" className="size-4" />
        </Button>
      </form>

      <div role="group" aria-label={text('codeGraph.toolbar.scopeLabel')} className="flex items-center gap-1">
        <Button
          type="button"
          variant="chip"
          size="sm"
          data-testid="code-graph-scope-symbols"
          aria-pressed={scope === 'symbols'}
          onClick={() => onScopeChange('symbols')}
        >
          {text('codeGraph.toolbar.scopeSymbols')}
        </Button>
        <Button
          type="button"
          variant="chip"
          size="sm"
          data-testid="code-graph-scope-content"
          aria-pressed={scope === 'content'}
          onClick={() => onScopeChange('content')}
        >
          {text('codeGraph.toolbar.scopeContent')}
        </Button>
      </div>

      <div className="relative">
        <button
          type="button"
          className={cn(dropdownTriggerVariants(), 'max-w-48')}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <Icon name="filter-3" className="size-4" />
          <span className="truncate">{text('codeGraph.toolbar.filtersButton')}</span>
          <Icon name={filtersOpen ? 'arrow-up-s' : 'arrow-down-s'} className="size-4" />
        </button>
        {filtersOpen && (
          <div
            role="dialog"
            aria-label={text('codeGraph.toolbar.filtersTitle')}
            className="absolute start-0 top-full z-10 mt-1 w-64 rounded-md border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-3 shadow-lg"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFiltersOpen(false);
            }}
          >
            <p className="typography-ui-label font-medium">{text('codeGraph.toolbar.filtersKinds')}</p>
            <div className="mt-1 flex flex-col gap-1">
              {NODE_KINDS.map((kind) => (
                <span key={kind} data-testid={`code-graph-filter-kind-${kind}`} className="flex items-center gap-2">
                  <Checkbox
                    checked={filters.kinds.includes(kind)}
                    onChange={() => onFiltersChange({ ...filters, kinds: toggleValue(filters.kinds, kind) })}
                    ariaLabel={text(NODE_KIND_KEYS[kind])}
                  />
                  <span className="typography-ui-label">{text(NODE_KIND_KEYS[kind])}</span>
                </span>
              ))}
            </div>
            <p className="typography-ui-label mt-3 font-medium">{text('codeGraph.toolbar.filtersEdges')}</p>
            <div className="mt-1 flex flex-col gap-1">
              {EDGE_KINDS.map((edgeKind) => (
                <span key={edgeKind} data-testid={`code-graph-filter-edge-${edgeKind}`} className="flex items-center gap-2">
                  <Checkbox
                    checked={filters.edgeKinds.includes(edgeKind)}
                    onChange={() => onFiltersChange({ ...filters, edgeKinds: toggleValue(filters.edgeKinds, edgeKind) })}
                    ariaLabel={text(EDGE_KIND_KEYS[edgeKind])}
                  />
                  <span className="typography-ui-label">{text(EDGE_KIND_KEYS[edgeKind])}</span>
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label htmlFor="code-graph-min-confidence" className="typography-ui-label font-medium">
                {text('codeGraph.toolbar.filtersMinConfidence')}
              </label>
              <input
                id="code-graph-min-confidence"
                data-testid="code-graph-filter-confidence"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={filters.minConfidence}
                aria-label={text('codeGraph.toolbar.filtersMinConfidence')}
                onChange={(event) => onFiltersChange({ ...filters, minConfidence: Number(event.target.value) })}
                className="min-w-0 flex-1"
              />
              <span className="typography-ui-label text-muted-foreground">{filters.minConfidence}</span>
            </div>
          </div>
        )}
      </div>

      <span dir="ltr" data-testid="code-graph-directory" title={directory} className="typography-ui-label max-w-48 truncate text-muted-foreground">
        {directory}
      </span>

      {totals && (
        <p data-testid="code-graph-totals" className="typography-ui-label text-muted-foreground">
          {totals.known === null
            ? text('codeGraph.toolbar.totalsUnknown')
            : text('codeGraph.toolbar.totalsShowing', { displayed: totals.displayed, known: totals.known })}
        </p>
      )}
      {(completeness === 'truncated' || completeness === 'partial') && (
        <p data-testid="code-graph-completeness" className="typography-ui-label text-muted-foreground">
          {text(completeness === 'truncated' ? 'codeGraph.toolbar.completenessTruncated' : 'codeGraph.toolbar.completenessPartial')}
        </p>
      )}

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="code-graph-refresh"
          aria-label={text('codeGraph.toolbar.refresh')}
          disabled={busy}
          onClick={onRefresh}
        >
          <Icon name="refresh" className={cn('size-4', busy && 'animate-spin')} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="code-graph-fit"
          aria-label={text('codeGraph.toolbar.fit')}
          onClick={onFit}
        >
          <Icon name="fullscreen" className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="code-graph-reset"
          aria-label={text('codeGraph.toolbar.reset')}
          onClick={onReset}
        >
          <Icon name="history" className="size-4" />
        </Button>
      </div>
    </div>
  );
};
