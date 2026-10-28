# Testing

## Commands

| Command                                  | Runs                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm test`                              | every Vitest project (`packages/*`, `apps/*`)                          |
| `pnpm exec vitest run <path>`            | one file or directory                                                  |
| `pnpm exec vitest run -p @va/core`       | one project                                                            |
| `pnpm test:watch`                        | watch mode                                                             |
| `pnpm exec vitest related --run <files>` | the tests that import the given source files (what the Stop hook runs) |
| `pnpm test:db`                           | pgTAP against the local stack (`supabase start` first)                 |
| `pnpm typecheck`, `pnpm lint`            | the other two checks CI runs                                           |

Tests live beside the code as `*.test.ts`. Each package has a `vitest.config.ts` with
`environment: 'node'`; the root `vitest.config.ts` lists the projects.

## Conventions

- **Fakes stand in for the services, never for the SDKs.** The Anthropic Messages API
  (`POST /v1/messages`, JSON and SSE), PostgREST and GoTrue are answered by fakes routed through
  `globalThis.fetch`; `@anthropic-ai/sdk` and `supabase-js` run for real. The fakes arrive in
  Part 3 under `packages/core/src/test/` and are exported from `@va/core/test`.
- **A scenario starts from a freshly seeded world** (`fixtures`) and must consume exactly the model
  turns it scripted.
- **Assert on wire output, rows and requests sent**, never on internals. Scenario names carry an
  id (`E07 …`).
- **A bug fix starts with a failing test** named after the backlog id (`it('CORE-12: …')`),
  asserting what the user sees. See it fail, then fix.
- **Never delete, skip or loosen an assertion to get green.** A wrong expectation is changed on
  purpose, with the reason in the commit and in the `/done` report. The hook
  `.claude/hooks/guard-tests.mjs` asks before such an edit.
- **Behaviour that looks wrong but is out of scope** is pinned as-is and logged in the backlog
  with an `OQ-` prefix.

## Database tests

pgTAP files in `supabase/tests/database/*.test.sql`, run by `supabase test db` (`pnpm test:db`)
against the local stack. `supabase start` and `supabase db reset` build that database from every
migration in `supabase/migrations/` and then load `supabase/seed.sql`, so a green run also proves
the migrations apply from scratch. Each file is one transaction that rolls back; nothing touches
a linked project. The files and what each checks are listed in `docs/DB.md` → Tests.

Writing one:

- Name the file after its backlog id or purpose, and the assertions too (`'DB-3: …'`). Write it
  first, see it fail with the migration moved out of `supabase/migrations/` (`supabase db reset`),
  put the migration back, see it pass.
- Fixtures are inserted as the database owner, so RLS does not get in the way. `insert into
auth.users (id, email)` is enough: the sign-up trigger creates the `public.users` row.
- To act as a user: `set local role authenticated;` then
  `set local request.jwt.claims = '{"sub":"<auth user id>","role":"authenticated"}';`.
  `set local role service_role;` is the API; `set local role anon;` the public. `reset role;`
  goes back to the owner, for example to count what a refused write left behind.
- A missing grant raises `42501` for every statement kind. An UPDATE or DELETE that RLS filters
  out raises nothing and touches 0 rows, so assert the row afterwards. A blanket `update … set`
  (no `WHERE`) exercises the UPDATE policy; with a `WHERE` the SELECT policy can hide it.
- `now()` is fixed inside a transaction: to see an `updated_at` trigger move, age the row first
  (insert it with an old `updated_at`, or disable the trigger for the setup update).
- Do not call a function the role has no EXECUTE on as `anon` or `authenticated`: the local
  Postgres image crashes instead of raising `42501` (`DB-1`). Assert the grant with
  `has_function_privilege` until that is fixed upstream.
- No test reads a migration's text.

## Harness checks

- The Stop hook (`.claude/hooks/stop-verify.mjs`) typechecks each changed package and runs the
  related tests before a Claude Code turn can end.
- CI (`.github/workflows/test.yml`) runs install, audit, typecheck, lint and the unit tests on
  every push and pull request to `main`; `db-tests.yml` runs pgTAP.
