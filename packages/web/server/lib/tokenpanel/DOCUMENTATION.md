# TokenPanel Quota Proxy Documentation

## Purpose

Owns `GET /api/tokenpanel/quota?authUserId=` and
`GET /api/tokenpanel/status?authUserId=`, the live quota read and the
link-state read behind the header account surface (`useAccountQuota` in
`packages/ui/src/components/layout/accountQuota.ts`). The client renders
only from the status route: every link, persistence, quota, and action
value is decided on the server, never inferred in the UI.

## Files

- `packages/web/server/lib/tokenpanel/tokenpanel-quota.js`: route runtime
  (`createTokenpanelQuotaRuntime`), mounted in
  `feature-routes-runtime.js` beside the other explicit routes — behind the
  existing `/api` session gate, before the generic OpenCode proxy.
- `packages/web/server/lib/tokenpanel/tokenpanel-quota.test.js`:
  serviceFetch-stub tests (no servers, manual clock seam).

## Flows

Read-through with the ide-gate fallback discipline: live wins; a transient
outage (network/timeout/5xx/429) serves the last-known body within one TTL
of grace (60 s) with `source:'cache', stale:true`; past grace (or a cold
cache) fails closed with 503. Hard-invalid answers (403/404 from the
upstream, malformed body) never serve stale and answer 502. A caller with
no stored pair answers 503 `tokenpanel_not_configured` without calling
upstream. Every failure shape maps to the hook's `unavailable` state —
except `tokenpanel_session_expired` (below) — never a fabricated quota.

## Caller auth (user Bearer, no service keys)

The proxy presents the CALLER's own access Bearer — the keychained pair
the desktop login captured at loopback completion (see
`packages/web/server/lib/user-tokens/user-token-store.js`) — as
`Authorization: Bearer` against `TOKENPANEL_API_URL` (default
`https://alcore.io.vn`). No management key is read on this path:
management keys must never appear in user-facing flows (a server-to-server
management contract may exist elsewhere, out of scope here). Self-only is
enforced before any upstream call: `authUserId` must equal the session's
Alcore `sub` (resolved through the injected `resolveSubject`, wired to
`uiAuthController.resolveRequestAlcoreSub`); a mismatch answers 403
`tokenpanel_forbidden` without touching tokens or the network. The token
is never logged, never placed in a URL, and never sent to the browser.
Base and pair resolve per request, so rotation applies without a restart.
Upstream `Set-Cookie` headers are never forwarded: the handler answers
with its own `res.status().json()`.

An upstream 401 (expired access JWT) refreshes ONCE through the store's
auth-service rotation (`POST {authBase}/auth/token/refresh`) and retries
with the fresh token. A refused refresh, a missing refresh token, or a
second 401 clears the stored pair and answers 401
`tokenpanel_session_expired` — the renderer's cue to sign out to the gate
(`signOutToGateOnce` in `packages/ui/src/components/layout/`). A refresh
that fails transiently keeps the stale-in-grace behavior above.

## Status route (client render source)

`GET /api/tokenpanel/status?authUserId=` answers the fixed contract the
panel renders from — no client inference:

```text
200 { link, persistence, quota?, action? }
400 { error: 'invalid_request' }        // malformed authUserId
403 { error: 'tokenpanel_forbidden' }   // authUserId is not the session subject
401 only from the /api session gate itself, never from this handler
```

- `link`: `unlinked` | `linked` | `expired` | `upstream_error`.
- `persistence`: `durable` when the user-token store probe
  (`isDurable()` in
  `packages/web/server/lib/user-tokens/user-token-store.js`) passes —
  OS-keychain seam available plus a persisted write round-trip — else
  `ephemeral`.
- `quota`: present only on `linked`, and byte-identical to what
  `GET /api/tokenpanel/quota` would return (live bodies and
  `stale:true` grace bodies alike).
- `action`: `sign_in` on `unlinked`/`expired`, `retry` on
  `upstream_error`, absent on `linked`.

Both routes share one internal resolve (`resolveQuotaBody`, same cache
and refresh discipline as the quota flow above). The quota route keeps
its exact bodies and status codes; the status route maps that shared
outcome to the table below and always answers 200 on a resolved outcome
(session expiry is `expired`, never a 401 from this handler).

### Mapping table

