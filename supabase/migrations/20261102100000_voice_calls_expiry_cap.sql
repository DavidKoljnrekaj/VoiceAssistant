/*
  Cap voice_calls.expires_at in the database (DB-2, review R-D1).

  20261028100200_voice_calls.sql promised "min(JWT expiry, created_at + 15 minutes)" in a column
  comment, but only apps/api/src/voice/calls.ts (CALL_CAP_MS) enforced it. A bug in the API or a
  hand-written row could keep a stored JWT usable past the cap the security notes rely on. The
  CHECK makes the comment true and lets pgTAP pin it; the API's cap is unchanged, so no existing
  row violates it. created_at is set once (nothing updates it), so a refresh that moves
  expires_at is checked against the call's start.

  The CHECK compares two timestamps that must come from one clock. The API computes expires_at
  on its own host's clock (min(JWT expiry, now + 15 minutes)); if created_at were left to the
  column default (the database's now()) and the API host ran ahead of the database by more than
  the start's preceding round trips, every start would fail with 23514. So startCall sends
  created_at explicitly from the same clock as expires_at (apps/api/src/voice/calls.ts, pinned
  by the API scenario V19), and the constraint only ever sees the API's arithmetic.

  After applying: nothing to do by hand; a CHECK changes no generated type (REL-7).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'voice_calls_expires_within_cap' AND conrelid = 'public.voice_calls'::regclass
  ) THEN
    ALTER TABLE public.voice_calls
      ADD CONSTRAINT voice_calls_expires_within_cap
      CHECK (expires_at <= created_at + interval '15 minutes');
  END IF;
END $$;

COMMENT ON CONSTRAINT voice_calls_expires_within_cap ON public.voice_calls IS
  'A call row is never usable more than 15 minutes after it was created, whatever the JWT says. The API caps earlier when the JWT expires sooner.';
COMMENT ON COLUMN public.voice_calls.expires_at IS
  'Hard cap: min(JWT expiry, created_at + 15 minutes). A refresh never moves it past the cap (voice_calls_expires_within_cap).';
