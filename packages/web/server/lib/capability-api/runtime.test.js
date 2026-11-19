import { describe, expect, it } from 'vitest';

import { buildCapabilityDescriptor, configureCapabilityBaseUrl, descriptorForDirectory, resolveAllowedAgents, resolveCapabilityDescriptor, resolveCapabilityToken } from './runtime.js';

describe('capability token', () => {
  it('uses the configured token when one is supplied', () => {
    expect(resolveCapabilityToken({ ALCODE_CAPABILITY_TOKEN: 'configured' })).toBe('configured');
  });

  it('generates and caches a per-process token when none is configured', () => {
    const first = resolveCapabilityToken({});
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(resolveCapabilityToken({})).toBe(first);
  });

  it('ignores an empty configured token', () => {
    expect(resolveCapabilityToken({ ALCODE_CAPABILITY_TOKEN: '   ' }).length).toBeGreaterThanOrEqual(32);
  });
});

describe('capability descriptor', () => {
  it('refuses to build without a url or a token', () => {
    expect(buildCapabilityDescriptor({})).toBeNull();
    expect(buildCapabilityDescriptor({ url: 'http://127.0.0.1:1' })).toBeNull();
    expect(buildCapabilityDescriptor({ token: 't' })).toBeNull();
  });

  it('refuses a non-http url', () => {
    expect(buildCapabilityDescriptor({ url: 'ftp://host', token: 't' })).toBeNull();
  });

  it('builds the versioned descriptor', () => {
    expect(buildCapabilityDescriptor({ url: 'http://127.0.0.1:3901', token: 't' })).toEqual({
      hostCapabilities: { version: 1, url: 'http://127.0.0.1:3901', token: 't' },
    });
  });

  it('publishes nothing when no url is configured', () => {
    expect(resolveCapabilityDescriptor({ ALCODE_CAPABILITY_TOKEN: 't' })).toBeNull();
  });

  it('publishes the descriptor when both url and token are configured', () => {
    const descriptor = resolveCapabilityDescriptor({ ALCODE_CAPABILITY_URL: 'http://127.0.0.1:3901', ALCODE_CAPABILITY_TOKEN: 't' });
    expect(descriptor?.hostCapabilities.url).toBe('http://127.0.0.1:3901');
  });
});

describe('allowed agents', () => {
  it('leaves the policy undefined when the environment names none', () => {
    expect(resolveAllowedAgents({})).toBeUndefined();
  });

  it('splits, trims and drops empty entries', () => {
    expect(resolveAllowedAgents({ OMO_CAPABILITY_ALLOWED_AGENTS: ' explore , librarian ,, ' })).toEqual(['explore', 'librarian']);
  });

  it('keeps a set-but-empty list as an empty policy', () => {
    expect(resolveAllowedAgents({ OMO_CAPABILITY_ALLOWED_AGENTS: '' })).toEqual([]);
    expect(resolveAllowedAgents({ OMO_CAPABILITY_ALLOWED_AGENTS: ',' })).toEqual([]);
  });

  it('carries the list in the descriptor only when it is defined', () => {
    const named = buildCapabilityDescriptor({ url: 'http://127.0.0.1:3901', token: 't', allowedAgents: ['explore'] });
    const empty = buildCapabilityDescriptor({ url: 'http://127.0.0.1:3901', token: 't', allowedAgents: [] });
    const absent = buildCapabilityDescriptor({ url: 'http://127.0.0.1:3901', token: 't' });

    expect(named.hostCapabilities.allowedAgents).toEqual(['explore']);
    expect(empty.hostCapabilities.allowedAgents).toEqual([]);
    expect(absent.hostCapabilities).not.toHaveProperty('allowedAgents');
  });

  it('reads the list into both descriptor entry points', () => {
    const env = {
      ALCODE_CAPABILITY_URL: 'http://127.0.0.1:3901',
      ALCODE_CAPABILITY_TOKEN: 't',
      OMO_CAPABILITY_ALLOWED_AGENTS: 'explore,librarian',
    };

    expect(resolveCapabilityDescriptor(env).hostCapabilities.allowedAgents).toEqual(['explore', 'librarian']);
    expect(descriptorForDirectory('/data/omo-native/omo-native', env).hostCapabilities.allowedAgents).toEqual(['explore', 'librarian']);

    const unset = resolveCapabilityDescriptor({ ALCODE_CAPABILITY_URL: 'http://127.0.0.1:3901', ALCODE_CAPABILITY_TOKEN: 't' });
    expect(unset.hostCapabilities).not.toHaveProperty('allowedAgents');
  });
});

describe('descriptor targeting', () => {
  const env = { ALCODE_CAPABILITY_URL: 'http://127.0.0.1:3901', ALCODE_CAPABILITY_TOKEN: 't' };

  it('targets the native plugin directory only', () => {
    expect(descriptorForDirectory('/data/omo-native/omo-native', env)).not.toBeNull();
    expect(descriptorForDirectory('C:\\data\\omo-native\\omo-native', env)).not.toBeNull();
  });

  it('leaves every other managed plugin without options', () => {
    expect(descriptorForDirectory('/data/plugins/alcode-agent-tool', env)).toBeNull();
    expect(descriptorForDirectory('/data/omo-native', env)).toBeNull();
    expect(descriptorForDirectory(undefined, env)).toBeNull();
  });
});

describe('configured capability base', () => {
  it('publishes the descriptor from the configured base when the environment names none', () => {
    configureCapabilityBaseUrl('http://127.0.0.1:57123');
    try {
      const descriptor = resolveCapabilityDescriptor({});
      expect(descriptor.hostCapabilities.url).toBe('http://127.0.0.1:57123');
      expect(typeof descriptor.hostCapabilities.token).toBe('string');
    } finally {
      configureCapabilityBaseUrl(null);
    }
  });

  it('lets explicit configuration win over the configured base', () => {
    configureCapabilityBaseUrl('http://127.0.0.1:57123');
    try {
      const descriptor = resolveCapabilityDescriptor({ ALCODE_CAPABILITY_URL: 'https://fronted.example', ALCODE_CAPABILITY_TOKEN: 't' });
      expect(descriptor.hostCapabilities.url).toBe('https://fronted.example');
      expect(descriptor.hostCapabilities.token).toBe('t');
    } finally {
      configureCapabilityBaseUrl(null);
    }
  });

  it('publishes nothing when neither is set', () => {
    configureCapabilityBaseUrl(null);
    expect(resolveCapabilityDescriptor({})).toBeNull();
  });
});
