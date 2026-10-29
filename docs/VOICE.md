# Voice (`@va/voice`)

The LiveKit Agents worker: it takes a call the API dispatched, resolves the caller from the
opaque call token, listens with Soniox, answers through the shared engine in-process with the
spoken-text sink, speaks with ElevenLabs, handles barge-in, writes each turn's rows after the
answer and deletes the call's credential on hang-up. Landmark's prototype worker and its
`voice-llm` edge function are one process here: no HTTP hop on the hot path. The plan is
`docs/plan/05-voice-worker.md`; the rules are `.claude/rules/voice.md`.

## The chain

```
browser (call button) ──POST /voice/sessions──▶ apps/api ── ai_sessions(channel 'voice') + voice_calls(JWT by token hash)
      │                                             └── LiveKit Cloud: room + agent dispatch { callToken, sessionId }
      └──WebRTC──▶ LiveKit room ──▶ apps/voice worker (AGENT_NAME, dispatched jobs only)
                                     ├─ STT  Soniox stt-rt-v5, EU host, Croatian, vocabulary hints, end of turn on Soniox's token
                                     ├─ VAD  Silero (barge-in), or Soniox's first interim words (INTERRUPT_ON)
                                     ├─ LLM  AssistantAgent.llmNode → @va/core runOrchestrationLoop + SpokenTextSink, in-process
                                     │        tools run as the caller (RLS); rows written after the answer; warm-up on dispatch
                                     └─ TTS  ElevenLabs eleven_v4_turbo, Karlo; a flush after the filler so it is heard at once
```

## Layout

```
apps/voice/
├── src/
│   ├── agent.ts            defineAgent({ prewarm, entry }); cli.runApp with AGENT_NAME and the dispatch-only requestFunc
│   ├── env.ts              zod env (the Settings table below)
│   ├── job.ts              callTokenOf(metadata), acceptDispatchedJob(req): a job without a call token is refused
│   ├── call.ts             CallIdentity: token → voice_calls → authenticateToken; 60 s cache; touch(); end()
│   ├── config.ts           VoiceDeps, voiceLoopConfig(deps, ctx): the LoopConfig of one caller; dateLine
│   ├── messages.ts         chat context → InMemoryMessage[] (port of voice-llm/messages.ts)
│   ├── turn.ts             runVoiceTurn: the loop + SpokenTextSink + DeferredStore; persistTurn after the answer
│   ├── session.ts          CallSession: turn cap, identity read, last_seen bump, chained saves, the timing line, settle()
│   ├── session-options.ts  turn handling as data: Soniox end of turn, VAD barge-in, no preemptive generation, no recording
│   ├── assistant-llm.ts    AssistantAgent (llmNode override), engineStream, EngineLLM (the stub LiveKit requires)
│   ├── redact.ts           no `lk.pii.*` key leaves the process: LiveKit's own log lines lose them on stdout
│   ├── warm.ts             warm(deps, ctx): max_tokens 0 with the real system/tools/profile
│   ├── metrics.ts          turns / bargein / warm / bench JSONL writers: timings and lengths, never text
│   ├── greeting.ts         GREETING_HR
│   ├── providers/          stt.ts (Soniox), tts.ts (ElevenLabs), vad.ts (Silero), hints.ts (hints/hr.txt)
│   └── index.ts            the LiveKit-free surface the scripts and tests use
├── hints/hr.txt            vocabulary hints, one term per line
├── bench/questions.hr.txt  the bench's question set (`id|text`)
├── scripts/                llm-bench.ts, call-test.ts, speech-span.ts
├── test/                   harness + W scenarios (no LiveKit connection)
├── logs/                   the JSONL metrics (gitignored)
└── Dockerfile
```

