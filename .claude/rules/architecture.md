---
paths:
  - 'apps/**'
  - 'packages/**'
---

# Architecture

- **Dependency direction** is strict: `web → api` (HTTP only); `api → core → db`; `voice → core → db`;
  `tools-* → core` (types only). `core` never imports an app, never does HTTP, never imports LiveKit
  or React. A new edge in any other direction is a design change: stop and ask.
- **Public surface.** `src/index.ts` is a package's public surface. Nothing imports another package's
  internals: `@va/core/src/...` is forbidden (ESLint); use the exports map and add a named export if
  something is missing. Export what the package's doc in `docs/` lists, not everything.
- **Layers inside apps:** `routes/` (api) or `components/` (web) → `hooks/` → `services/` → clients.
  Hooks never touch Supabase directly (ESLint rule on `apps/web/src/**/hooks/**`). Services own the
  queries and throw on failure.
- **Files** target 150–300 lines; split by concern (one module per responsibility), not by size.
- **Imports** in order: node built-ins → third-party → `@va/*` → relative. Named exports only; the
  exceptions are React components and the LiveKit agent entry (`export default defineAgent(...)`).
- **Errors** carry a stable `code` and a Croatian user-facing `message` from the catalogue in
  `@va/core` (`errors`). Nothing returns `[]`, `0` or `null` in place of an error.
- **Configuration** comes from env, validated with zod at startup in one `env.ts` per app. No
  `process.env` reads elsewhere; no env reads inside `packages/core` except through injected settings.
- **Logs** are one JSON object per line with a `tag` (`[api]`, `[core]`, `[voice]`), ids and timings.
  Never message content.
