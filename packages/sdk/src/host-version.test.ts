import { describe, expect, test } from 'bun:test';

import {
  compareAlcodeVersions,
  hostMeetsAlcodeEngine,
  alcodeEngineMinimum,
  parseAlcodeVersion,
} from './host-version.ts';

describe('alcode host version', () => {
  test('parses core semver', () => {
    expect(parseAlcodeVersion('1.22.0')).toEqual({ major: 1, minor: 22, patch: 0 });
    expect(parseAlcodeVersion('v1.22.0-beta.1')).toEqual({ major: 1, minor: 22, patch: 0 });
    expect(parseAlcodeVersion('junk')).toBeNull();
  });

  test('compares versions', () => {
    expect(compareAlcodeVersions('1.22.0', '1.21.9')).toBeGreaterThan(0);
    expect(compareAlcodeVersions('1.22.0', '1.22.0')).toBe(0);
    expect(compareAlcodeVersions('1.21.0', '1.22.0')).toBeLessThan(0);
  });

  test('normalizes engines.alcode floors', () => {
    expect(alcodeEngineMinimum('1.22.0')).toBe('1.22.0');
    expect(alcodeEngineMinimum('>=1.22.0')).toBe('1.22.0');
    expect(alcodeEngineMinimum('^1.22.0')).toBeNull();
  });

  test('checks host against engines.alcode', () => {
    expect(hostMeetsAlcodeEngine('1.22.0', '>=1.22.0')).toBe(true);
    expect(hostMeetsAlcodeEngine('1.22.0', '1.22.0')).toBe(true);
    expect(hostMeetsAlcodeEngine('1.21.9', '>=1.22.0')).toBe(false);
    expect(hostMeetsAlcodeEngine('unknown', '>=1.22.0')).toBe(false);
  });
});
