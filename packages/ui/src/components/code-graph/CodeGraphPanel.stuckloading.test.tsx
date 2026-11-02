import { Window } from 'happy-dom';
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser.window,
  document: browser.document,
  navigator: browser.navigator,
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLFormElement: browser.HTMLFormElement,
  Event: browser.Event,
  CustomEvent: browser.CustomEvent,
  MutationObserver: browser.MutationObserver,
  ResizeObserver: browser.ResizeObserver,
  MouseEvent: browser.MouseEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
import type { Root } from 'react-dom/client';
import type { CodeGraphIndexSummary, CodeGraphQueryResult } from '@/lib/codeGraphApi';
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
const { fetchCodeGraphIndex } = await import('@/lib/codeGraphApi');

const DIRECTORY = '/home/me/repo';

const readyIndex = (): CodeGraphIndexSummary => ({
  ready: true,
  freshness: 'fresh',
  projectId: 'demo-12345678',
  worktreeId: 'wt',
  revision: 'a'.repeat(40),
  fingerprint: 'b'.repeat(64),
  observedAtMs: 7,
  staleAfterMs: 604800000,
  nodeCount: 3,
  edgeCount: 2,
  entryCount: 2,
  entryCap: 5000,
  scopeRoot: DIRECTORY,
  scopeMode: 'repo',
});

const emptyExplore = (): CodeGraphQueryResult => ({
  coverage: 'indexed',
  knowledgeIds: [],
  unresolved: [],
  unsupported: [],
  items: [],
  modules: [],
  totals: { displayed: 0, known: 0, hidden: 0 },
});

type StubResponseBody = Partial<CodeGraphIndexSummary> | Partial<CodeGraphQueryResult> | { error: string };

const json = (payload: StubResponseBody, status = 200): Response => Response.json(payload, { status });

let container: HTMLElement;
let root: Root;
let restoreFetch = () => {};
let requests: string[] = [];

const stubFetch = (handler: (url: URL, signal: AbortSignal | null) => Response | Promise<Response>): void => {
  requests = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, 'http://localhost');
    requests.push(`${url.pathname}${url.searchParams.get('kind') ?? ''}`);
    const signal = init?.signal ?? null;
    return handler(url, signal);
  });
  restoreFetch = () => fetchSpy.mockRestore();
};

/** A deferred fetch that rejects like a real aborted request when signalled. */
const abortableDeferred = (
  signal: AbortSignal | null,
  onResolve: (resolve: (value: Response) => void) => void,
): Promise<Response> =>
  new Promise<Response>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    onResolve(resolve);
    signal?.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true },
    );
  });

const render = async (directory: string | null = DIRECTORY): Promise<void> => {
  const { useUIStore } = await import('@/stores/useUIStore');
  useUIStore.setState({ codeGraphStateByDirectory: {} });
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
  await act(async () => {
    root.unmount();
  });
  container.remove();
  restoreFetch();
});

const header = (): Element | null => {
  const heading = container.querySelector('h2.typography-ui-header');
  return heading?.closest('div') ?? null;
};

const headerSpinnerCount = (): number => header()?.querySelectorAll('[data-spinner]').length ?? 0;

const explorerSpinnerCount = (): number =>
  container.querySelector('[data-region="explorer"]')?.querySelectorAll('[data-spinner]').length ?? 0;

const submitSearch = async (needle: string): Promise<void> => {
  const form = container.querySelector('form[role="search"]');
  expect(form !== null).toBe(true);
  const input = form?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('no search input');
  // The native setter provably exists on element prototypes; without it the
  // controlled input would ignore the programmatic value.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  if (setter === undefined) throw new Error('no native value setter');
  setter.call(input, needle);
  input?.dispatchEvent(new window.Event('input', { bubbles: true }));
  await act(async () => {});
  form?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await act(async () => {});
  await act(async () => {});
};

const clickHeaderRefresh = async (): Promise<void> => {
  const button = header()?.querySelector('button');
  if (!(button instanceof HTMLElement)) throw new Error('no header refresh button');
  button.click();
  await act(async () => {});
  await act(async () => {});
};

const clickMode = async (mode: 'explore' | 'trace' | 'impact'): Promise<void> => {
  const button = container.querySelector(`#code-graph-mode-${mode}`);
  if (!(button instanceof HTMLElement)) throw new Error('no such mode button');
  button.click();
  await act(async () => {});
  await act(async () => {});
};

