-- users (20261028100000_users.sql): a profile appears when an auth user is created; a signed-in
-- user sees only their own row, may change language and display_name, may not change role, and
-- sees nothing of anyone else; anon sees nothing; the helpers answer for the caller.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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

reset role;
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
