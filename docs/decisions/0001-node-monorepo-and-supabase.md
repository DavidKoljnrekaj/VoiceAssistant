# 0001 — Node monorepo (pnpm) + Supabase

## Context

The reference implementation, Landmark, runs its assistant as Deno edge functions on Supabase plus a separate Node voice worker that calls the engine over HTTP (`voice-llm`). That split put an HTTP hop and an OpenAI-chunk wire format on the voice hot path, and two runtimes with two test runners in one repo. The new product is standalone and needs a shape that every later channel (WhatsApp, phone, email) can plug into.

## Decision

A pnpm monorepo on Node 24: `packages/core` (the engine), `packages/db`, `apps/api` (HTTP), `apps/voice` (LiveKit worker importing the engine in-process), `apps/web` (PWA). Supabase provides Postgres, Auth and Storage. Alternatives: mirror Landmark (Deno edge functions + Node worker) — two runtimes and the HTTP hop; Node with its own Postgres and auth — more to operate for no gain in the skeleton.

## Consequences

One runtime and one test runner (Vitest) for everything; the voice worker calls the engine in-process, so no `voice-llm` service and no wire format on the hot path. Landmark's edge-function code ports by hand, not by copy. Deployment is two long-running Node processes plus a static PWA (Part 7).

## Date

2026-10-26
