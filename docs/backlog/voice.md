# Backlog — voice

Ids: VOICE-16 (next free)

The voice worker (`apps/voice`) and the spoken sink: adapters, latency, bench.

## Open

### VOICE-1 · Medium · OQ: where the worker runs is not decided

- **Check:** Confirmed (by design; `docs/VOICE.md` → Hosting)
- **Where:** `apps/voice/Dockerfile` builds a container that nothing deploys
- **What happens:** the worker runs on a developer machine; no call can be taken when it is off
- **Fix direction:** choose LiveKit Cloud agent hosting (EU) or an own container next to the
  Supabase project, write `docs/decisions/0011`, and add the deploy to `docs/OPS.md` (Part 7).
  Either way the secrets in `apps/voice/.env.example` must be set where it runs

### VOICE-2 · Low · Croatian voice text in the worker has not had a native review

- **Check:** Confirmed (the two user-facing files are marked)
- **Where:** `GREETING_HR` in `apps/voice/src/greeting.ts`, `apps/voice/bench/questions.hr.txt`
  and the bench's session title in `scripts/llm-bench.ts`; `apps/voice/hints/hr.txt` is
  speech-to-text vocabulary, not spoken, and needs a check for spelling only; the filler and
  the refusal line are `CORE-1`
- **What happens:** the first thing a caller hears is a placeholder written by the port, and the
  bench asks questions nobody has checked for naturalness
- **Fix direction:** read with `CORE-1`; remove the marks in one commit; re-run the bench

### VOICE-3 · Low · Soniox end-of-turn outliers are not watched

- **Check:** Runtime check needed (Landmark saw one take at ~2.6 s against ~1.3 s for the rest)
- **Where:** `turns.jsonl` → `end_of_turn_delay_ms`; `ENDPOINT_DELAY_MS` / `ENDPOINT_LATENCY_LEVEL`
- **What happens:** one question in a call waits two seconds longer than the others before the
  worker starts answering, which the caller hears as the assistant hesitating
- **Fix direction:** once the live checklist runs (`REL-2`), look at the distribution over more
  speakers; if the tail is real, try `ENDPOINT_DELAY_MS` and report to Soniox with the take

### VOICE-4 · Low · A job process takes ~6 s to import the worker through tsx

- **Check:** Confirmed (measured 2026-10-29: import 5.7 s, Silero prewarm 0.3 s)
- **Where:** `apps/voice/src/agent.ts` → `ServerOptions` (`initializeProcessTimeout: 60_000`,
  `numIdleProcesses: 1`); the cause is `OPS-1` (TypeScript sources run through tsx)
- **What happens:** the first live call timed out LiveKit's 10 s runner initialisation ("runner
  initialization timed out") and the caller heard nothing; with the longer timeout and one idle
  process a call never waits, but a burst of calls beyond the idle pool pays 6 s each
- **Fix direction:** build the workspace to `dist` (`OPS-1`) so the job process imports compiled
  JavaScript; then the timeout can go back to the default

### VOICE-6 · Medium · `transcription_delay_ms` and `end_of_turn_delay_ms` are always null (R-V1)

- **Check:** Confirmed (review 2026-10-30, R-V1)
- **Where:** `apps/voice/src/metrics.ts` `turnEntry` reads them off the assistant item; in
  `@livekit/agents` 1.9.2 they sit on the **user** message (`agent_activity.js` sets
  `userMessage.metrics`); the assistant item carries only `llmNodeTtft`, `ttsNodeTtfb`,
  `e2eLatency` and the playback fields
- **What happens:** `turns.jsonl` never has the two Soniox figures; `docs/VOICE.md` (the live
  checklist) blames the plugin; `VOICE-3` cannot be done. `W13` feeds a hand-built item with all
  five fields, so it cannot catch this
- **Fix direction:** read the user item's metrics too (one `timing` line per turn joining both);
  a test built from the real item shapes; correct the explanation in `docs/VOICE.md`

### VOICE-7 · Medium · The `timing` line's `marks` carry names but no times (R-V2)

