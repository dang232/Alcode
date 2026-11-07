import { promises as fsPromises } from 'node:fs';
import path from 'node:path';

const RUNS_DIRNAME = 'dag-runs';
const SNAPSHOT_SUFFIX = '.snapshot.json';

// The repair projection is bundled with the verification host actions because
// that is the one entry the Node server builds from engine TypeScript:
// `build:verification` writes `server/dist/verification-approval.js`. Loading
// the artifact (never the .ts source) keeps this module runnable under Node.
const REPAIR_BUNDLE = '../../dist/verification-approval.js';

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
    repairReaderPromise = import(REPAIR_BUNDLE)
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

export const createRunGraphRuntime = (overrides = {}) => {
  const fs = overrides.fs ?? fsPromises;
  const joinPath = overrides.joinPath ?? path.join;
  const normalizePath = overrides.normalizePath ?? path.normalize;
  const injectedRepairReader = overrides.readRepairState;

  const readRepairState = async (input) => {
    if (injectedRepairReader !== undefined) return injectedRepairReader(input);
    const reader = await loadRepairReader();
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
      return { error: `no run snapshot for conversation: ${id}`, status: 404 };
    }
    let document = null;
    try {
      document = JSON.parse(raw);
    } catch {
      const error = new Error(`run snapshot is malformed: ${id}`);
      error.status = 500;
      throw error;
    }
    return attachRepairState(document, { directory, readRepairState });
  };

  return { normalizeDirectory, readSnapshot };
};
