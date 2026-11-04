# Release runbook: REL-1, REL-3 and REL-7 on the dev project

The operator's steps for the three open database items in `docs/backlog/release.md`: apply the
five migrations to the dev project `kdplqbldohrzsewhckgl`, schedule the `voice-calls-sweep` job,
run every after-apply check, and regenerate `packages/db/src/database.ts`. One `supabase db push`
applies all five files, so REL-1 (`users`, `ai_sessions_and_messages`, `voice_calls`), REL-3
(`demo_tables`) and REL-7 (`voice_calls_expiry_cap`) are one run with three sets of checks.
Nothing here is run by Claude: linking, pushing and generating types against a project are the
operator's steps (`docs/DB.md` → Local stack). The local stack stays as it is; this runbook never
touches it.

Written against Supabase CLI 2.99.0 and `main` at `b38e88c` (2026-11-02). The CLI's exact wording
may differ a little on a newer version; the shape of each output is what to compare. The SQL of
steps 5 and 8 to 13 was run on the local stack that day with pg_cron enabled there, and the
expected outputs below are what it printed; steps 1 to 4, 6, 7 and 14 need the project and were
not run.

## Before you start

- `supabase login` has been done on this machine, or `SUPABASE_ACCESS_TOKEN` is set. Step 1
  tells you if not.
- You have the dev project's database password (Dashboard → Project Settings → Database; reset it
  there if nobody knows it). Type it only into the CLI's prompt and into `DB_URL` below. Never
  paste it, `DB_URL`, or any token into the chat.
- `psql` is installed (`/usr/bin/psql`). The checks run in psql through the project's session
  pooler, because psql prints error codes, NOTICEs and every result set; the Dashboard's SQL
  editor shows only the last result. If you must use the SQL editor, replace `:'email'` by the
  quoted address and drop the `\set` lines.
- The working tree is clean on `main`:

```sh
git switch main && git pull && git status --short && git log -1 --oneline
supabase --version
```

Expect no output from `git status`, the commit line (record it: the results refer to it), and
`2.99.0` or newer.

Steps 1 to 8 are the CLI and the Dashboard; steps 9 to 13 are SQL through psql; step 14 is the
types. Do them in order: every SQL check needs the push, and the sweep and cap checks need the
user from step 9.

## 1. See the project

```sh
supabase projects list
```

Expect a table with the columns `LINKED | ORG ID | REFERENCE ID | NAME | REGION | CREATED AT`,
one row with `REFERENCE ID` `kdplqbldohrzsewhckgl` and an EU region, and an empty `LINKED` cell
on every row (the session-start hook confirmed `supabase/.temp/project-ref` is absent).

If it disagrees: `Access token not provided` means run `supabase login` first. If the row is
missing, your account cannot see the dev project: stop; nothing below will work.

## 2. Link

```sh
supabase link --project-ref kdplqbldohrzsewhckgl
git status --short
```

Expect the prompt `Enter your database password (or leave blank to skip):` (type it), then
`Connecting to remote database...` and `Finished supabase link.`. A `WARNING: Local config differs
from linked project` block with a diff of `[auth]` values (`site_url`, `additional_redirect_urls`)
is expected: `config.toml` describes the local stack and the hosted auth URLs are `REL-8`, done
later and by hand. Do not run `supabase config push`. `git status --short` must print nothing:
the link lives in the ignored `supabase/.temp/`.

If it disagrees: a wrong password fails with an authentication error; re-run. A warning that the
local `db.major_version` (17) differs from the project's Postgres version is a decision, not a
runbook step: stop and paste it. If `git status` shows `supabase/config.toml` changed, paste
`git diff supabase/config.toml` and leave it uncommitted.

## 3. What the project has

```sh
supabase migration list --linked
```

Expect a table `LOCAL | REMOTE | TIME (UTC)` with five rows, each with a version in `LOCAL` and
an empty `REMOTE`:

```
20261028100000
20261028100100
20261028100200
20261029100000
20261102100000
```

If it disagrees: a version in `REMOTE` means someone already applied something to the dev
project. A `REMOTE` version that is not in `LOCAL` means the project's history has a file this
repo does not: stop and paste the table. If every row has both columns filled, the migrations
are already applied; skip to step 7.

## 4. Dry run

```sh
supabase db push --dry-run
```

Expect `Connecting to remote database...`, then `Would push these migrations:` followed by one
line per file, in this order, and `Finished supabase db push.`:

```
20261028100000_users.sql
20261028100100_ai_sessions_and_messages.sql
20261028100200_voice_calls.sql
20261029100000_demo_tables.sql
20261102100000_voice_calls_expiry_cap.sql
```

