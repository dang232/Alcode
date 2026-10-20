/**
 * index.ts — native plugin entry the pinned OpenCode binary loads.
 *
 * Assembles the module through the testable factory so production and
 * tests share one path. The default export is the dual V1+V2 shape the
 * host requires: `server` is today's V1 implementation untouched, and
 * `setup` runs the same init chain translated onto the V2 `ctx` domains
 * (see plugin-setup.ts). The named export is the V1 server hook table.
 *
 * No `@opencode/plugin` import: a plain object with `id` + `setup`
 * satisfies the V2 host schema.
 */

import type { PluginModule } from "@opencode-ai/plugin";
import { createPluginSetup } from "./plugin-setup";
import { createPluginModule } from "./testing/create-plugin-module";

const pluginModule: PluginModule = createPluginModule();

export const omoPlugin = pluginModule.server;

export const omoSetup = createPluginSetup();

export default {
  id: pluginModule.id,
  setup: omoSetup,
  server: pluginModule.server,
};
