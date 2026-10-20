/**
 * args.ts — parse native ULW tool inputs at the I/O boundary.
 *
 * Tool inputs arrive as `OmoJsonObject` (bounded JSON values). Each tool
 * parses its args with a zod schema first; any mismatch is refused with the
 * store's `INVALID_INPUT` usage error naming the fix, so every tool fails
 * the same way. The schema is the contract: no `typeof` narrowing.
 */

import { z } from "zod"

import { invalidInputError } from "../../ulw/errors.ts"
import type { OmoJsonObject } from "../../plugin-types.ts"

/** Non-empty trimmed text shared by every ULW id and brief field. */
export const NonEmptyText = z.string().trim().min(1)

/** Best-effort run id for refusal context; blank when the caller named none. */
export function runIdOf(toolArgs: OmoJsonObject): string {
  const parsed = z.object({ runId: z.string() }).safeParse(toolArgs)
  if (!parsed.success) return ""
  return parsed.data.runId
}

/** Refuses the call with the store's invalid-input error. */
export function refuseArgs(runId: string, hint: string): never {
  throw invalidInputError(runId, hint)
}
