import { Window } from 'happy-dom';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';

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
const { I18nProvider } = await import('@/lib/i18n');
const { CodeGraphPanel } = await import('./CodeGraphPanel');

const DIRECTORY = '/home/me/repo';

const indexPayload = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const graphForSubject = (subjectId: string, file = 'math.ts', line = 1) => ({
  subjectId,
  nodes: [
    { id: subjectId, kind: 'symbol', name: subjectId, file, line, subject: true },
    { id: 'fn:run@main.ts', kind: 'symbol', name: 'run', file: 'main.ts', line: 4 },
  ],
  edges: [{ id: 'e1', kind: 'CALLS_STATIC', from: 'fn:run@main.ts', to: subjectId, confidence: 1 }],
  truncated: false,
});

let container: HTMLElement;
let root: Root;
let restoreFetch = () => {};

const stubFetch = (handler: (url: URL) => Response | Promise<Response>): void => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, 'http://localhost');
    return handler(url);
  });
  restoreFetch = () => fetchSpy.mockRestore();
};

const stubFetchReal = stubFetch;

const json = (payload: unknown, status = 200): Response => Response.json(payload, { status });

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
};

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  restoreFetch();
});

const typeSearch = async (text: string): Promise<void> => {
  const input = container.querySelector('input');
  if (!input) throw new Error('Missing search input');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('Missing input setter');
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = container.querySelector('form');
  if (!form) throw new Error('Missing search form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
};

const setBox = async (text: string): Promise<void> => {
  const input = container.querySelector('input');
  if (!input) throw new Error('Missing search input');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('Missing input setter');
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {});
};

describe('code graph search honesty', () => {
  test('(a) an ambiguous query lists candidates with kind/path/line and draws no graph until one is chosen', async () => {
    const first = {
      id: 'const:d@one.ts', name: 'd', file: 'one.ts', line: 1,
      evidence: [{ edge: 'DEFINES', ref: 'one.ts:1', confidence: 1 }],
      confidence: 1, knowledgeIds: [], reason: 'exact-name', rank: 0,
    };
    const second = {
      id: 'const:d@two.ts', name: 'd', file: 'two.ts', line: 2,
      evidence: [{ edge: 'DEFINES', ref: 'two.ts:2', confidence: 1 }],
      confidence: 1, knowledgeIds: [], reason: 'exact-name', rank: 0,
    };
    stubFetchReal((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [first, second] });
      }
      if (url.searchParams.get('kind') === 'context') {
        const symbol = url.searchParams.get('symbol') ?? '';
        const file = symbol.includes('two') ? 'two.ts' : 'one.ts';
        const line = symbol.includes('two') ? 2 : 1;
        return json({
          ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [],
          items: [symbol.includes('two') ? second : first],
          definition: symbol.includes('two') ? second : first,
          callers: [], callees: [], graph: graphForSubject(symbol, file, line),
        });
      }
      if (url.searchParams.get('kind') === 'impact') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [], impacted: [] });
      }
      if (url.searchParams.get('kind') === 'tests') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [] });
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('d');

    const rows = [...container.querySelectorAll('li')].filter((entry) =>
      entry.textContent?.includes('one.ts') || entry.textContent?.includes('two.ts'));
    expect(rows.length).toBe(2);
    expect(container.textContent).toContain('one.ts:1');
    expect(container.textContent).toContain('two.ts:2');
    expect(container.querySelector('svg.dag-code-graph-canvas') === null).toBe(true);
    expect(container.textContent).not.toContain('Selected node');
    expect(container.textContent).not.toContain('Preview');

    const secondRow = rows.find((entry) => entry.textContent?.includes('two.ts:2'));
    const button = secondRow?.querySelector('button');
    if (!button) throw new Error('Missing second candidate row');
    await act(async () => { button.click(); });
    await act(async () => {});
    await act(async () => {});

    expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
    expect(container.textContent).toContain('const:d@two.ts');
  });

  test('(b) clearing the query removes the graph, the inspector and the peek', async () => {
    const definitionItem = {
      id: 'fn:add@math.ts', name: 'add', file: 'math.ts', line: 1,
      evidence: [{ edge: 'DEFINES', ref: 'math.ts:1', confidence: 1 }],
      confidence: 1, knowledgeIds: [], reason: 'exact-name', rank: 0,
    };
    stubFetchReal((url) => {
      if (url.pathname === '/api/fs/read') {
        return new Response('export const add = (a, b) => a + b;\n', { status: 200 });
      }
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [definitionItem] });
      }
      if (url.searchParams.get('kind') === 'context') {
        return json({
          ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [],
          items: [definitionItem], definition: definitionItem, callers: [], callees: [],
          graph: graphForSubject(definitionItem.id),
        });
      }
      if (url.searchParams.get('kind') === 'impact') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [], impacted: [] });
      }
      if (url.searchParams.get('kind') === 'tests') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [] });
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const button = row?.querySelector('button');
    if (!button) throw new Error('Missing search result for add');
    await act(async () => { button.click(); });
    await act(async () => {});
    await act(async () => {});

    expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
    expect(container.textContent).toContain('Selected node');

    const peekButton = container.querySelector('[data-testid="code-graph-peek-file"]');
    if (!peekButton) throw new Error('Missing peek action');
    await act(async () => { (peekButton as HTMLElement).click(); });
    await act(async () => {});
    await act(async () => {});
    expect(container.querySelector('[data-testid="code-graph-peek-text"]') !== null).toBe(true);

    await setBox('');
    expect(container.querySelector('svg.dag-code-graph-canvas') === null).toBe(true);
    expect(container.querySelector('[data-testid="code-graph-matches-heading"]') === null).toBe(true);
    expect(container.querySelectorAll('li').length).toBe(0);
    expect(container.textContent).not.toContain('Selected node');
    expect(container.textContent).not.toContain('Preview');
    expect(container.querySelector('[data-testid="code-graph-peek-text"]') === null).toBe(true);
  });

  test('(c) each result row shows its match reason', async () => {
    const exact = {
      id: 'fn:add@math.ts', name: 'add', file: 'math.ts', line: 1,
      evidence: [{ edge: 'DEFINES', ref: 'math.ts:1', confidence: 1 }],
      confidence: 1, knowledgeIds: [], reason: 'exact-name', rank: 0,
    };
    const prefixed = {
      id: 'fn:addExtra@math.ts', name: 'addExtra', file: 'math.ts', line: 9,
      evidence: [{ edge: 'DEFINES', ref: 'math.ts:9', confidence: 1 }],
      confidence: 1, knowledgeIds: [], reason: 'prefix', rank: 2,
    };
    stubFetchReal((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [exact, prefixed] });
      }
      if (url.searchParams.get('kind') === 'context') {
        const symbol = url.searchParams.get('symbol') ?? '';
        return json({
          ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [],
          items: [exact], definition: exact, callers: [], callees: [],
          graph: graphForSubject(symbol),
        });
      }
      if (url.searchParams.get('kind') === 'impact') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [], impacted: [] });
      }
      if (url.searchParams.get('kind') === 'tests') {
        return json({ ...indexPayload(), coverage: 'indexed', knowledgeIds: [], unresolved: [], unsupported: [], items: [] });
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');

    expect(container.querySelector('[data-testid="code-graph-match-reason-fn:add@math.ts"]')?.textContent).toBe('exact-name');
    expect(container.querySelector('[data-testid="code-graph-match-reason-fn:addExtra@math.ts"]')?.textContent).toBe('prefix');
  });
});
