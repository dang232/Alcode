import { normalizePath } from '@/lib/pathNormalization';

/**
 * Which conversation the activity workspace shows. The rail opens activity
 * tabs unbound (no owner session); an unbound tab follows the panel
 * directory's current session so the workspace shows live activity instead
 * of a permanent empty state. An explicitly owned tab keeps its owner, and
 * a session from another directory never leaks in. Switching sessions moves
 * the workspace with the chat.
 *
 * This contract is load-bearing, not descriptive: without the directory
 * check, following the current session leaks one directory's run into
 * another directory's panel, and without the follow, the rail button opens
 * a permanently empty workspace. Keep both halves together.
 */
export const resolveActivityConversationId = (options: {
  ownerSessionId: string | null;
  currentSessionId: string | null;
  currentSessionDirectory: string | null;
  panelDirectory: string | null | undefined;
}): string | null => {
  if (options.ownerSessionId) return options.ownerSessionId;
  const panelDirectory = normalizePath(options.panelDirectory);
  if (!options.currentSessionId || !panelDirectory) return null;
  if (normalizePath(options.currentSessionDirectory) !== panelDirectory) return null;
  return options.currentSessionId;
};
