import React from 'react';

import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface LegendRow {
  id: string;
  /** A `codeGraph.legend.*` key: the locale catalogues are owned by another
   * lane, so these resolve once that lane lands (see the i18n-keys JSON). */
  labelKey: string;
  icon: IconName;
  swatchClass: string;
  swatchStyle?: React.CSSProperties | undefined;
}

/**
 * What each edge treatment on the graph canvas means: the compiler-resolved
 * call, the dashed unresolved guess, the import, the dashed test link, and
 * how strongly a confidence paints. Swatches reuse the exact token colours,
 * dash rhythms and confidence opacities the canvas draws, so the legend can
 * never drift from it.
 */
const LEGEND_ROWS: LegendRow[] = [
  {
    id: 'resolved',
    labelKey: 'codeGraph.legend.resolved',
    icon: 'link',
    swatchClass: 'border-t-2 border-[var(--text-tertiary)]',
  },
  {
    id: 'unresolved',
    labelKey: 'codeGraph.legend.unresolved',
    icon: 'error-warning',
    swatchClass: 'border-t-2 border-[var(--status-warning)]',
    swatchStyle: { borderTopStyle: 'dashed' },
  },
  {
    id: 'import',
    labelKey: 'codeGraph.legend.import',
    icon: 'external-link',
    swatchClass: 'border-t-2 border-[var(--status-info)]',
  },
  {
    id: 'test',
    labelKey: 'codeGraph.legend.test',
    icon: 'flask',
    swatchClass: 'border-t-2 border-[var(--status-success)]',
    swatchStyle: { borderTopStyle: 'dashed' },
  },
  {
    id: 'confidence-high',
    labelKey: 'codeGraph.legend.confidenceHigh',
    icon: 'information',
    swatchClass: 'border-t-2 border-[var(--text-tertiary)]',
    swatchStyle: { opacity: 1 },
  },
  {
    id: 'confidence-medium',
    labelKey: 'codeGraph.legend.confidenceMedium',
    icon: 'information',
    swatchClass: 'border-t-2 border-[var(--text-tertiary)]',
    swatchStyle: { opacity: 0.8 },
  },
  {
    id: 'confidence-low',
    labelKey: 'codeGraph.legend.confidenceLow',
    icon: 'information',
    swatchClass: 'border-t-2 border-[var(--text-tertiary)]',
    swatchStyle: { opacity: 0.55 },
  },
];

export const CodeGraphLegend: React.FC<{ className?: string | undefined }> = ({ className }) => {
  const { t } = useI18n();
  return (
    <section aria-label={t('codeGraph.legend.title' as I18nKey)} className={cn('flex flex-col gap-1', className)}>
      <h3 className="typography-ui-header text-[var(--text-secondary)]">{t('codeGraph.legend.title' as I18nKey)}</h3>
      <ul className="flex flex-col gap-1">
        {LEGEND_ROWS.map((row) => (
          <li
            key={row.id}
            data-testid={`code-graph-legend-row-${row.id}`}
            className="typography-micro flex items-center gap-2 text-[var(--text-secondary)]"
          >
            <Icon name={row.icon} className="size-4 shrink-0" aria-hidden="true" />
            <span aria-hidden="true" className={cn('w-8 shrink-0', row.swatchClass)} style={row.swatchStyle} />
            <span>{t(row.labelKey as I18nKey)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
