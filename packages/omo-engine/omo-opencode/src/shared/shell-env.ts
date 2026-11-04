export type ShellType = "unix" | "powershell" | "cmd" | "csh"

/**
 * Detect the current shell type based on environment variables.
 *
 * Detection priority:
 * 1. SHELL env var → Unix shell (explicit user choice takes precedence)
 * 2. Unix shell indicators on Windows → Git Bash, WSL, MSYS2
 * 3. PSModulePath → PowerShell
 * 4. Platform fallback → win32: cmd, others: unix
 *
 * Note: Step 2 is scoped to Windows only because PSModulePath is always set
 * on Windows regardless of the active shell. Indicators are deliberately
 * specific (BASH_VERSION, MSYSTEM, WSL_DISTRO_NAME) — TERM is excluded
 * because some PowerShell users set it manually.
 */
export function detectShellType(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ShellType {
  if (env.SHELL) {
    const shell = env.SHELL
    if (shell.includes("csh") || shell.includes("tcsh")) {
      return "csh"
    }
    return "unix"
  }

  // On Windows, detect Unix-compatible shells (Git Bash, WSL, MSYS2).
  // PSModulePath is always set on Windows, so we must check these BEFORE it.
  // Indicators are shell-specific — no broad signals like TERM.
  if (
    platform === "win32" &&
    (env.BASH_VERSION ||
      env.MSYSTEM ||
      env.WSL_DISTRO_NAME)
  ) {
    return "unix"
  }

  if (env.PSModulePath) {
    return "powershell"
  }

  return platform === "win32" ? "cmd" : "unix"
}

/**
 * Escape a value for use in a double-quoted shell -c command argument.
 *
 * In shell -c "..." strings, these characters have special meaning and must be escaped:
 * - $ - variable expansion, command substitution $(...)
 * - ` - command substitution `...`
 * - \\ - escape character
 * - " - end quote
 * - ; | & - command separators
 * - # - comment
 * - () - grouping operators
 *
 * @param value - The value to escape
 * @returns Escaped value safe for double-quoted shell -c argument
 *
 * @example
 * ```ts
 * // For malicious input
 * const url = "http://localhost:3000'; cat /etc/passwd; echo '"
 * const escaped = shellEscapeForDoubleQuotedCommand(url)
 * // => "http://localhost:3000'\''; cat /etc/passwd; echo '"
 *
 * // Usage in command:
 * const cmd = `/bin/sh -c "opencode attach ${escaped} --session ${sessionId}"`
 * ```
 */