- **Check:** Confirmed (R-V2)
- **Where:** `apps/voice/src/session.ts` joins `result.marks`; `LoopMark`
  (`packages/core/src/loop/ports.ts`) is a four-literal union with no timestamp
- **What happens:** `docs/OPS.md` (`name@ms`) and the comment in `session.ts` claim otherwise;
  model time against tool time cannot be read from the logs, which the latency work needs
- **Fix direction:** the hook receives `(mark, atMs)` or the loop stamps each mark; the line
  prints `name@ms`; a `W` test on the line's shape

### VOICE-8 · Medium · First sound: the held first sentence waits for the next sentence, and every paragraph break opens a TTS segment (R-V3)

- **Check:** Code reading (R-V3, verified 2026-10-30); measure before changing (`/bench-voice`)
- **Where:** `packages/core/src/sinks/spoken.ts` (the hold releases on `/[.!?]\s+\S/`, the start
  of the _next_ sentence, otherwise on `done`; `holding` re-arms after the filler);
  `apps/voice/src/assistant-llm.ts` (`\n\n` → `FlushSentinel`); `speakable.ts` keeps `\n\n` (`S09`)
- **What happens:** a one-sentence answer, which the prompt asks for, reaches TTS only after the
  whole generation; the measured `llm_ttft` of 2.3–3.1 s against a model first event of ~1.2 s
  fits. Each paragraph break costs a TTS seam (~130–150 ms TTFB). A `\n\n` split across two
  deltas produces no flush at all (the cut is at whitespace), so the sentinel is
  tokeniser-dependent. Against the targets (first sound ≤ 1.5 s, one-lookup answer ≤ 4 s) the
  29 Oct live run gave 2.36–3.33 s and p50 4.2 s
- **Fix direction:** in order of expected gain, each measured before and after: release the held
  sentence after a short timer as well as on the next sentence; drop the announcement heuristic
  for the filler-less case; collapse paragraph breaks inside the answer. Further levers from the
  review: Landmark's entity list in the per-user block (saves a round, ~1.3 s on lookups);
  refresh the 60 s identity off the hot path from the keepalive timer (~0.25 s on the turn that
  crosses 60 s); build to `dist` (`VOICE-4` / `OPS-1`)

### VOICE-9 · Low · Overlapping turns race the save chain (R-V4)

- **Check:** Confirmed (R-V4, verified 2026-10-30)
- **Where:** `apps/voice/src/session.ts` (`persistAfter: this.saves` captured at turn start;
  `saves` and `rows` updated only when `runVoiceTurn` returns); `assistant-llm.ts` (`cancel()`
  returns at once while the loop is still unwinding); `turn.ts` `persistTurn` reads the leaf
- **What happens:** when LiveKit starts the next `llmNode` while a cancelled turn's loop is still
  unwinding (a handler ignoring its signal, up to the 6 s tool timeout), both turns read the same
  leaf: two user rows with the same `parent_id`, and the new turn's history misses the cancelled
  turn's rows. `docs/VOICE.md` §6 claims serialised saves; `W08` cancels but asks nothing afterwards
- **Fix direction:** register the turn's save promise before `runVoiceTurn` resolves (a per-turn
  deferred), or serialise `runTurn` on a mutex; a test that cancels during a stalled handler,
  asks again and asserts one parent chain

### VOICE-10 · Low · After a barge-in the history says the caller heard the whole answer (R-V5)

- **Check:** Confirmed (R-V5, verified 2026-10-30)
- **Where:** `apps/voice/src/turn.ts` (`DeferredStore` keeps the full assistant row and `rows`
  return it as history); decision 0011 reads only the worker's rows and its consequences do not
  mention it
- **What happens:** LiveKit truncates its own context to what was played; the model's history
  keeps the unheard rest, so it may refer to something the caller never heard
- **Fix direction:** at least a line in 0011's consequences and `docs/VOICE.md`; a code fix needs
  the played-text length from the speech handle to cut the persisted row

### VOICE-11 · Low · After the 15-minute cap the call stays open and apologises on every question (R-V6)

