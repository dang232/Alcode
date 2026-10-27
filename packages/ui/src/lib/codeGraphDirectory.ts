/**
 * Which directory the Code Graph panel graphs, and why.
 *
 * The panel used to bind directly to the session directory, so it graphed the
 * chat store instead of the user's repository. The app already knows the
 * user's projects (`useProjectsStore`), so this resolver picks the project
 * directory first and keeps the session directory as the no-project fallback.
 * Precedence: explicit tab target, then the explicitly selected (active)
 * project, then the project containing the session (only when no project is
 * selected), then a lone configured project, then the session directory.
 */

export type CodeGraphDirectorySource =
  | 'tab'
  | 'active-project'
  | 'project-containing-session'
  | 'session'
  | 'none';

export interface CodeGraphDirectoryProject {
  id: string;
  path: string;
}

export interface ResolveCodeGraphDirectoryInputs {
  tabTargetDirectory?: string | null;
  sessionDirectory?: string | null;
  projects?: readonly CodeGraphDirectoryProject[] | null;
  activeProjectId?: string | null;
}

export interface ResolvedCodeGraphDirectory {
  directory: string | null;
  source: CodeGraphDirectorySource;
}

const trimInput = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Compare paths across Windows and POSIX inputs: backslashes become forward
 * slashes, trailing slashes go, and a Windows path (drive letter, backslash,
 * or UNC prefix) compares case-insensitively. POSIX paths keep their case.
 */
const normalizeForCompare = (value: string): string => {
  const forward = value.replace(/\\/g, '/');
  const windowsish = /^[A-Za-z]:(\/|$)/.test(forward) || forward.startsWith('//') || value.includes('\\');
  const lowered = windowsish ? forward.toLowerCase() : forward;
  if (lowered === '' || lowered === '/') return lowered;
  const stripped = lowered.replace(/\/+$/g, '');
  return stripped === '' ? '/' : stripped;
};

const isWithinOrEqual = (candidate: string, container: string): boolean => {
  if (candidate === container) return true;
  if (container === '/') return candidate.startsWith('/');
  return candidate.startsWith(`${container}/`);
};

/**
 * A normalized path shaped exactly like a user's home directory:
 * `C:/Users/<name>` or `/home/<name>`. A home directory contains every
 * session on the machine, so matching it proves nothing about which
 * repository the user meant to graph — pointing the panel there would index
 * everything. Windows inputs already compare lowercased; POSIX keeps case.
 */
const isHomeDirectoryPath = (normalizedPath: string): boolean => {
  if (/^[a-z]:\/users\/[^/]+$/.test(normalizedPath)) return true;
  if (/^\/home\/[^/]+$/.test(normalizedPath)) return true;
  return false;
};

export const resolveCodeGraphDirectory = (
  inputs: ResolveCodeGraphDirectoryInputs,
): ResolvedCodeGraphDirectory => {
  const tabDirectory = trimInput(inputs.tabTargetDirectory);
  if (tabDirectory) {
    return { directory: tabDirectory, source: 'tab' };
  }

  const sessionDirectory = trimInput(inputs.sessionDirectory);
  const projects = inputs.projects ?? [];

  // (2) A project the user explicitly selected outranks every heuristic.
  const activeProjectId = trimInput(inputs.activeProjectId);
  if (activeProjectId) {
    const active = projects.find((project) => project && trimInput(project.id) === activeProjectId);
    const activePath = active ? trimInput(active.path) : null;
    if (activePath) {
      return { directory: activePath, source: 'active-project' };
    }
  } else if (sessionDirectory) {
    // (3) Containment is only a guess, so it runs only when the user has
    // not selected a project. Longest match wins when projects nest.
    const normalizedSession = normalizeForCompare(sessionDirectory);
    // A home directory contains every session and is never a repository
    // the user meant to graph, so a home-shaped project is ignored as a
    // containing candidate while the user has other projects configured.
    // It still counts when it is the only candidate left, so the panel
    // graphs something real instead of the chat store.
    const usableProjects = projects.filter((project) => project && trimInput(project.path));
    const considerHome = usableProjects.length <= 1;
    let best: string | null = null;
    let bestLength = -1;
    for (const project of projects) {
      const projectPath = project ? trimInput(project.path) : null;
      if (!projectPath) continue;
      const normalizedProject = normalizeForCompare(projectPath);
      if (!normalizedProject) continue;
      if (!considerHome && isHomeDirectoryPath(normalizedProject)) continue;
      if (isWithinOrEqual(normalizedSession, normalizedProject) && normalizedProject.length > bestLength) {
        best = projectPath;
        bestLength = normalizedProject.length;
      }
    }
    if (best) {
      return { directory: best, source: 'project-containing-session' };
    }
  }

  // A first-time user who has added exactly one project has not "chosen" an
  // active one, and falling back to the chat store directory there would show
  // an empty graph for a repository the user does have. The lone project is
  // the project to graph. It reports 'active-project' because a single
  // configured project needs no extra source value: callers and tests already
  // read that source as "the user's project, not the chat store".
  const configuredProjectPaths = projects
    .map((project) => (project ? trimInput(project.path) : null))
    .filter((projectPath): projectPath is string => projectPath !== null);
  if (configuredProjectPaths.length === 1) {
    return { directory: configuredProjectPaths[0], source: 'active-project' };
  }

  if (sessionDirectory) {
    return { directory: sessionDirectory, source: 'session' };
  }

  return { directory: null, source: 'none' };
};
