import { describe, expect, test } from "bun:test"

import { createFakeHostClient, callArgs } from "./fake-host-client.ts"
import { normalizeTeamSpec } from "./normalize.ts"
import { spawnTeamMembers } from "./spawn-members.ts"

const directory = process.platform === "win32" ? "I:/work/project" : "/work/project"

function twoMemberSpec() {
  return normalizeTeamSpec(
    {
      name: "alpha",
      members: [
        { name: "cat", kind: "category", category: "general", prompt: "do the assigned work well" },
        { name: "agt", kind: "subagent_type", subagent_type: "sisyphus" },
      ],
    },
    "alpha",
  )
}

describe("spawnTeamMembers", () => {
  test("spawns each member as a real child session with its agent and model", async () => {
    const fake = createFakeHostClient()
    const spec = twoMemberSpec()

    const result = await spawnTeamMembers({
      spec,
      teamRunId: "run-1",
      parentSessionId: "ses_lead",
      directory,
      client: fake.client,
      maxParallel: 2,
      deadlineAt: Date.now() + 60_000,
      models: { agt: { providerID: "anthropic", modelID: "claude-opus" } },
    })

    expect(result.failure).toBeUndefined()
    expect(result.spawned.size).toBe(2)
    for (const member of result.spawned.values()) {
      expect(member.sessionId.startsWith("ses_fake_")).toBe(true)
      expect(fake.sessions.has(member.sessionId)).toBe(true)
    }

    const creates = fake.calls.filter((call) => call.method === "create")
    expect(creates).toHaveLength(2)
    for (const call of creates) {
      expect(callArgs(call)["body"]).toMatchObject({ parentID: "ses_lead" })
      expect(callArgs(call)["query"]).toMatchObject({ directory })
    }

    const agtSession = result.spawned.get("agt")
    const agtPrompt = fake.sessions.get(agtSession?.sessionId ?? "")?.prompts[0]
    expect(agtPrompt?.agent).toBe("sisyphus")
    expect(agtPrompt?.model).toEqual({ providerID: "anthropic", modelID: "claude-opus" })

    const catSession = result.spawned.get("cat")
    const catPrompt = fake.sessions.get(catSession?.sessionId ?? "")?.prompts[0]
    expect(catPrompt?.agent).toBeUndefined()
    expect(String(catPrompt?.parts?.[0]?.text)).toContain("cat")
  })

  test("reports member_start_rejected when session creation fails", async () => {
    const fake = createFakeHostClient({ createErrorMessage: "boom" })

    const result = await spawnTeamMembers({
      spec: twoMemberSpec(),
      teamRunId: "run-1",
      parentSessionId: "ses_lead",
      directory,
      client: fake.client,
      maxParallel: 2,
      deadlineAt: Date.now() + 60_000,
    })

    expect(result.failure?.code).toBe("member_start_rejected")
    expect(result.spawned.size).toBe(0)
    expect(fake.sessions.size).toBe(0)
  })

  test("rejects gate-only roles before creating any session", async () => {
    const fake = createFakeHostClient()
    const spec = normalizeTeamSpec(
      { name: "alpha", members: [{ name: "g", kind: "subagent_type", subagent_type: "omo-native-code-reviewer" }] },
      "alpha",
    )

    const result = await spawnTeamMembers({
      spec,
      teamRunId: "run-1",
      parentSessionId: "ses_lead",
      directory,
      client: fake.client,
      maxParallel: 1,
      deadlineAt: Date.now() + 60_000,
    })

    expect(result.failure?.code).toBe("member_start_rejected")
    expect(fake.sessions.size).toBe(0)
  })

  test("plan-gated members need session evidence, and start once it is proven", async () => {
    const spec = normalizeTeamSpec(
      { name: "alpha", members: [{ name: "p", kind: "subagent_type", subagent_type: "plan-consultant" }] },
      "alpha",
    )

    const deniedFake = createFakeHostClient()
    const denied = await spawnTeamMembers({
      spec,
      teamRunId: "run-1",
      parentSessionId: "ses_lead",
      directory,
      client: deniedFake.client,
      maxParallel: 1,
      deadlineAt: Date.now() + 60_000,
    })
    expect(denied.failure?.code).toBe("member_start_rejected")
    expect(deniedFake.sessions.size).toBe(0)

    const allowedFake = createFakeHostClient()
    const allowed = await spawnTeamMembers({
      spec,
      teamRunId: "run-1",
      parentSessionId: "ses_lead",
      directory,
      client: allowedFake.client,
      maxParallel: 1,
      deadlineAt: Date.now() + 60_000,
      planGate: { userRequestedPlan: true, planArtifactTouched: true, executeStarted: false },
    })
    expect(allowed.failure).toBeUndefined()
    expect(allowed.spawned.get("p")?.sessionId.startsWith("ses_fake_")).toBe(true)
  })
})
