/*
  Conversations: ai_sessions and ai_messages, with the bounded history read the engine needs
  (docs/plan/02-database.md §3; Landmark's ai chat tables are the starting point).

  - ai_sessions: one row per conversation. channel already allows chat, voice, whatsapp and
    phone, so later channels need no migration. external_id is the LiveKit room for voice, the
    thread id for whatsapp, null for chat. context_summary and summary_through_message_id are the
    compaction seam (written later by the compaction step, read by the history function).
  - ai_messages: one row per Anthropic message. role is the wire role; turn_kind separates real
    user turns from tool-result rows so rate limits count only real turns (Landmark counted
    tool-result rows by mistake, its OQ-3). content holds Anthropic content blocks; attachments
    will live inside that shape. parent_id makes the session a tree: the active branch is the
    walk from the leaf to the root. Cache token counts are recorded for cost dashboards.
  - ai_session_history(leaf, max_rows): walks parent_id from a leaf, newest first, at most
    max_rows, and stops after the session's summary boundary (the boundary row is included so the
    engine can confirm the summary applies to this branch). Service role only: the API verifies
    that the session belongs to the caller before calling it. SECURITY INVOKER on purpose: the
    service role bypasses RLS already, and if the grant is ever widened RLS still applies.

  RLS: a signed-in user reads their own sessions and messages (the PWA reads history through
  supabase-js). INSERT, UPDATE and DELETE are service role only: the API is the only writer and
  filters by user_id / session_id itself. Title rename and session delete come through the API
  (Part 4). anon sees nothing.

  Triggers: ai_sessions.updated_at moves on update, and an insert into ai_messages bumps the
  parent session's updated_at so the history list sorts by activity.

  After applying: nothing to do by hand. Regenerate packages/db/src/database.ts with /db-types.
*/

CREATE TABLE IF NOT EXISTS public.ai_sessions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel                     text NOT NULL DEFAULT 'chat'
                                CHECK (channel IN ('chat', 'voice', 'whatsapp', 'phone')),
  external_id                 text,
  title                       text,
  context_summary             text,
  summary_through_message_id  uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_sessions_user_updated_idx
  ON public.ai_sessions (user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_sessions_external_id_idx
  ON public.ai_sessions (channel, external_id) WHERE external_id IS NOT NULL;

COMMENT ON TABLE public.ai_sessions IS
  'One conversation per row, owned by a user. Signed-in users read their own; only the service role writes.';
COMMENT ON COLUMN public.ai_sessions.channel IS
  'Where the conversation happens: chat, voice, whatsapp or phone. Decides the sink, settings and tool allowlist.';
COMMENT ON COLUMN public.ai_sessions.external_id IS
  'The LiveKit room for voice, the thread id for whatsapp, null for chat. Unique per channel.';
COMMENT ON COLUMN public.ai_sessions.context_summary IS
  'Compaction seam: a summary of the older part of the conversation. Null until compaction exists.';
COMMENT ON COLUMN public.ai_sessions.summary_through_message_id IS
  'The last message covered by context_summary. ai_session_history stops after this row.';

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  role               text NOT NULL CHECK (role IN ('user', 'assistant')),
  turn_kind          text NOT NULL CHECK (turn_kind IN ('user', 'assistant', 'tool_result')),
  content            jsonb NOT NULL,
  parent_id          uuid REFERENCES public.ai_messages(id) ON DELETE SET NULL,
  model              text,
  input_tokens       integer,
  output_tokens      integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  stop_reason        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_role_kind CHECK (
    (role = 'assistant' AND turn_kind = 'assistant')
    OR (role = 'user' AND turn_kind IN ('user', 'tool_result'))
  )
);

CREATE INDEX IF NOT EXISTS ai_messages_session_created_idx
  ON public.ai_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS ai_messages_parent_idx
  ON public.ai_messages (parent_id);

COMMENT ON TABLE public.ai_messages IS
  'One Anthropic message per row; a session is a tree through parent_id. Signed-in users read their own; only the service role writes.';
COMMENT ON COLUMN public.ai_messages.role IS
  'The Anthropic wire role: user or assistant. Tool results travel as user messages.';