- **Check:** Confirmed (R-V6, verified 2026-10-30)
- **Where:** `apps/voice/src/call.ts` (`liveRow` null → `ctx()` throws `call_ended`);
  `session.ts` (mapped to `unauthorized` and spoken); `agent.ts` ends the call only on
  `ParticipantDisconnected`, `Disconnected` and shutdown
- **What happens:** past the cap every turn hears the refusal line; nothing calls `endCall` or
  closes the session
- **Fix direction:** on `call_ended` speak the line once, then an injected `onEnded` →
  `endCall('expired')` and shutdown; a `W` test

### VOICE-12 · Low · Call end paths: any participant's disconnect ends the call, an STT or TTS failure never does (R-V7, R-V8)

- **Check:** Confirmed (R-V7, R-V8, verified 2026-10-30)
- **Where:** `apps/voice/src/agent.ts` (the `ParticipantDisconnected` handler does not check the
  identity; the `error` handler only logs; no `Closed` handler)
- **What happens:** a recorder, egress or a browser reconnecting under a new identity ends a live
  call; a Soniox or ElevenLabs outage leaves the caller silent (LiveKit closes the session after
  `maxUnrecoverableErrors`; nothing speaks or ends the call). Model and identity failures are
  spoken (`W11`, `W14b`, `W14c`)
- **Fix direction:** compare `participant.identity` with the caller's; on an unrecoverable error
  say `MESSAGES_HR.internal_error` where TTS still works, then `endCall('session_error')` and
  shutdown; handle `Closed` the same way

### VOICE-13 · Low · `callHistory` keeps at least 20 rows, not at most (R-V9)

- **Check:** Confirmed (R-V9, verified 2026-10-30)
- **Where:** `apps/voice/src/messages.ts` (the loop breaks at the first user row where
  `rows.length - i >= maxMessages`)
- **What happens:** the window is 20 rows plus the rest of the turn it starts in; `docs/VOICE.md`
  and the plan say "last 20". `W04e` passes only because its turns are 4 rows (60 → exactly 20).
  The other half of R-V9, a markdown link split across two chunks, is `CORE-4`
- **Fix direction:** decide: break at the last user row with `rows.length - i <= maxMessages`
  (at most 20, the plan's reading) or document "at least 20, cut on a turn boundary"; `W04e`
  with a 3-row turn either way

### VOICE-14 · Low · `connected` logs a random `request_id` (R-V9)

- **Check:** Confirmed (R-V9, verified 2026-10-30)
- **Where:** `apps/voice/src/agent.ts` (`request_id: randomUUID()` on the `connected` line)
- **What happens:** a correlation id that correlates with nothing
- **Fix direction:** drop the field; the call's `session_id` is the correlation key

### VOICE-15 · Low · Untested worker paths (R-V11)

- **Check:** Confirmed (R-V11)
- **Where:** all of `agent.ts` (entry wiring, keepalive, the `endCall` paths, event handlers, the
  warm fire-and-forget); `turnEntry` against a real LiveKit item (`VOICE-6`); `redact` against
  real pino (`W18b` uses a bare `Writable`); overlapping turns (`VOICE-9`); a `\n\n` inside an
  answer producing extra flushes; `request_timeout` during a tool round (`W16` hangs the model
  only); the 6 s tool timeout as a spoken outcome; a `persistTurn` leaf-read failure;
  `callHistory` at `HISTORY_CEILING_TOKENS`
- **What happens:** the harness exercises the worker's side of the `llmNode` stream (string
  chunks, cancel, flush) but not LiveKit's `performLLMInference` / `produceSegments`, which is
  why `VOICE-6` was not caught
- **Fix direction:** a thin seam in `agent.ts` (handlers as named functions) and tests through
  it; real item shapes captured from one live call for `turnEntry`

## Resolved

### VOICE-5 · Medium · The call's context carries no tool rounds, so the model disowns its own earlier answer

Resolved by decision 0011: the model's history is the call's own rows (tool rounds included),
kept in worker memory by `CallSession` and assembled by `callHistory`; LiveKit's context supplies
only the new user turn. A prompt line and filler stripping were tried live first and did not
help. Confirmed live on 2026-10-29: the second question ("Koliko košta stolna lampa?") was
answered directly from the first turn's tool result, no retraction, no new lookup.
