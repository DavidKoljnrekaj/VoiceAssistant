# 0005 — Opus 5.5 for chat; Sonnet 5.5 with `between_tools` for voice

## Context

Landmark benchmarked the voice path: Sonnet 5.5 at low effort gave a whole-answer p50 of 4.5 s against 6.8 s on Sonnet 4.6, with fewer tool rounds. `thinking: { type: "between_tools" }` is the only way to keep a caller from hearing a thinking pause, and only Sonnet 5.5 accepts it. For chat, latency matters less than answer quality, and Opus 5.5 is cheaper than Sonnet 4.6 was.

## Decision

Chat: `claude-opus-5-5`, thinking omitted (adaptive), `output_config.effort` from env (default `medium`), `max_tokens` 8192. Voice: `claude-sonnet-5-5`, `thinking: { type: "between_tools" }`, effort `low`, `max_tokens` 1024. Both with `fallbacks: "default"` and the beta `server-side-fallback-2026-07-01`. Alternatives: one model for both (voice would pay for Opus latency or chat would lose quality); Haiku 5.5 for voice (unmeasured; open question 9 in the appendix).

## Consequences

Model ids and options live in one profile module in `@va/core` and nowhere else; never send `thinking: disabled`; `between_tools` only on Sonnet 5.5 at effort ≤ high; no forced `tool_choice`; no prefill. Changing a model or a prompt changes the cache key and is measured with the bench before it ships. The chat model may move to Sonnet 5.5 after a bench (open question 9).

## Date

2026-10-26
