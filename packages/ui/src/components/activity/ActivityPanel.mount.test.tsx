import { afterAll, afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';

const browser = new Window({ url: 'http://runtime.test' });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  localStorage: browser.localStorage,
  sessionStorage: browser.sessionStorage,
  HTMLElement: browser.HTMLElement,
  Element: browser.Element,
  Node: browser.Node,
  Text: browser.Text,
  NodeList: browser.NodeList,
  HTMLButtonElement: browser.HTMLButtonElement,
  HTMLDivElement: browser.HTMLDivElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLTextAreaElement: browser.HTMLTextAreaElement,
  DocumentFragment: browser.DocumentFragment,
  Range: browser.Range,
  PointerEvent: browser.PointerEvent,
  ResizeObserver: browser.ResizeObserver,
  MutationObserver: browser.MutationObserver,
  customElements: browser.customElements,
  Event: browser.Event,
  CustomEvent: browser.CustomEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const originalFetch = globalThis.fetch;
// SAFETY: the stub implements the fetch subset the panel exercises (input URL
// plus init signal); the harness restores the original fetch in afterAll.
let snapshotStatus = 404;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input), 'http://runtime.test');
  if (url.pathname === '/api/run-graph/snapshot') {
    return Response.json({ error: snapshotStatus === 404 ? 'missing' : 'offline' }, { status: snapshotStatus });
  }
  return Response.json({ error: 'offline' }, { status: 503 });
}) as typeof fetch;

const { createRoot } = await import('react-dom/client');
const { I18nProvider } = await import('@/lib/i18n');
const { RuntimeAPIContext } = await import('@/contexts/runtimeAPIContext');
const { SyncProvider, useDirectoryStore } = await import('@/sync/sync-context');
const { OpenCode } = await import('@opencode/client');
const { ActivityPanel } = await import('./ActivityPanel');
import type { RuntimeAPIs } from '@/lib/api/types';
import type { State } from '@/sync/types';

const unavailable = (): never => { throw new Error('must not call runtime APIs'); };
const runtimeApis: RuntimeAPIs = {
  runtime: { platform: 'web', isDesktop: false, isVSCode: false },
  get terminal() { return unavailable(); },
  get git() { return unavailable(); },
  get files() { return unavailable(); },
  get settings() { return unavailable(); },
  get permissions() { return unavailable(); },
  get notifications() { return unavailable(); },
  get sourceControl() { return unavailable(); },
};
const sdk = OpenCode.make({
  baseUrl: 'http://runtime.test',
  fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
});

const host = document.createElement('div');
document.body.append(host);
let root: ReturnType<typeof createRoot> | null = null;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

let dirPatch: ((partial: Partial<State>) => void) | null = null;
let peekSessions: (() => number) | null = null;
const StoreGrabber: React.FC = () => {
  const store = useDirectoryStore('/fixture/chats');
  React.useEffect(() => {
    dirPatch = (partial: Partial<State>) => store.getState().patch(partial);
    peekSessions = () => store.getState().session.length;
  }, [store]);
  return null;
};

let renders = 0;
const patchStore = (partial: Partial<State>): void => {
  const patch = dirPatch;
  if (!patch) throw new Error('store not grabbed');
  patch(partial);
};
const resetStore = (status: State['status'] = 'loading', sessionListSource: State['sessionListSource'] = 'empty'): void => {
  patchStore({
    session: [],
    message: {},
    part: {},
    session_status: {},
    status,
    sessionListSource,
  });
};
const RenderCounter: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  renders += 1;
  return <>{children}</>;
};

const mount = async (conversationId: string | null = 'ses_parent01') => {
  root = createRoot(host);
  await act(async () => root?.render(
    <RuntimeAPIContext.Provider value={runtimeApis}>
      <SyncProvider sdk={sdk} directory="">
        <I18nProvider>
          <RenderCounter>
            <StoreGrabber />
            <ActivityPanel directory="/fixture/chats" conversationId={conversationId} conversationTitle="Repository analysis" />
          </RenderCounter>
        </I18nProvider>
      </SyncProvider>
    </RuntimeAPIContext.Provider>,
  ));
  await settle();
  await settle();
};

const rerenderPanel = async (conversationId: string | null, conversationTitle = 'Repository analysis') => {
  await act(async () => root?.render(
    <RuntimeAPIContext.Provider value={runtimeApis}>
      <SyncProvider sdk={sdk} directory="">
        <I18nProvider>
          <RenderCounter>
            <StoreGrabber />
            <ActivityPanel directory="/fixture/chats" conversationId={conversationId} conversationTitle={conversationTitle} />
          </RenderCounter>
        </I18nProvider>
      </SyncProvider>
    </RuntimeAPIContext.Provider>,
  ));
  await settle();
  await settle();
  await settle();
};

