import { z } from "zod"

export const BuiltinAgentNameSchema = z.enum([
  "sisyphus",
  "hephaestus",
  "prometheus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "metis",
  "momus",
  "atlas",
  "sisyphus-junior",
  "plan-consultant",
  "plan-reviewer",
  "omo-native-code-reviewer",
  "omo-native-qa-executor",
  "omo-native-gate-reviewer",
])

