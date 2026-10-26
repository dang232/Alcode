import { describe, expect, test } from 'bun:test';

const { plugin } = await import('bun');
plugin({ name: 'knowledge-note-worker-url', setup(build) {
  build.onLoad({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, () => ({ contents: 'export default "http://localhost/worker.js";', loader: 'js' }));
} });

const { resolveActivityConversationId } = await import('./activityConversation');

describe('activity tab session binding', () => {
  test('an explicitly owned tab keeps its owner', () => {
    expect(resolveActivityConversationId({
      ownerSessionId: 'ses_owned',
      currentSessionId: 'ses_current',
      currentSessionDirectory: '/repo/a',
      panelDirectory: '/repo/a',
    })).toBe('ses_owned');
  });

  test('an unbound tab follows the current session in the same directory', () => {
    expect(resolveActivityConversationId({
      ownerSessionId: null,
      currentSessionId: 'ses_current',
      currentSessionDirectory: 'C:\\repo\\a',
      panelDirectory: 'C:/repo/a/',
    })).toBe('ses_current');
  });

  test('a session from another directory never leaks in', () => {
    expect(resolveActivityConversationId({
      ownerSessionId: null,
      currentSessionId: 'ses_elsewhere',
      currentSessionDirectory: '/repo/b',
      panelDirectory: '/repo/a',
    })).toBeNull();
  });

  test('no current session stays on the empty state', () => {
    expect(resolveActivityConversationId({
      ownerSessionId: null,
      currentSessionId: null,
      currentSessionDirectory: null,
      panelDirectory: '/repo/a',
    })).toBeNull();
  });
});