beforeEach(() => {
  renders = 0;
  dirPatch = null;
  snapshotStatus = 404;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.innerHTML = '';
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const seedLiveRun = () => {
  if (!dirPatch) throw new Error('store not grabbed');
  // SAFETY: the fixture states the store slices the panel reads; the harness never sends it anywhere.
  dirPatch({
    session: [
      {
        id: 'ses_parent01', projectID: 'proj_1', directory: '/fixture/chats',
        title: 'Repository analysis', cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1000, updated: 9000 },
      },
      {
        id: 'ses_child01', parentID: 'ses_parent01', projectID: 'proj_1', directory: '/fixture/chats',
        title: 'Analyze explore', agent: 'explore', cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2000, updated: 8000 },
      },
    ],
    session_status: {},
    message: {
      ses_parent01: [
        { id: 'm1', sessionID: 'ses_parent01', role: 'user', time: { created: 1100 } },
        { id: 'm2', sessionID: 'ses_parent01', role: 'assistant', time: { created: 1500, completed: 1600 }, agent: 'a', providerID: 'p', modelID: 'm' },
        {
          id: 'm3', sessionID: 'ses_parent01', role: 'synthetic', time: { created: 8500 },
          text: 'Found three callers.', description: 'Subagent ses_child01 finished',
          metadata: { source: 'subagent', childID: 'ses_child01', agent: 'explore', state: 'completed' },
        },
      ],
    },
    part: {
      m1: [{ id: 'p1', sessionID: 'ses_parent01', messageID: 'm1', type: 'text', text: 'Analyze the callers' }],
      m2: [{ id: 'p2', sessionID: 'ses_parent01', messageID: 'm2', type: 'text', text: 'Starting the analysis now' }],
    },
  } as never);
};

test('activity tab mount with an empty store settles instead of re-rendering forever', async () => {
  await mount();
  expect(renders).toBeLessThan(200);
});

test('activity tab mount with a live session settles instead of re-rendering forever', async () => {
  await mount();
  await act(async () => { seedLiveRun(); });
  await settle();
  await settle();
  expect(document.body.textContent).toContain('Repository analysis');
  expect(renders).toBeLessThan(200);
});

test('empty store shows loading while the directory boots', async () => {
  await mount();
  await act(async () => { resetStore(); });
  await settle();
  await settle();
  await settle();
  expect(document.body.textContent).toContain('Loading');
});

test('missing snapshot with no live rows shows the no-run state, not the error card', async () => {
  await mount();
  await act(async () => { resetStore('complete', 'empty'); });
  await settle();
  await settle();
  await settle();
  expect(document.body.textContent).toContain('no delegated tasks');
  expect(document.body.textContent).not.toContain('engine snapshot');
  const retry = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
  if (retry) throw new Error('retry button shown for a missing snapshot');
  expect(renders).toBeLessThan(200);
});

test('failing snapshot fetch with no live rows keeps the error with a retry path', async () => {
  snapshotStatus = 503;
  try {
    await mount();
    await act(async () => { resetStore('complete', 'empty'); });
    await settle();
    await settle();
    await settle();
    expect(document.body.textContent).toContain('engine snapshot');
    const retry = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    if (!retry) throw new Error('retry button missing');
    await act(async () => { retry.click(); });
    await settle();
    await settle();
    expect(document.body.textContent).toContain('engine snapshot');
    expect(renders).toBeLessThan(200);
  } finally {
    snapshotStatus = 404;
  }
});

test('task file association opens the dockable code graph at that file', async () => {
  await mount();
  await act(async () => {
    resetStore();
    // SAFETY: the fixture states the full store shape the panel reads; extra store fields stay unknown.
    patchStore({
      session: [
        {
          id: 'ses_parent01', projectID: 'proj_1', directory: '/fixture/chats',
          title: 'Repository analysis', cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1000, updated: 9000 },
        },
        {
          id: 'ses_child01', parentID: 'ses_parent01', projectID: 'proj_1', directory: '/fixture/chats',
          title: 'Analyze explore', agent: 'explore', cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 2000, updated: 8000 },
        },
      ],
      session_status: {},
      message: {
        ses_parent01: [
          { id: 'm1', sessionID: 'ses_parent01', role: 'user', time: { created: 1100 } },
          { id: 'm2', sessionID: 'ses_parent01', role: 'assistant', time: { created: 1500, completed: 1600 }, agent: 'a', providerID: 'p', modelID: 'm' },
          {
            id: 'm3', sessionID: 'ses_parent01', role: 'synthetic', time: { created: 8500 },
            text: 'Found three callers.', description: 'Subagent ses_child01 finished',
            metadata: { source: 'subagent', childID: 'ses_child01', agent: 'explore', state: 'completed' },
          },
        ],
        ses_child01: [
          { id: 'cm1', sessionID: 'ses_child01', role: 'assistant', time: { created: 3100, completed: 3200 }, agent: 'explore', providerID: 'p', modelID: 'm' },
        ],
      },
      part: {
        m1: [{ id: 'p1', sessionID: 'ses_parent01', messageID: 'm1', type: 'text', text: 'Analyze the callers' }],
        m2: [{ id: 'p2', sessionID: 'ses_parent01', messageID: 'm2', type: 'text', text: 'Starting the analysis now' }],
        cm1: [{
          id: 't1', sessionID: 'ses_child01', messageID: 'cm1', type: 'tool', callID: 'call_t1',
          tool: 'edit',
          state: { status: 'completed', input: { path: 'src/plan.ts' }, output: '', metadata: {}, time: { start: 3100, end: 3200 } },
        }],
      },
    } as never);
  });
  await settle();
  await settle();
  await settle();
  const task = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Analyze explore'));
  if (!task) throw new Error('task row missing');
  await act(async () => { task.click(); });
  await settle();
  expect(document.body.textContent).toContain('Related files');
  expect(document.body.textContent).toContain('src/plan.ts');
  expect(document.body.textContent).toContain('Explanation');
  expect(document.body.textContent).toContain('Objective');
  expect(document.body.textContent).toContain('No decision rationale recorded.');
  const file = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'src/plan.ts');
  if (!file) throw new Error('file link missing');
  const { useUIStore } = await import('@/stores/useUIStore');
  const openSpy = spyOn(useUIStore.getState(), 'openCodeGraphAt').mockImplementation(() => {});
  try {
    await act(async () => { file.click(); });
    await settle();
    // The panel hands the file to the one graph surface instead of mounting a
    // second graph of its own inside the activity pane.
    expect(openSpy.mock.calls[0]).toEqual(['/fixture/chats', 'src/plan.ts']);
    expect(document.querySelector('input[aria-label="Search symbols or files"]')).toBeNull();
  } finally {
    openSpy.mockRestore();
  }
});

