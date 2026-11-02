import { Window } from 'happy-dom';
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement, HTMLFormElement: browser.HTMLFormElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent,
  MutationObserver: browser.MutationObserver, ResizeObserver: browser.ResizeObserver,
  MouseEvent: browser.MouseEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
import type { Root } from 'react-dom/client';
import type {
  CodeGraphIndexMetrics,
  CodeGraphIndexState,
  CodeGraphItem,
  CodeGraphModule,
} from '@/lib/codeGraphApi';
mock.module('@/lib/codeGraphSubject', () => ({
  resolveCodeGraphSubject: (input: { manual?: unknown }) => (
    input?.manual
      ? { source: 'manual', file: null, files: [], moduleMap: false, reason: 'explicit-selection' }
      : { source: 'module-map', file: null, files: [], moduleMap: false, reason: 'no-context' }
  ),
  useCodeGraphDefaultSubject: () => ({
    subject: { source: 'module-map', file: null, files: [], moduleMap: false, reason: 'no-context' },
    loading: false,
  }),
}));
const { I18nProvider } = await import('@/lib/i18n');
const { CodeGraphPanel } = await import('./CodeGraphPanel');

const DIRECTORY = '/home/me/repo';

/**
 * One stubbed code-graph response body: every field this suite's fetch stub
 * serves, mirroring the server fields the panel parses. Index, explore, and
 * error shapes share one body because the routes do.
 */
interface StubGraphPayload {
  projectId?: string | null;
  worktreeId?: string | null;
  revision?: string | null;
  fingerprint?: string | null;
  freshness?: string;
  observedAtMs?: number | null;
  staleAfterMs?: number;
  staleReason?: string;
  nodeCount?: number;
  edgeCount?: number;
  entryCount?: number;
  entryCap?: number;
  scopeRoot?: string | null;
  scopeMode?: string | null;
  metrics?: CodeGraphIndexMetrics;
  nestedRepoRoots?: string[];
  indexTruncated?: boolean;
  truncationReason?: string | null;
  excludedCount?: number;
  excludedSample?: string[];
  truncated?: boolean;
  ready?: boolean;
  binding?: string | null;
  snapshotRoot?: string | null;
  generation?: number | null;
  indexState?: CodeGraphIndexState;
  coverage?: string;
  knowledgeIds?: string[];
  unresolved?: string[];
  unsupported?: string[];
  items?: CodeGraphItem[];
  modules?: CodeGraphModule[];
  completeness?: string;
  completenessReason?: string;
  error?: string;
}

const baseIndex = (overrides: Partial<StubGraphPayload> = {}): StubGraphPayload => ({
  projectId: 'demo-12345678',
  worktreeId: 'wt',
  revision: 'a'.repeat(40),
  fingerprint: 'b'.repeat(64),
  freshness: 'fresh',
  observedAtMs: 7,
  staleAfterMs: 604800000,
  nodeCount: 3,
  edgeCount: 2,
  entryCount: 2,
  entryCap: 5000,
  scopeRoot: DIRECTORY,
  scopeMode: 'repo',
  metrics: { dirsVisited: 10, filesDiscovered: 20, symlinksSkipped: 0, maxDepthSeen: 3 },
  ...overrides,
});

const json = (payload: StubGraphPayload, status = 200): Response => Response.json(payload, { status });

let container: HTMLElement;
let root: Root;
let restoreFetch = () => {};
let requests: string[] = [];

const stubFetch = (handler: (url: URL) => Response | Promise<Response>): void => {
  requests = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, 'http://localhost');
    requests.push(`${url.pathname}${url.search}`);
    return handler(url);
  });
  restoreFetch = () => fetchSpy.mockRestore();
};

const resetCodeGraphState = async (): Promise<void> => {
  const { useUIStore } = await import('@/stores/useUIStore');
  useUIStore.setState({ codeGraphStateByDirectory: {} });
};

const render = async (directory: string | null = DIRECTORY): Promise<void> => {
  await resetCodeGraphState();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <CodeGraphPanel directory={directory} />
      </I18nProvider>,
    );
  });
  await act(async () => {});
  await act(async () => {});
};

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  restoreFetch();
});

const queryDir = (entry: string): string | null => {
  try {
    return new URL(entry, 'http://localhost').searchParams.get('directory');
  } catch {
    return null;
  }
};

