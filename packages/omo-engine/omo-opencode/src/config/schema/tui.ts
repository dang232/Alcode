import { z } from "zod"

const TuiSidebarConfigSchema = z.object({
  enabled: z.boolean().default(true),
})

export const TuiConfigSchema = z.object({
  sidebar: TuiSidebarConfigSchema.default({ enabled: true }),
})