Dependencies: `@livekit/agents` and the Soniox, ElevenLabs and Silero plugins, all `1.9.2`
(pinned exactly, move together, Dependabot groups them); `@livekit/rtc-node` 1.1.0;
`onnxruntime-node` 1.24.3 (Silero, and the bench's offline speech span); `@anthropic-ai/sdk`;
`zod`; `@va/core`, `@va/db`, `@va/tools-demo` (the registered pack). The root `package.json`
overrides `sharp` to 0.35.5 and `adm-zip` to 0.6.1 for the production audit (`OPS-2`).

## The engine as the LLM: the two designs, and which was built

The plan (§3) offered two designs, to be chosen by what the installed `@livekit/agents` supports:

- **A. `llmNode` override.** Subclass `voice.Agent` and return the engine's text as a stream.
- **B. Local OpenAI-compatible shim.** Landmark's proven path: the engine behind a loopback HTTP
  listener in Landmark's `OpenAiChunkSink` wire format, read by `openai.LLM`.

**A was built** (`docs/decisions/0010`). The installed 1.9.2 types `Agent.llmNode` as returning
`ReadableStream<ChatChunk | string | FlushSentinel>`, and its activity (`performLLMInference`)
consumes a plain string chunk as spoken text, calls `cancel()` on the stream when the caller
interrupts, and ends the current text-to-speech segment on a `FlushSentinel`. So:

- `AssistantAgent.llmNode(chatCtx)` turns the call's context into messages
  (`toAnthropicMessages`: system items dropped, user and assistant text only, consecutive roles
  merged, last 20, first and last must be the user's) and returns `engineStream(run)`.
- `engineStream` hands the sink's `say` to the stream: text is enqueued as it is spoken, a
  paragraph break (`\n\n`, which the sink emits after the filler) becomes a `FlushSentinel`, `end`
  closes the stream, and the stream's `cancel()` aborts the turn's signal.
- `runVoiceTurn` runs `runOrchestrationLoop` with a `SpokenTextSink`, a `DeferredStore` and a
  25 s timeout; a cancel or timeout aborts the loop, which persists synthetic results for tools
  that did not finish (invariant 3); a timeout is then spoken (`request_timeout`).
- After the loop, `persistTurn` writes the user row (chained off the session's newest row) and
  the loop's rows in one insert with explicit, increasing `created_at`, fire-and-forget;
  `CallSession.settle()` waits for it at the call's end.

**No `ParagraphAgent`.** Landmark overrode `ttsNode` to synthesise each `\n\n`-terminated
paragraph as its own stream, so the filler was heard at once instead of being held until the
answer arrived (6.8–7.4 s → 2.5–3.8 s to first sound). The installed version does the same thing
on a `FlushSentinel` in the `llmNode` output, so the flush replaces the override.

**The stub `EngineLLM`.** The activity returns without replying when the pipeline has no `LLM`
instance, so the agent carries one; its `chat()` throws and is never called because `llmNode`
never delegates to it. It reports the model id for LiveKit's spans.

The sink logic (held first sentence, one filler per turn, `speakable()`) lives in `@va/core`
(`docs/CORE.md` → SpokenTextSink), not here.

## Call lifecycle

1. The API's `POST /voice/sessions` creates the session and the `voice_calls` row (the JWT by
   the token's SHA-256, bound to the room, capped at 15 min) and dispatches the agent with
   `{ callToken, sessionId }` in the job metadata (`docs/API.md` → Voice call lifecycle).
2. `requestFunc` (`acceptDispatchedJob`) accepts only a job whose metadata carries a call token;
   anything else is rejected and logged (`job refused`). `entry` checks again and throws.
3. `CallIdentity.resolve(service, token, room)` reads `voice_calls` by hash, room, `expires_at >
now()` and `last_seen_at` within 3 minutes; null is a refused job. The token is never logged.
4. The warm-up starts without being awaited: `identity.ctx()` then `warm()` (a `max_tokens: 0`
   request with the exact model, system, tools, thinking and effort of a real turn) while the
   greeting plays, logged to `warm.jsonl`.
5. The `AgentSession` starts with the providers and the turn-handling settings below
   (`turnDetection: 'stt'`, `interruption.mode: 'vad'`, **preemptive generation off**: LiveKit
   would otherwise run the engine on partial transcripts, count those against the call and
   persist them; `record: false`: the project's observability setting never uploads audio,
   transcripts or traces); the agent connects and says `GREETING_HR`.
6. Every user turn: `CallSession.turn` applies the per-call cap (50; the 51st hears
   `rate_limited`), reads the identity (cached up to `IDENTITY_CACHE_MS`, then the row and
   `authenticateToken` again, which picks up a rotated JWT and a changed role; a gone row is
   `call_ended`), bumps `last_seen_at` off the critical path, runs the turn and logs one
   `timing` line. The call's saves run one after another, so each turn chains off the previous
   one's rows even when a turn was cut short.
7. While the participant is connected the worker bumps `last_seen_at` every minute, so a quiet
   caller stays inside the row's three-minute idle window.
8. On participant disconnect, room close and job shutdown the worker waits for the deferred
   writes and deletes the `voice_calls` row (`identity.end()`, idempotent; a failed delete is
   retried by the next path). The API's `/end` and the sweep are the other two paths;
   Landmark's four rules (`docs/API.md`) all hold.

## Settings (`env.ts`)

Required: `AGENT_NAME`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SONIOX_API_KEY`,
`ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. Optional: `ANTHROPIC_BASE_URL` (tests, fakes), `AI_VOICE_MODEL`,
`AI_VOICE_EFFORT` (`docs/CORE.md` → Channels), `VOICE_LOGS_DIR`. The tuning values are
Landmark's measured defaults; change one only with a measurement (`/bench-voice`).

| Variable                 | Default                | Meaning, and what Landmark measured                                                                                                              |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VOICE_ID`               | `pTD8166KADi6ZFJ5FEXi` | ElevenLabs voice (Karlo, chosen 2026-10-26)                                                                                                      |
| `ENDPOINT_LATENCY_LEVEL` | 3                      | Soniox v5 endpoint latency adjustment, 0–3. At 3, latency dropped from about 1.55 to 1.27 s                                                      |
| `ENDPOINT_DELAY_MS`      | 500                    | Soniox maximum end-of-turn delay (500–3000). Lowering it from 1000 made no difference                                                            |
| `TURN_MIN_DELAY_MS`      | 100                    | LiveKit's wait after Soniox's end-of-turn token. LiveKit's own 500 ms is added on top of Soniox's, so it is pure waiting                         |
| `INTERRUPT_ON`           | `vad`                  | `vad`: Silero stops the agent (20/20 within 0.5 s, median 0.25 s). `stt`: no Silero, Soniox's first interim words (20/20, median 0.30 s). `both` |
| `INTERRUPT_MIN_MS`       | 50                     | Speech needed before the agent stops talking (LiveKit's own is 500)                                                                              |
| `OUTPUT_QUEUE_MS`        | 50                     | Agent audio queued ahead of playout, cleared on an interruption (LiveKit's own is 200)                                                           |
| `VAD_THRESHOLD`          | 0.3                    | Silero activation threshold (its own is 0.5). Also fires on breath: 2 of 40 tries stopped the agent 0.22 s before the first word                 |
| `VAD_MIN_SPEECH_MS`      | 30                     | Silero minimum speech (its own is 50)                                                                                                            |
| `IDENTITY_CACHE_MS`      | 60000                  | Per-call identity re-read interval; the schema caps it at a minute (invariant 7)                                                                 |

Fixed in code, not settings: `turnDetection: 'stt'` (LiveKit's turn detector has no Croatian),
`interruption.mode: 'vad'` (never LiveKit's hosted "adaptive" model), the Soniox EU host and
`stt-rt-v5`, `languageHints: ['hr']` strict, `eleven_v4_turbo` with `language: 'hr'`, and the
voice channel's engine settings (`docs/CORE.md` → Channels: Sonnet 5.5, `low`, `between_tools`,
1024 tokens, 4 iterations, 6 s per tool, 25 s per request, last 20 messages).

## Latency budget and measurements

Targets: first sound ≤ 1.5 s after the end of speech; a single-lookup answer ≤ 4 s. Any change
on the hot path (STT end → first TTS byte: STT settings, the sink, `speakable()`, the prompt,
the model profile, tool timeouts) is measured before and after and recorded here.

**Landmark's reference figures** (2026-10-26/27, LiveKit Cloud, Sonnet 5.5 at `low`, its own
tools and prompt): first sound 2.5–3 s from the end of speech, most of it the filler; inside the
LLM function, warm: identity 0.2–0.3 s, the model's first event 1.0–1.35 s per call, tools
0.06–0.2 s, each further round 0.8–1.0 s; whole answer p50 4.5 s, p95 12 s at 1.9 rounds. The
in-process worker removes the function's cold start (~1.5 s) and the HTTP hop.

### Measurements

| Date       | Commit    | What changed            | Model                      | First text p50 / p95 | Whole answer p50 / p95 | Rounds | n   |
| ---------- | --------- | ----------------------- | -------------------------- | -------------------- | ---------------------- | ------ | --- |
| 2026-10-29 | `6490fc2` | Part 5 baseline (bench) | `claude-sonnet-5-5`, `low` | 1.77 s / 4.95 s      | 5.94 s / 9.37 s        | 2.69   | 36  |

The baseline bench ran against the local stack, where the demo tables do not exist (`CORE-2`):
every catalogue question got a tool error, the model retried with a shorter stem and then
answered that it cannot reach the catalogue, so each one took 3 rounds. The whole-answer figure
is therefore an upper bound for the skeleton; the first-text figure (the filler after the first
tool call) is representative. Small talk: first text 1.5 s, whole answer 1.6 s, one round. Prompt
cache hit on 36/36 first calls.

### The live checklist (2026-10-29, LiveKit Cloud Frankfurt, local Supabase, Sonnet 5.5 at `low`)

Run with the operator's keys through `call-test.ts` (the API and the worker on a dev machine,
Landmark's recorded takes plus four takes synthesised with ElevenLabs for the catalogue and
barge-in cases). Everything in plan §10 was exercised except the full 20-try barge-in count:

| Check                                                      | Result                                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker starts, registers under `va-voice`, takes the job   | Yes. The first call timed out LiveKit's 10 s runner initialisation (tsx import ~6 s, `VOICE-4`); fixed with a 60 s timeout and one idle process |
| Greeting heard                                             | Yes, ~1 s of TTS after connect; the warm-up ran meanwhile (2.75 s, cache read 2434 tokens)                                                      |
| Question transcribed, answered through the engine          | Yes: Soniox heard the take correctly; the engine answered in Croatian; the catalogue questions spoke the filler first, then the answer          |
| Rows persisted, chained                                    | Yes: `user` → `assistant` per turn, `parent_id` chained, one insert per turn                                                                    |
| Credential deleted on hang-up                              | Yes: `voice_calls` empty after every call (participant disconnect path)                                                                         |
| First audio after end of speech, direct answer (4 takes)   | 2.36, 2.91, 3.08, 3.33 s (LiveKit's own `e2e_ms` 2.5–3.4 s; `llm_ttft_ms` 2.3–3.1 s; `tts_ttfb_ms` 130–150 ms)                                  |
| First audio, catalogue question (filler after a tool call) | 3.49 s and 5.40 s (the second was a 3-round turn on a failing tool)                                                                             |
| Barge-in, `INTERRUPT_ON=vad`                               | 7 of 7 interruptions that caught the agent speaking stopped it in 307–339 ms (target ≤ 0.5 s)                                                   |
| Barge-in, `INTERRUPT_ON=stt`                               | 5 of 5 stopped in 840–921 ms: over the target. `vad` stays the default                                                                          |

Barge-in tries that missed the agent (it had finished its answer before the script's 2 s
interrupt point) do not count; getting 20 clean tries needs a take that reliably provokes a
long answer, or a shorter interrupt delay in `call-test.ts`. `transcription_delay_ms` and
`end_of_turn_delay_ms` came back null from LiveKit with the Soniox plugin. Against the targets:
the first sound is ~1 s over 1.5 s on direct answers and the answer itself is under 4 s; the
tuning backlog below applies.

Landmark's ordered next steps if the targets are missed, kept as the tuning backlog: the
caller's list of the most likely entities in the per-user block to save a tool round; stop the
model thinking aloud between tool calls; an earlier filler on ~0.5 s of silence; the identity
read in parallel with the model call.

## Running locally

The keys and the LiveKit project are the operator's; they live outside the repo, e.g.
`~/.config/va/voice.env`, never in `apps/voice/`. `apps/voice/.env.example` lists every
variable.

```
set -a; source ~/.config/va/voice.env; set +a           # LIVEKIT_*, SONIOX_API_KEY, ELEVENLABS_API_KEY, ANTHROPIC_API_KEY, SUPABASE_*
supabase start                                           # or point SUPABASE_* at the dev project
pnpm --filter @va/api dev                                # the API dispatches to VOICE_AGENT_NAME (default va-voice)
AGENT_NAME=va-voice pnpm --filter @va/voice dev          # tsx src/agent.ts dev: the worker on LiveKit Cloud
```

Then the call button in the PWA (Part 6), or the scripted caller below. `pnpm --filter @va/voice
start` runs the worker in production mode (`node --import tsx src/agent.ts start`); the
container (`apps/voice/Dockerfile`) does the same, with no port (the worker is an outbound
WebSocket client of LiveKit). The worker's `prewarm` loads Silero once per process.

Logs are one JSON line per event with `tag: '[voice]'`: `job refused`, `call accepted`, `warm`,
`timing` per turn (`auth_ms`, `first_text_ms`, `total_ms`, the engine's marks, `spoken_len`,
token and cache counts, `outcome`), `turn limit reached`, `identity refused`, `call ending`.
Never the transcript, the audio or the call token. LiveKit's own logger (pino, JSON) writes the
caller's words and the agent's answer under `lk.pii.*` keys at `info` and `warn`; the worker
forces JSON output in the job process and strips every `lk.pii.*` key from what reaches stdout
(`redact.ts`, `W18`), adding `redacted: <count>` to the line. `LOG_LEVEL` (`info` for `start`,
`debug` for `dev`) sets LiveKit's level. The JSONL metrics in `apps/voice/logs/`:

- `turns.jsonl`: per reply, LiveKit's own `e2e_ms`, `transcription_delay_ms`,
  `end_of_turn_delay_ms`, `llm_ttft_ms`, `tts_ttfb_ms`, `interrupted`, `text_len`, with the
  tuning values in force.
- `bargein.jsonl`: per interruption, when the user started, when Soniox's first words arrived,
  when the agent stopped, `stop_ms`.
- `warm.jsonl`: per call, the warm-up's `ms`, `cache_write`, `cache_read`.
- `llm-bench.jsonl`, `calltest.jsonl`: the scripts below.

The writer refuses an entry with a `text`, `transcript`, `heard` or `said` key (`W13`).

### Scripts

**`llm-bench.ts`** times the engine in-process, no speech in the way, as a real user of the
configured Supabase project: `bench/questions.hr.txt` (ten product-neutral questions the demo
pack answers, plus two small-talk lines) × N repeats, each on a fresh single-turn conversation,
through the same `runVoiceTurn` as the worker. It opens a voice session of its own and deletes
it at the end. Needs `SUPABASE_*`, `ANTHROPIC_API_KEY`, `VA_BENCH_EMAIL`, `VA_BENCH_PASSWORD`;
`AI_VOICE_MODEL` / `AI_VOICE_EFFORT` to compare models; `LABEL` tags the rows.

```
pnpm --filter @va/voice bench 3            # p50/p95 first text and whole answer, rounds, cache hits
pnpm --filter @va/voice bench first warm   # one call's first question after the warm-up (cold-start runs)
SHOW_ANSWERS=1 pnpm --filter @va/voice bench 1   # prints the answers to the console (never to the log)
```

**`call-test.ts`** is the scripted caller: it signs in as a test user, starts a call through
`POST /voice/sessions` (as the call button does), joins the room, plays recorded 16 kHz mono
WAVs as its microphone and timestamps the agent's audio. Speech start and end come from
`speech-span.ts` (Silero offline), not from loudness. Needs `VA_API_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `VA_EMAIL`, `VA_PASSWORD`; the WAVs stay outside the repo.

```
pnpm --filter @va/voice call-test latency ~/takes/q01.wav ~/takes/q02.wav   # end of speech → first audio
pnpm --filter @va/voice call-test ask ~/takes/q01.wav                       # prints what was heard and said (console only)
LABEL=vad pnpm --filter @va/voice call-test bargein ~/takes/q01.wav        # interrupts the answer 2 s in; stop_ms
```

Barge-in acceptance: 20 tries each with `INTERRUPT_ON=vad` and `stt`, the agent stops within
0.5 s in at least 18 of 20.

## Hosting (open decision)

The worker needs a home. Two options, both EU:

- **LiveKit Cloud agent hosting (EU).** The container above deployed to LiveKit's own agent
  infrastructure: no servers to run, scaling by LiveKit, the vendor keys as LiveKit secrets. The
  worker's Supabase and Anthropic traffic leaves LiveKit's region to ours. Keep the project's
  Agent Observability off: the worker passes `record: false`, but stdout goes to LiveKit's logs.
- **Own container** (the Supabase project's region, e.g. a small VM or a container service):
  one more thing to operate, but the data path, logs and the keys stay with us, and the bench
  can run next to it.

Recorded as `VOICE-1`; decide before the first user trial. Either way `AGENT_NAME` keeps the
worker to dispatched jobs, and nothing in the worker depends on where it runs.

## Testing

`apps/voice/test/harness.ts` runs the worker's pieces against the `@va/core` fakes: no LiveKit
connection, no audio. A real `ChatContext` from `@livekit/agents` stands in for the call's
context, `AssistantAgent.llmNode` is called as the activity would call it, and `collect()`
reads the stream (a flush shows as `⏎`). `openCall()` seeds a voice session and its
`voice_calls` row as the API leaves them, resolves the identity with a fake clock, and builds the
`CallSession` and the agent; every opened call is settled at the end of the scenario so one
scenario's deferred rows never land in the next one's world.

| Id         | Scenario                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01        | a job without `callToken` is refused and logged; `callTokenOf`                                                                                                                            |
| W02        | an unknown, foreign-room, expired or idle token resolves to null; a failed lookup throws                                                                                                  |
| W03        | identity cached for 60 s, re-read after (second `getUser` only once the clock moves); role change                                                                                         |
| W03b, W03c | a rotated JWT, a deleted row (`call_ended`), `end()` idempotent; `touch()` with the user filter                                                                                           |
| W04        | `toAnthropicMessages`: system items and the greeting dropped, roles merged, cap 20, trailing user                                                                                         |
| W05        | filler then answer in order, a flush after the filler; the tool ran with the caller's JWT                                                                                                 |
| W06        | a tool outside the voice allowlist is refused at dispatch even when the model names it                                                                                                    |
| W07        | rows written after the answer, chained, newest row first for the next turn, one insert                                                                                                    |
| W08        | stream cancel (barge-in) aborts the loop; the synthetic `tool_result` row is persisted                                                                                                    |
| W09        | `warm` sends the same model/system/tools/thinking/output_config as a real turn, `max_tokens: 0`                                                                                           |
| W10        | the voice model profile (Sonnet 5.5, `between_tools`, low, fallbacks + beta) on every request                                                                                             |
| W11, W12   | a model error is spoken and the stream ends; a refusal with nothing spoken says the decline                                                                                               |
| W13        | metrics lines carry latencies and lengths, no `text`; the writer refuses content keys                                                                                                     |
| W14        | the cap is 50 turns per call; past it the caller hears `rate_limited` and no model is called (pinned with a cap of 1); an expired JWT is `unauthorized`, a failed lookup `internal_error` |
| W15        | the hints file parses: comments stripped, duplicates dropped                                                                                                                              |
| W16        | the request timeout aborts the loop and is spoken; only the user row is written                                                                                                           |
| W17        | a failed save is logged without the text; the next turn still saves; no log line carries the words                                                                                        |
| W18        | a pino line loses every `lk.pii.*` key; the stdout wrapper rewrites what LiveKit would write                                                                                              |
| W19        | the session's turn handling: Soniox end of turn, VAD interruption, no preemptive generation, no recording                                                                                 |

```
pnpm exec vitest run apps/voice
VA_TEST_LOGS=1 pnpm exec vitest run apps/voice/test/turn.test.ts
```
