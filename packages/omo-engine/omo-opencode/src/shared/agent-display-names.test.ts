import { describe, expect, test } from "bun:test";

import { AGENT_DISPLAY_NAMES, getAgentDisplayName } from "./agent-display-names";

// Guards the display-name contract consumed by the web native catalog
// (packages/web/server/lib/agents/omo-native-catalog.js reads
// AGENT_DISPLAY_NAMES), which static analysis cannot see. Display names
// travel in the x-opencode-agent-name HTTP header, so they must stay free
// of characters that are invalid in header values (notably parentheses).
describe("AGENT_DISPLAY_NAMES", () => {
  test("maps a known agent key to its display name", () => {
    expect(AGENT_DISPLAY_NAMES["atlas"]).toBe("Atlas - Plan Executor");
    expect(getAgentDisplayName("atlas")).toBe(AGENT_DISPLAY_NAMES["atlas"]);
  });

  test("falls back to the key for unknown agents", () => {
    expect(getAgentDisplayName("mystery-agent")).toBe("mystery-agent");
  });

  test("every display name is header-safe", () => {
    const entries = Object.entries(AGENT_DISPLAY_NAMES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, display] of entries) {
      expect(display.length).toBeGreaterThan(0);
      expect(display.includes("(")).toBe(false);
      expect(display.includes(")")).toBe(false);
    }
  });
});
