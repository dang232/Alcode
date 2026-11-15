import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import { mergeRecordTasks, rowsForConversation } from './record-tasks.js';

let recordReaderPromise = null;

const RUNS_DIRNAME = 'dag-runs';
const SNAPSHOT_SUFFIX = '.snapshot.json';

// The repair and attribution projections are bundled with the verification host
// actions because that is the one entry the Node server builds from engine
// TypeScript: `build:verification` writes
// `server/dist/verification-approval.js`. Loading the artifact (never the .ts
// source) keeps this module runnable under Node.
const VERIFICATION_BUNDLE = '../../dist/verification-approval.js';

const asText = (value) => `${value ?? ''}`.trim();

// String-valued read without a typeof test: only a real string primitive
// stringifies to itself, so numbers/objects/arrays all read as absent.
const asString = (value) => (String(value) === value ? value : null);

const isRecord = (value) => value instanceof Object && !Array.isArray(value);

const messageOf = (error, fallback) => {
  const text = error instanceof Error ? asString(error.message) : null;
  return text !== null && text.length > 0 ? text : fallback;
};

const isSafeConversationId = (value) => {
  const text = asText(value);
  return text.length > 0 && !/[\\/]/.test(text) && !text.includes('..');
};

// One lazy, process-wide load: a successful bundle load yields the reader;
// a missing/stale bundle yields an explicit error that every record surfaces
// as `repairError` - it must never read as "no repair".
let repairReaderPromise = null;

const loadRepairReader = () => {
  if (repairReaderPromise === null) {
    repairReaderPromise = import(VERIFICATION_BUNDLE)
      .then((module) => {
        const factory = module.createRepairStateReader;
        if (!(factory instanceof Function)) {
          throw new Error('repair state reader is missing from the verification bundle');
        }
        return factory();
      })
      .catch((error) => ({
        error: `repair state unavailable: ${messageOf(error, 'the verification bundle could not be loaded')}`,
      }));
  }
  return repairReaderPromise;
};

// Same lazy, process-wide load as the repair reader: a stale artifact surfaces
// as an explicit attribution error instead of reading as "no attribution".
let attributionReaderPromise = null;

const loadRecordReader = () => {
  if (recordReaderPromise === null) {
    recordReaderPromise = import(VERIFICATION_BUNDLE)
      .then((module) => {
        const factory = module.createRecordTaskReaderForProject;
        if (!(factory instanceof Function)) {
          throw new Error("verification bundle exposes no record task reader");
        }
        return factory();
      })
      .catch((error) => {
        recordReaderPromise = null;
        throw error;
      });
  }
  return recordReaderPromise;
};

const loadAttributionReader = () => {
  if (attributionReaderPromise === null) {
    attributionReaderPromise = import(VERIFICATION_BUNDLE)
      .then((module) => {
        const factory = module.createAttributionStateReader;
        if (!(factory instanceof Function)) {
          throw new Error('attribution state reader is missing from the verification bundle');
        }
        return factory();
      })
      .catch((error) => ({
        error: `attribution state unavailable: ${messageOf(error, 'the verification bundle could not be loaded')}`,
      }));
  }
  return attributionReaderPromise;
};

let deliveryReaderPromise = null;

const loadDeliveryReader = () => {
  if (deliveryReaderPromise === null) {
    deliveryReaderPromise = import(VERIFICATION_BUNDLE)
      .then((module) => {
        const factory = module.createDeliveryStateReader;
        if (!(factory instanceof Function)) {
          throw new Error('delivery state reader is missing from the verification bundle');
        }
        return factory();
      })
      .catch((error) => ({
        error: `delivery state unavailable: ${messageOf(error, 'the verification bundle could not be loaded')}`,
      }));
  }
  return deliveryReaderPromise;
};

const readEntryRepair = async (readRepairState, directory, taskId) => {
  try {
    const result = await readRepairState({ directory, taskId });
    if (!isRecord(result)) {
      return { error: `repair state reader returned an invalid result for ${taskId}` };
    }
    if (isRecord(result.repair)) return { repair: result.repair };
    const error = asString(result.error);
    return error !== null && error.length > 0 ? { error } : {};
  } catch (error) {
    return { error: `repair state read failed for ${taskId}: ${messageOf(error, 'read failed')}` };
  }
};

