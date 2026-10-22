# cli/run — managed `run()` execution

## Ownership

`cli/run` owns the managed request lifecycle: starting or attaching to an
OpenCode server (`server-connection.ts`), resolving a session
(`session-resolver.ts`), selecting the workflow (`workflow-select.ts`,
`workflow-profile.ts`), dispatching the prompt through the async gate,
streaming events (`event-*.ts`), polling for completion
(`poll-for-completion.ts`, `completion.ts`), and tearing everything down
(`runner.ts`). The 2.x wire protocol lives in exactly one module,
`opencode-v2-client.ts`; every other file in this folder keeps the
engine-shaped method names, envelopes, and gate logic it already had.

## Invariants

- The rest of `cli/run` never sees 2.x wire shapes. All translation
  happens at the adapter boundary.
- The adapter never invents success: transport failures rethrow untouched,
  declared API failures become classified errors, and anything unparsable
  fails closed (no todos on unreadable todo output, no dispatch on failed
  model switch or empty prompt).
- Event correlation key is the session id. Nothing filters the global
  event stream by directory. REST status reads normalize directory
  separators before comparing (the server reports backslash form while
  callers pass forward slashes), so a live session is never filtered
  out of its own status.
- Cleanup always kills the managed server and aborts the event
  subscription; a failed start, session, or request never leaves a
  claimed success or a stray process behind.

## Decisions

### Why an adapter and not a second client abstraction

The 2.x client could have been threaded through every consumer. That
would have spread wire knowledge across the poll loop, completion
checks, dispatch gate, and lifecycle code. The adapter keeps the change
to one module with focused tests while consumers keep their contracts.

### Why readiness is banner-tolerant plus API health, not banner-only

The 1.x SDK waited for one banner string, which broke silently against
the 2.x banner. The adapter accepts both banner generations but only
reports ready after an authenticated `/api/info` answer passes the
version gate, so a plausible banner without a live API can never read
as healthy.

### Why subscribe is bare and teardown drives the iterator

The shared client's multiplexer delivers only session.status events to a
subscribe call that carries an abort signal, so the adapter subscribes
bare and closes the stream from its own abort listener instead. Verified
live; re-adding the signal to the subscribe call reintroduces silent
event loss.

### Why session agent/model apply through switch calls before prompt

The 2.x prompt route has no per-prompt agent/model fields, so prompt
input values are applied with switchAgent/switchModel first. A failed
switch returns an error and the prompt is never sent, instead of
silently running the wrong model.
