import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { CodeGraphCanvas } from './CodeGraphCanvas';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import { graphFilePathForDisplay, resolveGraphFile } from '@/lib/graphFilePath';
import { cn } from '@/lib/utils';
import {
  fetchCodeGraphIndex,
  queryCodeGraph,
  resolveCodeGraphFile,
  type CodeGraphIndexSummary,
  type CodeGraphItem,
  type CodeGraphQueryResult,
} from '@/lib/codeGraphApi';
import {
  deriveImpactView,
  deriveTraceView,
  hasAmbiguousNames,
  modeForPickedId,
  resultsMatchQuery,
  type CodeGraphMode,
} from './codeGraphModes';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';

const WIDE_WORKSPACE_PX = 720;

/** The engine answers at most this many matches, so one request knows the real set. */
const SEARCH_FETCH_LIMIT = 50;
const SEARCH_PAGE_SIZE = 20;

/** Test files answer "where is it used" poorly: rank them behind real definitions. */
const isTestPath = (file: string): boolean => (
  /(^|\/)(__tests__|tests?)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
);

/**
 * The Code Graph workspace, docked as an editor tab.
 *
 * The panel owns every piece of graph state: each row comes from the server
 * route with its freshness binding attached, a directory switch reloads from
 * scratch, and a new search clears the previous subject before its answer can
 * land. Three regions (explorer, graph, inspector) become columns once the
 * panel is wide enough for them and stack in a narrow rail; a failed fetch is
 * an explicit error with a retry, never a fake empty list.
 */
