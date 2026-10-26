---
name: new-migration
description: Use when a change needs a new Supabase migration (table, column, policy, function, trigger, grant). Writes the file in this repo's style with its pgTAP test; never applies it.
argument-hint: '[what the migration does]'
---

# Write a migration

Latest migrations:

!`ls supabase/migrations 2>/dev/null | tail -5 || echo "(no migrations yet)"`

**Write the file; never apply it.** Do not run `supabase db push`, `supabase migration up`,
`psql` or any SQL against a project unless the user asks for exactly that in this conversation.
The local Docker stack (`supabase start`, `supabase db reset`, `pnpm test:db`) is not a project:
use it freely.

## Before writing

- Read `.claude/rules/db.md` and `docs/TESTING.md` → Database tests
- Check the existing policies on every table you touch, in the latest migration that defines them
- Replacing a function, view, trigger, index or policy an older migration created: say which one
  and check the new definition still satisfies the older test

## The file

- Name: `supabase/migrations/YYYYMMDDHHMMSS_snake_case_summary.sql`, later than the newest above.
  Same-day migrations step by `100` (`…100000`, `…100100`)
- Open with a `/* … */` block saying **why** — the problem, the backlog id it fixes (`DB-3`), and
  anything the operator must do by hand after applying
- Idempotent: `CREATE … IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`,
  `CREATE OR REPLACE FUNCTION`
- New tables: `ENABLE ROW LEVEL SECURITY`; policies `TO authenticated` using
  `public.app_user_id()`; explicit `REVOKE` / `GRANT` so the grants say the same as the policies
- `COMMENT ON` new tables and non-obvious columns
- `SECURITY DEFINER` functions set `search_path` and check the caller themselves

## Test it in SQL

Every new function, policy or trigger gets a pgTAP test in `supabase/tests/database/`, named
after its backlog id or purpose (`db_3_voice_calls_rls.test.sql`), in the same commit.

1. Write the test first. With the migration moved out of `supabase/migrations/`, run
   `supabase db reset && pnpm test:db` and see it fail
2. Put the migration back, `supabase db reset && pnpm test:db`, see it pass
3. Test as each role that matters (set the role and the JWT claims) and assert the outcome a user
   would see: the rows they get back, the error code, what is left after a refused delete
4. Do not write a test that reads the migration's text

The local stack needs Docker and `supabase start`. If Docker is not available, say so and leave
the run for the user.

## After writing

- Add an unticked "Apply `<name>`" item to `docs/backlog/release.md` with the check to run after
  applying, dev first
- Say that `packages/db/src/database.ts` needs `/db-types` once the migration is applied
- Update `docs/ARCHITECTURE.md` → Data if the data model changed
