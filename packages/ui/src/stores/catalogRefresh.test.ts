import { describe, expect, test } from "bun:test";

import { catalogRefreshTasks } from "./catalogRefresh";

describe("catalogRefreshTasks", () => {
  test("a config rebuild re-reads every list a config file can carry", () => {
    // Agents, commands, skills, MCP servers, plugins and providers all live
    // in config, and Alcode's own plugin injection is one of them. So
    // does the web search choice.
    expect(catalogRefreshTasks("config")).toHaveLength(7);
  });

  test("a single-catalog rebuild re-reads only that list", () => {
    for (const kind of ["agent", "command", "skill", "plugin", "websearch"] as const) {
      expect(catalogRefreshTasks(kind)).toHaveLength(1);
    }
  });

  test("a provider/model announcement also re-reads agents for warmed locations", () => {
    // `provider.updated` / `model.updated` announce that a cold location
    // finished warming. An agent list read in the cold window answers empty
    // or partial and no later event corrects it, so the directories named by
    // the event re-read agents alongside providers.
    expect(catalogRefreshTasks("provider")).toHaveLength(2);
    expect(catalogRefreshTasks("model")).toHaveLength(2);
  });

  test("a credential change re-reads providers and web search keys", () => {
    expect(catalogRefreshTasks("credential")).toHaveLength(2);
  });

  test("projects belong to the sync stores, not to the settings lists", () => {
    expect(catalogRefreshTasks("project")).toEqual([]);
  });
});
