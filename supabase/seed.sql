-- Local development seed. Loaded by `supabase db reset` on the local stack only; never applied
-- to a project. Credentials are documented in docs/DB.md as local-only.
--
--   admin@va.local  / va-local-dev   (role admin)
--   member@va.local / va-local-dev   (role member)
--
-- Auth users are inserted the way the Supabase docs show for local seeds. The sign-up trigger
-- creates the public.users rows; the UPDATEs below set the role and display name.

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
VALUES
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'admin@va.local',
   extensions.crypt('va-local-dev', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'member@va.local',
   extensions.crypt('va-local-dev', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   '{"sub":"10000000-0000-4000-8000-000000000001","email":"admin@va.local","email_verified":true}',
   'email', now(), now(), now()),
  ('10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002',
   '{"sub":"10000000-0000-4000-8000-000000000002","email":"member@va.local","email_verified":true}',
   'email', now(), now(), now())
ON CONFLICT (id) DO NOTHING;

UPDATE public.users SET role = 'admin', display_name = 'Lokalni admin'
  WHERE auth_user_id = '10000000-0000-4000-8000-000000000001';
UPDATE public.users SET display_name = 'Lokalni član'
  WHERE auth_user_id = '10000000-0000-4000-8000-000000000002';

-- One chat session of the member with three rows (user, assistant with a tool call, tool result),
-- so ai_session_history has a chain to walk. The Croatian strings here and in the display names
-- above are placeholders. <!-- needs native review -->
INSERT INTO public.ai_sessions (id, user_id, channel, title)
SELECT '20000000-0000-4000-8000-000000000001', u.id, 'chat', 'Probni razgovor'
FROM public.users u WHERE u.auth_user_id = '10000000-0000-4000-8000-000000000002'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_messages (id, session_id, role, turn_kind, content, parent_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, stop_reason)
VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'user', 'user',
   '[{"type":"text","text":"Koliko je sati?"}]', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'assistant', 'assistant',
   '[{"type":"text","text":"Provjeravam."},{"type":"tool_use","id":"toolu_seed_01","name":"current_time","input":{}}]',
   '30000000-0000-4000-8000-000000000001', 'claude-opus-5-5', 1200, 40, 1000, 0, 'tool_use'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'user', 'tool_result',
   '[{"type":"tool_result","tool_use_id":"toolu_seed_01","content":"2026-10-28T10:00:00+01:00"}]',
   '30000000-0000-4000-8000-000000000002', NULL, NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
