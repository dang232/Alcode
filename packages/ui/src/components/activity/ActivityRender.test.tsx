import { Window } from 'happy-dom';
import { afterEach, describe, expect, test } from 'bun:test';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLButtonElement: browser.HTMLButtonElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent,
  MutationObserver: browser.MutationObserver, ResizeObserver: browser.ResizeObserver,
  MouseEvent: browser.MouseEvent, PointerEvent: browser.PointerEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
import type { Root } from 'react-dom/client';
const { I18nProvider } = await import('@/lib/i18n');
const { buildDagRunModel } = await import('@/lib/dagRunModel');
const { buildActivityTree, buildInspectorSummaries, buildInspectorTimeline, buildRepairView, buildRunGraph } = await import('./activityModel');
const { RunGraphView } = await import('./RunGraph');
const { TaskExplorer } = await import('./TaskExplorer');
const { TaskInspector } = await import('./TaskInspector');
import type { Message, Part, Session, SyntheticMessage, TextPart } from '@/lib/opencode/model';
import type { RepairBlock } from '@/lib/runGraphApi';

let roots: Root[] = [];
afterEach(() => {
  act(() => { for (const root of roots) root.unmount(); });
  roots = [];
});

const render = (node: React.ReactNode): HTMLElement => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    const root = createRoot(host);
    roots.push(root);
    root.render(<I18nProvider>{node}</I18nProvider>);
  });
  return host;
};

const parent = (): Session => ({
  id: 'ses_parent01', projectID: 'proj_1', directory: '/tmp/proj',
  title: 'Repository analysis', cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1000, updated: 9000 },
});

const childSession = (id: string): Session => ({
  id, parentID: 'ses_parent01', projectID: 'proj_1', directory: '/tmp/proj',
  title: `Analyze ${id}`, agent: 'explore', cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 2000, updated: 8000 },
});

const report = (id: string, childId: string, output: string): SyntheticMessage => ({
  id, sessionID: 'ses_parent01', role: 'synthetic', time: { created: 8500 }, text: output,
  description: `Subagent ${childId} finished`,
  metadata: { source: 'subagent', childID: childId, agent: 'explore', state: 'completed' },
});

const assistantMessage = (id: string): Message => ({
  id, sessionID: 'ses_parent01', role: 'assistant', time: { created: 1500, completed: 1600 },
  agent: 'a', providerID: 'p', modelID: 'm',
});

const textPart = (id: string, messageId: string, text: string): TextPart => (
  { id, sessionID: 'ses_parent01', messageID: messageId, type: 'text', text }
);

const fixture = () => {
  const messages: Message[] = [
    { id: 'm1', sessionID: 'ses_parent01', role: 'user', time: { created: 1100 } },
    assistantMessage('m2'),
    report('m3', 'ses_child01', 'Found three callers.'),
  ];
  const parts = {
    m1: [textPart('p1', 'm1', 'Analyze the callers')],
    m2: [textPart('p2', 'm2', 'Starting the analysis now')],
  } satisfies Record<string, Part[]>;
  const model = buildDagRunModel({
    conversationId: 'ses_parent01',
    sessions: [parent(), childSession('ses_child01')],
    statuses: {},
    messages,
    parts,
  });
  if (!model) throw new Error('fixture must build a model');
  return { model, messages, parts };
};

describe('activity rendering through real model output', () => {
  test('explorer lists the session, the task, and synthesis with real titles', () => {
    const { model } = fixture();
    const el = render(<TaskExplorer rows={buildActivityTree(model)} selectedId={null} onSelect={() => undefined} />);
    expect(el.textContent).toContain('Repository analysis');
    expect(el.textContent).toContain('Analyze ses_child01');
    expect(el.textContent).toContain('Synthesis');
    expect(el.textContent).toContain('Completed');
  });

  test('completed rows name verification, defaulting to unverified', () => {
    const { model } = fixture();
    const el = render(<TaskExplorer rows={buildActivityTree(model)} selectedId={null} onSelect={() => undefined} />);
    expect(el.textContent).toContain('Completed · Unverified');
    expect(el.textContent).not.toContain('Verified ·');
  });

  test('run graph renders nodes, edges, legend, and selection', () => {
    const { model } = fixture();
    let selected: string | null = null;
    const graph = buildRunGraph(model);
    if (!graph) throw new Error('fixture must build a graph');
    const el = render(<RunGraphView graph={graph} selectedId="ses_child01" onSelect={(id) => { selected = id; }} />);
    expect(el.textContent).toContain('Repository analysis');
    expect(el.textContent).toContain('Synthesis');
    expect(el.textContent).toContain('Fit');
    const node = Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.includes('Analyze ses_child01'));
    act(() => { node?.click(); });
    expect(selected).toBe('ses_child01');
  });

  test('inspector separates summaries from the timeline with receipt ids', () => {
    const { model, messages, parts } = fixture();
    const el = render(
      <TaskInspector
        selectedLabel="Analyze ses_child01"
        events={buildInspectorTimeline({ model, messages, parts, selectedId: 'ses_child01' })}
        summaries={buildInspectorSummaries({ model, messages, parts, selectedId: 'ses_child01' })}
        files={[]}
        onOpenFile={() => undefined}
        card={null}
      />,
    );
    expect(el.textContent).toContain('Subagent result');
    expect(el.textContent).not.toContain('Model progress update');
    expect(el.textContent).toContain('Found three callers.');
    expect(el.textContent).toContain('m3');
    expect(el.textContent).toContain('Settled: completed');
  });

  test('inspector is honest when nothing is selected', () => {
    const el = render(<TaskInspector selectedLabel={null} events={[]} summaries={[]} files={[]} onOpenFile={() => undefined} card={null} />);
    expect(el.textContent).toContain('Select a task');
  });
});

