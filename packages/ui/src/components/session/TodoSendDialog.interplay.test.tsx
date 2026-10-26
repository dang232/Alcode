import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
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
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

class TestEventSource {
  static CLOSED = 2;
  static instances: TestEventSource[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor() { TestEventSource.instances.push(this); }
  close() { this.readyState = TestEventSource.CLOSED; }
}
Object.defineProperty(globalThis, 'EventSource', { value: TestEventSource, configurable: true, writable: true });

type Todo = { id: string; text: string; completed: boolean; createdAt: number };
let todos: Todo[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), 'http://runtime.test');
  if (url.pathname.startsWith('/api/project-context/')) {
    if (init?.method === 'PATCH') return Response.json({ notes: [], todos, plans: [], sharedPlansDir: null });
    return Response.json({ notes: [], todos, plans: [], sharedPlansDir: null });
  }
  return Response.json({ error: 'offline' }, { status: 503 });
}) as typeof fetch;

const { createRoot } = await import('react-dom/client');
const { I18nProvider } = await import('@/lib/i18n');
const { RuntimeAPIContext } = await import('@/contexts/runtimeAPIContext');
const { SyncProvider } = await import('@/sync/sync-context');
const { OpenCode } = await import('@opencode/client');
const { useConfigStore } = await import('@/stores/useConfigStore');
const { useAgentsStore } = await import('@/stores/useAgentsStore');
const { useUIStore } = await import('@/stores/useUIStore');
const { useSessionUIStore } = await import('@/sync/session-ui-store');
const { useProjectContextStore } = await import('@/stores/useProjectContextStore');
const { subscribeAlcodeEvents } = await import('@/lib/alcodeEvents');
const { ProjectNotesTodoPanel } = await import('./project-context/ProjectNotesTodoPanel');
import type { RuntimeAPIs } from '@/lib/api/types';

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

const project = { id: 'chats', path: '/fixture/chats' };
const host = document.createElement('div');
document.body.append(host);
let root: ReturnType<typeof createRoot> | null = null;
let releaseStream = () => {};
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

let renders = 0;
const RenderCounter: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  renders += 1;
  return <>{children}</>;
};

const mount = async () => {
  root = createRoot(host);
  (globalThis as Record<string, unknown>).__todoSendDebug = host;
  await act(async () => root?.render(
    <RuntimeAPIContext.Provider value={runtimeApis}>
      <SyncProvider sdk={sdk} directory="">
        <I18nProvider>
          <RenderCounter>
            <ProjectNotesTodoPanel projectRef={project} visible />
          </RenderCounter>
        </I18nProvider>
      </SyncProvider>
    </RuntimeAPIContext.Provider>,
  ));
  await settle();
  await settle();
};

beforeEach(() => {
  renders = 0;
  todos = [{ id: 't1', text: 'Ship it', completed: false, createdAt: 1 }];
  TestEventSource.instances = [];
  useConfigStore.setState({
    providers: [],
    currentProviderId: '',
    currentModelId: '',
    currentVariant: '',
    currentAgentName: '',
  } as never);
  useAgentsStore.setState({ agents: [] } as never);
  useUIStore.setState({ projectContextTab: 'todos', isMobile: false });
  useSessionUIStore.setState({ currentSessionId: null, currentSessionDirectory: null });
  useProjectContextStore.getState().reset();
  releaseStream = subscribeAlcodeEvents(() => {});
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.innerHTML = '';
  document.body.innerHTML = '';
  document.body.append(host);
  releaseStream();
  useProjectContextStore.getState().reset();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await browser.happyDOM.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const openSendDialog = async () => {
  const sendButton = Array.from(host.querySelectorAll<HTMLElement>('button'))
    .find((element) => element.getAttribute('aria-label') === 'Send "Ship it"');
  if (!sendButton) throw new Error('Send button missing');
  await act(async () => { sendButton.click(); });
  await settle();
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((element) => element.textContent === 'Send to new session');
  if (!item) throw new Error('Send to new session item missing');
  await act(async () => { item.click(); });
  await settle();
  await settle();
  if (!document.body.textContent?.includes('Send to new session')) {
    throw new Error('Send dialog did not open');
  }
};

const fireEndpointChanged = (runtimeKey: string, apiBaseUrl: string) => browser.window.dispatchEvent(
  new browser.window.CustomEvent('alcode:runtime-endpoint-changed', {
    detail: { apiBaseUrl, previousApiBaseUrl: apiBaseUrl, runtimeKey, previousRuntimeKey: runtimeKey },
  }),
);

test('open send dialog with no providers settles instead of re-rendering forever', async () => {
  await mount();
  await openSendDialog();
  expect(renders).toBeLessThan(200);
});

test('endpoint switches while the send dialog is open settle instead of looping', async () => {
  await mount();
  await openSendDialog();
  const before = renders;
  await act(async () => {
    fireEndpointChanged('host:remote', 'https://remote.example');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
  await act(async () => {
    fireEndpointChanged('local', 'http://127.0.0.1:3001');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
  expect(renders - before).toBeLessThan(200);
});
