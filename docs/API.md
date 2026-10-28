# API (`@va/api`)

The HTTP face of the engine for the PWA (and later for WhatsApp webhooks): authenticated,
rate-limited, streaming chat turns with a clean cancel; session mutations; and the voice call
lifecycle that hands the caller's identity to the worker without exposing the JWT. A Hono app on
`@hono/node-server`; `createApp(deps)` builds it from injected dependencies so the tests run it
in-process with `app.request()` against the `@va/core` fakes and never open a port. The plan is
`docs/plan/04-api.md`; the rules are `.claude/rules/api.md`.

## Layout

```
apps/api/src/
├── index.ts            env → deps → serve() on PORT; SIGINT/SIGTERM close the server
├── app.ts              createApp(deps): middleware order, routes, 405 / 404 / error handlers
├── deps.ts             AppDeps (anthropic, registry, env, livekit | null, clock) and the request variables
├── env.ts              zod env (see .env.example)
├── errors.ts           the flat envelope and the status table
├── rate-limit.ts       chat burst/daily, voice calls per day and concurrent calls
├── middleware/         request-id, cors, body-limit (64 KB), auth (bearer → authenticateToken)
├── sse/                SSEWriter (framing, 15 s keepalive, write-failure detection), SseEventSink
├── chat/               prepare (pre-stream pipeline), stream (worker and abort sources), store, route-context
├── routes/             health, chat, sessions, voice
└── voice/              calls (start / refresh / end), livekit (injectable wrapper over livekit-server-sdk)
apps/api/test/          harness (app.request + fakes + FakeLiveKit), prestream (P), stream (C), voice (V)
```

Dependencies: `hono`, `@hono/node-server`, `livekit-server-sdk`, `@anthropic-ai/sdk`, `zod`,
`@va/core`, `@va/db`, `@va/tools-demo` (the registered pack). Nothing from `apps/web` or
`apps/voice`.

## Endpoints

| Method | Path                          | Auth | Body                                                                                                   | Answer                                             |
| ------ | ----------------------------- | ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| GET    | `/health`                     | no   |                                                                                                        | `{ ok: true, service: '@va/api' }`                 |
| POST   | `/chat`                       | yes  | `{ session_id: uuid \| null, message: string, parent_message_id?: uuid, client_context?: { route? } }` | SSE stream (below) or a flat error                 |
| PATCH  | `/sessions/:id`               | yes  | `{ title: string (1..200) }`                                                                           | `{ ok: true }`; 404 when not the caller's          |
| DELETE | `/sessions/:id`               | yes  |                                                                                                        | `{ ok: true }`; 404 when not the caller's          |
| POST   | `/voice/sessions`             | yes  |                                                                                                        | `{ url, token, room, session_id }`                 |
| POST   | `/voice/sessions/:id/refresh` | yes  |                                                                                                        | `{ ok: true }`; 404 when there is no live call     |
| POST   | `/voice/sessions/:id/end`     | yes  |                                                                                                        | `{ ok: true }`, idempotent; 404 for another user's |

Every route except `/health` runs, in order: request id, CORS, the 405 guard for known paths,
the 64 KB body limit, authentication. `Authorization: Bearer <jwt>` is required; the profile
(`public.users`) is re-read with the service role on every request and the token's claims are
never trusted. A known path with the wrong method is 405 before authentication. The PWA lists
sessions and loads messages through supabase-js (RLS); the API only mutates them.

### `POST /chat`, before the stream

In order, each with its failure: body (`bad_request`, `message_too_long`: the cap of 4000
counts the raw string); the rate limit (`rate_limited`); the session (`session_id` null inserts
one; otherwise it must be the caller's: `session_not_found`); the parent (`parent_message_id`
must belong to the session: `not_found`; otherwise the session's newest row, or none on a new
session); history (`ai_session_history(leaf, 200)` through the service client, assembled by
`@va/core`: `internal_error`); the user row (`internal_error`). Any failure after this request
created a session deletes that session again. `client_context.route` is sanitised (a `/path`
without query or hash, ≤ 200 characters) and prepended in memory to the typed text as
`[Kontekst: korisnik je trenutno na /path]`; the row keeps the text as typed.

## The SSE contract

