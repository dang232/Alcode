import { Window } from 'happy-dom';
import { describe, expect, test } from 'bun:test';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.HTMLElement,
  HTMLElement: browser.HTMLElement,
  HTMLButtonElement: browser.HTMLButtonElement, HTMLDivElement: browser.HTMLDivElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent, MouseEvent: browser.MouseEvent,
  PointerEvent: browser.PointerEvent,
  WheelEvent: browser.WheelEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
import type { Root } from 'react-dom/client';
const { I18nProvider } = await import('@/lib/i18n');
const { CodeGraphLegend } = await import('./CodeGraphLegend');

describe('code graph legend', () => {
  let container: HTMLElement;
  let root: Root | null = null;

  const render = async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <CodeGraphLegend />
        </I18nProvider>,
      );
    });
    await act(async () => {});
  };

  const teardown = () => {
    root?.unmount();
    container.remove();
  };

  const swatchOf = (rowId: string): HTMLElement => {
    const row = container.querySelector(`[data-testid="code-graph-legend-row-${rowId}"]`);
    if (!row) throw new Error(`legend row ${rowId} missing`);
    const swatch = row.querySelector('span.w-8');
    if (!swatch) throw new Error(`legend swatch ${rowId} missing`);
    // SAFETY: the swatch was asserted present above; the style read needs the element type.
    return swatch as HTMLElement;
  };

  test('renders one row per convention with a label', async () => {
    await render();
    const rows = container.querySelectorAll('[data-testid^="code-graph-legend-row-"]');
    expect(rows.length).toBe(7);
    for (const row of rows) {
      expect((row.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
    teardown();
  });

  test('unresolved and test swatches dash while resolved and import stay solid', async () => {
    await render();
    expect(swatchOf('unresolved').style.borderTopStyle).toBe('dashed');
    expect(swatchOf('test').style.borderTopStyle).toBe('dashed');
    expect(swatchOf('resolved').style.borderTopStyle).not.toBe('dashed');
    expect(swatchOf('import').style.borderTopStyle).not.toBe('dashed');
    teardown();
  });

  test('swatches use semantic tokens: warning for unresolved, success for test, info for import', async () => {
    await render();
    expect(swatchOf('unresolved').className).toContain('status-warning');
    expect(swatchOf('test').className).toContain('status-success');
    expect(swatchOf('import').className).toContain('status-info');
    teardown();
  });

  test('confidence tiers fade in order', async () => {
    await render();
    const opacityOf = (rowId: string): number => {
      const value = swatchOf(rowId).style.opacity;
      return value === '' ? 1 : Number(value);
    };
    const high = opacityOf('confidence-high');
    const medium = opacityOf('confidence-medium');
    const low = opacityOf('confidence-low');
    expect(high).toBe(1);
    expect(medium).toBeLessThan(high);
    expect(low).toBeLessThan(medium);
    teardown();
  });
});
