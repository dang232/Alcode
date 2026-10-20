import { describe, expect, test } from 'bun:test';
import { commandMatchesSearch, mergeCommandAutocompleteItems, rankCommandAutocompleteItems } from '../commandAutocompleteItems';
import { COMMAND_NAMESPACE_ALIASES, normalizeCommandSearchQuery } from '../commandNamespaces';

interface Item {
  name: string;
  source: 'alcode' | 'opencode' | 'skill';
  description?: string;
  searchAliases?: string[];
  isBuiltIn?: boolean;
}

describe('mergeCommandAutocompleteItems', () => {
  test('built-ins win collisions with commands without losing search aliases', () => {
    const builtIn: Item = {
      name: 'summary',
      source: 'alcode',
      description: 'Summarize this session',
      isBuiltIn: true,
    };
    const command: Item = {
      name: 'summary',
      source: 'opencode',
      description: 'Plugin session digest',
    };

    const merged = mergeCommandAutocompleteItems([builtIn], [command]);

    expect(merged).toEqual([{
      ...builtIn,
      searchAliases: ['Plugin session digest'],
    }]);
    expect(commandMatchesSearch(merged[0], 'plugin digest')).toBe(true);
  });

  test('OpenCode built-ins win collisions with custom commands', () => {
    const custom: Item = { name: 'review', source: 'opencode', description: 'Custom review' };
    const builtIn: Item = {
      name: 'review',
      source: 'opencode',
      description: 'Review workspace changes',
      isBuiltIn: true,
    };

    expect(mergeCommandAutocompleteItems([], [custom, builtIn])).toEqual([{
      ...builtIn,
      searchAliases: ['Review skill'],
    }]);
  });

  test('deduplicates every pairwise source collision by executable precedence', () => {
    const builtIn: Item = { name: 'compact', source: 'alcode', isBuiltIn: true };
    const command: Item = { name: 'compact', source: 'opencode' };
    const skill: Item = { name: 'compact', source: 'skill', isSkill: true };

    expect(mergeCommandAutocompleteItems([builtIn], [command], [])[0]).toBe(builtIn);
    expect(mergeCommandAutocompleteItems([builtIn], [], [skill])[0]).toBe(builtIn);
    expect(mergeCommandAutocompleteItems([], [command], [skill])[0]).toBe(skill);
  });

  test('OpenCode skill-commands win custom commands and yield to discovered skills', () => {
    const command: Item = { name: 'deploy', source: 'opencode', description: 'Custom deploy' };
    const skillCommand: Item = {
      name: 'deploy',
      source: 'opencode',
      description: 'OpenCode skill command',
      isSkill: true,
    };
    const skill: Item = {
      name: 'deploy',
      source: 'skill',
      description: 'Discovered deploy skill',
      isSkill: true,
    };

    expect(mergeCommandAutocompleteItems([], [command, skillCommand], [])).toEqual([{
      ...skillCommand,
      searchAliases: ['Custom deploy'],
    }]);
    expect(mergeCommandAutocompleteItems([], [command, skillCommand], [skill])).toEqual([{
      ...skill,
      searchAliases: ['OpenCode skill command', 'Custom deploy'],
    }]);
  });

  test('keeps a case-distinct command when the built-in is disabled', () => {
    const builtIn: Item = { name: 'init', source: 'alcode', isBuiltIn: true };
    const command: Item = { name: 'Init', source: 'opencode', description: 'Custom init' };
    const merged = mergeCommandAutocompleteItems([builtIn], [command]);

    expect(merged).toEqual([builtIn, command]);
    expect(merged.filter((item) => item.name !== 'init')).toEqual([command]);
  });

  test('keeps first-seen ordering and unrelated commands', () => {
    const builtIns: Item[] = [{ name: 'undo', source: 'alcode' }];
    const commands: Item[] = [
      { name: 'test', source: 'opencode' },
      { name: 'deploy', source: 'opencode' },
    ];

    const merged = mergeCommandAutocompleteItems(builtIns, commands);

    expect(merged.map((item) => item.name)).toEqual(['undo', 'test', 'deploy']);
    expect(merged[2]).toBe(commands[1]);
  });

  test('deduplicates repeated entries within each source without mutating inputs', () => {
    const first: Item = { name: 'test', source: 'opencode', description: 'First' };
    const duplicate: Item = { name: 'test', source: 'opencode', description: 'Second' };

    expect(mergeCommandAutocompleteItems([], [first, duplicate])).toEqual([{
      ...first,
      searchAliases: ['Second'],
    }]);
    expect(first.searchAliases).toBe(undefined);
  });

  test('handles empty inputs', () => {
    expect(mergeCommandAutocompleteItems([], [])).toEqual([]);
  });
});

