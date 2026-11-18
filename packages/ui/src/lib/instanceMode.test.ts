import { describe, expect, test } from 'bun:test';

import { classifyServerUrl, instanceModeLabelKey } from './instanceMode';

const mode = (input: string) => {
  const result = classifyServerUrl(input);
  return result.ok ? result.mode : result.code;
};

describe('classifyServerUrl modes', () => {
  test('loopback addresses are this computer', () => {
    expect(mode('http://127.0.0.1:57123')).toBe('local');
    expect(mode('http://127.9.9.9/')).toBe('local');
    expect(mode('http://localhost:3000')).toBe('local');
    expect(mode('http://[::1]:57123')).toBe('local');
  });

  test('private and link-local addresses are the local network', () => {
    expect(mode('http://192.168.1.20:57123')).toBe('lan');
    expect(mode('http://10.0.0.5:57123')).toBe('lan');
    expect(mode('http://172.20.1.4')).toBe('lan');
    expect(mode('http://169.254.10.1')).toBe('lan');
    expect(mode('http://mybox.local:57123')).toBe('lan');
    expect(mode('http://mybox:57123')).toBe('lan');
  });

  test('a public address is a server on the internet', () => {
    expect(mode('https://alcode.example.com')).toBe('vps');
    expect(mode('http://203.0.113.9:57123')).toBe('vps');
    expect(mode('http://172.32.1.4')).toBe('vps');
  });
});

describe('classifyServerUrl rejections', () => {
  test('names the reason an address cannot be a server', () => {
    expect(mode('')).toBe('empty');
    expect(mode('   ')).toBe('empty');
    expect(mode('not a url')).toBe('invalid');
    expect(mode('ftp://example.com')).toBe('protocol');
    expect(mode('http://user:secret@example.com')).toBe('credentials');
    expect(mode('http://example.com/#fragment')).toBe('fragment');
  });
});

describe('classifyServerUrl normalization', () => {
  test('drops a trailing slash but keeps a base path', () => {
    const root = classifyServerUrl('https://example.com/');
    expect(root.ok && root.url).toBe('https://example.com');
    const path = classifyServerUrl('https://example.com/base/');
    expect(path.ok && path.url).toBe('https://example.com/base');
  });

  test('keeps the port and reports the host', () => {
    const result = classifyServerUrl('http://192.168.1.20:57123');
    expect(result.ok && result.host).toBe('192.168.1.20');
    expect(result.ok && result.url).toBe('http://192.168.1.20:57123');
  });
});

describe('instanceModeLabelKey', () => {
  test('keeps one label key per mode', () => {
    expect(instanceModeLabelKey('local')).toBe('instanceMode.local');
    expect(instanceModeLabelKey('lan')).toBe('instanceMode.lan');
    expect(instanceModeLabelKey('vps')).toBe('instanceMode.vps');
  });
});
