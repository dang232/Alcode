/**
 * Default-subject resolver for the Code Graph panel.
 *
 * Precedence (highest wins): an explicit manual selection > the active editor
 * file > the working change set > the module map. With no context at all the
 * answer is still the module map, with `moduleMap: false` so the caller can
 * tell "no modules known" from "here is the module map".
 *
 * A deleted file is never a subject: deletions stay visible as information in
 * `changedFileStatus`, but `files` holds only the indexable change set and
 * `file` never points at one. A change set with nothing but deletions falls
 * through to the module map instead of offering a file that cannot be indexed.
 *
 * A path that escapes `projectRoot` is refused, not guessed: the resolver
 * falls through to the next source rather than fabricating a relative path.
 * An absent input is null and stays null.
 */

import React from 'react';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';
import { useGitStatus, useGitStore } from '@/stores/useGitStore';
import { resolveZoneActiveTab, zoneOfMode } from '@/lib/workspace/zones';
import { isJsonText } from './codeGraphApi';

export type CodeGraphSubjectSource = 'active-file' | 'changes' | 'module-map' | 'manual';

export interface CodeGraphSubjectInput {
  activeFile: string | null;
  changedFiles: Array<{ path: string; status: 'modified' | 'staged' | 'untracked' | 'renamed' | 'deleted' }>;
  moduleCount: number | null;
  manual: { id: string; label: string; kind: 'file' | 'symbol' } | null;
}

export interface CodeGraphSubject {
  source: CodeGraphSubjectSource;
  file: string | null;
  files: string[];
  changedFileStatus?: Record<string, 'modified' | 'staged' | 'untracked' | 'renamed' | 'deleted'>;
  moduleMap: boolean;
  reason: 'active-editor' | 'working-changes' | 'no-context' | 'explicit-selection';
}

type ChangedFileStatus = 'modified' | 'staged' | 'untracked' | 'renamed' | 'deleted';

const normalizeSlashes = (value: string): string => value.replace(/\\/g, '/');

interface NormalizedPath {
  prefix: string;
  path: string;
  rooted: boolean;
}

const collapseSegments = (rest: string, rooted: boolean): string | null => {
  const out: string[] = [];
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0) out.pop();
      else if (!rooted) return null;
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
};

const normalizePath = (raw: string): NormalizedPath | null => {
  const value = normalizeSlashes(raw.trim());
  if (!value) return null;
  const drive = /^([a-zA-Z]:)(?=\/|$)/.exec(value);
  if (drive?.[1]) {
    const rest = value.slice(drive[1].length).replace(/^\/+/, '');
    return { prefix: drive[1].toLowerCase(), path: collapseSegments(rest, true) ?? '', rooted: true };
  }
  if (value.startsWith('/')) {
    return {
      prefix: value.startsWith('//') ? '//' : '/',
      path: collapseSegments(value.replace(/^\/+/, ''), true) ?? '',
      rooted: true,
    };
  }
  const path = collapseSegments(value, false);
  if (path === null) return null;
  return { prefix: '', path, rooted: false };
};

/**
 * The active file as a POSIX path relative to the project, or null when it
 * cannot be proven inside the project. A relative input is accepted as
 * already project-relative; anything absolute must share the root's prefix
 * (drive letters compare case-insensitively) and stay under it.
 */
const toProjectRelative = (activeFile: string, projectRoot: string): string | null => {
  const file = normalizePath(activeFile);
  if (!file || file.path === '') return null;
  if (!file.rooted) return file.path;
  const root = normalizePath(projectRoot);
  if (!root || !root.rooted || file.prefix !== root.prefix) return null;
  const windowsy = root.prefix !== '/';
  const filePath = windowsy ? file.path.toLowerCase() : file.path;
  const rootPath = windowsy ? root.path.toLowerCase() : root.path;
  if (filePath === rootPath) return null;
  if (rootPath !== '' && !filePath.startsWith(`${rootPath}/`)) return null;
  const relative = rootPath === '' ? file.path : file.path.slice(root.path.length + 1);
  return relative === '' ? null : relative;
};

