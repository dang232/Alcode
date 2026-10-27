import { Window } from 'happy-dom';
import { afterEach, describe, expect, test } from 'bun:test';
import type { FC } from 'react';
import type { Root } from 'react-dom/client';
import type { GitStatus } from '@/lib/api/types';
import type { CodeGraphSubject, CodeGraphSubjectInput } from './codeGraphSubject';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  Node: browser.Node, Element: browser.Element, HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement, HTMLFormElement: browser.HTMLFormElement,
  Event: browser.Event, CustomEvent: browser.CustomEvent,
  MutationObserver: browser.MutationObserver, ResizeObserver: browser.ResizeObserver,
  MouseEvent: browser.MouseEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

// React resolves DOM globals at import time: these dynamic imports must come
// after the assignment above.
const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { resolveCodeGraphSubject, useCodeGraphDefaultSubject } = await import('./codeGraphSubject');
const { useUIStore } = await import('@/stores/useUIStore');
const { useGitStore } = await import('@/stores/useGitStore');

const ROOT = '/repo';

describe('resolveCodeGraphSubject', () => {
  test('manual wins over everything', () => {
    const subject = resolveCodeGraphSubject({
      activeFile: `${ROOT}/src/a.ts`,
      changedFiles: [{ path: 'src/b.ts', status: 'modified' }],
      moduleCount: 4,
      manual: { id: 'fn:add@math.ts', label: 'add', kind: 'symbol' },
    }, ROOT);
    expect(subject.source).toBe('manual');
    expect(subject.reason).toBe('explicit-selection');
    expect(subject.file).toBeNull();
    expect(subject.files).toEqual([]);
    expect(subject.moduleMap).toBe(false);
  });

  test('active file inside root becomes a relative POSIX path', () => {
    const subject = resolveCodeGraphSubject({
      activeFile: '/repo/src/a.ts',
      changedFiles: [{ path: 'src/b.ts', status: 'modified' }],
      moduleCount: 4,
      manual: null,
    }, '/repo');
    expect(subject).toEqual({
      source: 'active-file', file: 'src/a.ts', files: [], moduleMap: false, reason: 'active-editor',
    });
  });

  test('active file outside root falls through to changes', () => {
    const subject = resolveCodeGraphSubject({
      activeFile: '/elsewhere/x.ts',
      changedFiles: [
        { path: 'src/b.ts', status: 'modified' },
        { path: 'src/a.ts', status: 'staged' },
      ],
      moduleCount: 4,
      manual: null,
    }, '/repo');
    expect(subject.source).toBe('changes');
    expect(subject.file).toBe('src/a.ts');
    expect(subject.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(subject.reason).toBe('working-changes');
  });

  test('a Windows-style path with a drive letter and backslashes normalises', () => {
    const subject = resolveCodeGraphSubject({
      activeFile: 'C:\\Repo\\src\\a.ts',
      changedFiles: [],
      moduleCount: null,
      manual: null,
    }, 'c:/Repo');
    expect(subject.source).toBe('active-file');
    expect(subject.file).toBe('src/a.ts');
    expect(subject.reason).toBe('active-editor');
  });

  test('change set sorted with statuses preserved', () => {
    const subject = resolveCodeGraphSubject({
      activeFile: null,
      changedFiles: [
        { path: 'src/b.ts', status: 'modified' },
        { path: 'src/a.ts', status: 'untracked' },
        { path: 'src/old.ts', status: 'deleted' },
        { path: 'src/moved.ts', status: 'renamed' },
      ],
      moduleCount: null,
      manual: null,
    }, '/repo');
    expect(subject.source).toBe('changes');
    expect(subject.file).toBe('src/a.ts');
    expect(subject.files).toEqual(['src/a.ts', 'src/b.ts', 'src/moved.ts']);
    expect(subject.changedFileStatus).toEqual({
      'src/a.ts': 'untracked',
      'src/b.ts': 'modified',
      'src/moved.ts': 'renamed',
      'src/old.ts': 'deleted',
    });
  });

  test('deleted-only change set falls through to the module map', () => {
    const subject = resolveCodeGraphSubject({
      activeFile: null,
      changedFiles: [{ path: 'src/gone.ts', status: 'deleted' }],
      moduleCount: 3,
      manual: null,
    }, '/repo');
    expect(subject.source).toBe('module-map');
    expect(subject.moduleMap).toBe(true);
    expect(subject.file).toBeNull();
    expect(subject.files).toEqual([]);
  });

  test('moduleCount 0 with a module list gives the module map', () => {
    const subject = resolveCodeGraphSubject({
      activeFile: null, changedFiles: [], moduleCount: 0, manual: null,
    }, '/repo');
    expect(subject.source).toBe('module-map');
    expect(subject.file).toBeNull();
    expect(subject.moduleMap).toBe(false);
    expect(subject.reason).toBe('no-context');
  });

  test('no context gives file null and reason no-context', () => {
    const subject = resolveCodeGraphSubject({
      activeFile: null, changedFiles: [], moduleCount: null, manual: null,
    }, '/repo');
    expect(subject).toEqual({
      source: 'module-map', file: null, files: [], moduleMap: false, reason: 'no-context',
    });
  });

  test('the same input twice returns a deep-equal result', () => {
    const input: CodeGraphSubjectInput = {
      activeFile: '/repo/src/a.ts',
      changedFiles: [{ path: 'src/b.ts', status: 'modified' }],
      moduleCount: 2,
      manual: null,
    };
    const first = resolveCodeGraphSubject(input, '/repo');
    const second = resolveCodeGraphSubject(input, '/repo');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.files).not.toBe(second.files);
  });
});

