import { describe, expect, test } from 'bun:test';

import {
  getDirectoryForFilePath,
  getRelativeFilePath,
  isAbsoluteFilePath,
  isFilePathWithinDirectory,
  normalizeFilePath,
  toAbsoluteFilePath,
} from './path-utils';

describe('path-utils', () => {
  test('normalizes Windows paths without losing drive roots', () => {
    expect(normalizeFilePath('C:\\Users\\Bohdan Triapitsyn\\projects\\alcode\\')).toBe('C:/Users/Bohdan Triapitsyn/projects/alcode');
    expect(normalizeFilePath('C:/')).toBe('C:/');
    expect(normalizeFilePath('\\\\server\\share\\project')).toBe('//server/share/project');
  });

  test('recognizes Windows absolute paths', () => {
    expect(isAbsoluteFilePath('C:/Users/file.ts')).toBe(true);
    expect(isAbsoluteFilePath('C:\\Users\\file.ts')).toBe(true);
    expect(isAbsoluteFilePath('C:relative/file.ts')).toBe(false);
    expect(isAbsoluteFilePath('src/file.ts')).toBe(false);
  });

  test('strips the leading slash from a bare Windows drive reference', () => {
    // RFC 8089 E.2.1 form: a markdown href like /C:/... reaches the resolver
    // with a leading slash. Windows would read the unslashed path as C:\C:\...
    expect(normalizeFilePath('/C:/Users/test/report.html')).toBe('C:/Users/test/report.html');
    expect(normalizeFilePath('/c:/Users/test/report.html')).toBe('c:/Users/test/report.html');
    expect(isAbsoluteFilePath('/C:/Users/file.ts')).toBe(true);
  });

  test('treats a slashed drive reference as inside its Windows directory', () => {
    expect(isFilePathWithinDirectory('/C:/example/project/package.json', 'C:/example/project')).toBe(true);
  });

  test('does not prefix Windows absolute targets with the workspace directory', () => {
    expect(toAbsoluteFilePath('C:/Users/Bohdan Triapitsyn/projects/alcode', 'C:/Users/Bohdan Triapitsyn/projects/alcode/packages/ui/Button.tsx')).toBe(
      'C:/Users/Bohdan Triapitsyn/projects/alcode/packages/ui/Button.tsx',
    );
  });

  test('joins relative targets under Windows workspaces', () => {
    expect(toAbsoluteFilePath('C:/Users/Bohdan Triapitsyn/projects/alcode', 'packages/ui/Button.tsx')).toBe(
      'C:/Users/Bohdan Triapitsyn/projects/alcode/packages/ui/Button.tsx',
    );
    expect(toAbsoluteFilePath('C:/Users/Bohdan Triapitsyn/projects/alcode/packages/ui', '../web/package.json')).toBe(
      'C:/Users/Bohdan Triapitsyn/projects/alcode/packages/web/package.json',
    );
  });

  test('compares Windows workspace containment case-insensitively', () => {
    expect(isFilePathWithinDirectory(
      'c:/users/bohdan triapitsyn/projects/alcode/packages/ui/button.tsx',
      'C:/Users/Bohdan Triapitsyn/projects/alcode',
    )).toBe(true);
    expect(getRelativeFilePath(
      'C:/Users/Bohdan Triapitsyn/projects/alcode/packages/ui/Button.tsx',
      'c:/users/bohdan triapitsyn/projects/alcode',
    )).toBe('packages/ui/Button.tsx');
  });

  test('falls back to file parent when current directory does not contain the path', () => {
    expect(getDirectoryForFilePath(
      'C:/Users/Bohdan Triapitsyn/projects/other',
      'C:/Users/Bohdan Triapitsyn/projects/alcode/packages/ui/Button.tsx',
    )).toBe('C:/Users/Bohdan Triapitsyn/projects/alcode/packages/ui');
    expect(getDirectoryForFilePath('', '/tmp/file.txt')).toBe('/tmp');
  });
});
