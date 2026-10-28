/*
  Users and the helpers every later policy relies on (docs/plan/02-database.md §2).

  The assistant has its own profile table: one row per auth user, created by trigger when the
  auth user is created (email sign-up or an admin invite). It is not Landmark's app-wide table.

  - role gates tools (`requiredRoles` in the tool registry). Only 'admin' and 'member' exist;
    what a user may see inside a connected platform belongs to that integration's credential
    mapping later, not here. Role changes are an admin operation through the service role: no
    column grant lets an authenticated user update role, so no policy needs to forbid it.
  - language selects the prompt presentation and the voice settings ('hr' or 'en').
  - phone_e164 is nullable and unique; reserved for WhatsApp and phone caller identification
    (Part 8). Nothing writes it yet.
  - app_user_id() and app_user_role() map auth.uid() to the profile; every owner-scoped policy
    uses app_user_id(). set_updated_at() is the generic updated_at trigger, reused by ai_sessions.

  RLS: a signed-in user reads and updates (display_name, language) their own row and nothing
  else. anon sees nothing. The service role reads and writes everything (persistence, admin).

  After applying: nothing to do by hand. Regenerate packages/db/src/database.ts with /db-types.
*/

CREATE TABLE IF NOT EXISTS public.users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id   uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text,
  display_name   text,
  role           text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  language       text NOT NULL DEFAULT 'hr' CHECK (language IN ('hr', 'en')),
  phone_e164     text UNIQUE CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.users IS
  'Assistant user profiles, one per auth user. role gates tools; language picks the prompt presentation and voice settings. Role changes go through the service role only.';
COMMENT ON COLUMN public.users.auth_user_id IS
  'The auth.users row this profile belongs to. Policies compare it with auth.uid().';
COMMENT ON COLUMN public.users.role IS
  '''admin'' or ''member''. Gates tools (requiredRoles). Changed only through the service role; no column grant lets a user change their own.';
COMMENT ON COLUMN public.users.language IS
  '''hr'' or ''en''. Selects the prompt presentation and the voice settings. The user may change it.';
COMMENT ON COLUMN public.users.phone_e164 IS
  'E.164 phone number, unique. Reserved for WhatsApp / phone caller identification (Part 8); nothing writes it yet.';

-- Who is the caller? Used by every owner-scoped policy. SECURITY DEFINER so the lookup works
-- before the caller has any grant on users; it only ever returns the caller's own row.
CREATE OR REPLACE FUNCTION public.app_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.app_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.role FROM public.users u WHERE u.auth_user_id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.app_user_id() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_user_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.app_user_role() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.app_user_role() TO authenticated, service_role;

COMMENT ON FUNCTION public.app_user_id() IS
  'The public.users.id of the caller (auth.uid()), or null. The owner-scoping helper used by every policy.';
COMMENT ON FUNCTION public.app_user_role() IS
  'The role of the caller (auth.uid()), or null.';

-- Generic updated_at maintenance, reused by ai_sessions.
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A profile row is created when an auth user is created (email sign-up or admin invite).
-- SECURITY DEFINER because the auth server's role has no grant on public.users.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (auth_user_id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- RLS: self only. The grants say the same as the policies.
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.users FROM anon, authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE (display_name, language) ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;

DROP POLICY IF EXISTS users_select_self ON public.users;
CREATE POLICY users_select_self ON public.users
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());
