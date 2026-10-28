# 0009 — The manual Messages loop, not the SDK's Tool Runner

## Context

The Anthropic SDK ships a beta Tool Runner (`client.beta.messages.toolRunner`) that drives the request → execute → loop cycle for tools defined with `betaZodTool`. The engine needs, per iteration, to persist the assistant row before emitting its blocks, dispatch the turn's tools concurrently with their own timeouts and abort signals, persist one `tool_result` row before emitting any result event, and treat abort as a first-class exit that writes synthetic results (invariants 1 to 3, decision 0007). It also serves two sinks with different needs (token deltas for chat, held sentences and fillers for voice).

## Decision

`runOrchestrationLoop` is a hand-written loop over `messages.stream` (or `beta.messages.stream` when a profile carries beta headers), ported from Landmark's orchestrator. The Tool Runner is not used: its per-turn hooks sit around the SDK's own loop, which owns the message array, the dispatch order and the retry policy, so the persistence order, the abort contract and the sink seam would be reimplemented inside hooks that were not designed for them. zod is still the schema source (`defineTool` → `toAnthropicTool`, strict), re-validated at dispatch because the SDK's tolerant parser can hand back a truncated input.

## Consequences

The loop code is ours to test: the E-scenarios pin every exit path against the fake API. Nothing in the engine depends on a beta SDK surface except the beta headers a model profile asks for. When the SDK's runner grows hooks that can express persist-then-emit and abort-with-synthetic-results, revisit; until then, new loop behaviour is added in `packages/core/src/loop/` with a scenario.

## Date

2026-10-28
