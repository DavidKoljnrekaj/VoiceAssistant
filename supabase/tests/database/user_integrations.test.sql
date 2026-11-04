-- user_integrations (20261104100000_user_integrations.sql): a user's Microsoft 365 connection.
-- The owner reads the connection's state and never a token column; nobody but the service role
-- writes; one row per user and provider; the token columns follow the status; rows follow
-- their user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000060a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000060a2', 'other@test.local');
insert into public.user_integrations (id, user_id, provider, account, scopes, refresh_token_enc,
                                      access_token_enc, access_expires_at, updated_at)
select '00000000-0000-0000-0000-0000000060c1', u.id, 'microsoft', 'owner@test.local',
       array['openid', 'Mail.ReadWrite'], 'k1:sealed-refresh', 'k1:sealed-access',
       now() + interval '1 hour', now() - interval '1 day'
from public.users u where u.auth_user_id = '00000000-0000-0000-0000-0000000060a1';

-- The owner reads the state columns of their own row; every token column is refused.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000060a1","role":"authenticated"}';
select is(
  (select status from public.user_integrations where provider = 'microsoft'),
  'active',
  'the owner reads their connection''s status');
select is(
  (select account from public.user_integrations where provider = 'microsoft'),
  'owner@test.local',
  'the owner reads the connected mailbox');
select throws_ok($$ select refresh_token_enc from public.user_integrations $$, '42501', null,
  'the owner cannot read the refresh token');
select throws_ok($$ select access_token_enc from public.user_integrations $$, '42501', null,
  'the owner cannot read the access token');
select throws_ok($$ select * from public.user_integrations $$, '42501', null,
  'select * is refused: it would include the token columns');
select throws_ok(
  $$ insert into public.user_integrations (user_id, provider, account, scopes, refresh_token_enc)
     values (public.app_user_id(), 'microsoft', 'x@test.local', '{}', 'k1:x') $$,
  '42501', null, 'the owner cannot insert a connection');
select throws_ok($$ update public.user_integrations set status = 'active' $$, '42501', null,
  'the owner cannot change the status');
select throws_ok($$ delete from public.user_integrations $$, '42501', null,
  'the owner cannot delete the row (disconnecting goes through the API)');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000060a2","role":"authenticated"}';
select is((select count(*)::int from public.user_integrations), 0, 'another user sees no rows');

set local role anon;
select throws_ok($$ select status from public.user_integrations $$, '42501', null,
  'anon cannot read connections');

-- The service role writes; the constraints hold for it too.
set local role service_role;
select throws_ok(
  $$ insert into public.user_integrations (user_id, provider, account, scopes, refresh_token_enc)
     select user_id, 'microsoft', 'again@test.local', '{}', 'k1:y' from public.user_integrations
     where id = '00000000-0000-0000-0000-0000000060c1' $$,
  '23505', null, 'one row per user and provider');
select lives_ok(
  $$ insert into public.user_integrations (user_id, provider, account, scopes, refresh_token_enc)
     select u.id, 'microsoft', 'other@test.local', '{}', 'k1:z' from public.users u
     where u.auth_user_id = '00000000-0000-0000-0000-0000000060a2' $$,
  'another user connects their own mailbox');
select throws_ok(
  $$ update public.user_integrations set provider = 'google' where id = '00000000-0000-0000-0000-0000000060c1' $$,
  '23514', null, 'only the microsoft provider exists');
select throws_ok(
  $$ update public.user_integrations set status = 'paused' where id = '00000000-0000-0000-0000-0000000060c1' $$,
  '23514', null, 'the status is one of active, reauth_required, revoked');
select throws_ok(
  $$ update public.user_integrations set refresh_token_enc = null where id = '00000000-0000-0000-0000-0000000060c1' $$,
  '23514', null, 'an active connection holds a refresh token');
select throws_ok(
  $$ update public.user_integrations set status = 'revoked' where id = '00000000-0000-0000-0000-0000000060c1' $$,
  '23514', null, 'a revoked connection holds no token');
select lives_ok(
  $$ update public.user_integrations set status = 'reauth_required', last_error_code = 'AADSTS70000'
     where id = '00000000-0000-0000-0000-0000000060c1' $$,
  'a failed refresh marks the row reauth_required');
select lives_ok(
  $$ update public.user_integrations
     set status = 'revoked', refresh_token_enc = null, access_token_enc = null, access_expires_at = null
     where id = '00000000-0000-0000-0000-0000000060c1' $$,
  'disconnecting revokes the row and deletes its tokens');

reset role;
select ok(
  (select updated_at > now() - interval '1 minute' from public.user_integrations
   where id = '00000000-0000-0000-0000-0000000060c1'),
  'an update moves updated_at');
select is(
  (select array[status, coalesce(refresh_token_enc, 'none')] from public.user_integrations
   where id = '00000000-0000-0000-0000-0000000060c1'),
  array['revoked', 'none'],
  'the revoked row is kept for its state, without tokens');

delete from auth.users where id = '00000000-0000-0000-0000-0000000060a1';
select is(
  (select count(*)::int from public.user_integrations where account = 'owner@test.local'),
  0,
  'deleting the user deletes their connection');

select * from finish();
rollback;
