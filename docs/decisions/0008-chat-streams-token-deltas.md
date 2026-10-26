# 0008 — Chat streams token deltas (provisional) plus canonical blocks

## Context

Landmark streams whole content blocks only; its frontend predates streaming and its loop already has the delta seam unused. A typed chat feels slow when the first visible text waits for a whole block.

## Decision

The chat sink emits token deltas as provisional text and, after the row is persisted, the `turn` event with the canonical text (persist-before-emit holds for everything except deltas). A `persistence_error` event tells the client to drop provisional text. Alternative: whole blocks only (simpler client, visibly slower).

## Consequences

The SSE contract has `delta` and `turn` events from day one (`docs/API.md`, Part 4); the web client renders provisional text and replaces it on `turn`. Voice is unaffected: its sink works in sentences. Deltas are the one documented exception to invariant 1.

## Date

2026-10-26
