// Auto-opening the DAG runs pane on ulw run starts: the trigger mirror and
// the toggle-safe reveal, proved against the real context-panel store (no
// mocks — the assertions read observable tab state, not call records).
import { beforeEach, describe, expect, test } from 'bun:test';

import { useUIStore } from '@/stores/useUIStore';

import { DAG_PANE_SURFACE_MODE, isUlvRunPrompt, revealDagPaneForUlvStart } from './dagAutoOpen';

beforeEach(() => {
  useUIStore.setState({ contextPanelByDirectory: {}, contextRailOrder: [] });
});

const panelState = (directory: string) => useUIStore.getState().contextPanelByDirectory[directory];

describe('isUlvRunPrompt', () => {
  test('matches a leading ulw or /ulw trigger, case-insensitively', () => {
    expect(isUlvRunPrompt('ulw fix the login bug')).toBe(true);
    expect(isUlvRunPrompt('  ULW: keep going')).toBe(true);
    expect(isUlvRunPrompt('/ulw fix the login bug')).toBe(true);
    expect(isUlvRunPrompt('ulw')).toBe(true);
  });

  test('ignores mentions that start no run', () => {
    expect(isUlvRunPrompt('run ultrawork on this repo')).toBe(false);
    expect(isUlvRunPrompt('Ultrawork the migration plan')).toBe(false);
    expect(isUlvRunPrompt('please run ulw on this repo')).toBe(false);
    expect(isUlvRunPrompt('plan the release')).toBe(false);
    expect(isUlvRunPrompt('sulw the deck')).toBe(false);
    expect(isUlvRunPrompt('ulwazi rules')).toBe(false);
    expect(isUlvRunPrompt('ulw-blah rules')).toBe(false);
    expect(isUlvRunPrompt('')).toBe(false);
    expect(isUlvRunPrompt('ulw fix it', 'shell')).toBe(false);
    expect(isUlvRunPrompt('ulw fix it', 'normal')).toBe(true);
  });

  test('matches a long structured execution brief with no trigger words', () => {
    const brief = `# Repo work order\n\nAudit the checkout end to end.\n\n## Phase A — Baseline\nMap it.\n\n## Definition of done\nFix the confirmed P0 defects and verify.${'x'.repeat(1600)}`;

    expect(brief.toLowerCase()).not.toContain('ulw');
    expect(isUlvRunPrompt(brief)).toBe(true);
  });

  test('ignores a long pasted log plus a question', () => {
    const log = `${'Error: something failed\n    at frame (app.js:10:5)\n'.repeat(60)}What does this trace mean?`;

    expect(log.length).toBeGreaterThan(1500);
    expect(isUlvRunPrompt(log)).toBe(false);
  });
});

describe('revealDagPaneForUlvStart', () => {
  test('opens the DAG surface for a ulw send', () => {
    revealDagPaneForUlvStart('ulw keep going', '/repo', { desktop: true });

    const state = panelState('/repo');
    expect(state?.isOpen).toBe(true);
    expect(state?.tabs.map((tab) => tab.mode)).toEqual([DAG_PANE_SURFACE_MODE]);
  });

  test('does not open for a message that starts no run', () => {
    revealDagPaneForUlvStart('please run ulw on this repo', '/repo', { desktop: true });
    revealDagPaneForUlvStart('run ultrawork on this repo', '/repo', { desktop: true });

    expect(panelState('/repo')).toBe(undefined);
  });

  test('does nothing without the trigger, a directory, or the desktop shell', () => {
    revealDagPaneForUlvStart('plan the release', '/repo', { desktop: true });
    revealDagPaneForUlvStart('ulw keep going', '   ', { desktop: true });
    revealDagPaneForUlvStart('ulw keep going', '/repo', { desktop: false });

    expect(panelState('/repo')).toBe(undefined);
  });

  test('never toggles an already-visible DAG pane shut', () => {
    revealDagPaneForUlvStart('ulw first', '/repo', { desktop: true });
    revealDagPaneForUlvStart('ulw second', '/repo', { desktop: true });

    const state = panelState('/repo');
    expect(state?.isOpen).toBe(true);
    expect(state?.tabs.filter((tab) => tab.mode === DAG_PANE_SURFACE_MODE)).toHaveLength(1);
  });

  test('reopens a closed DAG tab instead of duplicating it', () => {
    revealDagPaneForUlvStart('ulw first', '/repo', { desktop: true });
    useUIStore.getState().closeContextPanel('/repo');
    expect(panelState('/repo')?.isOpen).toBe(false);

    revealDagPaneForUlvStart('ulw again', '/repo', { desktop: true });

    const state = panelState('/repo');
    expect(state?.isOpen).toBe(true);
    expect(state?.tabs.filter((tab) => tab.mode === DAG_PANE_SURFACE_MODE)).toHaveLength(1);
  });
});
