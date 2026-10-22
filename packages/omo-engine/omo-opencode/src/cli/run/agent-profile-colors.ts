import { normalizeSDKResponse } from "../../shared"

interface AgentProfile {
  name?: string
  color?: string
}

interface AgentListClient {
  readonly app: {
    readonly agents: (directory?: string) => Promise<{ data?: Array<{ name?: string; color?: string }> }>
  }
}

export async function loadAgentProfileColors(
  client: AgentListClient,
  directory?: string,
): Promise<Record<string, string>> {
  try {
    const agentsRes = await client.app.agents(directory)
    const agents = normalizeSDKResponse(agentsRes, [] as AgentProfile[], {
      preferResponseOnMissingData: true,
    })

    const colors: Record<string, string> = {}
    for (const agent of agents) {
      if (!agent.name || !agent.color) continue
      colors[agent.name] = agent.color
    }

    return colors
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return {}
  }
}
