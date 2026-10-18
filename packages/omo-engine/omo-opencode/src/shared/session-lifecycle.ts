import type { PluginInput } from "@opencode-ai/plugin"

type OpencodeClient = PluginInput["client"]

export type CancelChildSessionArgs = {
  /** Parent session that owns the delegation (receives the no-wake note). */
  parentSessionID: string
  /** Running child session to interrupt. */
  childSessionID: string
  /** Working directory both sessions belong to (stamped on every call). */
  directory: string
  /** Human reason recorded in the note; defaults to a generic user stop. */
  reason?: string
}

function childCancellationNoteText(childSessionID: string, reason: string): string {
  return (
    `The user stopped the work delegated to child session ${childSessionID} (${reason}). ` +
    `The interruption OpenCode reports for that session is this stop, not an error. ` +
    `Leave its partial work as-is and report the stop to the user.`
  )
}

/**
 * Cancels a running child session the note-first way: a synthetic note that
 * does not wake the parent is delivered first, and the child is interrupted
 * only once the note is in. Resolves true when a running turn was
 * interrupted, false when nothing was running. Throws when either step
 * fails — and the child is never interrupted when the note could not be
 * delivered, so the parent is never left to misread the interruption.
 */
export async function cancelChildSession(
  client: OpencodeClient,
  args: CancelChildSessionArgs,
): Promise<boolean> {
  const { parentSessionID, childSessionID, directory, reason } = args
  if (!parentSessionID) {
    throw new Error("parent session id is required to cancel a child session")
  }
  if (!childSessionID) {
    throw new Error("child session id is required to cancel a child session")
  }
  if (!directory) {
    throw new Error("directory is required to cancel a child session")
  }

  await client.session.synthetic({
    sessionID: parentSessionID,
    text: childCancellationNoteText(childSessionID, reason ?? "user stop"),
    description: "child-cancellation-note",
    resume: false,
    query: { directory },
  })

  const result = await client.session.interrupt({
    sessionID: childSessionID,
    query: { directory },
  })
  return result.interrupted
}
