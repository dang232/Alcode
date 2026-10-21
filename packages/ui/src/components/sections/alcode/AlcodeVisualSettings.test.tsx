import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ThemeSystemProvider } from '@/contexts/ThemeSystemContext';
import { RuntimeAPIContext } from '@/contexts/runtimeAPIContext';
import type { RuntimeAPIs } from '@/lib/api/types';
import { I18nProvider } from '@/lib/i18n';
import { useSessionDisplayStore } from '@/stores/useSessionDisplayStore';
import { useUIStore } from '@/stores/useUIStore';

import { AlcodeVisualSettings } from './AlcodeVisualSettings';

// The PWA install-name field reads its initial value through the settings
// document; resolve to no document so the field shows the built-in default
// without touching the network.
const persistenceModule = await import('@/lib/persistence');
mock.module('@/lib/persistence', () => ({
  ...persistenceModule,
  loadDesktopSettings: async () => null,
}));

// SAFETY: This render path only reads the optional terminal methods, so no other runtime API can be called.
const runtimeAPIs = { terminal: {} } as RuntimeAPIs;

describe('AlcodeVisualSettings', () => {
  let windowInstance: Window;
  let host: HTMLDivElement;
  let root: Root;
  let initialAnimatedActivityIndicators: boolean;
  let globalDescriptors: Map<string, PropertyDescriptor | undefined>;

  const globalNames = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'localStorage', 'sessionStorage', 'IS_REACT_ACT_ENVIRONMENT'];

  beforeEach(() => {
    windowInstance = new Window();
    initialAnimatedActivityIndicators = useSessionDisplayStore.getState().animatedActivityIndicators;
    globalDescriptors = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      HTMLElement: windowInstance.HTMLElement,
      Element: windowInstance.Element,
      Node: windowInstance.Node,
      localStorage: windowInstance.localStorage,
      sessionStorage: windowInstance.sessionStorage,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    try {
      await act(async () => root.unmount());
    } finally {
      useSessionDisplayStore.setState({ animatedActivityIndicators: initialAnimatedActivityIndicators });
      windowInstance.close();
      for (const [name, descriptor] of globalDescriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });

  test('renders session activity when it is the only visible setting', async () => {
    await act(async () => root.render(
      <RuntimeAPIContext.Provider value={runtimeAPIs}>
        <ThemeSystemProvider>
          <I18nProvider>
            <AlcodeVisualSettings visibleSettings={['animatedActivityIndicators']} />
          </I18nProvider>
        </ThemeSystemProvider>
      </RuntimeAPIContext.Provider>,
    ));

    expect(host.querySelector('[data-settings-item="appearance.session-activity"]')).not.toBeNull();
  });

  test('the existing large-paste radios select the fourth persisted choice', async () => {
    await act(async () => root.render(
      <RuntimeAPIContext.Provider value={runtimeAPIs}>
        <ThemeSystemProvider>
          <I18nProvider>
            <AlcodeVisualSettings visibleSettings={['largeTextPaste']} />
          </I18nProvider>
        </ThemeSystemProvider>
      </RuntimeAPIContext.Provider>,
    ));
    const group = host.querySelector('[data-settings-item="chat.large-text-paste"]');
    expect(group).not.toBeNull();
    const radios = group?.querySelectorAll<HTMLElement>('[role="radio"]');
    expect(radios?.length).toBe(4);
    const fourth = radios?.[3];
    if (!fourth) throw new Error('Missing fourth paste choice');
    expect(fourth.getAttribute('aria-label')).toBe('Large text paste: Paste inline, double-paste to attach');
    await act(async () => fourth.click());
    expect(useUIStore.getState().largeTextPasteBehavior).toBe('inline-double-paste');
    expect(fourth.getAttribute('aria-checked')).toBe('true');
  });

  test('the PWA install-name field defaults to Alcode', async () => {
    await act(async () => root.render(
      <RuntimeAPIContext.Provider value={runtimeAPIs}>
        <ThemeSystemProvider>
          <I18nProvider>
            <AlcodeVisualSettings visibleSettings={['pwaInstallName']} />
          </I18nProvider>
        </ThemeSystemProvider>
      </RuntimeAPIContext.Provider>,
    ));

    const field = host.querySelector('[data-settings-item="appearance.pwa-install-name"] input');
    expect(field).not.toBeNull();
    expect((field as HTMLInputElement).value).toBe('Alcode');
  });
});
