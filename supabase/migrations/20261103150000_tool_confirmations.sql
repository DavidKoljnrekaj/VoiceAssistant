/*
  The write protocol's pending confirmations and audit (docs/plan/12-write-protocol.md §4;
  decision 0015).

  A tool that changes something (an email reply, a note) runs only after the user confirmed.
  The engine previews the write, stores what it would do here, and the channel asks; the user's
  yes comes back as the row's id, which the engine consumes once (single use, five-minute
  expiry, the same session, user, tool and input) before the handler runs. The row then holds
  the outcome: the audit of every write the assistant made or was asked to make.

  - input_hash is the SHA-256 of the validated input the summary describes; a changed input
    does not match and gets a new preview.
  - outcome: pending → executed | failed (the handler ran) | declined (the user said no) |
    expired (nobody answered). confirmed_at is set when the id is consumed, settled_at when the
    outcome is final.
  - The chat channel writes here through the API with the service role, every query by
    session_id and user_id; the voice worker keeps its confirmations in memory for a call and
    writes nothing here (a call is one process).

  RLS: the owner reads their own rows (the companion app's audit view); anon nothing; every
  write is the service role.

  After applying: nothing to do by hand. Regenerate packages/db/src/database.ts with /db-types.
*/

CREATE TABLE IF NOT EXISTS public.tool_confirmations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tool         text NOT NULL,
  input_hash   text NOT NULL,
  summary      text NOT NULL,
  outcome      text NOT NULL DEFAULT 'pending'
                 CHECK (outcome IN ('pending', 'executed', 'failed', 'declined', 'expired')),
  error_code   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  confirmed_at timestamptz,
  settled_at   timestamptz
);

CREATE INDEX IF NOT EXISTS tool_confirmations_session_idx
  ON public.tool_confirmations (session_id, created_at DESC);

ALTER TABLE public.tool_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_confirmations FROM anon, authenticated;
GRANT SELECT ON public.tool_confirmations TO authenticated;
GRANT ALL ON public.tool_confirmations TO service_role;

DROP POLICY IF EXISTS tool_confirmations_select_own ON public.tool_confirmations;
CREATE POLICY tool_confirmations_select_own ON public.tool_confirmations
  FOR SELECT TO authenticated
  USING (user_id = public.app_user_id());

COMMENT ON TABLE public.tool_confirmations IS
  'The write protocol: a write the assistant previewed and the user is asked to confirm, then its outcome. The id unlocks one execution; it travels through the channel, never through the model. Owner reads; only the service role writes.';
COMMENT ON COLUMN public.tool_confirmations.input_hash IS
  'SHA-256 of the validated tool input the summary describes. A confirmation unlocks exactly that input.';
COMMENT ON COLUMN public.tool_confirmations.summary IS
  'What the tool said it would do, in the user''s language. What the user saw or heard before answering.';
COMMENT ON COLUMN public.tool_confirmations.outcome IS
  'pending until answered; executed or failed once the handler ran; declined when the user said no; expired when nobody answered in time.';
COMMENT ON COLUMN public.tool_confirmations.confirmed_at IS
  'When the id was consumed by a confirmed request. Null while pending, declined or expired.';