const attachToEntries = async (readRepairState, directory, entries, idField) =>
  Promise.all(
    entries.map(async (entry) => {
      if (!isRecord(entry)) return entry;
      const taskId = asString(entry[idField]);
      if (taskId === null || taskId.length === 0) return entry;
      const outcome = await readEntryRepair(readRepairState, directory, taskId);
      if (outcome.repair !== undefined) return { ...entry, repair: outcome.repair };
      if (outcome.error !== undefined) return { ...entry, repairError: outcome.error };
      return entry;
    }),
  );

/**
 * Attach persisted repair state to each run and task record.
 *
 * Sources: `dag.runs[].run_id` and `tasks.tasks[].task_id` name the senpi
 * task whose store is read. A current-epoch attempt adds `repair`; a stale
 * attempt adds nothing; an unreadable store adds `repairError` instead of
 * silently looking like "no repair".
 */
const attachRepairState = async (document, { directory, readRepairState }) => {
  if (!isRecord(document)) return document;
  const runEntries = isRecord(document.dag) && Array.isArray(document.dag.runs) ? document.dag.runs : null;
  const taskEntries = isRecord(document.tasks) && Array.isArray(document.tasks.tasks) ? document.tasks.tasks : null;
  if (runEntries === null && taskEntries === null) return document;
  const [runs, tasks] = await Promise.all([
    runEntries === null ? null : attachToEntries(readRepairState, directory, runEntries, 'run_id'),
    taskEntries === null ? null : attachToEntries(readRepairState, directory, taskEntries, 'task_id'),
  ]);
  let next = document;
  if (runs !== null) next = { ...next, dag: { ...document.dag, runs } };
  if (tasks !== null) next = { ...next, tasks: { ...document.tasks, tasks } };
  return next;
};

const isChatRun = (run) => {
  const runKey = asString(run.run_key);
  return runKey !== null && runKey.startsWith('chat:');
};

const nodeIdForTask = (byTaskId, taskId) => {
  if (!isRecord(byTaskId)) return null;
  const entry = byTaskId[taskId];
  return isRecord(entry) ? asString(entry.nodeId) : null;
};

const childEntry = (byChildSessionId, childSessionId) => {
  if (!isRecord(byChildSessionId)) return null;
  const entry = byChildSessionId[childSessionId];
  return isRecord(entry) ? entry : null;
};

/**
 * Project the attribution index onto a snapshot document without rewriting it.
 *
 * - `tasks.tasks[].node_id` comes from the record indexed by that `task_id`.
 * - A node in a chat run gets `task_id` (and `node_id` when the record carries
 *   one) only when its id is a known `child_session_id`.
 * - A collision is surfaced as `attributionCollisions`; the colliding session
 *   is never enriched, so read order cannot pick a winner.
 */
const attachAttribution = (document, index) => {
  if (!isRecord(document)) return document;
  const byTaskId = index.byTaskId;
  const byChildSessionId = index.byChildSessionId;
  let next = document;

  const taskEntries = isRecord(document.tasks) && Array.isArray(document.tasks.tasks) ? document.tasks.tasks : null;
  if (taskEntries !== null) {
    let tasksChanged = false;
    const tasks = taskEntries.map((entry) => {
      if (!isRecord(entry)) return entry;
      const taskId = asString(entry.task_id);
      if (taskId === null || taskId.length === 0) return entry;
      const nodeId = nodeIdForTask(byTaskId, taskId);
      if (nodeId === null || nodeId.length === 0) return entry;
      tasksChanged = true;
      return { ...entry, node_id: nodeId };
    });
    if (tasksChanged) next = { ...next, tasks: { ...document.tasks, tasks } };
  }

  const runEntries = isRecord(document.dag) && Array.isArray(document.dag.runs) ? document.dag.runs : null;
  if (runEntries !== null) {
    let runsChanged = false;
    const runs = runEntries.map((run) => {
      if (!isRecord(run) || !isChatRun(run) || !Array.isArray(run.nodes)) return run;
      const nodes = run.nodes.map((node) => {
        if (!isRecord(node)) return node;
        const nodeId = asString(node.id);
        if (nodeId === null || nodeId.length === 0) return node;
        const entry = childEntry(byChildSessionId, nodeId);
        if (entry === null) return node;
        const taskId = asString(entry.taskId);
        if (taskId === null || taskId.length === 0) return node;
        const ownedNodeId = asString(entry.nodeId);
        const enriched = { ...node, task_id: taskId };
        if (ownedNodeId !== null && ownedNodeId.length > 0) enriched.node_id = ownedNodeId;
        return enriched;
      });
      const changed = nodes.some((node, position) => node !== run.nodes[position]);
      if (!changed) return run;
      runsChanged = true;
      return { ...run, nodes };
    });
    if (runsChanged) next = { ...next, dag: { ...document.dag, runs } };
  }

  if (Array.isArray(index.collisions) && index.collisions.length > 0) {
    next = { ...next, attributionCollisions: index.collisions };
  }
  return next;
};