COMMENT ON COLUMN public.ai_messages.turn_kind IS
  'user (a real user turn), assistant, or tool_result. Rate limits count only turn_kind = user.';
COMMENT ON COLUMN public.ai_messages.content IS
  'Anthropic content blocks as sent or received. Attachments will live inside this shape.';
COMMENT ON COLUMN public.ai_messages.parent_id IS
  'The message this row continues from; null on the first row of a session. Siblings are branches.';
COMMENT ON COLUMN public.ai_messages.cache_read_tokens IS
  'Prompt cache read tokens of the request that produced an assistant row, for cost dashboards.';
COMMENT ON COLUMN public.ai_messages.cache_write_tokens IS
  'Prompt cache creation tokens of the request that produced an assistant row, for cost dashboards.';

-- The summary boundary points into ai_messages, which did not exist when ai_sessions was created.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_sessions_summary_fk' AND conrelid = 'public.ai_sessions'::regclass
  ) THEN
    ALTER TABLE public.ai_sessions
      ADD CONSTRAINT ai_sessions_summary_fk
      FOREIGN KEY (summary_through_message_id) REFERENCES public.ai_messages(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Triggers: updated_at on update; a new message bumps its session so the list sorts by activity.
DROP TRIGGER IF EXISTS ai_sessions_set_updated_at ON public.ai_sessions;
CREATE TRIGGER ai_sessions_set_updated_at
  BEFORE UPDATE ON public.ai_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.touch_session_on_message() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.ai_sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_messages_touch_session ON public.ai_messages;
CREATE TRIGGER ai_messages_touch_session
  AFTER INSERT ON public.ai_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_session_on_message();

-- Bounded history: walk parent_id from a leaf, newest first, at most p_max_rows rows (none when
-- p_max_rows < 1), stopping after the session's summary boundary and never leaving the leaf's
-- session. Returned root -> leaf.
CREATE OR REPLACE FUNCTION public.ai_session_history(p_leaf_id uuid, p_max_rows integer DEFAULT 200)
RETURNS SETOF public.ai_messages
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH RECURSIVE chain AS (
    SELECT m.*, 1 AS depth
    FROM public.ai_messages m
    WHERE m.id = p_leaf_id AND p_max_rows >= 1
    UNION ALL
    SELECT m.*, c.depth + 1
    FROM public.ai_messages m
    JOIN chain c ON m.id = c.parent_id AND m.session_id = c.session_id
    WHERE c.depth < p_max_rows
      AND NOT EXISTS (
        SELECT 1 FROM public.ai_sessions s
        WHERE s.id = c.session_id AND s.summary_through_message_id = c.id
      )
  )
  SELECT id, session_id, role, turn_kind, content, parent_id, model, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, stop_reason, created_at
  FROM chain
  ORDER BY depth DESC
$$;

REVOKE ALL ON FUNCTION public.ai_session_history(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_history(uuid, integer) TO service_role;

COMMENT ON FUNCTION public.ai_session_history(uuid, integer) IS
  'The active branch from a leaf: at most p_max_rows rows, root -> leaf, within the leaf''s session, stopping after the session''s summary boundary (included). Service role only; the API checks ownership first.';

-- RLS: owner-scoped SELECT for signed-in users; every write is service role only.
ALTER TABLE public.ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_sessions FROM anon, authenticated;
GRANT SELECT ON public.ai_sessions TO authenticated;
GRANT ALL ON public.ai_sessions TO service_role;

REVOKE ALL ON public.ai_messages FROM anon, authenticated;
GRANT SELECT ON public.ai_messages TO authenticated;
GRANT ALL ON public.ai_messages TO service_role;

DROP POLICY IF EXISTS ai_sessions_select_own ON public.ai_sessions;
CREATE POLICY ai_sessions_select_own ON public.ai_sessions
  FOR SELECT TO authenticated
  USING (user_id = public.app_user_id());

DROP POLICY IF EXISTS ai_messages_select_own ON public.ai_messages;
CREATE POLICY ai_messages_select_own ON public.ai_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_sessions s
      WHERE s.id = ai_messages.session_id AND s.user_id = public.app_user_id()
    )
  );
