---
paths:
  - 'supabase/**'
  - 'packages/db/**'
---

# Database (`supabase/`, `@va/db`)

- **Write migrations with `/new-migration`.** Never apply, push, link or generate types against a
  project without being asked in this conversation. The local stack (`supabase start`,
  `supabase db reset`, `supabase test db`) is not a project: use it freely.
- **File naming** `supabase/migrations/YYYYMMDDHHMMSS_snake_case.sql`, later than the newest
  existing one. The opening `/* … */` says why (the problem, the backlog id, anything the operator
  must do by hand after applying).
- **Idempotent:** `CREATE … IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`,
  `CREATE OR REPLACE FUNCTION`.
- **Every table:** `ENABLE ROW LEVEL SECURITY`; policies `TO authenticated` using
  `public.app_user_id()`; explicit `REVOKE` / `GRANT` that say the same as the policies;
  `COMMENT ON` the table and non-obvious columns.
- **`SECURITY DEFINER` functions** set `search_path` and check the caller themselves.
- **Every function, policy or trigger gets a pgTAP test** in `supabase/tests/database/` in the same
  commit, acting as a real user of each role, asserting what a user would see (rows, error code).
  See `docs/TESTING.md` → Database tests.
- **After a migration is applied somewhere**, regenerate types with `/db-types` and commit
  `packages/db/src/database.ts` with it.
- `@va/db` exports client factories (`createUserClient(jwt)`, `createServiceClient()`), the env
  schema and the generated types. It never contains queries.
