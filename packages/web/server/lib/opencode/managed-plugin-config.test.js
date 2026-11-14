import { describe, expect, it } from 'vitest';
import { appendManagedPlugin } from './managed-plugin-config.js';

const DIRECTORY = '/data/plugins/alcode-agent-tool';
const DESCRIPTOR = {
  hostCapabilities: {
    version: 1,
    url: 'http://127.0.0.1:3901',
    token: 'opaque-bearer',
    allowedAgents: ['explore', 'librarian'],
  },
};

const merge = (rawConfig, descriptor) => appendManagedPlugin(rawConfig, DIRECTORY, 'managed plugin', descriptor);
const pluginsOf = (rawConfig, descriptor) => JSON.parse(merge(rawConfig, descriptor)).plugins;

const INVALID_DESCRIPTORS = [
  ['a version other than the literal 1', { hostCapabilities: { ...DESCRIPTOR.hostCapabilities, version: 2 } }],
  ['a version that is the string "1"', { hostCapabilities: { ...DESCRIPTOR.hostCapabilities, version: '1' } }],
  ['a non-http url', { hostCapabilities: { ...DESCRIPTOR.hostCapabilities, url: 'ftp://127.0.0.1:3901' } }],
  ['a url that does not parse', { hostCapabilities: { ...DESCRIPTOR.hostCapabilities, url: 'http://' } }],
  ['an empty token', { hostCapabilities: { ...DESCRIPTOR.hostCapabilities, token: '' } }],
  ['a missing token', { hostCapabilities: { version: 1, url: 'http://127.0.0.1:3901' } }],
  ['missing hostCapabilities', { version: 1, url: 'http://127.0.0.1:3901', token: 'x' }],
  ['allowedAgents that is not an array', { hostCapabilities: { ...DESCRIPTOR.hostCapabilities, allowedAgents: 'explore' } }],
  ['allowedAgents holding a non-string', { hostCapabilities: { ...DESCRIPTOR.hostCapabilities, allowedAgents: [42] } }],
  ['malformed JSON text', '{not json'],
  ['a descriptor that is not an object', 42],
];

describe('appendManagedPlugin', () => {
  it('stays a bare directory path when no descriptor is supplied', () => {
    expect(pluginsOf(undefined)).toEqual([DIRECTORY]);
  });

  it('publishes a valid descriptor as a tuple with the directory first', () => {
    expect(pluginsOf(undefined, DESCRIPTOR)).toEqual([[DIRECTORY, DESCRIPTOR]]);
  });

  it('accepts the descriptor as JSON text', () => {
    expect(pluginsOf(undefined, JSON.stringify(DESCRIPTOR))).toEqual([[DIRECTORY, DESCRIPTOR]]);
  });

  it('publishes the descriptor without allowedAgents when it is absent', () => {
    const { allowedAgents, ...withoutAgents } = DESCRIPTOR.hostCapabilities;
    expect(pluginsOf(undefined, { hostCapabilities: withoutAgents }))
      .toEqual([[DIRECTORY, { hostCapabilities: withoutAgents }]]);
  });

  it('dedupes a re-merge of the same directory to a single tuple entry', () => {
    const twice = merge(merge(undefined, DESCRIPTOR), DESCRIPTOR);
    expect(JSON.parse(twice).plugins).toEqual([[DIRECTORY, DESCRIPTOR]]);
  });

  it('replaces an earlier bare entry with the tuple on re-merge', () => {
    expect(pluginsOf(merge(undefined), DESCRIPTOR)).toEqual([[DIRECTORY, DESCRIPTOR]]);
  });

  it.each(INVALID_DESCRIPTORS)('falls back to the bare directory for %s', (_label, descriptor) => {
    expect(pluginsOf(undefined, descriptor)).toEqual([DIRECTORY]);
  });

  it('replaces an earlier tuple with the bare directory when the new descriptor is invalid', () => {
    const invalid = { hostCapabilities: { ...DESCRIPTOR.hostCapabilities, version: 2 } };
    expect(pluginsOf(merge(undefined, DESCRIPTOR), invalid)).toEqual([DIRECTORY]);
  });

  it('keeps unrelated entries and config keys when publishing a tuple', () => {
    const raw = JSON.stringify({
      plugins: ['/other/plugin', '/third'],
      mcp: { servers: { other: { type: 'local', command: ['x'] } } },
      agent: { sisyphus: { model: 'provider/model' } },
      theme: 'dark',
    });
    const merged = JSON.parse(merge(raw, DESCRIPTOR));
    expect(merged.plugins).toEqual(['/other/plugin', '/third', [DIRECTORY, DESCRIPTOR]]);
    expect(merged.mcp).toEqual({ servers: { other: { type: 'local', command: ['x'] } } });
    expect(merged.agent).toEqual({ sisyphus: { model: 'provider/model' } });
    expect(merged.theme).toBe('dark');
  });

  it('folds a legacy plugin key into plugins and keeps its entries', () => {
    const raw = JSON.stringify({ plugin: ['/legacy/plugin'], plugins: ['/other/plugin'] });
    const merged = JSON.parse(merge(raw, DESCRIPTOR));
    expect(merged.plugin).toBeUndefined();
    expect(merged.plugins).toEqual(['/legacy/plugin', '/other/plugin', [DIRECTORY, DESCRIPTOR]]);
  });

  it('keeps the existing error messages', () => {
    expect(() => merge('[]')).toThrow(
      'OPENCODE_CONFIG_CONTENT must contain a valid JSON object before Alcode can inject its managed plugin',
    );
    expect(() => merge('{"plugins": 5}')).toThrow(
      'OPENCODE_CONFIG_CONTENT plugins must be an array before Alcode can inject its managed plugin',
    );
    expect(() => merge('{"plugin": 5}')).toThrow(
      'OPENCODE_CONFIG_CONTENT plugin must be an array before Alcode can inject its managed plugin',
    );
  });
});
