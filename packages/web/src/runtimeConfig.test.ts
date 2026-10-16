import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@alcode/ui/lib/runtime-auth', () => ({
  getRuntimeBearerTokenSync: vi.fn(() => ''),
  getRuntimeExtraHeadersSync: vi.fn(() => ({})),
  refreshLocalRuntimeUrlAuthToken: vi.fn(() => Promise.resolve()),
  refreshRuntimeUrlAuthToken: vi.fn(() => Promise.resolve()),
  setRuntimeBearerToken: vi.fn(),
  setRuntimeExtraHeaders: vi.fn(),
}));
vi.mock('@alcode/ui/lib/runtime-fetch', () => ({ installRuntimeFetchBridge: vi.fn() }));
vi.mock('@alcode/ui/lib/runtime-switch', () => ({
  getRuntimeApiBaseUrl: vi.fn(() => ''),
  getRuntimeKey: vi.fn(() => 'local'),
  initializeRuntimeEndpoint: vi.fn(),
  switchRuntimeEndpoint: vi.fn(),
}));
vi.mock('@alcode/ui/lib/desktopRelayRestore', () => ({ restoreDesktopRelayRuntime: vi.fn(() => Promise.resolve()) }));
vi.mock('@alcode/ui/lib/runtime-url', () => ({ configureRuntimeUrlResolver: vi.fn(() => ({})) }));
vi.mock('@alcode/ui/lib/opencode/client', () => ({ opencodeClient: { reconnectToRuntimeBaseUrl: vi.fn() } }));
vi.mock('./api', () => ({ createWebAPIs: vi.fn() }));

import { initializeRuntimeEndpoint } from '@alcode/ui/lib/runtime-switch';
import { createConfiguredWebAPIs, readRuntimeBootstrapConfig } from './runtimeConfig';

const originalWindow = globalThis.window;

const installWindow = (value: Record<string, unknown>) => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
  });
};

const makeWindow = (search = ''): Record<string, unknown> => {
  const value: Record<string, unknown> = {
    location: { origin: 'alcode-ui://app', search },
    setTimeout: vi.fn(() => 1),
  };
  value.parent = value;
  return value;
};

beforeEach(() => {
  vi.clearAllMocks();
  installWindow(makeWindow());
});

afterAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('readRuntimeBootstrapConfig', () => {
  test('reads the runtime injected into the current window', () => {
    const current = makeWindow();
    current.__ALCODE_API_BASE_URL__ = ' https://remote.example.com ';
    current.__ALCODE_CLIENT_TOKEN__ = ' remote-token ';
    current.__ALCODE_LOCAL_ORIGIN__ = ' http://127.0.0.1:3000 ';
    current.__ALCODE_RUNTIME_HEADERS__ = { 'x-alcode-relay': 'relay-value' };
    current.__ALCODE_RELAY_HOST_ID__ = ' remote-host ';
    installWindow(current);

    expect(readRuntimeBootstrapConfig()).toEqual({
      apiBaseUrl: 'https://remote.example.com',
      clientToken: 'remote-token',
      localOrigin: 'http://127.0.0.1:3000',
      runtimeHeaders: { 'x-alcode-relay': 'relay-value' },
      relayHostId: 'remote-host',
    });
  });

  test('does not read runtime credentials directly from a parent window', () => {
    const parent = makeWindow();
    parent.__ALCODE_API_BASE_URL__ = 'https://remote.example.com';
    parent.__ALCODE_CLIENT_TOKEN__ = 'remote-token';
    const child = makeWindow();
    child.parent = parent;
    installWindow(child);

    expect(readRuntimeBootstrapConfig()).toEqual({
      apiBaseUrl: '',
      clientToken: '',
      localOrigin: '',
      runtimeHeaders: undefined,
      relayHostId: '',
    });
  });
});

describe('createConfiguredWebAPIs', () => {
  test('uses the configured desktop host id across changing SSH tunnel URLs', () => {
    const current = makeWindow();
    current.__ALCODE_DESKTOP_BOOT_OUTCOME__ = {
      target: 'remote',
      status: 'ok',
      hostId: 'ssh-castle',
      url: 'http://127.0.0.1:62545',
      localAvailable: true,
    };
    current.__ALCODE_API_BASE_URL__ = 'http://127.0.0.1:62545';
    current.__ALCODE_LOCAL_ORIGIN__ = 'http://127.0.0.1:3901';
    installWindow(current);

    createConfiguredWebAPIs();

    expect(initializeRuntimeEndpoint).toHaveBeenCalledWith({
      apiBaseUrl: 'http://127.0.0.1:62545',
      runtimeKey: 'host:ssh-castle',
    });
  });
});
