import { afterEach, beforeEach, expect, test } from 'bun:test';
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
  DocumentFragment: browser.DocumentFragment,
  Range: browser.Range,
  MutationObserver: browser.MutationObserver,
  ResizeObserver: browser.ResizeObserver,
  customElements: browser.customElements,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

globalThis.fetch = (async () => Response.json({ error: 'offline' }, { status: 503 })) as typeof fetch;

const { createRoot } = await import('react-dom/client');
const { I18nProvider } = await import('@/lib/i18n');
const { RuntimeAPIContext } = await import('@/contexts/runtimeAPIContext');
const { SyncProvider } = await import('@/sync/sync-context');
const { OpenCode } = await import('@opencode/client');
const { useConfigStore } = await import('@/stores/useConfigStore');
const { useAgentsStore } = await import('@/stores/useAgentsStore');
const { TodoSendDialog } = await import('./TodoSendDialog');
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

const host = document.createElement('div');
document.body.append(host);
let root: ReturnType<typeof createRoot> | null = null;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

let renders = 0;
const RenderCounter: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  renders += 1;
  return <>{children}</>;
};

const renderDialog = async () => {
  await act(async () => root?.render(
    <RuntimeAPIContext.Provider value={runtimeApis}>
      <SyncProvider sdk={sdk} directory="">
        <I18nProvider>
          <RenderCounter>
            <TodoSendDialog
              open
              onOpenChange={() => {}}
              target="session"
              projectDirectory="/fixture/chats"
              onConfirm={async () => {}}
            />
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
  useConfigStore.setState({
    providers: [],
    currentProviderId: '',
    currentModelId: '',
    currentVariant: '',
    currentAgentName: '',
  } as never);
  useAgentsStore.setState({ agents: [] } as never);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.innerHTML = '';
});

test('open send dialog with no providers settles instead of re-rendering forever', async () => {
  await renderDialog();
  expect(renders).toBeLessThan(50);
});

test('providers arriving late and missing the current model settle on a fallback', async () => {
  await renderDialog();
  const before = renders;
  useConfigStore.setState({
    providers: [{ id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }] }],
    currentProviderId: 'p1',
    currentModelId: 'missing-model',
  } as never);
  await settle();
  await settle();
  expect(renders - before).toBeLessThan(50);
});
