import { describe, expect, test } from "bun:test"
import { cancelChildSession } from "./session-lifecycle"

type Call = { method: string; args: unknown }

function fakeClient(behavior: {
  synthetic?: (args: unknown) => Promise<unknown>
  interrupt?: (args: unknown) => Promise<{ interrupted: boolean }>
}) {
  const calls: Call[] = []
  return {
    calls,
    client: {
      session: {
        synthetic: (args: unknown) => {
          calls.push({ method: "synthetic", args })
          return (behavior.synthetic ?? (() => Promise.resolve({}))) (args)
        },
        interrupt: (args: unknown) => {
          calls.push({ method: "interrupt", args })
          return (behavior.interrupt ?? (() => Promise.resolve({ interrupted: true }))) (args)
        },
      },
    },
  }
}

const baseArgs = {
  parentSessionID: "ses_parent",
  childSessionID: "ses_child",
  directory: "I:/work/project",
}

describe("cancelChildSession", () => {
  test("delivers the no-wake note before interrupting, then resolves true", async () => {
    const { calls, client } = fakeClient({})

    const result = await cancelChildSession(client as never, baseArgs)

    expect(result).toBe(true)
    expect(calls.map((call) => call.method)).toEqual(["synthetic", "interrupt"])
    const note = (calls[0]?.args ?? {}) as Record<string, unknown>
    expect(note["sessionID"]).toBe("ses_parent")
    expect(note["resume"]).toBe(false)
    expect(String(note["text"])).toContain("ses_child")
    expect((note["query"] as Record<string, unknown>)?.["directory"]).toBe("I:/work/project")
    const interruption = (calls[1]?.args ?? {}) as Record<string, unknown>
    expect(interruption["sessionID"]).toBe("ses_child")
  })

  test("never interrupts when the note cannot be delivered", async () => {
    const { calls, client } = fakeClient({
      synthetic: () => Promise.reject(new Error("synthetic failed")),
    })

    await expect(cancelChildSession(client as never, baseArgs)).rejects.toThrow("synthetic failed")
    expect(calls.map((call) => call.method)).toEqual(["synthetic"])
  })

  test("resolves false when nothing was running", async () => {
    const { client } = fakeClient({
      interrupt: () => Promise.resolve({ interrupted: false }),
    })

    const result = await cancelChildSession(client as never, baseArgs)

    expect(result).toBe(false)
  })

  test("rejects empty session ids and directory", async () => {
    const { calls, client } = fakeClient({})

    await expect(
      cancelChildSession(client as never, { ...baseArgs, parentSessionID: "" }),
    ).rejects.toThrow("parent session id is required")
    await expect(
      cancelChildSession(client as never, { ...baseArgs, childSessionID: "" }),
    ).rejects.toThrow("child session id is required")
    await expect(
      cancelChildSession(client as never, { ...baseArgs, directory: "" }),
    ).rejects.toThrow("directory is required")
    expect(calls).toEqual([])
  })
})
