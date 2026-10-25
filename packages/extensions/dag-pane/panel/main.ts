// DAG side-pane guest entry (project-ide todo 13).
//
// Built-in SDK guest (`alcode-builtin-dag-pane`): an
// iframe panel plus `connectHost` that renders bridge snapshots as run
// graphs with node details, and steers/cancels the live session through
// its own host-spawned service (`serviceRequest`), which wraps the
// adapter-A bridge from todo 6. Hosted by the Electron desktop shell's
// webview only — never web, VS Code, or mobile.
//
// Styling follows the host theme: kit primitives plus `var(--oc-*)`
// tokens, no literal colors. Strings come from the package dictionaries
// keyed by `ready.locale`.
import { connectHost, type HostClient, type JsonValue } from '@alcode/sdk';
import { applyHostReady } from '@alcode/sdk/ui';
import { mountBadge } from '@alcode/sdk/ui';
import { mountBanner } from '@alcode/sdk/ui';
import { mountButton } from '@alcode/sdk/ui';
import { mountEmpty } from '@alcode/sdk/ui';
import { mountSpinner } from '@alcode/sdk/ui';
import { mountTextField } from '@alcode/sdk/ui';

import { isWireRecord, keepStoredRunModel, mergeRunModelPost, parseSnapshotDoc, wireString, type DagRunView, type DagNodeView, type DagRunWave } from './dag-view.ts';
import { buildFileQuery, buildSearchQuery, buildSymbolQueries, buildCodeGraphModel, classifyCodeItemId, codeGraphLayoutSpec, formatFreshnessChip, resolveCodeIndexStatus, resolveCodeQueryStatus, taskToCodeSource } from './code-view.ts';
import { buildRationaleProjectsQuery, buildRationaleQuery, formatRationaleProvenance, rationaleBadgesFor, resolveRationaleStatus, shouldRenderRationale } from './rationale-view.ts';
import { buildActivityTimeline, formatClock, formatDuration, rowNodeId } from './activity-view.ts';
import { stringsFor, type DagPaneStrings } from './strings.ts';
import { anchorView, computeFit, defaultView, dragDistanceExceeded, nextZoomScale, panView, viewTransform, type View } from './viewport.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_WIDTH = 132;
const NODE_HEIGHT = 46;
const COLUMN_GAP = 44;
const ROW_GAP = 18;
const POLL_MS = 4000;
const WRAPPER_STORAGE_KEY = 'wrapperEntry';

type ServiceAnswer = { status: number; body: JsonValue | undefined };

const stateTone = (state: string): 'success' | 'info' | 'neutral' | 'error' => {
  if (state === 'completed') {
    return 'success';
  }
  if (state === 'running') {
    return 'info';
  }
  if (state === 'failed' || state === 'error') {
    return 'error';
  }
  return 'neutral';
};

const stateColorVar = (state: string): string => {
  if (state === 'completed') {
    return 'var(--oc-success)';
  }
  if (state === 'running') {
    return 'var(--oc-primary)';
  }
  if (state === 'failed' || state === 'error') {
    return 'var(--oc-error)';
  }
  return 'var(--oc-muted)';
};

const el = (tag: string, className: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
};

const text = (tag: string, className: string, value: string): HTMLElement => {
  const node = el(tag, className);
  node.textContent = value;
  return node;
};

const svgEl = (tag: string, attrs: Record<string, string>): SVGElement => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
};

/** Columns of node ids: waves when the run carries them, else one column in node order. */
const columnsForRun = (run: DagRunView): string[][] => {
  const known = new Set(run.nodes.map((node) => node.id));
  const waves: DagRunWave[] = run.waves;
  if (waves.length > 0) {
    const columns = [...waves]
      .sort((a, b) => a.index - b.index)
      .map((wave) => wave.nodeIds.filter((id) => known.has(id)))
      .filter((column) => column.length > 0);
    if (columns.length > 0) {
      const placed = new Set(columns.flat());
      const missing = run.nodes.map((node) => node.id).filter((id) => !placed.has(id));
      if (missing.length > 0) {
        columns.push(missing);
      }
      return columns;
    }
  }
  return [run.nodes.map((node) => node.id)];
};

