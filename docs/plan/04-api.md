# Part 4 — `apps/api`: auth, chat over SSE, sessions, voice session endpoints

## Prompt for the session

```
Read docs/plan/00-brief.md and docs/plan/04-api.md, then implement Part 4 on a branch feat/api from main.
Restate the deliverables and the acceptance checklist first and ask me only about what the plan leaves
open. The API is a Hono app on Node; tests call app.request() in-process against the @va/core fakes and
never open a port. When done, run /done, write docs/API.md, and report, including the curl transcript of
a real streamed turn against the local Supabase stack if ANTHROPIC_API_KEY is available to you, and a
clear statement if it is not.
```

## Goal

The HTTP face of the engine for the PWA (and later for WhatsApp webhooks): authenticated, rate-limited,
streaming chat turns with a clean cancel; session helpers; and the voice call lifecycle endpoints that
hand the caller's identity to the worker without exposing the JWT.

## Deliverables

```
apps/api/src/
├── index.ts            serve() on PORT; graceful shutdown
├── app.ts              createApp(deps) → Hono (deps: anthropic client, db clients, registry, env, clock)
├── env.ts              zod env: PORT, SUPABASE_*, ANTHROPIC_API_KEY, AI_* overrides, LIVEKIT_URL/API_KEY/API_SECRET, VOICE_AGENT_NAME, CORS_ORIGINS
├── middleware/
│   ├── auth.ts         bearer → authenticateToken → c.set('ctx')
│   ├── request-id.ts   X-Request-Id in/out
│   ├── body-limit.ts   64 KB
│   └── cors.ts
├── sse/
│   ├── writer.ts       SSEWriter (port), keepalive 15 s, write-failure detection
│   └── sink.ts         SseEventSink (port + delta + messageId on turn)
├── routes/
│   ├── health.ts       GET /health
│   ├── chat.ts         POST /chat
│   ├── sessions.ts     PATCH /sessions/:id (title), DELETE /sessions/:id
│   └── voice.ts        POST /voice/sessions, POST /voice/sessions/:id/refresh, POST /voice/sessions/:id/end
├── chat/
│   ├── prepare.ts      pre-stream pipeline (validate → rate limit → resolve session → history → insert user row)
│   ├── stream.ts       streamChatResponse (worker, abort sources, timeout)
│   └── store.ts        DbMessageStore(ctx, sessionId)
├── rate-limit.ts       chat burst/daily; voice calls/day; concurrent calls
└── voice/
    ├── calls.ts        start / refresh / end against voice_calls + LiveKit dispatch
    └── livekit.ts      thin wrapper over livekit-server-sdk (AccessToken, AgentDispatchClient), injectable
apps/api/test/          harness (app.request + fakes), scenarios P/C/V
apps/api/Dockerfile
docs/API.md
```

## Specification

### 1. App shape

`createApp(deps)` returns the Hono app so tests inject fakes and a fixed clock. `index.ts` builds the
real deps from `env.ts` and calls `serve({ fetch: app.fetch, port })` from `@hono/node-server`.
Every route except `/health` runs `requestId`, `cors`, `bodyLimit`, `auth`.

Error envelope for pre-stream failures: `{ error: { code, message } }` with the status table from
`.claude/rules/api.md`. Mid-stream failures are `error` events on the 200 stream.

### 2. `POST /chat`

Body (zod): `{ session_id: uuid | null, message: string (1..4000 after trim), parent_message_id?: uuid | null, client_context?: { route?: string } }`.

Pre-stream (`chat/prepare.ts`), in order, each step's failure code in brackets:

1. validate body [`bad_request` / `message_too_long`];
2. `checkChatRateLimit(ctx)` (burst 20 / 5 min, daily 200, counting `ai_messages` rows with
   `turn_kind = 'user'` joined to the user's `channel = 'chat'` sessions; fails **open** on a count error,
   loudly logged) [`rate_limited`, 429];
3. resolve the session: `session_id` null → insert `ai_sessions { user_id, channel: 'chat' }`; otherwise
   select by id **and** `user_id` [`session_not_found`, 404];
4. resolve the parent: given `parent_message_id` → must belong to the session [`not_found`, 404]; else the
   session's newest row (leaf) or null on a new session;
5. history: `ai_session_history(leaf, settings.historyMaxRows)` through the service client (only when a
   leaf exists) → `assembleHistory` [`internal_error`];
6. insert the user row (`turn_kind: 'user'`, `content: [{ type: 'text', text }]`, `parent_id: leaf`) and
   append it to the in-memory messages [`internal_error`];
