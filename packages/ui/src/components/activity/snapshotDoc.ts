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
  // The DAG node that owns the child task. Optional for the same reason:
  // a legacy document (and a task without a DAG owner) carries none.
  node_id: z.string().optional(),
  // The projection's authoritative per-node block. Without it the only claim that reaches this parser is the
  // flat `verification_status` a snapshot happened to write, so a node whose record says Verified or Blocked
  // rendered as Unverified - a claim the data never made.
  delivery: z
    .object({ status: z.string().optional(), verificationStatus: z.string().optional() })
    .passthrough()
    .optional(),
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

const taskSchema = z
  .object({
    task_id: z.string(),
    status: z.string(),
    name: z.string().optional(),
    task_summary: z.string().optional(),
    node_id: z.string().optional(),
    verification_status: z.string().optional(),
  })
  // The row also carries repair, delivery and provenance: they are kept, never rejected, so a later renderer does not
  // need a schema change to read what the server already sent.
  .passthrough();

const docSchema = z.object({
  sessionId: z.string(),
  schemaVersion: z.literal(1),
  dag: z.object({ runs: z.array(runSchema) }).nullish(),
  // Canonical task records are a second source: a conversation can have rows and no runs at all, so dropping this key
  // would make a record-only answer parse as a complete, empty snapshot.
  tasks: z
    .object({
      // A container that reports a failed or absent read carries flags but no list; requiring the array
      // rejected the whole document, so a side-store failure erased a complete run graph.
      tasks: z.array(taskSchema).optional(),
      recordError: z.string().optional(),
      recordAbsent: z.boolean().optional(),
      diagnostics: z.object({ limitReached: z.boolean().optional() }).passthrough().optional(),
    })
    .nullish(),
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
  /** DAG node id that owns the child task, when the writer recorded one. */
  nodeId?: string;
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

export type SnapshotTask = {
  taskId: string;
  status: string;
  name?: string;
  summary?: string;
  nodeId?: string;
  verificationStatus?: VerificationStatus;
};

export type SnapshotDoc = {
  sessionId: string;
  runs: SnapshotRun[];
  /** Rows the canonical task store contributed, with the flags that say the read was partial. */
  tasks?: SnapshotTask[];
  /** The task store could not be read: never render this as "no tasks". */
  recordError?: string;
  /** The task store does not exist yet for this project. */
  recordAbsent?: boolean;
  /** The store was larger than the read limit, so the row list is not the whole store. */
  truncated?: boolean;
};

/**
 * Narrow reader for the persisted engine snapshot envelope. Anything
 * off-shape answers null: malformed snapshots are unknown, never partial.
 */
export const parseSnapshotDoc = (raw: JsonValue): SnapshotDoc | null => {
  const result = docSchema.safeParse(raw);
  if (!result.success) return null;
  const tasksContainer = result.data.tasks;
  const tasks = (tasksContainer?.tasks ?? []).map((task) => {
    const parsed: SnapshotTask = { taskId: task.task_id, status: task.status };
    if (task.name !== undefined && task.name.length > 0) parsed.name = task.name;
    if (task.task_summary !== undefined && task.task_summary.length > 0) parsed.summary = task.task_summary;
    if (task.node_id !== undefined && task.node_id.length > 0) parsed.nodeId = task.node_id;
    const verification = parseVerificationStatus(task.verification_status);
    if (verification !== undefined) parsed.verificationStatus = verification;
    return parsed;
  });
  const doc: SnapshotDoc = { sessionId: result.data.sessionId, runs: [] };
  // A legacy document with no task container gains no `tasks` key at all: absence must stay distinguishable from an
  // empty record source, which is what a record-only answer carries.
  if (tasksContainer !== undefined && tasksContainer !== null) doc.tasks = tasks;
  if (tasksContainer?.recordError !== undefined) doc.recordError = tasksContainer.recordError;
  if (tasksContainer?.recordAbsent !== undefined) doc.recordAbsent = tasksContainer.recordAbsent;
  if (tasksContainer?.diagnostics?.limitReached === true) doc.truncated = true;
  doc.runs = (result.data.dag?.runs ?? []).map((run) => ({
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
        // Same precedence the DAG pane reads: the projection's delivery claim names the verdict, and the flat
        // field is the older carrier. Neither present means no claim, which stays undefined.
        verificationStatus:
          parseVerificationStatus(node.delivery?.verificationStatus) ?? parseVerificationStatus(node.verification_status),
      };
      // Present only when the wire carried a real child task id: an absent
      // attribution must stay absent rather than becoming an empty field.
      if (node.task_id !== undefined && node.task_id.length > 0) {
        parsed.taskId = node.task_id;
      }
      // Same rule for the owning DAG node id: present only when the wire
      // carried one, so an absent attribution never becomes an empty field.
      if (node.node_id !== undefined && node.node_id.length > 0) {
        parsed.nodeId = node.node_id;
      }
      return parsed;
    }),
    edges: run.edges?.map((edge) => ({ from: edge.from, to: edge.to })) ?? [],
    waves: run.waves?.map((wave) => ({ index: wave.index, nodeIds: [...wave.node_ids] })) ?? [],
  }));
  return doc;
};
