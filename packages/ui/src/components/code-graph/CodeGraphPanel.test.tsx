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

// React resolves DOM globals at import time: these dynamic imports must come
// after the assignment above, or typing into controlled inputs never updates
// state (the value tracker binds the wrong constructor).
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
import type { Root } from 'react-dom/client';
import type {
  CodeGraphCompleteness,
  CodeGraphFreshness,
  CodeGraphItem,
  CodeGraphShownOf,
  CodeGraphTotals,
} from '@/lib/codeGraphApi';
import type { CodeGraphSubject } from '@/lib/codeGraphSubject';
const { I18nProvider } = await import('@/lib/i18n');
// The panel reads its opening subject from the workspace stores through
// this hook. Tests drive it through a global slot instead of standing up
// git state and editor tabs: unset means the module-map fallback, set means
// the resolver returned that subject and the panel must adopt it.
mock.module('@/lib/codeGraphSubject', () => ({
  resolveCodeGraphSubject: (input: { manual?: unknown }) => (
    input?.manual
      ? { source: 'manual', file: null, files: [], moduleMap: false, reason: 'explicit-selection' }
      : { source: 'module-map', file: null, files: [], moduleMap: false, reason: 'no-context' }
  ),
  useCodeGraphDefaultSubject: () => ({
    subject: globalThis.__codeGraphSubject ?? {
      source: 'module-map', file: null, files: [], moduleMap: false, reason: 'no-context',
    },
    loading: false,
  }),
}));
const { CodeGraphPanel } = await import('./CodeGraphPanel');

/**
 * Layout-only proof for the code-graph panel: every payload below is a
 * typed stub shaped like the real route envelope (the integration proof
 * that the shape is real lives in the server C20 test). What this file
 * proves is rendering — freshness, sections, and every explicit state —
 * through the actual fetch client. The toolbar surface is proved too: totals
 * from the answer, default-subject adoption, depth on the wire, and the
 * retired controls staying gone.
 */

const DIRECTORY = '/home/me/repo';

declare global {
  // The panel reads its opening subject from this slot (see the mock above):
  // a typed expando keeps the fixture contract visible without touching DOM wiring.
  var __codeGraphSubject: CodeGraphSubject | undefined;
}

interface IndexPayloadOverrides {
  freshness?: CodeGraphFreshness;
  staleReason?: string;
  refreshError?: string;
  nodeCount?: number;
  edgeCount?: number;
  revision?: string;
}

const indexPayload = (overrides: IndexPayloadOverrides = {}) => ({
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

const definitionItem = {
  id: 'fn:add@math.ts',
  name: 'add',
  file: 'math.ts',
  line: 1,
  evidence: [{ edge: 'DEFINES', ref: 'math.ts:1', confidence: 1 }],
  confidence: 1,
  knowledgeIds: ['pk-0123456789ab'],
};

const callerItem = {
  id: 'fn:run@main.ts',
  name: 'run',
  file: 'main.ts',
  line: 4,
  evidence: [{ edge: 'CALLS_STATIC', ref: 'main.ts:4', confidence: 1 }],
  confidence: 1,
  knowledgeIds: [],
};

const searchPayload = {
  ...indexPayload(),
  coverage: 'indexed',
  knowledgeIds: [],
  unresolved: [],
  unsupported: [],
  items: [definitionItem],
};

const contextPayload = {
  ...indexPayload(),
  coverage: 'indexed',
  knowledgeIds: ['pk-0123456789ab'],
  unresolved: [],
  unsupported: [],
  items: [definitionItem, callerItem],
  definition: definitionItem,
  callers: [callerItem],
  callees: [],
};

const graphForSubject = (subjectId: string, file = 'math.ts', line = 1) => ({
  subjectId,
  nodes: [
    { id: subjectId, kind: 'symbol', name: subjectId, file, line, subject: true },
    { id: 'fn:run@main.ts', kind: 'symbol', name: 'run', file: 'main.ts', line: 4 },
  ],
  edges: [{ id: 'e1', kind: 'CALLS_STATIC', from: 'fn:run@main.ts', to: subjectId, confidence: 1 }],
  truncated: false,
});

const impactPayload = {
  ...indexPayload(),
  coverage: 'indexed',
  knowledgeIds: [],
  unresolved: [],
  unsupported: [],
  items: [callerItem],
  impacted: [callerItem],
};

const testsPayload = {
  ...indexPayload(),
  coverage: 'indexed',
  knowledgeIds: [],
  unresolved: [],
  unsupported: [],
  items: [
    {
      id: 'fn:addsNumbers@math.test.ts',
      name: 'addsNumbers',
      file: 'math.test.ts',
      line: 7,
      evidence: [{ edge: 'TESTS', ref: 'math.test.ts:7', confidence: 0.9 }],
      confidence: 0.9,
      knowledgeIds: [],
    },
    {
      id: 'fn:handlesZero@math.test.ts',
      name: 'handlesZero',
      file: 'math.test.ts',
      line: 21,
      evidence: [{ edge: 'TESTS', ref: 'math.test.ts:21', confidence: 0.85 }],
      confidence: 0.85,
      knowledgeIds: [],
    },
    {
      id: 'fn:runsThroughMain@main.test.ts',
      name: 'runsThroughMain',
      file: 'main.test.ts',
      line: 3,
      evidence: [{ edge: 'TESTS', ref: 'main.test.ts:3', confidence: 0.8 }],
      confidence: 0.8,
      knowledgeIds: [],
    },
  ],
};

const graphTopology = {
  subjectId: 'fn:add@math.ts',
  nodes: [
    { id: 'fn:add@math.ts', kind: 'symbol', name: 'add', file: 'math.ts', line: 1, subject: true },
    { id: 'fn:run@main.ts', kind: 'symbol', name: 'run', file: 'main.ts', line: 4 },
    { id: 'file:math.ts', kind: 'file', name: 'math.ts' },
  ],
  edges: [
    { id: 'calls', kind: 'CALLS_STATIC', from: 'fn:run@main.ts', to: 'fn:add@math.ts', confidence: 1 },
    { id: 'defines', kind: 'DEFINES', from: 'file:math.ts', to: 'fn:add@math.ts', confidence: 1 },
  ],
  truncated: false,
};

const contextWithGraph = { ...contextPayload, graph: graphTopology };
const fileWithGraph = {
  ...indexPayload(),
  coverage: 'indexed',
  knowledgeIds: [],
  unresolved: [],
  unsupported: [],
  items: [definitionItem, callerItem],
  graph: graphTopology,
};

let container: HTMLElement;
let root: Root;
let restoreFetch = () => {};
let requests: string[] = [];

const stubFetch = (handler: (url: URL) => Response | Promise<Response>): void => {
  requests = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, 'http://localhost');
    requests.push(`${url.pathname}${url.search}`);
    return handler(url);
  });
  restoreFetch = () => fetch.mockRestore();
};

const json = <Body,>(payload: Body, status = 200): Response => Response.json(payload, { status });

const resetCodeGraphState = async (): Promise<void> => {
  const { useUIStore } = await import('@/stores/useUIStore');
  useUIStore.setState({ codeGraphStateByDirectory: {} });
};

const render = async (
  directory: string | null = DIRECTORY,
  focusFile: string | null = null,
  savedState: { mode: string; query: string | null; selectedId: string | null } | null = null,
): Promise<void> => {
  await resetCodeGraphState();
  if (savedState && directory) {
    const { useUIStore } = await import('@/stores/useUIStore');
    useUIStore.setState({ codeGraphStateByDirectory: { [directory]: savedState } });
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <CodeGraphPanel directory={directory} focusFile={focusFile} />
      </I18nProvider>,
    );
  });
  await act(async () => {});
};