If it disagrees: fewer files than five, or any other file, is the same situation as a surprising
step 3: stop and paste. `Remote database is up to date.` means nothing is pending; go to step 7.

## 5. Enable pg_cron before the push

Dashboard → Database → Extensions → search `pg_cron` → enable it (the schema it proposes is
fine). Enabling it before the push lets the `voice_calls` migration schedule the sweep itself;
the DO block in step 8 is then only a fallback.

Set up psql for the checks. Dashboard → Connect → **Session pooler** (port 5432, IPv4), copy the
URI, put the password in it, and keep it in the shell only:

```sh
export DB_URL='<the session pooler URI with the password>'
psql "$DB_URL" -X -c "select extname, extversion from pg_extension where extname = 'pg_cron';"
```

Expect one row, `pg_cron` with a version such as `1.6.x`.

If it disagrees: zero rows means the toggle did not take; try the SQL editor as `postgres`:
`create extension if not exists pg_cron;`.

## 6. Push

```sh
supabase db push
```

Expect the list of the five files again with a `[Y/n]` confirmation (answer `y`), then
`Applying migration 20261028100000_users.sql...` through
`Applying migration 20261102100000_voice_calls_expiry_cap.sql...` and
`Finished supabase db push.`. Between them come the same `NOTICE (00000): trigger … does not
exist, skipping` and `policy … does not exist, skipping` lines the local `supabase db reset`
prints: the migrations are idempotent and drop before creating. The push does not run
`supabase/seed.sql` (the seed is local only), so the dev project gets no demo rows.

The line `NOTICE (00000): pg_cron is not available; skipping the voice-calls-sweep schedule.`
must **not** appear. If it does, step 5 did not take; step 8 re-runs the block.

If it disagrees: an error inside one file stops the push with the file name and the Postgres
error; the files before it are applied and recorded, the failed one is not. Paste the whole
output and stop: the fix is a new migration or a repair, written in a session, never a hand edit
on the project.

## 7. Confirm the history

```sh
supabase migration list --linked
```

Expect the five rows with both `LOCAL` and `REMOTE` filled and a `TIME (UTC)` of now.

## 8. The sweep is scheduled

```sh
psql "$DB_URL" -X -c "select jobname, schedule, active, command from cron.job where jobname = 'voice-calls-sweep';"
```

Expect one row: `voice-calls-sweep | * * * * * | t | DELETE FROM public.voice_calls WHERE
expires_at < now() OR last_seen_at < now() - interval '3 minutes'` (the command wraps over three
lines).

If it disagrees: zero rows means the push skipped the schedule. Re-run the migration's last
block, which unschedules and schedules again, so running it twice is harmless:

```sql
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
```

Then run the `cron.job` query again. If the NOTICE shows, pg_cron is still not enabled (step 5).

## 9. A sign-up creates a profile

Dashboard → Authentication → Users → Add user → Create new user: an email you control, a
password, and **Auto Confirm User** on. Then:

```sh
psql "$DB_URL" -X -c "select id, auth_user_id, email, role, language, created_at from public.users order by created_at desc limit 5;"
```

Expect a row with that email, `role = member`, `language = hr`, created just now. Keep the
address: the next steps use it. This user is also the `E2E_EMAIL` / `E2E_PASSWORD` candidate for
`REL-6` (c).

If it disagrees: no row means the `on_auth_user_created` trigger did not fire. Check that
`20261028100000_users.sql` is in step 7's table and paste the Dashboard's user row (id, created
at); stop.

## 10. The sweep really deletes

Open psql and keep it open for steps 10 to 13 (`\q` ends it):

```sh
psql "$DB_URL" -X
```

Paste the block, with your address on the first line. It creates three voice sessions and three
`voice_calls` rows as the service role: one already expired, one idle for four minutes, one live.
The tokens are placeholders, never real credentials.

```sql
\set email 'you@example.com'
\set VERBOSITY verbose
begin;
set local role service_role;
with u as (
  select id from public.users where email = :'email'
),
s as (
  insert into public.ai_sessions (user_id, channel, external_id, title)
  select u.id, 'voice', 'rel1-' || k, 'REL-1 sweep check'
  from u, unnest(array['expired', 'idle', 'live']) as k
  returning id, user_id, external_id
)
insert into public.voice_calls
  (session_id, user_id, call_token_hash, platform_call_id, access_token, expires_at, last_seen_at)
select s.id, s.user_id, 'rel1-hash-' || s.external_id, s.external_id, 'rel1-not-a-jwt',
  case s.external_id when 'rel1-expired' then now() - interval '1 minute' else now() + interval '10 minutes' end,
  case s.external_id when 'rel1-idle' then now() - interval '4 minutes' else now() end
from s;
commit;
select s.external_id, c.expires_at < now() as expired, c.last_seen_at < now() - interval '3 minutes' as idle
from public.voice_calls c join public.ai_sessions s on s.id = c.session_id
where s.external_id like 'rel1-%' order by 1;
```

