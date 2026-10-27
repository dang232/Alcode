import { describe, expect, test } from 'bun:test';

import { resolveCodeGraphDirectory } from './codeGraphDirectory';

const PROJECTS = [
  { id: 'web', path: '/repos/app' },
  { id: 'nested', path: '/repos/app/packages/ui' },
  { id: 'other', path: '/repos/other' },
];

describe('resolveCodeGraphDirectory', () => {
  test('explicit tab target wins over containing, active, and session sources', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: '/repos/other',
      sessionDirectory: '/repos/app/chats/session-1',
      projects: PROJECTS,
      activeProjectId: 'web',
    });
    expect(result).toEqual({ directory: '/repos/other', source: 'tab' });
  });

  test('explicit tab target outside every project still wins', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: '/tmp/scratch',
      sessionDirectory: '/repos/app/chats/session-1',
      projects: PROJECTS,
      activeProjectId: 'web',
    });
    expect(result).toEqual({ directory: '/tmp/scratch', source: 'tab' });
  });

  test('active project wins over a project containing the session', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: 'C:/Users/dangq/AppData/Alcode/sessions/session-1',
      projects: [
        { id: 'home', path: 'C:/Users/dangq' },
        { id: 'app', path: 'D:/repos/app' },
      ],
      activeProjectId: 'app',
    });
    expect(result).toEqual({ directory: 'D:/repos/app', source: 'active-project' });
  });

  test('containing project still wins when no active project is set', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: '/repos/other/chats/session-9',
      projects: PROJECTS,
      activeProjectId: null,
    });
    expect(result).toEqual({ directory: '/repos/other', source: 'project-containing-session' });
  });

  test('home-directory containing candidate is skipped while another project exists', () => {
    const session = '/home/alice/chats/session-10';
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: session,
      projects: [
        { id: 'home', path: '/home/alice' },
        { id: 'other', path: '/repos/other' },
      ],
      activeProjectId: null,
    });
    expect(result).toEqual({ directory: session, source: 'session' });
  });

  test('windows home-directory containing candidate is skipped for the nested repository', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: 'C:\\Users\\dangq\\repos\\app\\chats\\session-12',
      projects: [
        { id: 'home', path: 'C:/Users/dangq' },
        { id: 'app', path: 'C:\\Users\\dangq\\repos\\app' },
      ],
      activeProjectId: null,
    });
    expect(result).toEqual({ directory: 'C:\\Users\\dangq\\repos\\app', source: 'project-containing-session' });
  });

  test('home-directory containing candidate still counts when it is the only candidate', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: '/home/alice/chats/session-11',
      projects: [{ id: 'home', path: '/home/alice' }],
      activeProjectId: null,
    });
    expect(result).toEqual({ directory: '/home/alice', source: 'project-containing-session' });
  });

  test('longest match wins when projects nest', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: '/repos/app/packages/ui/chats/session-2',
      projects: PROJECTS,
      activeProjectId: null,
    });
    expect(result).toEqual({ directory: '/repos/app/packages/ui', source: 'project-containing-session' });
  });

  test('falls back to the active project when no project contains the session', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: '/elsewhere/chats/session-3',
      projects: PROJECTS,
      activeProjectId: 'web',
    });
    expect(result).toEqual({ directory: '/repos/app', source: 'active-project' });
  });

  test('uses the only configured project when no project is active', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: '/data/chats/session-8',
      projects: [{ id: 'solo', path: '/repos/solo' }],
      activeProjectId: null,
    });
    expect(result).toEqual({ directory: '/repos/solo', source: 'active-project' });
  });

  test('still falls back to the session directory when two projects are configured and none is active', () => {
    const session = '/data/chats/session-9';
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: session,
      projects: [
        { id: 'web', path: '/repos/app' },
        { id: 'other', path: '/repos/other' },
      ],
      activeProjectId: null,
    });
    expect(result).toEqual({ directory: session, source: 'session' });
  });

  test('falls back to the session directory with no projects configured', () => {
    const session = '/data/chats/session-4';
    expect(
      resolveCodeGraphDirectory({
        tabTargetDirectory: null,
        sessionDirectory: session,
        projects: [],
        activeProjectId: null,
      }),
    ).toEqual({ directory: session, source: 'session' });
  });

  test('ignores an unknown active project id and uses the session', () => {
    const session = '/elsewhere/chats/session-5';
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: session,
      projects: PROJECTS,
      activeProjectId: 'missing',
    });
    expect(result).toEqual({ directory: session, source: 'session' });
  });

  test('normalises drive-letter case and backslashes when matching', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: 'c:/repos/App/chats/session-6',
      projects: [{ id: 'win', path: 'C:\\repos\\app' }],
      activeProjectId: null,
    });
    expect(result.source).toBe('project-containing-session');
    expect(result.directory).toBe('C:\\repos\\app');
  });

  test('returns the stored project path verbatim, never a synthesised one', () => {
    const result = resolveCodeGraphDirectory({
      tabTargetDirectory: null,
      sessionDirectory: '/repos/app/chats/session-7',
      projects: [{ id: 'slash', path: '/repos/app/' }],
      activeProjectId: null,
    });
    expect(result).toEqual({ directory: '/repos/app/', source: 'project-containing-session' });
  });

  test('returns none when tab, session, and projects are all empty', () => {
    expect(
      resolveCodeGraphDirectory({
        tabTargetDirectory: null,
        sessionDirectory: null,
        projects: [],
        activeProjectId: null,
      }),
    ).toEqual({ directory: null, source: 'none' });
  });
});
