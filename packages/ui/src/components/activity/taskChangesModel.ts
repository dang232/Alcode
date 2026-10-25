import type { GitStatus } from '@/lib/api/types';

export type StatusFile = GitStatus['files'][number];

const normalise = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '');

// Task paths arrive project-relative or absolute while git reports
// repository-relative paths, so a match needs a path boundary and the task side
// must carry the extra segments: a bare `x.ts` never claims `b/x.ts`.
export const changedFilesForTask = (taskFiles: string[], statusFiles: StatusFile[]): StatusFile[] => {
  const wanted = taskFiles.map(normalise).filter((file) => file.length > 0);
  if (wanted.length === 0) return [];
  const seen = new Set<string>();
  const matched: StatusFile[] = [];
  for (const entry of statusFiles) {
    const path = normalise(entry.path);
    if (seen.has(path)) continue;
    const hit = wanted.some((file) => file === path || file.endsWith(`/${path}`));
    if (!hit) continue;
    seen.add(path);
    matched.push(entry);
  }
  return matched.sort((left, right) => left.path.localeCompare(right.path));
};
