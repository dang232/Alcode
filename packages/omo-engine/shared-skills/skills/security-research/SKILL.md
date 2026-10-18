---
name: security-research
description: Hunts for vulnerabilities by working from attacker reachability inward, then proves each finding with a working demonstration before assigning severity.
---

> Authored equivalent — original wording that covers the same ground as the upstream security-research skill.

# Security Research

Look for weaknesses the way an attacker would: start from what an outsider
can touch, trace inward to what breaks, and never call something a
vulnerability until you can show it happening.

## How to work

1. **Draw the boundary first.** List the trust levels in play (anonymous
   visitor, signed-in user, service account, administrator) and the paths
   each one can reach: routes, handlers, file parsers, deserializers,
   message consumers.
2. **Walk each path with hostile input.** For every entry point, ask what
   an attacker controls (parameters, headers, file bytes, queue payloads)
   and where that data flows without checks.
3. **Rank by reachability, not by pattern.** A suspicious-looking call that
   no outsider can reach is a note, not a finding. A plain flaw on a
   public path is the priority.
4. **Demonstrate before you declare.** Write the smallest proof that shows
   the bad outcome: a request that reads another tenant's row, a payload
   that runs where it should not, a state change without permission.
5. **Name the root cause.** State which check is missing or wrong
   (authorization skipped, input trusted, secret exposed, crypto misused)
   so the fix lands in the right place.

## Severity calls

- **High:** reachable by a low-privilege outsider with a real impact you
  demonstrated (data taken across a boundary, code run, auth bypassed).
- **Medium:** reachable but fenced in by conditions, or impactful but
  needing a privileged starting position.
- **Low:** real defect, hard to reach or minor in effect; fix on a normal
  schedule.

## What to hand back

For each confirmed finding: where it is (file and line or route), who can
reach it and how, the demonstration steps, the root cause in one sentence,
and the smallest fix that closes it. End with anything you checked and
cleared, so nobody re-audits empty ground.
