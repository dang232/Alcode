import { createRunGraphRuntime } from './runtime.js';

/**
 * Read-only run-graph route: one persisted engine snapshot per conversation.
 *
 * - `GET /api/run-graph/snapshot?directory=...&conversationId=...` serves
 *   `<directory>/.omo/dag-runs/<conversationId>.snapshot.json` as parsed
 *   JSON. The file is written by the engine-side snapshot writer; this route
 *   never writes.
 *
 * Each `dag.runs[]` and `tasks.tasks[]` record is enriched from authoritative
 * durable state, never from UI state:
 * - `repair`: the current-epoch record of
 *   `<stateDir>/repairs/<taskId>/<attemptId>.json`,
 *   `{ attemptId, taskId, epoch, state, failedChecks[], rerunChecks[],
 *     changedFiles[], verificationStatus, hostFacts[], modelHypotheses[],
 *     updatedAt }` (`verificationStatus` comes only from the persisted gate
 *   record's `verification_status`).
 * - absent when the task has no repair attempt, and omitted when the newest
 *   attempt's epoch is not the task record's current `run_epoch`.
 * - `repairError`: the store or task record could not be read. A read failure
 *   is never reported as "no repair".
 *
 * Attribution is projected the same way from the canonical task records:
 * - `tasks.tasks[].node_id` is the record's DAG node for that `task_id`.
 * - A node in a chat run (`run_key` starts with `chat:`) gets `task_id` and
 *   `node_id` only when its id is a known `child_session_id`.
 * - `attributionCollisions` reports two records claiming one child session
 *   instead of guessing; `attributionError` reports an unreadable store.
 *
 * `GET /api/run-graph/attribution?directory=...` serves that same index for
 * one project. A missing state directory answers 404 with
 * `code: "ATTRIBUTION_STATE_ABSENT"` (never an empty success), and a reader
 * failure answers 5xx with `code: "ATTRIBUTION_STATE_UNAVAILABLE"`.
 *
 * Failures are explicit: a missing directory or conversation id answers 400,
 * a missing snapshot answers 404, and a backend failure answers 5xx. The
 * panel treats every failure as "unknown", never as an empty run.
 */
export const registerRunGraphRoutes = (app, dependencies = {}) => {
  const runGraphRuntime = dependencies.runGraphRuntime ?? createRunGraphRuntime();

  app.get('/api/run-graph/snapshot', async (req, res) => {
    const { directory, error, status } = await runGraphRuntime.normalizeDirectory(req.query.directory);
    if (error) {
      res.status(status ?? 400).json({ error });
      return undefined;
    }
    try {
      const result = await runGraphRuntime.readSnapshot(directory, req.query.conversationId);
      if (result && result.error) {
        return res.status(result.status ?? 404).json({ error: `${result.error}` });
      }
      return res.json(result);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to read run snapshot';
      const code = Number(caught?.status);
      const httpStatus = Number.isInteger(code) && code >= 400 && code < 600 ? code : 500;
      return res.status(httpStatus).json({ error: message || 'Failed to read run snapshot' });
    }
  });

  app.post('/api/run-graph/reconcile', async (req, res) => {
    const body = req.body ?? {};
    const { directory, error, status } = await runGraphRuntime.normalizeDirectory(body.directory ?? req.query.directory);
    if (error) {
      res.status(status ?? 400).json({ error });
      return undefined;
    }
    try {
      const result = await runGraphRuntime.reconcileSnapshots(directory);
      if (result && result.error) return res.status(500).json({ error: `${result.error}` });
      return res.json(result);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to reconcile run snapshots';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/run-graph/attribution', async (req, res) => {
    const { directory, error, status } = await runGraphRuntime.normalizeDirectory(req.query.directory);
    if (error) {
      res.status(status ?? 400).json({ error });
      return undefined;
    }
    try {
      const result = await runGraphRuntime.readAttribution(directory);
      if (result && result.error) {
        return res.status(500).json({
          error: `${result.error}`,
          code: 'ATTRIBUTION_STATE_UNAVAILABLE',
        });
      }
      if (result && result.absent === true) {
        return res.status(404).json({
          absent: true,
          error: `no attribution state for directory: ${directory}`,
          code: 'ATTRIBUTION_STATE_ABSENT',
        });
      }
      return res.json(result);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Failed to read attribution state';
      const code = Number(caught?.status);
      const httpStatus = Number.isInteger(code) && code >= 400 && code < 600 ? code : 500;
      return res.status(httpStatus).json({
        error: message || 'Failed to read attribution state',
        code: 'ATTRIBUTION_STATE_UNAVAILABLE',
      });
    }
  });
};
