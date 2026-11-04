import { z } from "zod"

const PermissionValueSchema = z.enum(["ask", "allow", "deny"])

const BashPermissionSchema = z.union([
  PermissionValueSchema,
  z.record(z.string(), PermissionValueSchema),
])

export const AgentPermissionSchema = z.object({
  edit: PermissionValueSchema.optional(),
  bash: BashPermissionSchema.optional(),
  webfetch: PermissionValueSchema.optional(),
  task: PermissionValueSchema.optional(),
  doom_loop: PermissionValueSchema.optional(),
  external_directory: PermissionValueSchema.optional(),
}).catchall(PermissionValueSchema.optional())

