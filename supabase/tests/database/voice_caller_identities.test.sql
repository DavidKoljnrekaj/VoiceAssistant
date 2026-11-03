-- voice_caller_identities (20261103120000_phone_channel.sql): the phone channel's enrolled
-- numbers. Service role only: a signed-in user must not learn which numbers are enrolled or
-- their lock state; one active row per number; E.164 enforced; the user's sessions keep the
-- identity id, and lose it (not the session) when the identity goes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Fixtures, as the database owner. The sign-up trigger creates the public.users rows.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000040a1', 'caller@test.local'),
  ('00000000-0000-0000-0000-0000000040a2', 'other@test.local');
insert into public.voice_caller_identities (id, user_id, phone_e164, label, pin_hash)
select '00000000-0000-0000-0000-0000000040c1', u.id, '+385911234567', 'mobitel', 'scrypt$fixture'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000040a1';
insert into public.ai_sessions (id, user_id, channel, external_id, caller_identity_id)
select '00000000-0000-0000-0000-0000000040b1', u.id, 'phone', 'sip-call-1', '00000000-0000-0000-0000-0000000040c1'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000040a1';

-- The enrolled caller, signed in, cannot see or touch the identities table.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000040a1","role":"authenticated"}';
select throws_ok($$ select phone_e164 from public.voice_caller_identities $$, '42501', null,
  'a signed-in user cannot read voice_caller_identities');
select throws_ok(
  $$ insert into public.voice_caller_identities (user_id, phone_e164) values (public.app_user_id(), '+385917654321') $$,
  '42501', null,
  'a signed-in user cannot enrol a number');
select throws_ok($$ update public.voice_caller_identities set pin_failed_attempts = 0 $$, '42501', null,
  'a signed-in user cannot update voice_caller_identities');
select throws_ok($$ delete from public.voice_caller_identities $$, '42501', null,
  'a signed-in user cannot delete from voice_caller_identities');
-- The session's SELECT policy is unchanged: the owner reads the new column on their own session.
select is(
  (select caller_identity_id from public.ai_sessions where id = '00000000-0000-0000-0000-0000000040b1'),
  '00000000-0000-0000-0000-0000000040c1'::uuid,
  'the owner reads caller_identity_id on their own phone session');

set local role anon;
select throws_ok($$ select 1 from public.voice_caller_identities $$, '42501', null,
  'anon cannot read voice_caller_identities');

-- The worker (service role) resolves a caller, counts failures, locks and unlocks.
set local role service_role;
select is(
  (select pin_hash from public.voice_caller_identities where phone_e164 = '+385911234567' and active),
  'scrypt$fixture',
  'the service role resolves an active number to its identity');
select lives_ok(
  $$ update public.voice_caller_identities
     set pin_failed_attempts = 3, pin_locked_until = now() + interval '15 minutes'
     where id = '00000000-0000-0000-0000-0000000040c1' $$,
  'the service role records failures and the lockout');
select throws_ok(
  $$ update public.voice_caller_identities set pin_failed_attempts = -1 where id = '00000000-0000-0000-0000-0000000040c1' $$,
  '23514', null,
  'the failure counter cannot go negative');
select throws_ok(
  $$ insert into public.voice_caller_identities (user_id, phone_e164)
     select user_id, '0911234567' from public.voice_caller_identities where id = '00000000-0000-0000-0000-0000000040c1' $$,
  '23514', null,
  'a number that is not E.164 is refused');
select throws_ok(
  $$ insert into public.voice_caller_identities (user_id, phone_e164)
     select u.id, '+385911234567' from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000040a2' $$,
  '23505', null,
  'one active identity per number, whoever claims it');
select lives_ok(
  $$ insert into public.voice_caller_identities (user_id, phone_e164, active)
     select u.id, '+385911234567', false from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000040a2' $$,
  'an inactive row may keep a number another identity holds');
select is(
  (select count(*)::int from public.voice_caller_identities where phone_e164 = '+385911234567'),
  2,
  'both rows exist; only one is active');

-- Deleting the identity keeps the session and clears its pointer; deleting the user takes both.
reset role;
delete from public.voice_caller_identities where id = '00000000-0000-0000-0000-0000000040c1';
select is(
  (select caller_identity_id from public.ai_sessions where id = '00000000-0000-0000-0000-0000000040b1'),
  null,
  'deleting an identity sets the session''s caller_identity_id to null, the session stays');
delete from auth.users where id = '00000000-0000-0000-0000-0000000040a2';
select is(
  (select count(*)::int from public.voice_caller_identities where phone_e164 = '+385911234567'),
  0,
  'deleting the user deletes their identities (cascade through public.users)');

select * from finish();
rollback;
