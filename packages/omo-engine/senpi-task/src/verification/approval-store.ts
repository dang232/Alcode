// Durable host-owned approval records, keyed by the fingerprint from ./approval.
//
// Authority comes from the host, never from the project. Records live under the host-owned authority
// root (see ./approval-authority), are scoped to one workspace by a directory derived from that
// workspace's real path, and are authenticated with a key only a recording action creates. A record
// that a project file, a copy, or an edited body can produce is refused: the fingerprint must
// re-derive, the authorityId must match the directory it sits in, and the MAC must verify.
//
// Fail-closed rules, in order: an unreadable authority (no key), an unreadable or malformed record,
// a workspace/authority mismatch, a fingerprint that no longer matches its own content, or a MAC that
// does not verify all make the whole read `ok: false`. None of them may decay into "no approvals were
// needed", because that is how a verification gate starts reporting green while running nothing.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Type, type Static } from "typebox"
import { Value } from "typebox/value"
import { approvalFingerprint, type ApprovalSubject, type VerificationApproval } from "./approval"
import {
  approvalMac,
  approvalMacMatches,
  ensureAuthorityKey,
  readAuthorityKey,
  type ApprovalAuthority,
} from "./approval-authority"

const RecordSchema = Type.Object(
  {
    fingerprint: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    mac: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    authorityId: Type.String({ pattern: "^[a-f0-9]{32}$" }),
    workspaceId: Type.String(),
    checkId: Type.String(),
    command: Type.Array(Type.String()),
    cwd: Type.String(),
    packageScope: Type.String(),
    timeoutMs: Type.Number(),
    configVersion: Type.Number(),
    approvedAt: Type.String(),
    approvedBy: Type.String(),
    status: Type.Union([Type.Literal("approved"), Type.Literal("revoked"), Type.Literal("rejected")]),
  },
  { additionalProperties: false },
)

type StoredRecord = Static<typeof RecordSchema>

export type ApprovalRecord = StoredRecord & { readonly workspaceId: string }

export type ApprovalRead =
  | { readonly ok: true; readonly approvals: readonly VerificationApproval[]; readonly records: readonly ApprovalRecord[] }
  | { readonly ok: false; readonly diagnostics: readonly string[] }

function recordPath(authority: ApprovalAuthority, fingerprint: string): string {
  return join(authority.workspaceDir, `${fingerprint}.json`)
}

export function subjectOf(record: ApprovalRecord): ApprovalSubject {
  return {
    workspaceId: record.workspaceId,
    checkId: record.checkId,
    command: record.command,
    cwd: record.cwd,
    packageScope: record.packageScope,
    timeoutMs: record.timeoutMs,
    configVersion: record.configVersion,
  }
}

// Every field that decides what the approval authorizes, in a fixed order, length-prefixed through
// approvalMac. A changed argument, approver, status, timestamp or authority identity changes the MAC.
function macFields(record: ApprovalRecord): string[] {
  return [
    record.fingerprint,
    record.authorityId,
    record.workspaceId,
    record.checkId,
    String(record.command.length),
    ...record.command,
    record.cwd,
    record.packageScope,
    String(record.timeoutMs),
    String(record.configVersion),
    record.approvedAt,
    record.approvedBy,
    record.status,
  ]
}

function signRecord(key: Buffer, record: ApprovalRecord): ApprovalRecord {
  return { ...record, mac: approvalMac(key, macFields({ ...record, mac: "0".repeat(64) })) }
}

type Validation = { readonly record: ApprovalRecord } | { readonly error: string }

function validate(
  raw: StoredRecord,
  authority: ApprovalAuthority,
  workspaceId: string,
  key: Buffer,
  file: string,
): Validation {
  if (raw.authorityId !== authority.authorityId) {
    return { error: `${file}: belongs to authority ${raw.authorityId}, not this workspace's ${authority.authorityId}` }
  }
  if (raw.workspaceId !== workspaceId) return { error: `${file}: belongs to workspace ${raw.workspaceId}` }
  if (raw.approvedBy.trim() === "") return { error: `${file}: missing approver` }
  const record: ApprovalRecord = { ...raw, workspaceId }
  if (approvalFingerprint(subjectOf(record)) !== record.fingerprint) {
    return { error: `${file}: fingerprint does not match its own content` }
  }
  // Signed over the record as stored, with the MAC field itself neutralised, so verification cannot
  // be moved by editing the MAC alone.
  if (!approvalMacMatches(key, macFields({ ...record, mac: "0".repeat(64) }), record.mac)) {
    return { error: `${file}: approval signature does not verify` }
  }
  return { record }
}