describe('useCodeGraphDefaultSubject', () => {
  let container: HTMLElement | null = null;
  let root: Root | null = null;
  let seen: { subject: CodeGraphSubject; loading: boolean } | null = null;

  const Probe: FC<{ directory: string | null }> = ({ directory }) => {
    seen = useCodeGraphDefaultSubject(directory);
    return null;
  };

  const renderProbe = async (directory: string | null): Promise<void> => {
    seen = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(Probe, { directory }));
    });
    await act(async () => {});
  };

  const seedGitStatus = (directory: string, status: GitStatus): void => {
    useGitStore.setState({
      directories: new Map([
        [directory, {
          isGitRepo: true,
          status,
          branches: null,
          log: null,
          identity: null,
          diffCache: new Map(),
          indexRevision: 0,
          lastRepoCheckAt: 1,
          lastStatusFetch: 1,
          lastStatusChange: 1,
          lastLogFetch: 0,
          lastBranchesFetch: 0,
          lastIdentityFetch: 0,
          logMaxCount: 25,
          isLoadingStatus: false,
          isLoadingLog: false,
          isLoadingBranches: false,
          isLoadingIdentity: false,
        }],
      ]),
    });
  };

  afterEach(async () => {
    if (root) await act(async () => { root?.unmount(); });
    container?.remove();
    container = null;
    root = null;
    seen = null;
    useUIStore.setState({ contextPanelByDirectory: {} });
    useGitStore.setState({ directories: new Map(), activeDirectory: null });
  });

  test('reports loading before either store has loaded', async () => {
    await renderProbe('/repo');
    expect(seen?.loading).toBe(true);
    expect(seen?.subject.reason).toBe('no-context');
    expect(seen?.subject.file).toBeNull();
  });

  test('reads the file-zone active tab once the stores have loaded', async () => {
    useUIStore.getState().openContextFile('/repo', '/repo/src/a.ts');
    seedGitStatus('/repo', {
      current: 'main', tracking: null, ahead: 0, behind: 0, isClean: false,
      files: [{ path: 'src/b.ts', index: ' ', working_dir: 'M' }],
    });
    await renderProbe('/repo');
    expect(seen?.loading).toBe(false);
    expect(seen?.subject.source).toBe('active-file');
    expect(seen?.subject.file).toBe('src/a.ts');
  });

  test('falls back to working changes when no file tab is active', async () => {
    useUIStore.getState().openContextFile('/repo', '/repo/src/a.ts');
    useUIStore.getState().closeContextFile('/repo', '/repo/src/a.ts');
    seedGitStatus('/repo', {
      current: 'main', tracking: null, ahead: 0, behind: 0, isClean: false,
      files: [
        { path: 'src/b.ts', index: 'M', working_dir: ' ' },
        { path: 'src/a.ts', index: ' ', working_dir: 'M' },
      ],
    });
    await renderProbe('/repo');
    expect(seen?.loading).toBe(false);
    expect(seen?.subject.source).toBe('changes');
    expect(seen?.subject.file).toBe('src/a.ts');
    expect(seen?.subject.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(seen?.subject.changedFileStatus).toEqual({ 'src/a.ts': 'modified', 'src/b.ts': 'staged' });
  });
});
