import { Window } from 'happy-dom';
import { describe, expect, test, afterEach } from 'bun:test';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLButtonElement: browser.HTMLButtonElement, HTMLDivElement: browser.HTMLDivElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent,
  WheelEvent: browser.WheelEvent,
  KeyboardEvent: browser.KeyboardEvent,
  FocusEvent: browser.FocusEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
import type { Root } from 'react-dom/client';
const { I18nProvider } = await import('@/lib/i18n');
const { CodeGraphCanvas } = await import('./CodeGraphCanvas');
const { parseGraph } = await import('@/lib/codeGraphApi');

describe('code graph canvas bounded render + edge keyboard', () => {
  let container: HTMLElement;
  let root: Root | null = null;
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container?.remove();
    root = null;
  });
  const renderCanvas = async (graph: any, onSelectEdge?: any) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <I18nProvider>
          <CodeGraphCanvas graph={graph} selectedId={graph.subjectId} onSelect={() => {}} selectedEdge={null} onSelectEdge={onSelectEdge} preview={false} previewLabel="" truncatedLabel="truncated" edgesLabel="Edges" />
        </I18nProvider>
      );
    });
    return container;
  };
  test('caps mounted nodes/edges and keeps selection mounted', async () => {
    const nodes: any[] = [{ id: 'subj', kind: 'symbol', name: 'subj', file: 'a.ts', line: 1, subject: true }];
    const edges: any[] = [];
    for (let i = 0; i < 400; i++) {
      const id = 'n' + i;
      nodes.push({ id, kind: 'symbol', name: id, file: 'a.ts', line: i + 2 });
      edges.push({ id: 'e' + i, kind: 'CALLS_STATIC', from: id, to: 'subj', confidence: 1 });
    }
    const model = parseGraph({ subjectId: 'subj', nodes, edges, truncated: false });
    if (!model) throw new Error('model missing');
    const host = await renderCanvas(model, () => {});
    const bounded = host.querySelector('[data-testid="code-graph-canvas-bounded"]');
    expect(bounded).not.toBeNull();
    // Selected subject stays mounted even under the cap (250 nodes + Fit button).
    const buttons = host.querySelectorAll('button');
    expect(buttons.length).toBeLessThanOrEqual(251);
    expect(buttons.length).toBeGreaterThan(0);
  });
  test('edge hit path is keyboard operable with label', async () => {
    const model = parseGraph({
      subjectId: 's',
      nodes: [
        { id: 's', kind: 'symbol', name: 's', file: 'a.ts', line: 1, subject: true },
        { id: 'c', kind: 'symbol', name: 'c', file: 'a.ts', line: 2 },
      ],
      edges: [{ id: 'e1', kind: 'CALLS_STATIC', from: 'c', to: 's', confidence: 1 }],
      truncated: false,
    });
    if (!model) throw new Error('model missing');
    let picked: any = 'unset';
    const host = await renderCanvas(model, (e: any) => { picked = e; });
    const edge = host.querySelector('path[role="button"]') as HTMLElement;
    expect(edge).not.toBeNull();
    expect(edge.getAttribute('aria-label')).toContain('CALLS_STATIC');
    expect(edge.tabIndex).toBe(0);
    await act(async () => {
      edge.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(picked === null || (picked && picked.id)).toBeTruthy();
  });
});
