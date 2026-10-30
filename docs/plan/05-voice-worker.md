# Part 5 — `apps/voice`: the LiveKit agent worker

## Prompt for the session

```
Read docs/plan/00-brief.md and docs/plan/05-voice-worker.md, then implement Part 5 on a branch
feat/voice-worker from main. Restate the deliverables and the acceptance checklist first and ask me only
about what the plan leaves open (vendor keys and the LiveKit project are mine; I will put them in
~/.config/<product>/voice.env, which you never read). Before writing the LLM adapter, read the installed
@livekit/agents type definitions for voice.Agent (llmNode, ttsNode) and llm.LLM and confirm which of the
two designs in §3 the installed version supports; say which you chose and why. Unit tests run against
the @va/core fakes with no LiveKit connection. When done, run /done, write docs/VOICE.md, and report,
including the latency figures from the bench if keys were available and a clear statement if not.
```

Can be split: **5a** worker, providers, call lifecycle, LLM adapter with tests; **5b** scripts (`llm-bench`, `call-test`), live tuning, measurements.

> **As built (2026-10-28/29, `docs/VOICE.md` is current):** design A (`llmNode`) was chosen
> (decision 0010); `paragraph-agent.ts` was not written (a `FlushSentinel` in the `llmNode` stream
> ends the TTS segment instead); and `toAnthropicMessages(chatCtx)` became `userTurnOf` plus
> `callHistory` over the call's own rows (decision 0011), with no same-role merging. The
> deliverables, §3's message assembly and the W04 line below read as the plan, not the code.

## Goal

A worker that takes a dispatched call, resolves the caller's identity from the opaque token, listens
with Soniox, answers through the shared engine in-process with the spoken-text sink, speaks with
ElevenLabs, handles barge-in, and leaves the call's turns persisted. Landmark's prototype worker and its
`voice-llm` function are merged into one process.

## Deliverables

```
apps/voice/src/
├── agent.ts              defineAgent({ prewarm, entry }); cli.runApp with AGENT_NAME
├── env.ts                zod env (see §7)
├── call.ts               CallIdentity: resolve token → voice_calls → authenticateToken; 60 s cache; last_seen bump; end()
├── assistant-llm.ts      the engine as the session's LLM (§3)
├── messages.ts           chatCtx → InMemoryMessage[] (port of voice-llm/messages.ts)
├── paragraph-agent.ts    ParagraphAgent (ttsNode override, port)
├── providers/
│   ├── stt.ts            soniox.STT from env (EU host, stt-rt-v5, hr, hints, endpoint settings)
│   ├── tts.ts            elevenlabs.TTS from env (eleven_v4_turbo, voice id, hr)
│   ├── vad.ts            silero.VAD load with thresholds
│   └── hints.ts          vocabulary hints: a committed list in apps/voice/hints/hr.txt (+ optional runtime additions from a tool pack later)
├── warm.ts               warm(ctx): max_tokens 0 request with the real system/tools (port)
├── metrics.ts            turns.jsonl / bargein.jsonl / warm.jsonl writers — timings only, no text
└── greeting.ts           GREETING_HR
apps/voice/scripts/
├── llm-bench.ts          port: times the engine in-process on a scripted question set
└── call-test.ts          port: scripted caller (latency / bargein / ask) through POST /voice/sessions
apps/voice/test/          harness + W scenarios
apps/voice/Dockerfile
docs/VOICE.md
```

## Specification

### 1. Worker entry (`agent.ts`)

Port Landmark's `agent.ts` structure: `prewarm` loads Silero; `entry` reads `callToken` from
`ctx.job.metadata`, **refuses the job if absent** (no stub path in the committed worker; the stub LLM
lives only in `scripts/` for tuning runs), starts `warm()` without awaiting, builds the `AgentSession`
with the providers, `turnHandling: { turnDetection: 'stt', endpointing: { minDelay }, interruption: { enabled: true, mode: 'vad', minDuration } }`,
`outputOptions: { queueSizeMs }`, starts the `ParagraphAgent`, connects, says the greeting, and logs
metrics. `cli.runApp(new ServerOptions({ agent, agentName: env.AGENT_NAME }))` so the worker takes only
dispatched jobs.

### 2. Call identity (`call.ts`)

```ts
export class CallIdentity {
  static async resolve(service, callToken, room): Promise<CallIdentity | null>   // voice_calls by sha256(token) + room + live (expires_at, last_seen_at within 3 min)
  ctx(): Promise<AuthContext>          // authenticateToken(access_token); cached 60 s, then re-resolved (picks up refresh and role changes)
  touch(): void                        // fire-and-forget last_seen_at bump
  sessionId: string; userId: string
  end(): Promise<void>                 // delete the voice_calls row (idempotent)
}
```

