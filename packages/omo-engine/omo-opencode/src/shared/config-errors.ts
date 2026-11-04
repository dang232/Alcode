export type ConfigLoadError = {
  path: string
  error: string
}

let configLoadErrors: ConfigLoadError[] = []

export function addConfigLoadError(error: ConfigLoadError): void {
  configLoadErrors.push(error)
}
