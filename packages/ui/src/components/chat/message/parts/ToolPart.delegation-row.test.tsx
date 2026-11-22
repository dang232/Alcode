import { act } from 'react';
import { expect, test } from 'bun:test';
import { plugin } from 'bun';
import { pathToFileURL } from 'node:url';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { OpenCode } from '@opencode/client';
import type { ToolPart as ToolPartData } from '@/lib/opencode/model';
import { SyncProvider } from '@/sync/sync-context';
import { I18nProvider } from '@/lib/i18n';
import { ThemeSystemContext, type ThemeContextValue } from '@/contexts/theme-system-context';
import { getDefaultTheme } from '@/lib/theme/themes';
import { useGuestsStore } from '@/lib/guests/store';
import { useDirectoryStore } from '@/stores/useDirectoryStore';

// Bun does not implement Vite's worker asset-query imports.
plugin({
  name: 'tool-guest-worker-url',
  setup(build) {
    build.onLoad({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, ({ path }) => ({
      contents: `export default ${JSON.stringify(pathToFileURL(path.split('?')[0]).href)};`,
      loader: 'js',
    }));
  },
});

const { default: ToolPart } = await import('./ToolPart');

const theme = getDefaultTheme(false);
const unexpected = (): never => { throw new Error('Rendering must not change the theme'); };
const themeContext: ThemeContextValue = {
  currentTheme: theme,
  availableThemes: [theme],
  setTheme: unexpected,
  customThemesLoading: false,
  reloadCustomThemes: unexpected,
  importTheme: unexpected,
  deleteImportedTheme: unexpected,
  customThemeIds: [],
  isSystemPreference: false,
  setSystemPreference: unexpected,
  themeMode: 'light',
  setThemeMode: unexpected,
  lightThemeId: theme.metadata.id,
  darkThemeId: getDefaultTheme(true).metadata.id,
  setLightThemePreference: unexpected,
  setDarkThemePreference: unexpected,
};

const part = (tool: string, input: Record<string, string>, output: string): ToolPartData => ({
  id: `${tool}-call`, sessionID: 'parent', messageID: 'parent-message',
  type: 'tool', tool, callID: `${tool}-call`,
  state: { status: 'completed', input, output, metadata: {}, time: { start: 1_000, end: 2_000 } },
});

const renderRow = async (toolPart: ToolPartData): Promise<string> => {
  const happyWindow = new Window({ url: 'http://localhost/' });
  const globals = {
    window: happyWindow,
    document: happyWindow.document,
    navigator: happyWindow.navigator,
    HTMLElement: happyWindow.HTMLElement,
    Element: happyWindow.Element,
    Node: happyWindow.Node,
    MutationObserver: happyWindow.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const sdk = OpenCode.make({
    baseUrl: 'http://localhost',
    fetch: async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
  });
  const previousDirectory = useDirectoryStore.getState().currentDirectory;
  try {
    useDirectoryStore.setState({ currentDirectory: '/workspace' });
    useGuestsStore.setState({ status: 'ready', guests: [], runtimeKey: 'test' });
    await act(async () => {
      root.render(
        <SyncProvider sdk={sdk} directory="/workspace">
          <I18nProvider>
            <ThemeSystemContext.Provider value={themeContext}>
              <ToolPart part={toolPart} isExpanded={false} isMobile={false} onToggle={() => {}} />
            </ThemeSystemContext.Provider>
          </I18nProvider>
        </SyncProvider>,
      );
    });
    return container.textContent ?? '';
  } finally {
    await act(async () => { root.unmount(); });
    useDirectoryStore.setState({ currentDirectory: previousDirectory });
    await happyWindow.happyDOM.abort();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
};

test('a delegated task row names itself and the work it was given', async () => {
  const text = await renderRow(part('task', { agent: 'explore', description: 'Capture refresh', prompt: 'Find it' }, 'started'));
  expect(text).toContain('Delegate Task');
  expect(text).toContain('Capture refresh');
});

test('a task read row names the child it reads', async () => {
  const text = await renderRow(part('task_output', { task_id: 'ses_e01e2d47fffeP4oxoWQjxVl94l' }, 'completed'));
  expect(text).toContain('Task Output');
  expect(text).toContain('ses_e01e2d47fffeP4oxoWQjxVl94l');
});

test('a watch row shows the command and the line it waits for', async () => {
  const text = await renderRow(part(
    'monitor',
    { command: 'bun run type-check:web', filter: 'TYPECHECK_OK', timeout_ms: '600000' },
    'accepted',
  ));
  expect(text).toContain('Watch Command');
  expect(text).toContain('bun run type-check:web · TYPECHECK_OK');
});
