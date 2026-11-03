# 0015 — A tool that changes something runs only after a confirmation the model cannot forge

## Context

The skeleton refused every write by prompt and by the spoken channels' allowlist (invariant 4:
every voice tool read-only). Email replies, flags and notes need writes, and the first of them
comes from the car. The research behind decision 0012 found the shape every email agent
converged on: read freely, draft by default, execute only after an explicit confirmation
enforced in deterministic code, with the email body treated as untrusted. The known attack on
that shape is injected text telling the agent the user already agreed.

## Decision

A tool that writes declares `confirmation: 'required'` and a `preview`. Dispatch never runs its
handler on the model's say-so: without a confirmation on the request it stores a pending
confirmation (session, user, tool, a hash of the validated input, the summary, five minutes)
and returns the summary to the model with no id; the sink gets the id after the `tool_result`
row. The channel asks the user and, on yes, re-enters the loop with the id in the request's
`extras`, never in message text. Dispatch consumes the id once, only for the same session,
user, tool and input hash, then runs the handler and records the outcome; anything else is a
fresh preview with the reason logged. A decline settles the row. The id appears in the sink
event and the store and nowhere else: not in a row the model reads, not in a request to the
model, not in a log line.

Invariant 4 is amended: a tool named for a spoken channel is read-only **or** carries
`confirmation: 'required'`, asserted at registry construction. Chat keeps the pending
confirmations in `tool_confirmations` (owner reads, service role writes, the audit of every
write); the voice worker keeps them in memory for the call.

Alternatives: let the model pass `confirmed: true` (forgeable by injection, rejected); return
the id in the tool result and have the model repeat it (the "confirmation bypass" injection,
rejected); a separate HTTP endpoint that executes the pending write outside the loop (the model
would not see the outcome, and the voice channel has no such endpoint).

## Consequences

Two model turns per write: the preview turn and the confirmed turn. `LoopConfig` gains a
`ConfirmationStore`; every channel supplies one. The chat prompt tells the model what a pending
confirmation means; the voice prompt gets its line in Part 12b, measured. The demo pack's
`create_note` is the first tool under the protocol. `POST /chat` takes `confirm` or `decline`
with the user's words; a `confirm` SSE event follows the `tool_result` it belongs to. Part 13's
email reply reuses all of it; a write tool reaches a spoken channel only with this protocol and
the commit saying why.

## Date

2026-11-03
