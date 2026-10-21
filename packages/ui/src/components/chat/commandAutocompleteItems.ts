import { fuzzyMatch } from '@/lib/utils';
import { rankByQuery } from '@/lib/search/fuzzySearch';

export interface CommandAutocompleteSearchItem {
  name: string;
  description?: string;
  searchAliases?: string[];
  isBuiltIn?: boolean;
  isSkill?: boolean;
  source?: string;
}

function addSearchAliases<T extends CommandAutocompleteSearchItem>(winner: T, duplicate: T): T {
  const existingAliases = winner.searchAliases ?? [];
  const aliases = [
    ...existingAliases,
    ...(winner.name === duplicate.name ? [] : [duplicate.name]),
    ...(duplicate.description ? [duplicate.description] : []),
    ...(duplicate.searchAliases ?? []),
  ].filter((alias, index, values) => alias !== winner.description && values.indexOf(alias) === index);
  const unchanged = aliases.length === existingAliases.length
    && aliases.every((alias, index) => alias === existingAliases[index]);

  return unchanged ? winner : { ...winner, searchAliases: aliases };
}

/**
 * Precedence is built-in command, then discovered skill, then skill
 * command, then custom/plugin command. Identity matches
 * session.command's case-sensitive lookup.
 */
function precedenceOf(item: CommandAutocompleteSearchItem): number {
  if (item.isBuiltIn) return 3;
  if (item.isSkill) return item.source === 'skill' ? 2 : 1;
  return 0;
}

export function mergeCommandAutocompleteItems<T extends CommandAutocompleteSearchItem>(
  builtIns: T[],
  commands: T[],
  skills: T[] = [],
): T[] {
  const merged: T[] = [];
  const byName = new Map<string, { index: number; item: T; precedence: number }>();

  const addItems = (items: T[], getPrecedence: (item: T) => number) => {
    for (const item of items) {
      const precedence = getPrecedence(item);
      const identity = item.name;
      const existing = byName.get(identity);
      if (!existing) {
        byName.set(identity, { index: merged.length, item, precedence });
        merged.push(item);
        continue;
      }

      const winner = precedence > existing.precedence
        ? addSearchAliases(item, existing.item)
        : addSearchAliases(existing.item, item);
      merged[existing.index] = winner;
      byName.set(identity, {
        index: existing.index,
        item: winner,
        precedence: Math.max(existing.precedence, precedence),
      });
    }
  };

  addItems(builtIns, precedenceOf);
  addItems(commands, precedenceOf);
  addItems(skills, precedenceOf);
  return merged;
}

export function commandMatchesSearch(command: CommandAutocompleteSearchItem, query: string): boolean {
  return fuzzyMatch(command.name, query)
    || Boolean(command.description && fuzzyMatch(command.description, query))
    || Boolean(command.searchAliases?.some((alias) => fuzzyMatch(alias, query)));
}

export function rankCommandAutocompleteItems<T extends CommandAutocompleteSearchItem>(
  commands: T[],
  query: string,
): T[] {
  const filtered = query
    ? commands.filter((command) => commandMatchesSearch(command, query))
    : [...commands];

  filtered.sort((a, b) => a.name.localeCompare(b.name));
  if (!query) return filtered;

  const rankedByName = rankByQuery(filtered, query, (command) => [command.name]);
  const matchedNames = new Set(rankedByName);
  return [...rankedByName, ...filtered.filter((command) => !matchedNames.has(command))];
}
