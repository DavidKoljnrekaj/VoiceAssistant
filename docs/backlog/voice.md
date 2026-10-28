# Backlog — voice

Ids: VOICE-4 (next free)

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

- **Check:** Confirmed (every file is marked)
- **Where:** `GREETING_HR` in `apps/voice/src/greeting.ts`, `apps/voice/bench/questions.hr.txt`,
  `apps/voice/hints/hr.txt`; the filler and the refusal line are `CORE-1`
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

## Resolved

Nothing yet.
