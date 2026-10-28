# Database (`supabase/`, `@va/db`)

The persistent model of the assistant: users, conversations, messages and live voice calls, on
Supabase Postgres with row level security on every table. Migrations live in
`supabase/migrations/`, pgTAP tests in `supabase/tests/database/`, the local seed in
`supabase/seed.sql`. `packages/db` holds the generated types, the two client factories and the
env schema, and never a query. The plan is `docs/plan/02-database.md`.

## Local stack

`supabase start`, `supabase db reset` (rebuilds from every migration, then seeds) and
`supabase test db` (`pnpm test:db`) are the only ways this repo applies SQL. Ports are one block
above Landmark's so both stacks run side by side: API 54431, database 54432, shadow 54430, pooler
54439, Studio 54433, Mailpit 54434, analytics 54437. Email sign-in is on and confirmations are off
locally. Docker Desktop with WSL integration for this distro is required.

The dev project is `kdplqbldohrzsewhckgl` (EU). Linking (`supabase link`), applying migrations
and enabling extensions there are the operator's steps, listed in `docs/backlog/release.md`;
nothing in this repo pushes to a linked project without being asked in the conversation.

### Seed users (local only)

| Email             | Password       | Role     |
| ----------------- | -------------- | -------- |
| `admin@va.local`  | `va-local-dev` | `admin`  |
| `member@va.local` | `va-local-dev` | `member` |

The member owns one chat session (`Probni razgovor`) with three rows (user, assistant with a
tool call, tool result) so `ai_session_history` has a chain to walk. The seed never runs against
a project. Its Croatian strings are placeholders. <!-- needs native review -->

## Tables

### `users`

One profile per auth user, created by the `on_auth_user_created` trigger on `auth.users`
(`handle_new_auth_user`, SECURITY DEFINER because the auth server's role has no grant on
`public`).

| Column         | Type        | Notes                                                                            |
| -------------- | ----------- | -------------------------------------------------------------------------------- |
| `id`           | uuid        | PK                                                                               |
| `auth_user_id` | uuid        | unique, FK `auth.users` ON DELETE CASCADE; policies compare it with `auth.uid()` |
| `email`        | text        | copied from the auth user at creation                                            |
| `display_name` | text        | the user may change it                                                           |
| `role`         | text        | `admin` or `member`, default `member`; gates tools (`requiredRoles`)             |
| `language`     | text        | `hr` or `en`, default `hr`; picks the prompt presentation and voice settings     |
| `phone_e164`   | text        | nullable, unique, E.164; reserved for WhatsApp / phone identification (Part 8)   |
| `created_at`   | timestamptz |                                                                                  |
| `updated_at`   | timestamptz | moved by the `users_set_updated_at` trigger                                      |

### `ai_sessions`

One conversation per row, owned by a user.

| Column                       | Type        | Notes                                                                            |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `id`                         | uuid        | PK                                                                               |
| `user_id`                    | uuid        | FK `users` ON DELETE CASCADE                                                     |
| `channel`                    | text        | `chat` (default), `voice`, `whatsapp`, `phone`; later channels need no migration |
| `external_id`                | text        | LiveKit room (voice), thread id (whatsapp), null for chat; unique per channel    |
| `title`                      | text        | set by the API                                                                   |
| `context_summary`            | text        | compaction seam, null until compaction exists                                    |
| `summary_through_message_id` | uuid        | FK `ai_messages` ON DELETE SET NULL; where `ai_session_history` stops            |
| `created_at`, `updated_at`   | timestamptz | `updated_at` moves on update and when a message is inserted                      |

Indexes: `(user_id, updated_at DESC)` for the history list; unique `(channel, external_id)`
where `external_id` is not null.

### `ai_messages`

One Anthropic message per row. A session is a tree through `parent_id`; the active branch is the
walk from the newest row (the leaf) to the root.

| Column                                    | Type        | Notes                                                                      |
| ----------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| `id`                                      | uuid        | PK                                                                         |
| `session_id`                              | uuid        | FK `ai_sessions` ON DELETE CASCADE                                         |
| `role`                                    | text        | the Anthropic wire role: `user` or `assistant`                             |
| `turn_kind`                               | text        | `user` (a real turn), `assistant`, `tool_result`; rate limits count `user` |
| `content`                                 | jsonb       | Anthropic content blocks; attachments will live inside this shape          |
| `parent_id`                               | uuid        | FK self ON DELETE SET NULL; null on the first row                          |
| `model`, `stop_reason`                    | text        | assistant rows                                                             |
| `input_tokens`, `output_tokens`           | integer     | assistant rows                                                             |
| `cache_read_tokens`, `cache_write_tokens` | integer     | prompt-cache counts, for cost dashboards                                   |
| `created_at`                              | timestamptz |                                                                            |

Constraint `ai_messages_role_kind`: an `assistant` row has `turn_kind = 'assistant'`; a `user`
row has `turn_kind` `user` or `tool_result`. Indexes on `(session_id, created_at)` and
`(parent_id)`. The `ai_messages_touch_session` trigger bumps the session's `updated_at` on
insert so the list sorts by activity.

### `voice_calls`

