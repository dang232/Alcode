import { describe, expect, test } from "bun:test";

import { BuiltinAgentNameSchema } from "./agent-names";

// Guards the builtin agent id contract consumed by the web native catalog
// (packages/web/server/lib/agents/omo-native-catalog.js reads
// BuiltinAgentNameSchema.options), which static analysis cannot see.
describe("BuiltinAgentNameSchema", () => {
  test("accepts a known builtin agent id", () => {
    expect(BuiltinAgentNameSchema.parse("atlas")).toBe("atlas");
  });

  test("rejects an unknown agent id", () => {
    expect(BuiltinAgentNameSchema.safeParse("not-an-agent").success).toBe(false);
  });

  test("covers the plan gate agent ids", () => {
    expect(BuiltinAgentNameSchema.safeParse("plan-consultant").success).toBe(true);
    expect(BuiltinAgentNameSchema.safeParse("plan-reviewer").success).toBe(true);
  });
});
