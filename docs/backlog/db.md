# Backlog — db

Ids: DB-5 (next free)

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

### DB-2 · Low · No database cap on `voice_calls.expires_at` (R-D1)

- **Check:** Confirmed (review 2026-10-30, R-D1)
- **Where:** `supabase/migrations/20261028100200_voice_calls.sql` (the comment describes
  "min(JWT exp, created_at + 15 min)", enforced only in `apps/api/src/voice/calls.ts`)
- **What happens:** a bug or a hand-written row can keep a JWT usable past the 15-minute cap the
  security notes promise
- **Fix direction:** `/new-migration` with
  `CHECK (expires_at <= created_at + interval '15 minutes')` and a pgTAP case; an apply item in
  `release.md`

### DB-3 · Low · pgTAP gaps (R-D2)

- **Check:** Confirmed (R-D2)
- **Where:** `supabase/tests/database/`
- **What happens:** an `ai_messages` UPDATE as `authenticated` is never attempted;
  `app_user_id()` / `app_user_role()` EXECUTE posture for `anon` is not asserted
  (`has_function_privilege` sidesteps `DB-1`); `handle_new_auth_user`'s `ON CONFLICT DO NOTHING`
  path and the no-profile case (valid JWT, no `users` row) are untested; nothing pins
  "`ai_session_history` does not check ownership; the API must"; the sweep assertion is skipped
  on the local image (`voice_calls_service_only.test.sql`), so the job has never been tested
  anywhere
- **Fix direction:** one case each; the sweep runs on the dev project after `REL-1` (pg_cron on)

### DB-4 · Low · Auth URLs point at the API, and two trigger couplings are undocumented (R-D3)

- **Check:** Confirmed (R-D3)
- **Where:** `supabase/config.toml` `[auth] site_url` and `additional_redirect_urls` (port 3000,
  the API; the PWA dev server is 5173 and compose serves 8080); `touch_session_on_message()`
  (INVOKER, updates `ai_sessions`); `handle_new_auth_user` (inserts only)
- **What happens:** harmless until an email-link flow exists; if `authenticated` ever gets INSERT
  on `ai_messages`, the trigger fails on the missing UPDATE grant; an auth email change never
  reaches `users.email` (DB.md's "copied at creation" is right, but the API and UI may show a
  stale email)
- **Fix direction:** point the auth URLs at the PWA origins; a sentence on the trigger coupling
  in `docs/DB.md`; decide whether to sync the email (an UPDATE trigger) or document it

## Resolved

Nothing yet.