| Shared resolve outcome | `link` | `action` | HTTP |
|---|---|---|---|
| success, live or `stale:true` grace | `linked` + `quota` | — | 200 |
| `TOKENPANEL_NOT_CONFIGURED` (no stored pair) | `unlinked` | `sign_in` | 200 |
| `TOKENPANEL_SESSION_EXPIRED` (refused/missing refresh, second 401) | `expired` | `sign_in` | 200 |
| `TOKENPANEL_FORBIDDEN` (defensive; the self-only gate answers 403 first) | `expired` | `sign_in` | 200 |
| `TOKENPANEL_REJECTED` (upstream 403/404, malformed body) | `upstream_error` | `retry` | 200 |
| `TOKENPANEL_TRANSIENT` (5xx, 429, network/timeout, cold or past-grace cache) | `upstream_error` | `retry` | 200 |
| `TOKENPANEL_MISCONFIGURED`, `TOKENPANEL_INVALID_REQUEST`, unknown throw | `upstream_error` | `retry` | 200 |
| `authUserId` fails validation | — (`invalid_request`) | — | 400 |
| `authUserId` is not the session `sub` (or the subject is unknown) | — (`tokenpanel_forbidden`) | — | 403 |

This replaces the Phase 0 collapse where every failure read as
`{ state: 'unavailable' }` (`accountQuota.ts:145-153`): the panel can
now tell `unlinked` (not signed in yet) apart from `expired` (sign in
again) and `upstream_error` (retry), with `linked` carrying quota
whether the read was live or stale.

## Plan route (dynamic customer plan)

`GET /api/tokenpanel/plan?authUserId=` answers the customer's dynamic
plan for the account surface, owned by
`packages/web/server/lib/tokenpanel/tokenpanel-plan.js`
(`createTokenpanelPlanRuntime`), mounted in
`feature-routes-runtime.js` next to the quota runtime — behind the
existing `/api` session gate, before the generic OpenCode proxy. The
client renders only from this route: plan ids and names are never
enumerated in the UI, only carried verbatim.

### Flow

The handler re-reads Alcore's own-subscription endpoint on every miss —
`GET {base}/public/customers/me/subscription` with the CALLER's Bearer
(the same user-scoped access token the quota route uses, read through
the same `userTokenStore.get` seam; no second credential store, no
refresh dance on this path) — and maps the upstream answer
`{ subscription: SubscriptionDoc, plan: SubscriptionPlanDoc | null }`
(404 when there is no active subscription).

