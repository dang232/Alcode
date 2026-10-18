import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import { plugin } from 'bun';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let browser: Window;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let fetchSpy: ReturnType<typeof spyOn>;
const assignBrowserGlobals = (next: Window) => {
  Object.assign(globalThis, {
    window: next, document: next.document, navigator: next.navigator, localStorage: next.localStorage,
    Node: next.Node, Element: next.Element, HTMLElement: next.HTMLElement,
    HTMLInputElement: next.HTMLInputElement, HTMLTextAreaElement: next.HTMLTextAreaElement,
    Event: next.Event, FocusEvent: next.FocusEvent, CustomEvent: next.CustomEvent,
    MutationObserver: next.MutationObserver, ResizeObserver: next.ResizeObserver,
    getComputedStyle: next.getComputedStyle.bind(next),
    requestAnimationFrame: next.requestAnimationFrame.bind(next),
    cancelAnimationFrame: next.cancelAnimationFrame.bind(next), IS_REACT_ACT_ENVIRONMENT: true,
  });
};
// Module-evaluation order: dynamic imports below run before any hook, so
// globals must exist at load time exactly as before; each test then gets a
// fresh window/container/root for isolation.
assignBrowserGlobals(new Window({ url: 'http://localhost/' }));
beforeEach(() => {
  browser = new Window({ url: 'http://localhost/' });
  assignBrowserGlobals(browser);
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    return Response.json(url.includes('/config/mcp') ? [] : { home: '/test' });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { I18nProvider } = await import('@/lib/i18n');
const { useAgentsStore } = await import('@/stores/useAgentsStore');
plugin({
  name: 'agent-settings-provider-logos',
  setup(build) {
    build.onLoad({ filter: /useProviderLogo\.ts$/ }, ({ path }) => {
      const directory = resolve(dirname(path), '../assets/provider-logos');
      const logos = Object.fromEntries(readdirSync(directory).filter((name) => name.endsWith('.svg')).map((name) => [
        `../assets/provider-logos/${name}`, pathToFileURL(resolve(directory, name)).href,
      ]));
      return { contents: readFileSync(path, 'utf8').replace(/import\.meta\.glob<string>\([\s\S]*?\);/, `${JSON.stringify(logos)};`), loader: 'ts' };
    });
  },
});
const { AgentsPage } = await import('./AgentsPage');
afterEach(async () => { await act(async () => root.unmount()); fetchSpy.mockRestore(); browser.close(); container.remove(); });

test('an agent catalog refresh during save preserves the newer blurred draft', async () => {
  let system = 'initial';
  const writes: Array<{ value: string; finish: () => void }> = [];
  const agent = { id: 'test', name: 'test', displayName: 'Test', mode: 'subagent' as const,
    request: { settings: {}, headers: {}, body: {} }, hidden: false, permissions: [] };
  useAgentsStore.setState({
    selectedAgentName: 'test', agentsByDirectory: { __default__: [agent] },
    getAgentByName: () => useAgentsStore.getState().agentsByDirectory.__default__?.[0] ?? null,
    fetchAgentEntity: async () => ({ source: 'json', scope: 'user', path: '/config.json', legacy: false, config: { system } }),
    fetchAgentPermissions: async () => ({ global: [], agent: [], effective: [], source: 'json', path: '/config.json' }),
    updateAgent: async (_name, config) => new Promise((resolve) => {
      writes.push({ value: config.system ?? '', finish: () => resolve({ ok: true }) });
    }),
  });
  await act(async () => { root.render(<I18nProvider><AgentsPage /></I18nProvider>); });
  const field = [...container.querySelectorAll<HTMLTextAreaElement>('textarea')].find((entry) => entry.value === 'initial');
  if (!field) throw new Error('Missing agent system field');
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('Missing textarea setter');
  const edit = async (value: string) => {
    await act(async () => { setValue.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  };
  await edit('older');
  await edit('newer');
  expect(writes.map((write) => write.value)).toEqual(['older']);
  await act(async () => {
    system = 'older';
    useAgentsStore.setState({ agentsByDirectory: { __default__: [{ ...agent, system }] } });
  });
  expect(field.value).toBe('newer');
  await act(async () => { writes[0].finish(); });
  expect(writes.map((write) => write.value)).toEqual(['older', 'newer']);
  await act(async () => {
    useAgentsStore.setState({ agentsByDirectory: { __default__: [{ ...agent, system }] } });
  });
  expect(field.value).toBe('newer');
  await act(async () => {
    useAgentsStore.setState({ selectedAgentName: 'other', agentsByDirectory: { __default__: [{ ...agent, name: 'other' }] } });
  });
  expect(field.value).toBe('older');
  await act(async () => { writes[1].finish(); });
});

test('bundled catalog instructions stay collapsed until expanded', async () => {
  const prompt = 'READ-ONLY research instructions';
  useAgentsStore.setState({
    selectedAgentName: 'librarian',
    agentDraft: null,
    agentsByDirectory: { __default__: [] },
    omoCatalog: [{ id: 'librarian', kind: 'agent', description: 'Docs research', source: 'omo-compatible', edition: 'senpi', fallback: ['librarian', 'explore'], prompt }],
    getAgentByName: () => undefined,
  });
  await act(async () => { root.render(<I18nProvider><AgentsPage /></I18nProvider>); });
  const trigger = [...container.querySelectorAll('button')].find((entry) => entry.textContent?.includes('Instructions'));
  if (!trigger) throw new Error('Missing instructions expander');
  if (trigger.getAttribute('aria-expanded') !== 'false') throw new Error('Instructions expanded by default');
  await act(async () => { trigger.dispatchEvent(new Event('click', { bubbles: true })); });
  if (trigger.getAttribute('aria-expanded') !== 'true') throw new Error('Instructions not expanded on demand');
  if (container.querySelector('pre')?.textContent !== prompt) throw new Error('Instructions body missing after expand');
});
