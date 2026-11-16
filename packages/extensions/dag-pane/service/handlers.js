// DAG pane local service handlers (project-ide todo 13).
//
// The panel iframe stays sandboxed: every privileged step runs here, in the
// host-spawned service process, behind the host's loopback proxy. These
// handlers wrap the adapter-A bridge from todo 6
// (`packages/web/server/lib/opencode/omo-bridge-runtime.js`): probe for
// engine presence, steer by invoking a run attached to the live session,
// cancel through the bridge's provisional kill-with-reason, and read the
// snapshot files the bridge writer produces.
//
// `service/main.js` maps HTTP onto `handleRequest`; the unit tests call it
// directly with a stub bridge, so no server or engine is needed to prove
// the steer/cancel wiring.
import { execFileSync } from 'node:child_process';
import { tmpdir as osTmpdir, homedir as osHomedir } from 'node:os';
import { join as joinPath } from 'node:path';
import nodeFs from 'node:fs';
import { promises as nodeFsPromises } from 'node:fs';
import nodePath from 'node:path';

import {
  createOmoBridgeRuntime,
  defaultSnapshotPath,
} from '../../../web/server/lib/opencode/omo-bridge-runtime.js';
import { createCodeGraphRuntime } from '../../../web/server/lib/code-graph/runtime.js';
import { createAttributionStateReader } from '../../../web/server/lib/verification-approval/attribution-state.js';
import { createRepairStateReader } from '../../../web/server/lib/verification-approval/repair-state.js';
import { createRecordTaskReaderForProject } from '../../../web/server/lib/verification-approval/record-tasks-reader.js';
import { mergeRecordTasks, rowsForConversation } from '../../../web/server/lib/run-graph/record-tasks.js';
import { ProjectKnowledgeStore, parseRecordFile } from '../../../omo-engine/memory-core/src/project-knowledge/record.ts';
import { retrieveProjectKnowledge } from '../../../omo-engine/memory-core/src/project-knowledge/retrieve.ts';
import { evaluateFreshness } from '../../../omo-engine/memory-core/src/project-knowledge/validator.ts';
import { mutateRunSnapshot } from '../../../omo-engine/omo-opencode/src/cli/run/run-snapshot-store.ts';

export const DAG_SERVICE_NAME = 'alcode-builtin-dag-pane';
export const DAG_SERVICE_DEFAULT_SNAPSHOT_PREFIX = 'omo-dag-snapshots';
export const DAG_SERVICE_MAX_BODY_BYTES = 1_000_000;

// Flow-trace debugger (dag-diagnostics): the composer route decision the UI
// last reported plus per-stage engine-side evidence, all machine values.
export const DAG_DEBUG_ROUTE_DECISIONS = ['captured-to-/ulw', 'plain-prompt', 'shell', 'slash-command'];
export const DAG_DEBUG_SAMPLE_MAX = 60;
export const DAG_DEBUG_MESSAGE_MAX = 140;
export const DAG_DEBUG_MAX_LEDGER_BYTES = 1_048_576;
// Mirrors ULTRAWORK_CURRENT_PROMPT_PATTERN in
// packages/omo-engine/omo-codex/plugin/components/ulw-loop/src/ultrawork-directive.ts.
// The service ships plain JS, so the literal is duplicated, not imported.
export const DAG_DEBUG_HOOK_PATTERN = '(?:ultrawork|ulw)';

export const defaultServiceSnapshotDir = (tmpdir = osTmpdir, join = joinPath) => (
  join(tmpdir(), DAG_SERVICE_DEFAULT_SNAPSHOT_PREFIX)
);

const isNonEmptyString = (value) => (value?.trim?.() ?? '').length > 0;

// String-valued field read without a typeof test: non-strings degrade to
// ''. Callers treat '' as absent, so untrusted shapes fail closed.
const asString = (value) => value?.trim?.() ?? '';

// Plain-record test without a typeof test: only a real object passes, and
// arrays never do (mirrors the panel parser's isWireRecord idiom).
const isRecord = (value) => Object(value) === value && !Array.isArray(value);

// The engine's task stream is the only document shape that carries a non-empty
// `tasks.tasks` array. A synthetic steer record keeps `tasks: null` by design,
// so this predicate is the whole authority test: it needs no new schema tag or
// wire discriminator.
const isEngineSnapshotDocument = (doc) => (
  isRecord(doc) && isRecord(doc.tasks) && Array.isArray(doc.tasks.tasks) && doc.tasks.tasks.length > 0
);

const DAG_LOOP_RUNS_MAX = 50;
const DAG_LOOP_PLAN_MAX_BYTES = 262_144;

const isSafeSessionId = (value) => {
  const text = asString(value);
  return text.length > 0 && !/[\\/]/.test(text) && !text.includes('..');
};

// Durable chat-run storage: project-scoped `.omo/dag-runs/` instead of the
// OS-temp snapshot dir, so a conversation's runs survive Electron, Vite, and
// backend restarts. One mutable live file per parent conversation plus capped
// immutable terminal records per conversation (explicit retention: newest 20).
const DAG_RUNS_DIRNAME = 'dag-runs';
const DAG_RUN_HISTORY_DIRNAME = 'history';
const DAG_RUN_HISTORY_MAX = 20;

const isSafeDirectory = (value) => {
  const text = asString(value);
  if (text.length === 0) return false;
  if (text.split(/[\\/]+/).includes('..')) return false;
  // A UNC or device path makes the filesystem dial a host the caller named: refusing it here stops a request from
  // becoming an outbound SMB/WebDAV connection that authenticates with the user's own credentials.
  if (text.startsWith('\\\\') || text.startsWith('//') || text.startsWith('\\\\.')) return false;
  return text.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(text);
};

// Read-only rationale source: project-knowledge/*.md files as committed at
// HEAD, plus the HEAD revision itself. Git failures (not a repo, no commits
// yet, no knowledge dir) degrade to an empty file list with whatever
// revision resolved: an empty store answers ranked [], never a fabricated
// record. Paths from ls-tree are re-validated before `git show`, so only
// project-knowledge markdown ever loads.
const RATIONALE_GIT_TIMEOUT_MS = 15_000;

const gitHeadText = (directory, args) => {
  try {
    return execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      timeout: RATIONALE_GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

const isHeadKnowledgePath = (name) => (
  name.startsWith('project-knowledge/')
  && name.endsWith('.md')
  && !name.includes('..')
  && !name.includes('\\')
  && !name.startsWith('/')
);

const readHeadTreeProjectKnowledge = (directory) => {
  const revision = gitHeadText(directory, ['rev-parse', 'HEAD']);
  if (revision === null || !/^[0-9a-f]{40}$/.test(revision)) {
    return { revision: null, files: [] };
  }
  const listing = gitHeadText(directory, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'project-knowledge']);
  if (listing === null) {
    return { revision, files: [] };
  }
  const files = [];
  for (const name of listing.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)) {
    if (!isHeadKnowledgePath(name)) continue;
    const content = gitHeadText(directory, ['show', `HEAD:${name}`]);
    if (content === null) continue;
    files.push({ path: name, content });
  }
  return { revision, files };
};

const projectRunsDir = (directory) => (
  `${directory.trim().replace(/[/\\]+$/, '')}/.omo/${DAG_RUNS_DIRNAME}`
);

const projectLiveRunPath = (directory, sessionId) => (
  `${projectRunsDir(directory)}/${sessionId}.snapshot.json`
);

const projectRunHistoryDir = (directory, sessionId) => (
  `${projectRunsDir(directory)}/${DAG_RUN_HISTORY_DIRNAME}/${sessionId}`
);

// Posted-doc validation mirrors the panel parser (panel/dag-view.ts): schema
// version, string session id, and a first run record with its required
// strings. An empty run list is a rejection, never a write: a valid
// persisted run must never be replaced by an empty snapshot.
const readPostedRunDoc = (doc) => {
  if (!isRecord(doc)) return null;
  if (doc.schemaVersion !== 1) return null;
  const sessionId = asString(doc.sessionId);
  if (!isSafeSessionId(sessionId)) return null;
  const dag = isRecord(doc.dag) ? doc.dag : null;
  if (!dag || !Array.isArray(dag.runs) || dag.runs.length === 0) return null;
  const run = isRecord(dag.runs[0]) ? dag.runs[0] : null;
  if (!run) return null;
  if (!isNonEmptyString(run.run_id) || !isNonEmptyString(run.run_key)
    || !isNonEmptyString(run.name) || !isNonEmptyString(run.status)) return null;
  return { sessionId, status: run.status.trim(), updatedAt: asString(doc.updatedAt) || null };
};

// Posted attribution corroboration (HC8). A posted task_id/node_id is a claim
// about the engine's persisted task records, never evidence: the attribution
// index built by `createAttributionStateReader` is the only authority
// (`child_session_id` maps to `task_id`; only a `dag` owner supplies
// `nodeId`/`runId`). A claim no record supports is dropped from the persisted
// run node or task row and named in the response. A document is never rejected
// over an unverified id and an absent id is never invented. When the index
// itself is absent or unreadable no claim can be verified, so every posted id
// on both the node path and the tasks path is dropped with
// `corroboration_unavailable` while the response says corroboration was
// skipped.
const ATTRIBUTION_ID_FIELDS = ['task_id', 'node_id'];
const VERIFICATION_FIELD = 'verification_status';
const VERIFICATION_STATUSES = ['verified', 'unverified', 'blocked'];

// String-valued read without a typeof test: only a real string primitive
// stringifies to itself, so numbers/objects/arrays read as absent.
const asPostedString = (value) => (String(value) === value ? value : null);

// Own-property lookup: a posted id such as `__proto__` or `constructor` must
// never resolve through Object.prototype and corroborate itself.
const ownAttributionEntry = (table, key) => (
  isRecord(table) && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
);

/**
 * The task entry and whether the record proves it belongs to the conversation being written.
 *
 * A task id existing somewhere in the project is not membership: without this check a posted document could carry
 * another conversation's task into its own snapshot. An entry with no session identity is treated as unattributable,
 * so "present but unplaceable" can never pass as a match.
 */
