import { Window } from 'happy-dom';
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { CodeGraphIndexSummary } from '@/lib/codeGraphApi';

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

/** Minimal index body the panel parses: binding plus counts, like the real envelope. */
const baseIndex = (overrides: Partial<CodeGraphIndexSummary> = {}): CodeGraphIndexSummary => ({
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
  ...overrides,
});

type ExploreBody = CodeGraphIndexSummary & {
  coverage: 'indexed';
  knowledgeIds: never[];
  unresolved: never[];
  unsupported: never[];
  items: never[];
  modules: never[];
};

const json = (payload: CodeGraphIndexSummary | ExploreBody | { error: string }, status = 200): Response => Response.json(payload, { status });

let container: HTMLElement;
let root: Root;
let restoreFetch = () => {};

const stubFetch = (indexBody: CodeGraphIndexSummary): void => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, 'http://localhost');
    if (url.pathname === '/api/code-graph/index') return json(indexBody);
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
  restoreFetch = () => fetchSpy.mockRestore();
};

const render = async (): Promise<void> => {
  const { useUIStore } = await import('@/stores/useUIStore');
  useUIStore.setState({ codeGraphStateByDirectory: {} });
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
  await act(async () => {});
};

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  restoreFetch();
});

const watcherLine = (): string | null =>
  container.querySelector('[data-testid="code-graph-watcher-state"]')?.textContent ?? null;

describe('code graph watcher state', () => {
  test('watcher enabled states automatic pickup', async () => {
    stubFetch(baseIndex({ watcher: { enabled: true, watchedScopes: 1, debounceMs: 500 } }));
    await render();

    const line = watcherLine();
    expect(line !== null).toBe(true);
    expect(line).toContain('Watching for changes');
    expect(line).toContain('automatically');
    expect(line?.includes('Not watching')).toBe(false);
  });

  test('watcher disabled states re-check on return, never claims live', async () => {
    stubFetch(baseIndex({ watcher: { enabled: false, watchedScopes: 0, debounceMs: 500 } }));
    await render();

    const line = watcherLine();
    expect(line !== null).toBe(true);
    expect(line).toContain('Not watching for changes');
    expect(line).toContain('re-checks when you return or change directory');
    expect(line?.includes('automatically')).toBe(false);
  });

  test('pending changes never read as up to date while watching', async () => {
    stubFetch(baseIndex({
      watcher: { enabled: true, watchedScopes: 1, debounceMs: 500 },
      staleFiles: [{ file: 'src/edited.ts', ageMs: 12 }],
      pendingSync: ['src/edited.ts', 'src/other.ts'],
    }));
    await render();

    const line = watcherLine();
    expect(line !== null).toBe(true);
    expect(line).toContain('Watching for changes');
    expect(line).toContain('2 files pending re-index');
    expect(line?.includes('automatically')).toBe(false);
    expect(line?.toLowerCase().includes('up to date')).toBe(false);
  });

  test('pending changes while not watching name the re-check, never up to date', async () => {
    stubFetch(baseIndex({
      watcher: { enabled: false, watchedScopes: 0, debounceMs: 500 },
      staleFiles: [{ file: 'src/edited.ts', ageMs: 12 }],
      pendingSync: ['src/edited.ts'],
    }));
    await render();

    const line = watcherLine();
    expect(line !== null).toBe(true);
    expect(line).toContain('Not watching for changes');
    expect(line).toContain('1 file pending re-index');
    expect(line).toContain('re-checks when you return or change directory');
    expect(line?.toLowerCase().includes('up to date')).toBe(false);
  });

  test('an older server without watcher sends no watcher line', async () => {
    stubFetch(baseIndex());
    await render();

    expect(container.querySelector('[data-testid="code-graph-watcher-state"]') === null).toBe(true);
  });
});
