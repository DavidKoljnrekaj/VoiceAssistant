# Testing

## Commands

| Command                                  | Runs                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm test`                              | every Vitest project (`packages/*`, `apps/*`)                          |
| `pnpm exec vitest run <path>`            | one file or directory                                                  |
| `pnpm exec vitest run -p @va/core`       | one project                                                            |
| `pnpm test:watch`                        | watch mode                                                             |
| `pnpm exec vitest related --run <files>` | the tests that import the given source files (what the Stop hook runs) |
| `pnpm test:db`                           | pgTAP against the local stack (`supabase start` first; Part 2)         |
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

## Database tests (Part 2)

pgTAP files in `supabase/tests/database/`, run by `supabase test db` against the local stack
built from every migration. Each test acts as a real user of each role (set the role and the JWT
claims) and asserts the rows, the error code, or what is left after a refused write. No test
reads a migration's text. Write the test first, see it fail with the migration removed, then pass.

## Harness checks

- The Stop hook (`.claude/hooks/stop-verify.mjs`) typechecks each changed package and runs the
  related tests before a Claude Code turn can end.
- CI (`.github/workflows/test.yml`) runs install, audit, typecheck, lint and the unit tests on
  every push and pull request to `main`; `db-tests.yml` runs pgTAP.
