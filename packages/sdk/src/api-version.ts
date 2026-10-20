/** Wire envelope `v`. Guest postMessage and host pushes use this. */
export const ALCODE_SDK_CHANNEL = 'alcode.sdk';
/** Legacy wire channel. Guests and hosts still send it; parse accepts both, new code writes `alcode.sdk`. */
export const OPENCHAMBER_SDK_CHANNEL = 'openchamber.sdk';
/** Every channel spelling the envelope parse accepts. */
export const SDK_CHANNELS = [ALCODE_SDK_CHANNEL, OPENCHAMBER_SDK_CHANNEL] as const;
export type SdkChannel = (typeof SDK_CHANNELS)[number];
export const ALCODE_SDK_API_VERSION = 1;
/** Legacy alias. */
export const OPENCHAMBER_SDK_API_VERSION = ALCODE_SDK_API_VERSION;
/** Manifest `apiVersion` values this host accepts. Service and sockets ship on `1`. */
export const ALCODE_SDK_MANIFEST_API_VERSIONS = [1] as const;
export type AlcodeManifestApiVersion = (typeof ALCODE_SDK_MANIFEST_API_VERSIONS)[number];