const taskEntryFor = (index, taskId, conversationId, nodeSessionId) => {
  const entry = ownAttributionEntry(index.byTaskId, taskId);
  if (!isRecord(entry)) return { kind: 'absent' };
  const wanted = asString(conversationId);
  if (wanted.length === 0) return { kind: 'entry', entry };
  // Membership is proved by the record naming this conversation, or by this document placing the task's own child
  // session as a node: a parent's run renders its children, so that is the same conversation's work.
  const named = [entry.parentSessionId, entry.rootSessionId]
    .filter((value) => asString(value).length > 0);
  const child = asString(entry.childSessionId);
  const rendered = asString(nodeSessionId);
  if (named.includes(wanted)) return { kind: 'entry', entry };
  if (child.length > 0 && rendered.length > 0 && child === rendered) return { kind: 'entry', entry };
  if (named.length === 0 && child.length === 0) return { kind: 'unattributed', entry };
  return { kind: 'mismatch', entry };
};

const postedIdClaim = (record, field) => {
  const raw = record[field];
  if (raw === undefined) return { present: false };
  const text = asPostedString(raw);
  if (text === null || text.trim().length === 0) return { present: true, invalid: true };
  return { present: true, value: text.trim() };
};

// A verification claim is evidence only when the durable task record for the
// same identity carries the same claim. The reader projects a completed record
// with no claim as `unverified`, so a posted "verified" cannot borrow it.
const postedVerificationClaim = (record) => {
  const raw = record[VERIFICATION_FIELD];
  if (raw === undefined) return { present: false };
  const text = asPostedString(raw);
  const value = text === null ? null : text.trim();
  if (value === null || !VERIFICATION_STATUSES.includes(value)) return { present: true, invalid: true };
  return { present: true, value };
};

const verificationDropReason = (claim, entry) => {
  if (claim.invalid === true) return `${VERIFICATION_FIELD} must be one of ${VERIFICATION_STATUSES.join(', ')}`;
  if (!isRecord(entry)) return `${VERIFICATION_FIELD} is not present in the attribution records`;
  return `${VERIFICATION_FIELD} does not match the persisted task record`;
};

// Field-level corroboration for one node. Returns the node unchanged when it
// carries no identity claim, otherwise a copy with unsupported fields removed.
const corroborateNodeClaims = (node, index, nodeIndex, dropped, conversationId) => {
  const claims = ATTRIBUTION_ID_FIELDS
    .map((field) => ({ field, ...postedIdClaim(node, field) }))
    .filter((claim) => claim.present);
  const verificationClaim = postedVerificationClaim(node);
  if (claims.length === 0 && verificationClaim.present !== true) return node;
  const rawNodeId = asPostedString(node.id);
  const nodeId = rawNodeId === null ? null : rawNodeId.trim();
  const childEntry = nodeId === null || nodeId.length === 0
    ? undefined
    : ownAttributionEntry(index.byChildSessionId, nodeId);
  const taskClaim = claims.find((claim) => claim.field === 'task_id');
  const nodeTask = taskClaim !== undefined && taskClaim.invalid !== true
    ? taskEntryFor(index, taskClaim.value, conversationId, nodeId)
    : { kind: 'absent' };
  const taskEntry = nodeTask.kind === 'entry' ? nodeTask.entry : undefined;
  let changed = false;
  const kept = { ...node };
  const drop = (field, reason) => {
    changed = true;
    delete kept[field];
    dropped.push({ node: nodeId, nodeIndex, field, reason });
  };
  for (const claim of claims) {
    if (claim.invalid === true) {
      drop(claim.field, `${claim.field} must be a non-empty string`);
      continue;
    }
    if (claim.field === 'task_id') {
      if (taskEntry === undefined) {
        drop('task_id', nodeTask.kind === 'absent'
          ? 'task_id is not present in the attribution records'
          : 'task_id is not attributed to this conversation');
      } else if (isRecord(childEntry) && childEntry.taskId !== claim.value) {
        drop('task_id', 'task_id does not match the task recorded for this child session');
      }
      continue;
    }
    if (isRecord(childEntry)) {
      if (childEntry.nodeId !== claim.value) {
        drop('node_id', 'node_id does not match the dag node recorded for this child session');
      }
      continue;
    }
    if (taskEntry !== undefined) {
      if (taskEntry.nodeId !== claim.value) {
        drop('node_id', 'node_id does not match the dag node recorded for this task');
      }
      continue;
    }
    const known = Array.isArray(index.entries)
      && index.entries.some((entry) => isRecord(entry) && entry.nodeId === claim.value);
    if (!known) drop('node_id', 'node_id is not present in the attribution records');
  }
  if (verificationClaim.present === true) {
    // The claim belongs to a task, never to a node label: only a recorded task
    // (by posted task_id or by the node's child session) may authorize it.
    const entry = isRecord(taskEntry) ? taskEntry : childEntry;
    if (verificationClaim.invalid !== true && isRecord(entry)
      && entry.verificationStatus === verificationClaim.value) {
      // Corroborated: keep the posted field as-is.
    } else {
      drop(VERIFICATION_FIELD, verificationDropReason(verificationClaim, entry));
    }
  }
  return changed ? kept : node;
};

// Field-level corroboration for one posted task row. A tasks row carries no
// child session id, so its task_id must exist in byTaskId and its node_id must
// match that recorded task's dag node (or name a dag-owned node in entries).
// Returns the row unchanged when it carries no identity claim, otherwise a
// copy with unsupported fields removed.
const corroborateTaskClaims = (task, index, taskIndex, dropped, conversationId) => {
  const claims = ATTRIBUTION_ID_FIELDS
    .map((field) => ({ field, ...postedIdClaim(task, field) }))
    .filter((claim) => claim.present);
  const verificationClaim = postedVerificationClaim(task);
  if (claims.length === 0 && verificationClaim.present !== true) return task;
  const rawTaskId = asPostedString(task.task_id);
  const taskRowId = rawTaskId === null ? null : rawTaskId.trim();
  const taskClaim = claims.find((claim) => claim.field === 'task_id');
  const rowTask = taskClaim !== undefined && taskClaim.invalid !== true
    ? taskEntryFor(index, taskClaim.value, conversationId)
    : { kind: 'absent' };
  const taskEntry = rowTask.kind === 'entry' ? rowTask.entry : undefined;
  let changed = false;
  const kept = { ...task };
  const drop = (field, reason) => {
    changed = true;
    delete kept[field];
    dropped.push({ task: taskRowId, taskIndex, field, reason });
  };
  for (const claim of claims) {
    if (claim.invalid === true) {
      drop(claim.field, `${claim.field} must be a non-empty string`);
      continue;
    }
    if (claim.field === 'task_id') {
      if (taskEntry === undefined) {
        drop('task_id', rowTask.kind === 'absent'
          ? 'task_id is not present in the attribution records'
          : 'task_id is not attributed to this conversation');
      }
      continue;
    }
    if (taskEntry !== undefined) {
      if (taskEntry.nodeId !== claim.value) {
        drop('node_id', 'node_id does not match the dag node recorded for this task');
      }
      continue;
    }
    const known = Array.isArray(index.entries)
      && index.entries.some((entry) => isRecord(entry) && entry.nodeId === claim.value);
    if (!known) drop('node_id', 'node_id is not present in the attribution records');
  }
  if (verificationClaim.present === true) {
    if (verificationClaim.invalid !== true && isRecord(taskEntry)
      && taskEntry.verificationStatus === verificationClaim.value) {
      // Corroborated: keep the posted field as-is.
    } else {
      drop(VERIFICATION_FIELD, verificationDropReason(verificationClaim, taskEntry));
    }
  }
  return changed ? kept : task;
};

// Apply corroboration to every run node, copying only along changed paths so
// an untouched document keeps its original object identity.
const corroboratePostedRuns = (doc, index, dropped, conversationId) => {
  const runs = isRecord(doc.dag) && Array.isArray(doc.dag.runs) ? doc.dag.runs : null;
  if (runs === null) return doc;
  let changed = false;
  const nextRuns = runs.map((run) => {
    if (!isRecord(run) || !Array.isArray(run.nodes)) return run;
    let nodesChanged = false;
    const nodes = run.nodes.map((node, nodeIndex) => {
      if (!isRecord(node)) return node;
      const before = dropped.length;
      const next = corroborateNodeClaims(node, index, nodeIndex, dropped, conversationId);
      if (next !== node || dropped.length !== before) nodesChanged = true;
      return next;
    });
    if (!nodesChanged) return run;
    changed = true;
    return { ...run, nodes };
  });
  return changed ? { ...doc, dag: { ...doc.dag, runs: nextRuns } } : doc;
};

// Apply the same rule to every posted task row, again copying only along
// changed paths.
const corroboratePostedTasks = (doc, index, dropped, conversationId) => {
  const tasks = isRecord(doc.tasks) && Array.isArray(doc.tasks.tasks) ? doc.tasks.tasks : null;
  if (tasks === null) return doc;
  let changed = false;
  const nextTasks = tasks.map((task, taskIndex) => {
    if (!isRecord(task)) return task;
    const before = dropped.length;
    const next = corroborateTaskClaims(task, index, taskIndex, dropped, conversationId);
    if (next !== task || dropped.length !== before) changed = true;
    return next;
  });
  return changed ? { ...doc, tasks: { ...doc.tasks, tasks: nextTasks } } : doc;
};

// Both posted surfaces: run nodes and task rows.
const corroboratePostedSnapshot = (doc, index, dropped, conversationId) => (
  corroboratePostedTasks(corroboratePostedRuns(doc, index, dropped, conversationId), index, dropped, conversationId)
);

// Without an authoritative index no posted identity can be verified. Drop
// every claim the document carries on both surfaces and name each drop, so a
// skipped response can never look like a clean pass while an unverified id
// stays persisted.
const dropUnverifiablePostedRuns = (doc, dropped) => {
  const runs = isRecord(doc.dag) && Array.isArray(doc.dag.runs) ? doc.dag.runs : null;
  if (runs === null) return doc;
  let changed = false;
  const nextRuns = runs.map((run) => {
    if (!isRecord(run) || !Array.isArray(run.nodes)) return run;
    let nodesChanged = false;
    const nodes = run.nodes.map((node, nodeIndex) => {
      if (!isRecord(node)) return node;
      const present = ATTRIBUTION_ID_FIELDS.filter((field) => node[field] !== undefined);
      if (node[VERIFICATION_FIELD] !== undefined) present.push(VERIFICATION_FIELD);
      if (present.length === 0) return node;
      const rawNodeId = asPostedString(node.id);
      const nodeId = rawNodeId === null ? null : rawNodeId.trim();
      const next = { ...node };
      for (const field of present) {
        delete next[field];
        dropped.push({ node: nodeId, nodeIndex, field, reason: 'corroboration_unavailable' });
      }
      nodesChanged = true;
      return next;
    });
    if (!nodesChanged) return run;
    changed = true;
    return { ...run, nodes };
  });
  return changed ? { ...doc, dag: { ...doc.dag, runs: nextRuns } } : doc;
};