const comparePaths = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function resolveCodeGraphSubject(
  input: CodeGraphSubjectInput,
  projectRoot: string,
): CodeGraphSubject {
  if (input.manual) {
    return { source: 'manual', file: null, files: [], moduleMap: false, reason: 'explicit-selection' };
  }
  if (input.activeFile) {
    const relative = toProjectRelative(input.activeFile, projectRoot);
    if (relative !== null) {
      return { source: 'active-file', file: relative, files: [], moduleMap: false, reason: 'active-editor' };
    }
  }
  const seen = new Map<string, ChangedFileStatus>();
  for (const entry of input.changedFiles ?? []) {
    if (!entry || !isJsonText(entry.path)) continue;
    const path = normalizeSlashes(entry.path.trim()).replace(/^\.\/+/, '');
    if (!path) continue;
    if (!seen.has(path)) seen.set(path, entry.status);
  }
  const sorted = [...seen.keys()].sort(comparePaths);
  const indexable = sorted.filter((path) => seen.get(path) !== 'deleted');
  if (indexable.length > 0) {
    const changedFileStatus: Record<string, ChangedFileStatus> = {};
    for (const path of sorted) {
      const status = seen.get(path);
      if (status) changedFileStatus[path] = status;
    }
    return {
      source: 'changes',
      file: indexable[0] ?? null,
      files: indexable,
      changedFileStatus,
      moduleMap: false,
      reason: 'working-changes',
    };
  }
  const hasModules = input.moduleCount !== null && input.moduleCount > 0;
  return { source: 'module-map', file: null, files: [], moduleMap: hasModules, reason: 'no-context' };
}

const toSubjectStatus = (index: string, workingDir: string): ChangedFileStatus => {
  const staged = (index ?? '').trim();
  const working = (workingDir ?? '').trim();
  if (staged === '?' || working === '?') return 'untracked';
  if (staged === 'U' || working === 'U') return 'modified';
  if (staged === 'R' || working === 'R') return 'renamed';
  if (staged === 'D' || working === 'D') return 'deleted';
  if (staged !== '') return 'staged';
  return 'modified';
};

/**
 * The panel's opening subject, read only from the file zone's active tab
 * (`contextPanelByDirectory` + the zone's active id) and the working-changes
 * list (`useGitStatus`). The module count is not in a store, so it stays null
 * here: until the panel reads the module list, the fallback is the module map
 * with `moduleMap: false`. While either store has not loaded, `loading` is
 * true and the subject is provisional rather than an authoritative empty
 * answer.
 */
/** The panel's opening subject plus whether its stores have loaded it yet. */
export interface CodeGraphDefaultSubject {
  subject: CodeGraphSubject;
  loading: boolean;
}

export function useCodeGraphDefaultSubject(directory: string | null): CodeGraphDefaultSubject {
  const panelKey = directory ? normalizeContextPanelDirectoryKey(directory) : null;
  const panel = useUIStore((state) => (panelKey ? state.contextPanelByDirectory[panelKey] : undefined));
  const placement = useUIStore((state) => state.contextSurfaceZones);
  const gitStatus = useGitStatus(directory);
  const gitReady = useGitStore((state) => {
    if (!directory) return true;
    const current = state.directories.get(directory);
    if (!current) return false;
    if (current.isLoadingStatus) return false;
    if (current.isGitRepo === null) return false;
    if (current.isGitRepo === false) return true;
    if (current.status) return true;
    return current.lastStatusFetch !== 0;
  });

  const activeFile = React.useMemo(() => {
    if (!panel) return null;
    const tab = resolveZoneActiveTab(panel, placement, zoneOfMode(placement, 'file'));
    return tab && tab.mode === 'file' ? tab.targetPath : null;
  }, [panel, placement]);

  // The git store hands back a fresh object per render, so a memo keyed on that
  // object would rebuild `changedFiles` (and therefore the subject, and the
  // effects that depend on it) on every render. Key on the CONTENT instead: the
  // same working tree yields the same array identity.
  const changedFileKey = React.useMemo(
    () => (gitStatus?.files ?? []).map((file) => `${file.path}\u0000${file.index}\u0000${file.working_dir}`).join('\u0001'),
    [gitStatus],
  );

  const changedFiles = React.useMemo<CodeGraphSubjectInput['changedFiles']>(() => {
    if (changedFileKey.length === 0) return [];
    return changedFileKey.split('\u0001').map((entry) => {
      const [filePath, index, workingDir] = entry.split('\u0000');
      return { path: filePath, status: toSubjectStatus(index, workingDir) };
    });
  }, [changedFileKey]);

  const subject = React.useMemo(
    () =>
      resolveCodeGraphSubject(
        { activeFile, changedFiles, moduleCount: null, manual: null },
        directory ?? '',
      ),
    [activeFile, changedFiles, directory],
  );

  const loading = !gitReady || (panelKey !== null && panel === undefined);
  return { subject, loading };
}