const rerender = async (directory: string | null, focusFile: string | null = null): Promise<void> => {
  await act(async () => {
    root.render(
      <I18nProvider>
        <CodeGraphPanel directory={directory} focusFile={focusFile} />
      </I18nProvider>,
    );
  });
  await act(async () => {});
};

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  restoreFetch();
  globalThis.__codeGraphSubject = undefined;
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

const clickButton = async (text: string): Promise<void> => {
  const found = [...container.querySelectorAll('button')].find((entry) => entry.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  await act(async () => { found.click(); });
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

const submitSearch = async (text: string): Promise<void> => {
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

const clickTestId = async (testId: string): Promise<void> => {
  const found = container.querySelector(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`Missing test id: ${testId}`);
  await act(async () => {
    // SAFETY: the helper threw unless the query hit, so the target exists; the click needs the element type.
    (found as HTMLElement).click();
  });
  await act(async () => {});
};

const clickById = async (id: string): Promise<void> => {
  const found = container.querySelector(`#${id}`);
  if (!found) throw new Error(`Missing id: ${id}`);
  await act(async () => {
    // SAFETY: the helper threw unless the query hit, so the target exists; the click needs the element type.
    (found as HTMLElement).click();
  });
  await act(async () => {});
};

describe('code graph panel', () => {
  test('renders freshness with counts and the revision it was read at', async () => {
    stubFetch(() => json(indexPayload()));

    await render();

    expect(container.textContent).toContain('Fresh');
    expect(container.textContent).toContain('3 / 2');
    expect(container.textContent).toContain('aaaaaaaa');
    expect(requests.some((entry) => entry.startsWith('/api/code-graph/index?'))).toBe(true);
  });

  test('searches and shows the definition, its callers, and change impact', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');

    expect(container.textContent).toContain('math.ts');
    const resultItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const result = resultItem?.querySelector('button');
    if (!result) throw new Error('Missing search result for add');
    await act(async () => { result.click(); });
    await act(async () => {});

    expect(container.textContent).toContain('Definition');
    expect(container.textContent).toContain('Callers');
    expect(container.textContent).toContain('Change impact');
    expect(container.textContent).toContain('main.ts:4');
    expect(container.textContent).toContain('pk-0123456789ab');
  });

  test('previews the first result and draws its interactive graph', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextWithGraph);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');

    expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
    expect(container.textContent).toContain('Preview');
    const nodes = [...container.querySelectorAll('button')].filter((entry) => entry.getAttribute('title')?.startsWith('fn:'));
    expect(nodes.length).toBe(2);
  });

  test('selecting a result draws its graph and node clicks update the inspector', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextWithGraph);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const resultItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const result = resultItem?.querySelector('button');
    if (!result) throw new Error('Missing search result for add');
    await act(async () => { result.click(); });
    await act(async () => {});

    expect(container.textContent).toContain('Selected node');
    expect(container.textContent).toContain('fn:add@math.ts');
    expect(container.textContent).not.toContain('Preview');
    const callerNode = [...container.querySelectorAll('button')].find(
      (entry) => entry.getAttribute('title') === 'fn:run@main.ts',
    );
    if (!callerNode) throw new Error('Missing caller graph node');
    await act(async () => {
      // SAFETY: the caller node was asserted present above; the click needs the element type.
      (callerNode as HTMLElement).click();
    });
    await act(async () => {});
    expect(container.textContent).toContain('fn:run@main.ts');
  });

  test('states explicitly when a result carries no graph topology', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const resultItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const result = resultItem?.querySelector('button');
    if (!result) throw new Error('Missing search result for add');
    await act(async () => { result.click(); });
    await act(async () => {});

    expect(container.textContent).toContain('No graph topology in this result.');
    expect(container.querySelector('svg.dag-code-graph-canvas') === null).toBe(true);
  });

  test('renders a file subject graph with its defining symbols', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') {
        return json({ ...searchPayload, items: [{ ...definitionItem, id: 'file:math.ts' }] });
      }
      if (url.searchParams.get('kind') === 'file') return json(fileWithGraph);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('math.ts');
    const resultItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('math.ts'));
    const result = resultItem?.querySelector('button');
    if (!result) throw new Error('Missing search result for math.ts');
    await act(async () => { result.click(); });
    await act(async () => {});

    expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
    expect(container.textContent).toContain('file:math.ts');
  });

  test('a new search clears the previous selection instead of mixing subjects', async () => {
    const contextFor = (symbol: string) => ({ ...contextPayload, graph: graphForSubject(symbol) });
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      const query = url.searchParams.get('q');
      const symbol = url.searchParams.get('symbol');
      if (query === 'add') return json(searchPayload);
      if (query === 'run') return json({ ...searchPayload, items: [callerItem] });
      if (symbol) return json(contextFor(symbol));
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const firstItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const first = firstItem?.querySelector('button');
    if (!first) throw new Error('Missing search result for add');
    await act(async () => { first.click(); });
    await act(async () => {});
    expect(container.textContent).toContain('Selected node');

    await typeSearch('run');
    expect(container.textContent).not.toContain('Selected node');
    expect(container.textContent).not.toContain('fn:add@math.ts');
    expect(container.textContent).toContain('main.ts:4');
    expect(container.textContent).toContain('Preview');
    expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
  });

  test('an ambiguous name selects the exact clicked result', async () => {
    const otherItem = { ...definitionItem, id: 'fn:add@other.ts', file: 'other.ts', line: 9 };
    const definitionFor = (symbol: string) => (symbol.includes('other')
      ? { ...definitionItem, id: symbol, file: 'other.ts', line: 9 }
      : { ...definitionItem, id: symbol });
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json({ ...searchPayload, items: [definitionItem, otherItem] });
      if (url.searchParams.get('kind') === 'context') {
        const symbol = url.searchParams.get('symbol') ?? '';
        const file = symbol.includes('other') ? 'other.ts' : 'math.ts';
        const line = symbol.includes('other') ? 9 : 1;
        return json({ ...contextPayload, definition: definitionFor(symbol), graph: graphForSubject(symbol, file, line) });
      }
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const rows = [...container.querySelectorAll('li')];
    expect(rows.length).toBe(2);
    const second = rows[1].querySelector('button');
    if (!second) throw new Error('Missing second result');
    await act(async () => { second.click(); });
    await act(async () => {});
    const symbols = requests.filter((entry) => entry.includes('kind=context'));
    expect(symbols.some((entry) => entry.includes('symbol=fn%3Aadd%40other.ts') || entry.includes('fn:add@other.ts'))).toBe(true);
    expect(container.textContent).toContain('other.ts:9');
  });

  test('a failed search clears stale results instead of keeping them', async () => {
    let failSearch = false;
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') {
        return failSearch ? json({ error: 'engine exploded' }, 500) : json(searchPayload);
      }
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    expect(container.textContent).toContain('math.ts');
    failSearch = true;
    await typeSearch('add');
    expect(container.textContent).toContain('engine exploded');
    expect(container.textContent).not.toContain('Selected node');
    expect(container.textContent).not.toContain('Definition');
    expect(container.querySelectorAll('li').length).toBe(0);
  });

  test('renders the stale state with its reason and a refresh action', async () => {
    stubFetch(() => json(indexPayload({
      freshness: 'stale',
      staleReason: 'HEAD-MOVE',
      refreshError: 'engine exploded',
    })));

    await render();

    expect(container.textContent).toContain('Stale');
    expect(container.textContent).toContain('HEAD-MOVE');
    expect(container.textContent).toContain('engine exploded');
    await clickButton('Refresh');
    expect(requests.filter((entry) => entry.includes('refresh=1')).length).toBeGreaterThan(0);
  });

  test('shows the backend failure with a retry instead of a fake empty list', async () => {
    let calls = 0;
    stubFetch((url) => {
      if (!url.pathname.startsWith('/api/code-graph/')) return json({});
      calls += 1;
      return calls === 1 ? json({ error: 'engine exploded' }, 500) : json(indexPayload());
    });

    await render();

    expect(container.textContent).toContain('Could not load the code graph.');
    expect(container.textContent).toContain('engine exploded');
    expect(container.textContent).not.toContain('No symbols found.');
    await clickButton('Try again');
    expect(container.textContent).toContain('Fresh');
  });

  test('renders empty, unknown, and unsupported states distinctly', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      const query = url.searchParams.get('q');
      if (query === 'nothing-here') return json({ ...searchPayload, items: [] });
      if (query === 'gone.ts') {
        return json({ ...searchPayload, items: [], coverage: 'unindexed', unsupported: ['unsupported file type: gone.ts is unindexed (never analyzed)'] });
      }
      return json({ ...searchPayload, items: [], coverage: 'unindexed', unresolved: ['no definition for fn:gone@x.ts in this snapshot'] });
    });

    await render();
    await typeSearch('nothing-here');
    expect(container.textContent).toContain('No symbols found.');

    await typeSearch('fn:gone@x.ts');
    expect(container.textContent).toContain('No definition in this snapshot.');

    await typeSearch('gone.ts');
    expect(container.textContent).toContain('This file type is not indexed.');
  });

  test('a directory switch reloads and never shows the previous project', async () => {
    stubFetch(() => json(indexPayload()));

    await render('/home/me/repo');
    expect(container.textContent).toContain('Fresh');
    await act(async () => { root.unmount(); });
    container.remove();
    await render('/home/me/other');
    await act(async () => {});

    const directories = requests.map((entry) => new URL(entry, 'http://localhost').searchParams.get('directory'));
    expect(directories).toContain('/home/me/repo');
    expect(directories).toContain('/home/me/other');
  });

  test('(a) typing without submit keeps the committed subject; an empty submit resets everything', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextWithGraph);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);

    await setBox('addx');
    expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
    const heading = container.querySelector('[data-testid="code-graph-matches-heading"]');
    expect(heading?.textContent).toContain('"add"');
    expect(heading?.textContent).not.toContain('"addx"');

    // Search now lives in the toolbar: typing alone never touches the panel,
    // and only submitting an empty query clears the committed answer.
    await typeSearch('');
    expect(container.querySelector('svg.dag-code-graph-canvas') === null).toBe(true);
    expect(container.querySelector('[data-testid="code-graph-matches-heading"]') === null).toBe(true);
    expect(container.querySelectorAll('li').length).toBe(0);
    expect(container.textContent).not.toContain('Selected node');
    expect(container.textContent).not.toContain('Preview');
  });

  test('(b) typing without submit keeps the committed label and never marks results stale', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextWithGraph);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const headingText = (): string =>
      container.querySelector('[data-testid="code-graph-matches-heading"]')?.textContent ?? '';
    expect(headingText()).toContain('"add"');
    expect(headingText()).not.toContain('earlier search');

    // The toolbar owns the text field, so an unsubmitted edit never reaches
    // the panel: the committed label stands and no stale mark appears.
    await setBox('add and more');
    expect(headingText()).toContain('"add"');
    expect(headingText()).not.toContain('These results belong to an earlier search.');
    expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
  });

  test('(c) a directory switch mid-search leaves no spinner and no old rows', async () => {
    const DIR_B = '/home/me/other';
    let releaseSearch: ((value: Response) => void) | null = null;
    stubFetch((url) => {
      const dir = url.searchParams.get('directory');
      if (url.pathname === '/api/code-graph/index') {
        return dir === DIR_B
          ? json(indexPayload({ nodeCount: 31, edgeCount: 41, revision: 'c'.repeat(40) }))
          : json(indexPayload());
      }
      if (url.searchParams.get('kind') === 'search' && dir === DIRECTORY) {
        return new Promise<Response>((resolve) => { releaseSearch = resolve; });
      }
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render(DIRECTORY);
    await submitSearch('add');
    expect(requests.some((entry) => entry.includes('kind=search'))).toBe(true);
    expect(releaseSearch === null).toBe(false);

    await rerender(DIR_B);
    releaseSearch!(json(searchPayload));
    await act(async () => {});
    await act(async () => {});

    expect(container.querySelector('[data-spinner]') === null).toBe(true);
    expect(container.querySelectorAll('li').length).toBe(0);
    expect(container.querySelector('svg.dag-code-graph-canvas') === null).toBe(true);
    expect(container.textContent).toContain('31 / 41');
    expect(container.textContent).not.toContain('math.ts:4');
  });

  test('(d) a directory switch issues no request carrying the previous directory', async () => {
    const DIR_B = '/home/me/other';
    let releaseSearch: ((value: Response) => void) | null = null;
    stubFetch((url) => {
      const dir = url.searchParams.get('directory');
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search' && dir === DIRECTORY) {
        return new Promise<Response>((resolve) => { releaseSearch = resolve; });
      }
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render(DIRECTORY);
    await submitSearch('add');
    const atSwitch = requests.length;
    expect(atSwitch).toBeGreaterThan(0);

    await rerender(DIR_B);
    releaseSearch!(json(searchPayload));
    await act(async () => {});
    await act(async () => {});

    const tail = requests.slice(atSwitch);
    expect(tail.length).toBeGreaterThan(0);
    for (const entry of tail) {
      expect(new URL(entry, 'http://localhost').searchParams.get('directory')).toBe(DIR_B);
    }
  });

  test('(e) explore mode fetches modules once per directory and surfaces failure', async () => {
    let failExplore = false;
    const explorePayload = {
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
      modules: [
        { name: 'src', fileCount: 2, testFileCount: 0, symbolCount: 5, edgeCount: 4, sampleSymbols: [] },
      ],
    };
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'explore') {
        return failExplore ? json({ error: 'engine exploded' }, 500) : json(explorePayload);
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await clickById('code-graph-mode-explore');
    await act(async () => {});
    await act(async () => {});
    const exploreRequests = requests.filter((entry) => {
      const url = new URL(entry, 'http://localhost');
      return url.searchParams.get('kind') === 'explore' && url.searchParams.get('directory') === DIRECTORY;
    });
    expect(exploreRequests.length).toBe(1);
    expect(container.textContent).toContain('src');

    failExplore = true;
    await clickButton('Refresh');
    await act(async () => {});
    await act(async () => {});
    expect(container.textContent).toContain('engine exploded');
    expect(container.textContent).not.toContain('No indexed files to group.');
  });

  test('(f) tracing from the selection requests kind=trace with from and to', async () => {
    const trailPayload = {
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
      path: [{ from: 'fn:add@math.ts', to: 'fn:run@main.ts', ref: 'main.ts:4', confidence: 1 }],
    };
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      const kind = url.searchParams.get('kind');
      if (kind === 'search') return json(searchPayload);
      if (kind === 'context') return json(contextWithGraph);
      if (kind === 'impact') return json(impactPayload);
      if (kind === 'tests') return json(testsPayload);
      if (kind === 'trace') return json(trailPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const resultItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const result = resultItem?.querySelector('button');
    if (!result) throw new Error('Missing search result for add');
    await act(async () => { result.click(); });
    await act(async () => {});
    await act(async () => {});

    await clickTestId('code-graph-trace-to-fn:run@main.ts');
    await act(async () => {});
    await act(async () => {});

    const traceRequests = requests.filter(
      (entry) => new URL(entry, 'http://localhost').searchParams.get('kind') === 'trace',
    );
    expect(traceRequests.length).toBe(1);
    const traceUrl = new URL(traceRequests[0], 'http://localhost');
    expect(traceUrl.searchParams.get('from')).toBe('fn:add@math.ts');
    expect(traceUrl.searchParams.get('to')).toBe('fn:run@main.ts');
    expect(container.textContent).toContain('main.ts:4');
  });

  test('(g) peeking reads the selected file and renders its text or the error', async () => {
    let failRead = false;
    stubFetch((url) => {
      if (url.pathname === '/api/fs/read') {
        return failRead
          ? json({ error: 'disk gone' }, 500)
          : new Response('export const add = (a, b) => a + b;\n', { status: 200 });
      }
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      const kind = url.searchParams.get('kind');
      if (kind === 'search') return json(searchPayload);
      if (kind === 'context') return json(contextWithGraph);
      if (kind === 'impact') return json(impactPayload);
      if (kind === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const resultItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const result = resultItem?.querySelector('button');
    if (!result) throw new Error('Missing search result for add');
    await act(async () => { result.click(); });
    await act(async () => {});
    await act(async () => {});

    await clickTestId('code-graph-peek-file');
    await act(async () => {});
    await act(async () => {});
    const readRequests = requests.filter(
      (entry) => new URL(entry, 'http://localhost').pathname === '/api/fs/read',
    );
    expect(readRequests.length).toBe(1);
    const readUrl = new URL(readRequests[0], 'http://localhost');
    // Live defect this assertion used to encode: a repo-relative path made
    // /api/fs/read answer "Path is outside of active workspace", so peek now
    // sends the project-absolute path every other caller sends.
    expect(readUrl.searchParams.get('path')).toBe(`${DIRECTORY}/math.ts`);
    expect(readUrl.searchParams.get('directory')).toBe(DIRECTORY);
    expect(container.textContent).toContain('export const add');

    failRead = true;
    await clickTestId('code-graph-peek-file');
    await act(async () => {});
    await act(async () => {});
    expect(container.textContent).toContain('Failed to read math.ts');
  });

  test('(h) an answer revision different from the index revision renders stale', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json({ ...searchPayload, revision: 'b'.repeat(40) });
      if (url.searchParams.get('kind') === 'context') return json({ ...contextPayload, revision: 'b'.repeat(40) });
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    expect(container.textContent).toContain('Stale');
    expect(container.textContent).toContain('bbbbbbbb');
    expect(container.textContent).not.toContain('Fresh');
  });

  test('(i) the focusFile effect does not cancel the index load', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'file') return json(fileWithGraph);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render(DIRECTORY, 'math.ts');
    expect(container.textContent).toContain('Fresh');
    expect(container.textContent).toContain('3 / 2');
    expect(container.querySelector('[data-spinner]') === null).toBe(true);
  });

  test('the dockable workspace keeps one canvas and adds the inspector column once a subject is open', async () => {
    const originalObserver = globalThis.ResizeObserver;
    let resize: ((width: number) => void) | null = null;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = (width: number) => {
          // SAFETY: the panel reads only contentRect.width from the entry and
          // only observe/disconnect from the instance; the fake covers exactly that.
          callback([{ contentRect: { width } }] as ResizeObserverEntry[], this);
        };
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver;
    try {
      stubFetch((url) => {
        if (url.pathname === '/api/code-graph/index') return json(indexPayload());
        if (url.searchParams.get('q') === 'add') return json(searchPayload);
        if (url.searchParams.get('symbol')) return json({ ...contextPayload, graph: graphForSubject(String(url.searchParams.get('symbol'))) });
        if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
        if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
        return json({ error: 'unexpected' }, 500);
      });

      await render();
      await act(async () => { resize?.(1200); });
      expect(container.querySelector('[data-testid="code-graph-regions"]')?.getAttribute('data-regions')).toBe('three');

      await typeSearch('add');
      const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
      const button = row?.querySelector('button');
      if (!button) throw new Error('Missing search result for add');
      await act(async () => { button.click(); });
      await act(async () => {});

      expect(container.querySelectorAll('svg.dag-code-graph-canvas').length).toBe(1);
      expect(container.querySelector('[data-region="explorer"]') !== null).toBe(true);
      expect(container.querySelector('[data-region="graph"]') !== null).toBe(true);
      const inspector = container.querySelector('[data-region="inspector"]');
      expect(inspector !== null).toBe(true);
      expect(inspector?.querySelector('details')?.hasAttribute('open')).toBe(true);
      expect(inspector?.querySelector('[role="separator"]') !== null).toBe(true);
    } finally {
      globalThis.ResizeObserver = originalObserver;
    }
  });

  test('a narrow rail keeps the inspector collapsed and still draws one canvas', async () => {
    const originalObserver = globalThis.ResizeObserver;
    let resize: ((width: number) => void) | null = null;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = (width: number) => {
          // SAFETY: the panel reads only contentRect.width from the entry and
          // only observe/disconnect from the instance; the fake covers exactly that.
          callback([{ contentRect: { width } }] as ResizeObserverEntry[], this);
        };
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver;
    try {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('q') === 'add') return json(searchPayload);
      if (url.searchParams.get('symbol')) return json({ ...contextPayload, graph: graphForSubject(String(url.searchParams.get('symbol'))) });
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const button = row?.querySelector('button');
    if (!button) throw new Error('Missing search result for add');
    await act(async () => { button.click(); });
    await act(async () => {});

    await act(async () => { resize?.(420); });
    expect(container.querySelector('[data-testid="code-graph-regions"]')?.getAttribute('data-regions')).toBe('stacked');
    const inspector = container.querySelector('[data-region="inspector"]');
    expect(inspector?.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(inspector?.querySelector('[role="separator"]')).toBeNull();
    expect(container.querySelectorAll('svg.dag-code-graph-canvas').length).toBe(1);
    } finally {
      globalThis.ResizeObserver = originalObserver;
    }
  });

  test('the inspector disclosure opens and closes by user action in the narrow rail', async () => {
    const originalObserver = globalThis.ResizeObserver;
    let resize: ((width: number) => void) | null = null;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = (width: number) => {
          // SAFETY: the panel reads only contentRect.width from the entry and
          // only observe/disconnect from the instance; the fake covers exactly that.
          callback([{ contentRect: { width } }] as ResizeObserverEntry[], this);
        };
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver;
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('q') === 'add') return json(searchPayload);
      if (url.searchParams.get('symbol')) return json({ ...contextPayload, graph: graphForSubject(String(url.searchParams.get('symbol'))) });
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });
    try {
      await render();
      await act(async () => { resize?.(420); });
      await typeSearch('add');
      const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
      const button = row?.querySelector('button');
      if (!button) throw new Error('Missing search result for add');
      await act(async () => { button.click(); });
      await act(async () => {});

      const details = container.querySelector('[data-region="inspector"] details');
      if (!details) throw new Error('Missing inspector disclosure');
      expect(details.hasAttribute('open')).toBe(false);

      const summary = container.querySelector('[data-testid="code-graph-inspector-toggle"]');
      if (!summary) throw new Error('Missing inspector summary');
      // A summary click is the user's own gesture; the controlled prop must not
      // fight the toggle it produces.
      await act(async () => {
        // SAFETY: the summary was asserted present above; a click is the user's own gesture.
        (summary as HTMLElement).click();
      });
      expect(details.hasAttribute('open')).toBe(true);
      await act(async () => {});
      expect(details.hasAttribute('open')).toBe(true);

      await act(async () => {
        // SAFETY: the summary was asserted present above; a click is the user's own gesture.
        (summary as HTMLElement).click();
      });
      expect(details.hasAttribute('open')).toBe(false);
    } finally {
      globalThis.ResizeObserver = originalObserver;
    }
  });

  test('the open-source action activates the selected file at its line', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('q') === 'add') return json(searchPayload);
      if (url.searchParams.get('symbol')) return json({ ...contextPayload, graph: graphForSubject(String(url.searchParams.get('symbol'))) });
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });
    const { useUIStore } = await import('@/stores/useUIStore');
    const openSpy = spyOn(useUIStore.getState(), 'openContextFileAtLine').mockImplementation(() => {});
    try {
      await render();
      await typeSearch('add');
      const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
      const button = row?.querySelector('button');
      if (!button) throw new Error('Missing search result for add');
      await act(async () => { button.click(); });
      await act(async () => {});

      const openSource = container.querySelector('[data-testid="code-graph-open-source"]');
      if (!openSource) throw new Error('Missing open-source action');
      await act(async () => {
        // SAFETY: the action was asserted present above; it is the panel's own open button.
        (openSource as HTMLButtonElement).click();
      });
      expect(openSpy.mock.calls[0]).toEqual([DIRECTORY, DIRECTORY + '/math.ts', 1]);
    } finally {
      openSpy.mockRestore();
    }
  });

  test('open-source joins the snapshot root, not the workspace root', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json({ ...indexPayload(), snapshotRoot: `${DIRECTORY}/apps` });
      if (url.searchParams.get('q') === 'add') return json({ ...searchPayload, snapshotRoot: `${DIRECTORY}/apps` });
      if (url.searchParams.get('symbol')) return json({ ...contextPayload, snapshotRoot: `${DIRECTORY}/apps`, graph: graphForSubject(String(url.searchParams.get('symbol'))) });
      if (url.searchParams.get('kind') === 'impact') return json({ ...impactPayload, snapshotRoot: `${DIRECTORY}/apps` });
      if (url.searchParams.get('kind') === 'tests') return json({ ...testsPayload, snapshotRoot: `${DIRECTORY}/apps` });
      return json({ error: 'unexpected' }, 500);
    });
    const { useUIStore } = await import('@/stores/useUIStore');
    const openSpy = spyOn(useUIStore.getState(), 'openContextFileAtLine').mockImplementation(() => {});
    try {
      await render();
      await typeSearch('add');
      const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
      const button = row?.querySelector('button');
      if (!button) throw new Error('Missing search result for add');
      await act(async () => { button.click(); });
      await act(async () => {});
      const openSource = container.querySelector('[data-testid="code-graph-open-source"]');
      if (!openSource) throw new Error('Missing open-source action');
      await act(async () => {
        // SAFETY: the action was asserted present above; it is the panel's own open button.
        (openSource as HTMLButtonElement).click();
      });
      expect(openSpy.mock.calls[0]).toEqual([DIRECTORY, `${DIRECTORY}/apps/math.ts`, 1]);
    } finally {
      openSpy.mockRestore();
    }
  });

  test('an answer whose snapshot root escapes the project is refused, not opened', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('q') === 'add') return json(searchPayload);
      if (url.searchParams.get('symbol')) return json({ ...contextPayload, snapshotRoot: '/elsewhere/apps', graph: graphForSubject(String(url.searchParams.get('symbol'))) });
      if (url.searchParams.get('kind') === 'impact') return json({ ...impactPayload, snapshotRoot: '/elsewhere/apps' });
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });
    const { useUIStore } = await import('@/stores/useUIStore');
    const openSpy = spyOn(useUIStore.getState(), 'openContextFileAtLine').mockImplementation(() => {});
    try {
      await render();
      await typeSearch('add');
      const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
      const button = row?.querySelector('button');
      if (!button) throw new Error('Missing search result for add');
      await act(async () => { button.click(); });
      await act(async () => {});
      const openSource = container.querySelector('[data-testid="code-graph-open-source"]');
      if (!openSource) throw new Error('Missing open-source action');
      await act(async () => {
        // SAFETY: the action was asserted present above; it is the panel's own open button.
        (openSource as HTMLButtonElement).click();
      });
      expect(openSpy.mock.calls.length).toBe(0);
      expect(container.querySelector('[data-testid="code-graph-source-error"]')?.textContent ?? '').toContain('outside-project');
    } finally {
      openSpy.mockRestore();
    }
  });

  test('the workspace never renders a dialog or a modal backdrop', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('q') === 'add') return json(searchPayload);
      if (url.searchParams.get('symbol')) return json({ ...contextPayload, graph: graphForSubject(String(url.searchParams.get('symbol'))) });
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-radix-portal]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('code graph restore and impact classification', () => {
  const stubSubjectFetch = () => stubFetch((url) => {
    if (url.pathname === '/api/code-graph/index') return json(indexPayload());
    if (url.searchParams.get('kind') === 'search') return json(searchPayload);
    if (url.searchParams.get('kind') === 'context') return json(contextPayload);
    if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
    if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
    return json({ error: 'unexpected' }, 500);
  });

  test('restores the saved query and subject for this project', async () => {
    stubSubjectFetch();
    await render(DIRECTORY, null, { mode: 'explore', query: 'add', selectedId: definitionItem.id });
    await act(async () => {});
    await act(async () => {});

    expect(requests.some((entry) => entry.includes('kind=search') && entry.includes('q=add'))).toBe(true);
    expect(requests.some((entry) => entry.includes('kind=context') && entry.includes(encodeURIComponent(definitionItem.id)))).toBe(true);
  });

  test('drops a saved subject the snapshot no longer contains', async () => {
    stubSubjectFetch();
    await render(DIRECTORY, null, { mode: 'explore', query: 'add', selectedId: 'fn:gone@math.ts' });
    await act(async () => {});
    await act(async () => {});

    expect(requests.some((entry) => entry.includes('kind=search'))).toBe(true);
    expect(requests.some((entry) => entry.includes('symbol=fn%3Agone%40math.ts'))).toBe(false);
    expect(container.textContent).not.toContain('Selected nodeSymbol');
  });

  test('separates graph-confirmed impact rows from inferred ones', async () => {
    const inferred = { ...callerItem, id: 'fn:maybeCaller@main.ts', evidence: [], confidence: 0.4 };
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json({ ...impactPayload, impacted: [callerItem, inferred] });
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const result = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'))?.querySelector('button');
    if (!result) throw new Error('Missing search result for add');
    await act(async () => { result.click(); });
    await act(async () => {});

    const confirmed = container.querySelector('[data-testid="code-graph-impact-confirmed"]');
    const inferredGroup = container.querySelector('[data-testid="code-graph-impact-inferred"]');
    expect(confirmed?.textContent).toContain('CALLS_STATIC');
    expect(inferredGroup?.textContent).toContain('run');
    expect(inferredGroup?.textContent).toContain('—');
    expect(confirmed?.textContent).toContain('Graph-confirmed');
    expect(inferredGroup?.textContent).toContain('Inferred');
  });
});

