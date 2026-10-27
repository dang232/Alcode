import { Window } from 'happy-dom';
import { afterEach, describe, expect, test } from 'bun:test';
import { codeGraphI18n as catalogue } from '../../lib/i18n/messages/code-graph.i18n';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement, HTMLFormElement: browser.HTMLFormElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, KeyboardEvent: browser.KeyboardEvent,
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
const { I18nProvider } = await import('@/lib/i18n');
const { CodeGraphModuleMap } = await import('./CodeGraphModuleMap');

type ModuleProps = React.ComponentProps<typeof CodeGraphModuleMap>;

const baseProps = (overrides: Partial<ModuleProps> = {}): ModuleProps => ({
  modules: [],
  expanded: null,
  onToggle: () => {},
  onFocusModule: () => {},
  onSelectFile: () => {},
  filesByModule: {},
  ...overrides,
});

const withCounts = baseProps({
  modules: [
    {
      name: 'src',
      analyzedFiles: 12,
      symbolCount: 5,
      edgeCount: 4,
      unanalyzedFiles: 3,
      unanalyzedByExtension: [
        { ext: '.ts', count: 2 },
        { ext: '.md', count: 1 },
      ],
    },
  ],
  filesByModule: { src: [{ file: 'src/a.ts' }] },
});

let container: HTMLElement;
let root: Root;

const render = async (props: ModuleProps): Promise<void> => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <CodeGraphModuleMap {...props} />
      </I18nProvider>,
    );
  });
  await act(async () => {});
};

const rerender = async (props: ModuleProps): Promise<void> => {
  await act(async () => {
    root.render(
      <I18nProvider>
        <CodeGraphModuleMap {...props} />
      </I18nProvider>,
    );
  });
  await act(async () => {});
};

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const rowFor = (name: string): HTMLElement => {
  const row = container.querySelector(`[data-testid="code-graph-module-${name}"]`);
  if (!row) throw new Error(`Missing module row: ${name}`);
  // SAFETY: the row was asserted present above; callers read attributes off the element.
  return row as HTMLElement;
};

describe('code graph module map', () => {
  test('renders every count from props and reveals the extension breakdown on expand', async () => {
    const toggled: Array<string> = [];
    await render({ ...withCounts, onToggle: (module) => { toggled.push(module); } });

    expect(container.textContent).toContain('src');
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('5');
    expect(container.textContent).toContain('4');
    expect(container.textContent).toContain('3');
    // Collapsed: the per-extension breakdown stays hidden.
    expect(container.textContent).not.toContain('.ts');

    await rerender({ ...withCounts, expanded: 'src', onToggle: (module) => { toggled.push(module); } });
    expect(rowFor('src').getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('.ts');
    expect(container.textContent).toContain('.md');
    expect(toggled).toEqual([]);
  });

  test('a module without coverage fields reports unknown coverage instead of zero', async () => {
    await render(baseProps({ modules: [{ name: 'docs' }] }));

    // Assert the copy a reader sees, not the catalogue key: keys used to fall back
    // to their own name, which made a "key present" assertion pass while the UI
    // showed nothing meaningful.
    expect(container.textContent).toContain(catalogue.en['codeGraph.moduleMap.coverageUnknown']);
    expect(container.textContent).not.toContain('0');
  });

  test('expanding calls onToggle with the module name', async () => {
    const toggled: Array<string> = [];
    await render({ ...withCounts, onToggle: (module) => { toggled.push(module); } });

    const row = rowFor('src');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { row.click(); });
    expect(toggled).toEqual(['src']);
  });

  test('clicking a file calls onSelectFile with its path and focus reaches onFocusModule', async () => {
    const selected: Array<string> = [];
    const focused: Array<string> = [];
    await render({
      ...withCounts,
      expanded: 'src',
      onSelectFile: (file) => { selected.push(file); },
      onFocusModule: (module) => { focused.push(module); },
    });

    const fileButton = container.querySelector('[data-testid="code-graph-module-file-list-src"] button');
    if (!fileButton) throw new Error('Missing file button');
    await act(async () => {
      // SAFETY: the button was asserted present above; the click needs the element type.
      (fileButton as HTMLElement).click();
    });
    expect(selected).toEqual(['src/a.ts']);

    const focusButton = container.querySelector('[data-testid="code-graph-module-focus-src"]');
    if (!focusButton) throw new Error('Missing focus button');
    await act(async () => {
      // SAFETY: the button was asserted present above; the click needs the element type.
      (focusButton as HTMLElement).click();
    });
    expect(focused).toEqual(['src']);
  });

  test('rows toggle with Enter and Space', async () => {
    const toggled: Array<string> = [];
    await render({ ...withCounts, onToggle: (module) => { toggled.push(module); } });

    const row = rowFor('src');
    row.focus();
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await act(async () => {
      row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    });
    expect(toggled).toEqual(['src', 'src']);
  });

  test('an empty module list renders the empty state, never a blank box', async () => {
    await render(baseProps());

    expect(container.textContent).toContain(catalogue.en['codeGraph.moduleMap.empty']);
    expect((container.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});
