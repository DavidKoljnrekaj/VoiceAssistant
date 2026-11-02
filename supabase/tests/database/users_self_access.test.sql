-- users (20261028100000_users.sql): a profile appears when an auth user is created; a signed-in
-- user sees only their own row, may change language and display_name, may not change role, and
-- sees nothing of anyone else; anon sees nothing and cannot call the helpers; the helpers answer
-- for the caller and answer null for a signed-in user without a profile; creating a profile twice
-- keeps the first (DB-3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Fixtures, as the database owner. The sign-up trigger creates the profiles.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000010a1', 'a@test.local'),
  ('00000000-0000-0000-0000-0000000010a2', 'b@test.local');

select is(
  (select email from public.users where auth_user_id = '00000000-0000-0000-0000-0000000010a1'),
  'a@test.local',
  'creating an auth user creates a member profile with the email'
);
select is(
  (select role || '/' || language from public.users where auth_user_id = '00000000-0000-0000-0000-0000000010a1'),
  'member/hr',
  'a new profile is a member speaking Croatian'
);
select throws_ok(
  $$ update public.users set phone_e164 = '0911234567' where auth_user_id = '00000000-0000-0000-0000-0000000010a1' $$,
  '23514', null,
  'a phone number must be E.164'
);
select throws_ok(
  $$ update public.users set role = 'director' where auth_user_id = '00000000-0000-0000-0000-0000000010a1' $$,
  '23514', null,
  'only admin and member are roles'
);

-- DB-3: handle_new_auth_user's ON CONFLICT DO NOTHING path keeps an existing profile as it is.
-- The real trigger fires on INSERT, and a profile cannot exist before its auth row (FK), so the
-- function is fired again here through a temporary UPDATE trigger on the same auth row.
update public.users set display_name = 'Postojeći profil' where auth_user_id = '00000000-0000-0000-0000-0000000010a1';
create trigger test_refire_new_auth_user
  after update on auth.users
  for each row execute function public.handle_new_auth_user();
select lives_ok(
  $$ update auth.users set updated_at = now() where id = '00000000-0000-0000-0000-0000000010a1' $$,
  'DB-3: handle_new_auth_user fired for an auth user that already has a profile does not raise'
);
drop trigger test_refire_new_auth_user on auth.users;
select is(
  (select count(*)::int from public.users where auth_user_id = '00000000-0000-0000-0000-0000000010a1'),
  1,
  'DB-3: there is still exactly one profile for that auth user'
);
select is(
  (select display_name from public.users where auth_user_id = '00000000-0000-0000-0000-0000000010a1'),
  'Postojeći profil',
  'DB-3: and the existing profile is unchanged'
);

-- DB-3: a valid JWT without a profile (the row was removed after sign-up). The helpers answer
-- null, so every owner-scoped policy matches nothing; the API answers 403 no_profile.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000010a3', 'c@test.local');
delete from public.users where auth_user_id = '00000000-0000-0000-0000-0000000010a3';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000010a3","role":"authenticated"}';
select is(public.app_user_id(), null, 'DB-3: app_user_id() is null for a signed-in user without a profile');
select is(public.app_user_role(), null, 'DB-3: app_user_role() is null for a signed-in user without a profile');
select is_empty(
  $$ select id from public.users $$,
  'DB-3: a signed-in user without a profile sees no profile at all'
);
reset role;

-- Age both rows so the updated_at trigger is observable (now() is fixed inside a transaction).
alter table public.users disable trigger users_set_updated_at;
update public.users set updated_at = now() - interval '1 hour'
  where auth_user_id in ('00000000-0000-0000-0000-0000000010a1', '00000000-0000-0000-0000-0000000010a2');
alter table public.users enable trigger users_set_updated_at;

-- As A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000010a1","role":"authenticated"}';

select results_eq(
  $$ select auth_user_id from public.users $$,
  $$ values ('00000000-0000-0000-0000-0000000010a1'::uuid) $$,
  'a signed-in user sees exactly their own row'
);
select is_empty(
  $$ select id from public.users where auth_user_id = '00000000-0000-0000-0000-0000000010a2' $$,
  'reading another user''s row returns nothing'
);
select is(
  public.app_user_id(),
  (select id from public.users where auth_user_id = '00000000-0000-0000-0000-0000000010a1'),
  'app_user_id() is the caller''s profile id'
);
select is(public.app_user_role(), 'member', 'app_user_role() is the caller''s role');

-- A blanket UPDATE (no WHERE) exercises the UPDATE policy, not the SELECT policy.
update public.users set language = 'en', display_name = 'Ana';
select throws_ok(
  $$ update public.users set role = 'admin' $$,
  '42501', null,
  'a signed-in user cannot change a role (no column grant)'
);
select throws_ok(
  $$ update public.users set email = 'x@test.local' $$,
  '42501', null,
  'a signed-in user cannot change their email through the profile'
);
select throws_ok(
  $$ delete from public.users $$,
  '42501', null,
  'a signed-in user cannot delete profiles'
);
select throws_ok(
  $$ insert into public.users (auth_user_id) values ('00000000-0000-0000-0000-0000000010a1') $$,
  '42501', null,
  'a signed-in user cannot insert profiles'
);

set local role anon;
select throws_ok(
  $$ select 1 from public.users $$,
  '42501', null,
  'anon cannot read profiles'
);

-- DB-3: the helpers are SECURITY DEFINER, so the grant is the only thing that keeps anon out.
-- Asserted through the catalog, not by calling (DB-1: a denied call crashes the local image).
reset role;
select is(
  has_function_privilege('anon', 'public.app_user_id()', 'EXECUTE'),
  false,
  'DB-3: anon cannot execute app_user_id()'
);
select is(
  has_function_privilege('anon', 'public.app_user_role()', 'EXECUTE'),
  false,
  'DB-3: anon cannot execute app_user_role()'
);
select results_eq(
  $$ select auth_user_id, language, display_name, updated_at = now() from public.users
     where auth_user_id in ('00000000-0000-0000-0000-0000000010a1', '00000000-0000-0000-0000-0000000010a2')
     order by auth_user_id $$,
  $$ values ('00000000-0000-0000-0000-0000000010a1'::uuid, 'en', 'Ana', true),
            ('00000000-0000-0000-0000-0000000010a2'::uuid, 'hr', null, false) $$,
  'the blanket update changed only A''s row and moved its updated_at; B is untouched'
);
select is(
  (select count(*)::int from public.users where auth_user_id in ('00000000-0000-0000-0000-0000000010a1', '00000000-0000-0000-0000-0000000010a2')),
  2,
  'both profiles are still there after the refused delete'
);

select * from finish();
rollback;
