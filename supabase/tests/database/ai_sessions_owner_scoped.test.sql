-- ai_sessions and ai_messages (20261028100100_ai_sessions_and_messages.sql): a signed-in user
-- reads their own sessions and messages and nothing else, and writes nothing; the service role
-- writes; a new message bumps its session; deleting a session takes its messages with it; the
-- check constraints hold the row shape.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Fixtures, as the database owner: users A and B, one session each with one message each.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000020a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000020a2', 'b@test.local');

insert into public.ai_sessions (id, user_id, title, updated_at)
select '00000000-0000-0000-0000-0000000020b1', u.id, 'A''s session', now() - interval '1 hour'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000020a1';
insert into public.ai_sessions (id, user_id, title, updated_at)
select '00000000-0000-0000-0000-0000000020b2', u.id, 'B''s session', now() - interval '1 hour'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000020a2';

alter table public.ai_messages disable trigger ai_messages_touch_session;
insert into public.ai_messages (id, session_id, role, turn_kind, content) values
  ('00000000-0000-0000-0000-0000000020c1', '00000000-0000-0000-0000-0000000020b1', 'user', 'user', '[{"type":"text","text":"a"}]'),
  ('00000000-0000-0000-0000-0000000020c2', '00000000-0000-0000-0000-0000000020b2', 'user', 'user', '[{"type":"text","text":"b"}]');
alter table public.ai_messages enable trigger ai_messages_touch_session;

-- Row shape.
select throws_ok(
  $$ insert into public.ai_messages (session_id, role, turn_kind, content)
     values ('00000000-0000-0000-0000-0000000020b1', 'user', 'assistant', '[]') $$,
  '23514', null,
  'a user row cannot carry turn_kind assistant'
);
select throws_ok(
  $$ insert into public.ai_messages (session_id, role, turn_kind, content)
     values ('00000000-0000-0000-0000-0000000020b1', 'assistant', 'tool_result', '[]') $$,
  '23514', null,
  'an assistant row cannot carry turn_kind tool_result'
);
select throws_ok(
  $$ update public.ai_sessions set channel = 'telegram' where id = '00000000-0000-0000-0000-0000000020b1' $$,
  '23514', null,
  'channel accepts only chat, voice, whatsapp and phone'
);
update public.ai_sessions set channel = 'voice', external_id = 'room-1' where id = '00000000-0000-0000-0000-0000000020b1';
select throws_ok(
  $$ update public.ai_sessions set channel = 'voice', external_id = 'room-1' where id = '00000000-0000-0000-0000-0000000020b2' $$,
  '23505', null,
  'one external id per channel'
);
-- That update moved b1's updated_at to now(); age it again so the bump below is observable.
alter table public.ai_sessions disable trigger ai_sessions_set_updated_at;
update public.ai_sessions set updated_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000020b1';
alter table public.ai_sessions enable trigger ai_sessions_set_updated_at;
select is(
  (select updated_at = now() from public.ai_sessions where id = '00000000-0000-0000-0000-0000000020b1'),
  false,
  'setup: b1 is old again before the message insert'
);

-- As A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000020a1","role":"authenticated"}';

select results_eq(
  $$ select id from public.ai_sessions $$,
  $$ values ('00000000-0000-0000-0000-0000000020b1'::uuid) $$,
  'a signed-in user sees exactly their own sessions'
);
select results_eq(
  $$ select id from public.ai_messages $$,
  $$ values ('00000000-0000-0000-0000-0000000020c1'::uuid) $$,
  'a signed-in user sees exactly the messages of their own sessions'
);
select throws_ok(
  $$ insert into public.ai_sessions (user_id) values (public.app_user_id()) $$,
  '42501', null,
  'a signed-in user cannot create a session directly (the API does)'
);
select throws_ok(
  $$ insert into public.ai_messages (session_id, role, turn_kind, content)
     values ('00000000-0000-0000-0000-0000000020b1', 'user', 'user', '[]') $$,
  '42501', null,
  'a signed-in user cannot write messages'
);
select throws_ok(
  $$ update public.ai_sessions set title = 'renamed' $$,
  '42501', null,
  'a signed-in user cannot rename a session directly (the API does)'
);
select throws_ok(
  $$ delete from public.ai_sessions $$,
  '42501', null,
  'a signed-in user cannot delete a session directly (the API does)'
);
select throws_ok(
  $$ delete from public.ai_messages $$,
  '42501', null,
  'a signed-in user cannot delete messages'
);

set local role anon;
select throws_ok($$ select 1 from public.ai_sessions $$, '42501', null, 'anon cannot read sessions');
select throws_ok($$ select 1 from public.ai_messages $$, '42501', null, 'anon cannot read messages');

-- As the service role: the only writer.
set local role service_role;
select lives_ok(
  $$ insert into public.ai_sessions (id, user_id)
     select '00000000-0000-0000-0000-0000000020b3', user_id from public.ai_sessions where id = '00000000-0000-0000-0000-0000000020b1' $$,
  'the service role creates sessions'
);
select lives_ok(
  $$ insert into public.ai_messages (id, session_id, role, turn_kind, content, parent_id)
     values ('00000000-0000-0000-0000-0000000020c3', '00000000-0000-0000-0000-0000000020b1', 'assistant', 'assistant',
             '[{"type":"text","text":"odgovor"}]', '00000000-0000-0000-0000-0000000020c1') $$,
  'the service role writes messages'
);
select is(
  (select updated_at = now() from public.ai_sessions where id = '00000000-0000-0000-0000-0000000020b1'),
  true,
  'a new message bumps its session''s updated_at'
);
select is(
  (select updated_at = now() from public.ai_sessions where id = '00000000-0000-0000-0000-0000000020b2'),
  false,
  'and leaves other sessions alone'
);
update public.ai_sessions set title = 'renamed by the API' where id = '00000000-0000-0000-0000-0000000020b2';
select is(
  (select title || ' @now=' || (updated_at = now())::text from public.ai_sessions where id = '00000000-0000-0000-0000-0000000020b2'),
  'renamed by the API @now=true',
  'an update of a session moves its updated_at'
);
delete from public.ai_sessions where id = '00000000-0000-0000-0000-0000000020b1';
reset role;
select is(
  (select count(*)::int from public.ai_messages where session_id = '00000000-0000-0000-0000-0000000020b1'),
  0,
  'deleting a session deletes its messages'
);

select * from finish();
rollback;
