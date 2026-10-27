import { Window } from 'happy-dom';
import { describe, expect, test } from 'bun:test';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
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
import type { CodeGraphSelectedEdge, CodeGraphTopology } from '@/lib/codeGraphApi';
const { I18nProvider } = await import('@/lib/i18n');
const { CodeGraphCanvas } = await import('./CodeGraphCanvas');
const { layoutCodeGraph } = await import('./codeGraphLayout');
const { parseGraph } = await import('@/lib/codeGraphApi');
const { codeGraphI18n } = await import('@/lib/i18n/messages/code-graph.i18n');

const subject = 'const:clampScale@viewport.ts';
const caller = 'const:anchorView@viewport.ts';
const fileNode = 'file:viewport.ts';

interface WireGraphOverrides {
  truncated?: boolean;
  edges?: Array<{ id: string; kind: string; from: string; to: string; confidence: number }>;
}

interface CanvasPropOverrides {
  graph?: CodeGraphTopology;
  onSelect?: (id: string) => void;
  onSelectEdge?: ((edge: CodeGraphSelectedEdge | null) => void) | undefined;
}

const frameOf = (): HTMLElement => {
  // SAFETY: every canvas interaction test renders the application frame before querying it.
  const frame = document.querySelector('[role="application"]') as HTMLElement;
  if (!frame) throw new Error('frame missing');
  return frame;
};

const wireGraph = (overrides: WireGraphOverrides = {}) => ({
  subjectId: subject,
  nodes: [
    { id: subject, kind: 'symbol', name: 'clampScale', file: 'viewport.ts', line: 21, subject: true },
    { id: caller, kind: 'symbol', name: 'anchorView', file: 'viewport.ts', line: 32 },
    { id: fileNode, kind: 'file', name: 'viewport.ts' },
  ],
  edges: [
    { id: 'e1', kind: 'CALLS_STATIC', from: caller, to: subject, confidence: 1 },
    { id: 'e2', kind: 'CALLS_STATIC', from: caller, to: subject, confidence: 0.8 },
    { id: 'e3', kind: 'DEFINES', from: fileNode, to: subject, confidence: 1 },
  ],
  truncated: false,
  ...overrides,
});

describe('code graph topology parsing', () => {
  test('collapses parallel call sites and carries truncation', () => {
    const model = parseGraph(wireGraph({ truncated: true }));
    expect(model?.subjectId).toBe(subject);
    expect(model?.nodes).toHaveLength(3);
    expect(model?.edges).toHaveLength(2);
    expect(model?.edges.find((edge) => edge.from === caller)?.sites).toBe(2);
    expect(model?.truncated).toBe(true);
  });

  test('drops edges with unknown endpoints and reads absence as null', () => {
    const model = parseGraph(wireGraph({
      edges: [
        { id: 'x', kind: 'CALLS_STATIC', from: 'const:ghost@nowhere.ts', to: subject, confidence: 1 },
      ],
    }));
    expect(model?.edges).toHaveLength(0);
    expect(parseGraph(null)).toBeNull();
    expect(parseGraph({})).toBeNull();
    expect(parseGraph({ subjectId: subject, nodes: [], edges: [] })).toBeNull();
  });
});

describe('code graph layout', () => {
  test('places callers left, subject middle, dependents right', () => {
    const model = parseGraph(wireGraph());
    if (!model) throw new Error('model missing');
    const spec = layoutCodeGraph(model);
    const at = (id: string) => spec.nodes.find((node) => node.id === id);
    // The file DEFINES the subject, so the edge points at it: both neighbours
    // sit left of the subject and every drawn edge runs left to right.
    expect(at(caller)!.x).toBeLessThan(at(subject)!.x);
    expect(at(fileNode)!.x).toBeLessThan(at(subject)!.x);
    expect(spec.edges).toHaveLength(2);
    for (const edge of spec.edges) {
      expect(edge.x1).toBeLessThan(edge.x2);
    }
  });
});