```
: ready
event: session      {"type":"session","session_id":"…"}
event: delta        {"type":"delta","text":"…"}                                               provisional
event: turn         {"type":"turn","role":"assistant","text":"…","message_id":"…"}            canonical: replaces the deltas of this block
event: tool_call    {"type":"tool_call","tool":"…","input":{…},"tool_use_id":"…"}
event: tool_result  {"type":"tool_result","tool":"…","output":{…},"tool_use_id":"…","is_error":false}
event: done         {"type":"done","stop_reason":"end_turn","usage":{"input_tokens":n,"output_tokens":n}}
event: error        {"type":"error","code":"…","message":"…"}
: keepalive         every 15 s idle
```

Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache,
no-transform`, `X-Accel-Buffering: no`, `Connection: keep-alive`, `X-Request-Id`. The event
name always equals `data.type`. `: ready` is written before any work; `session` is always the
first event. A row is written before its event (`turn`, `tool_result`); deltas are the one
provisional exception, and an `error` with `persistence_error` means the client drops the
provisional text of that block. `done.stop_reason` is the model's raw value (`end_turn`,
`max_tokens`, `refusal`, `tool_limit_reached`). After `done` or `error` the stream closes.
Changing an event changes the web client in the same change.

## Errors

Pre-stream failures are `{ error: { code, message } }` with a real status; the message is the
Croatian text from `@va/core`'s catalogue.

| status | code                              | when                                                      |
| ------ | --------------------------------- | --------------------------------------------------------- |
| 400    | `bad_request`, `message_too_long` | malformed JSON, missing or empty message, over 4000 chars |
| 401    | `unauthorized`                    | no bearer, or GoTrue rejects it                           |
| 403    | `no_profile`                      | auth user without a `public.users` row                    |
| 404    | `session_not_found`, `not_found`  | not the caller's session; parent outside it; no live call |
| 405    | `method_not_allowed`              | known path, wrong method                                  |
| 413    | `payload_too_large`               | body over 64 KB                                           |
| 429    | `rate_limited`                    | a limit below                                             |
| 500    | `internal_error`                  | a failed write or read; LiveKit not configured            |
| 502    | `voice_dispatch_failed`           | LiveKit refused the agent dispatch (both rows removed)    |

Mid-stream failures are `error` events on the open 200 stream: the model codes
(`model_rate_limited`, `model_timeout`, `model_unreachable`, `model_bad_request`,
`model_auth_failed`, `model_error`), `persistence_error`, `request_timeout`, `internal_error`.

## Cancellation

One `AbortController` per request feeds the loop. Three sources trip it:

1. **The request signal** (`c.req.raw.signal`): the client closed the connection. Verified on
   `@hono/node-server` 2.1.5 on 2026-10-28 with a probe server, `curl -N` and a kill: the signal
   fired within a millisecond of the disconnect, `writer.closed` rejected at the same moment, and
   every later write failed. This is the primary source; the loop stops at its next check (before
   a model call, between the model call and dispatch, after dispatch) and the in-flight model
   call is aborted through the SDK's signal. No cancel beacon (`docs/decisions/0007`).
2. **The request timeout** (90 s for chat): emits `error(request_timeout)` after the loop.
3. **A failed SSE write** (including the keepalive probe): the fallback for a runtime that hides
   disconnects; harmless here.

After the loop a timeout emits `error(request_timeout)`; a client disconnect emits nothing and
logs one `client disconnect` line with its source. Rows written before the abort stay; tools that
were running get synthetic `is_error` results persisted in the `tool_result` row, so the branch
never ends on a bare `tool_use`. The writer is always closed.

## Rate limits

Counted from the rows that exist, with two parallel `count: 'exact', head: true` queries through
the service role, user-filtered:

| limit                     | counts                                                                            | window |
| ------------------------- | --------------------------------------------------------------------------------- | ------ |
| chat burst: 20            | `ai_messages` with `turn_kind = 'user'` in the user's `channel = 'chat'` sessions | 5 min  |
| chat daily: 200           | same                                                                              | 24 h   |
| voice calls per user: 20  | `ai_sessions` with `channel = 'voice'` for the user                               | 24 h   |
| voice concurrent calls: 3 | `voice_calls` rows with `expires_at` in the future, across all users              | now    |

Tool-result rows never count. A failing count fails **open** and logs an error line. A refused
request writes nothing. Known: the check-then-act race (`API-1`); no `Retry-After` (`API-3`).

## Voice call lifecycle

Landmark §4.4 ported. `POST /voice/sessions`: rate limits → the user's previous `voice_calls`
row is deleted (one live call per user) → `ai_sessions { channel: 'voice', external_id: room,
title: 'Glasovni poziv' }` with `room = 'voice-' + uuid` → an opaque call token (32 random bytes,
base64url) whose SHA-256 goes into `voice_calls` with `platform_call_id = room`, `access_token`
= the caller's JWT and `expires_at = min(JWT exp, now + 15 min)` → `AgentDispatchClient
.createDispatch(room, VOICE_AGENT_NAME, { metadata: { callToken, sessionId } })` → a LiveKit
`AccessToken` (identity = user id, ttl 15 min, roomJoin / canPublish / canSubscribe /
canPublishData) → `{ url, token, room, session_id }`. A failed dispatch removes both rows and
answers 502. The JWT is never in the metadata or the response; the call token never in the
response.

The four rules a `voice_calls` row lives by:

1. **Short TTL, enforced at lookup.** Valid only while `expires_at > now()` (the 15-minute cap
   from call start, never moved by a refresh) and, in the worker, `last_seen_at` within the idle
   window. The worker treats an expired row as absent before it is deleted.
2. **Deleted on call end.** `POST /voice/sessions/:id/end` (the user's JWT plus the ownership
   check; idempotent) and, later, the platform's end-of-call webhook keyed by `platform_call_id`.
   The session and its messages stay; only the credential goes.
3. **A cleanup job** for calls that end without a hangup (Part 7: a `pg_cron` sweep of expired
   rows).
4. **Rotated, never extended.** `POST /voice/sessions/:id/refresh` authenticates with the
   browser's new JWT, replaces `access_token`, and sets `expires_at = min(new exp, created_at +
15 min)`.

Without the three `LIVEKIT_*` variables, start answers 500 `internal_error` and writes nothing.

## Logging

One JSON line per event, `tag: '[api]'`, with `request_id`, `user_id`, `session_id`, codes and
timings. Never the message, the JWT or the call token. Per turn a `timing` line carries
`auth_ms`, `prepare_ms`, `first_delta_ms` (−1 when no delta), `total_ms`, `iterations`,
`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` and `outcome`
(`completed`, `client_disconnect`, `request_timeout`). `X-Request-Id` is taken from the request
when sent (≤ 128 characters) and generated otherwise; it is on every response.

## Running locally

```
cp apps/api/.env.example apps/api/.env      # fill SUPABASE_* from `supabase status`, ANTHROPIC_API_KEY
supabase start
pnpm --filter @va/api dev                   # tsx watch src/index.ts on PORT (3000)
```

The container (`apps/api/Dockerfile`) installs the workspace with the frozen lockfile and runs
`node --import tsx apps/api/src/index.ts`, because the workspace packages export their
TypeScript sources (`OPS-1`). `pnpm --filter @va/api build` emits `dist/` for the day the
packages do too.

### curl recipes

A JWT for the local stack: sign in through the PWA, or with GoTrue directly:

```
curl -s http://127.0.0.1:54431/auth/v1/token?grant_type=password \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'content-type: application/json' \
  -d '{"email":"…","password":"…"}' | jq -r .access_token
