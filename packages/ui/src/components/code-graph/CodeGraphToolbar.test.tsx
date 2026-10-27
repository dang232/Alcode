import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'bun:test';

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
// after the assignment above.
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
import type { Root } from 'react-dom/client';
const { I18nProvider, useI18nStore } = await import('@/lib/i18n');
const { CodeGraphToolbar } = await import('./CodeGraphToolbar');
import type { CodeGraphToolbarProps } from './CodeGraphToolbar';

// SAFETY: the toolbar copy file is a flat string table; only string values are read.
const toolbarCopy = JSON.parse(readFileSync(
  'I:/migration/Alwork/.omo/evidence/alcode-adaptive-engine/i18n-keys-code-graph-toolbar.json',
  'utf8',
)) as Record<string, string>;

let root: Root | null = null;
let container: HTMLDivElement;

const baseProps = (overrides: Partial<CodeGraphToolbarProps> = {}): CodeGraphToolbarProps => ({
  directory: '/home/me/repo',
  subject: { id: 'fn:add@math.ts', label: 'add', kind: 'symbol', source: 'active-file' },
  mode: 'explore',
  depth: 1,
  search: '',
  scope: 'symbols',
  filters: { kinds: [], edgeKinds: ['calls', 'defines'], minConfidence: 0 },
  totals: null,
  completeness: null,
  busy: false,
  onModeChange: () => {},
  onDepthChange: () => {},
  onSearchSubmit: () => {},
  onScopeChange: () => {},
  onFiltersChange: () => {},
  onRefresh: () => {},
  onFit: () => {},
  onReset: () => {},
  ...overrides,
});

const render = async (props: CodeGraphToolbarProps): Promise<void> => {
  useI18nStore.setState((state) => ({ dictionary: { ...state.dictionary, ...toolbarCopy } }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider>
        <CodeGraphToolbar {...props} />
      </I18nProvider>,
    );
  });
  await act(async () => {});
};

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null;
  container.remove();
});

const click = async (element: Element | null): Promise<void> => {
  if (!element) throw new Error('Missing element to click');
  await act(async () => {
    // SAFETY: the caller passed a rendered toolbar node; the click needs the element type.
    (element as HTMLElement).click();
  });
  await act(async () => {});
};

describe('code graph toolbar', () => {
  test('mode buttons call onModeChange with the right id', async () => {
    const seen: string[] = [];
    await render(baseProps({ onModeChange: (mode) => { seen.push(mode); } }));
    await click(container.querySelector('#code-graph-mode-trace'));
    await click(container.querySelector('#code-graph-mode-impact'));
    await click(container.querySelector('#code-graph-mode-explore'));
    expect(seen).toEqual(['trace', 'impact', 'explore']);
    expect(container.querySelector('#code-graph-mode-explore')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('#code-graph-mode-trace')?.getAttribute('aria-pressed')).toBe('false');
  });

  test('depth buttons call onDepthChange and are disabled while busy', async () => {
    const seen: Array<number> = [];
    await render(baseProps({ onDepthChange: (depth) => { seen.push(depth); } }));
    await click(container.querySelector('[data-testid="code-graph-depth-2"]'));
    expect(seen).toEqual([2]);
  });

  test('depth buttons are disabled while busy', async () => {
    const seen: Array<number> = [];
    await render(baseProps({ busy: true, onDepthChange: (depth) => { seen.push(depth); } }));
    for (const value of [1, 2, 3] as const) {
      const button = container.querySelector(`[data-testid="code-graph-depth-${value}"]`);
      expect(button?.hasAttribute('disabled')).toBe(true);
    }
    await click(container.querySelector('[data-testid="code-graph-depth-2"]'));
    expect(seen).toEqual([]);
  });

  test('the filter popover opens and toggling an edge kind reports the updated array', async () => {
    const seen: Array<{ kinds: string[]; edgeKinds: string[]; minConfidence: number }> = [];
    await render(baseProps({ onFiltersChange: (filters) => { seen.push(filters); } }));
    expect(container.querySelector('[data-testid="code-graph-filter-edge-calls"]')).toBeNull();
    const triggers = [...container.querySelectorAll('button')].filter((entry) => entry.getAttribute('aria-expanded') !== null);
    expect(triggers.length).toBe(1);
    await click(triggers[0]);
    const box = container.querySelector('[data-testid="code-graph-filter-edge-calls"] [role="checkbox"]');
    expect(box).not.toBeNull();
    await click(box);
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual({ kinds: [], edgeKinds: ['defines'], minConfidence: 0 });
  });

  test('totals show displayed of known when the hidden remainder is positive', async () => {
    await render(baseProps({ totals: { displayed: 20, known: 47, hidden: 27 } }));
    const totals = container.querySelector('[data-testid="code-graph-totals"]');
    expect(totals?.textContent).toContain('20 of 47');
  });

  test('totals fall back to the not-available text when the total is unknown', async () => {
    await render(baseProps({ totals: { displayed: 20, known: null, hidden: null } }));
    expect(container.querySelector('[data-testid="code-graph-totals"]')?.textContent?.toLowerCase()).toContain('not available');
  });

  test('totals render nothing when totals are null', async () => {
    await render(baseProps({ totals: null }));
    expect(container.querySelector('[data-testid="code-graph-totals"]')).toBeNull();
  });

  test('no element offers a row-count or limit choice', async () => {
    await render(baseProps({ totals: { displayed: 20, known: 47, hidden: 27 } }));
    expect(container.querySelector('[data-testid="code-graph-limit"]')).toBeNull();
  });

  test('submitting the search calls onSearchSubmit with the current query', async () => {
    const seen: string[] = [];
    await render(baseProps({ search: 'add', onSearchSubmit: (query) => { seen.push(query); } }));
    const input = container.querySelector('input');
    expect(input?.value).toBe('add');
    const form = container.querySelector('form');
    if (!form) throw new Error('Missing search form');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(seen).toEqual(['add']);
  });
});
