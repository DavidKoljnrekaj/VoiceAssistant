# Backlog — db

Ids: DB-2 (next free)

Schema, RLS, functions, triggers, pgTAP, generated types (`supabase/`, `packages/db`).

## Open

### DB-1 · Low · Permission denied on a function crashes the local Supabase Postgres for anon / authenticated

- **Check:** Confirmed (local stack, image `public.ecr.aws/supabase/postgres:17.6.1.106`, CLI 2.99.0, 2026-10-28)
- **Where:** any `SELECT public.f()` run as `anon` or `authenticated` when the role lacks EXECUTE
  (`ai_session_history`, or a trivial `returns int language sql` function)
- **What happens:** the backend dies with signal 11 instead of raising `42501`; the whole stack
  goes into recovery and `supabase test db` reports every later file as "No plan found". A plain
  role gets the normal error, and table denials work (they come with the image's "Grant the
  required privileges" HINT, which is where the function path appears to crash). Not our schema.
- **Fix direction:** upstream (supabase-postgres). Until then no pgTAP test calls a function it
  has no EXECUTE on as `anon` / `authenticated`; grant posture is asserted with
  `has_function_privilege` (`ai_session_history.test.sql`). Re-check on a newer image and on the
  dev project (REL-1), then switch the test back to `throws_ok` if it is fixed.

## Resolved

Nothing yet.
