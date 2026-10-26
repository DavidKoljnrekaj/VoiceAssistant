---
paths:
  - '**/*.test.ts'
  - 'supabase/tests/**'
  - 'packages/core/src/test/**'
---

# Tests

- **Fakes answer the wire protocol:** the Anthropic Messages API (`POST /v1/messages`, JSON and
  SSE), PostgREST and GoTrue, routed through `globalThis.fetch`. The real SDKs stay in the loop; a
  test that mocks an SDK method is wrong.
- **A scenario starts from a freshly seeded world** (`fixtures`) and must consume exactly the model
  turns it scripted; an unconsumed or missing turn fails the test.
- **Assert on wire output, rows and requests sent**, never on internals. Name scenarios with ids
  (`it('E07: abort after first tool call persists synthetic results')`).
- **Fixing a bug:** the failing test comes first, named after the backlog id (`CORE-12`), asserting
  what the user sees. Run it, see it fail, then fix.
- **Never delete, skip or loosen an assertion to get green.** A wrong expectation is changed on
  purpose, with the reason in the commit message and in the `/done` report. The hook
  `.claude/hooks/guard-tests.mjs` asks the user before such an edit is applied.
- **Behaviour that looks wrong but is out of scope** is pinned as-is with a test and logged in the
  backlog with an `OQ-` prefix in the title.
- **SQL** is tested in SQL (pgTAP) as a real user of each role, never by reading the migration text.
- Tests live beside the code as `*.test.ts`; `pnpm exec vitest run <path>` runs one file.
