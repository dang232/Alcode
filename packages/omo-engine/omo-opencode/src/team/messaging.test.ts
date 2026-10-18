import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { TeamModeConfig } from "../../../team-core/src/config.ts"
import { buildEnvelope } from "../../../team-core/src/team-mailbox/poll.ts"
import {
  createRuntimeState,
  transitionRuntimeState,
} from "../../../team-core/src/team-state-store/index.ts"

import {
  ackMemberMessages,
  buildPeerMessageEnvelope,
  buildTeamMessage,
  listUnreadMemberMessages,
  pollMemberInbox,
  sendTeamMessage,
} from "./messaging"
import type { MessagingEngineDeps } from "./messaging"
import { normalizeNativeTeamSpec, toTeamCoreConfig } from "./runtime-config"

const TEAM_RUN_ID = "44444444-4444-4444-4444-444444444444"

let baseDir: string
let config: TeamModeConfig

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "omo-messaging-"))
  config = toTeamCoreConfig({ max_members: 8, max_parallel_members: 4, max_wall_clock_minutes: 120 }, baseDir)
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

function depsFor(activeMembers: readonly string[]): MessagingEngineDeps {
  return {
    teamRunId: TEAM_RUN_ID,
    config,
    activeMembers,
    now: () => 1700000000000,
    newMessageId: () => "55555555-5555-5555-9555-555555555555",
  }
}

describe("team messaging", () => {
  test("#given fixed clocks #when built #then the message is deterministic", () => {
    // when
    const message = buildTeamMessage(
      { from: "lead", to: "alpha", body: "hello" },
      { now: () => 42, newMessageId: () => "55555555-5555-5555-9555-555555555555" },
    )

    // then
    expect(message).toEqual({
      version: 1,
      messageId: "55555555-5555-5555-9555-555555555555",
      from: "lead",
      to: "alpha",
      kind: "message",
      body: "hello",
      timestamp: 42,
    })
  })

  test("#given a member message #when enveloped #then it matches the team-core envelope", () => {
    // given
    const message = buildTeamMessage(
      { from: "lead", to: "alpha", body: "hi <there>", summary: "greet" },
      { now: () => 7, newMessageId: () => "55555555-5555-5555-9555-555555555555" },
    )

    // when / then
    expect(buildPeerMessageEnvelope(message)).toBe(buildEnvelope(message))
  })

  test("#given a lead message #when sent to a member #then it lands in the member inbox", async () => {
    // when
    const sent = await sendTeamMessage({ from: "lead", to: "alpha", body: "work now" }, depsFor(["alpha"]))

    // then
    expect(sent.kind).toBe("to_members")
    if (sent.kind !== "to_members") throw new Error("expected to_members")
    expect(sent.recipients).toEqual(["alpha"])
    const unread = await listUnreadMemberMessages(TEAM_RUN_ID, "alpha", config)
    expect(unread.map((message) => message.body)).toEqual(["work now"])

    // when acknowledged
    await ackMemberMessages(TEAM_RUN_ID, "alpha", [sent.messageId], config)

    // then
    expect(await listUnreadMemberMessages(TEAM_RUN_ID, "alpha", config)).toEqual([])
  })

  test("#given a member message #when sent to the lead #then it lands in the lead inbox", async () => {
    // when
    const sent = await sendTeamMessage({ from: "alpha", to: "lead", body: "done" }, depsFor(["alpha"]))

    // then
    expect(sent).toEqual({ kind: "to_lead", messageId: sent.messageId })
    const unread = await listUnreadMemberMessages(TEAM_RUN_ID, "lead", config)
    expect(unread.map((message) => message.body)).toEqual(["done"])
  })

  test("#given a non-lead broadcast #when sent #then it is rejected", async () => {
    // when / then
    await expect(
      sendTeamMessage({ from: "alpha", to: "*", body: "all" }, depsFor(["alpha", "beta"])),
    ).rejects.toThrow(expect.objectContaining({ name: "BroadcastNotPermittedError" }))
  })

  test("#given an unknown recipient #when sent #then the stable invalid-recipient name is kept", async () => {
    // when / then
    await expect(
      sendTeamMessage({ from: "lead", to: "ghost", body: "hi" }, depsFor(["alpha"])),
    ).rejects.toThrow(expect.objectContaining({ name: "InvalidRecipientError" }))
  })

  test("#given an empty inbox #when polled #then no injection is claimed", async () => {
    // given a live runtime with no messages
    const created = await createRuntimeState(
      normalizeNativeTeamSpec(
        { members: [{ name: "alpha", kind: "category", category: "quick", prompt: "do work" }] },
        "squad",
      ),
      "lead-session",
      "user",
      config,
    )
    await transitionRuntimeState(created.teamRunId, (state) => ({ ...state, status: "active" as const }), config)

    // when
    const result = await pollMemberInbox("session-1", "alpha", created.teamRunId, config, "turn-1")

    // then
    expect(result.injected).toBe(false)
    expect(result.messageIds).toEqual([])
  })
})
