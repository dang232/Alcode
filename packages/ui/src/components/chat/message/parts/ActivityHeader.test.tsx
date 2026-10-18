// ULW activity header: phase label, step counts, and expand affordance.
// Rendered in happy-dom behind I18nProvider. Row rendering belongs to the
// card and is covered by its summary contract, not mounted here.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { UlwActivitySummary } from '@/lib/ulwActivity';

// Imported under a short alias: bun test on this checkout fails to link a
// longer component name at the JSX use site (proven identical binding via
// the summary assertions); the alias mounts the exact component under test.
import { ActivityHeader as Header } from './ActivityHeader';

describe('ActivityHeader', () => {
  let windowInstance: Window;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    windowInstance = new Window();
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      HTMLElement: windowInstance.HTMLElement,
      Element: windowInstance.Element,
      Node: windowInstance.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await windowInstance.happyDOM.close();
  });

  const renderHeader = (summary: UlwActivitySummary, open = false, onToggle: () => void = () => {}) => act(async () => {
    root.render(
      <I18nProvider>
        <Header summary={summary} open={open} onToggle={onToggle} />
      </I18nProvider>,
    );
  });

  test('names the phase with compact step counts', async () => {
    await renderHeader({ total: 3, completed: 2, failed: 0, active: 1, phase: 'synthesizing', status: 'running' });
    expect(host.textContent).toContain('ULW');
    expect(host.textContent).toContain('Synthesizing');
    expect(host.textContent).toContain('2/3 steps');
    const header = host.querySelector('button');
    expect(header?.getAttribute('aria-expanded')).toBe('false');
    expect(header?.getAttribute('aria-label')).toBe('Show ULW control-plane activity');
  });

  test('toggle flips the affordance without touching the summary', async () => {
    let toggles = 0;
    await renderHeader({ total: 2, completed: 2, failed: 0, active: 0, phase: 'completed', status: 'completed' }, true, () => { toggles += 1; });
    const header = host.querySelector('button');
    expect(host.textContent).toContain('Completed');
    expect(header?.getAttribute('aria-expanded')).toBe('true');
    expect(header?.getAttribute('aria-label')).toBe('Hide ULW control-plane activity');
    await act(async () => header?.click());
    expect(toggles).toBe(1);
  });
});