const dropUnverifiablePostedTasks = (doc, dropped) => {
  const tasks = isRecord(doc.tasks) && Array.isArray(doc.tasks.tasks) ? doc.tasks.tasks : null;
  if (tasks === null) return doc;
  let changed = false;
  const nextTasks = tasks.map((task, taskIndex) => {
    if (!isRecord(task)) return task;
    const present = ATTRIBUTION_ID_FIELDS.filter((field) => task[field] !== undefined);
    if (task[VERIFICATION_FIELD] !== undefined) present.push(VERIFICATION_FIELD);
    if (present.length === 0) return task;
    const rawTaskId = asPostedString(task.task_id);
    const taskRowId = rawTaskId === null ? null : rawTaskId.trim();
    const next = { ...task };
    for (const field of present) {
      delete next[field];
      dropped.push({ task: taskRowId, taskIndex, field, reason: 'corroboration_unavailable' });
    }
    changed = true;
    return next;
  });
  return changed ? { ...doc, tasks: { ...doc.tasks, tasks: nextTasks } } : doc;
};

// Both posted surfaces: run nodes and task rows.
const dropUnverifiablePostedIds = (doc, dropped) => (
  dropUnverifiablePostedTasks(dropUnverifiablePostedRuns(doc, dropped), dropped)
);

// Resolve the index for one POST. `skipped` means no claim was judged: either
// the records could not be read or the project has none, and a skipped result
// must never read as a clean pass.
const readPostedAttribution = (readAttributionState, directory) => {
  let index;
  try {
    index = readAttributionState({ directory });
  } catch (error) {
    return { skipped: `attribution state read failed: ${asString(error?.message) || 'unknown error'}` };
  }
  if (!isRecord(index)) return { skipped: 'attribution state reader returned an invalid result' };
  const error = asString(index.error);
  if (error.length > 0) return { skipped: error };
  if (index.absent === true) return { skipped: 'no attribution records exist for this project' };
  return { index };
};

const writeFileAtomic = (fs, path, text) => {
  fs.mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  fs.writeFileSync(temporaryPath, text, 'utf8');
  fs.renameSync(temporaryPath, path);
};

const CHAT_RUN_SOURCE = 'chat';

// The chat writer is one of several writers of this document, so it never rebuilds
// the file: it replaces its own rows and keeps every other valid row (delivery,
// loop, unknown future runs). Without this, posting a chat snapshot erases the
// delivery rows another process projected from durable task records.
const mergeChatSnapshot = (existingDoc, incoming, directory) => {
  const incomingDoc = { ...incoming, directory };
  const incomingRuns = Array.isArray(incomingDoc?.dag?.runs) ? incomingDoc.dag.runs : [];
  const tagChat = (run) => (isRecord(run) ? { ...run, source: CHAT_RUN_SOURCE } : run);
  if (existingDoc === null) {
    return { doc: { ...incomingDoc, dag: { ...incomingDoc.dag, runs: incomingRuns.map(tagChat) } } };
  }
  // A row this writer does not own is never dropped — not even when a posted chat
  // row reuses its id. Chat rows are replaced wholesale; a colliding chat claim
  // loses to the surviving delivery row instead of erasing it.
  const kept = existingDoc.dag.runs.filter((run) => isRecord(run) && run.source !== CHAT_RUN_SOURCE);
  const keptIds = new Set(kept.map((run) => run.run_id));
  const appended = incomingRuns
    .map(tagChat)
    .filter((run) => !isRecord(run) || !keptIds.has(run.run_id));
  return {
    doc: {
      ...existingDoc,
      ...incomingDoc,
      dag: { ...existingDoc.dag, ...incomingDoc.dag, runs: [...kept, ...appended] },
    },
  };
};

const readFileOrNull = (fs, path) => {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const updatedAtMs = (updatedAt, now) => {
  const parsed = Date.parse(updatedAt ?? '');
  return Number.isFinite(parsed) ? parsed : now();
};

const existsFile = (fs, path) => {
  try {
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
};

// Engine-side loop evidence for GET /debug: which state files exist under
// .omo/ulw-loop/<session> plus the ledger event count. Never throws: every
// read degrades to a false/zero value the pane renders as-is.
const readLoopState = (fs, directory, sessionId) => {
  if (!isNonEmptyString(directory)) {
    return { dir: null, plan: false, goals: false, ledger: false, events: 0 };
  }
  const root = directory.trim().replace(/[/\\]+$/, '');
  const dir = `${root}/.omo/ulw-loop/${sessionId}`;
  const plan = existsFile(fs, `${dir}/plan.json`);
  const goals = existsFile(fs, `${dir}/goals.json`);
  const ledgerPath = `${dir}/ledger.jsonl`;
  const ledger = existsFile(fs, ledgerPath);
  let events = 0;
  if (ledger) {
    try {
      const text = fs.readFileSync(ledgerPath, 'utf8').slice(0, DAG_DEBUG_MAX_LEDGER_BYTES);
      events = text.split('\n').filter((line) => line.trim().length > 0).length;
    } catch {
      events = 0;
    }
  }
  return { dir, plan, goals, ledger, events };
};

// Bridge-snapshot evidence for GET /debug: file presence, mtime, and
// whether the stored session matches the requested one. Never throws.
const readSnapshotState = (fs, snapshotPathFor, sessionId) => {
  let snapshotPath;
  try {
    snapshotPath = snapshotPathFor(sessionId);
  } catch {
    return { path: null, exists: false, updatedAt: null, sessionMatch: false };
  }
  let mtime = null;
  try {
    mtime = fs.statSync(snapshotPath).mtime;
  } catch {
    return { path: snapshotPath, exists: false, updatedAt: null, sessionMatch: false };
  }
  let sessionMatch = false;
  try {
    sessionMatch = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))?.sessionId === sessionId;
  } catch {
    sessionMatch = false;
  }
  let updatedAt = null;
  try {
    updatedAt = mtime instanceof Date ? mtime.toISOString() : new Date(mtime).toISOString();
  } catch {
    updatedAt = null;
  }
  return { path: snapshotPath, exists: true, updatedAt, sessionMatch };};

const snapshotSessions = (fs, snapshotDir) => {
  let entries;
  try {
    entries = fs.readdirSync(snapshotDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.snapshot.json'))
    .map((name) => name.slice(0, -'.snapshot.json'.length))
    .sort();
};

const mtimeOf = (fs, path) => {
  try {
    const mtime = fs.statSync(path).mtime;
    return mtime instanceof Date ? mtime.toISOString() : new Date(mtime).toISOString();
  } catch {
    return null;
  }
};

const listLoopSessionIds = (fs, directory) => {
  if (!isNonEmptyString(directory)) return [];
  const root = directory.trim().replace(/[/\\]+$/, '');
  let entries;
  try {
    entries = fs.readdirSync(`${root}/.omo/ulw-loop`, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      try {
        return entry.isDirectory() && isSafeSessionId(entry.name);
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort()
    .slice(0, DAG_LOOP_RUNS_MAX);
};

const readLoopPlan = (fs, directory, sessionId) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  const planPath = `${root}/.omo/ulw-loop/${sessionId}/plan.json`;
  let stat;
  try {
    stat = fs.statSync(planPath);
  } catch {
    return null;
  }
  try {
    if (!stat.isFile() || stat.size > DAG_LOOP_PLAN_MAX_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    if (!isRecord(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const readLoopEventNames = (fs, directory, sessionId) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  const ledgerPath = `${root}/.omo/ulw-loop/${sessionId}/ledger.jsonl`;
  let text;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8').slice(0, DAG_DEBUG_MAX_LEDGER_BYTES);
  } catch {
    return [];
  }
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  return lines.slice(-50).map((line, index) => {
    const marker = `entry-${index + 1}`;
    try {
      const parsed = JSON.parse(line);
      // Host-driver ledgers name the event in `.event`; CLI ledgers use
      // `.kind` (plan_created, evidence_captured, ...). Either names the row;
      // lines with neither stay markers so they never pass as real runs.
      const name = parsed?.event?.trim?.() || parsed?.kind?.trim?.() || '';
      return name.length > 0 ? name.slice(0, 64) : marker;
    } catch {
      return marker;
    }
  });
};

// CLI ledger vocabulary (constants.ts ULW_LOOP_LEDGER_EVENT_KINDS): ledgers
// speak `kind` (plan_created, evidence_captured, goal_started, ...) while the
// host driver speaks `event` (started, advanced, ...). Both name real
// progress; anything unrecognized stays pending so the pane never invents
// motion.
const loopNodeStateForEvent = (event) => {
  if (event === 'completed' || event === 'goal_completed' || event === 'aggregate_completed' || event === 'batch_closed' || event === 'child_completed') return 'completed';
  if (event === 'failed' || event === 'error' || event === 'goal_failed' || event === 'final_review_failed' || event === 'criterion_failed' || event === 'child_failed') return 'failed';
  if (event === 'started' || event === 'advanced' || event === 'resumed' || event === 'goal_started' || event === 'goal_resumed' || event === 'goal_retried' || event === 'goal_dispatched' || event === 'plan_created' || event === 'evidence_captured' || event === 'goal_added' || event === 'steering_accepted' || event === 'batch_updated' || event === 'criteria_revised') return 'running';
  return 'pending';
};

// Goal states (domain-types.ts UlwLoopItem.status) onto pane states.
// Blocked-ish states (blocked, review_blocked, needs_user_decision,
// superseded) stay pending: they need attention, not a terminal verdict the
// loop itself has not recorded.
const loopNodeStateForGoal = (status) => {
  if (status === 'complete') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'in_progress') return 'running';
  return 'pending';
};

// Real delegation graph source: goals.json holds the UlwLoopPlan (goals
// array with id/title/objective/status). plan.json is the host-driver plan
// and carries no goals; it is only a fallback shape check.
const readLoopGoalsPlan = (fs, directory, sessionId) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  for (const name of ['goals.json', 'plan.json']) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(`${root}/.omo/ulw-loop/${sessionId}/${name}`, 'utf8'));
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.goals)) continue;
    return parsed;
  }
  return null;
};

// Worker rows for the delegation graph: CLI ledgers record every dispatch
// (`goal_dispatched`) and every worker settlement (`child_completed` /
// `child_failed`) with the goal id plus a human message (`Dispatched as
// <role>: attempt N`, `Child <id> (<role>) result: <ref>`). Malformed
// lines are skipped; anything outside the dispatch vocabulary is not a
// worker record.
const DAG_LOOP_WORKER_KINDS = ['goal_dispatched', 'child_completed', 'child_failed'];

const readLoopWorkerEntries = (fs, directory, sessionId) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  const ledgerPath = `${root}/.omo/ulw-loop/${sessionId}/ledger.jsonl`;
  let text;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8').slice(0, DAG_DEBUG_MAX_LEDGER_BYTES);
  } catch {
    return [];
  }
  const entries = [];
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines.slice(-200)) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const kind = asString(parsed.kind);
    if (!DAG_LOOP_WORKER_KINDS.includes(kind)) continue;
    const goalId = asString(parsed.goalId);
    if (goalId === '') continue;
    entries.push({ kind, goalId, at: asString(parsed.at), message: asString(parsed.message) });
  }
  return entries;
};

