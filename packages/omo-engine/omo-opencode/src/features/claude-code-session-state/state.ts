

export const subagentSessions = new Set<string>()

let _mainSessionID: string | undefined

const sessionAgentMap = new Map<string, string>()

export function getSessionAgent(sessionID: string): string | undefined {
  return sessionAgentMap.get(sessionID)
}

