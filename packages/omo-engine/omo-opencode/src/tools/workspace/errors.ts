/**
 * errors.ts — refusals raised by the native workspace tools.
 *
 * A refusal names what the caller must change (the path, the range, the size),
 * so a model can correct the call instead of retrying the same one. The code is
 * stable so a host can branch on it without parsing the message.
 */

export type WorkspaceToolErrorCode =
  | "INVALID_INPUT"
  | "PATH_OUTSIDE_WORKSPACE"
  | "NOT_FOUND"
  | "NOT_A_FILE"
  | "TOO_LARGE"
  | "BINARY_CONTENT"
  | "IO_FAILED"
  | "UNAUTHENTICATED"
  | "APPROVAL_DENIED"

export class WorkspaceToolError extends Error {
  readonly code: WorkspaceToolErrorCode
  readonly path: string

  constructor(message: string, code: WorkspaceToolErrorCode, path: string) {
    super(message)
    this.name = "WorkspaceToolError"
    this.code = code
    this.path = path
  }
}

/** Refuses a path that cannot be used, naming the reason the caller can fix. */
export function workspacePathRefused(path: string, reason: string): never {
  throw new WorkspaceToolError(`Refused '${path}': ${reason}.`, "PATH_OUTSIDE_WORKSPACE", path)
}

/** Refuses invalid arguments (bad range, blank path, wrong type). */
export function workspaceInputRefused(path: string, reason: string): never {
  throw new WorkspaceToolError(`Invalid arguments for '${path}': ${reason}.`, "INVALID_INPUT", path)
}

/** Refuses a path that does not exist. */
export function workspaceNotFound(path: string): never {
  throw new WorkspaceToolError(`Not found in the workspace: '${path}'.`, "NOT_FOUND", path)
}

/** Refuses a read of a directory. */
export function workspaceNotAFile(path: string): never {
  throw new WorkspaceToolError(`'${path}' is a directory, not a file.`, "NOT_A_FILE", path)
}

/** Refuses content beyond the tool's bounded read. */
export function workspaceTooLarge(path: string, bytes: number, limit: number): never {
  throw new WorkspaceToolError(
    `'${path}' is ${bytes} bytes; read at most ${limit} bytes by requesting a smaller range.`,
    "TOO_LARGE",
    path,
  )
}

/** Refuses content that is not text. */
export function workspaceBinary(path: string): never {
  throw new WorkspaceToolError(`'${path}' is not text; this tool returns text only.`, "BINARY_CONTENT", path)
}

/** Refuses after the filesystem reported a failure. */
export function workspaceIoFailed(path: string, reason: string): never {
  throw new WorkspaceToolError(`Could not read '${path}': ${reason}.`, "IO_FAILED", path)
}

/** Refuses when the host did not supply an authenticated caller identity. */
export function workspaceUnauthenticated(tool: string): never {
  throw new WorkspaceToolError(
    `The host supplied no authenticated session for '${tool}'; refusing to act on an unidentified caller.`,
    "UNAUTHENTICATED",
    tool,
  )
}

/** Refuses when the host's approval surface declined the operation. */
export function workspaceApprovalDenied(tool: string, reason: string): never {
  throw new WorkspaceToolError(`The host did not approve '${tool}': ${reason}.`, "APPROVAL_DENIED", tool)
}
