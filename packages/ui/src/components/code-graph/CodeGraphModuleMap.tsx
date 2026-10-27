import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

interface CodeGraphModuleExtensionCount {
  ext: string;
  count: number;
}

interface CodeGraphModuleEntry {
  name: string;
  fileCount?: number;
  symbolCount?: number;
  edgeCount?: number;
  analyzedFiles?: number;
  unanalyzedFiles?: number;
  unanalyzedByExtension?: Array<CodeGraphModuleExtensionCount>;
  excludedFiles?: number;
}

interface CodeGraphModuleFile {
  file: string;
  isTest?: boolean;
}

interface CodeGraphModuleMapProps {
  modules: Array<CodeGraphModuleEntry>;
  expanded: string | null;
  onToggle(module: string): void;
  onFocusModule(module: string): void;
  onSelectFile(file: string): void;
  filesByModule: Record<string, Array<CodeGraphModuleFile>>;
}

const isCount = (value: number | undefined): value is number => value !== undefined;

/**
 * The Code Graph module map: the initial view when neither an editor file nor
 * working changes exist. One row per module carries the name, the analyzed
 * file count, the symbol count, and the edge count straight from props — the
 * analyzed total is never derived by arithmetic, and a module the server
 * reports no coverage for says so instead of showing 0. Expanding a row
 * reveals its files with a focus action; every row is a button with
 * `aria-expanded`, toggled by click, Enter, or Space.
 */
export function CodeGraphModuleMap({
  modules,
  expanded,
  onToggle,
  onFocusModule,
  onSelectFile,
  filesByModule,
}: CodeGraphModuleMapProps): React.JSX.Element {
  const { t } = useI18n();

  if (modules.length === 0) {
    return (
      <section aria-label={t('codeGraph.explore.title')} className="flex flex-col gap-1">
        <p className="typography-micro text-muted-foreground">{t('codeGraph.moduleMap.empty')}</p>
      </section>
    );
  }

  return (
    <section
      aria-label={t('codeGraph.explore.title')}
      className="flex flex-col gap-1"
      data-testid="code-graph-module-map"
    >
      {modules.map((module) => {
        const isOpen = expanded === module.name;
        const coverageReported =
          isCount(module.analyzedFiles) ||
          isCount(module.unanalyzedFiles) ||
          module.unanalyzedByExtension !== undefined ||
          isCount(module.excludedFiles);
        const analyzedCount = isCount(module.analyzedFiles) ? module.analyzedFiles : module.fileCount;
        const unanalyzedCount =
          isCount(module.unanalyzedFiles) && module.unanalyzedFiles > 0 ? module.unanalyzedFiles : null;
        const breakdown = module.unanalyzedByExtension ?? [];
        const files = filesByModule[module.name] ?? [];
        const stats: Array<string> = [];
        if (isCount(analyzedCount)) {
          stats.push(`${analyzedCount} ${t('codeGraph.explore.files')}`);
        }
        if (isCount(module.symbolCount)) {
          stats.push(`${module.symbolCount} ${t('codeGraph.explore.symbols')}`);
        }
        if (isCount(module.edgeCount)) {
          stats.push(`${module.edgeCount} ${t('codeGraph.explorer.edges')}`);
        }

        return (
          <div key={module.name} className="flex flex-col gap-1 rounded-md border border-border p-2">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`code-graph-module-files-${module.name}`}
              data-testid={`code-graph-module-${module.name}`}
              className="flex w-full flex-col items-stretch gap-0.5 text-start"
              onClick={() => onToggle(module.name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  // Native activation would fire onClick as well; prevent the
                  // double toggle and route the key through onToggle once.
                  event.preventDefault();
                  onToggle(module.name);
                }
              }}
            >
              <span className="typography-ui flex items-center gap-1.5 break-words text-foreground">
                <Icon
                  name={isOpen ? 'arrow-down-s' : 'arrow-right-s'}
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                {module.name}
              </span>
              {stats.length > 0 ? (
                <span className="typography-micro text-muted-foreground">{stats.join(' · ')}</span>
              ) : null}
              {coverageReported ? null : (
                <span className="typography-micro text-muted-foreground">
                  {t('codeGraph.moduleMap.coverageUnknown')}
                </span>
              )}
              {unanalyzedCount !== null ? (
                <span className="typography-micro text-muted-foreground">
                  {`${unanalyzedCount} ${t('codeGraph.moduleMap.unanalyzed')}`}
                </span>
              ) : null}
            </button>
            {isOpen ? (
              <div id={`code-graph-module-files-${module.name}`} className="mt-1 flex flex-col gap-1">
                {breakdown.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    <p className="typography-micro text-muted-foreground">
                      {t('codeGraph.moduleMap.unanalyzedByType')}
                    </p>
                    <ul className="flex flex-col gap-0.5" dir="ltr">
                      {breakdown.map((entry) => (
                        <li
                          key={entry.ext}
                          className="typography-micro flex items-center gap-1 text-muted-foreground"
                        >
                          <span>{entry.ext}</span>
                          <span>{entry.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div>
                  <Button
                    variant="ghost"
                    size="xs"
                    type="button"
                    data-testid={`code-graph-module-focus-${module.name}`}
                    onClick={() => onFocusModule(module.name)}
                  >
                    {t('codeGraph.moduleMap.focus')}
                  </Button>
                </div>
                {files.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    <p className="typography-micro text-muted-foreground">{t('codeGraph.moduleMap.files')}</p>
                    <ul className="flex flex-col gap-0.5" data-testid={`code-graph-module-file-list-${module.name}`}>
                      {files.map((entry) => (
                        <li key={entry.file}>
                          <button
                            type="button"
                            dir="ltr"
                            className="typography-micro w-full break-words text-start text-muted-foreground hover:underline"
                            onClick={() => onSelectFile(entry.file)}
                          >
                            {entry.file}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
