# Backlog — api

Ids: API-4 (next free)

The HTTP API (`apps/api`): auth, SSE, sessions, rate limits, voice session endpoints.

## Open

### API-1 · Low · OQ: the rate limiter has a check-then-act race

- **Check:** Confirmed (by design, ported from Landmark)
- **Where:** `apps/api/src/rate-limit.ts`, `checkChatRateLimit` and `checkVoiceRateLimits`
- **What happens:** N requests fired within one round trip all count the same rows, all pass,
  and the user gets N turns (or calls) past the limit. The excess is bounded by what fits in one
  round trip, not by the limit
- **Fix direction:** a Postgres advisory lock around count-and-insert, or a token bucket keyed
  by user (`SELECT … FOR UPDATE` on a per-user counter row); `P09` and `V03` pin the limits

### API-2 · Low · No compaction on the chat channel

- **Check:** Confirmed (by design; `CORE-3` holds the engine side)
- **Where:** `apps/api/src/chat/stream.ts` after the loop: nothing runs post-turn; `prepare.ts`
  applies a summary if one exists, so the read side is ready
- **What happens:** a long thread replays its whole branch until the 130K-token hard ceiling
  drops the oldest turns
- **Fix direction:** port Landmark's `maybeCompactSession` as a best-effort step after `done`
  (the heartbeat covers it), writing `context_summary` and `summary_through_message_id`;
  gate it on `settings.compaction`

### API-3 · Low · A 429 carries no `Retry-After` header

- **Check:** Confirmed
- **Where:** `apps/api/src/chat/prepare.ts` and `voice/calls.ts` return the flat `rate_limited`
  envelope only
- **What happens:** the client can show the Croatian message but cannot tell the user when to
  try again; the window (5 min or 24 h) is only in the log line
- **Fix direction:** return the verdict's window from `rate-limit.ts` and set `Retry-After`
  (seconds) on the 429; the web client reads it in Part 6

## Resolved

Nothing yet.
