import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTerminalStore } from '@/stores/useTerminalStore';

const touchCalls: string[][] = [];
const terminal = {
  touchSessions: async (sessionIds: string[]) => { touchCalls.push(sessionIds); },
};
mock.module('@/hooks/useRuntimeAPIs', () => ({ useRuntimeAPIs: () => ({ terminal }) }));
const { useTerminalSessionKeepalive } = await import('./useTerminalSessionKeepalive');
const HookHarness = () => { useTerminalSessionKeepalive(); return null; };

describe('terminal keepalive hidden-tab guard', () => {
  let windowInstance: Window;
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    windowInstance = new Window({ url: 'http://localhost/' });
    Object.assign(globalThis, { window: windowInstance, document: windowInstance.document, navigator: windowInstance.navigator, HTMLElement: windowInstance.HTMLElement, Element: windowInstance.Element, Node: windowInstance.Node, Event: windowInstance.Event, IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    touchCalls.length = 0;
    useTerminalStore.getState().clearAll();
    const tab = useTerminalStore.getState().createTab('/repo');
    useTerminalStore.getState().setTabSessionId('/repo', tab, 's1');
    useTerminalStore.getState().setTabLifecycle('/repo', tab, 'running');
  });
  afterEach(async () => { await act(async () => root.unmount()); useTerminalStore.getState().clearAll(); });
  test('skips sweep while document.hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await act(async () => { root.render(React.createElement(HookHarness)); });
    expect(touchCalls).toEqual([]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
});
