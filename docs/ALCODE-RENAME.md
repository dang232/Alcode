# Alcode rename record (Alwork → Alcode)

Full product-identity migration of this fork from OpenChamber/Alwork to
**Alcode**. Branch: `chore/full-alcode-rename` (from `origin/main` 9e3eec6).

## What was renamed

Case-preserving mechanical rename (`OpenChamber→Alcode`, `openchamber→alcode`,
`OPENCHAMBER→ALCODE`, `Alwork→Alcode` + case variants, `dang232/Alwork` and
fork-owned `openchamber/openchamber` URLs → `dang232/Alcode`): ~28.4k
replacements in 2113 files, plus 21 path renames (settings sections,
alcode-control/sessions/routes modules, AlcodeLogo, alcode config/events
modules, alcode themes, alcode-logo badges). Followed by hand-built
dual-serve compat shims (commit 2).

## Deliberately retained legacy identifiers

These still say `openchamber`/`OpenChamber`/`OPENCHAMBER` and must not be
bulk-renamed. Each has a compat path instead:

- Store/app identity: `dev.openchamber.desktop` (+`.dev`), `com.openchamber.app`
  (+ Widget/NSE suffixes), `group.com.openchamber.app`, `fedaykindev.openchamber`
  (marketplace). New store listing + provisioning is a staged follow-up; the
  code reads new display names already.
- User-data locations: `~/.config/openchamber`, `OPENCHAMBER_DATA_DIR`,
  `OPENCHAMBER_CHATS_DIR`, `openchamber.service`, `dev.openchamber.web`,
  policy paths. New `~/.config/alcode` / `ALCODE_*` locations are primary;
  legacy is copied forward (never deleted) and read as fallback.
- Wire/storage compat: `openchamber.sdk` channel, manifest `openchamber`
  block, `openchamber-builtin-*` ids, `openchamber:*` IPC/commands/events,
  `__OPENCHAMBER_*` globals, `openchamber.*` storage keys, `openchamber://`
  and `openchamber-ui://` schemes, `/api/openchamber/*` routes,
  `openchamberVersion` field, `persist:openchamber-browser` partition,
  `.openchamber/project.json` + `.openchamber/screenshots/` repo files and
  ephemeral affixes, `.openchamber.backup` suffixes. All dual-served.
- Upstream/external (never ours): `openchamber/openchamber` issue/discussion
  URLs, `docs/api.openchamber.dev`, `wss://relay.openchamber.dev`,
  `api.openchamber.dev` broker/push/update defaults, `OPENCODE_*` /
  `@opencode/*`, `fedaykindev` publisher, `Bohdan Triapitsyn` authorship,
  discord/patreon/blacksmith links, `openchamber-website` dispatch contract,
  `security@openchamber.dev`, Firebase `openchamber-8bf7e` credentials,
  `*.openchamber.local` / `openchamber-preview.localhost` placeholders,
  `snapshot@openchamber.local`, `spaces@openchamber.invalid`.
- History: `CHANGELOG.md`, `changelog/*`, `.omo/evidence/*`, closed
  worktree/branch names (`alwork-ide-*`), skill docs of record.

## Migration strategy

New-primary, legacy-fallback, copy-don't-move, idempotent, retry-safe:

1. Env: `alcode-env-compat.js` mirrors set `OPENCHAMBER_*` into unset
   `ALCODE_*` at startup (warns once per key, never logs values).
2. Data dirs: `migrateLegacyUserDirs` copies missing entries from legacy
   roots into the new root; never deletes legacy; no-op when identical.
3. Storage keys (localStorage/globalState/settings): read new-first, copy
   forward on boot, write new.
4. Schemes/routes/IPC/commands/channels: both registered; new minted.
5. Installer: disables/removes legacy units/autostart entries when the new
   ones enable; policy loader checks new paths then legacy.

A legacy-only install therefore boots with all settings, conversations,
ULW/DAG state, and pairings intact, and a second boot changes nothing.

## Follow-ups (not in this branch)

New Firebase project + APNs/push cutover; new marketplace publisher/listing;
`alcode.dev` domain + `security@` mail + docs/API/relay backend move;
openchamber-website fork (docs sync); `openchamber-bot` replacement;
bridging updater release note; logo geometry redesign (current mark kept);
per-locale doc sync check for the 13 translated `repository-config` pages.
