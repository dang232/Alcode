import { z } from "zod"

export const AnyMcpNameSchema = z.string().min(1)

