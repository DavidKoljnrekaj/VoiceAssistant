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
| `pnpm test:coverage`                     | every project with v8 coverage into `coverage/` (CI uploads it)        |
| `pnpm --filter @va/web test:e2e`         | the Playwright smoke in `apps/web/e2e/` against the built PWA (below)  |
| `pnpm typecheck`, `pnpm lint`            | the other two checks CI runs                                           |

Tests live beside the code as `*.test.ts`. Each package has a `vitest.config.ts` with
`environment: 'node'`; the root `vitest.config.ts` lists the projects.

## Conventions

- **Fakes stand in for the services, never for the SDKs.** The Anthropic Messages API
  (`POST /v1/messages`, JSON and SSE), PostgREST and GoTrue are answered by fakes routed through
  `globalThis.fetch`; `@anthropic-ai/sdk` and `supabase-js` run for real. The fakes live under
  `packages/core/src/test/` and are exported from `@va/core/test` (`docs/CORE.md` → Testing).
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

## Lint-style tests

Two suites read the source tree instead of running it. `L04` (`packages/core/src/log-fields.test.ts`)
finds every `log(` call under `apps/*` and `packages/*` and fails on a field named `text`,
`message`, `content`, `transcript`, `token` or `jwt` (invariant 9; `docs/OPS.md` → Logging).
`X01`–`X03` (`env-matrix.test.ts` in each app) fail when the first column of the matrix in
`docs/OPS.md` does not name a variable an `env.ts` validates, and `X01b`–`X03b` when the matrix
names one for an app whose `env.ts` does not validate it. Both exist so a rule in a doc cannot drift from the code silently.

## The Playwright smoke

`apps/web/e2e/smoke.spec.ts` drives the built PWA in Chromium through `vite preview`
(`apps/web/playwright.config.ts`): the login page renders in Croatian with the manifest and the
service worker (`E01`), a protected route redirects (`E02`), and with `E2E_EMAIL` /
`E2E_PASSWORD` a sign-in reaches the composer (`E03`, skipped otherwise). No chat turn is sent,
so no API or model key is needed. Locally: `pnpm --filter @va/web build` with `apps/web/.env`,
then `pnpm --filter @va/web exec playwright install chromium` once and
`pnpm --filter @va/web test:e2e`; `E2E_BASE_URL` points it at a deployed origin instead. In CI it
is `e2e.yml`, gated on secrets and the allowlisted dev URL (`docs/OPS.md` → CI).

The smoke signs in as a real user, so `apps/web/e2e/support/env.ts` refuses to start a browser
unless the project the build was made against is safe (Landmark's `e2e/support/env.ts`): the
local stack (`127.0.0.1`, `localhost`, `host.docker.internal`) always runs; any hosted project
must equal `E2E_ALLOWED_SUPABASE_URL`, which `e2e.yml` hardcodes to the dev project and a
developer sets by hand, never to production. `VITE_SUPABASE_URL` is read from the environment
first, then from `apps/web/.env*` as Vite's production build reads them. The guard is a pure
function in `e2e/support/prod-safety.ts`, pinned by `G01`–`G04` (a Vitest suite; the Playwright
specs themselves, `e2e/**/*.spec.ts`, are excluded in `apps/web/vitest.config.ts`).

## Harness checks

- The Stop hook (`.claude/hooks/stop-verify.mjs`) typechecks each changed package and runs the
  related tests before a Claude Code turn can end.
- CI (`.github/workflows/test.yml`) runs install, audit, typecheck, lint, the unit tests with
  coverage, the PWA build and a build of each container image on every push and pull request to
  `main`; `db-tests.yml` runs pgTAP; `e2e.yml` runs the smoke when its secrets are set.
