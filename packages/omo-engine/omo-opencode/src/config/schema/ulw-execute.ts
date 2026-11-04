import { z } from "zod"

export const UlwExecuteConfigSchema = z.object({
  auto_commit: z.boolean().default(true),
})

