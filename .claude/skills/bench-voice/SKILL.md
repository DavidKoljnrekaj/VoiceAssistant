---
name: bench-voice
description: Measure voice latency before and after a change on the hot path — how to run the LLM bench and the call test, which env files they need, and what to record in docs/VOICE.md.
---

# Voice bench

Any change on the hot path (speech end → first TTS byte: STT settings, the sink, `speakable()`,
the prompt, the model profile, tool timeouts) is **measured before and after**. Record both in
`docs/VOICE.md` → Measurements with the commit hash, date and the setting that changed.

Scripts (Part 5, under `apps/voice/scripts/`):

!`ls apps/voice/scripts 2>/dev/null || echo "(scripts arrive in Part 5)"`

- `llm-bench.ts` — runs the engine in-process with the voice profile over a fixed set of
  utterances against the real model and reports per-utterance first-token, first-sentence and
  whole-answer times (p50 / p95) and tool rounds. Run with
  `pnpm --filter @va/voice exec node --env-file ~/.config/va/voice-bench.env scripts/llm-bench.ts`.
- `call-test.ts` — joins a LiveKit room as a synthetic caller, plays recorded utterances and
  measures end-of-speech → first audio frame. Run with
  `pnpm --filter @va/voice exec node --env-file ~/.config/va/voice-call.env scripts/call-test.ts`.

Env files live **outside the repo** in `~/.config/va/` (never in `apps/voice/`), and hold the
Anthropic key, LiveKit URL and keys, Soniox and ElevenLabs keys. The bench never logs transcripts;
it prints timings and lengths only.

## Record

In `docs/VOICE.md` → Measurements, one row per run: date, commit, what changed, model, first
sound p50 / p95, whole answer p50 / p95, tool rounds, n utterances. The budget is first sound
≤ 1.5 s and whole single-lookup answer ≤ 4 s. A change that moves p50 the wrong way is not done.
