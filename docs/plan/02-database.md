# Part 2 — Supabase project, schema, RLS, pgTAP, generated types

## Prompt for the session

```
Read docs/plan/00-brief.md and docs/plan/02-database.md, then implement Part 2 on a branch
feat/database from main. Restate the deliverables and the acceptance checklist first and ask me only
about what the plan leaves open (the Supabase project is created by me; you get its ref and keys).
Write the migrations with /new-migration and never apply anything to a linked project: use the local
stack (supabase start, supabase db reset, supabase test db) for everything. When done, run /done,
write docs/DB.md, and report.
```

## Goal

The persistent model of the assistant: users, sessions, messages and live voice calls, protected by
RLS, with the SQL function the engine needs for a bounded history read, pgTAP tests proving the
policies, and the generated TypeScript types in `packages/db`.

## Context beyond the brief

Landmark's tables are the starting point (`docs/AI_CHAT.md` → Data Model, migration
`20261026100000_voice_calls.sql`). Changes from Landmark, all deliberate:

- `users` is ours (Landmark reused an app-wide table). Roles are `admin` and `member`; integration roles
  (what a user may see in a connected platform) belong to that integration's credential mapping later.
- `ai_sessions.channel` already allows `chat`, `voice`, `whatsapp`, `phone` so later channels need no migration.
- `ai_messages.turn_kind` separates real user turns from tool-result rows for counting (Landmark's rate limit
  counted tool-result rows by mistake, its OQ-3).
- `ai_messages` records cache token counts, for cost dashboards.
- No `cancel_requested_at` (no DB beacon), no attachments table yet (seam left in the content JSONB shape).
- A bounded history function replaces Landmark's unbounded "select every row of the session".

## Deliverables

```
supabase/config.toml                       local ports shifted (5442x) so it can run beside Landmark's stack
supabase/migrations/<ts>_users.sql
supabase/migrations/<ts>_ai_sessions_and_messages.sql
supabase/migrations/<ts>_voice_calls.sql
supabase/seed.sql                          local dev users (admin + member) and one chat session
supabase/tests/database/00_rls_enabled.test.sql
supabase/tests/database/users_self_access.test.sql
supabase/tests/database/ai_sessions_owner_scoped.test.sql
supabase/tests/database/ai_session_history.test.sql
supabase/tests/database/voice_calls_service_only.test.sql
packages/db/src/database.ts                generated types (committed)
packages/db/src/clients.ts                 createUserClient(jwt), createServiceClient()
packages/db/src/env.ts                     zod-validated SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
packages/db/src/index.ts
docs/DB.md
```

Root scripts: `db:types` → `supabase gen types typescript --linked --schema public > packages/db/src/database.ts`
(the `/db-types` skill wraps it with the linked-project check).

## Specification

### 1. Project and local stack

- The user creates a Supabase project in an **EU region** and gives the session the project ref, the anon
  key and the service role key out of band (never in a file the session reads; `.env` is denied to Claude).
