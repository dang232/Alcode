import pc from "picocolors"
import type { ServerConnection } from "./types"
import { getAvailableServerPort, isPortAvailable, DEFAULT_SERVER_PORT } from "../../shared/port-utils"
import { withWorkingOpencodePath } from "./opencode-binary-resolver"
import {
  createV2EngineClient,
  spawnManagedV2Server,
  type ManagedV2Server,
} from "./opencode-v2-client"

export type ServerConnectionOptions = {
  port?: number
  attach?: string
  signal: AbortSignal
}

export type ServerConnectionDeps<TClient> = {
  spawnManagedServer: (options: { port: number, signal: AbortSignal }) => Promise<ManagedV2Server>
  createEngineClient: (options: { baseUrl: string, password?: string }) => TClient
  isPortAvailable: (port: number, hostname?: string) => Promise<boolean>
  getAvailableServerPort: (preferredPort?: number, hostname?: string) => Promise<{ port: number, wasAutoSelected: boolean }>
  withWorkingOpencodePath: <T>(startServer: () => Promise<T>) => Promise<T>
}

const defaultDeps: ServerConnectionDeps<ServerConnection["client"]> = {
  spawnManagedServer: (options) => spawnManagedV2Server(options),
  createEngineClient: (options) => createV2EngineClient(options),
  isPortAvailable,
  getAvailableServerPort,
  withWorkingOpencodePath,
}

function isPortStartFailure(error: unknown, port: number): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes(`Failed to start server on port ${port}`)
}

function isPortRangeExhausted(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes("No available port found in range")
}

async function startServer<TClient>(
  options: { signal: AbortSignal, port: number },
  deps: ServerConnectionDeps<TClient>,
): Promise<{ client: TClient, cleanup: () => void }> {
  const { signal, port } = options
  const managed = await deps.withWorkingOpencodePath(() =>
    deps.spawnManagedServer({ port, signal }),
  )

  const client = deps.createEngineClient({ baseUrl: managed.baseUrl, password: managed.password })
  console.log(pc.dim("Server listening at"), pc.cyan(managed.baseUrl))
  return { client, cleanup: () => { void managed.stop() } }
}

export async function createServerConnectionWithDeps<TClient>(
  options: ServerConnectionOptions,
  deps: ServerConnectionDeps<TClient>,
): Promise<{ client: TClient, cleanup: () => void }> {
  const { port, attach, signal } = options

  if (attach !== undefined) {
    console.log(pc.dim("Attaching to existing server at"), pc.cyan(attach))
    const client = deps.createEngineClient({ baseUrl: attach })
    return { client, cleanup: () => {} }
  }

  if (port !== undefined) {
    if (port < 1 || port > 65535) {
      throw new Error("Port must be between 1 and 65535")
    }

    const available = await deps.isPortAvailable(port, "127.0.0.1")

    if (available) {
      console.log(pc.dim("Starting server on port"), pc.cyan(port.toString()))
      try {
        return await startServer({ signal, port }, deps)
      } catch (error) {
        if (!isPortStartFailure(error, port)) {
          throw error
        }

        const stillAvailable = await deps.isPortAvailable(port, "127.0.0.1")
        if (stillAvailable) {
          throw error
        }

        console.log(pc.dim("Port"), pc.cyan(port.toString()), pc.dim("became occupied, attaching to existing server"))
        const client = deps.createEngineClient({ baseUrl: `http://127.0.0.1:${port}` })
        return { client, cleanup: () => {} }
      }
    }

    console.log(pc.dim("Port"), pc.cyan(port.toString()), pc.dim("is occupied, attaching to existing server"))
    const client = deps.createEngineClient({ baseUrl: `http://127.0.0.1:${port}` })
    return { client, cleanup: () => {} }
  }

  let selectedPort: number
  let wasAutoSelected: boolean
  try {
    const selected = await deps.getAvailableServerPort(DEFAULT_SERVER_PORT, "127.0.0.1")
    selectedPort = selected.port
    wasAutoSelected = selected.wasAutoSelected
  } catch (error) {
    if (!isPortRangeExhausted(error)) {
      throw error
    }

    const defaultPortIsAvailable = await deps.isPortAvailable(DEFAULT_SERVER_PORT, "127.0.0.1")
    if (defaultPortIsAvailable) {
      throw error
    }

    console.log(pc.dim("Port range exhausted, attaching to existing server on"), pc.cyan(DEFAULT_SERVER_PORT.toString()))
    const client = deps.createEngineClient({ baseUrl: `http://127.0.0.1:${DEFAULT_SERVER_PORT}` })
    return { client, cleanup: () => {} }
  }

  if (wasAutoSelected) {
    console.log(pc.dim("Auto-selected port"), pc.cyan(selectedPort.toString()))
  } else {
    console.log(pc.dim("Starting server on port"), pc.cyan(selectedPort.toString()))
  }

  try {
    return await startServer({ signal, port: selectedPort }, deps)
  } catch (error) {
    if (!isPortStartFailure(error, selectedPort)) {
      throw error
    }

    const { port: retryPort } = await deps.getAvailableServerPort(selectedPort + 1, "127.0.0.1")
    console.log(pc.dim("Retrying server start on port"), pc.cyan(retryPort.toString()))
    return await startServer({ signal, port: retryPort }, deps)
  }
}

export async function createServerConnection(options: ServerConnectionOptions): Promise<ServerConnection> {
  return await createServerConnectionWithDeps(options, defaultDeps)
}
