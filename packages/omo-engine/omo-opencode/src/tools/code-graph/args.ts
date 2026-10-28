/**
 * args.ts — zod contract for the `code_graph` native tool.
 *
 * Every field is validated here at the I/O boundary; any mismatch is
 * refused through the shared `refuseArgs` convention, never thrown raw.
 */

import { z } from "zod"

export const CodeGraphOpSchema = z.enum(["status", "context", "search", "trace", "impact", "tests"])

export const CodeGraphSubjectKindSchema = z.enum(["file", "symbol", "changes", "query"])

export const CodeGraphArgsSchema = z.object({
  op: CodeGraphOpSchema,
  subject: z.string().trim().min(1).optional(),
  subjectKind: CodeGraphSubjectKindSchema.optional(),
  to: z.string().trim().min(1).optional(),
  depth: z.number().int().min(1).max(3).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  maxBytes: z.number().int().min(512).max(16384).optional(),
})

export type CodeGraphArgs = z.infer<typeof CodeGraphArgsSchema>

export type CodeGraphOp = CodeGraphArgs["op"]

export type CodeGraphSubjectKind = NonNullable<CodeGraphArgs["subjectKind"]>
