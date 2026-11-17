import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

import { mergeRecordTasks, reconcileRecordClaims, rowsForConversation } from './record-tasks.js';

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
const asString = (value) => {
  // A document field is untrusted input: coercion must degrade, never throw and hide the whole graph.
  try {
    return String(value) === value ? value : null;
  } catch {
    return null;
  }
};

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
// Exported so the DAG pane service can run the same projection the HTTP route runs: two copies of this chain
// drifted once already, and the service silently served less than the route.
export const attachRepairState = async (document, { directory, readRepairState }) => {
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
export const attachAttributionState = async (document, { directory, readAttributionState }) => {
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
export const attachDeliveryState = async (document, { directory, readDeliveryState }) => {
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

/**
 * Say out loud where the record side of a document came from.
 *
 * A graph built without its canonical records is a partial graph, and a partial graph that looks complete is worse than
 * an explicit failure: `recordError` marks a store that could not be read and `recordAbsent` marks one that does not
 * exist yet, so the panel can distinguish "no tasks" from "nobody could look".
 */
const INVALID_RECORD_RESULT = 'record task reader returned an invalid result';

// A reader that answers neither rows nor an explicit error is unusable, not empty: coercing it to "no rows" would
// present a broken reader as a conversation that never ran.
const normalizeRecordResult = (result) => {
  if (!isRecord(result)) return { error: INVALID_RECORD_RESULT };
  if (result.error !== undefined) return result;
  if (!Array.isArray(result.tasks)) return { error: INVALID_RECORD_RESULT };
  return result;
};

const describeRecordSource = (document, records) => {
  if (!isRecord(document)) return document;
  const container = isRecord(document.tasks) ? document.tasks : {};
  // Both clients require a `tasks` array. A flags-only container is unparseable, and an unparseable 200
  // body is discarded whole, so a failed side store would erase a complete snapshot's runs. Keep the
  // array present and put the partiality beside it.
  const base = Array.isArray(container.tasks) ? container : { ...container, tasks: [] };
  const error = asString(records?.error);
  if (error !== null && error.length > 0) return { ...document, tasks: { ...base, recordError: error } };
  if (records?.absent === true) return { ...document, tasks: { ...base, recordAbsent: true } };
  return document;
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

// A UNC path or a device path makes the filesystem dial a host the caller named: refusing it before any call stops a
// request from becoming an outbound SMB/WebDAV connection that authenticates with the user's own credentials.
const isNetworkOrDevicePath = (text) => text.startsWith('\\\\') || text.startsWith('//') || text.startsWith('\\\\.');

  const normalizeDirectory = async (directory) => {
    const trimmed = asText(directory);
    if (!trimmed) {
      return { error: 'directory is required', code: 'DAG_DIRECTORY_REQUIRED' };
    }
    if (isNetworkOrDevicePath(trimmed)) {
      return { error: 'directory must be a local path', status: 400, code: 'DAG_DIRECTORY_UNSUPPORTED' };
    }
    const normalized = normalizePath(trimmed);
    let stat = null;
    try {
      stat = await fs.stat(normalized);
    } catch {
      return { error: `directory not found: ${trimmed}`, status: 404, code: 'DAG_DIRECTORY_NOT_FOUND' };
    }
    if (!stat.isDirectory()) {
      return { error: `not a directory: ${trimmed}`, status: 404, code: 'DAG_DIRECTORY_NOT_FOUND' };
    }
    return { directory: normalized };
  };

  const readSnapshot = async (directory, conversationId) => {
    const id = asText(conversationId);
    if (!isSafeConversationId(id)) {
      return { error: 'conversationId is required', status: 400, code: 'DAG_CONVERSATION_ID_INVALID' };
    }
    const filePath = joinPath(directory, '.omo', RUNS_DIRNAME, `${id}${SNAPSHOT_SUFFIX}`);
    const normalized = normalizePath(filePath);
    const root = normalizePath(joinPath(directory, '.omo', RUNS_DIRNAME));
    if (normalized !== joinPath(root, `${id}${SNAPSHOT_SUFFIX}`)) {
      return { error: 'conversationId is required', status: 400, code: 'DAG_CONVERSATION_ID_INVALID' };
    }
    let raw = null;
    try {
      raw = await fs.readFile(normalized, 'utf8');
    } catch (caught) {
      // Only a missing file means "this conversation has no snapshot". Any other read failure leaves the topology
      // unknown, and answering it as an empty DAG would claim the run had no nodes.
      if (caught?.code !== 'ENOENT') {
        return { error: `run snapshot is unreadable: ${id}`, status: 500, code: 'DAG_SNAPSHOT_UNREADABLE' };
      }
      // A project whose only task came through the capability path has records and no snapshot.
      // Answer the rows it really has instead of hiding them behind a 404; with no records the
      // 404 stays, because a conversation that never ran has no graph.
      const reader = injectedRecordReader ?? (await loadRecordReader());
      const records = normalizeRecordResult(reader({ directory }));
      // With no snapshot at all, an unreadable store is not "no such conversation": answering 404 here would claim the
      // project never ran this turn while the truth is that nobody could look.
      if (records?.error !== undefined) return { error: records.error, status: 500, code: 'DAG_TASK_STORE_UNREADABLE' };
      const all = records?.error === undefined && Array.isArray(records?.tasks) ? records.tasks : [];
      // Only this conversation's tasks: the record reader has no session filter, so the unfiltered list would answer
      // every conversation in the project with the same rows and a parent they do not have.
      const rows = rowsForConversation(all, id);
      if (rows.length === 0) {
        // A bounded read that never reached this conversation cannot answer "no such conversation": say the store was
        // truncated instead of inventing an absence.
        if (records?.diagnostics?.limitReached === true) {
          return { error: `task store truncated before conversation ${id} could be checked`, status: 503, code: 'DAG_TASK_STORE_TRUNCATED' };
        }
        return { error: `no run snapshot for conversation: ${id}`, status: 404, code: 'DAG_SNAPSHOT_MISSING' };
      }
      const document = mergeRecordTasks({ schemaVersion: 1, sessionId: id, tasks: { parent_session_id: id, tasks: rows }, dag: { parent_session_id: id, runs: [] } }, [], records?.diagnostics);
      // Record-only tasks are still tasks: they get the same repair, attribution and delivery projection a
      // snapshot row gets, because those stores are keyed by task id and know nothing about snapshots.
      const described = describeRecordSource(document, records);
      const withRepair = await attachRepairState(described, { directory, readRepairState });
      const withAttribution = await attachAttributionState(withRepair, { directory, readAttributionState });
      // Attribution attaches the task id a chat node lacked when it was written, so the claim it carries can only be
      // corrected after this point.
      return attachDeliveryState(reconcileRecordClaims(withAttribution, rows), { directory, readDeliveryState });
    }
    let document = null;
    try {
      document = JSON.parse(raw);
    } catch {
      // A malformed snapshot is a bad document, not a server fault: the pane and the route both answer 422 with the same
      // machine code, so one client can treat the two surfaces alike.
      return { error: `run snapshot is malformed: ${id}`, status: 422, code: 'DAG_SNAPSHOT_MALFORMED' };
    }
    const recordReader = injectedRecordReader ?? (await loadRecordReader());
    const records = normalizeRecordResult(recordReader({ directory }));
    const rows = records?.error === undefined && Array.isArray(records?.tasks) ? rowsForConversation(records.tasks, id) : [];
    // Merge first, enrich second: the record adds rows the snapshot never had, and the repair, attribution and delivery
    // stores are keyed by task id, so projection has to run over the merged list or a record-only task arrives bare.
    const merged = rows.length === 0 ? describeRecordSource(document, records) : describeRecordSource(mergeRecordTasks(document, rows, records.diagnostics), records);
    const withRepair = await attachRepairState(merged, { directory, readRepairState });
    const withAttribution = await attachAttributionState(withRepair, { directory, readAttributionState });
    // A chat node is written before its child finishes, so it usually carries no task_id when the merge runs; attribution
    // attaches it here. Without this second pass the node keeps the snapshot's claim (often "verified") while its own
    // task row says otherwise, which is the inference this feature must never make.
    return attachDeliveryState(reconcileRecordClaims(withAttribution, rows), { directory, readDeliveryState });
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