```

A streamed turn (`-N` disables curl's buffering; kill curl to see the cancel):

```
curl -N http://localhost:3000/chat \
  -H "Authorization: Bearer $JWT" -H 'content-type: application/json' \
  -d '{"session_id":null,"message":"Koji stolovi postoje?","client_context":{"route":"/"}}'
```

Expected: `: ready`, `event: session`, `event: delta` …, `event: turn`, `event: done`. A voice
call: `curl -X POST http://localhost:3000/voice/sessions -H "Authorization: Bearer $JWT"`; then
`/voice/sessions/<id>/end`. Rename: `curl -X PATCH http://localhost:3000/sessions/<id> -H
"Authorization: Bearer $JWT" -H 'content-type: application/json' -d '{"title":"Novi naslov"}'`.

**Live transcript status (2026-10-28):** no `ANTHROPIC_API_KEY` was available in the session
that built this, so the recipe above was not run against the real model. The cancellation
behaviour was verified with the probe described above and by `C06`/`C07`; the streamed turn by
`C01`–`C14` against the fakes.

## Testing

`apps/api/test/harness.ts` builds the app with `anthropicClient()` from `@va/core/test`, the
demo pack, a `FakeLiveKit` (records dispatches and join tokens, `failNextDispatch`) and a real
clock. `call(path, body, { token, method, raw, headers, signal, app })` sends a `Request` to
`app.request`; `chat(body)` posts and reads the stream; `readSse(res)` parses frames into
`{ raw, comments, events, types }` (`timeoutMs: 0` under fake timers); `flatError(res)`;
`memberJwt(exp)` makes a JWT-shaped token the fake GoTrue accepts; `buildApp(overrides)` for a
different env or no LiveKit. Scenarios: `P01`–`P18` (pre-stream), `C01`–`C14` (stream),
`V01`–`V10` (voice and sessions). `P15` differs from the plan's wording: the history read only
runs on an existing session (a new session has no leaf), so it asserts the 500 and that no user
row is written; `P16` covers the deleted session.

```
pnpm exec vitest run apps/api
VA_TEST_LOGS=1 pnpm exec vitest run apps/api/test/stream.test.ts
```
