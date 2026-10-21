/**
 * omo-native-entry.ts — dataDir plugin entrypoint for the materialized
 * OmO-native OpenCode plugin (id `omo-native`).
 *
 * Bundled by `packages/web/server/lib/omo-native/setup.regen.js` into a
 * single dependency-free file: the packaged app loads it with a bare
 * dynamic import, so this module must not introduce runtime imports the
 * bundler cannot inline (node: builtins only). The id stays `omo-native`
 * (the managed config names that directory); the engine's own plugin name
 * is separate and untouched.
 */
import { createPluginSetup } from "./plugin-setup";

const setup = createPluginSetup();

export default {
  id: "omo-native",
  setup,
};
