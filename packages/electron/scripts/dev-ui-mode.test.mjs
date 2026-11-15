import { describe, expect, it } from 'bun:test';
import { resolveDevUiEnv } from './dev-ui-mode.mjs';

describe('dev UI mode', () => {
  it('serves the built shell from the server origin in bundled mode', () => {
    // The packaged origin (alcode-ui://app) is a different origin from the API, and the UI session cookie lives on
    // the API origin. Adopting both flags together is what keeps sessions and models loadable in bundled dev.
    expect(resolveDevUiEnv({ useBundledUi: true })).toEqual({
      ALCODE_ELECTRON_USE_BUNDLED_UI: '1',
      ALCODE_ELECTRON_LOAD_SERVER_UI: '1',
    });
  });

  it('leaves the plain dev launch untouched', () => {
    expect(resolveDevUiEnv({ useBundledUi: false })).toEqual({});
  });
});
