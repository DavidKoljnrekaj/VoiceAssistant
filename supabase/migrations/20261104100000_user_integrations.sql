/*
  A user's connection to an outside service, first Microsoft 365 (docs/plan/13-email-pack.md §1;
  decision 0016).

  The user connects their own Outlook mailbox once from the PWA; the API runs the OAuth
  authorization-code flow with PKCE against the company tenant and keeps the tokens here, so the
  mail tools (Part 13b) read as that user through Microsoft Graph. The refresh token never
  reaches the browser.

  - account is the mailbox's user principal name, checked against users.email at connect time
    and shown in Settings.
  - refresh_token_enc and access_token_enc are AES-256-GCM ciphertext sealed by @va/integrations
    under INTEGRATIONS_KEY ("<key id>:<base64url iv | tag | ciphertext>"); the database never
    sees a token in the clear. The additional data binds each value to its user, provider and
    column, so a ciphertext copied to another row does not open.
  - status: active → reauth_required (Microsoft refused the refresh; the user reconnects) or
    revoked (the user disconnected; both tokens are deleted and the row stays for its state).
    The CHECKs tie the token columns to the status.
  - last_error_code is Microsoft's error code (AADSTS…) of the last failed refresh, never its
    description.

  RLS: the owner reads the state columns of their own row (a column grant: provider, account,
  scopes, status, last_error_code, connected_at, updated_at); no token column is readable by
  anyone but the service role, and only the service role writes (the API's callback and
  disconnect, the token store's refresh), every query by user_id.

  After applying: nothing to do by hand. Regenerate packages/db/src/database.ts with /db-types
  (REL-12).
*/

CREATE TABLE IF NOT EXISTS public.user_integrations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider           text NOT NULL CHECK (provider IN ('microsoft')),
  account            text NOT NULL,
  scopes             text[] NOT NULL,
  refresh_token_enc  text,
  access_token_enc   text,
  access_expires_at  timestamptz,
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'reauth_required', 'revoked')),
  last_error_code    text,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_integrations_user_id_provider_key UNIQUE (user_id, provider),
  CONSTRAINT user_integrations_active_has_refresh_token
    CHECK (status <> 'active' OR refresh_token_enc IS NOT NULL),
  CONSTRAINT user_integrations_revoked_has_no_token
    CHECK (status <> 'revoked' OR (refresh_token_enc IS NULL AND access_token_enc IS NULL))
);

DROP TRIGGER IF EXISTS user_integrations_set_updated_at ON public.user_integrations;
CREATE TRIGGER user_integrations_set_updated_at BEFORE UPDATE ON public.user_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_integrations FROM anon, authenticated;
GRANT SELECT (id, user_id, provider, account, scopes, status, last_error_code, connected_at, updated_at)
  ON public.user_integrations TO authenticated;
GRANT ALL ON public.user_integrations TO service_role;

DROP POLICY IF EXISTS user_integrations_select_own ON public.user_integrations;
CREATE POLICY user_integrations_select_own ON public.user_integrations
  FOR SELECT TO authenticated
  USING (user_id = public.app_user_id());

COMMENT ON TABLE public.user_integrations IS
  'A user''s connection to an outside service (Microsoft 365): the sealed OAuth tokens and the connection''s state. The owner reads the state columns only; only the service role reads tokens or writes.';
COMMENT ON COLUMN public.user_integrations.account IS
  'The connected mailbox''s user principal name; equal to users.email when it was connected.';
COMMENT ON COLUMN public.user_integrations.refresh_token_enc IS
  'AES-256-GCM ciphertext (@va/integrations, INTEGRATIONS_KEY, "<key id>:<base64url>"). Null once revoked. Never readable by authenticated or anon.';
COMMENT ON COLUMN public.user_integrations.access_token_enc IS
  'The current access token, sealed like refresh_token_enc; access_expires_at says until when it is valid.';
COMMENT ON COLUMN public.user_integrations.status IS
  'active; reauth_required when the provider refused a refresh (the user reconnects); revoked when the user disconnected (tokens deleted).';
COMMENT ON COLUMN public.user_integrations.last_error_code IS
  'The provider''s error code of the last failed refresh (AADSTS…). Never a description or a token.';