/**
 * Read attribution state and attach it to the document.
 *
 * A reader failure is an explicit `attributionError` field: it must never be
 * swallowed into a document that looks like "no attribution".
 */
const attachAttributionState = async (document, { directory, readAttributionState }) => {
  if (!isRecord(document)) return document;
  let index;
  try {
    index = await readAttributionState({ directory });
  } catch (error) {
    return { ...document, attributionError: `attribution state read failed: ${messageOf(error, 'read failed')}` };
  }
  if (!isRecord(index)) {
    return { ...document, attributionError: 'attribution state reader returned an invalid result' };
  }
  const error = asString(index.error);
  if (error !== null && error.length > 0) {
    return { ...document, attributionError: error };
  }
  return attachAttribution(document, index);
};

const attachDeliveryToEntries = async (readDeliveryState, directory, entries) =>
  Promise.all(
    entries.map(async (entry) => {
      if (!isRecord(entry)) return entry;
      const taskId = asString(entry.task_id ?? entry.run_id);
      if (taskId === null || taskId.length === 0) return entry;
      if (isRecord(entry.delivery)) return entry;
      let result;
      try {
        result = await readDeliveryState({ directory, taskId });
      } catch (error) {
        return { ...entry, deliveryError: `delivery state read failed for ${taskId}: ${messageOf(error, 'read failed')}` };
      }
      if (!isRecord(result)) return { ...entry, deliveryError: `delivery state reader returned an invalid result for ${taskId}` };
      if (isRecord(result.delivery)) return { ...entry, delivery: result.delivery };
      const error = asString(result.error);
      if (error !== null && error.length > 0) return { ...entry, deliveryError: error };
      return entry;
    }),
  );

/**
 * Attach the authoritative delivery status and verification claim of each named task record.
 * Absence produces no field; a read failure produces `deliveryError`, never a silent "no delivery".
 */
const attachDeliveryState = async (document, { directory, readDeliveryState }) => {
  if (!isRecord(document)) return document;
  const runEntries = isRecord(document.dag) && Array.isArray(document.dag.runs) ? document.dag.runs : null;
  const taskEntries = isRecord(document.tasks) && Array.isArray(document.tasks.tasks) ? document.tasks.tasks : null;
  if (runEntries === null && taskEntries === null) return document;

  const runs = runEntries === null ? null : await Promise.all(
    runEntries.map(async (run) => {
      if (!isRecord(run) || !Array.isArray(run.nodes)) return run;
      const nodes = await attachDeliveryToEntries(readDeliveryState, directory, run.nodes);
      const changed = nodes.some((node, position) => node !== run.nodes[position]);
      return changed ? { ...run, nodes } : run;
    }),
  );
  const tasks = taskEntries === null ? null : await attachDeliveryToEntries(readDeliveryState, directory, taskEntries);

  let next = document;
  if (runs !== null) next = { ...next, dag: { ...document.dag, runs } };
  if (tasks !== null) next = { ...next, tasks: { ...document.tasks, tasks } };
  return next;
};

let reconcilePromise = null;

const loadReconciler = () => {
  if (reconcilePromise === null) {
    reconcilePromise = import(VERIFICATION_BUNDLE)
      .then((module) => {
        const factory = module.createSnapshotReconciler;
        if (!(factory instanceof Function)) {
          throw new Error('snapshot reconciler is missing from the verification bundle');
        }
        return factory();
      })
      .catch((error) => ({
        error: `reconcile unavailable: ${messageOf(error, 'the verification bundle could not be loaded')}`,
      }));
  }
  return reconcilePromise;
};

