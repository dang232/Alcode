/**
 * One boundary for turning a graph file id into a real source path.
 *
 * Graph ids are relative to the snapshot root, which is the common directory of
 * the indexed entry files and is NOT the workspace root (a monorepo's `apps/`
 * tree is the usual case). Joining an id to the workspace root therefore points
 * at a file that does not exist, and on Windows the two sides disagree about
 * drive-letter casing and separators. Every rule below exists because of a live
 * failure: source opened from the graph landed on "File not found".
 */

const SEPARATOR = '/';

const isAbsolute = (value: string): boolean => (
  /^[a-zA-Z]:\//.test(value) || value.startsWith('//') || value.startsWith('/')
);

const normalizeSlashes = (value: string): string => value.replace(/\\/g, SEPARATOR);

/** Lower-case the drive letter and drop `.`/`..` segments without touching case. */
const collapse = (value: string): string => {
  const normalized = normalizeSlashes(value);
  const rooted = normalized.startsWith(SEPARATOR);
  const segments = normalized.split(SEPARATOR);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const joined = out.join(SEPARATOR);
  return rooted ? `${SEPARATOR}${joined}` : joined;
};

const withDriveCase = (value: string, like: string | null): string => {
  if (!/^[a-zA-Z]:\//.test(value)) return value;
  const source = like && /^[a-zA-Z]:\//.test(like) ? like : value;
  return source[0] + value.slice(1);
};

const endsWithSegments = (path: string, suffix: string): boolean => {
  const lowerPath = path.toLowerCase();
  const lowerSuffix = suffix.toLowerCase();
  return lowerPath === lowerSuffix || lowerPath.endsWith(`${SEPARATOR}${lowerSuffix}`);
};

export interface ResolveGraphFileInput {
  /** The graph answer's snapshot root (absolute, forward slashes, lower-case drive). */
  snapshotRoot: string | null | undefined;
  /** The project the answer was read for; nothing outside it may be opened. */
  projectRoot: string | null | undefined;
  /** The id as the graph reported it: absolute, or relative to the snapshot root. */
  file: string | null | undefined;
}

export type ResolveGraphFileResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'no-file' | 'no-root' | 'outside-project' };

/**
 * Resolve one graph file id to an absolute path inside the project, or answer
 * why it cannot be resolved. It never falls back to another file: a mismatch is
 * a refusal, not a guess.
 */
export const resolveGraphFile = (input: ResolveGraphFileInput): ResolveGraphFileResult => {
  const raw = typeof input.file === 'string' ? input.file.trim() : '';
  if (!raw) return { ok: false, reason: 'no-file' };
  const projectRoot = typeof input.projectRoot === 'string' ? input.projectRoot.trim() : '';
  if (!projectRoot) return { ok: false, reason: 'no-root' };
  const project = collapse(projectRoot);
  if (!project) return { ok: false, reason: 'no-root' };
  const snapshotRoot = typeof input.snapshotRoot === 'string' ? collapse(input.snapshotRoot) : '';

  const file = normalizeSlashes(raw);
  const absolute = isAbsolute(file)
    ? collapse(file)
    : collapse(`${snapshotRoot || project}${SEPARATOR}${file}`);
  if (!absolute) return { ok: false, reason: 'no-file' };

  // The id's own segments are part of the contract: whatever path comes back
  // must end with them, so a resolution can never quietly point at a different
  // file that happens to share a name.
  if (!endsWithSegments(absolute, collapse(file))) {
    return { ok: false, reason: 'no-file' };
  }

  const resolved = withDriveCase(absolute, project);
  const prefix = `${project}${SEPARATOR}`;
  if (resolved !== project && !resolved.toLowerCase().startsWith(prefix.toLowerCase())) {
    return { ok: false, reason: 'outside-project' };
  }
  return { ok: true, path: resolved };
};

/**
 * The path to show for a graph file: project-relative, exactly as the editor
 * tab names it. An id that cannot be resolved is shown as the graph reported
 * it, so the user still sees what the graph claimed instead of a blank cell.
 */
export const graphFilePathForDisplay = (input: ResolveGraphFileInput): string => {
  const raw = typeof input.file === 'string' ? normalizeSlashes(input.file.trim()) : '';
  const resolved = resolveGraphFile(input);
  if (!resolved.ok) return raw;
  const project = collapse(String(input.projectRoot)).toLowerCase();
  const lower = resolved.path.toLowerCase();
  const withinProject = lower.startsWith(`${project}${SEPARATOR}`);
  return withinProject ? resolved.path.slice(project.length + 1) : resolved.path;
};
