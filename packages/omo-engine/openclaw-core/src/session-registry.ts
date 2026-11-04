import { MAX_AGE_MS } from "./session-registry-paths"
import { withRegistryLock, withRegistryLockOrWait } from "./session-registry-lock"
import { readAllMappingsUnsafe, rewriteRegistryUnsafe } from "./session-registry-storage"
import type { SessionMapping } from "./session-registry-types"

function loadAllMappings(): SessionMapping[] {
  return withRegistryLockOrWait(
    () => readAllMappingsUnsafe(),
    () => [],
  )
}

export function lookupByMessageId(platform: string, messageId: string): SessionMapping | null {
  const mappings = loadAllMappings()
  return mappings.find((mapping) => mapping.platform === platform && mapping.messageId === messageId) || null
}

export function removeMessagesByPane(paneId: string): void {
  withRegistryLock(
    () => {
      const mappings = readAllMappingsUnsafe()
      const filtered = mappings.filter((mapping) => mapping.tmuxPaneId !== paneId)
      if (filtered.length === mappings.length) return
      rewriteRegistryUnsafe(filtered)
    },
    () => {},
  )
}

export function pruneStale(): void {
  withRegistryLock(
    () => {
      const now = Date.now()
      const mappings = readAllMappingsUnsafe()
      const filtered = mappings.filter((mapping) => {
        const age = now - new Date(mapping.createdAt).getTime()
        return age < MAX_AGE_MS
      })
      if (filtered.length === mappings.length) return
      rewriteRegistryUnsafe(filtered)
    },
    () => {},
  )
}