const workerRoleFromMessage = (message) => {
  const dispatchRole = /^Dispatched as ([^:]+):/.exec(message);
  if (dispatchRole) return dispatchRole[1].trim();
  const childRole = /^Child \S+(?: \(([^)]+)\))? (?:result|failed):/.exec(message);
  if (childRole && (childRole[1] ?? '').trim().length > 0) return childRole[1].trim();
  return '';
};

// One node per settled child, plus one running node per dispatch still
// waiting for its settlement (dispatches beyond settlements, newest
// first). Entries naming a goal the plan no longer lists are dropped:
// they belong to a superseded plan, and the pane never invents
// structure for them.
const projectGoalWorkerNodes = (entries, goalIds) => {
  const known = new Set(goalIds);
  const byGoal = new Map();
  for (const entry of entries) {
    if (!known.has(entry.goalId)) continue;
    if (!byGoal.has(entry.goalId)) byGoal.set(entry.goalId, []);
    byGoal.get(entry.goalId).push(entry);
  }
  const nodes = [];
  for (const [goalId, goalEntries] of byGoal) {
    const settled = goalEntries.filter((entry) => entry.kind === 'child_completed' || entry.kind === 'child_failed');
    const dispatches = goalEntries.filter((entry) => entry.kind === 'goal_dispatched');
    const running = Math.max(0, dispatches.length - settled.length);
    const workers = [
      ...settled.map((entry) => ({ entry, state: entry.kind === 'child_completed' ? 'completed' : 'failed' })),
      ...(running > 0 ? dispatches.slice(-running).map((entry) => ({ entry, state: 'running' })) : []),
    ];
    workers.forEach(({ entry, state }, index) => {
      const role = workerRoleFromMessage(entry.message);
      const label = (role || `Worker ${index + 1}`).slice(0, 80);
      nodes.push({
        id: `worker:${goalId}:${index + 1}`,
        label,
        state,
        attempt: 1,
        prompt: (entry.message || label).slice(0, 512),
        depends_on: [goalId],
        started_at: entry.at || null,
        completed_at: state === 'running' ? null : (entry.at || null),
      });
    });
  }
  return nodes;
};

const projectLoopSnapshot = (fs, directory, sessionId, isLiveRun = false) => {
  const root = directory.trim().replace(/[/\\]+$/, '');
  const dir = `${root}/.omo/ulw-loop/${sessionId}`;
  const plan = readLoopPlan(fs, directory, sessionId);
  const state = readLoopState(fs, directory, sessionId);
  if (!state.plan && !state.goals && !state.ledger && plan === null) return null;
  const events = readLoopEventNames(fs, directory, sessionId);
  // Placeholder rows are honest only for a live run or real events: a dead
  // session whose ledger has no event names must not paint entry-N markers.
  const hasRealEvents = events.some((event) => !event.startsWith('entry-'));
  if (!hasRealEvents && !isLiveRun) return null;
  const planComplete = plan?.status === 'complete';
  const completedEvent = events.includes('completed') || events.includes('goal_completed') || events.includes('aggregate_completed') || events.includes('batch_closed') || events.includes('child_completed');
  const failedEvent = events.includes('failed') || events.includes('error') || events.includes('goal_failed') || events.includes('final_review_failed') || events.includes('criterion_failed') || events.includes('child_failed');
  const status = planComplete || completedEvent
    ? 'completed'
    : failedEvent
      ? 'failed'
      : events.length > 0 || state.plan || state.goals
        ? 'running'
        : 'pending';
  const goalsPlanForTitle = readLoopGoalsPlan(fs, directory, sessionId);
  const goalsBriefTitle = Array.isArray(goalsPlanForTitle?.goals) ? asString(goalsPlanForTitle.brief).split('\n')[0] : '';
  const title = (asString(plan?.title) || asString(plan?.goal).split('\n')[0] || goalsBriefTitle || sessionId).slice(0, 120);
  // Orca-like delegation graph from real loop state: when goals.json names
  // actual goals, project parent -> goal children (parallel wave) ->
  // synthesis (fan-in), the same shape the orca run renders. Every node
  // comes from the plan/ledger; nothing is synthesized.
  const goalsPlan = readLoopGoalsPlan(fs, directory, sessionId);
  const goalRecords = Array.isArray(goalsPlan?.goals) ? goalsPlan.goals.filter(isRecord) : [];
  if (goalRecords.length > 0) {
    const childNodes = goalRecords.map((goal, index) => {
      const id = asString(goal.id) || `goal-${index + 1}`;
      const label = (asString(goal.title) || id).slice(0, 80);
      return {
        id,
        label,
        state: loopNodeStateForGoal(asString(goal.status)),
        attempt: Number.isInteger(goal.attempt) && goal.attempt > 0 ? goal.attempt : 1,
        prompt: (asString(goal.objective) || label).slice(0, 512),
        depends_on: ['parent'],
        started_at: asString(goal.startedAt) || null,
        completed_at: asString(goal.completedAt) || null,
      };
    });
    const goalIds = childNodes.map((node) => node.id);
    const workerNodes = projectGoalWorkerNodes(readLoopWorkerEntries(fs, directory, sessionId), goalIds);
    const workersByGoal = new Map();
    for (const worker of workerNodes) {
      const goalId = worker.depends_on[0];
      if (!workersByGoal.has(goalId)) workersByGoal.set(goalId, []);
      workersByGoal.get(goalId).push(worker.id);
    }
    const aggregateDone = isRecord(goalsPlan?.aggregateCompletion) && goalsPlan.aggregateCompletion.status === 'complete';
    const allChildrenComplete = childNodes.every((node) => node.state === 'completed');
    const anyChildFailed = childNodes.some((node) => node.state === 'failed');
    const anyChildRunning = childNodes.some((node) => node.state === 'running');
    const synthesisState = (aggregateDone || allChildrenComplete)
      ? 'completed'
      : anyChildFailed
        ? 'failed'
        : (anyChildRunning || planComplete || completedEvent)
          ? 'running'
          : 'pending';
    const graphStatus = synthesisState === 'completed'
      ? 'completed'
      : synthesisState === 'failed'
        ? 'failed'
        : (anyChildRunning || anyChildFailed || events.length > 0 || state.plan || state.goals)
          ? 'running'
          : 'pending';
    const parentNode = {
      id: 'parent',
      label: title,
      state: graphStatus === 'completed' ? 'completed' : graphStatus === 'failed' ? 'failed' : graphStatus === 'running' ? 'running' : 'pending',
      attempt: 1,
      prompt: title,
      depends_on: [],
      started_at: null,
      completed_at: null,
    };
    const synthesisNode = {
      id: 'synthesis',
      label: 'Synthesis',
      state: synthesisState,
      attempt: 1,
      prompt: 'Synthesis waits for all goal children and reflects their real results.',
      depends_on: childNodes.flatMap((node) => workersByGoal.get(node.id) ?? [node.id]),
      started_at: null,
      completed_at: null,
    };
    const graphNodes = [parentNode, ...childNodes, ...workerNodes, synthesisNode];
    const graphEdges = [
      ...childNodes.map((node) => ({ from: 'parent', to: node.id })),
      ...workerNodes.map((worker) => ({ from: worker.depends_on[0], to: worker.id })),
      ...childNodes.flatMap((node) => (workersByGoal.get(node.id) ?? [node.id]).map((tail) => ({ from: tail, to: 'synthesis' }))),
    ];
    const graphCounts = { pending: 0, running: 0, completed: 0 };
    for (const node of graphNodes) {
      if (node.state === 'completed') graphCounts.completed += 1;
      else if (node.state === 'running') graphCounts.running += 1;
      else graphCounts.pending += 1;
    }
    const graphUpdatedAt = mtimeOf(fs, `${dir}/ledger.jsonl`)
      ?? mtimeOf(fs, `${dir}/goals.json`)
      ?? mtimeOf(fs, `${dir}/plan.json`)
      ?? new Date().toISOString();
    return {
      schemaVersion: 1,
      sessionId,
      updatedAt: graphUpdatedAt,
      dag: {
        runs: [{
          run_id: sessionId,
          run_key: `loop:${sessionId}`,
          name: title,
          status: graphStatus,
          counts: graphCounts,
          nodes: graphNodes,
          edges: graphEdges,
          waves: [{ index: 0, node_ids: ['parent'] }, { index: 1, node_ids: [...childNodes.map((node) => node.id), ...workerNodes.map((worker) => worker.id)] }, { index: 2, node_ids: ['synthesis'] }],
        }],
      },
      tasks: null,
    };
  }
  const nodes = events.length > 0
    ? events.map((event, index) => ({
      id: `step-${index + 1}`,
      label: event,
      state: loopNodeStateForEvent(event),
      attempt: 1,
      prompt: event,
      depends_on: index === 0 ? [] : [`step-${index}`],
      started_at: null,
      completed_at: null,
    }))
    : [{
      id: 'step-1',
      label: title,
      state: status === 'completed' ? 'completed' : 'pending',
      attempt: 1,
      prompt: title,
      depends_on: [],
      started_at: null,
      completed_at: null,
    }];
  const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id }));
  const counts = { pending: 0, running: 0, completed: 0 };
  for (const node of nodes) {
    if (node.state === 'completed') counts.completed += 1;
    else if (node.state === 'running') counts.running += 1;
    else counts.pending += 1;
  }
  const updatedAt = mtimeOf(fs, `${dir}/ledger.jsonl`)
    ?? mtimeOf(fs, `${dir}/plan.json`)
    ?? mtimeOf(fs, `${dir}/goals.json`)
    ?? new Date().toISOString();
  return {
    schemaVersion: 1,
    sessionId,
    updatedAt,
    dag: {
      runs: [{
        run_id: sessionId,
        run_key: `loop:${sessionId}`,
        name: title,
        status,
        counts,
        nodes,
        edges,
        waves: [{ index: 0, node_ids: nodes.map((node) => node.id) }],
      }],
    },
    tasks: null,
  };
};

