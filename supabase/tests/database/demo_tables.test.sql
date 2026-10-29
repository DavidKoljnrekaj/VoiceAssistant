-- demo_items and demo_notes (20261029100000_demo_tables.sql, CORE-2): every signed-in user reads
-- the whole catalogue and writes nothing to it; notes are inserted as oneself and read back by
-- their owner only; anon sees nothing; the service role does everything.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fixtures, as the database owner: two users, two items, one note of the second user.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000040a1', 'd1@test.local'),
  ('00000000-0000-0000-0000-0000000040a2', 'd2@test.local');
insert into public.demo_items (id, name, category, price, description, updated_at) values
  ('00000000-0000-0000-0000-0000000040c1', 'Radni stol', 'namještaj', 320.00, 'Opis stola', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000040c2', 'Stolna lampa', 'namještaj', 49.90, null, now() - interval '1 day');
insert into public.demo_notes (id, user_id, item_id, text)
select '00000000-0000-0000-0000-0000000040d2', u.id, '00000000-0000-0000-0000-0000000040c1', 'tuđa bilješka'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000040a2';
-- The second user's profile id, for the cross-user insert below (RLS hides the row itself).
select set_config('test.user2', u.id::text, true) from public.users u
where u.auth_user_id = '00000000-0000-0000-0000-0000000040a2';

-- The first user, signed in: reads the catalogue, cannot write it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000040a1","role":"authenticated"}';
select is(
  (select count(*)::int from public.demo_items
   where id in ('00000000-0000-0000-0000-0000000040c1', '00000000-0000-0000-0000-0000000040c2')),
  2,
  'a signed-in user reads every catalogue item (the seed adds its own)'
);
select is(
  (select price from public.demo_items where id = '00000000-0000-0000-0000-0000000040c2'),
  49.90,
  'with its price'
);
select throws_ok(
  $$ insert into public.demo_items (name, category, price) values ('Kutija', 'promo', 1) $$,
  '42501', null,
  'a signed-in user cannot insert a catalogue item'
);
select throws_ok($$ update public.demo_items set price = 1 $$, '42501', null,
  'a signed-in user cannot update the catalogue');
select throws_ok($$ delete from public.demo_items $$, '42501', null,
  'a signed-in user cannot delete from the catalogue');

-- Notes: as oneself only, and only one's own come back.
select lives_ok(
  $$ insert into public.demo_notes (user_id, item_id, text)
     values (public.app_user_id(), '00000000-0000-0000-0000-0000000040c1', 'moja bilješka') $$,
  'a signed-in user inserts a note as themselves'
);
select throws_ok(
  $$ insert into public.demo_notes (user_id, item_id, text)
     values (current_setting('test.user2')::uuid, '00000000-0000-0000-0000-0000000040c1', 'podmetnuta') $$,
  '42501', null,
  'a note for another user is refused'
);
select is(
  (select array_agg(text order by text) from public.demo_notes),
  array['moja bilješka'],
  'only the user''s own notes come back'
);
select throws_ok($$ update public.demo_notes set text = 'x' $$, '42501', null,
  'a signed-in user cannot update notes');
select throws_ok($$ delete from public.demo_notes $$, '42501', null,
  'a signed-in user cannot delete notes');

-- The second user sees their own note, not the first user's.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000040a2","role":"authenticated"}';
select is(
  (select array_agg(text order by text) from public.demo_notes),
  array['tuđa bilješka'],
  'another user sees only their own notes'
);

set local role anon;
select throws_ok($$ select 1 from public.demo_items $$, '42501', null, 'anon cannot read the catalogue');
select throws_ok($$ select 1 from public.demo_notes $$, '42501', null, 'anon cannot read notes');

-- The service role maintains the catalogue; updated_at moves.
set local role service_role;
select lives_ok(
  $$ update public.demo_items set price = 299.00 where id = '00000000-0000-0000-0000-0000000040c1' $$,
  'the service role updates the catalogue'
);
select ok(
  (select updated_at > now() - interval '1 minute' from public.demo_items where id = '00000000-0000-0000-0000-0000000040c1'),
  'updated_at moves on update'
);
reset role;

-- Deleting an item takes its notes with it.
delete from public.demo_items where id = '00000000-0000-0000-0000-0000000040c1';
select is((select count(*)::int from public.demo_notes), 0, 'deleting an item deletes its notes');

select * from finish();
rollback;
