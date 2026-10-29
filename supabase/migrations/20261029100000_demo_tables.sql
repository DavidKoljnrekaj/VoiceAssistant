/*
  The demo tool pack's tables (CORE-2). `@va/tools-demo` reads `demo_items` (search_items,
  get_item) and writes `demo_notes` (create_note) through the caller's RLS client; until now the
  two tables existed only in the test fakes, so a live call or the voice bench against a real
  database got a tool error on every catalogue question (docs/VOICE.md → Measurements, 2026-10-29).

  - demo_items: a company-wide catalogue. Every signed-in user reads all of it (the pack's
    handlers assume so); nobody but the service role writes it. updated_at moves by trigger.
  - demo_notes: a user's own notes on items. A signed-in user inserts notes as themselves and
    reads their own; no update or delete (the pack has no such tool). The insert returns the new
    row, which needs the SELECT policy.

  The local seed (supabase/seed.sql) loads the same nine items the fakes carry, so the bench's
  questions are answerable on the local stack.

  After applying: regenerate packages/db/src/database.ts with /db-types; then
  packages/tools-demo/src/demo-db.ts can drop its hand-written DemoDatabase cast.
*/

CREATE TABLE IF NOT EXISTS public.demo_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  category    text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 100),
  price       numeric(12, 2) NOT NULL CHECK (price >= 0),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_items_name_idx ON public.demo_items (lower(name));

DROP TRIGGER IF EXISTS demo_items_set_updated_at ON public.demo_items;
CREATE TRIGGER demo_items_set_updated_at
  BEFORE UPDATE ON public.demo_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.demo_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_items FROM anon, authenticated;
GRANT SELECT ON public.demo_items TO authenticated;
GRANT ALL ON public.demo_items TO service_role;

DROP POLICY IF EXISTS demo_items_read_all ON public.demo_items;
CREATE POLICY demo_items_read_all ON public.demo_items
  FOR SELECT TO authenticated
  USING (true);

COMMENT ON TABLE public.demo_items IS
  'The demo catalogue read by the example tool pack. Company-wide: every signed-in user reads every row; only the service role writes.';
COMMENT ON COLUMN public.demo_items.price IS 'In EUR; the tools return it as a raw number and the prompts say how to speak it.';

CREATE TABLE IF NOT EXISTS public.demo_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES public.demo_items(id) ON DELETE CASCADE,
  text       text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_notes_user_created_idx ON public.demo_notes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS demo_notes_item_idx ON public.demo_notes (item_id);

ALTER TABLE public.demo_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_notes FROM anon, authenticated;
GRANT SELECT, INSERT ON public.demo_notes TO authenticated;
GRANT ALL ON public.demo_notes TO service_role;

DROP POLICY IF EXISTS demo_notes_select_own ON public.demo_notes;
CREATE POLICY demo_notes_select_own ON public.demo_notes
  FOR SELECT TO authenticated
  USING (user_id = public.app_user_id());

DROP POLICY IF EXISTS demo_notes_insert_own ON public.demo_notes;
CREATE POLICY demo_notes_insert_own ON public.demo_notes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = public.app_user_id());

COMMENT ON TABLE public.demo_notes IS
  'A user''s notes on demo catalogue items, written by the example pack''s create_note tool. Owner-scoped: insert as yourself, read your own, no update or delete.';