describe('code graph toolbar wiring', () => {
  test('the toolbar receives totals from the active answer', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') {
        return json({ ...contextWithGraph, totals: { displayed: 3, known: 47, hidden: 44 } });
      }
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');
    const resultItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const result = resultItem?.querySelector('button');
    if (!result) throw new Error('Missing search result for add');
    await act(async () => { result.click(); });
    await act(async () => {});

    // The detail graph draws 3 nodes of a known 47: the toolbar renders the
    // server total, never the shortened list length, and no completeness
    // chip appears for an answer that reports none.
    expect(container.querySelector('[data-testid="code-graph-totals"]')?.textContent).toContain('3 of 47');
    expect(container.querySelector('[data-testid="code-graph-completeness"]') === null).toBe(true);
  });

  test('a mount with no explicit selection adopts the active-file subject', async () => {
    globalThis.__codeGraphSubject = {
      source: 'active-file', file: 'math.ts', files: [], moduleMap: false, reason: 'active-editor',
    };
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'file') return json(fileWithGraph);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await act(async () => {});
    await act(async () => {});

    const fileRequests = requests.filter(
      (entry) => new URL(entry, 'http://localhost').searchParams.get('kind') === 'file',
    );
    expect(fileRequests.length).toBe(1);
    const fileUrl = new URL(fileRequests[0], 'http://localhost');
    expect(fileUrl.searchParams.get('file')).toBe('math.ts');
    expect(fileUrl.searchParams.get('depth')).toBe('1');
    expect(container.querySelector('[data-testid="code-graph-subject"]')?.textContent).toContain('math.ts');
  });

  test('depth 2 sends depth=2 to the API on every subject query', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextWithGraph);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    expect(container.querySelector('[data-testid="code-graph-depth-1"]')?.getAttribute('aria-pressed')).toBe('true');
    await typeSearch('add');
    const resultItem = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const result = resultItem?.querySelector('button');
    if (!result) throw new Error('Missing search result for add');
    await act(async () => { result.click(); });
    await act(async () => {});

    await clickTestId('code-graph-depth-2');
    await act(async () => {});

    const depths = requests
      .filter((entry) => new URL(entry, 'http://localhost').searchParams.get('kind') === 'context')
      .map((entry) => new URL(entry, 'http://localhost').searchParams.get('depth'));
    // The single-hit preview fetches at the default depth; the explicit
    // depth change refetches the same subject at depth 2.
    expect(depths).toContain('1');
    expect(depths).toContain('2');
    expect(depths[depths.length - 1]).toBe('2');
  });

  test('the retired controls are gone and matches keep exactly one heading', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') return json(searchPayload);
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');

    expect(container.querySelector('[data-testid="code-graph-toolbar"]') !== null).toBe(true);
    expect(container.querySelector('select') === null).toBe(true);
    expect(container.querySelector('.code-graph-kind-symbols') === null).toBe(true);
    expect(container.querySelector('.code-graph-kind-files') === null).toBe(true);
    expect(container.querySelectorAll('[data-testid="code-graph-matches-heading"]').length).toBe(1);
  });
});

