# Backlog — db

Ids: DB-5 (next free)

Schema, RLS, functions, triggers, pgTAP, generated types (`supabase/`, `packages/db`).

## Open

### DB-1 · Low · Permission denied on a function crashes the local Supabase Postgres for anon / authenticated

- **Check:** Confirmed (local stack, image `public.ecr.aws/supabase/postgres:17.6.1.106`, CLI 2.99.0, 2026-10-28);
  reproduced again on the same image on 2026-11-02 (signal 11, recovery, then alive). A newer image
  (`17.6.1.155`, pulled by a newer CLI) was seen on this machine but not probed; `supabase stop`
  and `supabase start` after a CLI update, then the probe in `docs/RELEASE-RUNBOOK.md` step 13
  against the local stack, re-checks it. The dev project's image is step 13 of that runbook.
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

### DB-2 · Low · No database cap on `voice_calls.expires_at` (R-D1)

- Fixed on `fix/db-review` (PR #24, `b35e237`; `feat(db): a CHECK caps voice_calls.expires_at at 15 minutes from the start`):
  `20261102100000_voice_calls_expiry_cap.sql` adds `voice_calls_expires_within_cap`
  (`expires_at <= created_at + interval '15 minutes'`); `voice_calls_service_only.test.sql`
  refuses an insert and a refresh past the cap (`23514`) and accepts one at the cap. Apply item:
  `REL-7`.

### DB-3 · Low · pgTAP gaps (R-D2)

- Closed on `fix/db-review` (PR #24, `b35e237`; `test(db): the pgTAP cases from the review`), one case each, every
  one seen failing with its grant, policy or function removed on the local stack: an
  `ai_messages` UPDATE as `authenticated` is `42501`; `anon` has no EXECUTE on `app_user_id()`
  or `app_user_role()` (`has_function_privilege`); `handle_new_auth_user` fired again for an
  auth user with a profile keeps the profile (through a temporary UPDATE trigger on `auth.users`,
  since a profile cannot precede its auth row); a valid JWT without a profile gets null helpers
  and no rows; `ai_session_history` returns the branch under another user's claims, so the API
  must check ownership first. The sweep's DELETE is exercised on the dev project under `REL-1`.

### DB-4 · Low · Auth URLs point at the API, and two trigger couplings are undocumented (R-D3)

- Fixed on `fix/db-review` (PR #24, `b35e237`; `fix(db): auth site_url and redirect URLs point at the PWA`):
  `config.toml` `site_url` is the PWA dev server (`127.0.0.1:5173`), the redirect list is
  `localhost:5173` and the compose origin `8080` on both hosts. `docs/DB.md` documents that
  `touch_session_on_message` runs as the inserting role (an INSERT grant on `ai_messages` for
  `authenticated` needs an UPDATE grant and policy on `ai_sessions` in the same change) and that
  `users.email` is copied once: documented, not synced, until a change-email flow exists.
