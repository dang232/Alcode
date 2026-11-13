// The chat-path producer's attribution wiring.
//
// Drives the real hook + real runtimeFetch with only the network stubbed:
// a known child gets both ids, a conversation switch aborts the in-flight
// request and drops its index, and a failed read still emits the document
// with the attribution fields absent. The index is fetched once for a live
// run and exactly once more when that run reaches a terminal state; re-renders
// never add a request.
import { expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';

import type { JsonValue } from '@alcode/sdk';
import {
  dagRunModelToSnapshotDoc,
  type DagAttributionIndex,
  type DagParentState,
  type DagRunChild,
  type DagRunModel,
} from './dagRunModel';
import { useDagAttributionIndex } from './useDagRunModel';

type PendingRequest = {
  url: URL;
  init: RequestInit | undefined;
  resolve: (response: Response) => void;
};

const model: DagRunModel = {
  version: 1,
  conversationId: 'ses_parent01',
  parentSessionId: 'ses_parent01',
  runId: 'ses_parent01',
  progress: { total: 2, settled: 2 },
  label: 'Repository analysis',
  prompt: 'analyze this repo',
  state: 'completed',
  startedAt: 1000,
  endedAt: 3000,
  children: [
    {
      sessionId: 'ses_a', label: 'Analyze alpha', agent: 'explore', description: 'Analyze alpha',
      state: 'completed', startedAt: 2000, endedAt: 2500, output: 'alpha done',
    },
    {
      sessionId: 'ses_b', label: 'Analyze beta', agent: 'explore', description: 'Analyze beta',
      state: 'completed', startedAt: 2000, endedAt: 2500, output: 'beta done',
    },
  ],
  synthesis: { state: 'ready', text: 'both done' },
  counts: { pending: 0, running: 0, completed: 2, failed: 0, cancelled: 0 },
  updatedAt: 3000,
};

const liveModel: DagRunModel = {
  ...model,
  progress: { total: 2, settled: 0 },
  state: 'running',
  endedAt: null,
  children: model.children.map((child): DagRunChild => ({
    ...child,
    state: 'running',
    endedAt: null,
    output: null,
  })),
  synthesis: { state: 'pending', text: null },
  counts: { pending: 0, running: 2, completed: 0, failed: 0, cancelled: 0 },
  updatedAt: 2000,
};

type SnapshotNodeView = { id: string; task_id?: string; node_id?: string };
type SnapshotEnvelope = { dag: { runs: [{ nodes: SnapshotNodeView[] }] } };
type CapturedRender = {
  attribution: DagAttributionIndex | null;
  snapshot: JsonValue | null;
};

const wireNode = (snapshot: JsonValue | null, id: string): { id: string; task_id?: string; node_id?: string } => {
  // SAFETY: the hook builds every snapshot in this file with
  // dagRunModelToSnapshotDoc, which emits one run carrying this envelope.
  const doc = snapshot as SnapshotEnvelope | null;
  const node = doc?.dag.runs[0].nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`fixture must serialize node ${id}`);
  return node;
};

// Promise jobs only: no timer decides when the hook's chain settles.
const drain = async (): Promise<void> => {
  for (let step = 0; step < 50; step += 1) await Promise.resolve();
};