describe('code graph selection inspector', () => {
  const stubSelectionFetch = () => stubFetch((url) => {
    if (url.pathname === '/api/code-graph/index') return json(indexPayload());
    if (url.searchParams.get('kind') === 'search') return json(searchPayload);
    if (url.searchParams.get('kind') === 'context') return json(contextWithGraph);
    if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
    if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
    return json({ error: 'unexpected' }, 500);
  });

  const selectAdd = async (): Promise<void> => {
    await typeSearch('add');
    const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const button = row?.querySelector('button');
    if (!button) throw new Error('Missing search result for add');
    await act(async () => { button.click(); });
    await act(async () => {});
  };

  const renderAtWidth = async (width: number): Promise<() => void> => {
    const originalObserver = globalThis.ResizeObserver;
    let resize: ((next: number) => void) | null = null;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = (next: number) => {
          // SAFETY: the panel reads only contentRect.width from the entry and
          // only observe/disconnect from the instance; the fake covers exactly that.
          callback([{ contentRect: { width: next } }] as ResizeObserverEntry[], this);
        };
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver;
    await render();
    await act(async () => { resize?.(width); });
    return () => { globalThis.ResizeObserver = originalObserver; };
  };

  const pressEscape = async (): Promise<void> => {
    const KeyboardEventCtor = window.KeyboardEvent;
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEventCtor('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(async () => {});
  };

  test('clicking a node opens the inspector with its path:line', async () => {
    stubSelectionFetch();
    const restore = await renderAtWidth(1200);
    try {
      await selectAdd();

      const inspector = container.querySelector('[data-region="inspector"]');
      expect(inspector !== null).toBe(true);
      expect(inspector?.getAttribute('data-inspector-layout')).toBe('split');
      expect(inspector?.textContent).toContain('math.ts:1');
      expect(container.querySelector('[data-testid="code-graph-inspector-node"]') !== null).toBe(true);
    } finally {
      restore();
    }
  });

  test('pressing Escape closes the inspector but keeps the subject graph', async () => {
    stubSelectionFetch();
    const restore = await renderAtWidth(1200);
    try {
      await selectAdd();
      expect(container.querySelector('[data-region="inspector"]') !== null).toBe(true);

      await pressEscape();

      expect(container.querySelector('[data-region="inspector"]') === null).toBe(true);
      expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
    } finally {
      restore();
    }
  });

  test('clicking empty canvas clears the selection', async () => {
    stubSelectionFetch();
    const restore = await renderAtWidth(1200);
    try {
      await selectAdd();
      expect(container.querySelector('[data-region="inspector"]') !== null).toBe(true);

      const wrap = container.querySelector('[data-testid="code-graph-canvas-wrap"]');
      if (!wrap) throw new Error('Missing canvas wrap');
      await act(async () => { wrap.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await act(async () => {});

      expect(container.querySelector('[data-region="inspector"]') === null).toBe(true);
      expect(container.querySelector('svg.dag-code-graph-canvas') !== null).toBe(true);
    } finally {
      restore();
    }
  });

  test('clicking an edge shows the edge evidence', async () => {
    stubSelectionFetch();
    const restore = await renderAtWidth(1200);
    try {
      await selectAdd();

      const title = [...container.querySelectorAll('svg path title')]
        .find((entry) => entry.textContent?.includes('CALLS_STATIC'));
      if (!title) throw new Error('Missing CALLS_STATIC edge');
      const edgePath = title.parentElement;
      if (!edgePath) throw new Error('Missing edge path');
      await act(async () => { edgePath.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await act(async () => {});

      const edgeView = container.querySelector('[data-testid="code-graph-inspector-edge"]');
      expect(edgeView !== null).toBe(true);
      expect(edgeView?.textContent).toContain('CALLS_STATIC');
      expect(edgeView?.textContent).toContain('1.00');
      expect(edgeView?.textContent).toContain('fn:run@main.ts');
    } finally {
      restore();
    }
  });

  test('a partial answer renders the coverage banner with its reason', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') {
        return json({ ...searchPayload, completeness: 'partial', completenessReason: 'result-limit', totals: { displayed: 1, known: 47, hidden: 46 } });
      }
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');

    const banner = container.querySelector('[data-testid="code-graph-coverage-banner"]');
    expect(banner !== null).toBe(true);
    // The reason is rendered as translated copy, never as the wire enum: a reader must not
    // meet "result-limit". The English catalogue value is asserted here; other locales are
    // covered by the i18n parity suite.
    expect(banner?.textContent ?? '').not.toContain('result-limit');
    expect(banner?.textContent).toContain('more exist beyond the limit');
    expect(banner?.textContent).toContain('1 of 47');
    // The banner is scoped to the answer's graph region, never a global claim.
    expect(container.querySelector('[data-region="graph"] [data-testid="code-graph-coverage-banner"]') !== null).toBe(true);
  });

  test('a complete answer renders no coverage banner', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'search') {
        return json({ ...searchPayload, completeness: 'complete', totals: { displayed: 1, known: 1, hidden: 0 } });
      }
      if (url.searchParams.get('kind') === 'context') return json(contextPayload);
      if (url.searchParams.get('kind') === 'impact') return json(impactPayload);
      if (url.searchParams.get('kind') === 'tests') return json(testsPayload);
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await typeSearch('add');

    expect(container.textContent).toContain('math.ts');
    expect(container.querySelector('[data-testid="code-graph-coverage-banner"]') === null).toBe(true);
  });

  test('the graph region renders the legend', async () => {
    stubSelectionFetch();
    await render();
    await selectAdd();

    expect(container.querySelector('[data-region="graph"] [data-testid="code-graph-legend-row-resolved"]') !== null).toBe(true);
    expect(container.querySelector('[data-region="graph"] [data-testid="code-graph-legend-row-unresolved"]') !== null).toBe(true);
    expect(container.textContent).toContain('Graph legend');
  });

  test('with the inspector closed the graph region keeps no reserved column', async () => {
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      if (url.searchParams.get('kind') === 'explore') {
        return json({
          ...indexPayload(),
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
    const restore = await renderAtWidth(1200);
    try {
      await act(async () => {});

      const regions = container.querySelector('[data-testid="code-graph-regions"]');
      expect(regions?.getAttribute('data-regions')).toBe('three');
      expect(container.querySelector('[data-region="inspector"]') === null).toBe(true);
      expect(regions?.children.length).toBe(2);
      expect(regions?.getAttribute('style') ?? '').not.toContain('300px');
    } finally {
      restore();
    }
  });

  test('below 900px the inspector is an overlay and the grid keeps two columns', async () => {
    stubSelectionFetch();
    const restore = await renderAtWidth(800);
    try {
      await selectAdd();

      const inspector = container.querySelector('[data-region="inspector"]');
      expect(inspector?.getAttribute('data-inspector-layout')).toBe('overlay');
      expect(container.querySelector('[data-testid="code-graph-inspector-backdrop"]') !== null).toBe(true);
      const regions = container.querySelector('[data-testid="code-graph-regions"]');
      expect(regions?.getAttribute('style') ?? '').not.toContain('300px');
      expect(inspector?.textContent).toContain('math.ts:1');
    } finally {
      restore();
    }
  });

  test('a panel that narrows under the split threshold takes the inspector off the canvas', async () => {
    stubSelectionFetch();
    const originalObserver = globalThis.ResizeObserver;
    let resize: ((width: number) => void) | null = null;
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = (width: number) => {
          // SAFETY: the panel reads only contentRect.width from the entry and
          // only observe/disconnect from the instance; the fake covers exactly that.
          callback([{ contentRect: { width } }] as ResizeObserverEntry[], this);
        };
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver;
    try {
      await render();
      await act(async () => { resize?.(1200); });
      await selectAdd();

      const wide = container.querySelector('[data-region="inspector"]');
      expect(wide?.getAttribute('data-inspector-layout')).toBe('split');
      const openDetails = (): Element | null | undefined =>
        container.querySelector('[data-testid="code-graph-inspector-toggle"]')?.closest('details');
      expect(openDetails()?.hasAttribute('open')).toBe(true);

      await act(async () => { resize?.(700); });

      const narrow = container.querySelector('[data-region="inspector"]');
      expect(narrow?.getAttribute('data-inspector-layout')).toBe('overlay');
      // The canvas keeps its drawing area; the overlay is opt-in from here.
      expect(openDetails()?.hasAttribute('open')).toBe(false);
    } finally {
      globalThis.ResizeObserver = originalObserver;
    }
  });
});

describe('code graph trace and impact answers', () => {
  interface TraceStepOverride {
    from: string;
    to: string;
    ref: string;
    confidence: number;
  }

  interface TraceSummaryOverride {
    found: boolean;
    hops: number | null;
    alternativePaths: null;
    reason?: string;
  }

  interface TracePayloadOverrides {
    path?: TraceStepOverride[];
    summary?: TraceSummaryOverride;
    totals?: CodeGraphTotals;
    completeness?: CodeGraphCompleteness;
    completenessReason?: string;
    unresolved?: string[];
  }

  interface ImpactSummaryOverride {
    dependentFiles: number;
    dependentSymbols: number;
    modules: Array<{ module: string; count: number }>;
    testsFound: number;
    callersWithoutTestPath: number;
    unresolvedEdges: number;
    completeness: CodeGraphCompleteness;
  }

  interface ImpactAnswerPayloadOverrides {
    items?: CodeGraphItem[];
    impacted?: CodeGraphItem[];
    shownOf?: CodeGraphShownOf;
    totals?: CodeGraphTotals;
    summary?: ImpactSummaryOverride;
  }

  const tracePayload = (overrides: TracePayloadOverrides = {}) => ({
    ...indexPayload(),
    coverage: 'indexed',
    knowledgeIds: [],
    unresolved: [],
    unsupported: [],
    items: [],
    completeness: 'complete',
    ...overrides,
  });

  const impactAnswerPayload = (overrides: ImpactAnswerPayloadOverrides = {}) => ({
    ...indexPayload(),
    coverage: 'indexed',
    knowledgeIds: [],
    unresolved: [],
    unsupported: [],
    items: [],
    impacted: [],
    completeness: 'complete',
    ...overrides,
  });

  const impactItem = (id: string, file: string, line: number) => ({
    id,
    name: id,
    file,
    line,
    evidence: [{ edge: 'CALLS_STATIC', ref: `${file}:${line}`, confidence: 1 }],
    confidence: 1,
    knowledgeIds: [],
  });

  const stubTraceSelection = (traceHandler: (url: URL) => Response): void => stubFetch((url) => {
    if (url.pathname === '/api/code-graph/index') return json(indexPayload());
    const kind = url.searchParams.get('kind');
    if (kind === 'search') return json(searchPayload);
    if (kind === 'context') return json(contextWithGraph);
    if (kind === 'impact') return json(impactPayload);
    if (kind === 'tests') return json(testsPayload);
    if (kind === 'trace') return traceHandler(url);
    return json({ error: 'unexpected' }, 500);
  });

  const selectAdd = async (): Promise<void> => {
    await typeSearch('add');
    const row = [...container.querySelectorAll('li')].find((entry) => entry.textContent?.includes('add'));
    const button = row?.querySelector('button');
    if (!button) throw new Error('Missing search result for add');
    await act(async () => { button.click(); });
    await act(async () => {});
  };

  const traceRequests = (): URL[] => requests
    .map((entry) => new URL(entry, 'http://localhost'))
    .filter((url) => url.searchParams.get('kind') === 'trace');

  test('a trace with a known path renders the ordered steps and hops', async () => {
    stubTraceSelection(() => json(tracePayload({
      path: [
        { from: 'fn:add@math.ts', to: 'fn:mid@lib.ts', ref: 'lib.ts:2', confidence: 1 },
        { from: 'fn:mid@lib.ts', to: 'fn:run@main.ts', ref: 'main.ts:4', confidence: 0.9 },
      ],
      summary: { found: true, hops: 2, alternativePaths: null },
      totals: { displayed: 2, known: 2, hidden: 0 },
    })));

    await render();
    await selectAdd();

    // A is seeded from the current subject; the inspector action names B.
    expect(container.querySelector('[data-testid="code-graph-trace-from"]')?.textContent).toContain('fn:add@math.ts');
    await clickTestId('code-graph-trace-to-fn:run@main.ts');
    await act(async () => {});
    await act(async () => {});

    expect(traceRequests().length).toBe(1);
    const traceUrl = traceRequests()[0];
    expect(traceUrl.searchParams.get('from')).toBe('fn:add@math.ts');
    expect(traceUrl.searchParams.get('to')).toBe('fn:run@main.ts');
    expect(traceUrl.searchParams.get('depth')).toBe('1');
    expect(container.querySelector('[data-testid="code-graph-trace-to"]')?.textContent).toContain('fn:run@main.ts');

    const steps = container.querySelector('[data-testid="code-graph-trail-steps"]');
    expect(steps !== null).toBe(true);
    expect(steps?.textContent).toContain('fn:add@math.ts → fn:mid@lib.ts');
    expect(steps?.textContent).toContain('lib.ts:2');
    expect(steps?.textContent).toContain('fn:mid@lib.ts → fn:run@main.ts');
    expect(steps?.textContent).toContain('main.ts:4');
    expect(steps?.textContent).toContain('0.90');
    expect(container.querySelector('[data-testid="code-graph-trace-summary"]')?.textContent).toContain('true · 2');
    expect(container.querySelector('[data-testid="code-graph-trace-reason"]') === null).toBe(true);

    await clickTestId('code-graph-depth-2');
    await act(async () => {});
    await act(async () => {});
    const depths = traceRequests().map((url) => url.searchParams.get('depth'));
    expect(depths[depths.length - 1]).toBe('2');
  });

  test('a trace with found false renders the specific reason text', async () => {
    stubTraceSelection(() => json(tracePayload({
      path: [],
      summary: { found: false, hops: null, alternativePaths: null, reason: 'no-path-in-graph' },
      totals: { displayed: 0, known: 0, hidden: 0 },
      completeness: 'partial',
      completenessReason: 'index-excluded',
      unresolved: ['no static call path from fn:add@math.ts to fn:run@main.ts (never guessed)'],
    })));

    await render();
    await selectAdd();
    await clickTestId('code-graph-trace-to-fn:run@main.ts');
    await act(async () => {});
    await act(async () => {});

    expect(traceRequests().length).toBe(1);
    expect(container.querySelector('[data-testid="code-graph-trail-steps"]') === null).toBe(true);
    expect(container.querySelector('[data-testid="code-graph-trace-reason"]')?.textContent).toContain('no-path-in-graph');
    // The server reason is the answer: never a blank box.
    expect(container.querySelector('[data-testid="code-graph-trace-summary"]')?.textContent).toContain('false');
  });

  const stubImpactSelection = (impactHandler: (url: URL) => Response): void => stubFetch((url) => {
    if (url.pathname === '/api/code-graph/index') return json(indexPayload());
    const kind = url.searchParams.get('kind');
    if (kind === 'search') return json(searchPayload);
    if (kind === 'context') return json(contextWithGraph);
    if (kind === 'impact') return impactHandler(url);
    if (kind === 'tests') return json(testsPayload);
    return json({ error: 'unexpected' }, 500);
  });

  const impactSummary: ImpactSummaryOverride = {
    dependentFiles: 5,
    dependentSymbols: 20,
    modules: [{ module: 'src', count: 12 }],
    testsFound: 3,
    callersWithoutTestPath: 4,
    unresolvedEdges: 1,
    completeness: 'complete',
  };

  test('an impact answer with 47 known and 20 displayed renders showing 20 of 47', async () => {
    const impacted = [
      impactItem('fn:run@main.ts', 'main.ts', 4),
      impactItem('fn:other@main.ts', 'main.ts', 9),
      impactItem('fn:third@lib.ts', 'lib.ts', 3),
    ];
    stubImpactSelection(() => json(impactAnswerPayload({
      items: impacted,
      impacted,
      shownOf: { impacted: { shown: 20, total: 47 } },
      totals: { displayed: 20, known: 47, hidden: 27 },
      summary: impactSummary,
    })));

    await render();
    await selectAdd();
    await clickById('code-graph-mode-impact');
    await act(async () => {});
    await act(async () => {});

    // The aggregate renders the server summary verbatim, never a client total.
    const summary = container.querySelector('[data-testid="code-graph-impact-summary"]');
    expect(summary?.textContent).toContain('potential impact');
    expect(summary?.textContent).toContain('Related tests · 3');
    expect(summary?.textContent).toContain('Callers · 4');
    expect(summary?.textContent).toContain('src · 12');
    expect(summary?.textContent).toContain('Files · 5');
    expect(container.querySelector('[data-testid="code-graph-impact-totals"]')?.textContent).toContain('20 of 47');
  });

  test('an impact answer with known null renders the not-available text', async () => {
    const impacted = [
      impactItem('fn:run@main.ts', 'main.ts', 4),
      impactItem('fn:other@main.ts', 'main.ts', 9),
      impactItem('fn:third@lib.ts', 'lib.ts', 3),
    ];
    stubImpactSelection(() => json(impactAnswerPayload({
      items: impacted,
      impacted,
      totals: { displayed: 3, known: null, hidden: null },
      summary: impactSummary,
    })));

    await render();
    await selectAdd();
    await clickById('code-graph-mode-impact');
    await act(async () => {});
    await act(async () => {});

    expect(container.querySelector('[data-testid="code-graph-impact-totals"]')?.textContent).toContain('Total not available');
  });

  test('a change-set subject seeds file then impact queries plus an aggregate', async () => {
    globalThis.__codeGraphSubject = {
      source: 'changes', file: 'a.ts', files: ['a.ts', 'b.ts'], moduleMap: false, reason: 'working-changes',
    };
    const symA = impactItem('fn:one@a.ts', 'a.ts', 1);
    const symB = impactItem('fn:two@b.ts', 'b.ts', 2);
    const filePayload = (items: unknown[]) => ({
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items,
    });
    const emptyExplore = {
      ...indexPayload(),
      coverage: 'indexed',
      knowledgeIds: [],
      unresolved: [],
      unsupported: [],
      items: [],
      modules: [],
    };
    stubFetch((url) => {
      if (url.pathname === '/api/code-graph/index') return json(indexPayload());
      const kind = url.searchParams.get('kind');
      if (kind === 'explore') return json(emptyExplore);
      if (kind === 'file') {
        const file = url.searchParams.get('file');
        if (file === 'a.ts') return json(filePayload([symA]));
        if (file === 'b.ts') return json(filePayload([symB]));
        return json({ error: 'unexpected file' }, 500);
      }
      if (kind === 'impact') {
        const symbol = url.searchParams.get('symbol');
        if (symbol === 'fn:one@a.ts') {
          return json(impactAnswerPayload({
            items: [symA],
            impacted: [symA],
            shownOf: { impacted: { shown: 1, total: 1 } },
            totals: { displayed: 1, known: 1, hidden: 0 },
            summary: {
              dependentFiles: 2,
              dependentSymbols: 2,
              modules: [{ module: 'src', count: 2 }],
              testsFound: 2,
              callersWithoutTestPath: 1,
              unresolvedEdges: 0,
              completeness: 'complete',
            },
          }));
        }
        if (symbol === 'fn:two@b.ts') {
          return json(impactAnswerPayload({
            items: [symB],
            impacted: [symB],
            shownOf: { impacted: { shown: 1, total: 1 } },
            totals: { displayed: 1, known: 1, hidden: 0 },
            summary: {
              dependentFiles: 1,
              dependentSymbols: 1,
              modules: [{ module: 'lib', count: 1 }],
              testsFound: 9,
              callersWithoutTestPath: 8,
              unresolvedEdges: 0,
              completeness: 'complete',
            },
          }));
        }
        return json({ error: 'unexpected symbol' }, 500);
      }
      return json({ error: 'unexpected' }, 500);
    });

    await render();
    await act(async () => {});
    await act(async () => {});
    await clickById('code-graph-mode-impact');
    await act(async () => {});
    await act(async () => {});

    const fileRequests = requests.filter(
      (entry) => new URL(entry, 'http://localhost').searchParams.get('kind') === 'file',
    );
    expect(fileRequests.some((entry) => entry.includes('file=a.ts'))).toBe(true);
    expect(fileRequests.some((entry) => entry.includes('file=b.ts'))).toBe(true);
    const impactRequests = requests.filter(
      (entry) => new URL(entry, 'http://localhost').searchParams.get('kind') === 'impact',
    );
    expect(impactRequests.some((entry) => entry.includes('fn%3Aone%40a.ts') || entry.includes('fn:one@a.ts'))).toBe(true);
    expect(impactRequests.some((entry) => entry.includes('fn%3Atwo%40b.ts') || entry.includes('fn:two@b.ts'))).toBe(true);
    // The aggregate is the primary answer: its summary numbers, not the other's.
    const summary = container.querySelector('[data-testid="code-graph-impact-summary"]');
    expect(summary?.textContent).toContain('Related tests · 2');
    expect(summary?.textContent).toContain('Callers · 1');
    expect(summary?.textContent).not.toContain('Related tests · 9');
  });

  test('an impact answer with no test path says so without ever saying untested', async () => {
    const impacted = [impactItem('fn:run@main.ts', 'main.ts', 4)];
    stubImpactSelection(() => json(impactAnswerPayload({
      items: impacted,
      impacted,
      shownOf: { impacted: { shown: 1, total: 1 } },
      totals: { displayed: 1, known: 1, hidden: 0 },
      summary: {
        dependentFiles: 1,
        dependentSymbols: 1,
        modules: [{ module: 'src', count: 1 }],
        testsFound: 0,
        callersWithoutTestPath: 1,
        unresolvedEdges: 0,
        completeness: 'complete',
      },
    })));

    await render();
    await selectAdd();
    await clickById('code-graph-mode-impact');
    await act(async () => {});
    await act(async () => {});

    expect(container.textContent).toContain('No test path identified in the current graph');
    expect(container.textContent).not.toContain('Untested');
  });
});
