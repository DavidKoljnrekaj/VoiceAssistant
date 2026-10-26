---
paths:
  - 'packages/core/**'
---

# Engine (`@va/core`)

Run this checklist against every change. Each line is an invariant from the brief; each has, or
gets, a scenario test.

- [ ] **Persist before emit.** A row is written before its wire event is emitted. Token deltas are
      provisional and the only exception; the `turn` event that follows is canonical and a
      `persistence_error` tells the client to drop provisional text.
- [ ] **One user message per turn of tool results**, in `tool_use` order, tools dispatched
      concurrently, each with its own timeout and abort signal.
- [ ] **A branch never ends on a bare `tool_use`.** Abort, timeout and persistence failure persist a
      `tool_result` row (real output for finished tools, a synthetic `is_error` for the rest).
      History assembly repairs any unanswered `tool_use` it still finds.
- [ ] **Default-deny per channel.** Registration reaches chat; a channel allowlist reaches voice and
      every later channel. Every allowlisted voice tool is `readOnly: true`, asserted at module load.
- [ ] **The gate is applied at dispatch**, through the same role-and-channel filter as advertisement.
      Unknown or forbidden names become an `is_error` result and a log line.
- [ ] **Tools read as the user** (`ctx.userClient`). `ctx.serviceClient` only persists, always with
      an explicit `user_id` / `session_id` filter.
- [ ] **Identity is re-read per request**; the voice worker may cache it for at most 60 s per call.
- [ ] **Static system prompt byte-identical per channel**, carrying the cache breakpoint.
- [ ] **No message content in logs.**
- [ ] **Services throw.**

## Loop contract

- Persistence order per iteration: stream the model turn → persist the assistant row → emit its
  blocks → dispatch tools concurrently → persist the `tool_result` row → emit results → loop.
- **Abort** is checked before each model call, between the model call and dispatch, and after
  dispatch. On abort: persist synthetic results for unfinished tools, then return silently. The
  request owner (api route, voice call) decides whether to emit `error`; the loop never does.
- **Timeouts:** clear every timer on every exit path; pass the abort signal to handlers; a handler
  that timed out is told to stop through its signal and its late result is discarded.
- **Prompt builders are pure.** Cache breakpoints: the last tool definition, the static system
  block, and the last message block (slid forward every iteration).
- **Model profiles:** never send `thinking: { type: "disabled" }`; `between_tools` only on
  `claude-sonnet-5-5` at effort ≤ high; no forced `tool_choice`; no prefill; `fallbacks: "default"`
  with its beta header on Opus 5.5 / Sonnet 5.5 only. Model ids and options live in one profile
  module and nowhere else.
- **Unknown content block types** (thinking, fallback, anything new) are persisted verbatim and
  never emitted to a sink.
- Tool inputs are re-validated with zod at dispatch; the SDK's parsed input is not trusted.
