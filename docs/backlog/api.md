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

### API-10 · Low · Shutdown does not abort open streams; `Connection: keep-alive` is illegal over HTTP/2 (R-A8)

- **Check:** Confirmed (R-A8)
- **Where:** `apps/api/src/index.ts` (`server.close()` on SIGTERM waits for the streams);
  `apps/api/src/chat/stream.ts` (the `Connection` header)
- **What happens:** a deploy waits up to 90 s per open stream; an HTTP/2 front (Caddy,
  Cloudflare) may reject or strip the header
- **Fix direction:** abort every open stream's controller on shutdown, then close; set
  `Connection` only on HTTP/1, or drop it (the proxy owns it)

## Resolved

### API-4 · Medium · A throwing `joinToken` leaves the session, the credential and the dispatch in place; `rollback()` ignores its results (R-A1)

- Fixed on `fix/api-review` (`fix(api): a failed join token cleans up the call rows; rollback failures are logged`): `joinToken` inside the guarded section, 500 after the rollback, each rollback delete logged as `rollback failed`. `V11`, `V12`.

### API-5 · Medium · The user's email reaches LiveKit as the participant `name` (R-A2)

- Fixed on `fix/api-review` (`fix(api): the LiveKit participant carries no name`): `name` dropped from the join token and from `JoinTokenInput`; LiveKit learns the user id only. `V13`; the personal-data table in `docs/SECURITY.md` names what LiveKit receives.

### API-6 · Low · `refresh` answers 200 on an expired, unswept call and 500 when the row vanished (R-A3)

- Fixed on `fix/api-review` (`fix(api): refresh answers 404 for an expired call and for a row lost under it`): the lookup filters `expires_at > now()`, zero rows affected is `not_found`. `V14`, `V15`.

### API-7 · Low · `session_id` is optional in the chat body (R-A4)

- Fixed on `fix/api-review` (`fix(api): session_id is required in the chat body`): `.nullable()` only. `P19`.

### API-8 · Low · The concurrent-call cap counts the caller's own stale row and ignores idle (R-A5)

- Fixed on `fix/api-review` in two commits: the caller's previous row is deleted before the counts (`V16`), and the concurrent count carries `last_seen_at > now - 3 min` (`CALL_IDLE_MS`, `V17`); the fake applies the DDL default for `last_seen_at`.

### API-9 · Low · No timeout on the pre-stream phase (R-A6)

- Fixed on `fix/api-review` (`fix(api): a 10 s deadline on the pre-stream phase`): `deadline.ts`; auth raced, prepare queries carry the abort signal; 500 `internal_error` plus a `pre-stream timeout` line. `P20`, `P21`.

### API-11 · Low · Untested API paths (R-A9)

- Closed on `fix/api-review` (`test(api): the untested paths from the review`): `C15` write failure via `res.body.cancel()`, `C16` `onError` envelope, `C17` timeout during dispatch, `C18` `done.usage` (R-A7), `P22` CORS origin list, `P23` missing bearer on `/sessions` and `/voice`, `P24` non-UUID id, `P25` `X-Request-Id` over 128, `V18` previous-call delete failure; `API-4`, `API-6`, `API-7` through their own tests.
