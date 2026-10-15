import { describe, expect, it, vi } from 'vitest';

import { createStartupPipelineRuntime } from './startup-pipeline-runtime.js';

describe('startup pipeline runtime', () => {
  it('publishes the listening port before bootstrapping managed OpenCode', async () => {
    const order = [];
    const runtime = createStartupPipelineRuntime({
      createTerminalRuntime: () => ({}),
      createDictationRuntime: () => ({}),
      createMessageStreamWsRuntime: () => ({}),
      createServerStartupRuntime: () => ({
        resolveBindHost: () => '127.0.0.1',
        startListeningAndMaybeTunnel: async () => {
          order.push('listen');
          return { activePort: 3901 };
        },
        attachProcessHandlers: vi.fn(),
      }),
      startDesktopCallbackListener: async () => {
        order.push('callback');
        return { skipped: false, server: null, port: 57123, stop: async () => {} };
      },
    });

    await runtime.run({
      app: {},
      setupProxy: vi.fn(),
      staticRoutesRuntime: { registerStaticRoutes: vi.fn() },
      apiOnly: false,
      tunnelRuntimeContext: {
        setActivePort: (port) => order.push(`port:${port}`),
      },
      scheduleOpenCodeApiDetection: () => order.push('detect'),
      bootstrapOpenCodeAtStartup: () => order.push('bootstrap'),
      process: {},
      crypto: {},
      server: { once: vi.fn() },
      registerDesktopGoogleCallbackRoute: vi.fn(),
      attachSignals: false,
    });

    expect(order).toEqual(['listen', 'port:3901', 'callback', 'detect', 'bootstrap']);
  });

  it('skips the dedicated callback listener when the QA escape hatch is set', async () => {
    const order = [];
    const starter = vi.fn(async () => {
      order.push('callback');
      return { skipped: false, server: null, port: 57123, stop: async () => {} };
    });
    const runtime = createStartupPipelineRuntime({
      createTerminalRuntime: () => ({}),
      createDictationRuntime: () => ({}),
      createMessageStreamWsRuntime: () => ({}),
      createServerStartupRuntime: () => ({
        resolveBindHost: () => '127.0.0.1',
        startListeningAndMaybeTunnel: async () => {
          order.push('listen');
          return { activePort: 3901 };
        },
        attachProcessHandlers: vi.fn(),
      }),
      startDesktopCallbackListener: starter,
      skipDesktopCallbackListener: true,
    });

    const result = await runtime.run({
      app: {},
      setupProxy: vi.fn(),
      staticRoutesRuntime: { registerStaticRoutes: vi.fn() },
      apiOnly: false,
      tunnelRuntimeContext: {
        setActivePort: (port) => order.push(`port:${port}`),
      },
      scheduleOpenCodeApiDetection: () => order.push('detect'),
      bootstrapOpenCodeAtStartup: () => order.push('bootstrap'),
      process: {},
      crypto: {},
      server: { once: vi.fn() },
      registerDesktopGoogleCallbackRoute: vi.fn(),
      attachSignals: false,
    });

    expect(starter).not.toHaveBeenCalled();
    expect(order).toEqual(['listen', 'port:3901', 'detect', 'bootstrap']);
    expect(result.desktopCallbackListener).toMatchObject({ skipped: true });
  });
});
