import type { PluginInput } from "@opencode-ai/plugin"
import {
} from "./model-suggestion-retry"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "./prompt-async-gate"
import { isAmbiguousPostDispatchPromptFailure } from "./prompt-failure-classifier"

type OpencodeClient = PluginInput["client"]

type PromptAsyncArgs = Parameters<OpencodeClient["session"]["promptAsync"]>[0]

function routeSessionPrompt(args: PromptAsyncArgs, directory: string): PromptAsyncArgs {
  return {
    ...args,
    query: { directory },
  }
}

export function promptAsyncInDirectory(
  client: OpencodeClient,
  args: PromptAsyncArgs,
  directory: string,
): Promise<unknown> {
  const routedArgs = routeSessionPrompt(args, directory)
  const sessionID = routedArgs.path?.id
  if (!sessionID) {
    return Promise.reject(new Error("session id is required for routed promptAsync"))
  }

  return dispatchInternalPrompt({
    mode: "async",
    client,
    sessionID,
    input: routedArgs,
    source: "session-route",
    settleMs: 0,
    queueBehavior: "defer",
  }).then((result) => {
    if (result.status === "failed") {
      if (isAmbiguousPostDispatchPromptFailure(result)) {
        return undefined
      }
      throw result.error
    }
    if (!isInternalPromptDispatchAccepted(result)) {
      throw new Error(`promptAsync skipped by gate: ${result.status}`)
    }
    return result.status === "dispatched" ? result.response : undefined
  })
}

