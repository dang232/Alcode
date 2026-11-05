

import type { OhMyOpenCodeConfig } from "../config"
import { stripInvisibleAgentCharacters } from "./agent-display-names"

type ReasoningConfig = {
  reasoning?: string
  variant?: string
  category?: string
}

function findAgentOverride(
  config: OhMyOpenCodeConfig,
  agentName: string,
): ReasoningConfig | undefined {
  const stripped = stripInvisibleAgentCharacters(agentName)
  const agentOverrides = config.agents as Record<string, ReasoningConfig> | undefined
  return agentOverrides
    ? agentOverrides[stripped]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === stripped.toLowerCase())?.[1]
    : undefined
}

function getCategoryConfig(
  config: OhMyOpenCodeConfig,
  categoryName: string | undefined,
): ReasoningConfig | undefined {
  return categoryName ? config.categories?.[categoryName] : undefined
}

export function resolveAgentVariant(
  config: OhMyOpenCodeConfig,
  agentName?: string,
): string | undefined {
  if (!agentName) return undefined

  const agentOverride = findAgentOverride(config, agentName)
  if (!agentOverride) return undefined

  const categoryConfig = getCategoryConfig(config, agentOverride.category)
  return agentOverride.reasoning
    ?? categoryConfig?.reasoning
    ?? agentOverride.variant
    ?? categoryConfig?.variant
}

