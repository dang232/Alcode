/** Wire envelope `v`. Guest postMessage and host pushes use this. */
export const ALCODE_SDK_CHANNEL = 'alcode.sdk';
export const ALCODE_SDK_API_VERSION = 1;
/** Manifest `apiVersion` values this host accepts. Service and sockets ship on `1`. */
export const ALCODE_SDK_MANIFEST_API_VERSIONS = [1] as const;
export type AlcodeManifestApiVersion = (typeof ALCODE_SDK_MANIFEST_API_VERSIONS)[number];
