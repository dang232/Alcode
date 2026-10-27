# user-tokens

## Ownership

Owns the Alcore user-token pair captured at desktop login completion —
the short-lived access JWT plus the opaque rotating refresh token — as a
`CredentialStore` (`packages/web/server/lib/user-tokens/user-token-store.js`).
Only storage and presentation live here: issuance and validation stay with
the auth-service and the session owner (`ui-auth`), rotation stays behind
`refreshAccessToken`, and callers (the TokenPanel quota proxy, the alcore
provider, the personal-key mint path) only ever see the pair for the
subject they already own. Persisted entries stay keyed by subject in every
tier. Never localStorage, never disk plaintext, never URLs, never logs.

## Tiers

The factory returns `{ get, set, clear, refreshAccessToken, tier,
isDurable }`, where the pair is `{ accessToken, refreshToken, updatedAt }`.
`tier` is chosen ONCE at creation — in `keychain` -> `encrypted-file` ->
`memory` order — and never changes afterwards. `isDurable()` is exactly
`tier !== 'memory'`, a probe-free answer for the status route.

- `keychain`: OS-held secrets. Electron safeStorage when it is genuinely
  available (in-process Electron main runtime), else the `@napi-rs/keyring`
  OS credential store — the tier that persists outside Electron.
  safeStorage secrets rest as ciphertext in `<dataDir>/user-tokens.json`;
  keyring secrets rest in the OS store (service `alcode-user-tokens`,
  accounts `<sub>:access` / `<sub>:refresh`) with only a marker index in
  the JSON file. This is the only tier that keeps secrets out of files the
  app itself can read.
- `encrypted-file`: AES-256-GCM ciphertext in
  `<dataDir>/user-tokens.json`, keyed by a random 32-byte key in
  `<dataDir>/user-tokens.key`. Both files are mode `0o600`, created on
  demand under `ALCODE_DATA_DIR` (or `~/.config/alcode`).
- `memory`: process memory only, lost on restart — fail-safe toward
  re-login.

## Refresh

`refreshAccessToken(sub)` POSTs the stored opaque refresh token to
`POST {authBase}/auth/token/refresh` and persists the rotated pair with
the same `set` path as login capture, so the durable tiers (`keychain`,
`encrypted-file`) keep the NEW refresh token on disk — a second store
instance over the same data dir reads the rotated pair back, which is
what makes the session survive a process restart. `memory` keeps only
the working set and loses the rotation on restart.

- Single-flight per subject: one in-flight promise per `sub`. The first
  caller performs the upstream POST; every concurrent caller for the
  same subject awaits that same promise and resolves with the same
  rotated access token. Subjects never share a flight.
- One-retry rule: the in-flight entry is removed when the promise
  settles (success or failure), so a later call starts a fresh POST. A
  retry after a settled success sends the ROTATED refresh token, never
  the consumed one — a second POST cannot replay a spent token.
- Refused refresh (`USER_TOKEN_REFRESH_REJECTED`: non-200 outside the
  transient set, or a malformed answer) clears the pair and throws the
  session-expired error; concurrent waiters reject with that same error.
  Transient failure (`USER_TOKEN_REFRESH_TRANSIENT`: unreachable
  service, 429, 5xx) keeps the stored pair and throws the transient
  error, so callers may serve stale cache and retry.

## Invariants

- The tier is fixed at creation; per-operation failures (locked keychain,
  missing keyring entry, failing disk) degrade to the memory working set
  for that operation and never change the tier.
- A downgrade from the keychain preference logs exactly ONE `console.warn`
  naming the chosen tier and the fixed reason, e.g.
  `user-tokens: keychain unavailable (Electron safeStorage is not
  available and the keyring module is not present); using encrypted-file`.
  The message is built from literals only and never contains a token, a
  token fragment, or a token length. No other operation in this module logs.
- Reads of unknown subjects, corrupt files, foreign keys, or missing
  keyring entries answer signed-out (`null`), never a throw and never a
  half-decrypted secret.
- `@napi-rs/keyring` is an OPTIONAL dependency loaded with a dynamic
  `import()` inside a `try/catch`: a machine without a prebuilt binary
  still installs and still imports this module, and any load failure reads
  as "no keyring" and downgrades.

## Decisions

### Why honest at-rest-only wording for the encrypted-file tier

The file key sits beside the ciphertext in the same directory, so the tier
stops casual disk reads (backups, shared machines, shoulder-surfing file
contents) but not an attacker who can read the data directory or run as
the user. Calling it "encryption" without that limit would invite storing
secrets under weaker assumptions than the OS keychain gives; the code and
this document say "at-rest protection only" so a later reader does not
upgrade its promises.

### Why tier order is keychain, then file, then memory

The OS store is the only tier the app cannot read back on its own, so it
wins wherever it exists — including plain servers via keyring, which is
why the keychain tier is defined as safeStorage-then-keyring rather than
safeStorage-only. The encrypted file is next because a restart-stable
session beats a re-login, even with the weaker guarantee above. Memory is
last and silent: it is today's behaviour and the only tier that cannot
fail.

### Why exactly one warning, and why it carries no token material

A downgrade is a durable security posture change (the next restart behaves
differently), so it must be visible exactly once — per-operation warnings
would both spam and train operators to ignore them. The message names the
tier and a fixed reason and is asserted in tests to contain neither the
fixture token, nor a fragment of it, nor its length: warnings go to shared
logs, and a token-adjacent warning is a leak vector.

### Why `tier`/`keychain: null` test seams instead of probing the real OS store

Tier selection depends on the machine (Electron present? keyring binary
installed? data dir writable?), which makes the real path
non-deterministic in tests. A safeStorage-shaped `keychain` fake pins the
keychain tier, `tier: 'encrypted-file'` / `'memory'` pin the rest, and
`keychain: null` forces "no keychain" without touching the real OS
credential store. Auto-selection (no seams) is the production path and is
deliberately not asserted on machine specifics.

### Why `savePair`/`readPair`/`clearPair` aliases remain

`get`/`set`/`clear` are the store API; the pre-rename names stay as
identical aliases until the alcore-provider and personal-key callers move
over, so the rename lands without touching those modules.
