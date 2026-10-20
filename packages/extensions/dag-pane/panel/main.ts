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

import { isWireRecord, keepStoredRunModel, parseSnapshotDoc, wireString, type DagRunView, type DagNodeView, type DagRunWave } from './dag-view.ts';
import { stringsFor, type DagPaneStrings } from './strings.ts';

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
  const refreshSlot = el('div', 'dag-refresh-slot');
  controls.append(sessionSlot, refreshSlot);
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

  root.append(header, noticeSlot, content, historyRoot, steerBar, diagRoot);

  let sectionHandles: { dispose(): void }[] = [];
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

  const paintGraph = (run: DagRunView): void => {
    const byId = new Map(run.nodes.map((node) => [node.id, node]));
    const columns = columnsForRun(run);
    const rows = Math.max(...columns.map((column) => column.length));
    const width = columns.length * (NODE_WIDTH + COLUMN_GAP) + COLUMN_GAP;
    const height = rows * (NODE_HEIGHT + ROW_GAP) + ROW_GAP;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': run.name,
    });
    svg.classList.add('dag-graph');
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
      svg.append(svgEl('line', {
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
      const pick = (): void => {
        selectedNodeId = id;
        paintContent(currentRuns);
      };
      group.addEventListener('click', pick);
      group.addEventListener('keydown', (event) => {
        if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          pick();
        }
      });
      svg.append(group);
    }
    content.append(svg);
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
    currentRuns = runs;
    if (runs.length === 0) {
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
  };

  // Paint one run list with the live indicator derived from its states.
  const paintRunList = (runs: DagRunView[]): void => {
    headerLive = runs.some((run) => run.status === 'running' || run.status === 'pending');
    paintFollowHeader();
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
    if (id !== hostSessionId || title !== hostTitle) {
      // A chat switch rebinds immediately: invalidate in-flight answers,
      // drop the previous graph, and show a spinner until fresh data lands.
      // A stale answer for the old conversation never paints over this.
      hostSessionId = id;
      hostTitle = title;
      refreshGen += 1;
      if (!keepStoredRunModel(runModelConversation, id)) {
        runModelDoc = null;
        runModelConversation = null;
      }
      selectedNodeId = null;
      lastSectionKey = null;
      headerLive = false;
      paintFollowHeader();
      clearSection();
      if (id !== null) {
        sectionHandles.push(mountSpinner(content, {}));
      } else {
        sectionHandles.push(mountEmpty(content, { title: strings.emptyTitle, body: strings.emptyBody }));
      }
    }
    void refresh();
  });

  // Host run-model posts carry the conversation they were built for. A post can
  // arrive before onSession binds that conversation (the host sends it from its
  // own effect), so it is kept; refreshRuns paints it only when its
  // conversation is the active one.
  void host.onRunModel((model) => {
    runModelDoc = model.snapshot;
    runModelConversation = model.conversationId;
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