Expect `BEGIN`, `SET`, `INSERT 0 3`, `COMMIT` and three rows:

```
 external_id  | expired | idle
--------------+---------+------
 rel1-expired | t       | f
 rel1-idle    | f       | t
 rel1-live    | f       | f
```

Then wait for the next minute and look again (the first statement sleeps 70 seconds):

```sql
select pg_sleep(70);
select s.external_id
from public.voice_calls c join public.ai_sessions s on s.id = c.session_id
where s.external_id like 'rel1-%';
select status, start_time, end_time, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'voice-calls-sweep')
order by start_time desc limit 3;
```

Expect exactly one `external_id`, `rel1-live`, and `cron.job_run_details` rows with
`status = succeeded` and `return_message = DELETE 2` on the newest (earlier runs say `DELETE 0`).

Clean up (the live call goes with its session):

```sql
delete from public.ai_sessions where external_id like 'rel1-%';
select count(*) from public.voice_calls c join public.ai_sessions s on s.id = c.session_id where s.external_id like 'rel1-%';
```

Expect `DELETE 3` and `0`.

If it disagrees: `INSERT 0 0` means the email matched no `public.users` row (step 9). Three rows
still there after the wait, with `job_run_details` empty, means the job never ran: step 8. Rows
still there with a `failed` run: paste its `return_message`; a permission error there means the
job runs as a role that cannot delete, which is a migration fix. `23514` on the insert means the
`idle` row's `expires_at` tripped the cap, which cannot happen with these values; paste it.

## 11. REL-7: the expiry cap holds

```sql
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint where conname = 'voice_calls_expires_within_cap';
```

Expect one row: `CHECK ((expires_at <= (created_at + '00:15:00'::interval)))`.

```sql
begin;
set local role service_role;
with s as (
  insert into public.ai_sessions (user_id, channel, external_id, title)
  select id, 'voice', 'rel7-cap', 'REL-7 cap check' from public.users where email = :'email'
  returning id, user_id
)
insert into public.voice_calls (session_id, user_id, call_token_hash, platform_call_id, access_token, expires_at)
select id, user_id, 'rel7-hash', 'rel7-cap', 'rel7-not-a-jwt', now() + interval '16 minutes' from s;
rollback;
```

Expect the insert refused with
`ERROR:  23514: new row for relation "voice_calls" violates check constraint "voice_calls_expires_within_cap"`
(a `DETAIL: Failing row contains (…)` line follows), then `ROLLBACK`. Nothing is left behind.

If it disagrees: `INSERT 0 1` means the CHECK is missing even though step 7 lists
`20261102100000`; paste both. A `23503` foreign-key error means the email matched no user.

## 12. REL-3: the demo tables

As the signed-in user from step 9 (the claims are set the way the pgTAP tests do it):

```sql
select auth_user_id as sub from public.users where email = :'email' \gset
select format('{"sub":"%s","role":"authenticated"}', :'sub') as claims \gset
begin;
set local role authenticated;
set local request.jwt.claims = :'claims';
select count(*) from public.demo_items;
insert into public.demo_items (name, category, price) values ('rel3', 'rel3', 1);
rollback;
```

Expect `count` `0` (the seed is local only; the dev project has no demo rows until someone loads
them), then `ERROR:  42501: permission denied for table demo_items`, then `ROLLBACK`.

If it disagrees: `42501` on the `select` means the SELECT grant or policy is missing; `INSERT 0 1`
means a signed-in user can write the catalogue. Both are migration bugs: paste and stop.

## 13. DB-1 on the project's image (optional, last)

`docs/backlog/db.md` DB-1: on the local image a function call without EXECUTE as `anon` kills
the backend instead of raising `42501` (it reproduced again on 2026-11-02, image
`postgres:17.6.1.106`). If it also reproduces here, the dev database restarts and is unreachable
for a few seconds, which is why this is the last step and optional. Skip it and say so if you
would rather not.

