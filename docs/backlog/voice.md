# Backlog — voice

Ids: VOICE-6 (next free)

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

### VOICE-5 · Low · OQ: the call's context carries no tool rounds, so the model cannot see that it looked something up

- **Check:** Confirmed (live call 2026-10-29: after a failed lookup the model's next answer said its
  previous error message "was given without a real attempt")
- **Where:** `apps/voice/src/messages.ts` (by design: user and assistant text only, as Landmark)
- **What happens:** on the second question of a call the model reasons about its own earlier
  answer without the tool results behind it, and may contradict or second-guess it aloud
- **Fix direction:** either a prompt line ("your earlier answers in this call were based on real
  lookups") or carry a short `[lookup: search_items → error]` marker in the assistant text of the
  call context; measure what it costs in tokens before choosing

## Resolved

Nothing yet.
