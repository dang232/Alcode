import { z } from 'zod';

import type { JsonValue } from '@alcode/sdk';

const nodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.string(),
  prompt: z.string(),
  depends_on: z.array(z.string()),
});

const edgeSchema = z.object({ from: z.string(), to: z.string() });

const waveSchema = z.object({ index: z.number(), node_ids: z.array(z.string()) });

const runSchema = z.object({
  run_id: z.string(),
  run_key: z.string(),
  name: z.string(),
  status: z.string(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema).optional(),
  waves: z.array(waveSchema).optional(),
});

const docSchema = z.object({
  sessionId: z.string(),
  schemaVersion: z.literal(1),
  dag: z.object({ runs: z.array(runSchema) }).nullish(),
});

export type SnapshotNode = {
  id: string;
  label: string;
  state: string;
  prompt: string;
  dependsOn: string[];
};

export type SnapshotRun = {
  runId: string;
  runKey: string;
  name: string;
  status: string;
  nodes: SnapshotNode[];
  edges: { from: string; to: string }[];
  waves: { index: number; nodeIds: string[] }[];
};

export type SnapshotDoc = {
  sessionId: string;
  runs: SnapshotRun[];
};

/**
 * Narrow reader for the persisted engine snapshot envelope. Anything
 * off-shape answers null: malformed snapshots are unknown, never partial.
 */
export const parseSnapshotDoc = (raw: JsonValue): SnapshotDoc | null => {
  const result = docSchema.safeParse(raw);
  if (!result.success) return null;
  return {
    sessionId: result.data.sessionId,
    runs: (result.data.dag?.runs ?? []).map((run) => ({
      runId: run.run_id,
      runKey: run.run_key,
      name: run.name,
      status: run.status,
      nodes: run.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        state: node.state,
        prompt: node.prompt,
        dependsOn: [...node.depends_on],
      })),
      edges: run.edges?.map((edge) => ({ from: edge.from, to: edge.to })) ?? [],
      waves: run.waves?.map((wave) => ({ index: wave.index, nodeIds: [...wave.node_ids] })) ?? [],
    })),
  };
};
