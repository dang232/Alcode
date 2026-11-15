import { describe, expect, test } from 'bun:test';
import { fetchConnectedServerVersion, isServerBeforeOpenCode2 } from './serverCompatibility';

const answer = (status: number, body: string) => async () => new Response(body, { status });

describe('isServerBeforeOpenCode2', () => {
  test('flags only a server whose major version is below 2', () => {
    expect(isServerBeforeOpenCode2('1.24.2')).toBe(true);
    expect(isServerBeforeOpenCode2('0.9.0')).toBe(true);
    expect(isServerBeforeOpenCode2('2.0.0')).toBe(false);
    expect(isServerBeforeOpenCode2('2.1.1')).toBe(false);
    expect(isServerBeforeOpenCode2('10.0.0')).toBe(false);
  });

  test('does not flag a version it cannot read', () => {
    expect(isServerBeforeOpenCode2('unknown')).toBe(false);
    expect(isServerBeforeOpenCode2('')).toBe(false);
  });
});

describe('fetchConnectedServerVersion', () => {
  const signal = new AbortController().signal;

  test('reads the version the server reports', async () => {
    expect(await fetchConnectedServerVersion(signal, answer(200, JSON.stringify({ status: 'ok', openchamberVersion: ' 1.24.2 ' }))))
      .toBe('1.24.2');
  });

  test('says nothing for a failed request, a web page, or a missing field', async () => {
    expect(await fetchConnectedServerVersion(signal, answer(500, '{}'))).toBeNull();
    expect(await fetchConnectedServerVersion(signal, answer(200, '<!doctype html>'))).toBeNull();
    expect(await fetchConnectedServerVersion(signal, answer(200, JSON.stringify({ status: 'ok' })))).toBeNull();
  });
});

describe('fetchConnectedServerVersion picks the number the guard is about', () => {
  const versionBody = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

  test('reads the OpenCode version the server reports, not the product version', async () => {
    const version = await fetchConnectedServerVersion(
      new AbortController().signal,
      versionBody({ alcodeVersion: '0.2.3', openchamberVersion: '0.2.3', compatibility: { version: '2.1.4', minimumVersion: '2.0.20' } }),
    );

    expect(version).toBe('2.1.4');
    if (version === null) throw new Error('expected the OpenCode version');
    expect(isServerBeforeOpenCode2(version)).toBe(false);
  });

  test('still flags a server whose OpenCode really is 1.x', async () => {
    const version = await fetchConnectedServerVersion(
      new AbortController().signal,
      versionBody({ openchamberVersion: '0.2.3', compatibility: { version: '1.24.2' } }),
    );

    expect(version).toBe('1.24.2');
    if (version === null) throw new Error('expected the OpenCode version');
    expect(isServerBeforeOpenCode2(version)).toBe(true);
  });

  test('says nothing when the server reports compatibility without a version', async () => {
    const version = await fetchConnectedServerVersion(
      new AbortController().signal,
      versionBody({ openchamberVersion: '0.2.3', compatibility: { version: null } }),
    );

    expect(version).toBeNull();
  });

  test('falls back to the product version for servers that predate the compatibility block', async () => {
    const version = await fetchConnectedServerVersion(
      new AbortController().signal,
      versionBody({ openchamberVersion: '2.3.0' }),
    );

    expect(version).toBe('2.3.0');
  });
});
