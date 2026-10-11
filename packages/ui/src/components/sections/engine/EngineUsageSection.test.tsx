import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { opencodeClient } from '@/lib/opencode/client';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';
import type { EngineSessionSummary } from '@/lib/engine/engineSessionStats';
import { EngineUsageSection, EngineUsageSectionView, type EngineUsageLoad } from './EngineUsageSection';

let root: Root;
let host: HTMLDivElement;
let restoreGlobals: () => void;
const previousResolver = getRuntimeUrlResolver();

// Fresh fixture per state: nothing is shared between cases.
const summaryFixture = (): EngineSessionSummary => ({
  sessions: 2,
  prompts: 5,
  steps: 9,
  tokens: { input: 10, output: 2, reasoning: 1, cacheRead: 3, cacheWrite: 4, total: 20 },
  cost: 1.25,
});

const wireFixture = () => ({
  range: { from: 1_000, to: 2_000 },
  sessions: 2,
  subagents: 1,
  prompts: 5,
  steps: 9,
  tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 4 } },
  cost: 1.25,
  tools: { mode: 'none' },
  activeDays: 2,
  streak: 2,
  activity: [{ date: '2026-09-01', steps: 4 }],
  models: [],
});

const marker = () => {
  const node = host.querySelector('[data-testid="engine-usage"]');
  expect(node).not.toBeNull();
  return node!;
};

beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://engine-usage.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
  const dom = new Window({ url: 'http://localhost' });
  const globals = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, globals);
  restoreGlobals = () => {
    for (const key of Object.keys(globals)) {
      const descriptor = descriptors[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  restoreGlobals();
  setRuntimeUrlResolver(previousResolver);
  opencodeClient.reconnectToRuntimeBaseUrl();
});

const renderView = (node: React.ReactNode) => act(async () => {
  root.render(<I18nProvider>{node}</I18nProvider>);
});

describe('EngineUsageSectionView states', () => {
  test('loading renders the loading marker and no values', async () => {
    await renderView(<EngineUsageSectionView load={{ state: 'loading' }} onRefresh={() => {}} refreshing={false} />);
    expect(marker().getAttribute('data-state')).toBe('loading');
    expect(marker().hasAttribute('data-error')).toBe(false);
    expect(host.querySelector('[data-sessions]')).toBeNull();
  });

  test('unreachable backend renders the degraded marker, never a blank tab', async () => {
    const load: EngineUsageLoad = { state: 'unreachable' };
    await renderView(<EngineUsageSectionView load={load} onRefresh={() => {}} refreshing={false} />);
    expect(marker().getAttribute('data-state')).toBe('degraded');
    expect(marker().getAttribute('data-error')).toBe('unreachable');
    expect(host.querySelector('button')).not.toBeNull();
    expect(host.querySelector('[data-sessions]')).toBeNull();
  });

  test('malformed payload renders the degraded marker with its own error', async () => {
    const load: EngineUsageLoad = { state: 'malformed' };
    await renderView(<EngineUsageSectionView load={load} onRefresh={() => {}} refreshing={false} />);
    expect(marker().getAttribute('data-state')).toBe('degraded');
    expect(marker().getAttribute('data-error')).toBe('malformed');
    expect(host.querySelector('button')).not.toBeNull();
  });

  test('populated renders live values on machine markers', async () => {
    await renderView(
      <EngineUsageSectionView load={{ state: 'populated', summary: summaryFixture() }} onRefresh={() => {}} refreshing={false} />,
    );
    expect(marker().getAttribute('data-state')).toBe('populated');
    expect(marker().hasAttribute('data-error')).toBe(false);
    expect(host.querySelector('[data-sessions]')?.getAttribute('data-sessions')).toBe('2');
    expect(host.querySelector('[data-prompts]')?.getAttribute('data-prompts')).toBe('5');
    expect(host.querySelector('[data-tokens]')?.getAttribute('data-tokens')).toBe('20');
    expect(host.querySelector('[data-cost]')?.getAttribute('data-cost')).toBe('1.25');
  });
});

describe('EngineUsageSection container', () => {
  test('loading first, then populated with live values once the read resolves', async () => {
    let resolveFetch!: (response: Response) => void;
    const gate = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(() => gate);
    try {
      await act(async () => {
        root.render(<I18nProvider><EngineUsageSection /></I18nProvider>);
      });
      expect(marker().getAttribute('data-state')).toBe('loading');
      await act(async () => {
        resolveFetch(Response.json({ data: wireFixture() }));
        await gate;
      });
      expect(marker().getAttribute('data-state')).toBe('populated');
      expect(host.querySelector('[data-sessions]')?.getAttribute('data-sessions')).toBe('2');
      expect(host.querySelector('[data-tokens]')?.getAttribute('data-tokens')).toBe('20');
    } finally {
      fetch.mockRestore();
    }
  });
});