export const startDagPane = (host: HostClient, doc: Document = document): void => {
  const root = doc.getElementById('app');
  if (!root) {
    return;
  }
  let strings: DagPaneStrings = stringsFor('en');
  // The panel follows the active conversation: the host chat session owns
  // the view (one session, one DAG). There is no manual session picker;
  // switching conversations rebinds immediately and clears the old graph.
  // Set from host.onSession only.
  let hostSessionId: string | null = null;
  let hostTitle: string | null = null;
  // Latest host run-model for the active conversation (bridge snapshot
  // shape, or null when the conversation holds no delegation evidence).
  // Authoritative for the live view; the service snapshot/loop projections
  // below cover only steer- and loop-initiated runs the store never sees.
  let runModelDoc: JsonValue | null = null;
  let runModelConversation: string | null = null;
  // Race guard: every conversation switch and every refresh takes a new
  // generation; async answers from an older generation never paint.
  let refreshGen = 0;
  let connected = true;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let selectedNodeId: string | null = null;
  let wrapperEntry = '';
  // Zoom/pan view state (RunGraph port): one translate + one uniform scale
  // shared by every painted graph. It lives outside the render section key,
  // so wheel/pan ticks mutate only the world `transform` in place.
  let view: View = defaultView();
  let lastFitExtents: string | null = null;
  let lastGraphSizes: { width: number; height: number }[] = [];
  let viewportEls: SVGElement[] = [];
  let worldEls: SVGElement[] = [];
  let drag: { startX: number; startY: number; base: View } | null = null;
  let dragMoved = false;
  let suppressNodeClick = false;
  // Run/Code switcher state: one content area, switched from the header
  // controls (no second panel). The Run graph, zoom math, and data paths
  // below are untouched; the Code branch below owns its own states.
  let activeView: 'run' | 'activity' | 'code' = 'run';
  let lastCodeKey: string | null = null;
  // Code view caches: directory-scoped, refreshed only on directory change,
  // manual retry, or a new task label — never on the 4s Run poll.
  let codeGen = 0;
  let codeIndexDir = '';
  let codeIndexBody: Record<string, JsonValue> | null = null;
  let codeIndexError: string | null = null;
  let codeIndexLoading = false;
  let codeSearchInput = '';
  let codeSearchResult: Record<string, JsonValue> | null = null;
  let codeSearchError: string | null = null;
  let codeSearchLoading = false;
  let codeDetailTitle: string | null = null;
  let codeDetailGroups: { title: string; body: Record<string, JsonValue> | null; error: string | null }[] = [];
  let codeDetailError: string | null = null;
  let codeDetailLoading = false;
  // Dependency graph for the selected subject: the payload the runtime
  // returned for it, the node the user inspected, and this graph's own
  // viewport so the Code zoom never inherits the Run zoom.
  let codeGraphBody: Record<string, JsonValue> | null = null;
  let codeGraphSubject: string | null = null;
  let codeGraphSelectedId: string | null = null;
  let codeGraphView: View = defaultView();
  let rationaleLoading = false;
  let rationaleError: string | null = null;
  let rationaleLoaded = false;
  let rationaleTaskLabel = '';
  let rationaleRanked: Record<string, JsonValue>[] = [];
  // Diagnostics debugger state: live values from the last refresh, never prose.
  let paneDirectory: string | null = null;
  let statusReachable = false;
  let statusLatencyMs = 0;
  let statusError: string | null = null;
  let probeSummary: { code: string | null; available: boolean; compatible: boolean; entry: string | null; message: string | null } | null = null;
  let statusSnapshotDir = '';
  let refreshedAt: string | null = null;
  let flowBody: JsonValue | null = null;
  let flowError: string | null = null;
  let flowLatencyMs = 0;
  let diagOpen = false;
  let flowOpen = false;

  const header = el('header', 'dag-header');
  const titleNode = text('h1', 'dag-title', '');
  const controls = el('div', 'dag-controls');
  const sessionSlot = el('div', 'dag-session-slot');
  const viewSlot = el('div', 'dag-view-switcher');
  const fitSlot = el('div', 'dag-fit-slot');
  const refreshSlot = el('div', 'dag-refresh-slot');
  controls.append(viewSlot, sessionSlot, fitSlot, refreshSlot);
  header.append(titleNode, controls);

  const noticeSlot = el('div', 'dag-notice-slot');
  const content = el('main', 'dag-content');
  const steerBar = el('div', 'dag-steer-bar');
  const steerFieldSlot = el('div', 'dag-steer-field');
  const steerButtons = el('div', 'dag-steer-buttons');
  steerBar.append(steerFieldSlot, steerButtons);
  const diagRoot = el('section', 'dag-diagnostics');
  const historyRoot = el('section', 'dag-history');
  // Past runs, display-only: rows never bind the live view, so inspecting
  // history can neither pin nor disturb the followed conversation.
  let historyEntries: { sessionId: string; label: string; status: string; updatedAt: string | null }[] = [];
  let historyError: string | null = null;

  root.append(header, noticeSlot, content, steerBar, historyRoot, diagRoot);

  const sectionHandles: { dispose(): void }[] = [];
  let noticeHandle: { dispose(): void } | null = null;

  const clearSection = (): void => {
    for (const handle of sectionHandles.splice(0)) {
      handle.dispose();
    }
    content.replaceChildren();
  };

  const showNotice = (kind: 'banner' | 'none', options?: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: string; body?: string }): void => {
    noticeHandle?.dispose();
    noticeHandle = null;
    noticeSlot.replaceChildren();
    if (kind === 'banner' && options?.title) {
      noticeHandle = mountBanner(noticeSlot, {
        tone: options.tone ?? 'info',
        title: options.title,
        body: options.body,
      });
    }
  };

  const serviceCall = async (
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, string>,
    body?: JsonValue,
  ): Promise<ServiceAnswer> => {
    const answer = await host.serviceRequest({
      method,
      path,
      query,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: JsonValue | undefined;
    try {
      parsed = JSON.parse(answer.body);
    } catch {
      parsed = undefined;
    }
    return { status: answer.status, body: parsed };
  };

  const statusQuery = (): Record<string, string> | undefined => (
    paneDirectory ? { directory: paneDirectory } : undefined
  );

  // Header for the followed conversation: its human title plus a live dot
  // while any run is active. No session picker: the panel never pins an
  // old conversation.
  let headerLive = false;
  const paintFollowHeader = (): void => {
    sessionSlot.replaceChildren();
    if (hostSessionId === null) {
      return;
    }
    const wrap = el('div', 'dag-follow-head');
    const dot = el('span', `dag-live-dot${headerLive ? ' dag-live-on' : ''}`);
    dot.setAttribute('aria-hidden', 'true');
    wrap.append(dot);
    wrap.append(text('span', 'dag-follow-title', hostTitle ?? hostSessionId));
    sessionSlot.append(wrap);
  };

  // Applies the shared view to every live world layer without touching the
  // render section key: wheel/pan ticks mutate only `transform` in place.
  const applyView = (): void => {
    const transform = viewTransform(view);
    for (const world of worldEls) {
      world.setAttribute('transform', transform);
    }
  };

  const currentExtentsKey = (): string => (
    lastGraphSizes.map((size) => `${size.width}x${size.height}`).join('|')
  );

  // Shrink-only fit of the first painted graph into its viewport, shared by
  // every world layer. No-op until layout gives the viewport a real rect.
  const fitView = (): void => {
    const viewport = viewportEls[0];
    const size = lastGraphSizes[0];
    if (!viewport || !size) {
      return;
    }
    const rect = viewport.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) {
      return;
    }
    view = computeFit(rect.width, rect.height, size.width, size.height);
    lastFitExtents = currentExtentsKey();
    applyView();
  };

  const paintGraph = (run: DagRunView): void => {
    const byId = new Map(run.nodes.map((node) => [node.id, node]));
    const columns = columnsForRun(run);
    const rows = Math.max(...columns.map((column) => column.length));
    const width = columns.length * (NODE_WIDTH + COLUMN_GAP) + COLUMN_GAP;
    const height = rows * (NODE_HEIGHT + ROW_GAP) + ROW_GAP;
    lastGraphSizes.push({ width, height });
    // Legend: DOM above the viewport, outside the zoom transform, so
    // swatches and text never scale with the graph.
    const bar = el('div', 'dag-graph-bar');
    const legend = el('div', 'dag-legend');
    const legendStates: [string, string][] = [
      ['pending', strings.legendPending],
      ['running', strings.legendRunning],
      ['completed', strings.legendCompleted],
      ['failed', strings.legendFailed],
      ['blocked', strings.legendBlocked],
    ];
    for (const [state, label] of legendStates) {
      const item = el('span', 'dag-legend-item');
      const dot = el('span', 'dag-legend-dot');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.background = stateColorVar(state);
      item.append(dot, text('span', 'dag-legend-label', label));
      legend.append(item);
    }
    bar.append(legend);
    content.append(bar);
    // Outer viewport (the pan/zoom frame) plus the single transformed world
    // wrapper. Node/edge coordinates stay in world units; the width/height
    // extent math above is unchanged, only the viewBox scaling is gone.
    const viewport = svgEl('svg', {
      role: 'application',
      'aria-label': run.name,
      tabindex: '0',
    });
    viewport.classList.add('dag-graph', 'dag-graph-viewport');
    const world = svgEl('g', { class: 'dag-world', transform: viewTransform(view) });
    const positions = new Map<string, { x: number; y: number }>();
    columns.forEach((column, columnIndex) => {
      column.forEach((id, rowIndex) => {
        positions.set(id, {
          x: COLUMN_GAP + columnIndex * (NODE_WIDTH + COLUMN_GAP),
          y: ROW_GAP + rowIndex * (NODE_HEIGHT + ROW_GAP),
        });
      });
    });
    for (const edge of run.edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) {
        continue;
      }
      world.append(svgEl('line', {
        x1: String(from.x + NODE_WIDTH),
        y1: String(from.y + NODE_HEIGHT / 2),
        x2: String(to.x),
        y2: String(to.y + NODE_HEIGHT / 2),
        stroke: 'var(--oc-border)',
        'stroke-width': '2',
      }));
    }
    for (const [id, position] of positions) {
      const node = byId.get(id);
      if (!node) {
        continue;
      }
      const group = svgEl('g', { class: 'dag-node', 'data-node-id': id, tabindex: '0', role: 'button' });
      const selected = selectedNodeId === id;
      group.append(svgEl('rect', {
        x: String(position.x),
        y: String(position.y),
        width: String(NODE_WIDTH),
        height: String(NODE_HEIGHT),
        rx: 'var(--oc-radius)',
        fill: selected ? 'var(--oc-selection)' : 'var(--oc-elevated)',
        stroke: selected ? 'var(--oc-primary)' : 'var(--oc-border)',
        'stroke-width': selected ? '2.5' : '1.5',
      }));
      group.append(svgEl('circle', {
        cx: String(position.x + 14),
        cy: String(position.y + NODE_HEIGHT / 2),
        r: '5',
        fill: stateColorVar(node.state),
      }));
      const label = svgEl('text', {
        x: String(position.x + 26),
        y: String(position.y + 20),
        fill: selected ? 'var(--oc-selection-fg)' : 'var(--oc-fg)',
        'font-size': '12',
        'font-weight': '600',
      });
      label.textContent = node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label;
      const state = svgEl('text', {
        x: String(position.x + 26),
        y: String(position.y + 35),
        fill: selected ? 'var(--oc-selection-fg)' : 'var(--oc-muted)',
        'font-size': '10',
      });
      state.textContent = node.state;
      group.append(label, state);
      // A drag that moved past the threshold owns the gesture: its trailing
      // click never picks the node. Taps and still drags pick as before.
      const pick = (): void => {
        if (suppressNodeClick) {
          suppressNodeClick = false;
          return;
        }
        selectedNodeId = id;
        paintActiveView();
      };
      group.addEventListener('click', pick);
      group.addEventListener('keydown', (event) => {
        if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          pick();
        }
      });
      world.append(group);
    }
    viewport.append(world);
    content.append(viewport);
    viewportEls.push(viewport);
    worldEls.push(world);
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const wheel = event as WheelEvent;
      const rect = viewport.getBoundingClientRect();
      view = anchorView(
        view,
        wheel.clientX - rect.left,
        wheel.clientY - rect.top,
        nextZoomScale(view.scale, wheel.deltaY),
      );
      applyView();
    }, { passive: false });
    viewport.addEventListener('pointerdown', (event) => {
      const pointer = event as PointerEvent;
      try {
        viewport.setPointerCapture(pointer.pointerId);
      } catch {
        // Best-effort: the drag still tracks through pointermove.
      }
      drag = { startX: pointer.clientX, startY: pointer.clientY, base: { ...view } };
      dragMoved = false;
      suppressNodeClick = false;
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!drag) {
        return;
      }
      const pointer = event as PointerEvent;
      if (!dragMoved && dragDistanceExceeded(drag.startX, drag.startY, pointer.clientX, pointer.clientY)) {
        dragMoved = true;
      }
      if (dragMoved) {
        view = panView(drag.base, pointer.clientX - drag.startX, pointer.clientY - drag.startY);
        applyView();
      }
    });
    const endDrag = (): void => {
      if (drag !== null && dragMoved) {
        suppressNodeClick = true;
      }
      drag = null;
      dragMoved = false;
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
  };

  let currentRuns: DagRunView[] = [];
  // Render-on-change: the 4s poll calls paintContent every tick, so identical
  // frames must skip the teardown/rebuild (layout thrash reads as stutter).
  // The key covers both inputs of the painted output: run data and selection.
  let lastSectionKey: string | null = null;

  const paintDetails = (run: DagRunView): void => {
    const node: DagNodeView | undefined = run.nodes.find((entry) => entry.id === (selectedNodeId ?? run.nodes.find((entry_) => entry_.state === 'running')?.id ?? run.nodes[0]?.id));
    if (!node) {
      return;
    }
    if (!selectedNodeId) {
      selectedNodeId = node.id;
    }
    const card = el('section', 'dag-details');
    card.append(text('h2', 'dag-details-title', strings.details));
    const rows: [string, string][] = [
      ['id', node.id],
      ['label', node.label],
      ['state', node.state],
      ['attempt', String(node.attempt)],
      ['prompt', node.prompt],
      ['depends_on', node.dependsOn.join(', ') || '—'],
      ['started', node.startedAt ?? '—'],
      ['completed', node.completedAt ?? '—'],
    ];
    const list = el('dl', 'dag-details-list');
    for (const [term, value] of rows) {
      list.append(text('dt', 'dag-details-term', term), text('dd', 'dag-details-value', value));
    }
    card.append(list);
    content.append(card);
  };

  const paintContent = (runs: DagRunView[]): void => {
    const sectionKey = `runs:${JSON.stringify(runs)}|selected:${selectedNodeId ?? ''}`;
    if (sectionKey === lastSectionKey) {
      return;
    }
    lastSectionKey = sectionKey;
    clearSection();
    viewportEls = [];
    worldEls = [];
    lastGraphSizes = [];
    currentRuns = runs;
    if (runs.length === 0) {
      lastFitExtents = null;
      sectionHandles.push(mountEmpty(content, { title: strings.emptyTitle, body: strings.emptyBody }));
      return;
    }
    for (const run of runs) {
      const head = el('div', 'dag-run-head');
      head.append(text('h2', 'dag-run-name', run.name));
      const badgeSlot = el('span', 'dag-run-badge');
      head.append(badgeSlot);
      content.append(head);
      const badge = mountBadge(badgeSlot, { label: run.status, tone: stateTone(run.status) });
      sectionHandles.push(badge);
      const counts = text(
        'p',
        'dag-run-counts',
        `pending ${run.counts.pending} · running ${run.counts.running} · completed ${run.counts.completed}`,
      );
      content.append(counts);
      paintGraph(run);
      paintDetails(run);
    }
    // The view survives data refresh: fit only on first paint or when the
    // graph extents changed, otherwise re-apply the surviving transform to
    // the rebuilt world layers. The view never joins the section key above.
    if (lastFitExtents === null || lastFitExtents !== currentExtentsKey()) {
      fitView();
    } else {
      applyView();
    }
  };

  // Paint one run list with the live indicator derived from its states.
  // In Code view the same tick re-renders the Code root from cache (no
  // refetch: the Code loaders fire only on directory/label change or retry).
  const paintRunList = (runs: DagRunView[]): void => {
    headerLive = runs.some((run) => run.status === 'running' || run.status === 'pending');
    paintFollowHeader();
    if (activeView === 'code') {
      currentRuns = runs;
      paintCodeRoot();
      return;
    }
    if (activeView === 'activity') {
      currentRuns = runs;
      paintActivityRoot();
      return;
    }
    paintContent(runs);
  };

  const refreshRuns = async (gen: number): Promise<void> => {
    // Generation guard: a conversation switch or a newer refresh invalidates
    // every answer still in flight. Nothing below paints for a stale run.
    // refresh() owns the counter; this takes its generation as a parameter.
    const activeId = hostSessionId;
    const current = (): boolean => gen === refreshGen && hostSessionId === activeId;
    if (activeId === null) {
      headerLive = false;
      paintFollowHeader();
      clearSection();
      sectionHandles.push(mountEmpty(content, { title: strings.emptyTitle, body: strings.emptyBody }));
      return;
    }
    // Engine health from our own service (offline banner + diagnostics).
    try {
      const statusStart = Date.now();
      const statusAnswer = await serviceCall('GET', '/status', statusQuery());
      if (!current()) return;
      statusReachable = true;
      statusLatencyMs = Date.now() - statusStart;
      statusError = null;
      const body = isWireRecord(statusAnswer.body) ? statusAnswer.body : {};
      probeSummary = summarizeProbe(body);
      statusSnapshotDir = wireString(body.snapshotDir) ?? '';
      // A missing or unavailable probe reads as engine down (fail closed).
      const probeRecord = isWireRecord(body.probe) ? body.probe : null;
      if (probeRecord === null || probeRecord.available !== true) {
        showNotice('banner', { tone: 'warning', title: strings.offlineTitle, body: strings.offlineBody });
      } else {
        showNotice('none');
      }
    } catch (error) {
      // The service itself is unreachable: fail closed on the banner and
      // keep the empty state below it. Never keep a previous run on screen.
      if (!current()) return;
      statusReachable = false;
      statusError = error instanceof Error ? error.message : String(error);
      showNotice('banner', { tone: 'warning', title: strings.offlineTitle, body: strings.offlineBody });
      headerLive = false;
      paintFollowHeader();
      clearSection();
      sectionHandles.push(mountEmpty(content, { title: strings.emptyTitle, body: strings.emptyBody }));
      return;
    }
    // Source priority for the active conversation: the host run-model first
    // (chat-path delegation, which the service never sees), then the service
    // snapshot (steer completions), then the /loop projection (loop state
    // and live runs).
    if (runModelConversation === activeId && runModelDoc !== null) {
      const outcome = parseSnapshotDoc(runModelDoc);
      if (!current()) return;
      if (outcome.ok) {
        paintRunList(outcome.view.runs);
        return;
      }
      // A malformed host doc is a loud error card, never a silent fallback
      // to older data.
      headerLive = false;
      paintFollowHeader();
      clearSection();
      sectionHandles.push(mountBanner(content, {
        tone: 'error',
        title: strings.errorTitle,
        body: outcome.error.field,
        action: { label: strings.retry, onClick: () => void refresh() },
      }));
      return;
    }
    let answer: ServiceAnswer;
    try {
      answer = await serviceCall('GET', '/snapshot', paneDirectory ? { sessionId: activeId, directory: paneDirectory } : { sessionId: activeId });
    } catch (error) {
      // Reachable at /status but not now: fail closed on the banner too.
      if (!current()) return;
      statusError = error instanceof Error ? error.message : String(error);
      showNotice('banner', { tone: 'warning', title: strings.offlineTitle, body: strings.offlineBody });
      headerLive = false;
      paintFollowHeader();
      clearSection();
      sectionHandles.push(mountBanner(content, {
        tone: 'error',
        title: strings.errorTitle,
        body: undefined,
        action: { label: strings.retry, onClick: () => void refresh() },
      }));
      return;
    }
    if (!current()) return;
    if (answer.status === 404) {
      const loopQuery = paneDirectory ? { sessionId: activeId, directory: paneDirectory } : { sessionId: activeId };
      let loopAnswer: ServiceAnswer;
      try {
        loopAnswer = await serviceCall('GET', '/loop', loopQuery);
      } catch {
        loopAnswer = { status: 0, body: undefined };
      }
      if (!current()) return;
      if (loopAnswer.status === 200) {
        const loopOutcome = parseSnapshotDoc(loopAnswer.body);
        if (loopOutcome.ok) {
          paintRunList(loopOutcome.view.runs);
          return;
        }
      }
      if (loopAnswer.status !== 404) {
        headerLive = false;
        paintFollowHeader();
        clearSection();
        sectionHandles.push(mountBanner(content, {
          tone: 'error',
          title: strings.errorTitle,
          body: undefined,
          action: { label: strings.retry, onClick: () => void refresh() },
        }));
        return;
      }
      headerLive = false;
      paintFollowHeader();
      clearSection();
      sectionHandles.push(mountEmpty(content, { title: strings.emptyTitle, body: strings.emptyBody }));
      return;
    }
    const outcome = parseSnapshotDoc(answer.body);
    if (!current()) return;
    if (!outcome.ok) {
      headerLive = false;
      paintFollowHeader();
      clearSection();
      sectionHandles.push(mountBanner(content, {
        tone: 'error',
        title: strings.errorTitle,
        body: outcome.error.field,
        action: { label: strings.retry, onClick: () => void refresh() },
      }));
      return;
    }
    paintRunList(outcome.view.runs);
  };

  // Code view: one content area shared with the Run view, switched by the
  // header switcher. Reads /codegraph/index first (freshness chip), then
  // /codegraph/query for search / symbol / file subjects, then the
  // rationale section (/rationale/projects, one /rationale per project with
  // the task label as q). Every fetch below is generation-guarded and
  // repaints only the Code root; the Run graph, zoom, polling, session
  // follow, history, steer/cancel, and diagnostics paths are untouched.
  const answerError = (answer: ServiceAnswer): string => (
    isWireRecord(answer.body) ? (wireString(answer.body.error) ?? `http ${answer.status}`) : `http ${answer.status}`
  );

  // Activity: a chronological timeline of what THIS run actually recorded. It never reshapes the
  // graph and never invents events; the facts the snapshot cannot carry are named at the bottom.
  const paintActivityRoot = (): void => {
    clearSection();
    const run = currentRuns.find((entry) => entry.nodes.some((node) => node.id === selectedNodeId)) ?? currentRuns[0];
    if (run === undefined) {
      sectionHandles.push(mountEmpty(content, { title: strings.activityEmptyTitle, body: strings.activityEmptyBody }));
      return;
    }
    const timeline = buildActivityTimeline({ runs: currentRuns }, run.runId);
    const head = el('div', 'dag-run-head');
    head.append(text('h2', 'dag-run-name', strings.activityTitle));
    const badgeSlot = el('span', 'dag-run-badge');
    head.append(badgeSlot);
    content.append(head);
    sectionHandles.push(mountBadge(badgeSlot, { label: run.name, tone: 'neutral' }));
    if (timeline.rows.length === 0) {
      sectionHandles.push(mountEmpty(content, { title: strings.activityEmptyTitle, body: strings.activityEmptyBody }));
    } else {
      const list = el('div', 'dag-activity-list');
      for (const row of timeline.rows) {
        const item = el('button', 'dag-activity-row') as HTMLButtonElement;
        item.type = 'button';
        item.dataset['activityRow'] = row.id;
        item.dataset['nodeId'] = row.nodeId;
        item.append(text('span', 'dag-activity-time', formatClock(row.at)));
        item.append(text('span', 'dag-activity-node', row.nodeLabel));
        item.append(text('span', 'dag-activity-kind', row.kind === 'node-started' ? 'started' : row.state));
        item.append(text('span', 'dag-activity-duration', formatDuration(row.durationMs)));
        item.addEventListener('click', () => {
          selectedNodeId = rowNodeId(row);
          switchView('run');
        });
        list.append(item);
      }
      content.append(list);
    }
    const notes: string[] = [];
    if (timeline.withoutTimestamps > 0) {
      notes.push(`${timeline.withoutTimestamps} node(s) without timestamps`);
    }
    notes.push(`${strings.activityUnavailable} ${timeline.unavailable.join(', ')}`);
    content.append(text('p', 'dag-activity-notes', notes.join(' · ')));
  };

  const paintViewSwitcher = (): void => {
    viewSlot.replaceChildren();
    const runSlot = el('div', 'dag-view-button');
    const activitySlot = el('div', 'dag-view-button');
    const codeSlot = el('div', 'dag-view-button');
    viewSlot.append(runSlot, activitySlot, codeSlot);
    mountButton(runSlot, {
      label: strings.viewRun,
      variant: activeView === 'run' ? 'default' : 'outline',
      size: 'sm',
      onClick: () => switchView('run'),
    });
    mountButton(activitySlot, {
      label: strings.viewActivity,
      variant: activeView === 'activity' ? 'default' : 'outline',
      size: 'sm',
      onClick: () => switchView('activity'),
    });
    mountButton(codeSlot, {
      label: strings.viewCode,
      variant: activeView === 'code' ? 'default' : 'outline',
      size: 'sm',
      onClick: () => switchView('code'),
    });
  };

  // Content is always painted from the active view, in one place: a paint that
  // names its own view leaves `activeView` disagreeing with the DOM, and the
  // switcher then early-returns on every click (the pane looks frozen).
  const paintActiveView = (): void => {
    if (activeView === 'code') {
      paintCodeRoot();
      return;
    }
    if (activeView === 'activity') {
      paintActivityRoot();
      return;
    }
    paintContent(currentRuns);
  };

  const switchView = (next: 'run' | 'activity' | 'code'): void => {
    // A click always shows the view it names. The old guard returned early when
    // the stored view already matched, so a paint that had diverged from it left
    // every tab silently doing nothing — the pane read as frozen.
    activeView = next;
    lastSectionKey = null;
    lastCodeKey = null;
    paintViewSwitcher();
    paintActiveView();
  };

  // The task label for rationale q and task-to-code: the selected node's
  // label. Empty when nothing is selected — rationale then ranks nothing
  // and task-to-code renders its honest unavailable state.
  const currentTaskLabel = (): string => {
    for (const run of currentRuns) {
      const node = run.nodes.find((entry) => entry.id === selectedNodeId);
      if (node) {
        return node.label;
      }
    }
    return '';
  };

  const loadCodeIndex = async (gen: number): Promise<void> => {
    const dir = paneDirectory;
    if (dir === null) {
      return;
    }
    codeIndexLoading = true;
    let answer: ServiceAnswer;
    try {
      answer = await serviceCall('GET', '/codegraph/index', { directory: dir });
    } catch (error) {
      if (gen !== codeGen) {
        return;
      }
      codeIndexLoading = false;
      codeIndexError = error instanceof Error ? error.message : String(error);
      if (activeView === 'code') {
        paintCodeRoot();
      }
      return;
    }
    if (gen !== codeGen) {
      return;
    }
    codeIndexLoading = false;
    if (answer.status >= 400) {
      codeIndexBody = null;
      codeIndexError = answerError(answer);
    } else if (isWireRecord(answer.body)) {
      codeIndexBody = answer.body;
      codeIndexError = null;
    } else {
      codeIndexBody = null;
      codeIndexError = 'unreadable';
    }
    if (activeView === 'code') {
      paintCodeRoot();
    }
  };

  const runCodeSearch = async (token: string): Promise<void> => {
    const dir = paneDirectory;
    if (dir === null || token.trim() === '') {
      return;
    }
    const gen = ++codeGen;
    codeSearchLoading = true;
    codeSearchError = null;
    codeSearchResult = null;
    codeDetailTitle = null;
    codeDetailGroups = [];
    codeDetailError = null;
    codeGraphBody = null;
    codeGraphSubject = null;
    codeGraphSelectedId = null;
    if (activeView === 'code') {
      paintCodeRoot();
    }
    try {
      const built = buildSearchQuery(dir, token);
      const answer = await serviceCall('GET', built.path, built.query);
      if (gen !== codeGen) {
        return;
      }
      codeSearchLoading = false;
      if (answer.status >= 400) {
        codeSearchError = answerError(answer);
      } else if (isWireRecord(answer.body)) {
        codeSearchResult = answer.body;
      } else {
        codeSearchError = 'unreadable';
      }
    } catch (error) {
      if (gen !== codeGen) {
        return;
      }
      codeSearchLoading = false;
      codeSearchError = error instanceof Error ? error.message : String(error);
    }
    if (activeView === 'code') {
      paintCodeRoot();
    }
  };

  // A symbol select fires context + impact + tests (one query each, same
  // symbol subject); a file select fires the single file projection for
  // the `file:<rel>` id minus its prefix. Anything else renders as-is.
  // The newest subject owns the graph: the first answer that carries one
  // wins, and a subject with none keeps the absence (the painter states it).
  const captureCodeGraph = (subject: string, bodies: (Record<string, JsonValue> | null)[]): void => {
    let picked: Record<string, JsonValue> | null = null;
    for (const body of bodies) {
      if (body !== null && isWireRecord(body.graph)) {
        picked = body;
        break;
      }
    }
    codeGraphBody = picked;
    codeGraphSubject = subject;
    codeGraphSelectedId = null;
    codeGraphView = defaultView();
  };

  const selectCodeItem = (id: string): void => {
    const dir = paneDirectory;
    if (dir === null) {
      return;
    }
    const itemKind = classifyCodeItemId(id);
    if (itemKind === 'other') {
      return;
    }
    const gen = ++codeGen;
    codeDetailTitle = id;
    codeDetailLoading = true;
    codeDetailError = null;
    codeDetailGroups = [];
    if (activeView === 'code') {
      paintCodeRoot();
    }
    void (async (): Promise<void> => {
      try {
        if (itemKind === 'symbol') {
          const queries = buildSymbolQueries(dir, id);
          const titles = ['context', 'impact', 'tests'];
          const groups: { title: string; body: Record<string, JsonValue> | null; error: string | null }[] = [];
          for (let index = 0; index < queries.length; index += 1) {
            const answer = await serviceCall('GET', queries[index].path, queries[index].query);
            if (gen !== codeGen) {
              return;
            }
            if (answer.status >= 400) {
              groups.push({ title: titles[index], body: null, error: answerError(answer) });
            } else {
              groups.push({ title: titles[index], body: isWireRecord(answer.body) ? answer.body : null, error: null });
            }
          }
          if (gen !== codeGen) {
            return;
          }
          codeDetailGroups = groups;
          captureCodeGraph(id, groups.map((group) => group.body));
        } else {
          const built = buildFileQuery(dir, id.slice('file:'.length));
          const answer = await serviceCall('GET', built.path, built.query);
          if (gen !== codeGen) {
            return;
          }
          if (answer.status >= 400) {
            codeDetailGroups = [{ title: 'file', body: null, error: answerError(answer) }];
            captureCodeGraph(id, []);
          } else {
            const body = isWireRecord(answer.body) ? answer.body : null;
            codeDetailGroups = [{ title: 'file', body, error: null }];
            captureCodeGraph(id, [body]);
          }
        }
      } catch (error) {
        if (gen !== codeGen) {
          return;
        }
        codeDetailError = error instanceof Error ? error.message : String(error);
      }
      codeDetailLoading = false;
      if (activeView === 'code') {
        paintCodeRoot();
      }
    })();
  };

  const loadRationale = async (gen: number, dir: string, taskLabel: string): Promise<void> => {
    rationaleLoading = true;
    rationaleError = null;
    rationaleLoaded = false;
    try {
      const projectsBuilt = buildRationaleProjectsQuery(dir);
      const projectsAnswer = await serviceCall('GET', projectsBuilt.path, projectsBuilt.query);
      if (gen !== codeGen) {
        return;
      }
      if (projectsAnswer.status >= 400) {
        rationaleLoading = false;
        rationaleError = answerError(projectsAnswer);
        if (activeView === 'code') {
          paintCodeRoot();
        }
        return;
      }
      const ids: string[] = [];
      if (isWireRecord(projectsAnswer.body) && Array.isArray(projectsAnswer.body.projectIds)) {
        for (const entry of projectsAnswer.body.projectIds) {
          if (typeof entry === 'string' && entry.length > 0) {
            ids.push(entry);
          }
        }
      }
      // One rank query per project with the task label as q. A failed
      // project is skipped without erasing the records already ranked.
      const ranked: Record<string, JsonValue>[] = [];
      for (const projectId of ids) {
        const built = buildRationaleQuery(dir, projectId, taskLabel);
        const answer = await serviceCall('GET', built.path, built.query);
        if (gen !== codeGen) {
          return;
        }
        if (answer.status >= 400 || !isWireRecord(answer.body) || !Array.isArray(answer.body.ranked)) {
          continue;
        }
        for (const entry of answer.body.ranked) {
          if (isWireRecord(entry)) {
            ranked.push(entry);
          }
        }
      }
      if (gen !== codeGen) {
        return;
      }
      rationaleRanked = ranked;
      rationaleTaskLabel = taskLabel;
      rationaleLoaded = true;
      rationaleLoading = false;
    } catch (error) {
      if (gen !== codeGen) {
        return;
      }
      rationaleLoading = false;
      rationaleError = error instanceof Error ? error.message : String(error);
    }
    if (activeView === 'code') {
      paintCodeRoot();
    }
  };

  // Cache guard: fire the index load on directory change (clearing
  // directory-scoped caches first) and the rationale load on a new task
  // label. Steady 4s polls find warm caches and fetch nothing.
  const ensureCodeLoaded = (): void => {
    const dir = paneDirectory;
    if (dir === null || activeView !== 'code') {
      return;
    }
    const label = currentTaskLabel();
    const directoryChanged = codeIndexDir !== dir;
    const needIndex = directoryChanged || (codeIndexBody === null && codeIndexError === null && !codeIndexLoading);
    const needRationale = directoryChanged || (!rationaleLoading && (!rationaleLoaded || rationaleTaskLabel !== label));
    if (!needIndex && !needRationale) {
      return;
    }
    const gen = ++codeGen;
    if (needIndex) {
      if (directoryChanged) {
        codeIndexDir = dir;
        codeIndexBody = null;
        codeIndexError = null;
        codeSearchResult = null;
        codeSearchError = null;
        codeDetailTitle = null;
        codeDetailGroups = [];
        codeDetailError = null;
        rationaleLoaded = false;
        rationaleRanked = [];
        rationaleError = null;
      }
      void loadCodeIndex(gen);
    }
    if (needRationale) {
      void loadRationale(gen, dir, label);
    }
  };

  type CodeItemRow = { id: string; file: string | null; line: number | null };

  const codeItemsOf = (body: Record<string, JsonValue> | null): CodeItemRow[] => {
    if (body === null || !Array.isArray(body.items)) {
      return [];
    }
    const rows: CodeItemRow[] = [];
    for (const entry of body.items) {
      if (!isWireRecord(entry)) {
        continue;
      }
      const id = wireString(entry.id);
      if (id === null) {
        continue;
      }
      rows.push({
        id,
        file: wireString(entry.file),
        line: typeof entry.line === 'number' && Number.isFinite(entry.line) ? entry.line : null,
      });
    }
    return rows;
  };

  const paintCodeItemList = (parent: HTMLElement, body: Record<string, JsonValue> | null): void => {
    const status = resolveCodeQueryStatus({ error: null, result: body === null ? null : { coverage: body.coverage, items: body.items } });
    if (status === 'loading') {
      parent.append(text('p', 'dag-code-loading', strings.codeLoading));
      return;
    }
    const rows = codeItemsOf(body);
    if (rows.length === 0) {
      parent.append(text('p', 'dag-code-no-matches', strings.codeNoMatches));
      return;
    }
    const list = el('div', 'dag-code-results');
    for (const row of rows) {
      const item = el('div', 'dag-code-item');
      if (classifyCodeItemId(row.id) === 'other') {
        item.append(text('span', 'dag-code-item-id', row.id));
      } else {
        const slot = el('div', 'dag-code-item-button');
        item.append(slot);
        const label = row.file !== null ? `${row.id} · ${row.file}${row.line !== null ? `:${row.line}` : ''}` : row.id;
        const id = row.id;
        sectionHandles.push(mountButton(slot, {
          label,
          variant: 'ghost',
          size: 'sm',
          onClick: () => selectCodeItem(id),
        }));
      }
      if (row.file !== null) {
        item.append(text('span', 'dag-code-item-file', row.line !== null ? `${row.file}:${row.line}` : row.file));
      }
      list.append(item);
    }
    parent.append(list);
  };

  const paintRationaleSection = (parent: HTMLElement): void => {
    const status = resolveRationaleStatus({
      connected: statusReachable,
      error: rationaleError,
      loaded: rationaleLoaded,
      ranked: rationaleRanked,
    });
    // Empty ranks render NOTHING: no header, no container, no fallback
    // text — an empty rank simply leaves no section behind.
    if (status === 'empty') {
      return;
    }
    if (status === 'disconnected') {
      sectionHandles.push(mountBanner(parent, { tone: 'warning', title: strings.offlineTitle, body: strings.offlineBody }));
      return;
    }
    if (status === 'loading') {
      parent.append(text('p', 'dag-rationale-loading', strings.rationaleLoading));
      return;
    }
    if (status === 'error') {
      sectionHandles.push(mountBanner(parent, {
        tone: 'error',
        title: strings.rationaleErrorTitle,
        body: rationaleError ?? undefined,
        action: { label: strings.retry, onClick: () => { rationaleError = null; rationaleLoaded = false; lastCodeKey = null; paintCodeRoot(); } },
      }));
      return;
    }
    if (!shouldRenderRationale(rationaleRanked)) {
      return;
    }
    const section = el('section', 'dag-rationale');
    section.append(text('h3', 'dag-rationale-title', strings.rationaleTitle));
    for (const record of rationaleRanked) {
      // Persisted records stay in a bordered recorded container; the
      // model-generated notes below render outside it, never as fact.
      const box = el('div', 'dag-recorded');
      box.append(text('span', 'dag-recorded-tag', strings.rationaleRecorded));
      box.append(text('p', 'dag-recorded-claim', wireString(record.claim) ?? '—'));
      const badgeRow = el('div', 'dag-recorded-badges');
      if (typeof record.kind === 'string' && record.kind.length > 0) {
        badgeRow.append(text('span', 'dag-badge dag-badge-kind', record.kind));
      }
      if (typeof record.standing === 'string' && record.standing.length > 0) {
        badgeRow.append(text('span', 'dag-badge dag-badge-standing', record.standing));
      }
      for (const badge of rationaleBadgesFor(record)) {
        badgeRow.append(text('span', 'dag-badge', badge));
      }
      box.append(badgeRow);
      const list = el('dl', 'dag-recorded-list');
      for (const [term, value] of formatRationaleProvenance(record)) {
        list.append(text('dt', 'dag-recorded-term', term), text('dd', 'dag-recorded-value', value));
      }
      box.append(list);
      section.append(box);
      const notes = Array.isArray(record.notes) ? record.notes.filter(isWireRecord) : [];
      if (notes.length > 0) {
        const generated = el('div', 'dag-rationale-generated');
        for (const note of notes) {
          generated.append(text('p', 'dag-rationale-note', `${wireString(note.kind) ?? 'note'}: ${wireString(note.text) ?? ''}`));
        }
        section.append(generated);
      }
    }
    parent.append(section);
  };

  // Render-on-change like the Run view: identical ticks skip the teardown
  // so the search field keeps focus and text across the 4s polls.
  const codeStateKey = (): string => {
    const runsKey = currentRuns.map((run) => [run.runId, run.nodes.map((node) => [node.id, node.label])]);
    return JSON.stringify({
      dir: paneDirectory,
      runs: runsKey,
      sel: selectedNodeId,
      idx: codeIndexBody,
      idxErr: codeIndexError,
      idxLoading: codeIndexLoading,
      q: codeSearchInput,
      qRes: codeSearchResult,
      qErr: codeSearchError,
      qLoading: codeSearchLoading,
      detail: codeDetailTitle,
      groups: codeDetailGroups,
      graph: codeGraphBody,
      graphSel: codeGraphSelectedId,
      graphSubject: codeGraphSubject,
      detailErr: codeDetailError,
      detailLoading: codeDetailLoading,
      ratLoading: rationaleLoading,
      ratErr: rationaleError,
      ratLoaded: rationaleLoaded,
      ratLabel: rationaleTaskLabel,
      rat: rationaleRanked,
      reachable: statusReachable,
    });
  };

  const impactSummary = (nodeId: string): string => {
    for (const group of codeDetailGroups) {
      if (group.title !== 'impact') continue;
      const items = group.body?.items;
      if (!Array.isArray(items)) continue;
      const own = items.filter((item) => isWireRecord(item) && wireString(item.id) === nodeId).length;
      return `${items.length}${own > 0 ? ` (${nodeId})` : ''}`;
    }
    return '—';
  };

  /**
   * The Code view's dependency graph: a real ego-graph painted as an SVG the
   * user can fit, zoom, pan, and inspect. Absence is stated, never an empty
   * canvas — a subject whose answer carried no graph says so by name.
   */
  const paintCodeGraphSection = (parent: HTMLElement): void => {
    if (codeGraphSubject === null) {
      return;
    }
    const box = el('div', 'dag-code-graph');
    const head = el('div', 'dag-code-graph-head');
    head.append(text('h3', 'dag-code-graph-title', strings.codeGraphTitle));
    const model = buildCodeGraphModel(codeGraphBody);
    if (model === null) {
      box.append(head, text('p', 'dag-code-graph-empty', strings.codeGraphEmpty));
      parent.append(box);
      return;
    }
    const spec = codeGraphLayoutSpec(model);
    head.append(text('span', 'dag-code-graph-counts', `${strings.codeGraphEdges} ${model.edges.length}`));
    const fitSlot = el('div', 'dag-code-graph-fit');
    head.append(fitSlot);
    box.append(head);
    if (model.truncated) {
      box.append(text('p', 'dag-code-graph-note', strings.codeGraphTruncated));
    }
    const viewport = svgEl('svg', { role: 'application', 'aria-label': strings.codeGraphTitle, tabindex: '0' });
    viewport.classList.add('dag-graph', 'dag-graph-viewport', 'dag-code-graph-canvas');
    viewport.setAttribute('data-subject', model.subjectId);
    const world = svgEl('g', { class: 'dag-world', transform: viewTransform(codeGraphView) });
    const confidence = new Map<string, number>();
    for (const edge of spec.edges) {
      world.append(svgEl('line', {
        class: 'dag-code-graph-edge',
        'data-edge-kind': edge.kind,
        'data-edge-from': edge.from,
        'data-edge-to': edge.to,
        x1: String(edge.x1),
        y1: String(edge.y1),
        x2: String(edge.x2),
        y2: String(edge.y2),
        stroke: 'var(--oc-border)',
        'stroke-width': '1.5',
      }));
      world.append(svgEl('polygon', {
        points: `${edge.x2},${edge.y2} ${edge.x2 - 7},${edge.y2 - 3.5} ${edge.x2 - 7},${edge.y2 + 3.5}`,
        fill: 'var(--oc-border)',
      }));
      confidence.set(edge.from, Math.max(confidence.get(edge.from) ?? 0, edge.confidence));
      confidence.set(edge.to, Math.max(confidence.get(edge.to) ?? 0, edge.confidence));
    }
    for (const node of spec.nodes) {
      const group = svgEl('g', {
        class: 'dag-code-graph-node',
        'data-node-id': node.id,
        'data-node-kind': node.kind,
        tabindex: '0',
        role: 'button',
      });
      const selected = codeGraphSelectedId === node.id;
      group.append(svgEl('rect', {
        x: String(node.x),
        y: String(node.y),
        width: String(node.width),
        height: String(node.height),
        rx: 'var(--oc-radius)',
        fill: node.subject || selected ? 'var(--oc-selection)' : 'var(--oc-elevated)',
        stroke: selected || node.subject ? 'var(--oc-primary)' : 'var(--oc-border)',
        'stroke-width': selected || node.subject ? '2.5' : '1.5',
      }));
      const label = svgEl('text', { x: String(node.x + 10), y: String(node.y + 18), fill: 'var(--oc-text)', 'font-size': '12' });
      label.textContent = node.label;
      const kind = svgEl('text', { x: String(node.x + 10), y: String(node.y + 34), fill: 'var(--oc-muted)', 'font-size': '10' });
      kind.textContent = node.kind;
      group.append(label, kind);
      const pick = (): void => {
        codeGraphSelectedId = node.id;
        lastCodeKey = null;
        paintCodeRoot();
      };
      group.addEventListener('click', pick);
      group.addEventListener('keydown', (event) => {
        if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          pick();
        }
      });
      world.append(group);
    }
    viewport.append(world);
    box.append(viewport);
    const apply = (): void => {
      world.setAttribute('transform', viewTransform(codeGraphView));
    };
    const fit = (): void => {
      const rect = viewport.getBoundingClientRect();
      codeGraphView = computeFit(
        rect.width > 0 ? rect.width : 720,
        rect.height > 0 ? rect.height : 320,
        spec.width,
        spec.height,
      );
      apply();
    };
    const refit = (): void => {
      // First paint runs before the browser lays the canvas out, so the fit
      // it computes from zero width centres nothing; one frame later the
      // measured box is real. Both paths stay, so a host without rAF still fits.
      fit();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(fit);
      }
    };
    sectionHandles.push(mountButton(fitSlot, {
      label: strings.codeGraphFit,
      variant: 'outline',
      size: 'sm',
      onClick: fit,
    }));
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      const wheel = event as WheelEvent;
      const rect = viewport.getBoundingClientRect();
      codeGraphView = anchorView(
        codeGraphView,
        wheel.clientX - rect.left,
        wheel.clientY - rect.top,
        nextZoomScale(codeGraphView.scale, wheel.deltaY),
      );
      apply();
    }, { passive: false });
    let drag: { startX: number; startY: number; base: View } | null = null;
    let dragMoved = false;
    let suppress = false;
    viewport.addEventListener('pointerdown', (event) => {
      const pointer = event as PointerEvent;
      try {
        viewport.setPointerCapture(pointer.pointerId);
      } catch {
        // Best-effort: the drag still tracks through pointermove.
      }
      drag = { startX: pointer.clientX, startY: pointer.clientY, base: { ...codeGraphView } };
      dragMoved = false;
      suppress = false;
    });
    viewport.addEventListener('pointermove', (event) => {
      if (drag === null) return;
      const pointer = event as PointerEvent;
      if (!dragMoved && dragDistanceExceeded(drag.startX, drag.startY, pointer.clientX, pointer.clientY)) {
        dragMoved = true;
      }
      if (!dragMoved) return;
      codeGraphView = panView(drag.base, pointer.clientX - drag.startX, pointer.clientY - drag.startY);
      apply();
    });
    const endDrag = (): void => {
      if (drag !== null && dragMoved) suppress = true;
      drag = null;
      dragMoved = false;
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('click', (event) => {
      if (!suppress) return;
      suppress = false;
      event.stopPropagation();
    }, true);
    box.append(text('p', 'dag-code-graph-hint', strings.codeGraphHint));
    const selectedNode = spec.nodes.find((node) => node.id === codeGraphSelectedId) ?? null;
    if (selectedNode !== null) {
      const inspector = el('dl', 'dag-code-inspect');
      const row = (label: string, value: string): void => {
        inspector.append(text('dt', 'dag-code-inspect-key', label), text('dd', 'dag-code-inspect-value', value));
      };
      row(strings.codeGraphInspectSymbol, selectedNode.id);
      row(
        strings.codeGraphInspectPath,
        selectedNode.file === null ? '—' : `${selectedNode.file}${selectedNode.line === null ? '' : `:${selectedNode.line}`}`,
      );
      row(strings.codeGraphInspectConfidence, String(confidence.get(selectedNode.id) ?? 1));
      row(strings.codeGraphInspectImpact, impactSummary(selectedNode.id));
      box.append(inspector);
    }
    parent.append(box);
    refit();
  };

  const paintCodeRoot = (): void => {
    ensureCodeLoaded();
    const key = codeStateKey();
    if (key === lastCodeKey) {
      return;
    }
    lastCodeKey = key;
    clearSection();
    viewportEls = [];
    worldEls = [];
    lastGraphSizes = [];
    const section = el('section', 'dag-code');
    const header = el('div', 'dag-code-header');
    header.append(text('h2', 'dag-code-title', strings.codeTitle));
    const openSlot = el('div', 'dag-code-open-graph');
    header.append(openSlot);
    section.append(header);
    // The canonical Code Graph tab owns the graph and its selection. This pane
    // only routes: the same file/symbol lands there through the host's
    // openSurface channel, so the guest never keeps a second graph selection.
    // Task-to-code navigates ONLY from recorded engine rows: the current
    // run nodes. Any other selection (or none) renders the honest
    // unavailable state while normal exploration stays offered below.
    const rows = currentRuns.flatMap((run) => run.nodes.map((node) => ({ id: node.id, label: node.label })));
    const source = taskToCodeSource(rows, selectedNodeId);
    const focusFileForGraph = (): string | null => {
      const id = codeGraphSelectedId ?? codeGraphSubject;
      if (id !== null) {
        if (id.startsWith('file:')) return id.slice('file:'.length);
        const at = id.lastIndexOf('@');
        if (at > -1) return id.slice(at + 1);
      }
      const token = source.token;
      return token !== null && token.includes('/') ? token : null;
    };
    sectionHandles.push(mountButton(openSlot, {
      label: strings.codeOpenInGraph,
      size: 'sm',
      onClick: () => {
        const file = focusFileForGraph();
        void host.openSurface('code-graph', file === null ? undefined : { file });
      },
    }));
    if (source.available && source.token !== null) {
      const jump = el('div', 'dag-code-jump');
      jump.append(text('span', 'dag-code-jump-label', source.token));
      const jumpSlot = el('div', 'dag-code-jump-button');
      jump.append(jumpSlot);
      section.append(jump);
      const token = source.token;
      sectionHandles.push(mountButton(jumpSlot, {
        label: strings.codeSearchButton,
        size: 'sm',
        onClick: () => {
          codeSearchInput = token;
          void runCodeSearch(token);
        },
      }));
    } else {
      const unavailable = el('div', 'dag-code-unavailable');
      unavailable.append(text('p', 'dag-code-unavailable-title', strings.codeTaskUnavailableTitle));
      unavailable.append(text('p', 'dag-code-unavailable-body', strings.codeTaskUnavailableBody));
      const runSlot = el('div', 'dag-code-unavailable-button');
      unavailable.append(runSlot);
      section.append(unavailable);
      sectionHandles.push(mountButton(runSlot, {
        label: strings.viewRun,
        variant: 'outline',
        size: 'sm',
        onClick: () => switchView('run'),
      }));
    }
    // Index block: freshness chip first, then the honest state.
    const dir = paneDirectory;
    if (dir === null) {
      sectionHandles.push(mountEmpty(section, { title: strings.codeEmptyTitle, body: strings.codeEmptyBody }));
    } else {
      const indexStatus = resolveCodeIndexStatus({ connected: statusReachable, error: codeIndexError, index: codeIndexBody });
      if (indexStatus === 'disconnected') {
        sectionHandles.push(mountBanner(section, { tone: 'warning', title: strings.offlineTitle, body: strings.offlineBody }));
      } else if (indexStatus === 'loading') {
        const spinSlot = el('div', 'dag-code-loading');
        spinSlot.append(text('span', 'dag-code-loading-label', strings.codeLoading));
        section.append(spinSlot);
        sectionHandles.push(mountSpinner(spinSlot, {}));
      } else if (indexStatus === 'error') {
        sectionHandles.push(mountBanner(section, {
          tone: 'error',
          title: strings.codeErrorTitle,
          body: codeIndexError ?? undefined,
          action: { label: strings.retry, onClick: () => { codeIndexError = null; codeIndexBody = null; lastCodeKey = null; paintCodeRoot(); } },
        }));
      } else if (indexStatus === 'empty') {
        sectionHandles.push(mountEmpty(section, { title: strings.codeEmptyTitle, body: strings.codeEmptyBody }));
      } else {
        const chipBody: Record<string, JsonValue> = codeIndexBody ?? {};
        const chip = formatFreshnessChip(chipBody);
        const chipNode = el('div', 'dag-freshness-chip');
        chipNode.textContent = chip.text;
        chipNode.title = `revision ${chip.revision} · fingerprint ${chip.fingerprint}`;
        section.append(chipNode);
        const nodeCount = typeof chipBody.nodeCount === 'number' ? chipBody.nodeCount : null;
        const edgeCount = typeof chipBody.edgeCount === 'number' ? chipBody.edgeCount : null;
        const entryCount = typeof chipBody.entryCount === 'number' ? chipBody.entryCount : null;
        section.append(text(
          'p',
          'dag-freshness-counts',
          `nodes ${nodeCount ?? '—'} · edges ${edgeCount ?? '—'} · entries ${entryCount ?? '—'}`,
        ));
        if (indexStatus === 'stale') {
          section.append(text('p', 'dag-code-stale', strings.codeStale));
          const retrySlot = el('div', 'dag-code-stale-button');
          section.append(retrySlot);
          sectionHandles.push(mountButton(retrySlot, {
            label: strings.retry,
            variant: 'outline',
            size: 'sm',
            onClick: () => { codeIndexError = null; codeIndexBody = null; lastCodeKey = null; paintCodeRoot(); },
          }));
        }
      }
      // Exploration: manual search plus result/detail browsing. Symbol
      // rows fire context + impact + tests on select; file rows fire the
      // file query; other ids render as-is with no invented follow-up.
      const searchBar = el('div', 'dag-code-search');
      const fieldSlot = el('div', 'dag-code-search-field');
      searchBar.append(fieldSlot);
      const searchSlot = el('div', 'dag-code-search-button');
      searchBar.append(searchSlot);
      section.append(searchBar);
      sectionHandles.push(mountTextField(fieldSlot, {
        placeholder: strings.codeSearchPlaceholder,
        value: codeSearchInput,
        onChange: (value: string) => {
          codeSearchInput = value;
        },
      }));
      sectionHandles.push(mountButton(searchSlot, {
        label: strings.codeSearchButton,
        size: 'sm',
        onClick: () => void runCodeSearch(codeSearchInput),
      }));
      paintCodeGraphSection(section);
      const queryStatus = resolveCodeQueryStatus({
        error: codeSearchError,
        result: codeSearchLoading
          ? null
          : codeSearchResult === null && codeSearchError === null
            ? null
            : codeSearchResult,
      });
      if (codeSearchLoading) {
        section.append(text('p', 'dag-code-loading', strings.codeLoading));
      } else if (queryStatus === 'error') {
        sectionHandles.push(mountBanner(section, {
          tone: 'error',
          title: strings.codeErrorTitle,
          body: codeSearchError ?? undefined,
          action: { label: strings.retry, onClick: () => void runCodeSearch(codeSearchInput) },
        }));
      } else if (codeSearchResult !== null || codeSearchError !== null) {
        paintCodeItemList(section, codeSearchResult);
      }
      if (codeDetailLoading) {
        section.append(text('p', 'dag-code-loading', strings.codeLoading));
      } else if (codeDetailError !== null) {
        sectionHandles.push(mountBanner(section, {
          tone: 'error',
          title: strings.codeErrorTitle,
          body: codeDetailError,
        }));
      } else {
        for (const group of codeDetailGroups) {
          const groupBox = el('div', 'dag-code-group');
          groupBox.append(text('h3', 'dag-code-detail-title', group.title));
          if (group.error !== null) {
            groupBox.append(text('p', 'dag-code-group-error', group.error));
          } else {
            paintCodeItemList(groupBox, group.body);
          }
          section.append(groupBox);
        }
      }
    }
    paintRationaleSection(section);
    content.append(section);
  };

  // Probe body summary for Diagnostics: code, flags, entry, and the
  // message truncated to 140 chars. Reads the /status body the pane
  // already fetches; no new channel.
  const summarizeProbe = (body: Record<string, JsonValue>): {
    code: string | null; available: boolean; compatible: boolean; entry: string | null; message: string | null;
  } => {
    const probe = isWireRecord(body.probe) ? body.probe : null;
    if (!probe) {
      return { code: null, available: false, compatible: false, entry: null, message: null };
    }
    const code = wireString(probe.code);
    const message = wireString(probe.message);
    return {
      code,
      available: probe.available === true,
      compatible: probe.compatible === true,
      entry: wireString(probe.entry),
      message: message === null ? null : message.slice(0, 140),
    };
  };

  const refreshFlow = async (): Promise<void> => {
    if (!hostSessionId) {
      flowBody = null;
      flowError = null;
      flowLatencyMs = 0;
      return;
    }
    const query: Record<string, string> = { sessionId: hostSessionId };
    if (paneDirectory) {
      query.directory = paneDirectory;
    }
    const start = Date.now();
    try {
      const answer = await serviceCall('GET', '/debug', query);
      flowLatencyMs = Date.now() - start;
      if (answer.status >= 400) {
        const code = isWireRecord(answer.body) ? wireString(answer.body.code) : null;
        flowBody = null;
        flowError = code ?? `http ${answer.status}`;
        return;
      }
      flowBody = answer.body ?? null;
      flowError = null;
    } catch (error) {
      flowLatencyMs = Date.now() - start;
      flowBody = null;
      flowError = error instanceof Error ? error.message : String(error);
    }
  };

  const refreshHistory = async (gen: number): Promise<void> => {
    const query = paneDirectory ? { directory: paneDirectory } : undefined;
    try {
      const answer = await serviceCall('GET', '/history', query);
      if (gen !== refreshGen || !isWireRecord(answer.body)) return;
      const entries = Array.isArray(answer.body.entries) ? answer.body.entries : [];
      const parsed: { sessionId: string; label: string; status: string; updatedAt: string | null }[] = [];
      for (const entry of entries) {
        if (!isWireRecord(entry)) continue;
        const sessionId = wireString(entry.sessionId);
        const label = wireString(entry.label);
        const status = wireString(entry.status);
        if (sessionId === null || label === null || status === null) continue;
        // History covers the followed conversation only: rows stay
        // display-only and never bind the live view.
        if (sessionId !== hostSessionId) continue;
        parsed.push({ sessionId, label, status, updatedAt: wireString(entry.updatedAt) });
      }
      historyEntries = parsed;
      historyError = null;
    } catch (error) {
      if (gen !== refreshGen) return;
      historyError = error instanceof Error ? error.message : String(error);
    }
    paintHistory();
  };

  const paintHistory = (): void => {
    historyRoot.replaceChildren();
    const box = doc.createElement('details');
    box.className = 'dag-history-box';
    const summary = doc.createElement('summary');
    summary.textContent = `${strings.history} (${historyEntries.length})`;
    box.append(summary);
    if (historyError !== null) {
      box.append(text('p', 'dag-history-error', historyError));
    } else if (historyEntries.length === 0) {
      box.append(text('p', 'dag-history-empty', strings.historyEmpty));
    } else {
      const list = el('div', 'dag-history-list');
      for (const entry of historyEntries) {
        const row = el('div', 'dag-history-row');
        row.append(text('span', 'dag-history-label', entry.label));
        const badgeSlot = el('span', 'dag-history-badge');
        row.append(badgeSlot);
        const badge = mountBadge(badgeSlot, { label: entry.status, tone: stateTone(entry.status) });
        sectionHandles.push(badge);
        row.append(text('span', 'dag-history-time', entry.updatedAt ?? '—'));
        list.append(row);
      }
      box.append(list);
    }
    historyRoot.append(box);
  };

  const refresh = async (): Promise<void> => {
    const gen = ++refreshGen;
    await refreshRuns(gen);
    refreshedAt = new Date().toISOString();
    await refreshFlow();
    await refreshHistory(gen);
    paintDiag();
  };

  const diagValue = (value: string | number | boolean | null | undefined): string => {
    if (value === null || value === undefined) {
      return '—';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '—';
    }
    return value.length > 0 ? value : '—';
  };

  const wireCount = (record: Record<string, JsonValue>, key: string): number | null => {
    const value: JsonValue = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const wireFlag = (record: Record<string, JsonValue>, key: string): boolean | null => {
    const value: JsonValue = record[key];
    return typeof value === 'boolean' ? value : null;
  };

  const wireText = (record: Record<string, JsonValue>, key: string): string | null => {
    const value = wireString(record[key] ?? undefined);
    return value !== null && value.length > 0 ? value : null;
  };

  type FlowStage = { id: string; ok: boolean; values: [string, string][] };

  const evalFlowStages = (): FlowStage[] => {
    const body = isWireRecord(flowBody) ? flowBody : null;
    const route = body !== null && isWireRecord(body.route) ? body.route : null;
    const hook = body !== null && isWireRecord(body.hook) ? body.hook : null;
    const loop = body !== null && isWireRecord(body.loop) ? body.loop : null;
    const snapshot = body !== null && isWireRecord(body.snapshot) ? body.snapshot : null;
    const routeCommand = route !== null ? wireText(route, 'command') : null;
    const routeDecision = route !== null ? wireText(route, 'decision') : null;
    const routeSample = route !== null ? wireText(route, 'sample') : null;
    const routeSession = route !== null ? wireText(route, 'sessionId') : null;
    const hookHit = hook !== null ? wireFlag(hook, 'hit') : null;
    const hookPattern = hook !== null ? wireText(hook, 'pattern') : null;
    const hookSample = hook !== null ? wireText(hook, 'sample') : null;
    const loopDir = loop !== null ? wireText(loop, 'dir') : null;
    const loopPlan = loop !== null ? wireFlag(loop, 'plan') : null;
    const loopGoals = loop !== null ? wireFlag(loop, 'goals') : null;
    const loopLedger = loop !== null ? wireFlag(loop, 'ledger') : null;
    const loopEvents = loop !== null ? wireCount(loop, 'events') : null;
    const snapPath = snapshot !== null ? wireText(snapshot, 'path') : null;
    const snapExists = snapshot !== null ? wireFlag(snapshot, 'exists') : null;
    const snapUpdated = snapshot !== null ? wireText(snapshot, 'updatedAt') : null;
    const snapMatch = snapshot !== null ? wireFlag(snapshot, 'sessionMatch') : null;
    return [
      {
        id: 'route',
        ok: route !== null,
        values: [
          ['decision', diagValue(routeDecision)],
          ['sample', diagValue(routeSample)],
          ['session', diagValue(routeSession)],
        ],
      },
      {
        id: 'command',
        ok: routeCommand !== null,
        values: [
          ['command', diagValue(routeCommand)],
          ['arguments', diagValue(route !== null ? wireText(route, 'arguments') : null)],
        ],
      },
      {
        id: 'hook',
        ok: hookHit === true,
        values: [
          ['pattern', diagValue(hookPattern)],
          ['hit', diagValue(hookHit)],
          ['sample', diagValue(hookSample)],
        ],
      },
      {
        id: 'loop',
        ok: loopLedger === true && (loopEvents ?? 0) > 0 && (loopPlan === true || loopGoals === true),
        values: [
          ['dir', diagValue(loopDir)],
          ['plan', diagValue(loopPlan)],
          ['goals', diagValue(loopGoals)],
          ['ledger', diagValue(loopLedger)],
          ['events', diagValue(loopEvents)],
        ],
      },
      {
        id: 'snapshot',
        ok: snapExists === true && snapMatch === true,
        values: [
          ['path', diagValue(snapPath)],
          ['exists', diagValue(snapExists)],
          ['updatedAt', diagValue(snapUpdated)],
          ['sessionMatch', diagValue(snapMatch)],
        ],
      },
      {
        id: 'pane',
        ok: statusReachable && probeSummary?.available === true,
        values: [
          ['reachable', diagValue(statusReachable)],
          ['latencyMs', diagValue(statusReachable ? statusLatencyMs : null)],
          ['code', diagValue(probeSummary?.code ?? null)],
          ['available', diagValue(probeSummary?.available ?? null)],
          ['session', diagValue(hostSessionId)],
        ],
      },
    ];
  };

  const paintDiag = (): void => {
    diagRoot.replaceChildren();
    const diagDetails = doc.createElement('details');
    diagDetails.className = 'dag-diagnostics-box';
    diagDetails.open = diagOpen;
    diagDetails.addEventListener('toggle', () => {
      diagOpen = diagDetails.open;
    });
    const diagSummary = doc.createElement('summary');
    diagSummary.textContent = strings.diagnostics;
    diagDetails.append(diagSummary);
    const diagList = el('dl', 'dag-diagnostics-list');
    const diagRows: [string, string][] = [
      ['reachable', diagValue(statusReachable)],
      ['latencyMs', diagValue(statusReachable ? statusLatencyMs : null)],
      ['probeCode', diagValue(probeSummary?.code ?? null)],
      ['available', diagValue(probeSummary?.available ?? null)],
      ['compatible', diagValue(probeSummary?.compatible ?? null)],
      ['entry', diagValue(probeSummary?.entry ?? null)],
      ['message', diagValue(probeSummary?.message ?? null)],
      ['snapshotDir', diagValue(statusSnapshotDir.length > 0 ? statusSnapshotDir : null)],
      ['session', diagValue(hostSessionId)],
      ['runModel', diagValue(runModelConversation)],
      ['refreshedAt', diagValue(refreshedAt)],
      ['lastError', diagValue(statusError)],
    ];
    for (const [term, value] of diagRows) {
      diagList.append(text('dt', 'dag-diagnostics-term', term), text('dd', 'dag-diagnostics-value', value));
    }
    diagDetails.append(diagList);
    diagRoot.append(diagDetails);

    const flowDetails = doc.createElement('details');
    flowDetails.className = 'dag-flow-box';
    flowDetails.open = flowOpen;
    flowDetails.addEventListener('toggle', () => {
      flowOpen = flowDetails.open;
    });
    const flowSummary = doc.createElement('summary');
    flowSummary.textContent = strings.flowTrace;
    flowDetails.append(flowSummary);
    if (flowError !== null) {
      flowDetails.append(text('p', 'dag-flow-error', flowError));
    } else if (flowBody === null) {
      const empty = el('dl', 'dag-flow-list');
      empty.append(text('dt', 'dag-flow-term', 'session'), text('dd', 'dag-flow-value', '—'));
      flowDetails.append(empty);
    } else {
      for (const stage of evalFlowStages()) {
        const row = el('div', 'dag-flow-stage');
        const status = text('span', `dag-flow-status dag-flow-${stage.ok ? 'pass' : 'fail'}`, stage.ok ? 'PASS' : 'FAIL');
        row.append(text('span', 'dag-flow-id', stage.id), status);
        const list = el('dl', 'dag-flow-list');
        for (const [term, value] of stage.values) {
          list.append(text('dt', 'dag-flow-term', term), text('dd', 'dag-flow-value', value));
        }
        row.append(list);
        flowDetails.append(row);
      }
      flowDetails.append(text('p', 'dag-flow-meta', `latencyMs ${flowLatencyMs}`));
    }
    diagRoot.append(flowDetails);
  };

  const stopPolling = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = (): void => {
    stopPolling();
    // Polling is driven by engine health from our own service, never by
    // the OAuth-account connection flag (see onConnection below).
    pollTimer = setInterval(() => {
      void refresh();
    }, POLL_MS);
  };

  const paintChrome = (): void => {
    titleNode.textContent = strings.title;
    paintFollowHeader();
    paintViewSwitcher();
    fitSlot.replaceChildren();
    mountButton(fitSlot, { label: strings.fit, variant: 'outline', size: 'sm', onClick: () => fitView() });
    refreshSlot.replaceChildren();
    mountButton(refreshSlot, { label: strings.refresh, variant: 'outline', size: 'sm', onClick: () => void refresh() });
    steerFieldSlot.replaceChildren();
    mountTextField(steerFieldSlot, {
      placeholder: strings.steerPlaceholder,
      value: '',
      onChange: () => {},
    });
    steerButtons.replaceChildren();
    mountButton(steerButtons, {
      label: strings.steer,
      variant: 'default',
      size: 'sm',
      onClick: () => void steer(),
    });
    mountButton(steerButtons, {
      label: strings.cancel,
      variant: 'destructive',
      size: 'sm',
      onClick: () => void cancel(),
    });
    if (activeView === 'code') {
      lastCodeKey = null;
      paintCodeRoot();
    }
  };

  const steer = async (): Promise<void> => {
    const message = (steerFieldValue()).trim();
    if (!message || !hostSessionId) {
      return;
    }
    const sessionId = hostSessionId;
    try {
      const trimmedEntry = wrapperEntry.trim();
      const steerBody = trimmedEntry
        ? { message, sessionId, entry: trimmedEntry }
        : { message, sessionId };
      const answer = await serviceCall('POST', '/steer', undefined, steerBody);
      if (answer.status >= 400) {
        const code = isWireRecord(answer.body) ? wireString(answer.body.code) ?? 'request_failed' : 'request_failed';
        await host.toast({ kind: 'error', message: `${strings.steer}: ${code}` });
        return;
      }
      await host.toast({ kind: 'success', message: `${strings.steer}: ${sessionId}` });
      void refresh();
    } catch {
      await host.toast({ kind: 'error', message: `${strings.steer}: disconnected` });
    }
  };

  const steerFieldValue = (): string => {
    const input = steerFieldSlot.querySelector('input');
    return input instanceof HTMLInputElement ? input.value : '';
  };

  const cancel = async (): Promise<void> => {
    if (!hostSessionId) {
      return;
    }
    const sessionId = hostSessionId;
    try {
      const answer = await serviceCall('POST', '/cancel', undefined, { sessionId, reason: 'pane cancel' });
      if (answer.status >= 400) {
        const code = isWireRecord(answer.body) ? wireString(answer.body.code) ?? 'request_failed' : 'request_failed';
        await host.toast({ kind: 'error', message: `${strings.cancel}: ${code}` });
        return;
      }
      await host.toast({ kind: 'success', message: `${strings.cancel}: ${sessionId}` });
      void refresh();
    } catch {
      await host.toast({ kind: 'error', message: `${strings.cancel}: disconnected` });
    }
  };

  void host.onReady((context) => {
    strings = stringsFor(context.locale);
    applyHostReady(context, doc.documentElement);
    // Silent override: a previously saved path keeps steering through it;
    // empty storage means auto-resolve, never a prompt (no visible input).
    void host.storage.get(WRAPPER_STORAGE_KEY).then((stored) => {
      const entry = wireString(stored ?? undefined);
      if (entry !== null) {
        wrapperEntry = entry;
      }
    }).catch(() => {});
    paintChrome();
    void refresh();
    startPolling();
  });

  // The connection flag carries OAuth-account state, not engine health:
  // this integration-less guest permanently reads connected:false, so the
  // flag must never drive the offline banner nor stop polling. A reconnect
  // still refreshes into current state.
  // The repo root for the flow trace's loop-state stage. Refreshes into
  // current state on change; a null directory leaves stage 4 unevaluated.
  void host.onDirectory((directory) => {
    paneDirectory = directory;
  });

  void host.onConnection((connection) => {
    const was = connected;
    connected = connection.connected;
    if (connected && !was) {
      void refresh();
    }
  });

  void host.onSession((session) => {
    const id = session?.id ?? null;
    const title = session?.title ?? null;
    const retitled = title !== hostTitle;
    hostTitle = title;
    // Only a different conversation rebinds: it invalidates in-flight answers,
    // drops the previous run, and shows a spinner until fresh data lands. A
    // retitled conversation keeps its graph, selection, and zoom — the engine
    // retitles as a turn progresses, and that must not blank what is on screen.
    if (id !== hostSessionId) {
      hostSessionId = id;
      refreshGen += 1;
      if (!keepStoredRunModel(runModelConversation, id)) {
        runModelDoc = null;
        runModelConversation = null;
      }
      selectedNodeId = null;
      lastSectionKey = null;
      lastCodeKey = null;
      codeGen += 1;
      view = defaultView();
      lastFitExtents = null;
      lastGraphSizes = [];
      viewportEls = [];
      worldEls = [];
      drag = null;
      dragMoved = false;
      suppressNodeClick = false;
      headerLive = false;
      paintFollowHeader();
      clearSection();
      if (id !== null) {
        sectionHandles.push(mountSpinner(content, {}));
      } else {
        sectionHandles.push(mountEmpty(content, { title: strings.emptyTitle, body: strings.emptyBody }));
      }
    } else if (retitled) {
      paintFollowHeader();
    }
    void refresh();
  });

  // Host run-model posts carry the conversation they were built for. A post can
  // arrive before onSession binds that conversation (the host sends it from its
  // own effect), so it is kept; refreshRuns paints it only when its
  // conversation is the active one.
  void host.onRunModel((model) => {
    const merged = mergeRunModelPost({ conversationId: runModelConversation, snapshot: runModelDoc }, model);
    runModelDoc = merged.snapshot;
    runModelConversation = merged.conversationId;
    void refresh();
  });
};

const boot = (): void => {
  let framed = false;
  try {
    framed = window.parent !== window.self;
  } catch {
    framed = false;
  }
  if (!framed) {
    document.getElementById('app')?.replaceChildren(
      (() => {
        const note = document.createElement('p');
        note.textContent = 'alcode-builtin-dag-pane loads only as a guest iframe.';
        return note;
      })(),
    );
    return;
  }
  const host = connectHost();
  startDagPane(host);
};

boot();
