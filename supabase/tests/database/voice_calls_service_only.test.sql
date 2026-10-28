-- voice_calls (20261028100200_voice_calls.sql): the table holds a live JWT, so no signed-in user
-- or anon may read or write it; the service role does everything; the sweep job exists wherever
-- pg_cron is installed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- Fixtures, as the database owner.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000030a1', 'v@test.local');
insert into public.ai_sessions (id, user_id, channel, external_id)
select '00000000-0000-0000-0000-0000000030b1', u.id, 'voice', 'room-1'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000030a1';
insert into public.voice_calls (session_id, user_id, call_token_hash, platform_call_id, access_token, expires_at)
select '00000000-0000-0000-0000-0000000030b1', u.id, 'hash-1', 'room-1', 'jwt-1', now() + interval '15 minutes'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000030a1';

-- Even the caller of the session, signed in, cannot see or touch voice_calls.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000030a1","role":"authenticated"}';
select throws_ok($$ select access_token from public.voice_calls $$, '42501', null,
  'a signed-in user cannot read voice_calls (the stored JWT)');
select throws_ok(
  $$ insert into public.voice_calls (session_id, user_id, call_token_hash, access_token, expires_at)
     values ('00000000-0000-0000-0000-0000000030b1', public.app_user_id(), 'hash-2', 'jwt-2', now()) $$,
  '42501', null,
  'a signed-in user cannot insert into voice_calls');
select throws_ok($$ update public.voice_calls set last_seen_at = now() $$, '42501', null,
  'a signed-in user cannot update voice_calls');
select throws_ok($$ delete from public.voice_calls $$, '42501', null,
  'a signed-in user cannot delete from voice_calls');

set local role anon;
select throws_ok($$ select 1 from public.voice_calls $$, '42501', null, 'anon cannot read voice_calls');

-- The service role runs the call lifecycle: look up, refresh, hang up.
set local role service_role;
select is(
  (select access_token from public.voice_calls where call_token_hash = 'hash-1' and platform_call_id = 'room-1'),
  'jwt-1',
  'the service role reads a call by token hash and room'
);
select lives_ok(
  $$ update public.voice_calls set access_token = 'jwt-1b', last_seen_at = now() where call_token_hash = 'hash-1' $$,
  'the service role refreshes a call'
);
select throws_ok(
  $$ insert into public.voice_calls (session_id, user_id, call_token_hash, access_token, expires_at)
     select session_id, user_id, 'hash-2', 'jwt-2', now() from public.voice_calls where call_token_hash = 'hash-1' $$,
  '23505', null,
  'one call per session'
);
reset role;
select is(
  (select count(*)::int from public.voice_calls where platform_call_id = 'room-1'),
  1,
  'the row is still there after the refused writes'
);

-- Hang-up deletes the row; the next call inserts a new one.
set local role service_role;
select lives_ok(
  $$ delete from public.voice_calls where call_token_hash = 'hash-1' $$,
  'the service role deletes a call on hang-up'
);
select is((select count(*)::int from public.voice_calls), 0, 'and the row is gone');
select lives_ok(
  $$ insert into public.voice_calls (session_id, user_id, call_token_hash, platform_call_id, access_token, expires_at)
     select '00000000-0000-0000-0000-0000000030b1', u.id, 'hash-3', 'room-3', 'jwt-3', now() + interval '15 minutes'
     from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000030a1' $$,
  'the service role creates a call'
);
reset role;
delete from public.ai_sessions where id = '00000000-0000-0000-0000-0000000030b1';
select is(
  (select count(*)::int from public.voice_calls where call_token_hash = 'hash-3'),
  0,
  'deleting the session deletes its call'
);

-- The sweep is scheduled wherever pg_cron exists; the local stack has no pg_cron, so skip there.
-- plpgsql resolves cron.job only on the branch it takes, so the reference is safe without it.
-- (pg_extension, not to_regproc: cron.schedule is overloaded, so to_regproc is always NULL.)
create function pg_temp.sweep_check() returns text language plpgsql as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return skip('pg_cron is not installed here; the sweep is checked after applying to a project', 1);
  end if;
  return is(
    (select count(*)::int from cron.job where jobname = 'voice-calls-sweep' and schedule = '* * * * *'),
    1,
    'the voice-calls-sweep job runs every minute'
  );
end $$;
select pg_temp.sweep_check();

select * from finish();
rollback;
