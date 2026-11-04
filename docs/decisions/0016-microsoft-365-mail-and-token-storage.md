# 0016 — Outlook through a separate Entra app, delegated only, tokens sealed in our database

## Context

The email pack (Part 13) reads the signed-in user's own Outlook mailbox and, after the user
confirmed (decision 0015), replies to a message or flags it. The company is on Microsoft 365
(open question 10). Its tenant already has an Entra app for Landmark's sign-in, and its
administrator is outsourced and rarely available, so every Entra step has to be asked for once.
Signing in to the assistant stays email and password; connecting a mailbox is a separate,
explicit step. The API and the voice worker both need the user's token, and the refresh token
must never reach the browser.

## Decision

- **A separate app registration** (`Asistent`), single tenant, a confidential web client with a
  client secret, delegated permissions only: `openid`, `profile`, `email`, `offline_access`,
  `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.Read`, `People.Read`, admin-consented
  once for the tenant, assignment required, the requester as owner
  (`docs/requests/entra-admin-request.md`). No application permissions: the assistant never
  reads a mailbox its user did not connect.
- **The connect flow runs between the API and Microsoft**: the authorization-code flow with PKCE
  (S256) against `login.microsoftonline.com/<tenant GUID>` (never `common`), a single-use state
  of ten minutes held in the API's memory, and the check that the mailbox's UPN equals the
  assistant user's email. The PWA only starts it (`GET /integrations/microsoft/start` returns the
  authorize URL to a bearer-authenticated fetch) and receives the redirect back to Settings.
  Every scope is asked at connect, so the later parts need no reconnect.
- **Tokens are sealed and service role only.** `user_integrations` holds the refresh and access
  tokens as AES-256-GCM ciphertext under `INTEGRATIONS_KEY` (a key id prefix for rotation; the
  additional data binds a value to its user, provider and column). The owner reads the
  connection's state through a column grant and never a token. A refused refresh marks the row
  `reauth_required`; disconnecting revokes it and deletes our copy of both tokens.
- **A new package `@va/integrations`** holds the encryption, the OAuth client and the token
  store (`tokenFor`), shared by the API and the worker: the edges `api → integrations → db` and
  `voice → integrations → db` (and `→ core` for the logger), confirmed by the user on 2026-11-04.
  The mail pack stays `tools-* → core`; the app hands it a token provider.

Alternatives: reuse Landmark's sign-in app (its consent and revocation would cover mail too;
rejected for least privilege); sign in to the assistant with Microsoft and reuse that session's
token (open question 8 is not decided here, and Supabase does not hand us a Graph refresh token
we control); application permissions with a mailbox scope policy (every mailbox reachable by one
secret; rejected); the state in a table (survives restarts and a second instance; deferred to
`API-13` while the API is one process); tokens in Supabase Vault (an extra extension and RPCs
for what one key in the two processes' environment does).

## Consequences

Two more secrets per host (`MS_CLIENT_SECRET`, `INTEGRATIONS_KEY`), optional as a group so the
apps start without them. The secret expires (24 months): a refresh that Microsoft refuses as
`invalid_client` is logged as an error for the operator. Losing `INTEGRATIONS_KEY` disconnects
every user; rotating it is a deploy with the new key first. Disconnecting does not end
Microsoft's sessions (My Apps does), which the PWA says. A restart mid-connect costs the user a
second click. A token plus the key is enough to send mail as the user, so both stay on the two
hosts only. Email content reaching Anthropic and the voice vendors closes `OPS-4` and `OPS-5`
before the first real mailbox is connected.

## Date

2026-11-04
