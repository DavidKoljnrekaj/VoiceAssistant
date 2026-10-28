-- ai_session_history (20261028100100_ai_sessions_and_messages.sql): from a leaf it returns the
-- active branch root -> leaf, never a sibling branch; p_max_rows keeps the newest rows; a summary
-- boundary stops the walk and is included; only the service role may call it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- Fixtures, as the database owner. One session, a chain of 7 rows m1 -> m7 and a sibling branch
-- m5b under m4:
--   m1 user -> m2 assistant -> m3 tool_result -> m4 assistant -> m5 user -> m6 assistant -> m7 user
--                                                             \-> m5b user
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000040a1', 'h@test.local');
insert into public.ai_sessions (id, user_id)
select '00000000-0000-0000-0000-0000000040b1', u.id
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000040a1';

insert into public.ai_messages (id, session_id, role, turn_kind, content, parent_id) values
  ('00000000-0000-0000-0000-0000000040c1', '00000000-0000-0000-0000-0000000040b1', 'user', 'user', '[{"type":"text","text":"1"}]', null),
  ('00000000-0000-0000-0000-0000000040c2', '00000000-0000-0000-0000-0000000040b1', 'assistant', 'assistant', '[{"type":"text","text":"2"}]', '00000000-0000-0000-0000-0000000040c1'),
  ('00000000-0000-0000-0000-0000000040c3', '00000000-0000-0000-0000-0000000040b1', 'user', 'tool_result', '[{"type":"tool_result","tool_use_id":"t1","content":"3"}]', '00000000-0000-0000-0000-0000000040c2'),
  ('00000000-0000-0000-0000-0000000040c4', '00000000-0000-0000-0000-0000000040b1', 'assistant', 'assistant', '[{"type":"text","text":"4"}]', '00000000-0000-0000-0000-0000000040c3'),
  ('00000000-0000-0000-0000-0000000040c5', '00000000-0000-0000-0000-0000000040b1', 'user', 'user', '[{"type":"text","text":"5"}]', '00000000-0000-0000-0000-0000000040c4'),
  ('00000000-0000-0000-0000-0000000040c6', '00000000-0000-0000-0000-0000000040b1', 'assistant', 'assistant', '[{"type":"text","text":"6"}]', '00000000-0000-0000-0000-0000000040c5'),
  ('00000000-0000-0000-0000-0000000040c7', '00000000-0000-0000-0000-0000000040b1', 'user', 'user', '[{"type":"text","text":"7"}]', '00000000-0000-0000-0000-0000000040c6'),
  ('00000000-0000-0000-0000-0000000040cb', '00000000-0000-0000-0000-0000000040b1', 'user', 'user', '[{"type":"text","text":"5b"}]', '00000000-0000-0000-0000-0000000040c4');

-- A second session whose first row points, wrongly, at m4 of the first session: the walk must
-- not follow a parent_id into another session.
insert into public.ai_sessions (id, user_id)
select '00000000-0000-0000-0000-0000000040b2', u.id
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000040a1';
insert into public.ai_messages (id, session_id, role, turn_kind, content, parent_id) values
  ('00000000-0000-0000-0000-0000000040d1', '00000000-0000-0000-0000-0000000040b2', 'user', 'user', '[{"type":"text","text":"x"}]', '00000000-0000-0000-0000-0000000040c4');

-- The API calls the function as the service role, after checking the session belongs to the caller.
set local role service_role;

select results_eq(
  $$ select id from public.ai_session_history('00000000-0000-0000-0000-0000000040c7') $$,
  $$ values ('00000000-0000-0000-0000-0000000040c1'::uuid), ('00000000-0000-0000-0000-0000000040c2'),
            ('00000000-0000-0000-0000-0000000040c3'), ('00000000-0000-0000-0000-0000000040c4'),
            ('00000000-0000-0000-0000-0000000040c5'), ('00000000-0000-0000-0000-0000000040c6'),
            ('00000000-0000-0000-0000-0000000040c7') $$,
  'from the leaf, the whole active branch root -> leaf, without the sibling branch'
);
select results_eq(
  $$ select id from public.ai_session_history('00000000-0000-0000-0000-0000000040cb') $$,
  $$ values ('00000000-0000-0000-0000-0000000040c1'::uuid), ('00000000-0000-0000-0000-0000000040c2'),
            ('00000000-0000-0000-0000-0000000040c3'), ('00000000-0000-0000-0000-0000000040c4'),
            ('00000000-0000-0000-0000-0000000040cb') $$,
  'from the sibling leaf, its own branch'
);
select results_eq(
  $$ select id from public.ai_session_history('00000000-0000-0000-0000-0000000040c7', 3) $$,
  $$ values ('00000000-0000-0000-0000-0000000040c5'::uuid), ('00000000-0000-0000-0000-0000000040c6'),
            ('00000000-0000-0000-0000-0000000040c7') $$,
  'p_max_rows = 3 returns the 3 newest rows, oldest first'
);
select is(
  (select turn_kind || ':' || (content->0->>'text') from public.ai_session_history('00000000-0000-0000-0000-0000000040c7', 1)),
  'user:7',
  'the rows come back whole (p_max_rows = 1 is the leaf itself)'
);
select is_empty(
  $$ select id from public.ai_session_history('00000000-0000-0000-0000-0000000040ff') $$,
  'an unknown leaf yields no rows (the API checks the session first)'
);
select is_empty(
  $$ select id from public.ai_session_history('00000000-0000-0000-0000-0000000040c7', 0) $$,
  'p_max_rows = 0 yields no rows'
);
select results_eq(
  $$ select id from public.ai_session_history('00000000-0000-0000-0000-0000000040d1') $$,
  $$ values ('00000000-0000-0000-0000-0000000040d1'::uuid) $$,
  'a parent_id into another session is not followed: the walk stays in the leaf''s session'
);

update public.ai_sessions set summary_through_message_id = '00000000-0000-0000-0000-0000000040c3'
  where id = '00000000-0000-0000-0000-0000000040b1';
select results_eq(
  $$ select id from public.ai_session_history('00000000-0000-0000-0000-0000000040c7') $$,
  $$ values ('00000000-0000-0000-0000-0000000040c3'::uuid), ('00000000-0000-0000-0000-0000000040c4'),
            ('00000000-0000-0000-0000-0000000040c5'), ('00000000-0000-0000-0000-0000000040c6'),
            ('00000000-0000-0000-0000-0000000040c7') $$,
  'with a summary boundary the walk stops there and includes the boundary row'
);

-- Signed-in users and anon may not call it, even for their own session. The grant is asserted
-- through the catalog rather than by calling the function: on the Supabase Postgres image used
-- locally (17.6), a permission-denied error on a function raised for anon or authenticated
-- segfaults the backend while the image builds its GRANT hint (docs/backlog/db.md DB-1).
reset role;
select is(
  has_function_privilege('authenticated', 'public.ai_session_history(uuid, integer)', 'EXECUTE'),
  false,
  'a signed-in user cannot execute ai_session_history'
);
select is(
  has_function_privilege('anon', 'public.ai_session_history(uuid, integer)', 'EXECUTE'),
  false,
  'anon cannot execute ai_session_history'
);
select is(
  has_function_privilege('service_role', 'public.ai_session_history(uuid, integer)', 'EXECUTE'),
  true,
  'the service role can execute ai_session_history'
);

select * from finish();
rollback;
