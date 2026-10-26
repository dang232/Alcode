import { Window } from 'happy-dom';
import { afterEach, describe, expect, test } from 'bun:test';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLButtonElement: browser.HTMLButtonElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent,
  MutationObserver: browser.MutationObserver, ResizeObserver: browser.ResizeObserver,
  MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
import type { Root } from 'react-dom/client';
const { I18nProvider } = await import('@/lib/i18n');
const { RunGraphView } = await import('./RunGraph');
import type { ActivityNodeState, RunGraph } from './activityModel';

let roots: Root[] = [];
afterEach(() => {
  act(() => { for (const root of roots) root.unmount(); });
  roots = [];
});

const FRAME = { width: 800, height: 600, left: 0, top: 0 };
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => FRAME,
});

const graphOf = (states: ActivityNodeState[], extra = 0): RunGraph => ({
  width: 664,
  height: 64,
  nodes: states.map((state, index) => ({
    id: `n${index}`, label: `Node ${index}`, state, wave: 0, x: index * 100, y: 0,
  })).concat(extra > 0 ? [{ id: 'n-new', label: 'New', state: 'pending' as const, wave: 0, x: 900, y: 0 }] : []),
  edges: [],
});

const render = (node: React.ReactNode): HTMLElement => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    const root = createRoot(host);
    roots.push(root);
    root.render(<I18nProvider>{node}</I18nProvider>);
  });
  return host;
};

const worldTransform = (host: HTMLElement): string => {
  const worlds = Array.from(host.querySelectorAll('div')).filter((div) => div instanceof HTMLElement && div.style.transform !== '');
  if (worlds.length === 0) throw new Error('no transformed world div rendered');
  return worlds[0].style.transform;
};

const wheel = (deltaY: number): Event => {
  const event = new Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: 400, clientY: 300, deltaY });
  return event;
};

const zoom = (host: HTMLElement, deltaY: number): void => {
  const frame = host.querySelector('[role="application"]');
  if (!frame) throw new Error('no graph frame rendered');
  act(() => {
    frame.dispatchEvent(wheel(deltaY));
  });
};

describe('RunGraphView viewport stability', () => {
  test('fits on mount and zooms at the cursor on wheel', () => {
    const host = render(<RunGraphView graph={graphOf(['pending'])} selectedId={null} onSelect={() => undefined} />);
    const fitted = worldTransform(host);
    expect(fitted).toContain('scale(1)');
    zoom(host, -120);
    const zoomed = worldTransform(host);
    expect(zoomed).not.toBe(fitted);
    expect(zoomed).toContain('scale(1.1)');
  });

  test('state-only live updates keep the user zoom', () => {
    let graph = graphOf(['running']);
    const host = render(<RunGraphView graph={graph} selectedId={null} onSelect={() => undefined} />);
    zoom(host, -120);
    const zoomed = worldTransform(host);
    graph = graphOf(['completed']);
    act(() => {
      const root = roots[roots.length - 1];
      root.render(<I18nProvider><RunGraphView graph={graph} selectedId={null} onSelect={() => undefined} /></I18nProvider>);
    });
    expect(worldTransform(host)).toBe(zoomed);
  });

  test('an added node refits the viewport', () => {
    const host = render(<RunGraphView graph={graphOf(['pending'])} selectedId={null} onSelect={() => undefined} />);
    zoom(host, -120);
    const zoomed = worldTransform(host);
    const grown = graphOf(['pending'], 1);
    act(() => {
      const root = roots[roots.length - 1];
      root.render(<I18nProvider><RunGraphView graph={grown} selectedId={null} onSelect={() => undefined} /></I18nProvider>);
    });
    expect(worldTransform(host)).not.toBe(zoomed);
  });

  test('selection survives a state-only update', () => {
    const seen: string[] = [];
    const host = render(
      <RunGraphView graph={graphOf(['running'])} selectedId="n0" onSelect={(id) => seen.push(id)} />,
    );
    const node = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Node 0'));
    expect(node?.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      const root = roots[roots.length - 1];
      const graph = graphOf(['completed']);
      root.render(<I18nProvider><RunGraphView graph={graph} selectedId="n0" onSelect={(id) => seen.push(id)} /></I18nProvider>);
    });
    const same = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Node 0'));
    expect(same?.getAttribute('aria-pressed')).toBe('true');
    expect(seen).toEqual([]);
  });
});