Caller auth and cache discipline mirror the quota route exactly:
self-only (`authUserId` must equal the session's Alcore `sub`) answers
403 `tokenpanel_forbidden` before any token read or network call;
malformed `authUserId` answers 400; no stored pair answers 503
`tokenpanel_not_configured`; 60 s TTL keyed by subject with one extra
TTL of stale-in-grace. A failed re-read serves the cached body marked
`stale:true` — never an empty plan.

### Wire (fixed contract — the UI validates this shape)

```text
200 { link:'linked', persistence, stale, plan, subscription }  // live or stale-grace read
200 { link:'linked', persistence, plan:null, subscription:null } // upstream 404: no active subscription
200 { link:'expired', persistence, action:'sign_in' }          // upstream 401/403
200 { link:'upstream_error', persistence, action:'retry' }     // network/5xx/429/malformed, cold or past-grace cache
400 { error: 'invalid_request' }
403 { error: 'tokenpanel_forbidden' }
503 { error: 'tokenpanel_not_configured' }                    // caller has no stored pair
```

- `persistence`: `durable` only when the user-token store `isDurable()`
  probe passes (and no persist failed for the subject), else `ephemeral`.
- `plan` (null only on the 404 path): `{ id, name, interval,
  intervalCount, priceMicros, currency, includedTokens, limits, models }`
  where `id` is the upstream plan `_id` as a hex string, `name` is free
  text verbatim, `priceMicros`/`currency` come from
  `SubscriptionPlanDoc.price`, `includedTokens` defaults to `0`,
  `intervalCount` defaults to `1`, `models` is `allowedModelAliases`
  verbatim, and `limits` carries one entry per ACTIVE rateLimit rule —
  `{ dimension, windowSeconds, capValue, scope }` with `scope` defaulting
  to `customer` — inactive rules dropped.
- `subscription` (null only on the 404 path): `{ status,
  currentPeriodEnd }` from `SubscriptionDoc.status` and
  `SubscriptionDoc.periodEnd` (ISO string on the wire, null when
  absent).
- Upstream 401/403 maps straight to `expired` — no refresh, no stale
  serve, no pair clearing. REJECTED (other non-200, malformed body) and
  misconfigured base map to `upstream_error` without serving stale;
  only TRANSIENT (network/timeout/5xx/429) serves stale within grace.

### Scope fact (why the client never enumerates plans)

`SubscriptionPlanDoc` (`packages/db/src/schemas/effect/limit.ts`) is
fully dynamic: `name` is free text (1..120), `price{amountMicros,
currency}`, `interval` day|week|month|year, `intervalCount`,
`includedCredit`, `includedTokens`, `rateLimits[{id, windowSeconds,
dimension tokens|requests|spend_units|spend_micros, capValue>0, scope
customer|plan|model|apiKey, scopeTarget, active}]`,
`allowedModelAliases[]`, plus display fields (badge, tagline, features,
...) — there is NO fixed plan enum. Plan ids are Mongo ObjectIds and
names are free text, so the mapping passes both through untouched and
the client must never match on them. Nothing marks a dimension
"unlimited" explicitly upstream: a dimension simply has no rateLimit
rule, so the client renders only the rules present and never derives
Unlimited from an absent rule.

## Entitlements route (per-metric customer entitlements)

`GET /api/tokenpanel/entitlements?authUserId=` answers the customer's
per-metric entitlements for the account surface, owned by
`packages/web/server/lib/tokenpanel/tokenpanel-entitlements.js`
(`createTokenpanelEntitlementsRuntime`), mounted in
`feature-routes-runtime.js` next to the quota and plan runtimes — behind
the existing `/api` session gate, before the generic OpenCode proxy. The
client renders only from this route: plan ids and names are never
enumerated in the UI, only carried verbatim, and every metric leaf is
read untouched.

### Flow

The handler re-reads Alcore's entitlements endpoint on every miss —
`GET {base}/admin/ide/entitlements?authUserId=` with the CALLER's Bearer
(the same user-scoped access token the plan/quota routes use, read
through the same `userTokenStore.get` seam; no second credential store,
no refresh dance on this path) — and maps the upstream answer
`{ authUserId, customerId, plan, subscription, metrics, balance, source,
stale }` (404 when there is no subscription).

Caller auth and cache discipline mirror the plan route exactly:
self-only (`authUserId` must equal the session's Alcore `sub`) answers
403 `tokenpanel_forbidden` before any token read or network call;
malformed `authUserId` answers 400; no stored pair answers 503
`tokenpanel_not_configured`; 60 s TTL keyed by subject with one extra
TTL of stale-in-grace. A failed re-read serves the cached body marked
`stale:true` — never an empty metrics array or a null plan in place of
cached data.

### Wire (fixed contract — the UI validates this shape)

```text
200 { link:'linked', persistence, stale, plan, subscription, metrics, balance } // live or stale-grace read
200 { link:'linked', persistence, stale:false, plan:null, subscription:null, metrics:[], balance:null } // upstream 404: no subscription
200 { link:'expired', persistence, action:'sign_in' }          // upstream 401/403
200 { link:'upstream_error', persistence, action:'retry' }     // network/5xx/429/malformed, cold or past-grace cache
400 { error: 'invalid_request' }
403 { error: 'tokenpanel_forbidden' }
503 { error: 'tokenpanel_not_configured' }                    // caller has no stored pair
```

- `persistence`: `durable` only when the user-token store `isDurable()`
  probe passes (and no persist failed for the subject), else `ephemeral`.
- `plan` (null only on the 404 path): `{ id, name, interval,
  intervalCount, priceMicros, currency, includedTokens }` where `id` and
  `name` are free text passed through verbatim (no id-shape gate — only
  non-empty is required), `intervalCount` defaults to `1`,
  `includedTokens` defaults to `0`.
- `subscription` (null only on the 404 path): `{ status,
  currentPeriodEnd }` (ISO string on the wire, null when absent).
- `metrics`: one entry per upstream metric, verbatim — `{ dimension,
  used, limit, windowSeconds, windowStart, resetsAt }`. Leaves are never
  recomputed, clamped, or defaulted; extra upstream keys are dropped.
- `balance` (null only on the 404 path): `{ amountMicros,
  reservedMicros, availableMicros, currency }` verbatim.
- Upstream 401/403 maps straight to `expired` — no refresh, no stale
  serve, no pair clearing. REJECTED (other non-200, malformed body) and
  misconfigured base map to `upstream_error` without serving stale;
  only TRANSIENT (network/timeout/5xx/429) serves stale within grace.

## Public exports (tokenpanel-quota.js)

- `createTokenpanelQuotaRuntime({ serviceBase, serviceFetch, now,
  cacheTtlMs, userTokenStore, resolveSubject })`:
  `{ registerRoutes, resolveQuotaBody }` plus `_`-free test seams through
  the injected options. `resolveQuotaBody(authUserId, subject)` throws
  `TokenpanelQuotaError` (`TOKENPANEL_INVALID_REQUEST` /
  `TOKENPANEL_FORBIDDEN` / `TOKENPANEL_NOT_CONFIGURED` /
  `TOKENPANEL_MISCONFIGURED` / `TOKENPANEL_TRANSIENT` /
  `TOKENPANEL_REJECTED` / `TOKENPANEL_SESSION_EXPIRED`).
- `registerRoutes(app)` mounts both `GET /api/tokenpanel/quota` (legacy
  body/status contract, unchanged) and `GET /api/tokenpanel/status`
  (the contract above).