The hand-over of the caller's JWT to the voice worker, ported from Landmark. One row per live
call: `session_id` (unique, cascade), `user_id`, `call_token_hash` (SHA-256 of the opaque token,
unique; the token is never stored), `platform_call_id` (the LiveKit room, unique),
`access_token` (the caller's JWT, a live credential), `expires_at` (hard cap: min(JWT expiry,
start + 15 min)), `last_seen_at`, `created_at`. A row counts as absent once expired or idle for
3 minutes; the `voice-calls-sweep` pg_cron job deletes such rows every minute where pg_cron is
enabled (the migration skips the schedule with a notice otherwise; re-run its last block after
enabling pg_cron). The guard checks `pg_extension`, not `to_regproc('cron.schedule')`: that name
is overloaded, so `to_regproc` is NULL even with pg_cron installed.

## Functions

| Function                                    | Runs as          | Who may call                | What                                                                                                                                                             |
| ------------------------------------------- | ---------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_user_id()`                             | definer          | authenticated, service_role | the caller's `users.id` (from `auth.uid()`); the owner-scoping helper every policy uses                                                                          |
| `app_user_role()`                           | definer          | authenticated, service_role | the caller's role                                                                                                                                                |
| `set_updated_at()`                          | trigger          | —                           | `updated_at = now()` on `users` and `ai_sessions`                                                                                                                |
| `handle_new_auth_user()`                    | definer, trigger | —                           | creates the profile when an auth user is created                                                                                                                 |
| `touch_session_on_message()`                | trigger          | —                           | bumps the session on message insert                                                                                                                              |
| `ai_session_history(p_leaf_id, p_max_rows)` | invoker          | service_role only           | the active branch from a leaf, root → leaf, at most `p_max_rows` (default 200), stopping after the session's `summary_through_message_id` and including that row |

`ai_session_history` replaces Landmark's unbounded "select every row of the session". It is
service role only: the API checks that the session belongs to the caller, then calls it. It is
SECURITY INVOKER on purpose (the plan sketched DEFINER): the service role bypasses RLS already,
and if the grant is ever widened, RLS still applies. The walk never follows a `parent_id` into
another session, so a wrong pointer written by a future bug cannot pull another user's rows into
a prompt. An unknown leaf yields no rows; the API treats that as an error, never as an empty
history (invariant 10).

## RLS posture

| Table         | anon    | authenticated                                         | service_role |
| ------------- | ------- | ----------------------------------------------------- | ------------ |
| `users`       | nothing | SELECT own row; UPDATE own `display_name`, `language` | everything   |
| `ai_sessions` | nothing | SELECT own                                            | everything   |
| `ai_messages` | nothing | SELECT rows of own sessions                           | everything   |
| `voice_calls` | nothing | nothing                                               | everything   |

The grants say the same as the policies: `REVOKE ALL FROM anon, authenticated` first, then
exactly the grants above. Role changes are an admin operation through the service role; no column
grant lets a user change their own `role`, so no policy has to forbid it.

**Service role only writes (decision).** `authenticated` never inserts, updates or deletes
sessions or messages. The API is the only writer, through `createServiceClient()`, and every
such call carries an explicit `user_id` or `session_id` filter (invariant 6). The PWA reads
history directly through supabase-js under the SELECT policies. Title rename and session delete
come through the API in Part 4; if they ever move to the client they get narrow policies and a
pgTAP test in the same change.

## `@va/db`

```ts
import { createServiceClient, createUserClient, getDbEnv } from '@va/db'
import type { Database, Tables } from '@va/db'
```

- `getDbEnv()` parses `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from
  `process.env` once with zod and throws on first use if one is missing; the error names the
  variable, never a value. `parseDbEnv(map)` is the pure form; `resetDbEnvCache()` is for tests.
- `createUserClient(jwt)` uses the anon key plus `Authorization: Bearer <jwt>`, so RLS applies.
  Tools read through it (`ctx.userClient`).
- `createServiceClient()` uses the service role key. Persistence only, always with an explicit
  user or session filter (`ctx.serviceClient`).
- Both set `persistSession: false, autoRefreshToken: false`: the apps are servers.
- `database.ts` is generated. During Part 2 it came from the local stack
  (`supabase gen types typescript --local`); from now on `/db-types` (`pnpm db:types`) regenerates
  it from the linked project after a migration is applied there, and the file is committed with
  the migration.

## Tests

| File                       | Checks                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_rls_enabled`           | every table in `public` has RLS on                                                                                                                    |
| `users_self_access`        | profile created on sign-up; a user sees only their row, changes `language` and `display_name`, cannot change `role` or `email`; anon nothing; helpers |
| `ai_sessions_owner_scoped` | own sessions and messages only; no writes as authenticated; service role writes; message insert bumps the session; delete cascades; check constraints |
| `ai_session_history`       | the 7-row chain with a sibling branch: whole branch, sibling branch, `p_max_rows`, summary boundary, unknown leaf; EXECUTE only for service_role      |
| `voice_calls_service_only` | nothing for authenticated or anon; the service role runs the call lifecycle; one call per session; cascade; the sweep job where pg_cron exists        |

Each file is one transaction that rolls back. See `docs/TESTING.md` → Database tests for how to
act as a role. One local-image quirk to know: calling a function without EXECUTE as `anon` or
`authenticated` crashes the local Postgres (`DB-1`), so grant posture on functions is asserted
with `has_function_privilege`, not by calling.
