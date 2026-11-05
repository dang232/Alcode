import { z } from "zod"

const KeywordTypeSchema = z.enum(["ultrawork", "team", "hyperplan", "hyperplan-ultrawork"])

export const KeywordDetectorConfigSchema = z.object({
  enabled_expansions: z.array(KeywordTypeSchema).optional(),
  disabled_keywords: z.array(KeywordTypeSchema).optional(),
})