- `supabase init`; `config.toml` with `project_id = "<product>"`, local ports `api 54431`, `db 54432`,
  `shadow 54430`, `pooler 54439`, `studio 54433`, `inbucket 54434`, `analytics 54437` (one block above
  Landmark's 5442x so both stacks can run). `[auth]` email sign-in on, confirmations off locally.
- `supabase link --project-ref <ref>` is run by the user, not the session; the session only reads
  `supabase/.temp/project-ref` to name it.
- `supabase start` and `supabase db reset` are the only ways the session applies SQL.

### 2. Migration: users and helpers

```sql
/* users: the assistant's own profile table, one row per auth user.
   role gates tools (requiredRoles); language selects the prompt presentation and the voice settings.
   phone_e164 is nullable and unique; reserved for WhatsApp / phone caller identification (Part 8). */
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

CREATE OR REPLACE FUNCTION public.app_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.app_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.role FROM public.users u WHERE u.auth_user_id = auth.uid()
$$;

-- updated_at trigger (generic, reused by ai_sessions)
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A profile row is created when an auth user is created (email sign-up or admin invite).
CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (auth_user_id, email) VALUES (NEW.id, NEW.email)
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users FROM anon, authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE (display_name, language) ON public.users TO authenticated;
DROP POLICY IF EXISTS users_select_self ON public.users;
CREATE POLICY users_select_self ON public.users FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users FOR UPDATE TO authenticated USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());
COMMENT ON TABLE public.users IS 'Assistant user profiles. role gates tools; language picks the prompt presentation and voice settings.';
```

Role changes are an admin operation through the service role (no policy grants role updates to
authenticated users). Record that in the migration comment.

### 3. Migration: sessions and messages

```sql
CREATE TABLE IF NOT EXISTS public.ai_sessions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel                     text NOT NULL DEFAULT 'chat' CHECK (channel IN ('chat', 'voice', 'whatsapp', 'phone')),
  external_id                 text,                   -- LiveKit room for voice; thread id for whatsapp; null for chat
  title                       text,
  context_summary             text,                   -- compaction, later
  summary_through_message_id  uuid,                   -- FK added after ai_messages exists
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_sessions_user_updated_idx ON public.ai_sessions (user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_sessions_external_id_idx ON public.ai_sessions (channel, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('user', 'assistant')),           -- the Anthropic wire role
  turn_kind         text NOT NULL CHECK (turn_kind IN ('user', 'assistant', 'tool_result')),
  content           jsonb NOT NULL,                                                -- Anthropic content blocks
  parent_id         uuid REFERENCES public.ai_messages(id) ON DELETE SET NULL,
  model             text,
  input_tokens      integer,
  output_tokens     integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  stop_reason       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_role_kind CHECK (
    (role = 'assistant' AND turn_kind = 'assistant') OR (role = 'user' AND turn_kind IN ('user', 'tool_result'))
  )
);
CREATE INDEX IF NOT EXISTS ai_messages_session_created_idx ON public.ai_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS ai_messages_parent_idx ON public.ai_messages (parent_id);
ALTER TABLE public.ai_sessions
  ADD CONSTRAINT ai_sessions_summary_fk FOREIGN KEY (summary_through_message_id) REFERENCES public.ai_messages(id) ON DELETE SET NULL;
-- (guard the ADD CONSTRAINT with a DO block checking pg_constraint, as Landmark does)

-- Bounded history: walk parent_id from a leaf, newest first, at most max_rows, stopping after the summary boundary.
CREATE OR REPLACE FUNCTION public.ai_session_history(p_leaf_id uuid, p_max_rows integer DEFAULT 200)
RETURNS SETOF public.ai_messages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE chain AS (
    SELECT m.*, 1 AS depth FROM public.ai_messages m WHERE m.id = p_leaf_id
    UNION ALL
    SELECT m.*, c.depth + 1 FROM public.ai_messages m JOIN chain c ON m.id = c.parent_id
    WHERE c.depth < p_max_rows
      AND NOT EXISTS (SELECT 1 FROM public.ai_sessions s WHERE s.id = c.session_id AND s.summary_through_message_id = c.id)
  )
  SELECT id, session_id, role, turn_kind, content, parent_id, model, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, stop_reason, created_at
  FROM chain ORDER BY depth DESC
$$;
REVOKE ALL ON FUNCTION public.ai_session_history(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_session_history(uuid, integer) TO service_role;
```

The function is service-role only: the API calls it after it has verified that the session belongs to
the caller. The boundary row (the one `summary_through_message_id` points at) is included so the engine
can confirm the summary applies to this branch.

RLS: `ai_sessions` and `ai_messages` get owner-scoped **SELECT** for `authenticated` (the PWA reads
history directly through supabase-js). INSERT/UPDATE/DELETE on both are **service role only** in the
skeleton: the API is the only writer, and it filters by `user_id` / `session_id` itself. Grants match the
policies. Title rename and session delete come through the API in Part 4 (or get narrow policies later;
record the choice in `docs/DB.md`).

Triggers: `ai_sessions_set_updated_at`; an `AFTER INSERT ON ai_messages` trigger that bumps the parent
session's `updated_at` so the history list sorts by activity.

### 4. Migration: voice calls

Port Landmark's `voice_calls` verbatim (session_id unique, user_id, `call_token_hash` unique,
`platform_call_id` unique, `access_token`, `expires_at`, `last_seen_at`, `created_at`; RLS on with no
policies; `REVOKE ALL FROM anon, authenticated`; `GRANT ALL TO service_role`; comments; the guarded
`pg_cron` sweep `voice-calls-sweep` every minute deleting expired or idle rows, with the `RAISE NOTICE`
skip when `cron.schedule` does not exist). Note in the migration header that pg_cron must be enabled in
the Dashboard and the last block re-run.