export const CodeGraphPanel: React.FC<{ directory: string | null | undefined; focusFile?: string | null }> = ({
  directory,
  focusFile,
}) => {
  const { t } = useI18n();
  const [index, setIndex] = React.useState<CodeGraphIndexSummary | null>(null);
  const [indexError, setIndexError] = React.useState<string | null>(null);
  const [indexLoading, setIndexLoading] = React.useState(false);
  const [searchText, setSearchText] = React.useState('');
  const [search, setSearch] = React.useState<CodeGraphQueryResult | null>(null);
  const [showTestMatches, setShowTestMatches] = React.useState(false);
  const [matchWindow, setMatchWindow] = React.useState(SEARCH_PAGE_SIZE);
  const [moduleOpen, setModuleOpen] = React.useState<string | null>(null);
  const rankedMatches = React.useMemo(() => {
    const items = search?.items ?? [];
    const visible = showTestMatches ? items : items.filter((item) => !isTestPath(item.file));
    return [...visible].sort((left, right) => {
      const testRank = Number(isTestPath(left.file)) - Number(isTestPath(right.file));
      if (testRank !== 0) return testRank;
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return (left.name ?? left.id).localeCompare(right.name ?? right.id);
    });
  }, [search, showTestMatches]);
  const hiddenTestCount = (search?.items.length ?? 0) - rankedMatches.length;
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detailSubjectId, setDetailSubjectId] = React.useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = React.useState<{
    from: string; to: string; kind: string; confidence: number; sites: number;
  } | null>(null);
  const [committedQuery, setCommittedQuery] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<CodeGraphMode>('explore');
  const [explore, setExplore] = React.useState<CodeGraphQueryResult | null>(null);
  const [exploreLoading, setExploreLoading] = React.useState(false);
  const [exploreError, setExploreError] = React.useState<string | null>(null);
  const [trail, setTrail] = React.useState<CodeGraphQueryResult | null>(null);
  const [trailLoading, setTrailLoading] = React.useState(false);
  const [trailError, setTrailError] = React.useState<string | null>(null);
  const [peek, setPeek] = React.useState<{
    file: string; line: number; text: string | null; error: string | null; loading: boolean;
  } | null>(null);
  const [limit, setLimit] = React.useState(20);
  const [wide, setWide] = React.useState(false);
  // The inspector's own open state: `<details open>` is a controlled DOM property
  // in React, so binding it straight to the layout width reverted every user
  // toggle on the next render (the detail answer arriving right after a click).
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const [showSymbols, setShowSymbols] = React.useState(true);
  const [showFiles, setShowFiles] = React.useState(true);
  const [disabledEdgeKinds, setDisabledEdgeKinds] = React.useState<string[]>([]);
  const [inspectorWidth, setInspectorWidth] = React.useState(300);
  const [preview, setPreview] = React.useState<{
    id: string;
    detail: CodeGraphQueryResult | null;
    impact: CodeGraphQueryResult | null;
    file: CodeGraphQueryResult | null;
    tests: CodeGraphQueryResult | null;
  } | null>(null);
  const [detail, setDetail] = React.useState<CodeGraphQueryResult | null>(null);
  const [fileDetail, setFileDetail] = React.useState<CodeGraphQueryResult | null>(null);
  const [impactDetail, setImpactDetail] = React.useState<CodeGraphQueryResult | null>(null);
  const [testsDetail, setTestsDetail] = React.useState<CodeGraphQueryResult | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [sourceError, setSourceError] = React.useState<string | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const requestRef = React.useRef(0);
  const searchRef = React.useRef(0);
  const previewRef = React.useRef(0);
  const exploreRef = React.useRef(0);
  const trailRef = React.useRef(0);
  const peekRef = React.useRef(0);
  const pendingRef = React.useRef<AbortController | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inspectorDragRef = React.useRef<{ startX: number; base: number } | null>(null);
  const snapshotRoot = detail?.snapshotRoot ?? fileDetail?.snapshotRoot
    ?? search?.snapshotRoot ?? index?.snapshotRoot ?? null;

  const pathRoots = React.useMemo<PathRoots>(() => ({ snapshotRoot, projectRoot: directory ?? null }), [directory, snapshotRoot]);

  const displayPath = React.useCallback((file: string | null | undefined): string => (
    file ? graphFilePathForDisplay({ snapshotRoot, projectRoot: directory, file }) : ''
  ), [directory, snapshotRoot]);

  const trackPending = React.useCallback((controller: AbortController) => {
    pendingRef.current?.abort();
    pendingRef.current = controller;
    return controller.signal;
  }, []);

  const loadIndex = React.useCallback(async (refresh: boolean, signal: AbortSignal) => {
    if (!directory) return;
    setIndexLoading(true);
    setIndexError(null);
    try {
      const summary = await fetchCodeGraphIndex(directory, { refresh, signal });
      if (signal.aborted) return;
      setIndex(summary);
    } catch (error) {
      if (signal.aborted) return;
      setIndex(null);
      setIndexError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted) setIndexLoading(false);
    }
  }, [directory]);

  React.useEffect(() => {
    pendingRef.current?.abort();
    // Every flow that could still answer is invalidated here: an abort only
    // stops a request already in flight, while a generation bump also stops
    // the follow-up request (a preview, a detail, a trail) a resolved answer
    // would otherwise dispatch against the project we just left.
    searchRef.current += 1;
    requestRef.current += 1;
    previewRef.current += 1;
    exploreRef.current += 1;
    trailRef.current += 1;
    peekRef.current += 1;
    const controller = new AbortController();
    pendingRef.current = controller;
    setIndex(null);
    setIndexError(null);
    setSearch(null);
    setSearchError(null);
    setSelectedId(null);
    setDetailSubjectId(null);
    setPreview(null);
    setSelectedEdge(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setDetailError(null);
    setCommittedQuery(null);
    setMode('explore');
    setExplore(null);
    setExploreError(null);
    setTrail(null);
    setTrailError(null);
    setPeek(null);
    setSearchLoading(false);
    setDetailLoading(false);
    setIndexLoading(false);
    setLimit(20);
    setSearchText('');
    if (directory) {
      void loadIndex(false, controller.signal);
    }
    return () => {
      controller.abort();
      pendingRef.current = null;
    };
  }, [directory, loadIndex]);

  React.useEffect(() => {
    if (!directory || !focusFile) return undefined;
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setSelectedEdge(null);
    const subject = `file:${focusFile}`;
    setSelectedId(subject);
    setDetailSubjectId(subject);
    queryCodeGraph(directory, { kind: 'file', file: focusFile, limit: 20, refresh: false, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setFileDetail(result); })
      .catch((error) => { if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [directory, focusFile]);

  const fetchSubject = React.useCallback(async (
    item: Pick<CodeGraphItem, 'id' | 'file'>,
    refresh: boolean,
    signal: AbortSignal,
    queryLimit: number,
  ): Promise<{ detail: CodeGraphQueryResult | null; impact: CodeGraphQueryResult | null; file: CodeGraphQueryResult | null; tests: CodeGraphQueryResult | null }> => {
    if (!directory) return { detail: null, impact: null, file: null, tests: null };
    const fetchTests = async (): Promise<CodeGraphQueryResult | null> => {
      try {
        return await queryCodeGraph(directory, { kind: 'tests', target: item.id, limit: queryLimit, refresh, signal });
      } catch {
        return null;
      }
    };
    if (item.id.startsWith('file:')) {
      const fileResult = await queryCodeGraph(directory, {
        kind: 'file',
        file: item.file,
        limit: queryLimit,
        refresh,
        signal,
      });
      return { detail: null, impact: null, file: fileResult, tests: await fetchTests() };
    }
    const [contextResult, impactResult] = await Promise.all([
      queryCodeGraph(directory, { kind: 'context', symbol: item.id, limit: queryLimit, refresh, signal }),
      queryCodeGraph(directory, { kind: 'impact', symbol: item.id, limit: queryLimit, refresh, signal }),
    ]);
    return { detail: contextResult, impact: impactResult, file: null, tests: await fetchTests() };
  }, [directory]);

  const runSearch = React.useCallback(async (submitted: string, refresh: boolean, signal: AbortSignal, queryLimit: number) => {
    const needle = submitted.trim();
    if (!directory || !needle) return;
    const request = searchRef.current + 1;
    searchRef.current = request;
    setSearchLoading(true);
    setSearchError(null);
    setSearch(null);
    setCommittedQuery(needle);
    setSelectedId(null);
    setDetailSubjectId(null);
    setPreview(null);
    setSelectedEdge(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setDetailError(null);
    setTrail(null);
    try {
      const result = await queryCodeGraph(directory, { kind: 'search', query: needle, limit: Math.max(queryLimit, SEARCH_FETCH_LIMIT), refresh, signal });
      if (signal.aborted || searchRef.current !== request) return;
      setSearch(result);
      const first = result.items[0];
      if (first) {
        const previewRequest = previewRef.current + 1;
        previewRef.current = previewRequest;
        fetchSubject(first, refresh, signal, queryLimit).then(
          (found) => {
            if (signal.aborted || previewRef.current !== previewRequest || searchRef.current !== request) return;
            setPreview({ id: first.id, ...found });
          },
          () => {},
        );
      }
    } catch (error) {
      if (signal.aborted || searchRef.current !== request) return;
      setSearch(null);
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted && searchRef.current === request) setSearchLoading(false);
    }
  }, [directory, fetchSubject]);

  const selectItem = React.useCallback(async (item: CodeGraphItem, refresh: boolean, signal: AbortSignal, queryLimit: number) => {
    if (!directory) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    previewRef.current += 1;
    setSelectedId(item.id);
    setDetailSubjectId(item.id);
    setSelectedEdge(null);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setTrail(null);
    try {
      const found = await fetchSubject(item, refresh, signal, queryLimit);
      if (signal.aborted || requestRef.current !== request) return;
      setDetail(found.detail);
      setImpactDetail(found.impact);
      setFileDetail(found.file);
      setTestsDetail(found.tests);
      setPreview(null);
    } catch (error) {
      if (signal.aborted || requestRef.current !== request) return;
      setDetailError(error instanceof Error ? error.message : String(error));
      setPreview(null);
    } finally {
      if (!signal.aborted && requestRef.current === request) setDetailLoading(false);
    }
  }, [directory, fetchSubject]);

  const loadExplore = React.useCallback(async (refresh: boolean, signal: AbortSignal, queryLimit: number) => {
    if (!directory) return;
    const request = exploreRef.current + 1;
    exploreRef.current = request;
    setExploreLoading(true);
    setExploreError(null);
    try {
      const result = await queryCodeGraph(directory, { kind: 'explore', limit: queryLimit, refresh, signal });
      if (signal.aborted || exploreRef.current !== request) return;
      setExplore(result);
    } catch (error) {
      if (signal.aborted || exploreRef.current !== request) return;
      setExplore(null);
      setExploreError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!signal.aborted && exploreRef.current === request) setExploreLoading(false);
    }
  }, [directory]);

  React.useEffect(() => {
    if (mode !== 'explore' || !directory) return undefined;
    const controller = new AbortController();
    void loadExplore(false, controller.signal, limit);
    return () => controller.abort();
  }, [mode, directory, limit, loadExplore]);

  const handleTraceTo = React.useCallback(async (target: string) => {
    if (!directory || selectedId === null) return;
    const request = trailRef.current + 1;
    trailRef.current = request;
    const controller = new AbortController();
    trackPending(controller);
    setTrailLoading(true);
    setTrailError(null);
    setTrail(null);
    try {
      const result = await queryCodeGraph(directory, {
        kind: 'trace',
        from: selectedId,
        to: target,
        limit,
        refresh: false,
        signal: controller.signal,
      });
      if (controller.signal.aborted || trailRef.current !== request) return;
      setTrail(result);
    } catch (error) {
      if (controller.signal.aborted || trailRef.current !== request) return;
      setTrail(null);
      setTrailError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted && trailRef.current === request) setTrailLoading(false);
    }
  }, [directory, limit, selectedId, trackPending]);

  const handlePeek = React.useCallback(async (file: string, line: number) => {
    const request = peekRef.current + 1;
    peekRef.current = request;
    if (!directory) {
      setPeek({ file, line, text: null, error: 'Code graph needs a project directory', loading: false });
      return;
    }
    setPeek({ file, line, text: null, error: null, loading: true });
    const resolvedFile = resolveGraphFile({ snapshotRoot, projectRoot: directory, file });
    if (!resolvedFile.ok) {
      setPeek({ file, line, text: null, error: `${resolvedFile.reason}: ${file}`, loading: false });
      return;
    }
    const absolute = resolvedFile.path;
    let firstError: string | null = null;
    try {
      const params = new URLSearchParams({ path: absolute, directory, optional: 'true' });
      const response = await runtimeFetch(`/api/fs/read?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        firstError = `Failed to read ${file} (${response.status})`;
        throw new Error(firstError);
      }
      const text = await response.text();
      if (peekRef.current !== request) return;
      setPeek({ file, line, text, error: null, loading: false });
      return;
    } catch (error) {
      if (firstError === null) firstError = error instanceof Error ? error.message : String(error);
    }
    // Some runtimes expose no HTTP fs routes: fall back to the registered
    // files API, exactly as detectDevServer does. A failed read stays failed.
    const runtimeFiles = getRegisteredRuntimeAPIs()?.files;
    if (runtimeFiles?.readFile) {
      try {
        const result = await runtimeFiles.readFile(absolute, { optional: true });
        if (peekRef.current !== request) return;
        if (typeof result?.content === 'string') {
          setPeek({ file, line, text: result.content, error: null, loading: false });
          return;
        }
      } catch {
        // Fall through to the recorded error.
      }
    }
    if (peekRef.current !== request) return;
    setPeek({ file, line, text: null, error: firstError, loading: false });
  }, [directory, snapshotRoot]);

  const onSubmit = React.useCallback((event: React.FormEvent) => {
    event.preventDefault();
    void runSearch(searchText, false, trackPending(new AbortController()), limit);
  }, [limit, runSearch, searchText, trackPending]);

  const retrySearch = React.useCallback(() => {
    void runSearch(searchText, false, trackPending(new AbortController()), limit);
  }, [limit, runSearch, searchText, trackPending]);

  const handleSearchTextChange = React.useCallback((value: string) => {
    setSearchText(value);
    if (value.trim().length > 0) return;
    // Emptying the box is the one keystroke that clears the answer: the old
    // results, selection, preview and details cannot be re-submitted away
    // because submit is disabled on empty text.
    setSearch(null);
    setSearchError(null);
    setCommittedQuery(null);
    setSelectedId(null);
    setDetailSubjectId(null);
    setPreview(null);
    setSelectedEdge(null);
    setDetail(null);
    setFileDetail(null);
    setImpactDetail(null);
    setTestsDetail(null);
    setDetailError(null);
    setTrail(null);
  }, []);

  const handleModeChange = React.useCallback((next: CodeGraphMode) => {
    setMode(next);
  }, []);

  const onRefresh = React.useCallback(() => {
    const controller = new AbortController();
    trackPending(controller);
    void loadIndex(true, controller.signal).then(() => {
      if (searchText.trim()) {
        void runSearch(searchText, true, controller.signal, limit);
      }
      if (mode === 'explore') {
        void loadExplore(true, controller.signal, limit);
      }
    });
  }, [limit, loadExplore, loadIndex, mode, runSearch, searchText, trackPending]);

  const previewGraph = preview?.detail?.graph ?? preview?.file?.graph ?? null;
  const selectedGraph = detail?.graph ?? fileDetail?.graph ?? null;
  const activeGraph = selectedGraph ?? previewGraph;
  const showingPreview = selectedGraph === null && activeGraph !== null;
  const subjectAnswered = selectedId !== null && !detailLoading && !detailError && (detail !== null || fileDetail !== null);
  const subjectIndexed = (detail !== null && detail.coverage !== 'unindexed')
    || (fileDetail !== null && fileDetail.coverage !== 'unindexed');
  const inspectorNode = activeGraph && selectedId !== null
    ? activeGraph.nodes.find((node) => node.id === selectedId) ?? activeGraph.nodes.find((node) => node.subject) ?? null
    : activeGraph?.nodes.find((node) => node.subject) ?? null;
  const inspectorEdges = inspectorNode && activeGraph
    ? activeGraph.edges.filter((edge) => edge.from === inspectorNode.id || edge.to === inspectorNode.id)
    : [];
  const inspectorInbound = inspectorNode ? inspectorEdges.filter((edge) => edge.to === inspectorNode.id).length : 0;
  const inspectorOutbound = inspectorNode ? inspectorEdges.filter((edge) => edge.from === inspectorNode.id).length : 0;
  const inspectorConfidence = inspectorEdges.length > 0
    ? Math.max(...inspectorEdges.map((edge) => edge.confidence)).toFixed(2)
    : null;
  const inspectorImpact = impactDetail && detailSubjectId !== null && detailSubjectId === selectedId && impactDetail.impacted
    ? impactDetail.impacted.length
    : null;

  const selectGraphNode = React.useCallback((id: string) => {
    if (id === selectedId) return;
    const node = activeGraph?.nodes.find((entry) => entry.id === id);
    void selectItem(
      {
        id,
        file: node?.file ?? '',
        line: node?.line ?? 0,
        evidence: [],
        confidence: 1,
        knowledgeIds: [],
      },
      false,
      trackPending(new AbortController()),
      limit,
    );
  }, [activeGraph, limit, selectedId, selectItem, trackPending]);

  const onLimitChange = React.useCallback((next: number) => {
    setLimit(next);
    const signal = trackPending(new AbortController());
    const current = selectedId !== null
      ? search?.items.find((entry) => entry.id === selectedId)
        ?? activeGraph?.nodes.find((entry) => entry.id === selectedId)
      : undefined;
    if (selectedId !== null && current) {
      const item: CodeGraphItem = 'evidence' in current
        ? current
        : {
          id: current.id,
          file: current.file ?? '',
          line: current.line ?? 0,
          evidence: [],
          confidence: 1,
          knowledgeIds: [],
        };
      void selectItem(item, false, signal, next);
    } else if (selectedId === null && searchText.trim()) {
      void runSearch(searchText, false, signal, next);
    }
  }, [activeGraph, runSearch, search, searchText, selectItem, selectedId, trackPending]);

  const committedRevision = search?.revision ?? null;
  const revisionMismatch = committedRevision !== null && index !== null && committedRevision !== index.revision;
  const effectiveFreshness = revisionMismatch ? 'stale' : index?.freshness;
  const showStaleBanner = index !== null && (index.freshness === 'stale' || revisionMismatch);
  const resultsStale = !resultsMatchQuery(committedQuery, searchText);

  const testFiles = React.useMemo(() => {
    const files: string[] = [];
    for (const item of testsDetail?.items ?? []) {
      if (!files.includes(item.file)) files.push(item.file);
    }
    return files;
  }, [testsDetail]);

  const sourceFile = inspectorNode?.file ?? detail?.definition?.file ?? fileDetail?.items[0]?.file ?? null;
  const sourceLine = inspectorNode?.line ?? detail?.definition?.line ?? fileDetail?.items[0]?.line ?? 1;
  const openSourceAt = React.useCallback((file: string, line: number) => {
    if (!directory) return;
    const resolved = resolveGraphFile({ snapshotRoot, projectRoot: directory, file });
    if (!resolved.ok) {
      // A refusal is stated, never papered over by opening a lookalike file.
      setSourceError(`${resolved.reason}: ${file}`);
      return;
    }
    setSourceError(null);
    useUIStore.getState().openContextFileAtLine(directory, resolved.path, line);
    // The join above is correct by construction; this probe adds what it cannot
    // know — whether the file still exists at that path, and whether the index
    // is stale — so a vanished file reads as such instead of as a broken graph.
    void (async () => {
      try {
        const answer = await resolveCodeGraphFile(directory, file);
        if (!answer.ok && typeof answer.reason === 'string' && answer.reason.length > 0) {
          setSourceError(`${answer.reason}: ${file}`);
        }
      } catch {
        // The probe is advisory: the editor has already been asked to open.
      }
    })();
  }, [directory, snapshotRoot]);
  const openSource = React.useCallback(() => {
    if (!sourceFile) return;
    openSourceAt(sourceFile, sourceLine);
  }, [openSourceAt, sourceFile, sourceLine]);

  const edgeKinds = React.useMemo(() => {
    const kinds: string[] = [];
    for (const edge of activeGraph?.edges ?? []) {
      if (!kinds.includes(edge.kind)) kinds.push(edge.kind);
    }
    return kinds;
  }, [activeGraph]);
  const enabledEdgeKinds = React.useMemo(
    () => new Set(edgeKinds.filter((kind) => !disabledEdgeKinds.includes(kind))),
    [edgeKinds, disabledEdgeKinds],
  );
  const filteredGraph = React.useMemo(() => {
    if (!activeGraph) return null;
    const kept = new Set<string>();
    for (const node of activeGraph.nodes) {
      if (node.id === activeGraph.subjectId) kept.add(node.id);
      else if (node.kind === 'file' ? showFiles : showSymbols) kept.add(node.id);
    }
    return {
      ...activeGraph,
      nodes: activeGraph.nodes.filter((node) => kept.has(node.id)),
      edges: activeGraph.edges.filter(
        (edge) => enabledEdgeKinds.has(edge.kind) && kept.has(edge.from) && kept.has(edge.to),
      ),
    };
  }, [activeGraph, showSymbols, showFiles, enabledEdgeKinds]);
  const toggleEdgeKind = React.useCallback((kind: string) => {
    setDisabledEdgeKinds((current) => (
      current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]
    ));
  }, []);
  const resetFilters = React.useCallback(() => {
    setShowSymbols(true);
    setShowFiles(true);
    setDisabledEdgeKinds([]);
  }, []);

  const traceView = React.useMemo(
    () => deriveTraceView({ detail: detail ?? fileDetail, tests: testsDetail }),
    [detail, fileDetail, testsDetail],
  );
  const impactView = React.useMemo(
    () => deriveImpactView({ impact: impactDetail, tests: testsDetail }),
    [impactDetail, testsDetail],
  );
  const hasSubject = selectedId !== null || detail !== null || fileDetail !== null || inspectorNode !== null;
  // A preview has a graph but no selection: the inspector opens for a real
  // selection only, so a new search never leaves the previous subject's
  // inspector (or its "Selected node" heading) on screen.
  const showsInspector = selectedId !== null || detail !== null || fileDetail !== null;

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;    const measure = (width: number) => setWide(width >= WIDE_WORKSPACE_PX);
    measure(root.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The layout decides the default, the user decides the rest.
  React.useEffect(() => {
    setInspectorOpen(wide);
  }, [wide]);

  const restoredKeyRef = React.useRef<string | null>(null);
  const pendingRestoreRef = React.useRef<string | null>(null);
  const hydratedRef = React.useRef(false);

  // The tab restores what it was showing for this project. An id the snapshot no
  // longer contains is dropped rather than pointed at a stranger with the same name.
  React.useEffect(() => {
    const key = String(directory ?? '').trim();
    // Restore only once the snapshot binding is known: the saved id has to be
    // checked against this snapshot, not against a guess.
    if (!key || !index || restoredKeyRef.current === key) return;
    restoredKeyRef.current = key;
    const saved = useUIStore.getState().codeGraphStateByDirectory[key];
    if (!saved) {
      hydratedRef.current = true;
      return;
    }
    setMode(saved.mode as CodeGraphMode);
    pendingRestoreRef.current = saved.selectedId;
    if (saved.query) {
      setSearchText(saved.query);
      void runSearch(saved.query, false, trackPending(new AbortController()), limit);
    }
    hydratedRef.current = true;
  }, [directory, index, limit, runSearch, trackPending]);

  React.useEffect(() => {
    const target = pendingRestoreRef.current;
    if (!target || !search) return;
    pendingRestoreRef.current = null;
    const found = search.items.find((item) => item.id === target);
    if (!found) return;
    setMode(modeForPickedId(found.id));
    void selectItem(found, false, trackPending(new AbortController()), limit);
  }, [search, limit, selectItem, trackPending]);

  React.useEffect(() => {
    const key = String(directory ?? '').trim();
    if (!key || !hydratedRef.current) return;
    useUIStore.getState().setCodeGraphState(key, { mode, query: committedQuery, selectedId });
  }, [directory, mode, committedQuery, selectedId]);

  const gridStyle = wide
    ? {
      gridTemplateColumns: showsInspector
        ? `minmax(200px, 250px) minmax(0, 1fr) ${inspectorWidth}px`
        : 'minmax(200px, 250px) minmax(0, 1fr)',
    }
    : undefined;

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
      data-testid="code-graph-workspace"
      data-layout={wide ? 'wide' : 'stacked'}
    >
      <div className="flex items-center gap-2">
        <Icon name="flow-chart" className="size-4 shrink-0" />
        <h2 className="typography-ui-header flex-1 text-foreground">{t('codeGraph.rail.label')}</h2>
        {indexLoading ? <Spinner aria-hidden /> : null}
        <Button variant="outline" size="sm" type="button" onClick={onRefresh} disabled={indexLoading || !directory}>
          {t('codeGraph.refresh')}
        </Button>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label={t('codeGraph.mode.label')}>
        <span className="typography-micro text-muted-foreground">{t('codeGraph.mode.label')}</span>
        {(['explore', 'trace', 'impact'] as const).map((entry) => (
          <Button
            key={entry}
            variant="chip"
            size="xs"
            type="button"
            aria-pressed={mode === entry}
            data-testid={`code-graph-mode-${entry}`}
            onClick={() => handleModeChange(entry)}
          >
            {t(entry === 'explore' ? 'codeGraph.mode.explore' : entry === 'trace' ? 'codeGraph.mode.trace' : 'codeGraph.mode.impact')}
          </Button>
        ))}
      </div>

      {indexError ? (
        <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
          <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
          <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{indexError}</p>
          <Button variant="outline" size="sm" type="button" className="mt-2" onClick={onRefresh}>
            {t('codeGraph.retry')}
          </Button>
        </div>
      ) : null}

      {showStaleBanner && index ? (
        <div className="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] p-3">
          <p className="typography-ui text-[var(--status-warning)]">
            {t('codeGraph.freshness.stale')}
            {index.staleReason ? ` · ${index.staleReason}` : ''}
            {revisionMismatch && committedRevision ? ` · ${committedRevision.slice(0, 8)}` : ''}
          </p>
          {index.refreshError ? (
            <p className="typography-micro mt-1 break-words text-[var(--status-warning)]">{index.refreshError}</p>
          ) : null}
          <Button variant="outline" size="sm" type="button" className="mt-2" onClick={onRefresh}>
            {t('codeGraph.refresh')}
          </Button>
        </div>
      ) : null}

      {index ? (
        <p className="typography-micro text-muted-foreground">
          <span className={cn(
            'me-2 inline-block rounded px-1.5 py-0.5',
            effectiveFreshness === 'fresh'
              ? 'bg-[var(--status-success-background)] text-[var(--status-success)]'
              : 'bg-[var(--status-warning-background)] text-[var(--status-warning)]',
          )}>
            {effectiveFreshness === 'fresh' ? t('codeGraph.freshness.fresh') : t('codeGraph.freshness.stale')}
          </span>
          {index.nodeCount} / {index.edgeCount} · {index.revision.slice(0, 8)}
        </p>
      ) : null}

      <div
        data-testid="code-graph-regions"
        data-regions={wide ? 'three' : 'stacked'}
        className={wide ? 'grid min-h-0 flex-1 gap-3' : 'flex shrink-0 flex-col gap-3'}
        style={gridStyle}
      >
        <aside
          aria-label={t('codeGraph.section.matches')}
          className="flex min-h-0 min-w-0 shrink-0 flex-col gap-2"
          data-region="explorer"
        >
          <form onSubmit={onSubmit} className="flex gap-2">
            <Input
              inputSize="compact"
              value={searchText}
              onChange={(event) => handleSearchTextChange(event.target.value)}
              placeholder={t('codeGraph.search.placeholder')}
              aria-label={t('codeGraph.search.label')}
              disabled={!directory || indexLoading}
              className="min-w-0 flex-1"
            />
            <Button variant="default" size="sm" type="submit" disabled={!directory || !searchText.trim() || searchLoading}>
              {searchLoading ? <Spinner aria-hidden /> : <Icon name="search" className="size-4" />}
            </Button>
          </form>

          {searchLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner aria-hidden />
            </div>
          ) : null}

          {searchError ? (
            <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
              <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
              <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{searchError}</p>
              <Button variant="outline" size="sm" type="button" className="mt-2" onClick={retrySearch}>
                {t('codeGraph.retry')}
              </Button>
            </div>
          ) : null}

          {search && !searchError ? <SearchState result={search} /> : null}

          <fieldset className="flex flex-col gap-1">
            <legend className="typography-ui-header text-foreground">{t('codeGraph.explorer.kinds')}</legend>
            <label className="typography-ui flex items-center gap-2">
              <input
                type="checkbox"
                className="code-graph-kind-symbols"
                checked={showSymbols}
                onChange={(event) => setShowSymbols(event.target.checked)}
              />
              {t('codeGraph.explorer.symbols')}
            </label>
            <label className="typography-ui flex items-center gap-2">
              <input
                type="checkbox"
                className="code-graph-kind-files"
                checked={showFiles}
                onChange={(event) => setShowFiles(event.target.checked)}
              />
              {t('codeGraph.explorer.files')}
            </label>
          </fieldset>

          <section aria-label={t('codeGraph.explorer.edges')} className="flex min-w-0 flex-col gap-1">
            <h3 className="typography-ui-header text-foreground">{t('codeGraph.explorer.edges')}</h3>
            <div className="flex flex-wrap gap-1">
              {edgeKinds.map((kind) => (
                <Button
                  key={kind}
                  variant="chip"
                  size="xs"
                  type="button"
                  aria-pressed={enabledEdgeKinds.has(kind)}
                  onClick={() => toggleEdgeKind(kind)}
                >
                  {kind}
                </Button>
              ))}
            </div>
            <Button variant="outline" size="sm" type="button" onClick={resetFilters}>
              {t('codeGraph.explorer.reset')}
            </Button>
          </section>

          <label className="typography-ui flex items-center gap-2">
            {t('codeGraph.explorer.limit')}
            <select
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="rounded-md border border-border bg-background px-1.5 py-1"
            >
              <option value={20}>20</option>
              <option value={40}>40</option>
            </select>
          </label>

          {mode === 'explore' ? (
            <section aria-label={t('codeGraph.explore.title')} className="flex flex-col gap-1">
              <SectionTitle>{t('codeGraph.explore.title')}</SectionTitle>
              <p className="typography-micro text-muted-foreground">{t('codeGraph.explore.hint')}</p>
              {exploreLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden />
                </div>
              ) : null}
              {exploreError ? (
                <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
                  <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
                  <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{exploreError}</p>
                </div>
              ) : null}
              {!exploreLoading && exploreError === null && explore ? (
                explore.modules && explore.modules.length > 0 ? (
                  <div className="flex flex-col gap-1" data-testid="code-graph-explore-modules">
                    {explore.modules.map((module) => (
                      <div key={module.name} className="flex flex-col gap-1 rounded-md border border-border p-2">
                        <button
                          type="button"
                          aria-expanded={moduleOpen === module.name}
                          data-testid={`code-graph-module-${module.name}`}
                          className="flex w-full flex-col items-stretch gap-0.5 text-start"
                          onClick={() => setModuleOpen((current) => (current === module.name ? null : module.name))}
                        >
                          <span className="typography-ui break-words text-foreground">{module.name}</span>
                          <span className="typography-micro text-muted-foreground">
                            {`${module.fileCount} ${t('codeGraph.explore.files')} · ${module.symbolCount} ${t('codeGraph.explore.symbols')}`}
                          </span>
                        </button>
                        {moduleOpen === module.name ? (
                          module.sampleSymbols && module.sampleSymbols.length > 0 ? (
                            <ul className="mt-1 flex flex-col gap-0.5" data-testid={`code-graph-module-samples-${module.name}`}>
                              {module.sampleSymbols.map((sample) => (
                                <li key={sample.id}>
                                  <button
                                    type="button"
                                    className="typography-micro w-full break-words text-start text-muted-foreground hover:underline"
                                    onClick={() => {
                                      void selectItem(
                                        { id: sample.id, file: sample.file, line: sample.line ?? 1, name: sample.name, evidence: [], confidence: 1, knowledgeIds: [] },
                                        false,
                                        trackPending(new AbortController()),
                                        limit,
                                      );
                                    }}
                                  >
                                    {`${displayPath(sample.file)}:${sample.line}`}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="typography-micro text-muted-foreground">{t('codeGraph.explore.empty')}</p>
                          )
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="typography-micro text-muted-foreground">{t('codeGraph.explore.empty')}</p>
                )
              ) : null}
            </section>
          ) : null}

          {search && search.items.length > 0 ? (
            <section className="rounded-md border border-border p-2" aria-label={t('codeGraph.section.matches')}>
              <p className="typography-ui font-medium" data-testid="code-graph-matches-heading">
                {t('codeGraph.section.matches')}
                {committedQuery !== null && committedQuery !== '' ? ` · "${committedQuery}"` : ''}
                {` (${rankedMatches.length})`}
                {resultsStale ? ` · ${t('codeGraph.results.stale')}` : ''}
              </p>
              {hasAmbiguousNames(search.items) ? (
                <p className="code-graph-ambiguous typography-micro mt-1 text-muted-foreground">
                  {t('codeGraph.results.ambiguous')}
                </p>
              ) : null}
              <label className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showTestMatches}
                  onChange={(event) => setShowTestMatches(event.target.checked)}
                  data-testid="code-graph-show-tests"
                />
                <span className="typography-micro">
                  {t('codeGraph.explorer.tests')}
                  {hiddenTestCount > 0 ? ` (${hiddenTestCount})` : ''}
                </span>
              </label>
              <ul className="mt-1 flex flex-col gap-1">
                {rankedMatches.slice(0, matchWindow).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setMode(modeForPickedId(item.id));
                        void selectItem(item, false, trackPending(new AbortController()), limit);
                      }}
                      aria-pressed={selectedId === item.id}
                      className={cn(
                        'flex w-full flex-col items-stretch gap-0.5 rounded-md px-2 py-1.5 text-start',
                        selectedId === item.id ? 'bg-interactive-selection text-interactive-selection-foreground' : 'hover:bg-interactive-hover',
                      )}
                    >
                      <span className="typography-ui w-full truncate text-start">{item.name ?? item.id}</span>
                      <span className="typography-micro w-full truncate text-start text-muted-foreground">
                        {`${displayPath(item.file)}:${item.line}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {rankedMatches.length > matchWindow ? (
                <div className="mt-1 flex items-center justify-between gap-2" data-testid="code-graph-matches-more">
                  <span className="typography-micro text-muted-foreground" data-testid="code-graph-matches-count">{`${matchWindow} / ${rankedMatches.length}${search?.truncated ? '+' : ''}`}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => setMatchWindow((current) => current + SEARCH_PAGE_SIZE)}
                  >
                    {t('codeGraph.results.loadMore')}
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>

        <section
          aria-label={t('codeGraph.section.graph')}
          className="flex min-h-0 min-w-0 flex-col gap-2"
          data-region="graph"
        >
          <SectionTitle>{t('codeGraph.section.graph')}</SectionTitle>
          {filteredGraph ? (
            <div className={wide ? 'flex min-h-[360px] flex-1 flex-col' : 'flex h-[320px] shrink-0 flex-col'}>
              <CodeGraphCanvas
                graph={filteredGraph}
                selectedId={selectedId}
                onSelect={selectGraphNode}
                selectedEdge={selectedEdge}
                onSelectEdge={setSelectedEdge}
                preview={showingPreview}
                previewLabel={t('codeGraph.graph.preview')}
                truncatedLabel={t('codeGraph.graph.truncated')}
                edgesLabel={t('codeGraph.graph.edges')}
              />
            </div>
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-md border border-[var(--surface-border)] p-3">
              {(detailLoading || searchLoading) ? (
                <Spinner aria-hidden />
              ) : subjectAnswered && subjectIndexed ? (
                <p className="typography-micro text-center text-muted-foreground">{t('codeGraph.graph.empty')}</p>
              ) : search && search.items.length > 0 ? (
                <p className="typography-micro text-center text-muted-foreground">{t('codeGraph.graph.selectPrompt')}</p>
              ) : (
                <p className="typography-micro text-center text-muted-foreground">{t('codeGraph.graph.idle')}</p>
              )}
            </div>
          )}

          {mode === 'trace' && hasSubject ? (
            <section aria-label={t('codeGraph.mode.trace')} className="flex flex-col gap-1">
              <h3 className="typography-ui-header text-foreground">{t('codeGraph.trace.incoming')}</h3>
              {traceView.incoming.length === 0 ? (
                <p className="typography-micro text-muted-foreground">{t('codeGraph.trace.none')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5" data-testid="code-graph-trace-incoming">
                  {traceView.incoming.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-1">
                      <button
                        type="button"
                        onClick={() => { void handleTraceTo(entry.id); }}
                        className="typography-micro min-w-0 flex-1 break-words text-start text-muted-foreground hover:underline"
                        data-testid={`code-graph-trace-to-${entry.id}`}
                      >
                        {`${entry.id} · ${displayPath(entry.file)}:${entry.line}`}
                      </button>
                      <button
                        type="button"
                        data-testid={`code-graph-open-row-${entry.id}`}
                        onClick={() => openSourceAt(entry.file, entry.line)}
                        className="typography-micro shrink-0 text-[var(--text-tertiary)] hover:underline"
                      >
                        {t('codeGraph.peek.read')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="typography-ui-header text-foreground">{t('codeGraph.trace.outgoing')}</h3>
              {traceView.outgoing.length === 0 ? (
                <p className="typography-micro text-muted-foreground">{t('codeGraph.trace.none')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5" data-testid="code-graph-trace-outgoing">
                  {traceView.outgoing.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-1">
                      <button
                        type="button"
                        onClick={() => { void handleTraceTo(entry.id); }}
                        className="typography-micro min-w-0 flex-1 break-words text-start text-muted-foreground hover:underline"
                      >
                        {`${entry.id} · ${displayPath(entry.file)}:${entry.line}`}
                      </button>
                      <button
                        type="button"
                        data-testid={`code-graph-open-row-${entry.id}`}
                        onClick={() => openSourceAt(entry.file, entry.line)}
                        className="typography-micro shrink-0 text-[var(--text-tertiary)] hover:underline"
                      >
                        {t('codeGraph.peek.read')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {traceView.notes.map((note) => (
                <p key={note} className="typography-micro break-words text-muted-foreground">{note}</p>
              ))}
            </section>
          ) : null}

          {mode === 'impact' && hasSubject ? (
            <section aria-label={t('codeGraph.mode.impact')} className="flex flex-col gap-1">
              <h3 className="typography-ui-header text-foreground">{t('codeGraph.impact.confirmed')}</h3>
              {impactView.confirmed.length === 0 ? (
                <p className="typography-micro text-muted-foreground">{t('codeGraph.impact.none')}</p>
              ) : (
                <ul className="flex flex-col gap-0.5" data-testid="code-graph-impact-confirmed">
                  {impactView.confirmed.map((entry) => (
                    <li key={entry.id} className="typography-micro break-words text-muted-foreground">
                      {`${entry.id} · ${displayPath(entry.file)}:${entry.line}`}
                    </li>
                  ))}
                </ul>
              )}
              {impactView.inferred.length > 0 ? (
                <React.Fragment>
                  <h3 className="typography-ui-header text-foreground">{t('codeGraph.impact.inferred')}</h3>
                  <ul className="flex flex-col gap-0.5" data-testid="code-graph-impact-inferred">
                    {impactView.inferred.map((entry) => (
                      <li key={entry.id} className="typography-micro break-words text-muted-foreground">
                        {`${entry.id} · ${displayPath(entry.file)}:${entry.line}`}
                      </li>
                    ))}
                  </ul>
                </React.Fragment>
              ) : null}
              {impactView.notes.map((note) => (
                <p key={note} className="typography-micro break-words text-muted-foreground">{note}</p>
              ))}
            </section>
          ) : null}

          {trail !== null || trailLoading || trailError !== null ? (
            <section aria-label={t('codeGraph.trace.path')} className="flex flex-col gap-1">
              <SectionTitle>{t('codeGraph.trace.path')}</SectionTitle>
              {trailLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden />
                </div>
              ) : null}
              {trailError ? (
                <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
                  <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
                  <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{trailError}</p>
                </div>
              ) : null}
              {trail?.path && trail.path.length > 0 ? (
                <div className="flex flex-col gap-0.5" data-testid="code-graph-trail-steps">
                  {trail.path.map((step, stepIndex) => (
                    <p key={`${step.from}-${step.to}-${stepIndex}`} className="typography-micro break-words text-muted-foreground">
                      {`${step.from} → ${step.to} · ${step.ref} · ${step.confidence.toFixed(2)}`}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {peek !== null ? (
            <section aria-label={t('codeGraph.section.file')} className="flex flex-col gap-1">
              <SectionTitle>{`${displayPath(peek.file)}:${peek.line}`}</SectionTitle>
              {peek.loading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner aria-hidden />
                </div>
              ) : peek.error ? (
                <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
                  <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
                  <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{peek.error}</p>
                </div>
              ) : (
                <pre className="typography-micro max-h-64 overflow-auto rounded-md border border-border p-2 text-foreground" data-testid="code-graph-peek-text">{peek.text ?? ''}</pre>
              )}
            </section>
          ) : null}

          <div className="flex flex-col gap-1">
            {detail ? <SymbolDetail context={detail} impact={impactDetail} roots={pathRoots} /> : null}
            {fileDetail ? <FileDetail result={fileDetail} roots={pathRoots} /> : null}
          </div>

          {detailLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner aria-hidden />
            </div>
          ) : null}

          {detailError ? (
            <div className="rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-background)] p-3">
              <p className="typography-ui text-[var(--status-error)]">{t('codeGraph.state.error')}</p>
              <p className="typography-micro mt-1 break-words text-[var(--status-error)]">{detailError}</p>
            </div>
          ) : null}
        </section>

        {showsInspector ? (
          <aside
            aria-label={t('codeGraph.inspector.title')}
            className="relative flex min-w-0 flex-col gap-1"
            data-region="inspector"
          >
            {wide ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('codeGraph.inspector.title')}
                className="absolute -start-2 top-0 h-full w-1.5 cursor-col-resize rounded bg-transparent hover:bg-[var(--surface-border)]"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  inspectorDragRef.current = { startX: event.clientX, base: inspectorWidth };
                }}
                onPointerMove={(event) => {
                  const drag = inspectorDragRef.current;
                  if (!drag) return;
                  const next = drag.base - (event.clientX - drag.startX);
                  setInspectorWidth(Math.min(520, Math.max(220, next)));
                }}
                onPointerUp={() => { inspectorDragRef.current = null; }}
                onPointerCancel={() => { inspectorDragRef.current = null; }}
              />
            ) : null}
            <details
              open={inspectorOpen}
              onToggle={(event) => setInspectorOpen(event.currentTarget.open)}
              className="rounded-md border border-border p-2"
            >
              <summary className="typography-ui cursor-pointer font-medium" data-testid="code-graph-inspector-toggle">{t('codeGraph.inspector.title')}</summary>
              {inspectorNode ? (
                <dl className="mt-1 flex flex-col gap-0.5">
                  <div className="flex gap-2">
                    <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.symbol')}</dt>
                    <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">{inspectorNode.id}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.path')}</dt>
                    <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">
                      {inspectorNode.file ? `${displayPath(inspectorNode.file)}:${inspectorNode.line ?? ''}` : '—'}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.confidence')}</dt>
                    <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">{inspectorConfidence ?? '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.impact')}</dt>
                    <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">{inspectorImpact ?? '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.inspector.relations')}</dt>
                    <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">
                      {`${inspectorInbound} in · ${inspectorOutbound} out`}
                    </dd>
                  </div>
                  {selectedEdge ? (
                    <div className="flex gap-2">
                      <dt className="typography-micro shrink-0 text-muted-foreground">{t('codeGraph.graph.edges')}</dt>
                      <dd className="typography-micro min-w-0 flex-1 break-words text-foreground">
                        {`${selectedEdge.kind} ${selectedEdge.from} → ${selectedEdge.to} · ${selectedEdge.confidence.toFixed(2)} (${selectedEdge.sites})`}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {sourceError ? (
                <p className="typography-micro break-words text-[var(--status-warning)]" data-testid="code-graph-source-error">{sourceError}</p>
              ) : null}
              {sourceFile !== null ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    data-testid="code-graph-open-source"
                    className="h-auto max-w-full whitespace-normal text-start"
                    onClick={openSource}
                    disabled={!directory}
                  >
                    {`${t('codeGraph.peek.read')} · ${displayPath(sourceFile)}:${sourceLine}`}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    data-testid="code-graph-peek-file"
                    className="h-auto max-w-full whitespace-normal text-start"
                    aria-label={t('codeGraph.section.file')}
                    onClick={() => { if (sourceFile) void handlePeek(sourceFile, sourceLine); }}
                  >
                    {`${t('codeGraph.section.file')} · ${displayPath(sourceFile)}:${sourceLine}`}
                  </Button>
                </div>
              ) : null}
              {selectedId !== null && detail ? (
                <section aria-label={t('codeGraph.inspector.evidence')} className="mt-2 flex flex-col gap-0.5">
                  <h4 className="typography-ui-header text-foreground">{t('codeGraph.inspector.evidence')}</h4>
                  {(detail.definition?.evidence ?? []).length === 0 ? (
                    <p className="typography-micro text-muted-foreground">{t('codeGraph.state.unknown')}</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5" data-testid="code-graph-evidence">
                      {(detail.definition?.evidence ?? []).map((entry) => (
                        <li key={`${entry.edge}-${entry.ref}`} className="typography-micro break-words text-muted-foreground">
                          {`${entry.edge} · ${entry.ref} · ${entry.confidence.toFixed(2)}`}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
              {mode === 'trace' && (detail?.callees ?? []).length > 0 ? (
                <div className="mt-1 flex flex-col gap-1" data-testid="code-graph-trace-forward">
                  {(detail?.callees ?? []).slice(0, 8).map((callee, index) => (
                    <Button
                      key={`fwd-${callee.id}-${index}`}
                      variant="outline"
                      size="sm"
                      type="button"
                      data-testid={`code-graph-trace-fwd-${callee.id}`}
                      onClick={() => { void handleTraceTo(callee.id); }}
                    >
                      {`${callee.name ?? callee.id} · ${displayPath(callee.file)}:${callee.line}`}
                    </Button>
                  ))}
                </div>
              ) : null}
              {(impactDetail?.impacted ?? []).filter((entry) => entry.id !== selectedId).slice(0, 8).map((target) => (
                <div key={target.id} className="mt-1 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    data-testid={`code-graph-trace-to-${target.id}`}
                    onClick={() => { void handleTraceTo(target.id); }}
                  >
                    {target.id}
                  </Button>
                </div>
              ))}
              {testFiles.length > 0 ? (
                <section aria-label={t('codeGraph.explorer.tests')} className="mt-1 flex flex-col gap-1">
                  <h4 className="typography-ui-header text-foreground">{t('codeGraph.explorer.tests')}</h4>
                  <ul className="flex flex-col gap-0.5">
                    {testFiles.map((file) => (
                      <li key={file}>
                        <button
                          type="button"
                          data-testid={`code-graph-open-test-${file}`}
                          onClick={() => openSourceAt(file, 1)}
                          className="typography-micro w-full break-words text-start text-muted-foreground hover:underline"
                        >
                          {file}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {selectedId === null ? (
                <p className="typography-micro mt-1 text-muted-foreground">{t('codeGraph.explorer.noSelection')}</p>
              ) : null}
            </details>
          </aside>
        ) : null}
      </div>
    </div>
  );
};

interface PathRoots {
  snapshotRoot: string | null;
  projectRoot: string | null;
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="typography-ui-header text-foreground">{children}</h3>
);

const EvidenceList: React.FC<{ item: CodeGraphItem }> = ({ item }) => (
  <ul className="flex flex-col gap-0.5">
    {item.evidence.map((entry) => (
      <li key={`${entry.edge}-${entry.ref}`} className="typography-micro break-words text-muted-foreground">
        {`${entry.edge} · ${entry.ref} · ${entry.confidence.toFixed(2)}`}
      </li>
    ))}
    {item.knowledgeIds.map((id) => (
      <li key={id} className="typography-micro break-words text-muted-foreground">{id}</li>
    ))}
  </ul>
);

const ItemRow: React.FC<{ item: CodeGraphItem; roots: PathRoots; badge?: string }> = ({ item, roots, badge }) => (
  <li className="flex flex-col gap-0.5 rounded-md border border-border p-2">
    <span className="typography-ui min-w-0 break-words text-foreground">{item.name ?? item.id}</span>
    <span className="typography-micro w-fit rounded border border-[var(--surface-border)] px-1 text-muted-foreground" data-testid="code-graph-impact-badge">
      {badge ?? (item.confidence >= 1 ? '✓' : '~')}
    </span>
    <span className="typography-micro break-words text-muted-foreground">{`${graphFilePathForDisplay({ ...roots, file: item.file })}:${item.line}`}</span>
    <EvidenceList item={item} />
  </li>
);

const SymbolDetail: React.FC<{ context: CodeGraphQueryResult; impact: CodeGraphQueryResult | null; roots: PathRoots }> = ({ context, impact, roots }) => {
  const { t } = useI18n();
  const impacted = (impact?.impacted ?? []).filter((entry) => entry.id !== context.definition?.id);
  const isConfirmedImpact = (entry: CodeGraphItem): boolean => entry.evidence.some((edge) => edge.edge !== 'CALLS_UNRESOLVED' && (edge.confidence ?? 1) >= 1);
  const confirmedImpact = impacted.filter(isConfirmedImpact);
  const inferredImpact = impacted.filter((entry) => !isConfirmedImpact(entry));
  return (
    <div className="flex flex-col gap-2">
      {context.definition ? (
        <section aria-label={t('codeGraph.section.definition')} className="flex flex-col gap-1">
          <h4 className="typography-ui-header text-foreground">{t('codeGraph.section.definition')}</h4>
          <ul className="flex flex-col gap-1">
            <ItemRow item={context.definition} roots={roots} />
          </ul>
        </section>
      ) : null}
      {context.callers && context.callers.length > 0 ? (
        <section aria-label={t('codeGraph.section.callers')} className="flex flex-col gap-1">
          <h4 className="typography-ui-header text-foreground">{t('codeGraph.section.callers')}</h4>
          <ul className="flex flex-col gap-1">
            {context.callers.map((item) => <ItemRow key={item.id} item={item} roots={roots} />)}
          </ul>
        </section>
      ) : null}
      {impacted.length > 0 ? (
        <section aria-label={t('codeGraph.section.impact')} className="flex flex-col gap-1">
          <h4 className="typography-ui-header text-foreground">{t('codeGraph.section.impact')}</h4>
          {confirmedImpact.length > 0 ? (
            <div className="flex flex-col gap-1" data-testid="code-graph-impact-confirmed">
              <p className="typography-micro text-muted-foreground">{`${t('codeGraph.impact.confirmed')} · ${confirmedImpact.length}`}</p>
              <ul className="flex flex-col gap-1">
                {confirmedImpact.map((item) => <ItemRow key={item.id} item={item} roots={roots} badge={item.evidence.map((entry) => entry.edge).join(' · ')} />)}
              </ul>
            </div>
          ) : null}
          {inferredImpact.length > 0 ? (
            <div className="flex flex-col gap-1" data-testid="code-graph-impact-inferred">
              <p className="typography-micro text-muted-foreground">{`${t('codeGraph.impact.inferred')} · ${inferredImpact.length}`}</p>
              <ul className="flex flex-col gap-1">
                {inferredImpact.map((item) => <ItemRow key={item.id} item={item} roots={roots} badge={item.evidence.map((entry) => entry.edge).join(' · ') || '—'} />)}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <UnresolvedNotes result={context} />
    </div>
  );
};

const FileDetail: React.FC<{ result: CodeGraphQueryResult; roots: PathRoots }> = ({ result, roots }) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <section aria-label={t('codeGraph.section.file')} className="flex flex-col gap-1">
        <h4 className="typography-ui-header text-foreground">{t('codeGraph.section.file')}</h4>
        <ul className="flex flex-col gap-1">
          {result.items.map((item) => <ItemRow key={item.id} item={item} roots={roots} />)}
        </ul>
      </section>
      <UnresolvedNotes result={result} />
    </div>
  );
};

const UnresolvedNotes: React.FC<{ result: CodeGraphQueryResult }> = ({ result }) => {
  if (result.unresolved.length === 0 && result.unsupported.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {[...result.unsupported, ...result.unresolved].map((note) => (
        <p key={note} className="typography-micro break-words text-muted-foreground">{note}</p>
      ))}
    </div>
  );
};

const SearchState: React.FC<{ result: CodeGraphQueryResult }> = ({ result }) => {
  const { t } = useI18n();
  if (result.coverage === 'unindexed' && result.unsupported.length > 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="typography-ui text-muted-foreground">{t('codeGraph.state.unsupported')}</p>
        {result.unsupported.map((note) => (
          <p key={note} className="typography-micro mt-1 break-words text-muted-foreground">{note}</p>
        ))}
      </div>
    );
  }
  if (result.coverage === 'unindexed') {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="typography-ui text-muted-foreground">{t('codeGraph.state.unknown')}</p>
        {result.unresolved.map((note) => (
          <p key={note} className="typography-micro mt-1 break-words text-muted-foreground">{note}</p>
        ))}
      </div>
    );
  }
  if (result.items.length === 0) {
    return (
      <div className="rounded-md border border-border p-3">
        <p className="typography-ui text-muted-foreground">{t('codeGraph.state.empty')}</p>
      </div>
    );
  }
  return null;
};