describe('code graph truthful panel', () => {
  test('indexing with no nodes renders phase progress, never the empty-modules message', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') {
        return json({
          ready: false,
          scopeRoot: DIRECTORY,
          scopeMode: 'repo',
          freshness: 'unindexed',
          projectId: null,
          worktreeId: null,
          revision: null,
          fingerprint: null,
          observedAtMs: null,
          generation: null,
          indexTruncated: false,
          excludedCount: 0,
          excludedSample: [],
          truncated: false,
          binding: null,
          snapshotRoot: null,
          nodeCount: 0,
          edgeCount: 0,
          entryCount: 0,
          entryCap: 5000,
          indexState: { state: 'analyzing', phase: 'projects', files: 5000, projectsDone: 2, projectsTotal: 23 },
        });
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();

    expect(container.querySelector('[data-testid="code-graph-index-building"]') !== null).toBe(true);
    expect(container.textContent).toContain('Analyzing projects');
    expect(container.textContent).toContain('2/23');
    expect(container.textContent).not.toContain('No modules to show');
    expect(container.textContent).not.toContain('No indexed files to group');
    expect(container.textContent).not.toContain('No symbols found');
  });

  test('a finished empty index honestly reports no modules', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(baseIndex({ nodeCount: 0, edgeCount: 0, entryCount: 0 }));
      if (url.searchParams.get('kind') === 'explore') {
        return json({
          ...baseIndex({ nodeCount: 0, edgeCount: 0 }),
          coverage: 'indexed',
          knowledgeIds: [],
          unresolved: [],
          unsupported: [],
          items: [],
          modules: [],
        });
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await act(async () => {});
    await act(async () => {});

    expect(container.querySelector('[data-testid="code-graph-index-building"]') === null).toBe(true);
    expect(container.textContent).toContain('No modules to show');
  });

  test('stale, truncated, partial and failed states each carry the backend reason', async () => {
    // Stale with backend reason.
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') {
        return json(baseIndex({ freshness: 'stale', staleReason: 'rebuild-pending' }));
      }
      if (url.searchParams.get('kind') === 'explore') {
        return json({
          ...baseIndex({ freshness: 'stale', staleReason: 'rebuild-pending' }),
          coverage: 'indexed',
          knowledgeIds: [],
          unresolved: [],
          unsupported: [],
          items: [],
          modules: [],
        });
      }
      return json({ error: 'unexpected' }, 500);
    });
    await render();
    await act(async () => {});
    expect(container.querySelector('[data-testid="code-graph-index-stale"]')?.textContent).toContain('rebuild-pending');
    await act(async () => { root.unmount(); });
    container.remove();
    restoreFetch();

    // Truncated with entry-cap reason and excluded count.
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') {
        return json(baseIndex({
          freshness: 'stale',
          staleReason: 'index-truncated',
          indexTruncated: true,
          truncationReason: 'entry-cap',
          excludedCount: 2,
          truncated: true,
        }));
      }
      if (url.searchParams.get('kind') === 'explore') {
        return json({
          ...baseIndex({ freshness: 'stale', staleReason: 'index-truncated' }),
          coverage: 'partial',
          knowledgeIds: [],
          unresolved: ['index incomplete: 2 files excluded by the entry cap (5000 max) (entry-cap)'],
          unsupported: [],
          items: [],
          modules: [],
          completeness: 'partial',
          completenessReason: 'index-truncated',
        });
      }
      return json({ error: 'unexpected' }, 500);
    });
    await resetCodeGraphState();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider>
          <CodeGraphPanel directory={DIRECTORY} />
        </I18nProvider>,
      );
    });
    await act(async () => {});
    await act(async () => {});
    expect(container.querySelector('[data-testid="code-graph-index-truncated"]')?.textContent).toContain('entry-cap');
    expect(container.querySelector('[data-testid="code-graph-index-truncated"]')?.textContent).toContain('excluded 2');
    await act(async () => { root.unmount(); });
    container.remove();
    restoreFetch();

    // Failed terminal with the backend error, no spinner.
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') {
        return json({
          ready: false,
          scopeRoot: DIRECTORY,
          scopeMode: 'repo',
          freshness: 'unindexed',
          projectId: null,
          worktreeId: null,
          revision: null,
          fingerprint: null,
          observedAtMs: null,
          generation: null,
          indexTruncated: false,
          excludedCount: 0,
          excludedSample: [],
          truncated: false,
          binding: null,
          snapshotRoot: null,
          nodeCount: 0,
          edgeCount: 0,
          entryCount: 0,
          entryCap: 5000,
          indexState: { state: 'failed', error: 'engine exploded' },
        });
      }
      return json({ error: 'unexpected' }, 500);
    });
    await resetCodeGraphState();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider>
          <CodeGraphPanel directory={DIRECTORY} />
        </I18nProvider>,
      );
    });
    await act(async () => {});
    await act(async () => {});
    expect(container.querySelector('[data-testid="code-graph-index-failed"]')?.textContent).toContain('engine exploded');
    expect(container.querySelector('[data-spinner]') === null).toBe(true);
  });

  test('no spinner remains after terminal states', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') {
        return json(baseIndex({
          freshness: 'stale',
          staleReason: 'index-truncated',
          indexTruncated: true,
          truncationReason: 'entry-cap',
          excludedCount: 1,
          truncated: true,
        }));
      }
      if (url.searchParams.get('kind') === 'explore') {
        return json({
          ...baseIndex(),
          coverage: 'indexed',
          knowledgeIds: [],
          unresolved: [],
          unsupported: [],
          items: [],
          modules: [],
        });
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await act(async () => {});
    await act(async () => {});

    expect(container.querySelector('[data-testid="code-graph-index-truncated"]') !== null).toBe(true);
    expect(container.querySelector('[data-spinner]') === null).toBe(true);
  });

  test('nested picker selects a scope and indexes it through the job flow', async () => {
    const nestedAbs = `${DIRECTORY}/AlRepo`;
    stubFetch((url) => {
      const dir = url.searchParams.get('directory');
      if (url.pathname === '/api/code-graph/index') {
        if (dir === nestedAbs) {
          return json(baseIndex({ scopeRoot: nestedAbs, nodeCount: 5, edgeCount: 4, nestedRepoRoots: [] }));
        }
        return json(baseIndex({ scopeRoot: DIRECTORY, nestedRepoRoots: ['AlRepo', 'libs/nested'] }));
      }
      if (url.searchParams.get('kind') === 'explore') {
        if (dir === nestedAbs) {
          return json({
            ...baseIndex({ scopeRoot: nestedAbs }),
            coverage: 'indexed',
            knowledgeIds: [],
            unresolved: [],
            unsupported: [],
            items: [],
            modules: [{ name: 'src', fileCount: 1, testFileCount: 0, symbolCount: 2, edgeCount: 1, sampleSymbols: [] }],
          });
        }
        return json({
          ...baseIndex({ scopeRoot: DIRECTORY }),
          coverage: 'indexed',
          knowledgeIds: [],
          unresolved: [],
          unsupported: [],
          items: [],
          modules: [],
        });
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await act(async () => {});
    await act(async () => {});

    const picker = container.querySelector('[data-testid="code-graph-scope-picker"]');
    expect(picker !== null).toBe(true);
    expect(picker?.textContent).toContain(DIRECTORY);
    const pick = container.querySelector('[data-testid="code-graph-scope-pick-AlRepo"]');
    expect(pick !== null).toBe(true);

    await act(async () => {
      // SAFETY: pick is the scope-picker button rendered above; presence just asserted, so narrowing Element to HTMLElement for click() is sound.
      (pick as HTMLElement).click();
    });
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});

    expect(requests.some((entry) => queryDir(entry) === nestedAbs && entry.includes('/api/code-graph/index'))).toBe(true);
    expect(container.querySelector('[data-testid="code-graph-scope-active"]')?.textContent).toContain(nestedAbs);
    expect(container.querySelector('[data-testid="code-graph-scope-pick-AlRepo"]') === null).toBe(true);
  });

  test('a missing nested path fails gracefully with the backend error', async () => {
    stubFetch((url) => {
      const dir = url.searchParams.get('directory');
      if (url.pathname === '/api/code-graph/index') {
        if (dir && dir.endsWith('/gone')) {
          return json({ error: 'directory not found: /home/me/repo/gone' }, 404);
        }
        return json(baseIndex({ scopeRoot: DIRECTORY, nestedRepoRoots: ['gone'] }));
      }
      if (url.searchParams.get('kind') === 'explore') {
        return json({
          ...baseIndex({ scopeRoot: DIRECTORY }),
          coverage: 'indexed',
          knowledgeIds: [],
          unresolved: [],
          unsupported: [],
          items: [],
          modules: [],
        });
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await act(async () => {});
    await act(async () => {});

    const pick = container.querySelector('[data-testid="code-graph-scope-pick-gone"]');
    expect(pick !== null).toBe(true);
    await act(async () => {
      // SAFETY: pick is the missing-scope button rendered above; presence just asserted, so narrowing Element to HTMLElement for click() is sound.
      (pick as HTMLElement).click();
    });
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});

    expect(container.textContent).toContain('directory not found');
    expect(container.querySelector('[data-testid="code-graph-scope-active"]') !== null).toBe(true);
    const reset = container.querySelector('[data-testid="code-graph-scope-reset-inline"]');
    expect(reset !== null).toBe(true);
    await act(async () => {
      // SAFETY: reset is the back-to-parent button rendered above; presence just asserted, so narrowing Element to HTMLElement for click() is sound.
      (reset as HTMLElement).click();
    });
    await act(async () => {});
    await act(async () => {});
    expect(container.querySelector('[data-testid="code-graph-scope-active"]') === null).toBe(true);
  });
});
