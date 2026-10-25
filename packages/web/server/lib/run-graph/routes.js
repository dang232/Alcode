import { createRunGraphRuntime } from './runtime.js';

/**
 * Read-only run-graph route: one persisted engine snapshot per conversation.
 *
 * - `GET /api/run-graph/snapshot?directory=...&conversationId=...` serves
 *   `<directory>/.omo/dag-runs/<conversationId>.snapshot.json` as parsed
 *   JSON. The file is written by the engine-side snapshot writer; this route
 *   never writes.
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
};
