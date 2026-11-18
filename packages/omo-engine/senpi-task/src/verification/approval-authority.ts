// Host-owned approval authority: where approval records live, and what makes one authoritative.
//
// The property this module exists to guarantee: authority never comes from the project. The root is
// host state outside every workspace, the per-workspace directory is derived from the workspace's
// REAL path (never from a request or a record), and every record is authenticated with a key only
// the host's recording action creates. A file in the repository - however self-consistent - cannot
// name, copy or rehash itself into authority.
//
// LIMIT, recorded rather than papered over: the host and its children run as the same OS user, and a
// child that can execute `bash` can read, replace or delete any host file that user can. This module
// therefore guarantees "no project-controlled file is authority"; it does NOT guarantee integrity
// against a same-identity child with unrestricted filesystem access. Closing that requires OS-level
// isolation of the child (a separate user, container, or sandboxed filesystem). Measured evidence
// and the full threat model live in .omo/ulw/p2110-threat-model.md.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

// Explicit override for tests and for hosts that keep state elsewhere. It is a HOST setting: no
// request field, record field or child input reaches it.
const APPROVAL_AUTHORITY_ENV = "ALCODE_APPROVAL_AUTHORITY_DIR"

const AUTHORITY_KEY_FILE = ".authority-key"

export type ApprovalAuthority = {
  // The host-owned root: outside every project tree.
  readonly root: string
  // <root>/<authorityId>: the directory this workspace's records live in.
  readonly workspaceDir: string
  // sha256(realpath(projectRoot))[0..32): binds records to one real workspace path.
  readonly authorityId: string
}

function defaultRoot(): string {
  const override = process.env[APPROVAL_AUTHORITY_ENV]
  if (override !== undefined && override.trim() !== "") return resolve(override)
  return join(homedir(), ".alcode", "verification-approvals")
}

// A workspace's identity is its resolved absolute path. Two spellings of one directory therefore
// share authority (correct: same tree), while two different directories never do - and no caller can
// choose the identity, because it is derived here from the path the host already resolved.
function authorityIdFor(projectRoot: string): string {
  return createHash("sha256").update(resolve(projectRoot)).digest("hex").slice(0, 32)
}

export function approvalAuthorityFor(projectRoot: string, root?: string): ApprovalAuthority {
  const authorityRoot = root === undefined ? defaultRoot() : resolve(root)
  const authorityId = authorityIdFor(projectRoot)
  return { root: authorityRoot, workspaceDir: join(authorityRoot, authorityId), authorityId }
}

export function authorityKeyPath(root: string): string {
  return join(root, AUTHORITY_KEY_FILE)
}

// Reads the key, or null when the authority has never been established. A null key is NOT "no
// approvals": the read path turns it into a fail-closed diagnostics entry.
export function readAuthorityKey(root: string): Buffer | null {
  const path = authorityKeyPath(root)
  if (!existsSync(path)) return null
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return null
  }
  const hex = text.trim()
  if (!/^[0-9a-f]{64}$/.test(hex)) return null
  return Buffer.from(hex, "hex")
}

// Only a recording action (approve / reject / revoke) calls this. Creating the key from a read path
// would let a reader establish authority it is supposed to verify.
export function ensureAuthorityKey(root: string): Buffer {
  const existing = readAuthorityKey(root)
  if (existing !== null) return existing
  mkdirSync(root, { recursive: true })
  const key = randomBytes(32)
  writeFileSync(authorityKeyPath(root), `${key.toString("hex")}\n`, { mode: 0o600 })
  return key
}

// Length-prefixed fields so ["a", "b"] and ["a\u0000b"] cannot collide, matching the fingerprint's
// own discipline. The MAC covers every field that decides what the approval authorizes.
export function approvalMac(key: Buffer, fields: readonly string[]): string {
  const payload = fields.map((field) => `${field.length}:${field}`).join("\u0000")
  return createHmac("sha256", key).update(payload, "utf8").digest("hex")
}

export function approvalMacMatches(key: Buffer, fields: readonly string[], mac: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(mac)) return false
  const expected = Buffer.from(approvalMac(key, fields), "hex")
  const provided = Buffer.from(mac, "hex")
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}
