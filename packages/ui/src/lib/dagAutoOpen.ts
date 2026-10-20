/**
 * Auto-opening the DAG runs pane when a ulw run starts.
 *
 * There is no UI-side ulw command: the engine's ultrawork hook starts the
 * loop when the user prompt contains `ultrawork` or `ulw` (word-bounded,
 * case-insensitive). The composer send is the only UI-observable edge of
 * that start, so the send path reveals the pane on those prompts — once per
 * send, never on render. The DAG pane is desktop-only, so this stays a
 * no-op outside the Electron shell.
 */

import { isDesktopShell } from '@/lib/desktop';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';

/** The context-panel mode of the built-in DAG runs pane. */
export const DAG_PANE_SURFACE_MODE = 'plugin:alcode-builtin-dag-pane';

/**
 * Whether the sent text starts a ulw run. Mirrors the engine trigger: shell
 * input never reaches the model hook, so it never counts.
 */
export const isUlvRunPrompt = (content: string, inputMode?: 'normal' | 'shell'): boolean => {
  if (inputMode === 'shell') return false;
  return /\b(ultrawork|ulw)\b/i.test(content ?? '');
};

export type DagAutoOpenOptions = {
  inputMode?: 'normal' | 'shell';
  /** Override for the desktop-shell check; defaults to isDesktopShell(). */
  desktop?: boolean;
};

/**
 * Reveal the DAG pane for a ulw run start, or do nothing when the send is
 * not one. Toggle-safe: openContextSurface closes the panel when the
 * requested mode is already active and visible, so that state returns
 * early — otherwise the second ulw send would shut the pane it opened.
 */
export const revealDagPaneForUlvStart = (
  content: string,
  directory: string | null | undefined,
  options: DagAutoOpenOptions = {},
): void => {
  if (!isUlvRunPrompt(content, options.inputMode)) return;
  const trimmedDirectory = (directory ?? '').trim();
  if (!trimmedDirectory) return;
  if (!(options.desktop ?? isDesktopShell())) return;
  const uiState = useUIStore.getState();
  const panel = uiState.contextPanelByDirectory[normalizeContextPanelDirectoryKey(trimmedDirectory)];
  const activeTab = panel?.tabs.find((tab) => tab.id === panel?.activeTabId) ?? null;
  if (panel?.isOpen && activeTab?.mode === DAG_PANE_SURFACE_MODE) return;
  uiState.openContextSurface(trimmedDirectory, DAG_PANE_SURFACE_MODE);
};
