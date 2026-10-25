import type { CodeGraphTopology } from '@/lib/codeGraphApi';

export const NODE_WIDTH = 148;
export const NODE_HEIGHT = 46;
const COLUMN_GAP = 72;
const ROW_GAP = 14;

export interface CodeGraphDrawnNode {
  id: string;
  label: string;
  kind: string;
  fileName?: string;
  line?: number;
  subject: boolean;
  x: number;
  y: number;
}

export interface CodeGraphDrawnEdge {
  from: string;
  to: string;
  kind: string;
  confidence: number;
  sites: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CodeGraphLayout {
  nodes: CodeGraphDrawnNode[];
  edges: CodeGraphDrawnEdge[];
  width: number;
  height: number;
}

const shortLabel = (id: string, name: string | undefined): string => {
  const head = (() => {
    if (name) return name;
    const at = id.indexOf('@');
    const bare = at === -1 ? id : id.slice(0, at);
    const colon = bare.indexOf(':');
    return colon === -1 ? bare : bare.slice(colon + 1);
  })();
  const tail = head.split('/').filter((part) => part.length > 0).pop() ?? head;
  return tail.length > 22 ? `${tail.slice(0, 21)}…` : tail;
};

/**
 * Three-column dependency layout over directed edges: callers/importers on
 * the left, the subject in the middle, dependents on the right. A node
 * reached in both directions sits with the dependents so its back-edge
 * crosses the subject instead of dropping the node. Column membership comes
 * from the edges themselves, so the picture states relationship direction
 * instead of flattening the neighbourhood into a star.
 */
export const layoutCodeGraph = (graph: CodeGraphTopology): CodeGraphLayout => {
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.to === graph.subjectId && edge.from !== graph.subjectId) inbound.add(edge.from);
    if (edge.from === graph.subjectId && edge.to !== graph.subjectId) outbound.add(edge.to);
  }
  const left = [...inbound].filter((id) => !outbound.has(id));
  const right = [...outbound].filter((id) => !inbound.has(id));
  const placed = new Set([...left, ...right, graph.subjectId]);
  for (const node of graph.nodes) {
    if (!placed.has(node.id)) {
      placed.add(node.id);
      right.push(node.id);
    }
  }
  const columns = [left, [graph.subjectId], right];
  const rows = Math.max(...columns.map((column) => column.length));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes: CodeGraphDrawnNode[] = [];
  columns.forEach((column, columnIndex) => {
    const offset = (rows - column.length) / 2;
    column.forEach((id, rowIndex) => {
      const node = byId.get(id);
      if (!node) return;
      nodes.push({
        id: node.id,
        label: shortLabel(node.id, node.name),
        kind: node.kind,
        ...(node.file ? { fileName: node.file } : {}),
        ...(typeof node.line === 'number' ? { line: node.line } : {}),
        subject: node.id === graph.subjectId,
        x: COLUMN_GAP + columnIndex * (NODE_WIDTH + COLUMN_GAP),
        y: COLUMN_GAP / 2 + (rowIndex + offset) * (NODE_HEIGHT + ROW_GAP),
      });
    });
  });
  const at = new Map(nodes.map((node) => [node.id, node]));
  const edges: CodeGraphDrawnEdge[] = [];
  for (const edge of graph.edges) {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (!from || !to) continue;
    edges.push({
      ...edge,
      x1: from.x + NODE_WIDTH,
      y1: from.y + NODE_HEIGHT / 2,
      x2: to.x,
      y2: to.y + NODE_HEIGHT / 2,
    });
  }
  return {
    nodes,
    edges,
    width: columns.length * (NODE_WIDTH + COLUMN_GAP) + COLUMN_GAP,
    height: rows * (NODE_HEIGHT + ROW_GAP) + COLUMN_GAP,
  };
};