export const createDagServiceHandlers = (dependencies = {}) => {
  const {
    fs = nodeFs,
    snapshotDir = defaultServiceSnapshotDir(),
    now = Date.now,
    createBridge = (entry) => createOmoBridgeRuntime({
      fs,
      snapshotDir,
      resolveEngineEntry: () => entry ?? process.env.OMO_WRAPPER_PATH ?? null,
    }),
    codeGraphRuntime = null,
    attributionStateReader = createAttributionStateReader(),
    repairStateReader = createRepairStateReader(),
    recordTaskReader = null,
  } = dependencies;

  // Read-only code-graph runtime over the real engine bundle. The service
  // never indexes its own cwd: every request names its directory and the
  // runtime's normalizeDirectory binds the scope (missing/not-a-directory
  // fails before the engine runs). Overridable for tests; the default is
  // the real engine.
  //
  // `blockOnRead` makes the default runtime wait for the build, so these
  // routes answer with a published graph instead of `ready: false` and an
  // empty-looking index that a panel latches onto forever. The engine builds
  // synchronously, so a blocked read does not extend the freeze this process
  // already has: the non-blocking read answers in 15 ms and then the event
  // loop stalls for the whole build anyway (measured 3.4 s on this package),
  // while a blocking read returns at the same wall-clock moment with facts.
  // An injected runtime is used verbatim, never reconfigured.
  //
  // The default runtime shares the canonical persisted store with the panel
  // server and the agent tool (same directory, same generations): without a
  // storeDir this service rebuilt in memory on every process start, a third
  // indexing silo beside the other two surfaces.
  const codeGraphStoreDir = process.env.ALCODE_DATA_DIR !== undefined && process.env.ALCODE_DATA_DIR.length > 0
    ? joinPath(nodePath.resolve(process.env.ALCODE_DATA_DIR), 'code-graph-store')
    : joinPath(osHomedir(), '.config', 'alcode', 'code-graph-store');
  const codeGraph = codeGraphRuntime ?? createCodeGraphRuntime(
    { fsPromises: nodeFsPromises, path: nodePath },
    { blockOnRead: true, storeDir: codeGraphStoreDir },
  );

  try {
    fs.mkdirSync(snapshotDir, { recursive: true });
  } catch {
    // Reads degrade to NOT_FOUND and steer reports the write failure; a
    // missing directory must never crash the service process.
  }

  // sessionId -> { cancel, startedAt }: runs this service started that have
  // not reported their child closing yet. Cancel targets the latest steer
  // per session; a closed child removes its own entry.
  const live = new Map();

  // Latest composer route decision reported via POST /debug/route, merged
  // per report: { decision, sample, command, arguments, sessionId, at }.
  // Bounded by construction (one record); a service restart clears it.
  let lastRoute = null;

  // Per-session route registry feeding the /status loop-run listing: a bare
  // `ulw` send reports `captured-to-/ulw` before any loop state or snapshot
  // exists, so the pane can row that session within one refresh. Bounded
  // (50 sessions, oldest-inserted evicted); restart clears it, like `live`.
  const routeBySession = new Map();
  const recordRouteBySession = (report) => {
    const id = asString(report?.sessionId);
    if (!isSafeSessionId(id)) return;
    if (!routeBySession.has(id) && routeBySession.size >= DAG_LOOP_RUNS_MAX) {
      routeBySession.delete(routeBySession.keys().next().value);
    }
    routeBySession.delete(id);
    routeBySession.set(id, report);
  };

  // Read-only merge for GET /status: snapshot sessions keep their ids;
  // loopRuns adds sessions with loop state and/or a captured-to-/ulw route
  // report. Snapshot data always wins in the panel; this list never writes.
  const loopRunsForStatus = (directory) => {
    const seen = new Set();
    const runs = [];
    for (const sessionId of listLoopSessionIds(fs, directory)) {
      seen.add(sessionId);
      const state = readLoopState(fs, directory, sessionId);
      const route = routeBySession.get(sessionId) ?? null;
      runs.push({
        sessionId,
        source: 'loop',
        decision: asString(route?.decision) || null,
        plan: state.plan,
        goals: state.goals,
        ledger: state.ledger,
        events: state.events,
        updatedAt: mtimeOf(fs, `${directory.trim().replace(/[/\\]+$/, '')}/.omo/ulw-loop/${sessionId}/ledger.jsonl`),
      });    }
    for (const [sessionId, route] of routeBySession) {
      if (seen.has(sessionId)) continue;
      if (route?.decision !== 'captured-to-/ulw') continue;
      seen.add(sessionId);
      runs.push({
        sessionId,
        source: 'route',
        decision: route.decision,
        plan: false,
        goals: false,
        ledger: false,
        events: 0,
        updatedAt: asString(route?.at) || null,
      });
    }
    return runs.slice(0, DAG_LOOP_RUNS_MAX);
  };

  // Read-only History for GET /history: completed snapshots plus terminal
  // loop rows, newest first. Malformed snapshots are skipped (counted),
  // live/pending runs stay in the live view and never appear here. When a
  // directory filter is given, snapshot docs recorded for another
  // directory stay out; docs without a directory predate the filter and
  // show only unfiltered. Never writes.
  const historyFor = (directory) => {
    const trimmedDirectory = isNonEmptyString(directory) ? directory.trim() : null;
    const entries = [];
    let skipped = 0;
    const withMtime = [];
    for (const sessionId of snapshotSessions(fs, snapshotDir)) {
      const path = snapshotPathFor(sessionId);
      withMtime.push({ sessionId, path, mtime: mtimeOf(fs, path) });
    }
    withMtime.sort((a, b) => String(b.mtime ?? '').localeCompare(String(a.mtime ?? '')));
    for (const { sessionId, path } of withMtime.slice(0, DAG_LOOP_RUNS_MAX)) {
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(path, 'utf8'));
      } catch {
        skipped += 1;
        continue;
      }
      const runs = Array.isArray(doc?.dag?.runs) ? doc.dag.runs : [];
      const run = runs[0] ?? null;
      if (!isRecord(run)) {
        skipped += 1;
        continue;
      }
      const status = asString(run.status);
      if (status !== 'completed' && status !== 'failed') continue;
      const docDirectory = asString(doc?.directory);
      if (trimmedDirectory !== null && docDirectory !== null && docDirectory !== trimmedDirectory) continue;
      if (trimmedDirectory !== null && docDirectory === null) continue;
      entries.push({
        sessionId,
        source: 'snapshot',
        label: (asString(run.name) || sessionId).slice(0, 80),
        status,
        updatedAt: asString(doc?.updatedAt) || mtimeOf(fs, path),
      });
    }
    if (trimmedDirectory !== null) {
      // Terminal loop rows reuse the exact projection the live view
      // renders, so History never disagrees with it.
      for (const sessionId of listLoopSessionIds(fs, trimmedDirectory)) {
        const projected = projectLoopSnapshot(fs, trimmedDirectory, sessionId, false);
        const run = projected?.dag?.runs?.[0] ?? null;
        if (!isRecord(run)) continue;
        const status = asString(run.status);
        if (status !== 'completed' && status !== 'failed') continue;
        entries.push({
          sessionId,
          source: 'loop',
          label: (asString(run.name) || sessionId).slice(0, 80),
          status,
          updatedAt: asString(projected.updatedAt) || null,
        });
      }
    }
    if (trimmedDirectory !== null) {
      const seen = new Set(entries.map((entry) => `${entry.sessionId} ${entry.updatedAt ?? ''} ${entry.status}`));
      for (const projectEntry of projectHistoryFor(trimmedDirectory)) {
        const key = `${projectEntry.sessionId} ${projectEntry.updatedAt ?? ''} ${projectEntry.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(projectEntry);
      }
    }
    entries.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    return { entries: entries.slice(0, DAG_LOOP_RUNS_MAX), skipped };
  };

  const bridgeError = (error, fallbackCode) => {
    const code = error?.code ?? fallbackCode;
    if (code === 'OMO_ENGINE_ABSENT') {
      return { status: 503, body: { ok: false, code, message: error.message } };
    }
    if (code === 'OMO_INVOKE_ARGS_INVALID' || code === 'OMO_SESSION_ID_INVALID' || code === 'OMO_SNAPSHOT_DIR_INVALID') {
      return { status: 400, body: { ok: false, code, message: error.message } };
    }
    if (code === 'OMO_PROVIDER_NOT_SIGNED_IN') {
      return { status: 409, body: { ok: false, code, message: error.message } };
    }
    return { status: 500, body: { ok: false, code, message: error?.message ?? 'The DAG service failed.' } };
  };

  const snapshotPathFor = (sessionId) => defaultSnapshotPath(snapshotDir, sessionId);

  let recordReaderCache = null;
  const recordTaskReaderForHandlers = () => {
    if (recordTaskReader !== null) return recordTaskReader;
    if (recordReaderCache === null) recordReaderCache = createRecordTaskReaderForProject();
    return recordReaderCache;
  };

  // The panel's own read has to agree with the run-graph route, or the same task appears in one surface and not the
  // other. Both sides use this reader and this merge, and a task that exists only as a canonical record is still a task:
  // the snapshot is one source, not the source.
  const recordRowsFor = (directory, sessionId) => {
    if (!isSafeDirectory(directory ?? '')) return { rows: [], diagnostics: undefined };
    try {
      const read = recordTaskReaderForHandlers();
      const result = read({ directory });
      if (result.error !== undefined) return { rows: [], error: result.error };
      if (!Array.isArray(result.tasks)) return { rows: [], error: 'The canonical task reader returned an invalid result.' };
      return { rows: rowsForConversation(result.tasks, sessionId), diagnostics: result.diagnostics };
    } catch (error) {
      return { rows: [], error: error?.message ?? 'The canonical task store could not be read.' };
    }
  };

  const withRecordTasks = (document, sessionId, directory) => {
    const records = recordRowsFor(directory, sessionId);
    const merged = records.rows.length > 0 ? mergeRecordTasks(document, records.rows, records.diagnostics) : document;
    const described = records.error === undefined ? merged : (() => {
      const container = isRecord(merged) ? merged : {};
      const tasks = isRecord(container.tasks) ? { ...container.tasks } : {};
      tasks.recordError = records.error;
      return { ...container, tasks };
    })();
    return attachRepairToTasks(described, directory);
  };

  // The panel's repair rows come from this field, so a task the record layer contributed has to carry it here too: the
  // HTTP surface attaches repair after the merge, and a divergence would show a repaired task over HTTP and a bare one
  // in the pane.
  const attachRepairToTasks = (document, directory) => {
    if (!isRecord(document) || !isSafeDirectory(directory ?? '')) return document;
    const container = isRecord(document.tasks) ? document.tasks : null;
    const rows = container !== null && Array.isArray(container.tasks) ? container.tasks : null;
    if (rows === null) return document;
    let changed = false;
    const next = rows.map((row) => {
      if (!isRecord(row) || isRecord(row.repair)) return row;
      const taskId = asString(row.task_id);
      if (taskId.length === 0) return row;
      let result;
      try {
        result = repairStateReader({ directory, taskId });
      } catch {
        return row;
      }
      if (!isRecord(result) || !isRecord(result.repair)) return row;
      changed = true;
      return { ...row, repair: result.repair };
    });
    return changed ? { ...document, tasks: { ...container, tasks: next } } : document;
  };

  const recordOnlyDocument = (sessionId, directory) => {
    const records = recordRowsFor(directory, sessionId);
    if (records.error !== undefined) {
      return { status: 500, body: { ok: false, code: 'DAG_TASK_STORE_UNREADABLE', message: records.error, sessionId } };
    }
    if (records.rows.length === 0) {
      if (records.diagnostics?.limitReached === true) {
        return { status: 503, body: { ok: false, code: 'DAG_TASK_STORE_TRUNCATED', message: 'The canonical task store was read only up to its limit, so this conversation was not checked.', sessionId } };
      }
      return null;
    }
    return {
      status: 200,
      body: attachRepairToTasks(
        mergeRecordTasks(
          { schemaVersion: 1, sessionId, tasks: { parent_session_id: sessionId, tasks: records.rows }, dag: { parent_session_id: sessionId, runs: [] } },
          [],
          records.diagnostics,
        ),
        directory,
      ),
    };
  };

  const readSnapshot = (sessionId, directory) => {
    // A pane with no project bound cannot resolve a task store, and guessing one would read another project's work.
    // Say so in the payload instead of answering an empty graph that looks like "this conversation ran nothing".
    const scoped = isSafeDirectory(directory ?? '');
    const withScope = (result) => {
      if (scoped || result.status !== 200 || !isRecord(result.body)) return result;
      const tasks = isRecord(result.body.tasks) ? result.body.tasks : {};
      return { ...result, body: { ...result.body, tasks: { ...tasks, recordUnscoped: true } } };
    };
    let tempPath;
    try {
      tempPath = snapshotPathFor(sessionId);
    } catch (error) {
      return { status: 400, body: { ok: false, code: error.code ?? 'OMO_SESSION_ID_INVALID', message: error.message } };
    }
    // Engine documents outrank the synthetic steer fallback wherever they
    // live: temp engine, project engine, temp fallback, project document,
    // then a malformed candidate. Both candidates are parsed before choosing,
    // so a malformed temp write can never hide a valid project engine
    // document. Age is not authority: an older engine document still wins.
    // A project-scoped request ranks the project's own document above the shared temp one: the temp directory is not
    // directory-scoped, so preferring it would answer with another project's run for the same session id.
    const candidates = [];
    if (isSafeDirectory(directory ?? '')) {
      const projectPath = projectLiveRunPath(directory, sessionId);
      candidates.push({ text: readFileOrNull(fs, projectPath), path: projectPath });
    }
    candidates.push({ text: readFileOrNull(fs, tempPath), path: tempPath });
    // A snapshot that exists but cannot be read is not a missing snapshot: answering it as empty or absent would claim
    // the run had no nodes when nobody could look.
    const unreadable = candidates.some(({ text, path: candidatePath }) => text === null && fs.existsSync(candidatePath));
    if (unreadable) {
      return { status: 500, body: { ok: false, code: 'DAG_SNAPSHOT_UNREADABLE', field: 'snapshot', sessionId } };
    }
    const parsed = candidates.map(({ text }) => {
      if (text === null) return { doc: null, malformed: false, present: false };
      try {
        return { doc: JSON.parse(text), malformed: false, present: true };
      } catch {
        return { doc: null, malformed: true, present: true };
      }
    });
    const engine = parsed.find((candidate) => candidate.present && !candidate.malformed && isEngineSnapshotDocument(candidate.doc));
    const document = engine ?? parsed.find((candidate) => candidate.present && !candidate.malformed);
    if (document !== undefined) {
      return withScope({ status: 200, body: withRecordTasks(document.doc, sessionId, directory) });
    }
    if (parsed.some((candidate) => candidate.malformed)) {
      return { status: 422, body: { ok: false, code: 'DAG_SNAPSHOT_MALFORMED', field: 'snapshot', sessionId } };
    }
    const fromRecords = recordOnlyDocument(sessionId, directory);
    if (fromRecords !== null) return withScope(fromRecords);
    return { status: 404, body: { ok: false, code: 'OMO_DAG_SNAPSHOT_MISSING', sessionId } };
  };

  // Project-scoped History for GET /history with a directory filter: the live
  // file plus immutable terminal records for that directory only. Without a
  // directory filter there is no project scope to list, so only the temp-dir
  // sources above apply. Entries stay display-only; the live view never binds
  // them. Never writes.
  const projectHistoryFor = (directory) => {
    const entries = [];
    const runsDir = projectRunsDir(directory);
    let names;
    try {
      names = fs.readdirSync(runsDir);
    } catch {
      return entries;
    }
    const seen = new Set();
    for (const name of names) {
      if (!name.endsWith('.snapshot.json')) continue;
      const sessionId = name.slice(0, -'.snapshot.json'.length);
      if (!isSafeSessionId(sessionId)) continue;
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(`${runsDir}/${name}`, 'utf8'));
      } catch {
        continue;
      }
      const parsed = readPostedRunDoc(doc);
      if (!parsed || (parsed.status !== 'completed' && parsed.status !== 'failed')) continue;
      const key = `${sessionId} ${parsed.updatedAt ?? ''} ${parsed.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        sessionId,
        source: 'project',
        label: (asString(doc?.dag?.runs?.[0]?.name) || sessionId).slice(0, 80),
        status: parsed.status,
        updatedAt: parsed.updatedAt,
      });
    }
    let sessionDirs;
    try {
      sessionDirs = fs.readdirSync(`${runsDir}/${DAG_RUN_HISTORY_DIRNAME}`, { withFileTypes: true });
    } catch {
      return entries;
    }
    for (const entry of sessionDirs) {
      let sessionId;
      try {
        if (!entry.isDirectory() || !isSafeSessionId(entry.name)) continue;
        sessionId = entry.name;
      } catch {
        continue;
      }
      let records;
      try {
        records = fs.readdirSync(`${runsDir}/${DAG_RUN_HISTORY_DIRNAME}/${sessionId}`);
      } catch {
        continue;
      }
      for (const record of records) {
        if (!/^\d+\.json$/.test(record)) continue;
        let doc;
        try {
          doc = JSON.parse(fs.readFileSync(`${runsDir}/${DAG_RUN_HISTORY_DIRNAME}/${sessionId}/${record}`, 'utf8'));
        } catch {
          continue;
        }
        const parsed = readPostedRunDoc(doc);
        if (!parsed || (parsed.status !== 'completed' && parsed.status !== 'failed')) continue;
        const key = `${sessionId} ${parsed.updatedAt ?? ''} ${parsed.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          sessionId,
          source: 'project-history',
          label: (asString(doc?.dag?.runs?.[0]?.name) || sessionId).slice(0, 80),
          status: parsed.status,
          updatedAt: parsed.updatedAt,
        });
      }
    }
    return entries;
  };

  const handleRequest = async ({ method, path, query = {}, body = {} } = {}) => {
    if (method === 'GET' && path === '/health') {
      return { status: 200, body: { ok: true, service: DAG_SERVICE_NAME } };
    }
    if (method === 'GET' && path === '/status') {
      const entry = isNonEmptyString(query?.entry) ? query.entry.trim() : undefined;
      const bridge = createBridge(entry);
      const probe = await bridge.probe({ includeToolkit: true });
      return {
        status: 200,
        body: {
          ok: true,
          probe,
          sessions: snapshotSessions(fs, snapshotDir),
          loopRuns: loopRunsForStatus(isNonEmptyString(query?.directory) ? query.directory : ''),
          // Live steers this service started and still tracks: engine runs
          // emit no snapshot events, so without this list a running steer
          // is invisible to the pane until (and unless) state lands.
          liveRuns: [...live.entries()].map(([liveSessionId, record]) => ({
            sessionId: liveSessionId,
            startedAt: record?.startedAt ?? null,
          })),
          snapshotDir,
          now: new Date(now()).toISOString(),
        },
      };
    }
    if (method === 'POST' && path === '/debug/route') {
      const decision = body?.decision;
      if (!DAG_DEBUG_ROUTE_DECISIONS.includes(decision)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_ROUTE_INVALID', message: 'Route reports one decision: captured-to-/ulw, plain-prompt, shell, or slash-command.' } };
      }
      const sample = typeof body?.sample === 'string' ? body.sample.slice(0, DAG_DEBUG_SAMPLE_MAX) : '';
      const command = isNonEmptyString(body?.command) ? body.command.trim().slice(0, 128) : null;
      const args = typeof body?.arguments === 'string' ? body.arguments.slice(0, 512) : null;
      const routeSessionId = isNonEmptyString(body?.sessionId) ? body.sessionId.trim() : null;
      lastRoute = {
        decision,
        sample,
        command,
        arguments: args,
        sessionId: routeSessionId,
        at: new Date(now()).toISOString(),
      };
      recordRouteBySession(lastRoute);
      return { status: 200, body: { ok: true, route: lastRoute } };
    }
    if (method === 'GET' && path === '/debug') {
      const sessionId = query?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass ?sessionId=<run session>.' } };
      }
      const trimmedSession = sessionId.trim();
      if (trimmedSession.includes('/') || trimmedSession.includes('\\') || trimmedSession.includes('..')) {
        return { status: 400, body: { ok: false, code: 'OMO_SESSION_ID_INVALID', message: 'Session ids stay inside one directory.' } };
      }
      const hookSample = lastRoute?.sample
        ?? (typeof query?.sample === 'string' ? query.sample.slice(0, DAG_DEBUG_SAMPLE_MAX) : '');
      let hookHit = false;
      try {
        hookHit = new RegExp(DAG_DEBUG_HOOK_PATTERN, 'i').test(hookSample);
      } catch {
        hookHit = false;
      }
      const loop = readLoopState(fs, query?.directory, trimmedSession);
      const snapshot = readSnapshotState(fs, snapshotPathFor, trimmedSession);
      let probe;
      try {
        const entry = isNonEmptyString(query?.entry) ? query.entry.trim() : undefined;
        probe = await createBridge(entry).probe({ includeToolkit: true });
      } catch (error) {
        probe = { available: false, compatible: false, code: 'OMO_DEBUG_PROBE_THROW', message: String(error?.message ?? error).slice(0, DAG_DEBUG_MESSAGE_MAX) };
      }
      const probeRecord = probe !== null && typeof probe === 'object' ? probe : {};
      return {
        status: 200,
        body: {
          ok: true,
          route: lastRoute,
          hook: { pattern: DAG_DEBUG_HOOK_PATTERN, hit: hookHit, sample: hookSample },
          loop,
          snapshot,
          probe: {
            code: typeof probeRecord.code === 'string' ? probeRecord.code : null,
            available: probeRecord.available === true,
            compatible: probeRecord.compatible === true,
            entry: typeof probeRecord.entry === 'string' || probeRecord.entry === null ? probeRecord.entry ?? null : null,
            message: typeof probeRecord.message === 'string' ? probeRecord.message.slice(0, DAG_DEBUG_MESSAGE_MAX) : null,
          },
          sessions: snapshotSessions(fs, snapshotDir),
          snapshotDir,
          now: new Date(now()).toISOString(),
        },
      };
    }
    if (method === 'GET' && path === '/loop') {
      const sessionId = query?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass ?sessionId=<run session>.' } };
      }
      const trimmedSession = sessionId.trim();
      if (!isSafeSessionId(trimmedSession)) {
        return { status: 400, body: { ok: false, code: 'OMO_SESSION_ID_INVALID', message: 'Session ids stay inside one directory.' } };
      }
      const directory = isNonEmptyString(query?.directory) ? query.directory : '';
      if (isNonEmptyString(directory)) {
        const projected = projectLoopSnapshot(fs, directory, trimmedSession, live.has(trimmedSession));
        if (projected !== null) {
          return { status: 200, body: projected };
        }
      }
      // Live-run fallback: a live run with no loop state yet still rows as
      // pending, so the run is visible within one refresh and upgrades as
      // state arrives. Liveness itself is the freshness evidence (the
      // service started this run and still tracks it); the route report
      // only refines the label when present. A dead session 404s like
      // missing state. Reads the registry only; writes nothing.
      const route = routeBySession.get(trimmedSession) ?? null;
      const liveLabel = live.get(trimmedSession)?.label;
      if (live.has(trimmedSession)) {
        return {
          status: 200,
          body: {
            schemaVersion: 1,
            sessionId: trimmedSession,
            updatedAt: asString(route?.at) || new Date(now()).toISOString(),
            dag: {
              runs: [{
                run_id: trimmedSession,
                run_key: `loop:${trimmedSession}`,
                name: trimmedSession,
                status: 'pending',
                counts: { pending: 1, running: 0, completed: 0 },
                nodes: [{
                  id: 'step-1',
                  label: (asString(route?.arguments) || asString(liveLabel) || trimmedSession).slice(0, 64),
                  state: 'pending',
                  attempt: 1,
                  prompt: asString(route?.sample) || asString(liveLabel) || trimmedSession,
                  depends_on: [],
                  started_at: null,
                  completed_at: null,
                }],
                edges: [],
                waves: [{ index: 0, node_ids: ['step-1'] }],
              }],
            },
            tasks: null,
          },
        };
      }
      return { status: 404, body: { ok: false, code: 'OMO_DAG_NO_LOOP', sessionId: trimmedSession } };
    }
    if (method === 'GET' && path === '/snapshot') {
      const sessionId = query?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass ?sessionId=<run session>.' } };
      }
      const directory = isNonEmptyString(query?.directory) ? query.directory.trim() : null;
      if (directory !== null && !isSafeDirectory(directory)) {
        return { status: 400, body: { ok: false, code: 'OMO_INVOKE_ARGS_INVALID', message: 'directory must be an absolute path without .. segments when given.' } };
      }
      return readSnapshot(sessionId.trim(), directory);
    }
    // Durable chat-run record: the host posts the run model it built from
    // engine session data, and the service persists it project-scoped. A run
    // belongs to exactly one parent conversation: conversationId must equal
    // the doc's sessionId, and empty-run docs are rejected so a valid
    // persisted run is never replaced by an empty snapshot.
    if (method === 'POST' && path === '/snapshot') {
      const directory = body?.directory;
      const conversationId = body?.conversationId;
      if (!isSafeDirectory(directory ?? '')) {
        return { status: 400, body: { ok: false, code: 'OMO_INVOKE_ARGS_INVALID', message: 'directory must be an absolute project path without .. segments.' } };
      }
      if (!isSafeSessionId(conversationId ?? '')) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Pass conversationId=<parent conversation>.' } };
      }
      const parsed = readPostedRunDoc(body?.snapshot);
      if (!parsed) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SNAPSHOT_INVALID', message: 'snapshot must carry schemaVersion 1, a sessionId, and a non-empty dag.runs record.' } };
      }
      if (parsed.sessionId !== asString(conversationId).trim()) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_CONVERSATION_MISMATCH', message: 'A run belongs to exactly one parent conversation.' } };
      }
      const livePath = projectLiveRunPath(directory, parsed.sessionId);
      // Corroborate posted identity before anything is persisted: a claim the
      // records do not confirm is dropped and reported, never written and
      // never turned into a rejection of an otherwise valid doc. When the
      // records are unavailable every posted id is unverifiable, so all are
      // dropped rather than persisted on trust.
      const attribution = readPostedAttribution(attributionStateReader, directory.trim());
      const attributionDropped = [];
      const snapshotDoc = attribution.index === undefined
        ? dropUnverifiablePostedIds(body.snapshot, attributionDropped)
        : corroboratePostedSnapshot(body.snapshot, attribution.index, attributionDropped, parsed.sessionId);
      const attributionReport = attribution.index === undefined
        ? { attributionCorroboration: 'skipped', attributionSkippedReason: attribution.skipped, attributionDropped }
        : { attributionCorroboration: 'applied', attributionDropped };
      const published = mutateRunSnapshot({
        path: livePath,
        replaceMalformed: true,
        updatedAt: isNonEmptyString(snapshotDoc?.updatedAt) ? snapshotDoc.updatedAt : new Date(now()).toISOString(),
        mutate: ({ doc }) => {
          const merged = mergeChatSnapshot(doc, snapshotDoc, directory.trim());
          return { doc: merged.doc, value: merged.doc };
        },
      });
      if (!published.written) {
        if (published.reason === 'snapshot already current') {
          return { status: 200, body: { ok: true, sessionId: parsed.sessionId, written: false, historyRecorded: false, reason: 'unchanged', ...attributionReport } };
        }
        return { status: 500, body: { ok: false, code: 'OMO_DAG_SNAPSHOT_WRITE_FAILED', message: String(published.reason).slice(0, 140) } };
      }
      const serialized = `${JSON.stringify(published.value)}\n`;
      let historyRecorded = false;
      if (parsed.status === 'completed' || parsed.status === 'failed') {
        const historyDir = projectRunHistoryDir(directory, parsed.sessionId);
        const recordPath = `${historyDir}/${updatedAtMs(parsed.updatedAt, now)}.json`;
        try {
          if (readFileOrNull(fs, recordPath) === null) {
            writeFileAtomic(fs, recordPath, serialized);
          }
          historyRecorded = true;
          const records = fs.readdirSync(historyDir).filter((name) => /^\d+\.json$/.test(name))
            .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
          for (const stale of records.slice(0, Math.max(0, records.length - DAG_RUN_HISTORY_MAX))) {
            try {
              fs.unlinkSync(`${historyDir}/${stale}`);
            } catch {
              // Retention stays best-effort; the record itself is durable.
            }
          }
        } catch {
          // A history-record failure must never fail the live write.
          historyRecorded = false;
        }
      }
      return { status: 200, body: { ok: true, sessionId: parsed.sessionId, written: true, historyRecorded, ...attributionReport } };
    }
    if (method === 'GET' && path === '/history') {
      const directory = isNonEmptyString(query?.directory) ? query.directory.trim() : null;
      return { status: 200, body: { ok: true, ...historyFor(directory) } };
    }
    if (method === 'POST' && path === '/steer') {
      const message = body?.message;
      const sessionId = body?.sessionId;
      const entry = isNonEmptyString(body?.entry) ? body.entry.trim() : undefined;
      if (!isNonEmptyString(message)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_MESSAGE_REQUIRED', message: 'Steering needs a non-empty message.' } };
      }
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Steering attaches to a live session: pass sessionId.' } };
      }
      let snapshotPath;
      try {
        snapshotPath = snapshotPathFor(sessionId.trim());
      } catch (error) {
        return { status: 400, body: { ok: false, code: error.code ?? 'OMO_SESSION_ID_INVALID', message: error.message } };
      }
      const model = isNonEmptyString(body?.model) ? body.model.trim() : undefined;
      const agent = isNonEmptyString(body?.agent) ? body.agent.trim() : undefined;
      // Project scope for the History filter. Optional; a wrong-typed value
      // is rejected so a caller cannot silently mis-scope its own record.
      if (body?.directory !== undefined && !isNonEmptyString(body.directory)) {
        return { status: 400, body: { ok: false, code: 'OMO_INVOKE_ARGS_INVALID', message: 'directory must be a non-empty string when given.' } };
      }
      const steerDirectory = isNonEmptyString(body?.directory) ? body.directory.trim() : null;
      const bridge = createBridge(entry);
      let handle;
      try {
        handle = bridge.invoke({
          message: message.trim(),
          sessionId: sessionId.trim(),
          snapshotPath,
          model,
          agent,
        });
      } catch (error) {
        return bridgeError(error, 'OMO_SPAWN_FAILED');
      }
      const startedAt = new Date(now()).toISOString();
      const steerLabel = message.trim().slice(0, 128);
      live.set(sessionId.trim(), { cancel: handle.cancel, startedAt, label: steerLabel, directory: steerDirectory });
      // Completion snapshot for steer runs: engine runs emit no snapshot
      // events, so without this record a finished steer vanishes from the
      // pane the moment its live entry clears. Records only what the
      // service observed (start, end, outcome); never invents child nodes.
      // Skipped when a richer snapshot already landed, and never throws.
      // A canceled run writes nothing: cancel clears the live entry first,
      // so the ownership check below refuses the settled child.
      const settleSteer = (completion) => {
        const record = live.get(sessionId.trim());
        if (record?.cancel !== handle.cancel) return;
        const recordDirectory = record.directory ?? null;
        live.delete(sessionId.trim());
        const tempSnapshotPath = snapshotPathFor(sessionId.trim());
        if (readFileOrNull(fs, tempSnapshotPath) !== null) return;
        // KEEP the synthetic writer, guarded (owner decision OQ-B): an engine
        // document at either path owns the run, so a synthetic completion
        // record is never written beside one. The engine document wins in the
        // reader regardless; this guard keeps the fallback from competing
        // with it at all.
        if (isSafeDirectory(recordDirectory ?? '')) {
          const projectText = readFileOrNull(fs, projectLiveRunPath(recordDirectory, sessionId.trim()));
          if (projectText !== null) {
            let projectDoc = null;
            try {
              projectDoc = JSON.parse(projectText);
            } catch {
              projectDoc = null;
            }
            if (isEngineSnapshotDocument(projectDoc)) return;
          }
        }
        const failed = completion?.exitCode !== 0 || completion?.result?.success === false;
        const state = failed ? 'failed' : 'completed';
        const doc = {
          schemaVersion: 1,
          sessionId: sessionId.trim(),
          updatedAt: new Date(now()).toISOString(),
          directory: recordDirectory,
          dag: {
            runs: [{
              run_id: sessionId.trim(),
              run_key: `steer:${sessionId.trim()}`,
              name: sessionId.trim(),
              status: state,
              counts: state === 'failed'
                ? { pending: 0, running: 0, completed: 0 }
                : { pending: 0, running: 0, completed: 1 },
              nodes: [{
                id: 'step-1',
                label: steerLabel.slice(0, 64),
                state,
                attempt: 1,
                prompt: steerLabel,
                depends_on: [],
                started_at: startedAt,
                completed_at: new Date(now()).toISOString(),
              }],
              edges: [],
              waves: [{ index: 0, node_ids: ['step-1'] }],
            }],
          },
          tasks: null,
        };
        try {
          fs.writeFileSync(tempSnapshotPath, `${JSON.stringify(doc)}\n`, 'utf8');
        } catch {
          // A missing directory must never fail the settle path.
        }
      };
      handle.wait().then(settleSteer, () => settleSteer(undefined));
      return {
        status: 200,
        body: {
          ok: true, sessionId: sessionId.trim(), entry: handle.entry, argv: handle.argv, startedAt,
          native: handle.native === true,
        },
      };
    }
    if (method === 'POST' && path === '/cancel') {
      const sessionId = body?.sessionId;
      if (!isNonEmptyString(sessionId)) {
        return { status: 400, body: { ok: false, code: 'OMO_DAG_SESSION_REQUIRED', message: 'Cancel targets a live session: pass sessionId.' } };
      }
      const running = live.get(sessionId.trim());
      if (!running) {
        return { status: 404, body: { ok: false, code: 'OMO_DAG_NO_RUN', sessionId: sessionId.trim() } };
      }
      let receipt;
      try {
        receipt = await running.cancel(isNonEmptyString(body?.reason) ? body.reason.trim() : 'pane cancel');
      } catch (error) {
        return bridgeError(error, 'OMO_CANCEL_FAILED');
      }
      live.delete(sessionId.trim());
      return { status: 200, body: { ok: true, sessionId: sessionId.trim(), receipt } };
    }
    // Read-only code-graph index over the real engine runtime. Mirrors the
    // web routes.js contract: directory scoping is explicit (a request
    // without a directory fails loudly instead of indexing the service
    // cwd), and a backend failure answers 5xx with the error — never an
    // empty-fake success the pane could mistake for "no symbols here".
    if (method === 'GET' && path === '/codegraph/index') {
      const scoped = await codeGraph.normalizeDirectory(query?.directory);
      if (scoped.error) {
        return { status: scoped.status ?? 400, body: { error: scoped.error } };
      }
      try {
        const refresh = query?.refresh === '1' || query?.refresh === 'true';
        return { status: 200, body: await codeGraph.readIndex(scoped.directory, { refresh }) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? 'Failed to read code graph index');
        const status = typeof error?.status === 'number' ? error.status : 500;
        return { status, body: { error: message || 'Failed to read code graph index' } };
      }
    }
    // Read-only code-graph query over the real engine runtime. Same scope
    // resolution as /codegraph/index; query-shape mistakes (unknown kind,
    // missing subject) answer 400 with the reason before/after the engine
    // runs, and backend failures answer 5xx with the error.
    if (method === 'GET' && path === '/codegraph/query') {
      const scoped = await codeGraph.normalizeDirectory(query?.directory);
      if (scoped.error) {
        return { status: scoped.status ?? 400, body: { error: scoped.error } };
      }
      try {
        const rawLimit = Number(query?.limit);
        const result = await codeGraph.query(scoped.directory, {
          kind: query?.kind,
          symbol: query?.symbol,
          query: query?.q,
          target: query?.target,
          file: query?.file,
          limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
          refresh: query?.refresh === '1' || query?.refresh === 'true',
        });
        if (result && typeof result.error === 'string') {
          return { status: result.status ?? 400, body: { error: result.error } };
        }
        return { status: 200, body: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? 'Failed to query code graph');
        const status = typeof error?.status === 'number' ? error.status : 500;
        return { status, body: { error: message || 'Failed to query code graph' } };
      }
    }
    // Read-only rationale over the real project-knowledge store. Lists the
    // HEAD-tree project-knowledge/*.md files for the directory via git,
    // loads them with ProjectKnowledgeStore.loadCommitted, ranks them with
    // retrieveProjectKnowledge, and evaluates freshness per record against
    // the directory HEAD revision. Empty store, cross-project query, or
    // missing directory answers ranked [] with no fabricated text; only an
    // unsafe directory or a backend throw fails loud.
    if (method === 'GET' && path === '/rationale') {
      const rationaleDirectory = asString(query?.directory);
      const rationaleProjectId = asString(query?.projectId);
      const rationaleQuery = asString(query?.q);
      const rationaleScopes = asString(query?.scopes).split(',').map((scope) => scope.trim()).filter((scope) => scope.length > 0);
      if (rationaleDirectory === '') {
        return { status: 200, body: { projectId: rationaleProjectId || null, revision: null, ranked: [], purgedSecretIds: [] } };
      }
      if (!isSafeDirectory(rationaleDirectory)) {
        return { status: 400, body: { error: 'directory must be an absolute path without .. segments.' } };
      }
      let directoryStat = null;
      try {
        directoryStat = fs.statSync(rationaleDirectory);
      } catch {
        directoryStat = null;
      }
      if (directoryStat === null || !directoryStat.isDirectory()) {
        return { status: 200, body: { projectId: rationaleProjectId || null, revision: null, ranked: [], purgedSecretIds: [] } };
      }
      const headTree = readHeadTreeProjectKnowledge(rationaleDirectory);
      if (rationaleProjectId === '' || rationaleQuery === '' || headTree.files.length === 0) {
        return { status: 200, body: { projectId: rationaleProjectId || null, revision: headTree.revision, ranked: [], purgedSecretIds: [] } };
      }
      try {
        const store = new ProjectKnowledgeStore();
        store.loadCommitted(headTree.files);
        const retrieval = retrieveProjectKnowledge(store.eligible(), {
          projectId: rationaleProjectId,
          queryTexts: [rationaleQuery],
          nodeWriteScopes: rationaleScopes,
          nowMs: now(),
        });
        const ranked = retrieval.ranked.map((entry) => {
          const freshness = evaluateFreshness(entry.record, headTree.revision ?? entry.record.sourceRevision, now());
          const effective = freshness.record;
          return {
            id: effective.id,
            claim: effective.claim,
            kind: entry.record.category,
            standing: effective.category,
            confidence: effective.confidence,
            sourceFile: effective.sourceFile,
            sourceSymbol: effective.sourceSymbol,
            observedAt: effective.observedAt,
            validationMethod: effective.validationMethod,
            invalidationConditions: [...effective.invalidationConditions],
            notes: (effective.rationale?.notes ?? []).map((note) => ({ ...note })),
            freshness: { demoted: freshness.demoted, appliedCase: freshness.appliedCase },
            scopeNote: entry.scopeNote,
            totalScore: entry.totalScore,
          };
        });
        return {
          status: 200,
          body: {
            projectId: rationaleProjectId,
            revision: headTree.revision,
            ranked,
            purgedSecretIds: [...retrieval.purgedSecretIds],
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? 'Failed to read rationale');
        return { status: 500, body: { error: message || 'Failed to read rationale' } };
      }
    }
    // Read-only project discovery over the HEAD-tree knowledge files for
    // the directory: which projectIds exist, without ranking anything.
    // Validation mirrors GET /rationale exactly (blank answers an honest
    // empty, traversal fails before git runs), and each blob's frontmatter
    // projectId parses through parseRecordFile, so dropped/secret files
    // never contribute an id. Answers distinct ids, sorted.
    if (method === 'GET' && path === '/rationale/projects') {
      const projectsDirectory = asString(query?.directory);
      if (projectsDirectory === '') {
        return { status: 200, body: { revision: null, projectIds: [] } };
      }
      if (!isSafeDirectory(projectsDirectory)) {
        return { status: 400, body: { error: 'directory must be an absolute path without .. segments.' } };
      }
      let projectsStat = null;
      try {
        projectsStat = fs.statSync(projectsDirectory);
      } catch {
        projectsStat = null;
      }
      if (projectsStat === null || !projectsStat.isDirectory()) {
        return { status: 200, body: { revision: null, projectIds: [] } };
      }
      const headTree = readHeadTreeProjectKnowledge(projectsDirectory);
      const projectIds = [...new Set(
        headTree.files.flatMap(({ path: recordPath, content }) => {
          const parsed = parseRecordFile(recordPath, content);
          return parsed.kind === 'record' ? [parsed.record.projectId] : [];
        }),
      )].sort();
      return { status: 200, body: { revision: headTree.revision, projectIds } };
    }
    return { status: 404, body: { ok: false, code: 'OMO_DAG_UNKNOWN_PATH', path } };
  };

  return { handleRequest, live };
};
