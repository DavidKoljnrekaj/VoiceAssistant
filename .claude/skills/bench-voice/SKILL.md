---
name: bench-voice
description: Measure voice latency before and after a change on the hot path — how to run the LLM bench and the call test, which env files they need, and what to record in docs/VOICE.md.
---

# Voice bench

Any change on the hot path (speech end → first TTS byte: STT settings, the sink, `speakable()`,
the prompt, the model profile, tool timeouts) is **measured before and after**. Record both in
`docs/VOICE.md` → Measurements with the commit hash, date and the setting that changed.

Scripts under `apps/voice/scripts/` (`docs/VOICE.md` → Scripts):

!`ls apps/voice/scripts 2>/dev/null || echo "(scripts arrive in Part 5)"`

- `llm-bench.ts` — runs the engine in-process with the voice profile over
  `apps/voice/bench/questions.hr.txt` against the real model, as a real user of the configured
  Supabase project, and reports first-text and whole-answer times (p50 / p95), tool rounds and
  prompt-cache hits. Needs `SUPABASE_*`, `ANTHROPIC_API_KEY`, `VA_BENCH_EMAIL`,
  `VA_BENCH_PASSWORD`; `AI_VOICE_MODEL` / `AI_VOICE_EFFORT` to compare models.
  `pnpm --filter @va/voice bench 3`; `… bench first warm` for one cold call after the warm-up.
- `call-test.ts` — joins a LiveKit room as a scripted caller through `POST /voice/sessions`,
  plays recorded 16 kHz mono WAVs and measures end of speech → first audio frame (`latency`),
  the stop time of an interruption (`bargein`), or what was heard and said (`ask`). Needs the
  API and the worker running, `VA_API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VA_EMAIL`,
  `VA_PASSWORD`. `LABEL=vad pnpm --filter @va/voice call-test bargein ~/takes/q01.wav`.

Env files live **outside the repo** in `~/.config/va/` (never in `apps/voice/`), sourced with
`set -a; source ~/.config/va/voice.env; set +a`: the Anthropic key, LiveKit URL and keys, Soniox
and ElevenLabs keys, the Supabase values and the test user. The bench never logs transcripts; it
writes timings and lengths to `apps/voice/logs/llm-bench.jsonl` and prints answers only with
`SHOW_ANSWERS=1`. Recorded WAVs stay outside the repo.

## Record

In `docs/VOICE.md` → Measurements, one row per run: date, commit, what changed, model, first
text p50 / p95, whole answer p50 / p95, tool rounds, n utterances. The budget is first sound
≤ 1.5 s and whole single-lookup answer ≤ 4 s. A change that moves p50 the wrong way is not done.