7. **on any failure after step 3 created a session, delete that session** (Landmark's OQ-7 fixed by design).

Per-turn context (`client_context.route`) is prepended in memory to the typed text as
`[Kontekst: korisnik je trenutno na …]`, never persisted (Landmark). Skip when absent.

Stream (`chat/stream.ts`): return `new Response(readable, { headers })` with
`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`,
`X-Accel-Buffering: no`, `Connection: keep-alive`. The worker: write `: ready`, emit `session`, run
`runOrchestrationLoop` with `SseEventSink`, `DbMessageStore`, hooks `{ isCancelled: () => signal.aborted, onComplete: backfillTitleIfNew }`.

Abort sources feeding one `AbortController`: (a) `c.req.raw.signal` (client closed the connection),
(b) the request timeout (90 s), (c) `SSEWriter` write failure. After the loop: timeout → emit
`error(request_timeout)`; client abort → log `client disconnect`, emit nothing; else nothing. Always
`sse.close()` in `finally`. **Verify in a live test that (a) fires on `@hono/node-server`** (open a stream
with `curl -N`, kill curl, expect the loop to stop at the next boundary within one keepalive); if it does
not, (c) is the fallback and the finding goes in `docs/API.md`.

Events (the contract for Part 6, also in `docs/API.md`):

```
: ready
event: session      {"type":"session","session_id":"…"}
event: delta        {"type":"delta","text":"…"}                       provisional
event: turn         {"type":"turn","role":"assistant","text":"…","message_id":"…"}   canonical, replaces deltas of this block
event: tool_call    {"type":"tool_call","tool":"…","input":{…},"tool_use_id":"…"}
event: tool_result  {"type":"tool_result","tool":"…","output":{…},"tool_use_id":"…","is_error":false}
event: done         {"type":"done","stop_reason":"end_turn","usage":{"input_tokens":n,"output_tokens":n}}
event: error        {"type":"error","code":"…","message":"…"}
: keepalive         every 15 s idle
```

`SSEWriter`: port Landmark's (`writeEvent`, `writeComment`, idempotent `close`, heartbeat reset on every
write, `onWriteFailure` fired once). `SseEventSink`: port, plus `textDelta → delta` and `message_id` on
`turn`.

`backfillTitleIfNew`: first 60 trimmed characters of the opening message, only when this request created
the session (port).

### 3. Sessions

The PWA lists sessions and loads messages directly through supabase-js (RLS, Part 2). The API only
mutates: `PATCH /sessions/:id { title }` and `DELETE /sessions/:id`, both service role with `user_id`
filter and `assertRowsAffected` (a filtered update/delete that hits zero rows is a 404, never a silent
success).

### 4. Voice session endpoints (`routes/voice.ts`, `voice/calls.ts`)

Port Landmark's `voice-session` function onto Hono, with these additions:

- `POST /voice/sessions` (start): authenticate; `checkVoiceRateLimits(ctx)` (calls per user per day ≤ 20
  counting `ai_sessions` with `channel = 'voice'`; concurrent calls ≤ 3 counting live `voice_calls` rows
  globally) [`rate_limited`]; delete the user's previous `voice_calls` row (one live call per user);
  insert `ai_sessions { channel: 'voice', external_id: room, title: 'Glasovni poziv' }` with
  `room = 'voice-' + uuid`; mint the opaque token (32 random bytes, base64url), insert `voice_calls`
  (`call_token_hash` = SHA-256 hex, `platform_call_id` = room, `access_token` = the caller's JWT,
  `expires_at = min(jwt exp, now + 15 min)`); `AgentDispatchClient.createDispatch(room, agentName, { metadata: JSON.stringify({ callToken, sessionId }) })`;
  mint a LiveKit `AccessToken` (identity = userId, ttl 15 m, grants roomJoin/canPublish/canSubscribe/canPublishData);
  respond `{ url, token, room, session_id }`. If the dispatch fails, delete both rows and return 502 `voice_dispatch_failed`.
- `POST /voice/sessions/:id/refresh`: the browser's new JWT replaces `access_token`;
  `expires_at = min(new exp, created_at + 15 min)` (the cap never moves). 404 when there is no live call.
- `POST /voice/sessions/:id/end`: delete the `voice_calls` row for `(session_id, user_id)`; idempotent.

`voice/livekit.ts` wraps the SDK so tests inject a fake that records dispatches and returns a canned token.

### 5. Rate limiting (`rate-limit.ts`)

Port Landmark's two parallel `count: 'exact', head: true` queries with the `turn_kind` filter. Voice
limits as above. The known race (N concurrent requests all pass) is accepted and documented; the fix
(advisory lock or token bucket) is a backlog entry.

### 6. Logging

One JSON line per event with `tag: '[api]'`, `request_id`, `user_id`, `session_id`, `code`, and timings.
Per turn, log a `timing` line with `auth_ms`, `prepare_ms`, `first_delta_ms`, `total_ms`, iterations,
tokens and cache counts (from `hooks.mark` / `hooks.usage`). Never the message, never the JWT, never the
call token.