On participant disconnect or room close the worker calls `end()`; the API's `/end` and the sweep are
the other two paths (Landmark's lifecycle rules 1–4 all hold).

### 3. The engine as the LLM (`assistant-llm.ts`)

Two designs; pick by what the installed `@livekit/agents` supports, in this order:

**A. `llmNode` override (preferred).** Subclass `voice.Agent` (the same class that overrides `ttsNode`)
and override `llmNode(chatCtx, toolCtx, modelSettings)` to return a `ReadableStream<string>` (or of
`llm.ChatChunk` if plain strings are not accepted). Per call: `messages = toAnthropicMessages(chatCtx)`
(drop system items, keep user/assistant text, merge consecutive same-role, last 20, first must be user,
last must be user); `ctx = await identity.ctx()`; `config = { channel: 'voice', settings, system, tools: registry.anthropicTools(ctx, 'voice'), registry }`;
`store = new DeferredStore()`; `sink = new SpokenTextSink(say, end)` where `say` enqueues into the
stream's controller and `end` closes it; run `runOrchestrationLoop` with hooks
`{ isCancelled: () => controller.signal.aborted, onComplete: noop, mark, usage }` and a 25 s timeout;
the stream's `cancel()` (LiveKit cancels it on barge-in) aborts the controller; after the loop,
`persistTurn(service, sessionId, userRowId, userText, store.rows)` fire-and-forget (port of
`voice-llm/persistTurn`: chain off the session's newest row, explicit increasing `created_at`, one insert).

**B. Local OpenAI-compatible shim (fallback).** If `llmNode` cannot stream our text, run the same code
behind an in-process HTTP listener on `127.0.0.1` with Landmark's `OpenAiChunkSink` wire format and use
`openai.LLM` with `maxRetries: 0`. This is Landmark's proven path; the only cost is a loopback hop.

Either way the sink logic (held first sentence, one filler, speakable) lives in `@va/core`, not here.

### 4. Paragraph TTS (`paragraph-agent.ts`)

Port `ParagraphAgent.ttsNode` verbatim: each `\n\n`-terminated paragraph is synthesised as its own TTS
stream so the filler is audible at once instead of being held until the answer arrives (Landmark measured
6.8–7.4 s → 2.5–3.8 s to first sound from this alone).

### 5. Warm-up (`warm.ts`)

Port `voice-llm`'s `/warm`: once per call, right after dispatch, a `max_tokens: 0` request with the exact
`model`, `system`, `tools`, thinking and effort of a real turn, so the first question pays neither a cold
process nor a cache miss. Log `cache_write` / `cache_read` and ms to `warm.jsonl`.

### 6. Metrics (`metrics.ts`)

Port the three JSONL logs, **minus any transcript text**: keep `e2e_ms`, `transcription_delay_ms`,
`end_of_turn_delay_ms`, `llm_ttft_ms`, `tts_ttfb_ms`, `interrupted`, `text_len`, the engine's marks and
token/cache counts, and the barge-in timings. Logs go to `apps/voice/logs/` (gitignored).

### 7. Settings (`env.ts`) — Landmark's measured defaults

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_NAME` | required | dispatch-only name the API uses (`VOICE_AGENT_NAME` there) |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | required | LiveKit Cloud EU project |
| `SONIOX_API_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_*` | required | |
| `VOICE_ID` | `pTD8166KADi6ZFJ5FEXi` (Karlo) | ElevenLabs voice |
| `ENDPOINT_LATENCY_LEVEL` | 3 | Soniox endpoint latency adjustment 0–3 |
| `ENDPOINT_DELAY_MS` | 500 | Soniox max endpoint delay |
| `TURN_MIN_DELAY_MS` | 100 | LiveKit wait after Soniox end of turn |
| `INTERRUPT_ON` | `vad` | `vad` / `stt` / `both` |
| `INTERRUPT_MIN_MS` | 50 | speech needed before the agent stops |
| `OUTPUT_QUEUE_MS` | 50 | audio queued ahead of playout |
| `VAD_THRESHOLD`, `VAD_MIN_SPEECH_MS` | 0.3, 30 | Silero sensitivity |
| `IDENTITY_CACHE_MS` | 60000 | per-call identity re-read interval |
| `AI_VOICE_MODEL`, `AI_VOICE_EFFORT` | from core defaults | |

All documented in `docs/VOICE.md` with what Landmark measured for each.

### 8. Scripts

- `llm-bench.ts`: port, but **in-process**: it builds an `AuthContext` for a test user (service role +
  the user's JWT from a sign-in), runs the engine with `SpokenTextSink` on a question set from
  `apps/voice/bench/questions.hr.txt` (write ten product-neutral Croatian questions; the demo pack's
  items make them answerable), N repeats, and prints p50/p95 first-text and whole-answer times, rounds
  and cache hits to `logs/llm-bench.jsonl`. `first [warm]` mode kept.
- `call-test.ts`: port of the scripted caller (`latency`, `bargein`, `ask` over WAVs) through
  `POST /voice/sessions`; needs `COGNILION_*`-style env renamed to the product; `speech-span.ts` ported.
  Recorded WAVs stay outside the repo.

### 9. Tests (`apps/voice/test/`)

Harness: the `@va/core` fakes plus a fake `chatCtx` builder and a `collectStream()` reader; no LiveKit.

W01 a job without `callToken` is refused and logged; W02 an unknown, foreign-room, expired or idle token
resolves to null; W03 identity is cached for 60 s and re-read after (second `getUser` call only after the
clock moves); W04 `toAnthropicMessages` drops system items and the greeting, merges roles, caps at 20, needs a
trailing user turn (port of `messages.test.ts`); W05 a turn streams filler + answer through the sink in order,
and the tools ran with the caller's JWT; W06 a tool outside the voice allowlist is refused at dispatch even if
the model names it; W07 `turn_kind`/`parent_id` chaining of the persisted rows after the answer, newest row
first; W08 stream cancel (barge-in) aborts the loop and the synthetic tool_result row is persisted; W09
`warm` sends the same `model/system/tools/thinking/output_config` as a real turn with `max_tokens: 0`; W10
the voice model profile (Sonnet 5.5, `between_tools`, low, fallbacks + beta) is on every request; W11 a model
error is spoken and the stream ends; W12 a refusal with nothing spoken says the one-sentence decline; W13
metrics lines contain no `text` field.

### 10. Live checklist (5b)

With the keys in `~/.config/<product>/voice.env` (sourced with `set -a`), the API running against the
local or dev Supabase, and the worker started with `AGENT_NAME`:

1. `node scripts/llm-bench.ts 3` → record first-text p50/p95 and whole-answer p50/p95 in `docs/VOICE.md`.
2. `node scripts/call-test.ts ask <wav>` through the API → what was heard and said, time to first audio.
3. Barge-in: `call-test.ts bargein` with `INTERRUPT_ON=vad` and `stt`, 20 tries each → stop within 0.5 s ≥ 18/20.
4. Targets: first sound ≤ 1.5 s after end of speech, single-item answer ≤ 4 s. Record what was measured;
   do not tune blindly — Landmark's next steps (project list in the per-user block to save a round; stop
   thinking aloud between tools; earlier filler on ~0.5 s silence; identity reads in parallel) are the
   ordered backlog if targets are missed.

## Acceptance checklist

- [ ] W scenarios green; typecheck and lint green; no LiveKit connection in unit tests.
- [ ] Worker starts with the env, takes a dispatched job, greets, answers a question through the demo tools, persists the turn, deletes the call on hang-up (shown by a live run or stated as not run).
- [ ] `docs/VOICE.md`: the chain diagram, the two LLM-adapter designs and which was built, call lifecycle, settings table, measurements, how to run locally and the scripts, hosting options (LiveKit Cloud agent hosting EU vs own container) as an open decision.
- [ ] Backlog: hosting decision; per-user feature flag for the call button; native review of greeting and filler; Soniox end-of-turn outlier watch.
- [ ] `apps/voice/Dockerfile` builds.

## Do not

- Call the API over HTTP for the model turn; the engine is in-process.
- Log transcripts, audio or the call token.
- Pin `@livekit/agents` and its plugins to different versions.
- Enable LiveKit's hosted turn detector or "adaptive" interruption (no Croatian; costs).
- Put the stub LLM in the worker; it is a script-only tuning aid.

## Landmark references

- `tools/voice-prototype/src/agent.ts` (worker, ParagraphAgent, metrics), `README.md` (settings and measurements)
- `supabase/functions/voice-llm/index.ts` (authorize, warm, DeferredStore, persistTurn, timing line), `messages.ts`, `sink.ts`
- `tools/voice-prototype/src/{llm-bench,call-test,speech-span,stub-llm}.ts`
- `docs/voice/04-dev-build.md` (what was measured, what is missing), `docs/voice/02-voice-implementation-plan.md` §3.4, §4.3, §4.4