export const createRunGraphRuntime = (overrides = {}) => {
  const fs = overrides.fs ?? fsPromises;
  const joinPath = overrides.joinPath ?? path.join;
  const normalizePath = overrides.normalizePath ?? path.normalize;
  const injectedRepairReader = overrides.readRepairState;
  const injectedAttributionReader = overrides.readAttributionState;
  const injectedDeliveryReader = overrides.readDeliveryState;
  const injectedReconciler = overrides.reconcileSnapshots;
  const injectedRecordReader = overrides.readRecordTasks;

  const readRepairState = async (input) => {
    if (injectedRepairReader !== undefined) return injectedRepairReader(input);
    const reader = await loadRepairReader();
    if (reader instanceof Function) return reader(input);
    return reader;
  };

  const readAttributionState = async (input) => {
    if (injectedAttributionReader !== undefined) return injectedAttributionReader(input);
    const reader = await loadAttributionReader();
    if (reader instanceof Function) return reader(input);
    return reader;
  };

  const readDeliveryState = async (input) => {
    if (injectedDeliveryReader !== undefined) return injectedDeliveryReader(input);
    const reader = await loadDeliveryReader();
    if (reader instanceof Function) return reader(input);
    return reader;
  };

  const normalizeDirectory = async (directory) => {
    const trimmed = asText(directory);
    if (!trimmed) {
      return { error: 'directory is required' };
    }
    const normalized = normalizePath(trimmed);
    let stat = null;
    try {
      stat = await fs.stat(normalized);
    } catch {
      return { error: `directory not found: ${trimmed}`, status: 404 };
    }
    if (!stat.isDirectory()) {
      return { error: `not a directory: ${trimmed}`, status: 404 };
    }
    return { directory: normalized };
  };

  const readSnapshot = async (directory, conversationId) => {
    const id = asText(conversationId);
    if (!isSafeConversationId(id)) {
      return { error: 'conversationId is required', status: 400 };
    }
    const filePath = joinPath(directory, '.omo', RUNS_DIRNAME, `${id}${SNAPSHOT_SUFFIX}`);
    const normalized = normalizePath(filePath);
    const root = normalizePath(joinPath(directory, '.omo', RUNS_DIRNAME));
    if (normalized !== joinPath(root, `${id}${SNAPSHOT_SUFFIX}`)) {
      return { error: 'conversationId is required', status: 400 };
    }
    let raw = null;
    try {
      raw = await fs.readFile(normalized, 'utf8');
    } catch {
      // A project whose only task came through the capability path has records and no snapshot.
      // Answer the rows it really has instead of hiding them behind a 404; with no records the
      // 404 stays, because a conversation that never ran has no graph.
      const reader = injectedRecordReader ?? (await loadRecordReader());
      const records = reader({ directory });
      const all = records?.error === undefined && Array.isArray(records?.tasks) ? records.tasks : [];
      // Only this conversation's tasks: the record reader has no session filter, so the unfiltered list would answer
      // every conversation in the project with the same rows and a parent they do not have.
      const rows = rowsForConversation(all, id);
      if (rows.length === 0) return { error: `no run snapshot for conversation: ${id}`, status: 404 };
      return {
        schemaVersion: 1,
        sessionId: id,
        tasks: { parent_session_id: id, tasks: rows },
        dag: { parent_session_id: id, runs: [] },
      };
    }
    let document = null;
    try {
      document = JSON.parse(raw);
    } catch {
      const error = new Error(`run snapshot is malformed: ${id}`);
      error.status = 500;
      throw error;
    }
    const withRepair = await attachRepairState(document, { directory, readRepairState });
    const withAttribution = await attachAttributionState(withRepair, { directory, readAttributionState });
    const withDelivery = await attachDeliveryState(withAttribution, { directory, readDeliveryState });
    const recordReader = injectedRecordReader ?? (await loadRecordReader());
    const records = recordReader({ directory });
    if (records?.error !== undefined || !Array.isArray(records?.tasks)) return withDelivery;
    return mergeRecordTasks(withDelivery, rowsForConversation(records.tasks, id));
  };

  const readAttribution = async (directory) => {
    const result = await readAttributionState({ directory });
    if (!isRecord(result)) {
      return { error: 'attribution state reader returned an invalid result' };
    }
    return result;
  };

  const reconcileSnapshots = async (directory) => {
    if (injectedReconciler !== undefined) return injectedReconciler({ directory });
    const reconciler = await loadReconciler();
    if (reconciler instanceof Function) return reconciler({ directory });
    return reconciler;
  };

  return { normalizeDirectory, readSnapshot, readAttribution, reconcileSnapshots };
};