### 7. Tests (`apps/api/test/`)

Harness: `createApp` with the fakes from `@va/core/test` (Anthropic and Supabase routed through
`globalThis.fetch`), a fake LiveKit wrapper, a controllable clock (`vi.useFakeTimers()`); `call(body, { token })`
returns `app.request(new Request('http://in-process/chat', …))`; `readSse(res)` parses frames into
`{ comments, events, types }`. Scenarios (ids are the spec):

**Pre-stream (`P`)**: P01 CORS preflight; P02 non-POST 405; P03 missing bearer 401 before any DB or model call;
P04 GoTrue-rejected token 401; P05 no profile 403; P06 role re-read with the service role on every request;
P07 malformed JSON 400; P08 empty / whitespace / 4001-char message; P09 burst 19 pass, 20 → 429, nothing written;
P10 daily 200 → 429; P11 tool_result rows do **not** count; P12 count failure fails open and logs;
P13 unknown or foreign session 404; P14 parent outside the session 404; P15 history RPC failure 500 and the
just-created session is deleted; P16 user-row insert failure 500 and the session is deleted; P17 body over
64 KB 413; P18 request id echoed.

**Stream (`C`)**: C01 `: ready` first, `session` second, every `event:` name equals its `data.type`;
C02 plain answer: deltas, then `turn` with the row id, `done`; rows `[user, assistant]`; C03 route context
prepended in memory only, never persisted; C04 one tool round trip through the user's JWT; C05 90 s timeout:
keepalives every 15 s then `error(request_timeout)`; C06 client abort mid-model-call: no further rows, no
event, one `client disconnect` log line; C07 abort during dispatch: synthetic tool_result row persisted,
stream closed cleanly; C08 persistence failure → `error(persistence_error)` and the stream ends; C09 title
backfilled on a new session only; C10 follow-up replays root → parent and chains the new user row off the
leaf; C11 `parent_message_id` given → chains off it; C12 the model request carries chat settings (Opus 5.5,
no `thinking`, effort from env, fallbacks + beta); C13 an unanswered tool_use left by a crashed earlier turn is
repaired before the model is called (seed it; the fake would reject the raw history).

**Voice (`V`)**: V01 start: session + voice_calls rows (token hashed, expiry capped at 15 min, room bound),
one dispatch with `{ callToken, sessionId }` metadata, response shape; V02 a second start deletes the first
call row; V03 21st call of the day → 429; V04 4th concurrent live call → 429; V05 dispatch failure → 502 and
both rows removed; V06 refresh replaces the JWT and never extends past the cap; V07 refresh / end for another
user's session → 404; V08 end is idempotent; V09 start without LiveKit env → 500 `internal_error`, nothing written.

### 8. Dockerfile and run

Multi-stage: `pnpm install --frozen-lockfile`, `pnpm --filter @va/api... build`, runtime `node:24-slim`
running `node apps/api/dist/index.js`. `apps/api/.env.example` lists every variable with a comment.
`pnpm --filter @va/api dev` runs `tsx watch src/index.ts`.

## Acceptance checklist

- [ ] P/C/V scenarios green; `pnpm --filter @va/api typecheck` and lint green.
- [ ] A live transcript (if a key is available): `curl -N` against the local stack shows `: ready`, `session`, `delta`s, `turn`, `done`; killing curl stops the loop (documented either way).
- [ ] `docs/API.md`: endpoints, the SSE contract, error table, cancellation (which abort source works on this runtime), rate limits, voice call lifecycle (four rules from Landmark §4.4), logging fields, how to run locally, curl recipes.
- [ ] Backlog: rate-limit race; compaction; `Retry-After` header on 429.

## Do not

- Read history for voice here (the worker owns the call's history).
- Put the JWT into LiveKit metadata or into the response to the browser.
- Trust `session_id` or `parent_message_id` without the `user_id` filter.
- Buffer the stream (no compression middleware on `/chat`).

## Landmark references

- `supabase/functions/ai-chat/index.ts` (`handleChat`, `streamChatResponse`, `runChatTurn`, `chatLoopConfig`, `backfillTitleIfNew`)
- `supabase/functions/_shared/sse.ts`, `_shared/rateLimit.ts`, `_shared/routeLabels.ts`
- `supabase/functions/voice-session/index.ts` (the three actions), `docs/voice/02-voice-implementation-plan.md` §4.4, §7
- `supabase/functions/ai-chat/tests/prestream.test.ts`, `loop.test.ts` (scenario wording), `voice-llm/tests/`
- `docs/AI_CHAT.md` → Cancellation, Operations & Rate Limiting, Troubleshooting (curl recipe)