export function readApprovals(authority: ApprovalAuthority, workspaceId: string): ApprovalRead {
  const key = readAuthorityKey(authority.root)
  const hasWorkspaceDir = existsSync(authority.workspaceDir)
  if (key === null) {
    // Two different facts, never collapsed: a workspace that has never recorded anything has no
    // approvals yet (the ordinary "nothing is approved" state), while records present without the
    // key that authenticated them is an unavailable authority and must refuse everything.
    if (!hasWorkspaceDir) return { ok: true, approvals: [], records: [] }
    return { ok: false, diagnostics: ["approval authority unavailable: records exist but no signing key"] }
  }
  if (!hasWorkspaceDir) return { ok: true, approvals: [], records: [] }
  let files: string[]
  try {
    files = readdirSync(authority.workspaceDir).filter((file) => file.endsWith(".json"))
  } catch {
    return { ok: false, diagnostics: ["approval authority unreadable: workspace directory"] }
  }
  const records: ApprovalRecord[] = []
  const diagnostics: string[] = []
  for (const file of files) {
    let stored: StoredRecord
    try {
      // SAFETY: the assertion is the input to Value.Check below, which establishes the shape before
      // any field is read. A record that fails the schema is a diagnostic, never an approval.
      stored = JSON.parse(readFileSync(join(authority.workspaceDir, file), "utf8")) as StoredRecord
    } catch {
      diagnostics.push(`${file}: unreadable`)
      continue
    }
    if (!Value.Check(RecordSchema, stored)) {
      diagnostics.push(`${file}: malformed approval record`)
      continue
    }
    const parsed = validate(stored, authority, workspaceId, key, file)
    if ("error" in parsed) diagnostics.push(parsed.error)
    else records.push(parsed.record)
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  const approvals = records
    .filter((record) => record.status === "approved")
    .map((record) => ({ fingerprint: record.fingerprint, approvedAt: record.approvedAt }))
  return { ok: true, approvals, records }
}

// Temp-and-rename so a crash mid-write cannot leave a half-written record that later reads as a
// malformed one, which under fail-closed semantics would block every verification in the workspace.
function writeApproval(authority: ApprovalAuthority, record: ApprovalRecord): ApprovalRecord {
  const key = ensureAuthorityKey(authority.root)
  const signed = signRecord(key, { ...record, authorityId: authority.authorityId })
  mkdirSync(authority.workspaceDir, { recursive: true })
  const target = recordPath(authority, signed.fingerprint)
  const temp = `${target}.tmp`
  writeFileSync(temp, `${JSON.stringify(signed, null, 2)}\n`, "utf8")
  renameSync(temp, target)
  return signed
}

export type ApprovalCandidateInput = {
  readonly fingerprint: string
  readonly checkId: string
  readonly command: readonly string[]
  readonly cwd: string
  readonly packageScope: string
  readonly timeoutMs: number
}

export function approveCandidate(input: {
  readonly authority: ApprovalAuthority
  readonly candidate: ApprovalCandidateInput
  readonly workspaceId: string
  readonly configVersion: number
  readonly approvedBy: string
  readonly approvedAt?: string
}): ApprovalRecord {
  return writeApproval(input.authority, {
    fingerprint: input.candidate.fingerprint,
    mac: "0".repeat(64),
    authorityId: input.authority.authorityId,
    workspaceId: input.workspaceId,
    checkId: input.candidate.checkId,
    command: [...input.candidate.command],
    cwd: input.candidate.cwd,
    packageScope: input.candidate.packageScope,
    timeoutMs: input.candidate.timeoutMs,
    configVersion: input.configVersion,
    approvedAt: input.approvedAt ?? new Date().toISOString(),
    approvedBy: input.approvedBy,
    status: "approved",
  })
}

// A rejection is recorded so a person can see the decision they already made, and it is filtered out
// of `approvals` above: a rejection is evidence of a decision, never a grant of authority.
export function rejectCandidate(input: {
  readonly authority: ApprovalAuthority
  readonly candidate: ApprovalCandidateInput
  readonly workspaceId: string
  readonly configVersion: number
  readonly rejectedBy: string
  readonly rejectedAt?: string
}): ApprovalRecord {
  return writeApproval(input.authority, {
    fingerprint: input.candidate.fingerprint,
    mac: "0".repeat(64),
    authorityId: input.authority.authorityId,
    workspaceId: input.workspaceId,
    checkId: input.candidate.checkId,
    command: [...input.candidate.command],
    cwd: input.candidate.cwd,
    packageScope: input.candidate.packageScope,
    timeoutMs: input.candidate.timeoutMs,
    configVersion: input.configVersion,
    approvedAt: input.rejectedAt ?? new Date().toISOString(),
    approvedBy: input.rejectedBy,
    status: "rejected",
  })
}

export function revokeApproval(input: {
  readonly authority: ApprovalAuthority
  readonly workspaceId: string
  readonly fingerprint: string
  readonly approvedBy: string
}): boolean {
  const read = readApprovals(input.authority, input.workspaceId)
  if (!read.ok) return false
  const existing = read.records.find((record) => record.fingerprint === input.fingerprint)
  if (existing === undefined) return false
  writeApproval(input.authority, { ...existing, status: "revoked", approvedBy: input.approvedBy })
  return true
}
