/**
 * Namespace prefixes accepted before a command name (`/alcode:btw`,
 * `/openchamber:btw`). The `openchamber:` twin is the pre-rename form and stays
 * resolvable; both map to the same command. Matching strips the prefix (see
 * `normalizeCommandSearchQuery`), so either spelling surfaces the command.
 *
 * Lives outside `CommandAutocomplete.tsx` on purpose: that file renders a
 * component, and colocating these value exports trips
 * `react-refresh/only-export-components`.
 */
export const COMMAND_NAMESPACE_ALIASES = {
  'alcode:': 'alcode:',
  'openchamber:': 'alcode:',
} as const;

/** Strip a leading `alcode:`/`openchamber:` namespace from a typed query. */
export const normalizeCommandSearchQuery = (query: string): string => {
  const lower = query.toLowerCase();
  for (const prefix of Object.keys(COMMAND_NAMESPACE_ALIASES)) {
    if (lower.startsWith(prefix)) return query.slice(prefix.length);
  }
  return query;
};