describe('code graph canvas', () => {
  let container: HTMLElement;
  let root: Root | null = null;

  const render = async (props: CanvasPropOverrides) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const model = parseGraph(wireGraph());
    if (!model) throw new Error('model missing');
    await act(async () => {
      root?.render(
        <I18nProvider>
          <CodeGraphCanvas
            graph={model}
            selectedId={null}
            onSelect={() => {}}
            selectedEdge={null}
            onSelectEdge={() => {}}
            preview={false}
            previewLabel="Preview"
            truncatedLabel="Truncated"
            edgesLabel="Edges"
            {...props}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {});
  };

  test('draws one node per subject and neighbour with directed edges', async () => {
    const seen: string[] = [];
    await render({ onSelect: (id: string) => { seen.push(id); } });
    const nodes = container.querySelectorAll('button[title]');
    expect(nodes.length).toBe(3);
    expect(container.querySelectorAll('svg path').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('Edges 2');
    const callerButton = [...nodes].find((entry) => entry.getAttribute('title') === caller);
    if (!callerButton) throw new Error('caller node missing');
    await act(async () => {
      // SAFETY: the caller node was asserted present above; the click target is that button.
      (callerButton as HTMLElement).click();
    });
    expect(seen).toEqual([caller]);
    root?.unmount();
    container.remove();
  });

  test('edge clicks report the edge and highlight the selection', async () => {
    const seen: { from: string; to: string; kind: string }[] = [];
    const model = parseGraph(wireGraph());
    if (!model) throw new Error('model missing');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <CodeGraphCanvas
            graph={model}
            selectedId={null}
            onSelect={() => {}}
            selectedEdge={null}
            onSelectEdge={(edge) => { if (edge) seen.push(edge); }}
            preview={false}
            previewLabel="Preview"
            truncatedLabel="Truncated"
            edgesLabel="Edges"
          />
        </I18nProvider>,
      );
    });
    await act(async () => {});
    const hit = container.querySelectorAll('svg path')[1];
    if (!hit) throw new Error('edge hit path missing');
    await act(async () => {
      // SAFETY: the hit path was asserted present above; the click target is that path.
      (hit as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(seen).toEqual([{ id: 'e1', from: caller, to: subject, kind: 'CALLS_STATIC', confidence: 1, sites: 2 }]);
    root?.unmount();
    container.remove();
  });

  test('marks the preview and truncation states', async () => {
    const model = parseGraph(wireGraph({ truncated: true }));
    if (!model) throw new Error('model missing');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <CodeGraphCanvas
            graph={model}
            selectedId={subject}
            onSelect={() => {}}
            selectedEdge={{ from: caller, to: subject, kind: 'CALLS_STATIC' }}
            onSelectEdge={() => {}}
            preview
            previewLabel="Preview"
            truncatedLabel="Truncated"
            edgesLabel="Edges"
          />
        </I18nProvider>,
      );
    });
    await act(async () => {});
    expect(container.textContent).toContain('Preview');
    expect(container.textContent).toContain('Truncated');
    root?.unmount();
    container.remove();
  });

  test('shows a legend entry for every kind present and none for absent kinds', async () => {
    const model = parseGraph({
      subjectId: 'const:a@a.ts',
      nodes: [
        { id: 'const:a@a.ts', kind: 'alpha', name: 'a', file: 'a.ts', line: 1, subject: true },
        { id: 'const:b@b.ts', kind: 'beta', name: 'b', file: 'b.ts', line: 2 },
      ],
      edges: [],
      truncated: false,
    });
    if (!model) throw new Error('model missing');
    await render({ graph: model });
    expect(container.textContent).toContain('alpha');
    expect(container.textContent).toContain('beta');
    expect(container.textContent).toContain('subject');
    expect(container.textContent).not.toContain('gamma');
    root?.unmount();
    container.remove();
  });

  test('disambiguates same-name nodes with their file and line', async () => {
    const model = parseGraph({
      subjectId: 'const:d@one.ts',
      nodes: [
        { id: 'const:d@one.ts', kind: 'symbol', name: 'd', file: 'one.ts', line: 1, subject: true },
        { id: 'const:d@two.ts', kind: 'symbol', name: 'd', file: 'two.ts', line: 2 },
      ],
      edges: [],
      truncated: false,
    });
    if (!model) throw new Error('model missing');
    await render({ graph: model });
    const buttons = [...container.querySelectorAll('button[title]')];
    expect(buttons).toHaveLength(2);
    const subtitles = buttons.map((button) => button.querySelectorAll('span')[1]?.textContent);
    expect(subtitles).toEqual(['one.ts:1', 'two.ts:2']);
    root?.unmount();
    container.remove();
  });

  test('falls back to the kind name when a node has no file or line', async () => {
    await render({});
    const fileButton = container.querySelector('button[title="file:viewport.ts"]');
    if (!fileButton) throw new Error('file node missing');
    expect(fileButton.querySelectorAll('span')[1]?.textContent).toBe('file');
    root?.unmount();
    container.remove();
  });

  test('pairs the truncation sentence with the expand hint only when truncated', async () => {
    const expandHint = codeGraphI18n.en['codeGraph.graph.expand'];
    const truncatedModel = parseGraph(wireGraph({ truncated: true }));
    if (!truncatedModel) throw new Error('model missing');
    await render({ graph: truncatedModel });
    expect(container.textContent).toContain('Truncated');
    expect(container.textContent).toContain(expandHint);
    root?.unmount();
    container.remove();

    await render({});
    expect(container.textContent).not.toContain('Truncated');
    expect(container.textContent).not.toContain(expandHint);
    root?.unmount();
    container.remove();
  });

  test('caps the legend at five kinds and counts the rest', async () => {
    const model = parseGraph({
      subjectId: 'const:s@s.ts',
      nodes: [
        { id: 'const:s@s.ts', kind: 'k0', name: 's', file: 's.ts', line: 1, subject: true },
        ...[1, 2, 3, 4, 5, 6].map((i) => ({
          id: `const:n${i}@n${i}.ts`,
          kind: `k${i}`,
          name: `n${i}`,
          file: `n${i}.ts`,
          line: i,
        })),
      ],
      edges: [],
      truncated: false,
    });
    if (!model) throw new Error('model missing');
    await render({ graph: model });
    for (const kind of ['k0', 'k1', 'k2', 'k3', 'k4']) {
      expect(container.textContent).toContain(kind);
    }
    expect(container.textContent).not.toContain('k5');
    expect(container.textContent).not.toContain('k6');
    expect(container.textContent).toContain('+2');
    root?.unmount();
    container.remove();
  });

  test('a tap picks a node: capture waits for a real drag, so the click reaches it', async () => {
    const seen: string[] = [];
    await render({ onSelect: (id: string) => { seen.push(id); } });
    const frame = frameOf();
    const captures: number[] = [];
    // SAFETY: the harness replaces the capture hook with a recorder; the panel only calls it with a pointer id.
    frame.setPointerCapture = ((id: number) => { captures.push(id); }) as never;
    const pointer = (type: string, x: number, y: number) => new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0,
    });

    await act(async () => { frame.dispatchEvent(pointer('pointerdown', 100, 100)); });
    expect(captures).toEqual([]);
    await act(async () => { frame.dispatchEvent(pointer('pointermove', 102, 101)); });
    expect(captures).toEqual([]);
    await act(async () => { frame.dispatchEvent(pointer('pointerup', 102, 101)); });

    // SAFETY: the node was asserted present above; the lookup needs the element type.
    const node = frame.querySelector('button[aria-pressed]') as HTMLElement;
    if (!node) throw new Error('node missing');
    await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(seen.length).toBeGreaterThan(0);
    expect(captures).toEqual([]);
  });

  test('a real drag captures once and pans the content', async () => {
    await render({});
    const frame = frameOf();
    const captures: number[] = [];
    // SAFETY: the harness replaces the capture hook with a recorder; the panel only calls it with a pointer id.
    frame.setPointerCapture = ((id: number) => { captures.push(id); }) as never;
    // SAFETY: the world layer is the frame's only child; the transform read needs the element type.
    const world = frame.firstElementChild as HTMLElement;
    const before = world.style.transform;
    const pointer = (type: string, x: number, y: number) => new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0,
    });

    await act(async () => { frame.dispatchEvent(pointer('pointerdown', 100, 100)); });
    await act(async () => { frame.dispatchEvent(pointer('pointermove', 140, 130)); });
    expect(captures).toEqual([7]);
    expect(world.style.transform).not.toBe(before);
  });

  test('the graph owns the wheel: it zooms and cancels the panel scroll', async () => {
    await render({});
    const frame = frameOf();
    // SAFETY: the world layer is the frame's only child; the transform read needs the element type.
    const world = frame.firstElementChild as HTMLElement;
    const before = world.style.transform;
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 120, clientY: 120 });
    await act(async () => { frame.dispatchEvent(wheel); });
    expect(wheel.defaultPrevented).toBe(true);
    expect(world.style.transform).not.toBe(before);
  });
});

