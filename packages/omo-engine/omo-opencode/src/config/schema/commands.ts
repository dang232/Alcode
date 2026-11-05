import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
 "goal",
 "refactor",
 "ulw-execute",
 "stop-continuation",
 "remove-ai-slops",
 "hyperplan",
])