const installDom = (): void => {
  const dom = new Window({ url: 'http://localhost' });
  const globals = {
    window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
    localStorage: dom.localStorage,
    Element: dom.Element, HTMLElement: dom.HTMLElement, Node: dom.Node,
    customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet,
    Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
};

/** Stubs the network only; every attribution request parks until the test resolves it. */
const stubAttributionFetch = () => {
  const originalFetch = globalThis.fetch;
  const pending: PendingRequest[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
    // Hold unrelated store bootstrap (session/location reads) outside this
    // fixture: only an attribution request is answered here.
    if (url.pathname !== '/api/run-graph/attribution') return new Promise<Response>(() => undefined);
    return new Promise<Response>((resolve) => {
      pending.push({ url, init, resolve });
    });
  };
  return {
    pending,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

const attributionBody = (
  byChildSessionId: Record<string, { taskId: string; nodeId?: string }>,
): Response => Response.json({
  absent: false,
  entries: [],
  byChildSessionId,
  byTaskId: {},
  collisions: [],
});

type HarnessProps = {
  conversationId: string | null;
  directory?: string;
  runState: DagParentState | null;
  model: DagRunModel;
};

const AttributionHarness = ({ captured, ...props }: HarnessProps & { captured: CapturedRender }) => {
  const attribution = useDagAttributionIndex(props.conversationId, props.directory, props.runState);
  captured.attribution = attribution;
  captured.snapshot = dagRunModelToSnapshotDoc(props.model, attribution);
  return null;
};

test('attribution follows the real index, aborts on switch, and never blocks on failure', async () => {
  installDom();
  const { pending, restore } = stubAttributionFetch();
  try {
    const { createRoot } = await import('react-dom/client');
    const captured: CapturedRender = {
      attribution: null,
      snapshot: null,
    };
    let conversationId = 'ses_parent01';
    function Harness() {
      const attribution = useDagAttributionIndex(conversationId, '/repo');
      captured.attribution = attribution;
      captured.snapshot = dagRunModelToSnapshotDoc(model, attribution);
      return null;
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const render = () => act(async () => {
      root.render(<Harness />);
    });

    await render();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.url.pathname).toBe('/api/run-graph/attribution');
    expect(pending[0]?.url.searchParams.get('directory')).toBe('/repo');
    // The document is emitted before attribution resolves, with the fields absent.
    expect(captured.attribution).toBeNull();
    expect(Object.hasOwn(wireNode(captured.snapshot, 'ses_a'), 'task_id')).toBe(false);

    await act(async () => {
      pending[0]?.resolve(Response.json({
        absent: false,
        entries: [],
        byChildSessionId: { ses_a: { taskId: 'st_a', nodeId: 'node_alpha' } },
        byTaskId: {},
        collisions: [],
      }));
      await drain();
    });
    expect(captured.attribution).toEqual({ ses_a: { taskId: 'st_a', nodeId: 'node_alpha' } });
    const known = wireNode(captured.snapshot, 'ses_a');
    expect(known.task_id).toBe('st_a');
    expect(known.node_id).toBe('node_alpha');
    const unknown = wireNode(captured.snapshot, 'ses_b');
    expect(Object.hasOwn(unknown, 'task_id')).toBe(false);
    expect(Object.hasOwn(unknown, 'node_id')).toBe(false);

    conversationId = 'ses_other';
    await render();
    expect(pending[0]?.init?.signal?.aborted).toBe(true);
    expect(pending).toHaveLength(2);
    expect(captured.attribution).toBeNull();
    expect(Object.hasOwn(wireNode(captured.snapshot, 'ses_a'), 'task_id')).toBe(false);

    // A late result from the aborted request must not become the new reading.
    await act(async () => {
      pending[0]?.resolve(Response.json({
        absent: false,
        entries: [],
        byChildSessionId: { ses_a: { taskId: 'st_stale', nodeId: 'node_stale' } },
        byTaskId: {},
        collisions: [],
      }));
      await drain();
    });
    expect(captured.attribution).toBeNull();
    expect(Object.hasOwn(wireNode(captured.snapshot, 'ses_a'), 'task_id')).toBe(false);

    await act(async () => {
      pending[1]?.resolve(Response.json(
        { error: 'attribution state: task record malformed for bad.json', code: 'ATTRIBUTION_STATE_UNAVAILABLE' },
        { status: 500 },
      ));
      await drain();
    });
    // Failure keeps the reading unknown; the document still exists without ids.
    expect(captured.attribution).toBeNull();
    expect(captured.snapshot).not.toBeNull();
    expect(Object.hasOwn(wireNode(captured.snapshot, 'ses_a'), 'task_id')).toBe(false);
    expect(Object.hasOwn(wireNode(captured.snapshot, 'ses_a'), 'node_id')).toBe(false);

    await act(async () => {
      root.unmount();
    });
    expect(pending[1]?.init?.signal?.aborted).toBe(true);
  } finally {
    restore();
  }
});

test('a terminal transition refetches the index exactly once and its ids appear', async () => {
  installDom();
  const { pending, restore } = stubAttributionFetch();
  try {
    const { createRoot } = await import('react-dom/client');
    const captured: CapturedRender = { attribution: null, snapshot: null };
    let runState: DagParentState = 'running';
    let shownModel = liveModel;
    const draw = () => act(async () => {
      root.render(
        <AttributionHarness
          captured={captured}
          conversationId="ses_parent01"
          directory="/repo"
          runState={runState}
          model={shownModel}
        />,
      );
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await draw();
    expect(pending).toHaveLength(1);

    // The live reading has no claims yet: absent ids, not invented ones.
    await act(async () => {
      pending[0]?.resolve(attributionBody({}));
      await drain();
    });
    expect(captured.attribution).toEqual({});
    expect(Object.hasOwn(wireNode(captured.snapshot, 'ses_a'), 'task_id')).toBe(false);

    runState = 'completed';
    shownModel = model;
    await draw();
    expect(pending).toHaveLength(2);

    // Re-renders without a new terminal transition must not add a request.
    await draw();
    await draw();
    expect(pending).toHaveLength(2);

    await act(async () => {
      pending[1]?.resolve(attributionBody({
        ses_a: { taskId: 'st_a', nodeId: 'node_alpha' },
        ses_b: { taskId: 'st_b' },
      }));
      await drain();
    });
    expect(captured.attribution).toEqual({
      ses_a: { taskId: 'st_a', nodeId: 'node_alpha' },
      ses_b: { taskId: 'st_b' },
    });
    const alpha = wireNode(captured.snapshot, 'ses_a');
    expect(alpha.task_id).toBe('st_a');
    expect(alpha.node_id).toBe('node_alpha');
    const beta = wireNode(captured.snapshot, 'ses_b');
    expect(beta.task_id).toBe('st_b');
    expect(Object.hasOwn(beta, 'node_id')).toBe(false);

    await act(async () => {
      root.unmount();
    });
    expect(pending[1]?.init?.signal?.aborted).toBe(true);
  } finally {
    restore();
  }
});

test('a run that stays live never refetches', async () => {
  installDom();
  const { pending, restore } = stubAttributionFetch();
  try {
    const { createRoot } = await import('react-dom/client');
    const captured: CapturedRender = { attribution: null, snapshot: null };
    let labelTick = 0;
    const draw = () => act(async () => {
      root.render(
        <AttributionHarness
          captured={captured}
          conversationId="ses_parent01"
          directory="/repo"
          runState="running"
          model={{ ...liveModel, label: `Repository analysis ${labelTick}` }}
        />,
      );
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await draw();
    expect(pending).toHaveLength(1);
    await act(async () => {
      pending[0]?.resolve(attributionBody({ ses_a: { taskId: 'st_a' } }));
      await drain();
    });
    expect(captured.attribution).toEqual({ ses_a: { taskId: 'st_a' } });

    for (let index = 0; index < 3; index += 1) {
      labelTick += 1;
      await draw();
    }
    expect(pending).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
    expect(pending[0]?.init?.signal?.aborted).toBe(true);
  } finally {
    restore();
  }
});

test('a terminal transition aborts the live reading and ignores its late result', async () => {
  installDom();
  const { pending, restore } = stubAttributionFetch();
  try {
    const { createRoot } = await import('react-dom/client');
    const captured: CapturedRender = { attribution: null, snapshot: null };
    let runState: DagParentState = 'running';
    let shownModel = liveModel;
    const draw = () => act(async () => {
      root.render(
        <AttributionHarness
          captured={captured}
          conversationId="ses_parent01"
          directory="/repo"
          runState={runState}
          model={shownModel}
        />,
      );
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await draw();
    expect(pending).toHaveLength(1);

    // The run settles before the live reading did: the old request is aborted
    // and a second one starts, so at most one request stays in flight.
    runState = 'failed';
    shownModel = { ...model, state: 'failed' };
    await draw();
    expect(pending[0]?.init?.signal?.aborted).toBe(true);
    expect(pending).toHaveLength(2);

    await act(async () => {
      pending[0]?.resolve(attributionBody({ ses_a: { taskId: 'st_late', nodeId: 'node_late' } }));
      await drain();
    });
    expect(captured.attribution).toBeNull();
    expect(Object.hasOwn(wireNode(captured.snapshot, 'ses_a'), 'task_id')).toBe(false);

    await act(async () => {
      pending[1]?.resolve(attributionBody({ ses_a: { taskId: 'st_a' } }));
      await drain();
    });
    expect(captured.attribution).toEqual({ ses_a: { taskId: 'st_a' } });
    expect(wireNode(captured.snapshot, 'ses_a').task_id).toBe('st_a');
    expect(Object.hasOwn(wireNode(captured.snapshot, 'ses_a'), 'node_id')).toBe(false);

    await act(async () => {
      root.unmount();
    });
    expect(pending[1]?.init?.signal?.aborted).toBe(true);
  } finally {
    restore();
  }
});

test('a missing conversation or directory asks for nothing', async () => {
  installDom();
  const { pending, restore } = stubAttributionFetch();
  try {
    const { createRoot } = await import('react-dom/client');
    const captured: CapturedRender = { attribution: null, snapshot: null };
    let conversationId: string | null = null;
    let directory: string | undefined = '/repo';
    const draw = () => act(async () => {
      root.render(
        <AttributionHarness
          captured={captured}
          conversationId={conversationId}
          directory={directory}
          runState="completed"
          model={model}
        />,
      );
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await draw();
    expect(pending).toHaveLength(0);
    expect(captured.attribution).toBeNull();

    conversationId = 'ses_parent01';
    directory = undefined;
    await draw();
    expect(pending).toHaveLength(0);
    expect(captured.attribution).toBeNull();

    directory = '';
    await draw();
    expect(pending).toHaveLength(0);
    expect(captured.attribution).toBeNull();

    directory = '/repo';
    await draw();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.url.searchParams.get('directory')).toBe('/repo');

    await act(async () => {
      root.unmount();
    });
    expect(pending[0]?.init?.signal?.aborted).toBe(true);
  } finally {
    restore();
  }
});
