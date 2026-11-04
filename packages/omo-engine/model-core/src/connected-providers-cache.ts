import type { ModelMetadata } from "./provider-cache"

interface ProviderModelsCache {
	readonly models: Record<string, readonly string[] | readonly ModelMetadata[]>
	readonly connected: readonly string[]
	readonly updatedAt: string
}

export interface ConnectedProvidersAdapter {
	readConnectedProvidersCache(): string[] | null
	findProviderModelMetadata(providerID: string, modelID: string): ModelMetadata | undefined
	readProviderModelsCache(): ProviderModelsCache | null
}

function readConnectedProvidersCache(): string[] | null {
	return null
}

function findProviderModelMetadata(
	_providerID: string,
	_modelID: string,
): ModelMetadata | undefined {
	return undefined
}

function readProviderModelsCache(): ProviderModelsCache | null {
	return null
}

export const connectedProvidersAdapter: ConnectedProvidersAdapter = {
	readConnectedProvidersCache,
	findProviderModelMetadata,
	readProviderModelsCache,
}
