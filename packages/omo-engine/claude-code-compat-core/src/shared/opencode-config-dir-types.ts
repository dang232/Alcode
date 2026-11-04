type OpenCodeBinaryType = "opencode" | "opencode-desktop"

export type OpenCodeConfigDirOptions = {
  binary: OpenCodeBinaryType
  version?: string | null
  checkExisting?: boolean
}
