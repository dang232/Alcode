import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import { createRuntimeState } from "../../../team-core/src/team-state-store/store.ts"

import { normalizeTeamSpec } from "./normalize.ts"
import { TeamRuntimeError } from "./runtime-errors.ts"
import { approveShutdown, rejectShutdown, requestShutdown, type ShutdownOutboundMessage } from "./shutdown.ts"

function testConfig(baseDir: string): TeamModeConfig {
  return {
    enabled: true,
    tmux_visualization: false,
    max_members: 8,
    max_parallel_members: 4,
    max_wall_clock_minutes: 120,
    base_dir: baseDir,
    max_messages_per_run: 10000,
    max_member_turns: 500,
    message_payload_max_bytes: 32768,
    recipient_unread_max_bytes: 262144,
    mailbox_poll_interval_ms: 3000,
  }
}

async function seedTeam(): Promise<{ config: TeamModeConfig; teamRunId: string }> {
  const baseDir = join(await mkdtemp(join(tmpdir(), "team-shutdown-")), "teams")
  await import("node:fs/promises").then((fs) => fs.mkdir(baseDir, { recursive: true }))
  const config = testConfig(baseDir)
  const spec = normalizeTeamSpec(
    {
      name: "alpha",
      members: [
        { name: "cat", kind: "category", category: "general", prompt: "do the assigned work well" },
        { name: "agt", kind: "subagent_type", subagent_type: "sisyphus" },
      ],
    },
    "alpha",
  )
  const state = await createRuntimeState(spec, "ses_lead", "project", config)
  return { config, teamRunId: state.teamRunId }
}

describe("team shutdown handshake", () => {
  test("request records a pending shutdown request and notifies the member", async () => {
    const { config, teamRunId } = await seedTeam()
    const sent: ShutdownOutboundMessage[] = []

    const state = await requestShutdown(teamRunId, "cat", {
      config,
      sendMessage: async (message) => {
        sent.push(message)
      },
    })

    expect(sent).toEqual([{ to: "cat", kind: "shutdown_request", body: "" }])
    expect(state.shutdownRequests).toHaveLength(1)
    expect(state.shutdownRequests[0]).toMatchObject({ memberId: "cat", requesterName: "lead" })
  })

  test("request for an unknown member errors", async () => {
    const { config, teamRunId } = await seedTeam()

    await expect(
      requestShutdown(teamRunId, "ghost", { config, sendMessage: async () => {} }),
    ).rejects.toMatchObject({ name: "TeamRuntimeError", code: "unknown_member" })
  })

  test("approve marks the member, cancels its session, and notifies it", async () => {
    const { config, teamRunId } = await seedTeam()
    const sent: ShutdownOutboundMessage[] = []
    const cancelled: { memberName: string; sessionId: string | undefined }[] = []
    await requestShutdown(teamRunId, "cat", { config, sendMessage: async () => {} })

    const state = await approveShutdown(teamRunId, "cat", {
      config,
      sendMessage: async (message) => {
        sent.push(message)
      },
      cancelMemberSession: async (memberName, sessionId) => {
        cancelled.push({ memberName, sessionId })
      },
    })

    expect(state.members.find((member) => member.name === "cat")?.status).toBe("shutdown_approved")
    expect(cancelled).toHaveLength(1)
    expect(cancelled[0]?.memberName).toBe("cat")
    expect(sent).toEqual([{ to: "cat", kind: "shutdown_approved", body: "cat" }])
  })

  test("approve without a pending request errors", async () => {
    const { config, teamRunId } = await seedTeam()

    await expect(
      approveShutdown(teamRunId, "cat", {
        config,
        sendMessage: async () => {},
        cancelMemberSession: async () => {},
      }),
    ).rejects.toBeInstanceOf(TeamRuntimeError)
  })

  test("reject records the reason and leaves the member live", async () => {
    const { config, teamRunId } = await seedTeam()
    const sent: ShutdownOutboundMessage[] = []
    await requestShutdown(teamRunId, "agt", { config, sendMessage: async () => {} })

    const state = await rejectShutdown(teamRunId, "agt", "keep working", {
      config,
      sendMessage: async (message) => {
        sent.push(message)
      },
    })

    expect(sent).toEqual([{ to: "agt", kind: "shutdown_rejected", body: "keep working" }])
    expect(state.shutdownRequests[0]).toMatchObject({ rejectedReason: "keep working" })
    expect(state.members.find((member) => member.name === "agt")?.status).toBe("pending")
  })
})
