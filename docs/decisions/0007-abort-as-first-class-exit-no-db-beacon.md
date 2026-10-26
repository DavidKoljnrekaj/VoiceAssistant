# 0007 — Abort is a first-class loop exit; no DB cancel beacon

## Context

Landmark's Edge runtime hid client disconnects from the handler, so it added a database "cancel beacon" the loop polled to notice a cancelled request. Node sees the disconnect through the request's abort signal.

## Decision

The client aborts the fetch; the server reads the request's abort signal and passes it into the loop. Abort is a first-class loop exit: the loop checks it before each model call, between the model call and dispatch, and after dispatch; on abort it persists synthetic `tool_result` rows for unfinished tools and returns silently, and the request owner decides whether to emit `error`. The beacon is not ported. Alternative: port the beacon (an extra table, a poll per iteration, and a second cancellation path to keep consistent).

## Consequences

No cancellation table or polling. Every handler receives the signal and timers are cleared on every exit path. Invariant 3 (no branch ends on a bare `tool_use`) holds through abort, timeout and persistence failure by the same code path, covered by scenario tests.

## Date

2026-10-26
