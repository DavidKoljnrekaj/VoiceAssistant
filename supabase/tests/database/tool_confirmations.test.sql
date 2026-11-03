-- tool_confirmations (20261103150000_tool_confirmations.sql): the write protocol's pending
-- confirmations and audit. The owner reads their own, nobody but the service role writes, the
-- consume is a conditional update that wins once, outcomes are constrained, rows follow their
-- session.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000050a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000050a2', 'other@test.local');
insert into public.ai_sessions (id, user_id, channel)
select '00000000-0000-0000-0000-0000000050b1', u.id, 'chat'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000050a1';
insert into public.tool_confirmations (id, session_id, user_id, tool, input_hash, summary, expires_at)
select '00000000-0000-0000-0000-0000000050c1', '00000000-0000-0000-0000-0000000050b1', u.id,
       'create_note', 'hash-1', 'Zabilježit ću: "test"', now() + interval '5 minutes'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000050a1';

-- The owner reads their own rows and nothing else; cannot write.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000050a1","role":"authenticated"}';
select is(
  (select outcome from public.tool_confirmations where id = '00000000-0000-0000-0000-0000000050c1'),
  'pending',
  'the owner reads their pending confirmation');
select throws_ok(
  $$ insert into public.tool_confirmations (session_id, user_id, tool, input_hash, summary, expires_at)
     values ('00000000-0000-0000-0000-0000000050b1', public.app_user_id(), 'x', 'h', 's', now()) $$,
  '42501', null, 'the owner cannot insert a confirmation');
select throws_ok($$ update public.tool_confirmations set outcome = 'executed' $$, '42501', null,
  'the owner cannot confirm by updating the row');
select throws_ok($$ delete from public.tool_confirmations $$, '42501', null,
  'the owner cannot delete a confirmation');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000050a2","role":"authenticated"}';
select is((select count(*)::int from public.tool_confirmations), 0, 'another user sees no rows');

set local role anon;
select throws_ok($$ select 1 from public.tool_confirmations $$, '42501', null, 'anon cannot read confirmations');

-- The service role consumes once: the exact conditional update the API runs
-- (apps/api/src/chat/confirmations.ts), twice. The first sets confirmed_at; the second must
-- change nothing, whatever the outcome column still says.
set local role service_role;
create function pg_temp.consume(p_hash text) returns int language plpgsql as $$
declare n int;
begin
  update public.tool_confirmations set confirmed_at = now()
    where id = '00000000-0000-0000-0000-0000000050c1' and session_id = '00000000-0000-0000-0000-0000000050b1'
      and user_id = (select user_id from public.tool_confirmations where id = '00000000-0000-0000-0000-0000000050c1')
      and tool = 'create_note' and input_hash = p_hash and outcome = 'pending'
      and confirmed_at is null and expires_at > now();
  get diagnostics n = row_count;
  return n;
end $$;
select is(pg_temp.consume('other-hash'), 0, 'a changed input does not match');
select is(pg_temp.consume('hash-1'), 1, 'the first matching consume wins');
select is(pg_temp.consume('hash-1'), 0, 'the second consume changes nothing: single use before any settle');
select is(
  (select outcome from public.tool_confirmations where id = '00000000-0000-0000-0000-0000000050c1'),
  'pending',
  'the outcome is still pending until the handler settles it');
select throws_ok(
  $$ update public.tool_confirmations set outcome = 'maybe' where id = '00000000-0000-0000-0000-0000000050c1' $$,
  '23514', null, 'an outcome outside the list is refused');
select lives_ok(
  $$ update public.tool_confirmations set outcome = 'failed', error_code = '23505', settled_at = now()
     where id = '00000000-0000-0000-0000-0000000050c1' $$,
  'the service role settles the outcome with an error code');
select lives_ok(
  $$ insert into public.tool_confirmations (session_id, user_id, tool, input_hash, summary, expires_at)
     select '00000000-0000-0000-0000-0000000050b1', user_id, 'create_note', 'hash-2', 's', now() - interval '1 second'
     from public.tool_confirmations where id = '00000000-0000-0000-0000-0000000050c1' $$,
  'the service role issues a confirmation');
select is(
  (select count(*)::int from public.tool_confirmations
     where input_hash = 'hash-2' and outcome = 'pending' and expires_at > now()),
  0,
  'an expired pending row is not consumable');

reset role;
delete from public.ai_sessions where id = '00000000-0000-0000-0000-0000000050b1';
select is((select count(*)::int from public.tool_confirmations), 0, 'deleting the session deletes its confirmations');

select * from finish();
rollback;