describe('rankCommandAutocompleteItems', () => {
  test('places /apply name matches before fuzzy, description, and alias matches', () => {
    const commands: Item[] = [
      { name: 'apple-design', source: 'opencode', description: 'Apply a design' },
      { name: 'review', source: 'opencode', searchAliases: ['apply changes'] },
      { name: 'openspec-apply-change', source: 'opencode' },
      { name: 'opsx-apply', source: 'opencode' },
      { name: 'apply', source: 'opencode' },
      { name: 'draft-notes', source: 'opencode', description: 'Apply notes' },
      { name: 'zebra', source: 'opencode' },
    ];

    expect(rankCommandAutocompleteItems(commands, 'apply').map((command) => command.name)).toEqual([
      'apply',
      'opsx-apply',
      'openspec-apply-change',
      'apple-design',
      'draft-notes',
      'review',
    ]);
  });

  test('keeps alphabetical order when the query is empty', () => {
    const commands: Item[] = [
      { name: 'opsx-apply', source: 'opencode' },
      { name: 'apple-design', source: 'opencode' },
    ];

    expect(rankCommandAutocompleteItems(commands, '').map((command) => command.name)).toEqual([
      'apple-design', 'opsx-apply',
    ]);
  });
});

describe('rename backward compatibility (alcode:* / openchamber:*)', () => {
  test('the alias map resolves both namespace spellings to the new one', () => {
    expect(COMMAND_NAMESPACE_ALIASES['alcode:']).toBe('alcode:');
    expect(COMMAND_NAMESPACE_ALIASES['openchamber:']).toBe('alcode:');
  });

  test('normalizeCommandSearchQuery strips either namespace prefix', () => {
    expect(normalizeCommandSearchQuery('openchamber:btw')).toBe('btw');
    expect(normalizeCommandSearchQuery('alcode:btw')).toBe('btw');
    expect(normalizeCommandSearchQuery('OpenChamber:plan-feature')).toBe('plan-feature');
    expect(normalizeCommandSearchQuery('btw')).toBe('btw');
    expect(normalizeCommandSearchQuery('')).toBe('');
  });

  test('a command carrying both namespace aliases matches either spelling', () => {
    const item: Item = {
      name: 'btw',
      source: 'alcode',
      description: 'Ask a side question',
      searchAliases: ['alcode:btw', 'openchamber:btw'],
      isBuiltIn: true,
    };

    expect(commandMatchesSearch(item, 'btw')).toBe(true);
    expect(commandMatchesSearch(item, 'alcode:btw')).toBe(true);
    expect(commandMatchesSearch(item, 'openchamber:btw')).toBe(true);
  });

  test('merge preserves both namespace aliases through collisions', () => {
    const builtIn: Item = {
      name: 'summary',
      source: 'alcode',
      description: 'Summarize this session',
      searchAliases: ['alcode:summary', 'openchamber:summary'],
      isBuiltIn: true,
    };
    const command: Item = {
      name: 'summary',
      source: 'opencode',
      description: 'Plugin session digest',
    };

    const merged = mergeCommandAutocompleteItems([builtIn], [command], []);
    expect(merged).toHaveLength(1);
    expect(commandMatchesSearch(merged[0], 'alcode:summary')).toBe(true);
    expect(commandMatchesSearch(merged[0], 'openchamber:summary')).toBe(true);
  });
});
