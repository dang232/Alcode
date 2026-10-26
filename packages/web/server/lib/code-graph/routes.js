/**
 * Alcode code-graph routes: a real engine index served per directory.
 *
 * Two reads, same scope resolution. The scope is the project directory, and
 * it is always explicit: a request without a directory fails loudly rather
 * than indexing the server's cwd, which would leak one project's symbols
 * into another project's panel.
 *
 * - `GET /api/code-graph/index?directory=...` — scope binding, freshness,
 *   and node/edge counts for the directory. The panel reads this first to
 *   render freshness (and its refresh action) before any symbol query.
 * - `GET /api/code-graph/query?directory=...&kind=...` — one engine query
 *   (`context`, `impact`, `search`, `tests`, `file`, `explore`, `trace`) with the freshness
 *   binding attached, so every row the panel shows carries the revision it
 *   was read at.
 * - `GET /api/code-graph/resolve?directory=...&file=...` — a snapshot file id
 *   (relative to the snapshot root, not the project root) resolved to a real
 *   path on disk. The panel must never join an id to the project directory
 *   itself: when the index's root sits below the project, that join addresses
 *   a file that does not exist and the editor reports it as missing.
 *
 * Failures are explicit. A backend failure answers 5xx with the error; it
 * never resolves to an empty index the panel could mistake for "no symbols
 * here". Query-shape mistakes (missing directory, unknown kind, missing
 * subject) answer 400 before the engine runs. A path refusal answers 403/404
 * with the boundary it hit, never a bare "not found".
 */

export const registerCodeGraphRoutes = (app, dependencies) => {
  const { codeGraphRuntime } = dependencies;

  const resolveDirectory = async (req, res) => {
    const { directory, error, status } = await codeGraphRuntime.normalizeDirectory(req.query.directory);
    if (error) {
      res.status(status ?? 400).json({ error });
      return null;
    }
    return directory;
  };

  const respondWithError = (res, error, fallbackMessage) => {
    const message = error instanceof Error ? error.message : fallbackMessage;
    const status = error instanceof Error && typeof error.status === 'number' ? error.status : 500;
    return res.status(status).json({ error: message || fallbackMessage });
  };

  app.get('/api/code-graph/index', async (req, res) => {
    const directory = await resolveDirectory(req, res);
    if (!directory) return undefined;
    try {
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      return res.json(await codeGraphRuntime.readIndex(directory, { refresh }));
    } catch (caught) {
      return respondWithError(res, caught, 'Failed to read code graph index');
    }
  });

  const RESOLVE_STATUS = {
    'missing-file-id': 400,
    'no-snapshot-root': 409,
    'outside-snapshot-root': 403,
    'outside-project': 403,
    missing: 404,
  };

  app.get('/api/code-graph/resolve', async (req, res) => {
    const directory = await resolveDirectory(req, res);
    if (!directory) return undefined;
    try {
      const result = await codeGraphRuntime.resolveFile(directory, req.query.file);
      const status = result.ok ? 200 : (RESOLVE_STATUS[result.reason] ?? 400);
      return res.status(status).json(result);
    } catch (caught) {
      return respondWithError(res, caught, 'Failed to resolve code graph file');
    }
  });

  app.get('/api/code-graph/query', async (req, res) => {
    const directory = await resolveDirectory(req, res);
    if (!directory) return undefined;
    try {
      const rawLimit = Number(req.query.limit);
      const result = await codeGraphRuntime.query(directory, {
        kind: req.query.kind,
        symbol: req.query.symbol,
        query: req.query.q,
        target: req.query.target,
        file: req.query.file,
        from: req.query.from,
        to: req.query.to,
        limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
        refresh: req.query.refresh === '1' || req.query.refresh === 'true',
      });
      if (result && typeof result.error === 'string') {
        return res.status(result.status ?? 400).json({ error: result.error });
      }
      return res.json(result);
    } catch (caught) {
      return respondWithError(res, caught, 'Failed to query code graph');
    }
  });
};