const repairBlock = (overrides: Partial<RepairBlock> = {}): RepairBlock => ({
  attemptId: 'st_a.e2.r1',
  taskId: 'st_a',
  epoch: 2,
  state: 'repaired',
  failedChecks: ['typecheck'],
  rerunChecks: ['typecheck'],
  changedFiles: ['src/a.ts'],
  verificationStatus: 'verified',
  hostFacts: ['The workspace has no uncommitted changes.'],
  modelHypotheses: ['The failure came from a stale cache.'],
  updatedAt: 2,
  ...overrides,
});

const renderRepair = (blocks: RepairBlock[]): HTMLElement => render(
  <TaskInspector
    selectedLabel="Repair task"
    events={[]}
    summaries={[]}
    files={[]}
    onOpenFile={() => undefined}
    card={null}
    repair={buildRepairView(blocks)}
  />,
);

describe('repair lifecycle rendering', () => {
  test('diagnosing, re-verifying and the gate verdict render as distinct rows', () => {
    const el = renderRepair([repairBlock()]);
    const diagnosing = el.querySelector('[data-repair-row="diagnosing"]');
    const reverifying = el.querySelector('[data-repair-row="reverifying"]');
    const verification = el.querySelector('[data-repair-verification="verified"]');
    if (!diagnosing || !reverifying || !verification) throw new Error('repair rows missing');
    expect(diagnosing.textContent).toContain('Diagnosing');
    expect(reverifying.textContent).toContain('Re-verifying');
    expect(verification.textContent).toContain('Verified');
    expect(new Set([diagnosing, reverifying, verification]).size).toBe(3);
  });

  test('a repaired attempt with a blocked gate renders blocked, never verified', () => {
    const el = renderRepair([repairBlock({ verificationStatus: 'blocked' })]);
    const gate = el.querySelector('[data-repair-verification="blocked"]');
    if (!gate) throw new Error('blocked gate row missing');
    expect(gate.textContent).toContain('Blocked');
    expect(el.textContent?.toLowerCase() ?? '').not.toContain('verified');
  });

  test('a stale epoch attempt never renders as current', () => {
    const stale = repairBlock({
      attemptId: 'st_a.e1.r1',
      epoch: 1,
      failedChecks: ['stale-check'],
      verificationStatus: 'verified',
    });
    const current = repairBlock({
      attemptId: 'st_a.e2.r1',
      epoch: 2,
      state: 'diagnosing',
      failedChecks: ['current-check'],
      rerunChecks: [],
      changedFiles: [],
      verificationStatus: null,
    });
    const el = renderRepair([current, stale]);
    expect(el.querySelector('[data-repair-attempt="st_a.e2.r1"]')).not.toBeNull();
    expect(el.querySelector('[data-repair-row="diagnosing"]')?.getAttribute('data-repair-current')).toBe('true');
    expect(el.textContent).toContain('current-check');
    expect(el.textContent).not.toContain('stale-check');
    expect(el.textContent).not.toContain('Repaired');
  });

  test('duplicate lifecycle events produce one row, not two', () => {
    const repeated = repairBlock({ state: 'reverifying' });
    const el = renderRepair([repeated, repeated, { ...repeated, updatedAt: 99 }]);
    expect(el.querySelectorAll('[data-repair-row="reverifying"]')).toHaveLength(1);
    expect(el.querySelectorAll('[data-repair-row]')).toHaveLength(4);
  });
});
