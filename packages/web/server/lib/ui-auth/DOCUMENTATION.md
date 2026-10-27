# UI Auth Module Documentation

## Purpose
This module owns Alcode UI authentication for browser access, including password session auth, WebAuthn passkeys, and trusted-device session handling.

Trusted-device access has one durable credential model: a remote client bearer token stored by `packages/web/server/lib/client-auth/remote-clients.js`. Password, passkey, and Pairing v2 are issuance methods for that credential, not separate credential systems. Issued client tokens are returned once, stored server-side only as hashes, and are later authenticated via `Authorization: Bearer oc_client_...`.

Pairing v2 is implemented by `packages/web/server/lib/client-auth/pairing.js`. It stores short-lived one-time pairing sessions with hashed secrets, exposes create/cancel/redeem routes under `/api/client-auth/pairing/*`, and redeems a valid pairing secret into the same remote client token used by password/passkey trusted-device flows.

## Entrypoints and structure
- `packages/web/server/lib/ui-auth/ui-auth.js`: UI auth controller runtime, cookie/session issuance, rate limiting, and auth route handlers.
- `packages/web/server/lib/ui-auth/ui-passkeys.js`: passkey store and WebAuthn registration/authentication verification helpers.
- `packages/web/server/lib/ui-auth/session-cookie.js`: resolves the session cookie name from a request's `Host` port; shared by session issuance and validation in `ui-auth.js` and notification/session identity extraction in `packages/web/server/lib/security/request-security.js`.
- `packages/web/server/lib/client-auth/remote-clients.js`: trusted-device client token storage, bearer authentication, last-used tracking, and revocation.
- `packages/web/server/lib/client-auth/pairing.js`: short-lived Pairing v2 sessions and one-time secret redemption into trusted-device client tokens.

## Session cookie scoping
Browsers key a cookie jar on the host only, never the port (RFC 6265). Two Alcode instances reached through the same hostname on different ports therefore shared a single `oc_ui_session` cookie. Logging into the second overwrote the first instance's session cookie (issue #2377). This affects LAN and loopback hosts alike.

`sessionCookieNameForRequest(req, base)` folds the request `Host` port into the cookie name: `oc_ui_session_<port>` when the host carries an explicit port (including a port from `x-forwarded-host`), or the bare `oc_ui_session` when it does not. `localhost:3000` and `localhost:3001` use separate names, just like two ports on one LAN address. Password and browser passkey login both call `issueSession` and receive this cookie. Session validation, clearing, and notification identity extraction use the same resolver; identity extraction does not provide a CSRF token. Bearer-token validation is unchanged.

Compatibility: upgrading renames the cookie for any explicit-port host, so already-signed-in browser sessions must log in once again. No on-disk format changes.

## Session profile read-through

A login-time `profile` in the session body (`{ name?, picture?, email?,
tier? }`, passed by the desktop completion path) is bound to the issued
session — the cookie token, plus the desktop client id when one is minted
alongside — in a TTL-bounded in-memory map (2000 keys max, swept on write,
expired with the owning session, cleared on global sign-out and dispose).
`GET /auth/session` then carries `alcore: { sub, name?, picture?, email?,
tier? }` on cookie and client sessions, which the header account surface
parses; every other shape is byte-identical to before. Validation,
cookies, JWTs, TTLs, rate limits, and client issuance are untouched: a
missing or malformed profile answers exactly the old shape. The sub link
is always server-verified; display fields are bound to that verified sub.

Tier is a plain passthrough string for the existing tier badge: the
profile's first present valid value among `tier`, `plan`, `planName`
wins, trimmed, 1–64 chars. A malformed tier value is dropped field-wise
without dropping the rest of the profile, and a profile with no tier
emits no `tier` key at all (absent, never an empty string). Alcode
interprets no plan semantics — no limits, prices, windows, or upgrades —
it only surfaces the label the auth service already sent at login.

## Request subject seam

`resolveRequestAlcoreSub(req)` answers the caller's own Alcore `sub`
for the TokenPanel quota proxy's self-only check: a Bearer Alcore token
verifies to its sub; a cookie session reads the sub bound at issuance;
anything else answers `''`. It mirrors exactly what `GET /auth/session`
reports, so the proxy and the panel's subject agree. Read-only and
additive — never consulted by validation, and issuance/cookies/TTLs are
untouched.

## Public exports (ui-auth.js)
- `readSessionTtlMs(raw, unitMs, fallbackMs)`: parses a positive session lifetime from an environment value, else the fallback. Defaults come from `ALCODE_UI_SESSION_TTL_HOURS` (12) and `ALCODE_UI_TRUSTED_SESSION_TTL_DAYS` (7, used when the user ticks "trust this device").
- `createUiAuth({ password, cookieName, sessionTtlMs, trustedSessionTtlMs, readSettingsFromDiskMigrated })`: creates UI auth controller with methods:
  - `enabled`
  - `requireAuth(req, res, next)`
  - `handleSessionStatus(req, res)`
  - `handleSessionCreate(req, res)`
  - `handlePasskeyStatus(req, res)`
  - `handlePasskeyRegistrationOptions(req, res)`
  - `handlePasskeyRegistrationVerify(req, res)`
  - `handlePasskeyAuthenticationOptions(req, res)`
  - `handlePasskeyAuthenticationVerify(req, res)`
  - `handlePasskeyList(req, res)`
  - `handlePasskeyRevoke(req, res)`
  - `handlePasskeyRename(req, res)`
  - `handleResetAuth(req, res)`
  - `resolveRequestAlcoreSub(req)`
  - `ensureSessionToken(req, res)`
  - `dispose()`

## Public exports (ui-passkeys.js)
- `createUiPasskeys({ passwordBinding, readSettingsFromDiskMigrated, storeFile, rpName, challengeTtlMs })`: creates passkey runtime with methods:
  - `enabled`
  - `getStatus(req)`
  - `listPasskeys(req)`
  - `revokePasskey(req, passkeyId)`
  - `renamePasskey(req, passkeyId, label)`
  - `clearAllPasskeys()`
  - `beginRegistration(req, { label })`
  - `finishRegistration(payload)`
  - `beginAuthentication(req)`
  - `finishAuthentication(payload)`
  - `dispose()`

## Session identity durability (2026-10-27)

The session cookie is an HS256 JWT signed with `~/.config/alcode/jwt-secret`, so it outlives the process. The login profile
(`sub`, `name`, `email`, `picture`) previously lived only in an in-memory `Map`, which meant a restart left a valid cookie answering
`{ authenticated: true }` with no identity at all — the popover then read as "signed out" while the cookie was still good.

The identity is now minted into the signed token as `prof` (bounded: sub <= 128, name <= 120, email <= 254, picture <= 2048, and
dropped to `{ sub }` if the claim set would exceed 1200 characters). `readSessionProfileFor` falls back to those claims for tokens
that already passed `jwtVerify` in the same request, so a restart cannot strip the identity while a forged token still bakes nothing.

Tests: `ui-auth.test.js` — "keeps the signed-in identity after a restart, when only the signed cookie survives" and
"does not invent an identity for a session that never carried one".