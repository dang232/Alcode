import { z } from "zod"
import type {
} from "../../../../openclaw-core/src/index.ts"

const OpenClawGatewaySchema = z.object({
  type: z.enum(["http", "command"]).default("http"),
  // HTTP specific
  url: z.string().optional(),
  method: z.string().default("POST"),
  headers: z.record(z.string(), z.string()).optional(),
  // Command specific
  command: z.string().optional(),
  // Shared
  timeout: z.number().optional(),
})

const OpenClawHookSchema = z.object({
  enabled: z.boolean().default(true),
  gateway: z.string(),
  instruction: z.string(),
})

const OpenClawReplyListenerConfigSchema = z.object({
  discordBotToken: z.string().optional(),
  discordChannelId: z.string().optional(),
  discordMention: z.string().optional(), // For allowed_mentions
  authorizedDiscordUserIds: z.array(z.string()).default([]),

  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),

  pollIntervalMs: z.number().default(3000),
  rateLimitPerMinute: z.number().default(10),
  maxMessageLength: z.number().default(500),
  includePrefix: z.boolean().default(true),
})

export const OpenClawConfigSchema = z.object({
  enabled: z.boolean().default(false),

  // Outbound Configuration
  gateways: z.record(z.string(), OpenClawGatewaySchema).default({}),
  hooks: z.record(z.string(), OpenClawHookSchema).default({}),

  // Inbound Configuration (Reply Listener)
  replyListener: OpenClawReplyListenerConfigSchema.optional(),
})

