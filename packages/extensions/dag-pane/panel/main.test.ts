// Panel honesty regression tests: the DAG view never states what it does
// not know.
//
// (1) A Code graph node with no edges and no evidence must render an
// explicit unknown/unproven marker in the inspector, never confidence 1.
// (2) A details card opened on a panel guess (no user selection) must be
// badged auto-selected, so it never looks identical to a user selection.
//
// main.ts is the guest iframe entry: it boots on import (guarded here with
// a minimal document stub) and talks to the host through @alcode/sdk, which
// is stubbed at the module boundary — the honesty helpers under test are
// pure and never touch the SDK.

import { describe, expect, mock, test } from 'bun:test';

const noop = () => ({ dispose: () => {} });

mock.module('@alcode/sdk', () => ({
  connectHost: () => ({}),
}));

mock.module('@alcode/sdk/ui', () => ({
  applyHostReady: () => {},
  mountBadge: noop,
  mountBanner: noop,
  mountButton: noop,
  mountEmpty: noop,
  mountSpinner: noop,
  mountTextField: noop,
}));

// SAFETY: the guest boot guard reads global document.getElementById; the stub
// provides exactly that and nothing else, and the harness never navigates.
const testGlobals = globalThis as Record<string, { getElementById: (id: string) => null } | undefined>;
if (testGlobals.document === undefined) {
  testGlobals.document = { getElementById: () => null };
}

const panel = await import('./main.ts');

describe('inspector confidence honesty', () => {
  test('#given a node with no edges and no evidence #when formatted #then it renders an unknown marker, never 100 percent', () => {
    expect(panel.formatCodeConfidence(undefined)).toBe(panel.CODE_CONFIDENCE_UNKNOWN);
    expect(panel.formatCodeConfidence(undefined)).not.toBe('1');
  });

  test('#given measured edge confidence #when formatted #then the measured value renders as-is', () => {
    expect(panel.formatCodeConfidence(0.8)).toBe('0.8');
    expect(panel.formatCodeConfidence(1)).toBe('1');
  });
});

describe('details auto-selection honesty', () => {
  test('#given no user selection and a running node #when resolved #then the panel guess is badged auto-selected', () => {
    expect(panel.resolveDetailsSelection(['a', 'b'], 'b', null)).toEqual({ id: 'b', autoSelected: true });
  });

  test('#given no user selection and no running node #when resolved #then the first node is an auto-selected guess', () => {
    expect(panel.resolveDetailsSelection(['a', 'b'], null, null)).toEqual({ id: 'a', autoSelected: true });
  });

  test('#given an explicit user selection #when resolved #then it is never marked auto-selected', () => {
    expect(panel.resolveDetailsSelection(['a', 'b'], 'b', 'a')).toEqual({ id: 'a', autoSelected: false });
  });

  test('#given an empty run #when resolved #then there is no selection to badge', () => {
    expect(panel.resolveDetailsSelection([], null, null)).toEqual({ id: null, autoSelected: true });
  });
});
