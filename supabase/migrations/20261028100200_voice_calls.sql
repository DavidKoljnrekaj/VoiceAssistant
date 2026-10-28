/*
  Voice calls: the hand-over of the caller's JWT to the voice worker (docs/plan/02-database.md §4;
  ported from Landmark's 20261026100000_voice_calls.sql).

  POST /voice/sessions creates an ai_sessions row with channel 'voice' and one voice_calls row.
  The worker has no user JWT of its own: the browser's session is handed over server-side, keyed
  by an opaque call token that travels through LiveKit job metadata.

  - One row per live call. The token itself is never stored, only its SHA-256. platform_call_id
    binds the token to one LiveKit room. access_token is the caller's JWT, a live credential for
    our database, so the table is service role only: RLS on, no policies, no grants to anon or
    authenticated.
  - A row is usable only while expires_at > now() (a hard cap of 15 minutes from the start) and
    last_seen_at is within the last 3 minutes; the worker checks both in its lookup, so an
    expired row counts as absent even before it is deleted. The 'voice-calls-sweep' job deletes
    such rows every minute; its timing is housekeeping, not a security property.

  After applying: the sweep needs pg_cron. Without it the migration skips the schedule with a
  notice: expired rows are then still refused at lookup, but nothing deletes them. Enable pg_cron
  (Dashboard -> Database -> Extensions) and run the last DO block of this file again to schedule
  it. Regenerate packages/db/src/database.ts with /db-types.
*/

CREATE TABLE IF NOT EXISTS public.voice_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL UNIQUE REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  call_token_hash  text NOT NULL UNIQUE,
  platform_call_id text UNIQUE,
  access_token     text NOT NULL,
  expires_at       timestamptz NOT NULL,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_calls FROM anon, authenticated;
GRANT ALL ON public.voice_calls TO service_role;

COMMENT ON TABLE public.voice_calls IS
  'Live in-app voice calls: the caller''s JWT, handed to the voice worker by an opaque call token. Service role only. Rows are deleted on hang-up and swept once expired or idle.';
COMMENT ON COLUMN public.voice_calls.call_token_hash IS
  'SHA-256 (hex) of the opaque call token. The token itself is never stored.';
COMMENT ON COLUMN public.voice_calls.platform_call_id IS
  'The LiveKit room the token is bound to; the worker refuses the token for any other room.';
COMMENT ON COLUMN public.voice_calls.access_token IS
  'The caller''s Supabase JWT, rotated by the refresh endpoint. A live credential.';
COMMENT ON COLUMN public.voice_calls.expires_at IS
  'Hard cap: min(JWT expiry, created_at + 15 minutes). A refresh never moves it past the cap.';
COMMENT ON COLUMN public.voice_calls.last_seen_at IS
  'Moved by every worker lookup. A row idle for 3 minutes counts as absent and is swept.';

-- Guarded so that `supabase db reset` on a local stack without pg_cron does not fail the whole
-- migration chain. Re-run this block after enabling pg_cron on a project. The guard checks
-- pg_extension, not to_regproc('cron.schedule'): that name is overloaded, so to_regproc returns
-- NULL even when pg_cron is installed and the block would always skip.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not available; skipping the voice-calls-sweep schedule.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('voice-calls-sweep')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'voice-calls-sweep');

  PERFORM cron.schedule(
    'voice-calls-sweep',
    '* * * * *',
    $sweep$DELETE FROM public.voice_calls
           WHERE expires_at < now()
              OR last_seen_at < now() - interval '3 minutes'$sweep$
  );
END $$;
