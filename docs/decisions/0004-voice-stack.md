# 0004 — LiveKit Agents (Node) + Soniox EU + ElevenLabs, behind adapters

## Context

Landmark's phase 0 bake-off measured speech-to-text providers on Croatian domain speech: Soniox `stt-rt-v5` reached 98 % term accuracy with vocabulary hints against 37–77 % for the others. Its in-app call runs on LiveKit Cloud EU with ElevenLabs `eleven_v4_turbo` text-to-speech, and its tuning values (endpointing, filler, held first sentence) are measured.

## Decision

LiveKit Agents for Node on LiveKit Cloud EU, Soniox `stt-rt-v5` EU with vocabulary hints, ElevenLabs `eleven_v4_turbo`, each behind an adapter with a stub for tests. The agent package and all its plugins are pinned to the same exact version and move together. Alternatives: stubs only until a new bake-off (delays a working call for no new information); re-run the bake-off (the measurements are three weeks old and on the same language).

## Consequences

Landmark's measured tuning values carry over as the defaults in `docs/VOICE.md`. A provider change is an adapter change plus a bench run, never a loop change. Audio never leaves the EU region. Dependabot groups `@livekit/*` so the pins move together.

## Date

2026-10-26
