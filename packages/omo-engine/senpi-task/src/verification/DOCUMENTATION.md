# verification/

## Ownership

This folder owns the ordinary (non-DAG) verification boundary: which checks a workspace declares, which of
them a human approved, what a real execution recorded, and which tree that record belongs to. The DAG gate
lives in `../dag/verification.ts` and keeps its own policy; this folder reuses its record format and its argv
runner rather than defining a second one.

`approval-authority.ts` owns WHERE approval authority lives and WHAT makes a record authoritative.
`approval-store.ts` owns the durable records. `approval-service.ts` is the only writer reachable by a person.
`resolution.ts` turns a workspace into an approved catalogue. `ordinary-capture.ts` executes and records.
`worker-tool-factory.ts` builds the child-facing tool. `verify-tool.ts` is that tool's surface.

## Invariants

1. **Authority never comes from the project.** Approval records live under a host-owned root outside every
   workspace (`ALCODE_APPROVAL_AUTHORITY_DIR` or `<home>/.alcode/verification-approvals`), in a directory named
   by `sha256(realpath-of-project-root)`. A file in the repository - however self-consistent - is not authority.
2. **A record is authentic only when its MAC verifies** under the key at `<root>/.authority-key`. Shape,
   fingerprint self-hash and any `approvedBy` string are insufficient on their own.
3. **Reads are fail-closed.** Unreadable authority, records without a key, a foreign `workspaceId` or
   `authorityId`, a fingerprint that no longer matches its body, or a MAC mismatch all produce
   `ok: false` diagnostics, which the catalogue reports as `invalid`. None of them decays into "no approvals".
4. **Only the host records.** `approveCandidate` / `rejectCandidate` / `revokeApproval` are the only writers and
   the only callers of `ensureAuthorityKey`; a read never creates a key.
5. **Authority is snapshotted at spawn.** `worker-tool-factory` reads approvals once when the child is launched;
   anything written afterwards is ignored for that run.
6. **Only `approved` authorizes.** Rejected and revoked records are visible decisions and are filtered out of
   the approval set.

## Decisions

### Why an HMAC key on disk and not project files, a self-hash, or a keypair
A project file, a self-hash and an `approvedBy` string are all computable by whoever can write the project, so
they cannot authenticate anything. A keypair changes nothing here: the private key would live in the same host
state under the same OS user. An HMAC key held in host state is the smallest mechanism that removes the project,
the request and the record body as authority sources.

### Why the authority root is derived from the real workspace path
The directory name is `sha256(resolve(projectRoot))`, so a caller cannot choose where authority is read or
written, one workspace can never see another's records, and a copied record is refused by the `authorityId`
check before any MAC is even considered. A symlinked spelling of a workspace therefore has its OWN authority id
and does not inherit the real path's approvals - the safe direction.

### Why this is not "children cannot approve", and the measured limit
The host and its ordinary children run as the same OS user. A child that can run `bash` can read, replace or
delete any host file that user can, including the authority key; measured in
`.omo/ulw/p2110-threat-model.md` and pinned by `approval-authority.limits.test.ts`. What this design guarantees
is that no project-controlled artefact and no self-authenticating record can authorize a command. Closing the
same-identity case requires OS-level isolation of the child (a separate user, a container, or a sandboxed
filesystem), which this repository provides for cloned workspaces, not for shared ones.

### Why a missing key with no records is empty rather than an error
"No workspace has ever recorded an approval" is a normal state whose honest answer is `approval_required`. A
record present without its key is a different fact - the authority is unavailable - and fails closed. Collapsing
the two would either alarm every fresh workspace or let a real record hide behind an empty read.
