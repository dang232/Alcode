import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The rename from openchamber to alcode left the application menu's
// "Check for Updates" emitting a channel the renderer no longer listened to,
// so the menu item was dead while the automatic check kept working. These
// assertions pin the two ends of that bridge together.
const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(electronRoot, '..', '..');
const mainSource = readFileSync(path.join(electronRoot, 'main.mjs'), 'utf8');
const menuActionsSource = readFileSync(
  path.join(repoRoot, 'packages', 'ui', 'src', 'hooks', 'useMenuActions.ts'),
  'utf8',
);

test('the menu dispatches the update check on the channel the renderer listens to', () => {
  assert.ok(
    menuActionsSource.includes("listen('alcode:check-for-updates'"),
    'the renderer must listen for the current check-for-updates channel',
  );
  assert.ok(
    mainSource.includes("emitToWindow(target, 'alcode:check-for-updates')"),
    'the menu must emit the update check on that same channel',
  );
  assert.ok(
    mainSource.includes("dispatchDomEventToWindow(target, 'alcode:check-for-updates')"),
    'the menu must also deliver the check as a DOM event, like the other menu actions',
  );
});

test('no pre-rename update-check channel survives in the main process', () => {
  assert.equal(
    mainSource.includes("'openchamber:check-for-updates'"),
    false,
    'nothing listens to the pre-rename channel; emitting it makes the menu inert',
  );
});

test('a found update has a surface: the check opens the dialog', () => {
  assert.ok(
    menuActionsSource.includes('UPDATE_AVAILABLE_EVENT'),
    'the menu check must announce an available update',
  );
  const sidebarSource = readFileSync(
    path.join(repoRoot, 'packages', 'ui', 'src', 'components', 'session', 'SessionSidebar.tsx'),
    'utf8',
  );
  assert.ok(
    sidebarSource.includes('UPDATE_AVAILABLE_EVENT'),
    'the sidebar owns the update dialog, so it must react to the announcement',
  );
  assert.ok(
    sidebarSource.includes("from '@/hooks/useMenuActions'"),
    'the sidebar must take the announcement from the menu hook, not a copy of the string',
  );
});
