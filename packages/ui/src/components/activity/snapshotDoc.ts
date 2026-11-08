import { z } from 'zod';

import type { JsonValue } from '@alcode/sdk';
import { parseVerificationStatus, type VerificationStatus } from './verificationStatus';

const nodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  state: z.string(),
  prompt: z.string(),
  depends_on: z.array(z.string()),
  verification_status: z.string().optional(),
  // The child task record that executed this node. Optional because a node
  // with no child (and every legacy document) carries none; absent must stay
  // absent rather than being guessed.
  task_id: z.string().optional(),
});

const edgeSchema = z.object({ from: z.string(), to: z.string() });

const waveSchema = z.object({ index: z.number(), node_ids: z.array(z.string()) });

const runSchema = z.object({
  run_id: z.string(),
  run_key: z.string(),
  name: z.string(),
  status: z.string(),
  verification_status: z.string().optional(),
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
  /** Terminal completion claim, when the writer recorded one. Absent on older records. */
  verificationStatus?: VerificationStatus;
  /** Child task id that executed this node, when the writer recorded one. */
  taskId?: string;
};

export type SnapshotRun = {
  runId: string;
  runKey: string;
  name: string;
  status: string;
  /** Terminal completion claim for the run itself, when the writer recorded one. */
  verificationStatus?: VerificationStatus;
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
      verificationStatus: parseVerificationStatus(run.verification_status),
      nodes: run.nodes.map((node) => {
        const parsed: SnapshotNode = {
          id: node.id,
          label: node.label,
          state: node.state,
          prompt: node.prompt,
          dependsOn: [...node.depends_on],
          verificationStatus: parseVerificationStatus(node.verification_status),
        };
        // Present only when the wire carried a real child task id: an absent
        // attribution must stay absent rather than becoming an empty field.
        if (node.task_id !== undefined && node.task_id.length > 0) {
          parsed.taskId = node.task_id;
        }
        return parsed;
      }),
      edges: run.edges?.map((edge) => ({ from: edge.from, to: edge.to })) ?? [],
      waves: run.waves?.map((wave) => ({ index: wave.index, nodeIds: [...wave.node_ids] })) ?? [],
    })),
  };
};
