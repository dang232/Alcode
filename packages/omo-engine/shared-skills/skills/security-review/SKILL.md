---
name: security-review
description: Reviews a change or codebase for security problems by applying the security-research method as a repeatable checklist.
---

> Authored equivalent — original wording that covers the same ground as the upstream security-review skill.

# Security Review

A review pass that reuses the security-research method: reachability first,
demonstration before severity, root cause with every finding.

## Before you start

- Know what changed (diff, new endpoints, new parsers, dependency bumps).
- Know who can reach it (which trust levels touch the changed surface).

## The checklist

1. **Entry points.** Every new or touched input path: parameters, headers,
   uploads, env values, queue messages. Is each one validated where it
   enters, not three calls later?
2. **Authorization.** For each operation on someone else's data, is the
   ownership check present and on the right object? Watch for checks on a
   parent while the child leaks, and for client-supplied identifiers used
   as proof of ownership.
3. **Injection points.** Any place attacker text meets an interpreter
   (queries, templates, shells, markup): is it parameterized, escaped, or
   sandboxed?
4. **Secrets and state.** No credentials, tokens, or session material in
   logs, errors, URLs, or client-visible bundles. State changes that matter
   need anti-replay and anti-forgery handling.
5. **Dependencies.** New packages or version moves: any known advisories,
   any widened permissions (install scripts, network, filesystem)?
6. **Proof.** For anything flagged, produce the demonstration the research
   method demands before grading it.

## Verdict

Close with one of: clear, clear with notes (low-grade items listed), or
blocked (a high or medium finding with its proof attached). Never block on
a pattern you could not demonstrate.