```sql
select version();
create function public.db1_probe() returns int language sql as 'select 1';
revoke all on function public.db1_probe() from public, anon, authenticated;
begin;
set local role anon;
select public.db1_probe();
rollback;
drop function public.db1_probe();
```

Fixed: `ERROR:  42501: permission denied for function db1_probe`, `ROLLBACK`, `DROP FUNCTION`.
Reproduces: `server closed the connection unexpectedly` on the `select`. Then reconnect (`\c`)
after a few seconds and run the `drop function` line again; it must print `DROP FUNCTION`. Record
the `version()` line either way.

Leave psql with `\q`.

## 14. The types

In a Claude Code session, type `/db-types`. It names the linked project (`kdplqbldohrzsewhckgl`);
answer yes. By hand it is the same thing:

```sh
pnpm db:types
git diff --stat packages/db/src/database.ts
pnpm typecheck
```

Expect `packages/db/src/database.ts` changed by roughly a hundred added lines and nothing
removed: `demo_items` and `demo_notes` appear under `Tables` between `ai_sessions` and `users`,
`demo_notes` with two `Relationships` entries (`demo_notes_item_id_fkey` to `demo_items`,
`demo_notes_user_id_fkey` to `users`). The REL-7 CHECK changes no type. `pnpm typecheck` passes
with the hand-written `DemoDatabase` cast still in place. Do not drop the cast or commit here:
the next session does both (below).

If it disagrees: a diff that deletes the whole file means the generator failed and the shell
redirect truncated the file before it ran. Restore it with
`git checkout -- packages/db/src/database.ts`, run `supabase gen types typescript --linked --schema public | head`
to see the error, and paste that. No diff at all means the link points elsewhere or step 6 did
not apply: `cat supabase/.temp/project-ref`.

## Enrolling a caller (Part 11, after `REL-10`)

The phone channel refuses every number it does not know. Enrolment is this SQL as the service
role, never over the phone, once `20261103120000_phone_channel.sql` is on the project.

1. The caller must be a user with an email (the magic link that gives the call its session is
   minted for it): sign them up in the PWA first, or confirm the `public.users` row exists.
2. Make the PIN hash on your machine (the PIN is typed into the prompt, nothing but the hash
   is printed; choose 4 to 6 digits and tell the caller in person):

```sh
pnpm --filter @va/voice pin-hash
```

3. In psql through the pooler (as in step 10 above), with the caller's email, their number in
   E.164 (`+385…`, no spaces) and the hash from step 2:

```sql
\set email 'caller@example.hr'
\set phone '+385911234567'
\set hash 'scrypt$16384$8$1$…$…'
insert into public.voice_caller_identities (user_id, phone_e164, label, pin_hash)
select u.id, :'phone', 'mobitel', :'hash' from public.users u where u.email = :'email'
returning id, phone_e164, label, active;
```

Expect one row back. A second active row for the same number is refused (`23505`); to move a
number to another user set `active = false` on the old row first. To reset a locked number:
`update public.voice_caller_identities set pin_failed_attempts = 0, pin_locked_until = null where phone_e164 = :'phone';`.
To change a PIN, update `pin_hash` with a new hash. To revoke a caller, set `active = false`
(their sessions keep pointing at the row) or delete the row.

## Connecting Outlook (Part 13a: `REL-12`, `REL-14`, `REL-13`)

For an operator who has not used Entra before. Do it after the administrator's reply to
`docs/requests/entra-admin-request.md` (tenant id, client id, the secret by a one-time link,
consent granted). Nothing here needs the administrator again.

**A. The database (`REL-12`).** `supabase db push` applies
`20261104100000_user_integrations.sql` to the dev project, as in steps 4, 6 and 7 above. Then
the after-apply check of `REL-12` in `docs/backlog/release.md`, then `/db-types` and commit
`packages/db/src/database.ts`.

**B. Supabase Auth (`REL-14`).** Supabase Dashboard → the project → **Authentication** →
**Sign In / Providers**:

1. Under **User Signups**, switch **Allow new users to sign up** off. Save.
2. Under **Email**, keep **Confirm email** on. Save.
3. Users from now on are added by **Authentication → Users → Add user → Send invitation**.
4. Each pilot user's assistant email must be exactly their Microsoft work address (their UPN,
   what they type at the Microsoft sign-in): **Authentication → Users**, the **Email** column.
   A different address is refused at connect as `account_mismatch`.

Check: the `curl` of `REL-14` answers `422` `signup_disabled`.

**C. The key.** On your machine: `printf 'k1:%s\n' "$(openssl rand -base64 32)"`. Keep the output
in your password manager as "Asistent INTEGRATIONS_KEY (dev)". The API and the worker get the same
value. Losing it disconnects everyone (they reconnect); it is never sent to anyone.

