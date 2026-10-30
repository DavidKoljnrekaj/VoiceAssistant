# 0011 — The voice history is the call's own rows, not LiveKit's chat context

## Context

LiveKit keeps a chat context per call: the user's transcripts and the agent's spoken text. The
plan (and Landmark's `voice-llm`) fed the model that context as history: text only, no tool
calls, no tool results. On the local stack with the demo catalogue (2026-10-29) the model
answered the first question correctly from a lookup and, on the second, retracted it ("the
previous answer was not from the catalogue, ignore it") because its earlier message carried
numbers with no `tool_use` behind them. A prompt line saying earlier answers came from real
lookups did not change that; stripping the filler sentence from the context did not either.

## Decision

`CallSession` keeps the call's own rows in worker memory as the loop writes them (the user row,
the assistant rows with their `tool_use` blocks, the `tool_result` rows), and `callHistory`
turns at most the last 20 rows, cut on a turn boundary, into the model's messages through the engine's
`assembleHistory` (unanswered `tool_use` repaired, empty rows dropped, oldest turns dropped above
a ceiling). LiveKit's context supplies only the new user turn (`userTurnOf`). The alternatives
lost: the prompt line and the filler stripping were tried live and did not work; reading the
history back from the database would put a read on the hot path for what the worker already
holds.

## Consequences

The model sees what it did, so it does not disown it; the voice history costs a few hundred
more tokens per turn than text only (tool results on voice are at most five items). The rows
are the same ones persisted after the answer, so the worker's memory and the database agree.
LiveKit's own context still exists (it is what the room's transcription shows) but nothing reads
it for history. If a call outlives the 20-row window, the oldest turns fall away in whole
turns, as in chat. After a barge-in the two disagree on purpose: LiveKit cuts its item to what
was played, the worker's row keeps the whole answer the model wrote, so the model's history says
the caller heard everything and a later answer may refer to something the caller never heard
(`VOICE-10`). Cutting the persisted row to the played length needs the playback position from
LiveKit's speech handle, which the `llmNode` adapter does not see; until then the row is the
model's output, not the caller's experience.

## Date

2026-10-29
