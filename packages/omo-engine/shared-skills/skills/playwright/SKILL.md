---
name: playwright
description: Drives a real browser through the Playwright MCP server to navigate pages, interact with elements, and capture what the page shows.
---

> Authored equivalent — original wording that covers the same ground as the upstream playwright skill.

# Playwright Browser Automation

Operate a live browser by talking to the Playwright MCP server. The server
owns the browser process; you send it automation steps and read back what
the page reports.

## Server setup

The MCP server starts the browser for you with a command along these lines:

```
npx @playwright/mcp@latest
```

Extra launch flags can be appended when the environment needs them (for
example pointing at a specific browser binary or relaxing sandboxing).
Once the server is up, its tools become your hands: open pages, press keys,
click, type, and take screenshots.

## Working style

1. **Look before you touch.** Open the page, then read its accessibility
   snapshot to learn which elements exist and how they are referenced.
2. **One action, one observation.** Click or type, then read the snapshot
   or a screenshot again to confirm the page reacted before moving on.
3. **Prefer stable references.** Favor element roles and labels from the
   snapshot over fragile positional or generated selectors.
4. **Capture proof.** Screenshots and snapshot excerpts are how you show
   the outcome; attach them when reporting back.
5. **Clean up.** Close pages you opened so later runs start from a known
   state.

## When things stall

- If an element is missing, re-read the snapshot: the page may still be
  loading or the flow may have branched.
- If the page looks wrong in a screenshot, compare it with the snapshot
  text to tell rendering trouble apart from navigation trouble.
- For logins and other gated flows, say so plainly and ask the user for
  the access you lack instead of guessing credentials.
