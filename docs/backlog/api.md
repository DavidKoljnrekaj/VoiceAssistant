# Backlog — api

Ids: API-12 (next free)

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

### API-4 · Medium · A throwing `joinToken` leaves the session, the credential and the dispatch in place; `rollback()` ignores its results (R-A1)

- **Check:** Confirmed (review 2026-10-30, R-A1)
- **Where:** `apps/api/src/voice/calls.ts` (`joinToken` outside the try/catch; `rollback()`
  discards the two delete results)
- **What happens:** a LiveKit token failure answers 500 and leaves the `ai_sessions` row, the
  `voice_calls` JWT (up to 15 min) and the agent dispatch; a failed rollback leaves an orphan
  credential with no log line (contrast `prepare.ts`). The rule "a pre-stream failure cleans up
  anything the request created" (`.claude/rules/api.md`) is broken on this path. No test for
  either
- **Fix direction:** move `joinToken` inside the try; log a rollback delete error with
  `request_id` and `session_id`; `V` tests for both

### API-5 · Medium · The user's email reaches LiveKit as the participant `name` (R-A2)

- **Check:** Confirmed (R-A2)
- **Where:** `apps/api/src/voice/calls.ts` → `livekit.ts` (`name: email`)
- **What happens:** a sub-processor receives personal data that `docs/SECURITY.md` → Personal
  data does not list; neither the worker nor the browser needs it
- **Fix direction:** drop `name` (the identity is the user id), or add the email to LiveKit's row
  in the personal-data table and the DPA record (`OPS-5`)

### API-6 · Low · `refresh` answers 200 on an expired, unswept call and 500 when the row vanished (R-A3)

- **Check:** Confirmed (R-A3)
- **Where:** `apps/api/src/voice/calls.ts` (the select by `session_id` / `user_id` has no
  `expires_at > now()` filter; zero rows affected by the update is 500)
- **What happens:** `docs/API.md` promises 404 "when there is no live call"; the cap still holds,
  so nothing is revived, but the client cannot tell a dead call from a live one; a row deleted
  between the select and the update answers 500 instead of 404
- **Fix direction:** filter on `expires_at > now()`; map zero rows affected to `not_found`; two
  `V` tests

### API-7 · Low · `session_id` is optional in the chat body (R-A4)

- **Check:** Confirmed (R-A4)
- **Where:** `apps/api/src/chat/prepare.ts` (`.nullable().optional()`; `undefined` is treated as
  "create")
- **What happens:** a client that drops the field forks a session per turn instead of a 400,
  against `docs/API.md` and plan Part 4 §2 (`uuid | null`, required). No test sends an
  authenticated body without it
- **Fix direction:** `.nullable()` only; a `P` test

### API-8 · Low · The concurrent-call cap counts the caller's own stale row and ignores idle (R-A5)

- **Check:** Confirmed (R-A5)
- **Where:** `apps/api/src/voice/calls.ts` (the rate check runs before the caller's previous row
  is deleted); `rate-limit.ts` (`voice_calls` filtered on `expires_at` only, not `last_seen_at`)
- **What happens:** with two other calls live and the caller's own unexpired row still there, a
  re-start is 429; without the sweep (no pg_cron until `REL-1`) three abandoned calls block
  everyone for up to 15 min
- **Fix direction:** delete the caller's previous row first, then count; add the idle filter the
  worker uses

### API-9 · Low · No timeout on the pre-stream phase (R-A6)

- **Check:** Confirmed (R-A6)
- **Where:** `apps/api/src/chat/stream.ts` (the 90 s timer starts after `: ready` and `session`);
  the auth and prepare steps (GoTrue plus up to five PostgREST round trips); supabase-js's fetch
  has no default timeout
- **What happens:** a hung Supabase leaves the request open for ever before any byte is written
- **Fix direction:** an `AbortSignal.timeout` on the pre-stream phase, answered as
  `internal_error` with a log line; a `C` test with a held PostgREST request

### API-10 · Low · Shutdown does not abort open streams; `Connection: keep-alive` is illegal over HTTP/2 (R-A8)

- **Check:** Confirmed (R-A8)
- **Where:** `apps/api/src/index.ts` (`server.close()` on SIGTERM waits for the streams);
  `apps/api/src/chat/stream.ts` (the `Connection` header)
- **What happens:** a deploy waits up to 90 s per open stream; an HTTP/2 front (Caddy,
  Cloudflare) may reject or strip the header
- **Fix direction:** abort every open stream's controller on shutdown, then close; set
  `Connection` only on HTTP/1, or drop it (the proxy owns it)

### API-11 · Low · Untested API paths (R-A9)

- **Check:** Confirmed (R-A9)
- **Where:** the `sse.write_failed` abort source (`res.body.cancel()`); `app.onError` → 500
  envelope; the previous-call delete failure; a request timeout during tool dispatch (`C05`
  covers the model call only); CORS with a concrete origin list (`P01` tests `*` only); a missing
  bearer on `/sessions/*` and `/voice/*`; a non-UUID `:id`; `X-Request-Id` over 128 chars; plus
  `API-4`, `API-6`, `API-7`
- **What happens:** each is a regression CI would not see
- **Fix direction:** one test per path in the existing `C`, `P` and `V` suites

## Resolved

Nothing yet.