### 5. Seed

`supabase/seed.sql` for the local stack only: two auth users through `auth.users` inserts (the way the
Supabase docs show for local seeds) with known passwords, giving an `admin` and a `member` profile, and
one chat session with three rows (user, assistant, user tool_result) so the history function has
something to walk. Document the credentials in `docs/DB.md` as local-only.

### 6. pgTAP tests

- `00_rls_enabled`: every table in `public` has RLS on.
- `users_self_access`: as user A, `SELECT` returns only A; `UPDATE` of own `language` works; updating own
  `role` is refused (no column grant); reading B's row returns nothing.
- `ai_sessions_owner_scoped`: as A, sees own sessions and messages only; INSERT as authenticated fails;
  service role inserts succeed; deleting a session cascades its messages.
- `ai_session_history`: seeded chain of 7 rows with a branch; the function from the leaf returns the
  active branch root → leaf in order; `p_max_rows = 3` returns the 3 newest; with
  `summary_through_message_id` set on a middle row it stops there and includes the boundary; the function
  is not executable as `authenticated`.
- `voice_calls_service_only`: `authenticated` cannot select, insert, update or delete; service role can;
  the sweep job exists when pg_cron is available (skip otherwise, with a diagnostic).

Write each test as a transaction that rolls back; set the role and JWT claims per Landmark's
`docs/TESTING.md` → Database tests.

### 7. `packages/db`

```ts
// env.ts — parsed once, thrown on first use if invalid
export const dbEnv = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})
// clients.ts
export function createUserClient(jwt: string): SupabaseClient<Database>   // anon key + Authorization header, no session persistence
export function createServiceClient(): SupabaseClient<Database>            // service role, no session persistence
export type { Database, Json } from './database.ts'
```

Both factories set `auth: { persistSession: false, autoRefreshToken: false }`. Types are generated from
the **local** stack during this part (`supabase gen types typescript --local`), so the file exists before
any project is linked; the `db:types` script and the `/db-types` skill switch to `--linked` later.

## Acceptance checklist

- [ ] `supabase start && supabase db reset` applies the three migrations from scratch without warnings other than the pg_cron notice.
- [ ] `pnpm test:db` green; each test file fails when its migration is moved out and passes when it is back (say which were tried).
- [ ] `packages/db/src/database.ts` committed; `pnpm typecheck` green.
- [ ] `docs/DB.md` describes every table, the function, the RLS posture (who can read / write what), the seed users, and the "service role only writes" decision.
- [ ] `docs/backlog/release.md` lists "Apply <three migrations> to the dev project, enable pg_cron, re-run the sweep block".
- [ ] No migration was applied to a linked project.

## Do not

- Add attachments, organisations, caller identities or compaction tables now; the seams are the JSONB
  content shape, the `channel` enum, `phone_e164` and the two summary columns.
- Write a `cancel_requested_at` column.
- Let `authenticated` write `ai_messages`.

## Landmark references

- `supabase/migrations/20260507120000_create_ai_chat_tables.sql` (the original AI tables)
- `supabase/migrations/20261026100000_voice_calls.sql`
- `docs/AI_CHAT.md` → Data Model, Ownership and RLS, The row sequence
- `docs/voice/02-voice-implementation-plan.md` §3.3 (bounded history), §4.4 (voice_calls lifecycle)
- `supabase/tests/database/*.test.sql` and `docs/TESTING.md` → Database tests (how to write pgTAP as a role)
- `.claude/skills/new-migration/SKILL.md`