describe('code graph stuck loading', () => {
  test('a refresh that steals a search leaves no spinner behind', async () => {
    const indexResolvers: Array<(value: Response) => void> = [];
    const searchResolvers: Array<(value: Response) => void> = [];
    stubFetch((url, signal) => {
      if (url.pathname === '/api/code-graph/index') {
        return abortableDeferred(signal, (resolve) => {
          indexResolvers.push(resolve);
        });
      }
      if (url.searchParams.get('kind') === 'search') {
        return abortableDeferred(signal, (resolve) => {
          searchResolvers.push(resolve);
        });
      }
      return json(emptyExplore());
    });

    await render();
    expect(headerSpinnerCount()).toBe(1);
    indexResolvers[0]?.(json(readyIndex()));
    await act(async () => {});
    await act(async () => {});
    expect(headerSpinnerCount()).toBe(0);

    // A search submit while the header is idle: no stealing yet, the search
    // spinner shows alone. Then refresh steals it through trackPending and
    // starts a fresh index load instead — the aborted search has no
    // same-loader successor, so its spinner must clear while the header
    // spins for the refresh.
    await submitSearch('mergePersistedStates');
    expect(searchResolvers.length).toBe(1);
    expect(explorerSpinnerCount()).toBe(1);

    await clickHeaderRefresh();
    expect(explorerSpinnerCount()).toBe(0);
    expect(headerSpinnerCount()).toBe(1);

    // Late settlement of the stolen search must not touch the header.
    searchResolvers[0]?.(json({ coverage: 'indexed', items: [], totals: { displayed: 0, known: 0, hidden: 0 }, completeness: 'complete' }));
    await act(async () => {});
    await act(async () => {});
    expect(headerSpinnerCount()).toBe(1);

    indexResolvers[1]?.(json(readyIndex()));
    await act(async () => {});
    await act(async () => {});
    expect(headerSpinnerCount()).toBe(0);
  });

  test('a superseded explore keeps the newer spinner until it settles', async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const indexResolvers: Array<(value: Response) => void> = [];
    stubFetch((url, signal) => {
      if (url.pathname === '/api/code-graph/index') {
        return abortableDeferred(signal, (resolve) => {
          indexResolvers.push(resolve);
        });
      }
      if (url.searchParams.get('kind') === 'explore') {
        return abortableDeferred(signal, (resolve) => {
          resolvers.push(resolve);
        });
      }
      return json({});
    });

    await render();
    indexResolvers[0]?.(json(readyIndex()));
    await act(async () => {});
    await act(async () => {});
    expect(explorerSpinnerCount()).toBe(1);

    // Leaving explore mode supersedes the in-flight explore with nothing,
    // and coming back starts a fresh one: the stale answer must never clear
    // the newer request's spinner.
    await clickMode('trace');
    await clickMode('explore');
    expect(resolvers.length).toBe(2);

    resolvers[0]?.(json(emptyExplore()));
    await act(async () => {});
    await act(async () => {});
    expect(explorerSpinnerCount()).toBe(1);

    resolvers[1]?.(json(emptyExplore()));
    await act(async () => {});
    await act(async () => {});
    expect(explorerSpinnerCount()).toBe(0);
  });

  test('a truncated index stops the build poll instead of refetching forever', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') {
        return json({
          ready: false,
          scopeRoot: DIRECTORY,
          scopeMode: 'repo',
          freshness: 'unindexed',
          nodeCount: 0,
          edgeCount: 0,
          entryCount: 0,
          entryCap: 5000,
          truncationReason: 'entry-cap',
          excludedCount: 4161,
          indexState: { state: 'truncated', startedAtMs: 1, error: null },
        });
      }
      return json({});
    });

    await render();
    const indexCalls = requests.filter((entry) => entry.startsWith('/api/code-graph/index')).length;
    expect(indexCalls).toBe(1);
    // Past the 2.5s chained poll tick: a terminal truncated state schedules nothing.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await act(async () => {});
    expect(requests.filter((entry) => entry.startsWith('/api/code-graph/index')).length).toBe(1);
    expect(container.querySelector('[data-testid="code-graph-index-building"]') !== null).toBe(true);
  });

  test('an index request that never answers fails loudly with a retryable error', async () => {
    stubFetch(() => new Promise<Response>(() => {}));
    await expect(fetchCodeGraphIndex(DIRECTORY, { timeoutMs: 25, signal: new AbortController().signal })).rejects.toThrow(
      /timed out/,
    );
  });
});