describe('code graph canvas evidence styling', () => {
  const testNode = 'const:testHelper@viewport.test.ts';
  let container: HTMLElement;
  let root: Root | null = null;

  const evidenceModel = () => {
    const model = parseGraph({
      subjectId: subject,
      nodes: [
        { id: subject, kind: 'symbol', name: 'clampScale', file: 'viewport.ts', line: 21, subject: true },
        { id: caller, kind: 'symbol', name: 'anchorView', file: 'viewport.ts', line: 32 },
        { id: testNode, kind: 'symbol', name: 'testHelper', file: 'viewport.test.ts', line: 5 },
      ],
      edges: [
        { id: 'r1', kind: 'CALLS_STATIC', from: caller, to: subject, confidence: 1 },
        { id: 'u1', kind: 'CALLS_UNRESOLVED', from: caller, to: subject, confidence: 0.4 },
        { id: 't1', kind: 'TESTS', from: testNode, to: subject, confidence: 0.9 },
      ],
      truncated: false,
    });
    if (!model) throw new Error('model missing');
    return model;
  };

  const renderEvidence = async (props: CanvasPropOverrides) => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const model = evidenceModel();
    await act(async () => {
      root?.render(
        <I18nProvider>
          <CodeGraphCanvas
            graph={model}
            selectedId={null}
            onSelect={() => {}}
            selectedEdge={null}
            preview={false}
            previewLabel="Preview"
            truncatedLabel="Truncated"
            edgesLabel="Edges"
            {...props}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {});
  };

  const teardown = () => {
    root?.unmount();
    container.remove();
  };

  test('an unresolved edge renders dashed while a compiler-resolved call does not', async () => {
    await renderEvidence({});
    const drawn = container.querySelectorAll('svg path.code-graph-edge');
    // Marker, then per edge one hit path plus one drawn path: three edges stay three.
    expect(drawn.length).toBe(3);
    // SAFETY: the drawn paths are the canvas output; the style read needs the element type.
    const [resolved, unresolved, tests] = [drawn[0], drawn[1], drawn[2]] as HTMLElement[];
    expect(unresolved.classList.contains('code-graph-edge-dashed')).toBe(true);
    expect(unresolved.getAttribute('stroke-dasharray')).toBe('6 3');
    expect(tests.classList.contains('code-graph-edge-dashed')).toBe(true);
    expect(resolved.classList.contains('code-graph-edge-dashed')).toBe(false);
    expect(resolved.getAttribute('stroke-dasharray')).toBeNull();
    teardown();
  });

  test('a test node gets the test treatment, other nodes do not', async () => {
    await renderEvidence({});
    const testButton = container.querySelector(`button[title="${testNode}"]`);
    if (!testButton) throw new Error('test node missing');
    expect(testButton.className).toContain('status-success');
    const callerButton = container.querySelector(`button[title="${caller}"]`);
    if (!callerButton) throw new Error('caller node missing');
    expect(callerButton.className).not.toContain('status-success');
    teardown();
  });

  test('hovering a node previews without selecting', async () => {
    const seen: string[] = [];
    await renderEvidence({ onSelect: (id: string) => { seen.push(id); } });
    // SAFETY: the caller button was asserted present above; the hover needs the element type.
    const callerButton = container.querySelector(`button[title="${caller}"]`) as HTMLElement;
    if (!callerButton) throw new Error('caller node missing');
    await act(async () => {
      callerButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(seen).toEqual([]);
    const tooltip = container.querySelector('[role="tooltip"]');
    if (!tooltip) throw new Error('node tooltip missing');
    expect(tooltip.textContent).toContain('anchorView');
    expect(tooltip.textContent).toContain('symbol');
    expect(tooltip.textContent).toContain('viewport.ts:32');
    await act(async () => {
      callerButton.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    teardown();
  });

  test('clicking a node selects it exactly once', async () => {
    const seen: string[] = [];
    await renderEvidence({ onSelect: (id: string) => { seen.push(id); } });
    // SAFETY: the caller button was asserted present above; the click needs the element type.
    const callerButton = container.querySelector(`button[title="${caller}"]`) as HTMLElement;
    if (!callerButton) throw new Error('caller node missing');
    await act(async () => { callerButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(seen).toEqual([caller]);
    teardown();
  });

  test('hovering an edge reveals kind and confidence; clicking reports the full edge', async () => {
    const seen: CodeGraphSelectedEdge[] = [];
    await renderEvidence({ onSelectEdge: (edge) => { if (edge) seen.push(edge); } });
    const hits = container.querySelectorAll('svg path[stroke="transparent"]');
    expect(hits.length).toBe(3);
    // SAFETY: the hit path was asserted present above; the hover needs the element type.
    const testsHit = hits[2] as HTMLElement;
    await act(async () => {
      testsHit.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    const tooltip = container.querySelector('[role="tooltip"]');
    if (!tooltip) throw new Error('edge tooltip missing');
    expect(tooltip.textContent).toContain('TESTS');
    expect(tooltip.textContent).toContain('0.90');
    await act(async () => {
      testsHit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(seen).toEqual([{
      id: 't1',
      from: testNode,
      to: subject,
      kind: 'TESTS',
      confidence: 0.9,
      sites: 1,
    }]);
    teardown();
  });
});