**D. Local env (`REL-13`).** In `apps/api/.env` (copy `apps/api/env.example` if it does not
exist), fill:

```
MS_TENANT_ID=<Directory (tenant) ID from the admin>
MS_CLIENT_ID=<Application (client) ID from the admin>
MS_CLIENT_SECRET=<the secret value from the one-time link>
MS_REDIRECT_URI=http://localhost:3000/integrations/microsoft/callback
INTEGRATIONS_KEY=<the key from C>
WEB_APP_URL=http://localhost:5173
```

In `apps/voice/.env` the first three and `INTEGRATIONS_KEY`, the same values. Start the api and
the web (`pnpm --filter @va/api dev`, `pnpm --filter @va/web dev`); the api's `listening` line
says `"microsoft":"configured"`.

**E. The first connect.** In the PWA: the gear icon (Postavke) → **Poveži Outlook** → Microsoft's
page → pick the work account → back on Postavke with "Outlook je povezan." and
"Povezano: <your address>". Expect the address you sign in to the assistant with. If it says
"Prijavili ste se drugim Microsoftovim računom", the Microsoft account was not the one whose
address the assistant account has (B.4). As the service role in the SQL editor:
`select status, left(refresh_token_enc, 3) from user_integrations` gives `active`, `k1:`. Then
**Odspoji** → confirm → "Outlook nije povezan."; the same query gives `revoked` and null.

**F. Production, with `REL-9`.** As the app's owner, Entra admin center (entra.microsoft.com) →
**Identity** → **Applications** → **App registrations** → **All applications** → `Asistent` →
**Authentication** → under **Web**, **Add URI** →
`https://API_HOST/integrations/microsoft/callback` (your real API host) → **Save**. On the VM,
add to `/etc/va/api.env` the six variables with `MS_REDIRECT_URI` set to that address and
`WEB_APP_URL` to the Vercel origin, and to `/etc/va/voice.env` the four; a production
`INTEGRATIONS_KEY` of its own (C again). `docker compose -f deploy/compose.prod.yml up -d`.

**G. Later, as the owner, without the administrator.**

- **Another user:** Entra admin center → **Identity** → **Applications** → **Enterprise
  applications** → `Asistent` → **Users and groups** → **Add user/group** → pick them → **Assign**;
  and invite them in Supabase (B.3) with their work address.
- **The secret before it expires** (24 months; the date came with the admin's reply): App
  registrations → `Asistent` → **Certificates & secrets** → **New client secret** (24 months) →
  copy the value at once → set `MS_CLIENT_SECRET` on both hosts and restart → delete the old
  secret. An expired secret shows as `microsoft refused the client` error lines.
- **Rotating the key:** a new key first, the old after a comma (`k2:…,k1:…`) on both hosts,
  restart; drop `k1` after 90 days.

## Pasting the results back

Paste one message into the next session, in this shape, one section per step, the terminal
output verbatim inside the fences (no password, no `DB_URL`, no token; none of the expected
outputs contain one). A step you skipped gets the word `skipped` and why.

```
REL-1 / REL-3 / REL-7 run on <date>, main at <commit>, CLI <version>

## 1 projects list
<output>
## 2 link
<output, plus `git status --short` and the config diff if any>
## 3 migration list (before)
## 4 dry run
## 5 pg_cron
## 6 push
## 7 migration list (after)
## 8 cron.job
## 9 users row
## 10 sweep: fixtures, after the wait, job_run_details, cleanup
## 11 cap: constraint row, the refused insert
## 12 demo tables: count, the refused insert
## 13 DB-1: version(), fixed / reproduces / skipped
## 14 types: `git diff --stat`, `pnpm typecheck` result
```

The next session then, on a `chore/release-rel-1` branch off `main`:

- ticks REL-1, REL-3 and REL-7 in `docs/backlog/release.md` with the date and what was seen,
  and records step 13 under DB-1 in `docs/backlog/db.md`;
- drops the `DemoDatabase` cast in `packages/tools-demo/src/demo-db.ts` so the pack reads
  `demo_items` and `demo_notes` through `@va/db`'s generated `Database` (REL-3), with
  `pnpm typecheck` and `pnpm test` green;
- commits the regenerated `packages/db/src/database.ts` with the backlog change and the cast
  removal, and runs `/done`.

If a step disagreed, paste what you have up to it; the session fixes the cause (a migration, a
doc, or a runbook correction) before the rest is run.