const seedSecondRun = () => {
  if (!dirPatch) throw new Error('store not grabbed');
  // SAFETY: the fixture states the full store shape the panel reads; extra store fields stay unknown.
  dirPatch({
    session: [
      {
        id: 'ses_parent01', projectID: 'proj_1', directory: '/fixture/chats',
        title: 'Repository analysis', cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1000, updated: 9000 },
      },
      {
        id: 'ses_child01', parentID: 'ses_parent01', projectID: 'proj_1', directory: '/fixture/chats',
        title: 'Analyze explore', agent: 'explore', cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 2000, updated: 8000 },
      },
      {
        id: 'ses_parent02', projectID: 'proj_1', directory: '/fixture/chats',
        title: 'Second analysis', cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 10000, updated: 19000 },
      },
      {
        id: 'ses_child02', parentID: 'ses_parent02', projectID: 'proj_1', directory: '/fixture/chats',
        title: 'Analyze second', agent: 'explore', cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 11000, updated: 18000 },
      },
    ],
    session_status: {},
    message: {},
    part: {},
  } as never);
};

test('A to B to empty to A switching clears selection and never mixes content', async () => {
  await mount('ses_parent01');
  await act(async () => { resetStore(); seedSecondRun(); });
  await settle();
  await settle();
  const taskA = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Analyze explore'));
  if (!taskA) throw new Error('task A missing');
  await act(async () => { taskA.click(); });
  await settle();
  expect(taskA.getAttribute('aria-current')).toBe('true');
  await rerenderPanel('ses_parent02', 'Second analysis');
  expect(document.body.textContent).toContain('Second analysis');
  expect(document.body.textContent).not.toContain('Repository analysis');
  expect(document.body.textContent).toContain('Select a task');
  expect(Array.from(document.querySelectorAll('button')).filter((button) => button.getAttribute('aria-current') === 'true')).toHaveLength(0);
  await rerenderPanel(null);
  expect(document.body.textContent).toContain('Open a session');
  await rerenderPanel('ses_parent01');
  expect(document.body.textContent).toContain('Repository analysis');
  expect(document.body.textContent).not.toContain('Second analysis');
});

test('evidence-only panel keeps the run graph out and creates no sessions', async () => {
  await mount('ses_parent01');
  await act(async () => { resetStore(); seedSecondRun(); });
  await settle();
  await settle();
  if (!peekSessions) throw new Error('store not grabbed');
  expect(peekSessions()).toBe(4);
  const task = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Analyze explore'));
  if (!task) throw new Error('task missing');
  await act(async () => { task.click(); });
  await settle();
  // The run graph belongs to the DAG runs pane; this panel is evidence only.
  expect(document.querySelector('[role="application"]')).toBeNull();
  expect(task.getAttribute('aria-current')).toBe('true');
  // Selecting and scrolling touched no runtime API (they throw on use) and
  // left the session list exactly as seeded.
  expect(peekSessions()).toBe(4);
});

test('persisted session list is labeled stale next to live content', async () => {
  await mount();
  await act(async () => { resetStore('complete'); seedLiveRun(); patchStore({ sessionListSource: 'persisted' }); });
  await settle();
  await settle();
  expect(document.body.textContent).toContain('Stale');
  expect(document.body.textContent).toContain('Repository analysis');
});
