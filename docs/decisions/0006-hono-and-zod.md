# 0006 — Hono + zod

## Context

The API needs an HTTP framework and the whole system needs one validation library for request bodies, env and tool inputs. Landmark's edge-function handlers are written against web-standard `Request` / `Response`, and its in-process test harness calls handlers directly.

## Decision

Hono on `@hono/node-server` for the API; zod for every input, with the tool JSON Schema derived from the zod schema and inputs re-validated at dispatch. Alternatives: Fastify (its own request type; the Landmark handlers and harness would not port); hand-written JSON Schema for tools (drifts from the TypeScript types and gives no runtime check).

## Consequences

Landmark's handlers and its `app.request(req)`-style tests port almost verbatim. The SDK's parsed tool input is never trusted: a truncated input fails zod at dispatch and becomes an `is_error` result. zod is a dependency of `@va/core`, so every tool pack shares one version.

## Date

2026-10-26
