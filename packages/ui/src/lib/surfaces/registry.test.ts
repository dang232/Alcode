import { describe, expect, test } from 'bun:test';

import {
  CODE_GRAPH_WIDTH_MAX,
  CONTEXT_SURFACES,
  CONTEXT_SURFACE_WIDTHS,
  defaultContextPanelWidth,
  getVisibleContextRailSurfaces,
  WALKTHROUGH_MIN_WIDTH,
} from './registry';

const baseOptions = {
  railOrder: [],
  isVSCode: false,
  screenWidth: 1200,
  tabs: [],
  sourceControlConnected: true,
} as const;

describe('getVisibleContextRailSurfaces', () => {
  test('hides the walkthrough on VS Code and below the min width', () => {
    expect(getVisibleContextRailSurfaces({ ...baseOptions, isVSCode: true }).some((s) => s.id === 'walkthrough')).toBe(false);
    expect(
      getVisibleContextRailSurfaces({ ...baseOptions, screenWidth: WALKTHROUGH_MIN_WIDTH - 1 }).some((s) => s.id === 'walkthrough'),
    ).toBe(false);
    expect(
      getVisibleContextRailSurfaces({ ...baseOptions, screenWidth: WALKTHROUGH_MIN_WIDTH }).some((s) => s.id === 'walkthrough'),
    ).toBe(true);
  });

  test('the code graph opens at about half the window on first open', () => {
    const wide = defaultContextPanelWidth('code-graph', 2558);
    expect(wide).toBeGreaterThanOrEqual(Math.round(2558 * 0.45));
    expect(wide).toBeLessThanOrEqual(Math.round(2558 * 0.55));
    // Below roughly 1800px of window the surface tier is the floor, not the ratio.
    expect(defaultContextPanelWidth('code-graph', 1200)).toBe(CONTEXT_SURFACE_WIDTHS.editor);
    // A narrow window never falls below the surface tier; the panel clamps keep the chat usable.
    expect(defaultContextPanelWidth('code-graph', 900)).toBe(CONTEXT_SURFACE_WIDTHS.editor);
    expect(defaultContextPanelWidth('code-graph', null)).toBe(CONTEXT_SURFACE_WIDTHS.editor);
    // Every other surface keeps its fixed tier.
    expect(defaultContextPanelWidth('notes', 2558)).toBe(CONTEXT_SURFACE_WIDTHS.regular);
    expect(defaultContextPanelWidth('activity', 2558)).toBe(CONTEXT_SURFACE_WIDTHS.wide);
  });

  test('offers the code graph surface on the rail by default', () => {
    const surface = CONTEXT_SURFACES.find((entry) => entry.id === 'code-graph');
    expect(surface?.availability).toBe('always');
    expect(surface?.mode).toBe('code-graph');
    expect(getVisibleContextRailSurfaces(baseOptions).some((entry) => entry.id === 'code-graph')).toBe(true);
  });

  test('code-graph opens at the full workspace width with its neighbours unchanged', () => {
    const widthById = new Map(CONTEXT_SURFACES.map((surface) => [surface.id, surface.width]));
    expect(widthById.get('code-graph')).toBe('editor');
    expect(widthById.get('notes')).toBe('regular');
    expect(CONTEXT_SURFACE_WIDTHS.editor).toBeGreaterThan(CONTEXT_SURFACE_WIDTHS.wide);
    expect(widthById.get('activity')).toBe('wide');
  });

  test('offers no browser surface inside VS Code', () => {
    expect(getVisibleContextRailSurfaces(baseOptions).some((s) => s.id === 'browser')).toBe(true);
    // Nothing that makes the panel worth having works there, so offering it
    // would promise the panel people see on the desktop.
    expect(getVisibleContextRailSurfaces({ ...baseOptions, isVSCode: true }).some((s) => s.id === 'browser')).toBe(false);
  });

  test('hides content-driven surfaces until a matching tab exists', () => {
    const chat = CONTEXT_SURFACES.find((surface) => surface.id === 'chat');
    if (!chat) {
      throw new Error('chat surface missing from registry');
    }
    expect(chat.availability).toBe('has-content');
    expect(getVisibleContextRailSurfaces(baseOptions).some((s) => s.id === 'chat')).toBe(false);
    expect(getVisibleContextRailSurfaces({ ...baseOptions, tabs: [{ mode: chat.mode }] }).some((s) => s.id === 'chat')).toBe(true);
  });

  test('the browser surface can be opened from the rail with no tab yet', () => {
    const browser = CONTEXT_SURFACES.find((surface) => surface.id === 'browser');
    expect(browser?.availability).toBe('always');
    expect(getVisibleContextRailSurfaces(baseOptions).some((s) => s.id === 'browser')).toBe(true);
  });

  test('respects the persisted user rail order', () => {
    const surfaces = getVisibleContextRailSurfaces({ ...baseOptions, railOrder: ['git', 'context'] });
    expect(surfaces.slice(0, 2).map((surface) => surface.id)).toEqual(['git', 'context']);
  });

  test('hides the Tracker until a repository host is connected or an item is open in it', () => {
    expect(getVisibleContextRailSurfaces({ ...baseOptions, sourceControlConnected: false }).some((s) => s.id === 'pr')).toBe(false);
    expect(getVisibleContextRailSurfaces({ ...baseOptions, sourceControlConnected: true }).some((s) => s.id === 'pr')).toBe(true);
    const tabs: { mode: 'pr'; targetPath: string }[] = [{ mode: 'pr', targetPath: 'https://linear.app/acme/issue/ENG-7' }];
    expect(getVisibleContextRailSurfaces({ ...baseOptions, sourceControlConnected: false, tabs }).some((s) => s.id === 'pr')).toBe(true);
  });

  test('appends installed guest panels except on VS Code', () => {
    const hello = {
      id: 'plugin:hello' as const,
      mode: 'plugin:hello' as const,
      icon: 'window' as const,
      label: 'Hello',
      labelKey: 'contextRail.surface.plugin' as const,
      descriptionKey: 'contextRail.surface.plugin.description' as const,
      availability: 'always' as const,
      width: 'regular' as const,
    };
    expect(getVisibleContextRailSurfaces({ ...baseOptions, extras: [hello] }).some((s) => s.id === 'plugin:hello')).toBe(true);
    expect(getVisibleContextRailSurfaces({ ...baseOptions, extras: [hello], isVSCode: true }).some((s) => s.id === 'plugin:hello')).toBe(false);
  });

  test('keeps the DAG side pane on the Electron desktop shell only', () => {
    const dag = {
      id: 'plugin:alcode-builtin-dag-pane' as const,
      mode: 'plugin:alcode-builtin-dag-pane' as const,
      icon: 'window' as const,
      label: 'DAG runs',
      labelKey: 'contextRail.surface.plugin' as const,
      descriptionKey: 'contextRail.surface.plugin.description' as const,
      availability: 'always' as const,
      width: 'regular' as const,
    };
    expect(getVisibleContextRailSurfaces({ ...baseOptions, extras: [dag] }).some((s) => s.id === 'plugin:alcode-builtin-dag-pane')).toBe(false);
    expect(getVisibleContextRailSurfaces({ ...baseOptions, extras: [dag], isVSCode: true }).some((s) => s.id === 'plugin:alcode-builtin-dag-pane')).toBe(false);
    expect(getVisibleContextRailSurfaces({ ...baseOptions, extras: [dag], isDesktopShell: true }).some((s) => s.id === 'plugin:alcode-builtin-dag-pane')).toBe(true);
  });
});
