// Code-view dependency graph model: the wire ego-graph the runtime returns
// must reach the panel as a drawable model, and a subject with no graph must
// read as absent (the panel states that) rather than as an empty canvas.

import { describe, expect, test } from 'bun:test';

import { buildCodeGraphModel, codeGraphLayoutSpec } from './code-view.ts';

const SUBJECT = 'const:clampScale@packages/extensions/dag-pane/panel/viewport.ts';
const CALLER = 'const:anchorView@packages/extensions/dag-pane/panel/viewport.ts';
const CALLER_TWO = 'const:nextZoomScale@packages/extensions/dag-pane/panel/viewport.ts';
const DEPENDENT = 'file:packages/extensions/dag-pane/panel/main.ts';

const wireBody = (graph: unknown) => ({ graph });

const populatedGraph = {
  subjectId: SUBJECT,
  nodes: [
    { id: SUBJECT, kind: 'symbol', name: 'clampScale', file: 'packages/extensions/dag-pane/panel/viewport.ts', line: 21, subject: true },
    { id: CALLER, kind: 'symbol', name: 'anchorView', file: 'packages/extensions/dag-pane/panel/viewport.ts', line: 32 },
    { id: CALLER_TWO, kind: 'symbol', name: 'nextZoomScale', file: 'packages/extensions/dag-pane/panel/viewport.ts', line: 27 },
    { id: DEPENDENT, kind: 'file', name: 'packages/extensions/dag-pane/panel/main.ts' },
  ],
  edges: [
    { id: 'e1', kind: 'CALLS_STATIC', from: CALLER, to: SUBJECT, confidence: 1 },
    { id: 'e2', kind: 'CALLS_STATIC', from: CALLER, to: SUBJECT, confidence: 1 },
    { id: 'e3', kind: 'CALLS_STATIC', from: CALLER_TWO, to: SUBJECT, confidence: 0.8 },
    { id: 'e4', kind: 'IMPORTS', from: DEPENDENT, to: SUBJECT, confidence: 1 },
    { id: 'e5', kind: 'DEFINES', from: SUBJECT, to: DEPENDENT, confidence: 1 },
  ],
  truncated: false,
};

describe('buildCodeGraphModel', () => {
  test('keeps the real nodes and collapses parallel call sites into one counted edge', () => {
    const model = buildCodeGraphModel(wireBody(populatedGraph));
    expect(model).not.toBeNull();
    if (model === null) return;
    expect(model.subjectId).toBe(SUBJECT);
    expect(model.nodes.map((node) => node.id)).toEqual([SUBJECT, CALLER, CALLER_TWO, DEPENDENT]);
    const subject = model.nodes.find((node) => node.id === SUBJECT);
    expect(subject?.subject).toBe(true);
    expect(subject?.label).toBe('clampScale');
    expect(subject?.line).toBe(21);
    const fileNode = model.nodes.find((node) => node.id === DEPENDENT);
    expect(fileNode?.label).toBe('main.ts');
    const callerEdge = model.edges.find((edge) => edge.from === CALLER && edge.to === SUBJECT);
    expect(callerEdge?.sites).toBe(2);
    const zoomEdge = model.edges.find((edge) => edge.from === CALLER_TWO);
    expect(zoomEdge?.confidence).toBe(0.8);
    expect(model.edges).toHaveLength(4);
  });

  test('drops edges whose endpoints are not in the node set instead of inventing a node', () => {
    const model = buildCodeGraphModel(wireBody({
      ...populatedGraph,
      edges: [...populatedGraph.edges, { id: 'x', kind: 'CALLS_STATIC', from: 'const:ghost@nowhere.ts', to: SUBJECT, confidence: 1 }],
    }));
    expect(model?.edges.some((edge) => edge.from === 'const:ghost@nowhere.ts')).toBe(false);
    expect(model?.nodes).toHaveLength(4);
  });

  test('reads a missing, empty, or malformed graph as absent', () => {
    expect(buildCodeGraphModel(null)).toBeNull();
    expect(buildCodeGraphModel({})).toBeNull();
    expect(buildCodeGraphModel(wireBody({ subjectId: SUBJECT, nodes: [], edges: [] }))).toBeNull();
    expect(buildCodeGraphModel(wireBody('not-a-graph'))).toBeNull();
    expect(buildCodeGraphModel(wireBody({ nodes: populatedGraph.nodes, edges: [] }))).toBeNull();
  });

  test('carries the truncation flag the runtime reported', () => {
    const model = buildCodeGraphModel(wireBody({ ...populatedGraph, truncated: true }));
    expect(model?.truncated).toBe(true);
  });
});

describe('codeGraphLayoutSpec', () => {
  test('places callers left of the subject and dependents right of it', () => {
    const model = buildCodeGraphModel(wireBody(populatedGraph));
    if (model === null) throw new Error('model missing');
    const spec = codeGraphLayoutSpec(model);
    const at = (id: string) => spec.nodes.find((node) => node.id === id);
    const subject = at(SUBJECT);
    const caller = at(CALLER);
    const dependent = at(DEPENDENT);
    expect(subject).toBeDefined();
    expect(caller).toBeDefined();
    expect(dependent).toBeDefined();
    if (!subject || !caller || !dependent) return;
    expect(caller.x).toBeLessThan(subject.x);
    expect(dependent.x).toBeGreaterThan(subject.x);
    expect(spec.width).toBeGreaterThan(subject.x);
    expect(spec.height).toBeGreaterThan(subject.y);
  });

  test('anchors every edge on the drawn node boxes', () => {
    const model = buildCodeGraphModel(wireBody(populatedGraph));
    if (model === null) throw new Error('model missing');
    const spec = codeGraphLayoutSpec(model);
    expect(spec.edges.length).toBe(model.edges.length);
    const boxes = new Map(spec.nodes.map((node) => [node.id, node]));
    for (const edge of spec.edges) {
      const from = boxes.get(edge.from);
      const to = boxes.get(edge.to);
      if (!from || !to) throw new Error(`edge endpoint not drawn: ${edge.from} -> ${edge.to}`);
      expect(edge.x1).toBe(from.x + from.width);
      expect(edge.x2).toBe(to.x);
      expect(edge.y1).toBe(from.y + from.height / 2);
      expect(edge.y2).toBe(to.y + to.height / 2);
    }
  });
});
