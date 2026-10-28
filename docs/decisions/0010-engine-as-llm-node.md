# 0010 — The engine as the agent's `llmNode`, not an OpenAI-compatible loopback shim

## Context

The voice worker runs the shared engine in-process (decision 0001). LiveKit Agents needs an LLM
in its pipeline; Landmark put the engine behind an edge function speaking the OpenAI chat
completions wire format and used `openai.LLM`. The plan for Part 5 offered that shim as a
loopback fallback (B) and an `llmNode` override (A) as the preferred design, to be chosen by
what the installed `@livekit/agents` supports. At 1.9.2 the installed types declare
`Agent.llmNode` as returning `ReadableStream<ChatChunk | string | FlushSentinel>`; its activity
consumes a string chunk as spoken text, calls `cancel()` on the stream when the caller
interrupts, and ends the current TTS segment on a `FlushSentinel`.

## Decision

`AssistantAgent extends voice.Agent` overrides `llmNode`: the call's context becomes the
engine's messages, the loop runs with the `SpokenTextSink`, the sink's `say` enqueues strings
into the returned stream, the paragraph break after the filler becomes a `FlushSentinel`, and
the stream's `cancel()` aborts the loop. No wire format, no listener, no `openai` dependency.
Landmark's `ParagraphAgent.ttsNode` override is not ported: the flush does what it did. A stub
`EngineLLM` is still attached because the activity returns without replying when the pipeline
has no `LLM` instance; its `chat()` is never called. The shim (B) lost on the loopback hop, the
serialisation of every token to JSON and back, and a second wire contract to test; it stays the
fallback if a future version stops accepting string chunks.

## Consequences

The adapter is ~100 lines and testable without LiveKit: the tests call `llmNode` with a real
`ChatContext` and read the stream as the activity does (W05–W12). The worker depends on three
facts about `@livekit/agents` (string chunks, `cancel()` on interruption, the flush ending a
segment), all pinned by the exact version and by W05/W08; a version bump re-reads
`performLLMInference` for them. Token usage is reported in the worker's own `timing` line, not
through LiveKit's `metrics_collected`.

## Date

2026-10-28
