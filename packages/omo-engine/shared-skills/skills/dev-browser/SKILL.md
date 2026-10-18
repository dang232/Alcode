---
name: dev-browser
description: Automates browser work through a helper server that keeps page state alive between scripts, so multi-step flows continue where they left off.
---

> Authored equivalent — original wording that covers the same ground as the upstream dev-browser skill.

# Dev Browser

A browser helper whose server holds pages open between your scripts. Each
script you run attaches to a named page that still shows whatever the
previous script left behind, which suits logins, wizards, and any flow
that takes several steps.

## Session shape

- Open a page once under a descriptive name (`checkout`, `settings`).
- Run short scripts that each do a single move: go somewhere, fill
  something, press something, read something back.
- End every script by printing the current state (URL, title, a snippet
  of visible text) so the next step starts informed.
- Close pages you no longer need; disconnect when the job is done. Pages
  outlive the disconnect, so reconnecting resumes the same state.

## Finding elements

- When you know the page, write selectors straight from its markup.
- When you do not, ask the client for the accessibility snapshot first,
  pick the element reference you need, and act through it.
- Take a screenshot whenever you want to see what the user would see;
  it is the fastest way to confirm a step worked.

## Ground rules

- Keep scripts small: one goal per run, state printed at the end.
- Never put executable markup or secrets into logs; describe results
  instead of dumping raw page internals.
- If a step lands somewhere unexpected, screenshot and read the URL
  before retrying: the flow likely branched rather than broke.
