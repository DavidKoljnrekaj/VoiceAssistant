# Mail (`@va/integrations`, `@va/tools-mail`)

The user's own Outlook mailbox through Microsoft Graph with delegated permissions (Part 13,
decision 0016). **13a, built:** the connection: the sealed token table, the token store with
refresh, the tenant-pinned OAuth connect flow in the API, a Graph client with its fake, the
Settings entry in the PWA. **13b** adds the read tools on chat and voice, **13c** the two
confirmed writes (`docs/plan/13-email-pack.md`).

## Packages

```
packages/integrations/              @va/integrations   api → integrations → db, core (log)
├── src/crypto.ts                   seal / open, parseIntegrationsKey, tokenAad
├── src/microsoft/oauth.ts          createMicrosoftOAuth, MICROSOFT_SCOPES, newPkce
├── src/microsoft/tokens.ts         createTokenStore (tokenFor, saveConnection), disconnectMicrosoft
├── src/connections.ts              listConnections (the owner's view, through the user's client)
├── src/db.ts                       user_integrations typed by hand until /db-types (REL-12)
└── src/test/fake-microsoft.ts      @va/integrations/test: the token endpoint and Graph /me
packages/tools-mail/                @va/tools-mail     tools-* → core
├── src/graph.ts                    createGraphClient, GraphError
└── test/fake-graph.ts              Graph v1.0 over fetch
```

The voice worker depends on `@va/integrations` for its env validation in 13a and calls
`tokenFor` from 13b. A pack never imports `@va/integrations`: the app builds the token store and
hands the pack a `token(signal)` function.

## The connection

1. **Start.** Settings calls `GET /integrations/microsoft/start` with the bearer token. The API
   makes a PKCE pair, keeps `{ user id, verifier }` under a fresh 43-character state for ten
   minutes (in memory, only the state's SHA-256 as the key; `API-13`), and answers
   `{ url }`: `https://login.microsoftonline.com/<MS_TENANT_ID>/oauth2/v2.0/authorize` with every
   scope of `MICROSOFT_SCOPES`, `prompt=select_account`, S256. The PWA checks the URL is
   Microsoft's sign-in and navigates there.
2. **Microsoft.** The user picks their work account. The admin consented for the tenant, so
   there is no consent screen; an unassigned user is refused by Microsoft.
3. **Callback.** Microsoft redirects to `GET /integrations/microsoft/callback?code&state`, the one
   API route without a bearer token. The state is taken (deleted) first, whatever the query
   says; then the code is exchanged with the verifier and the client secret; Graph `/me` gives
   the UPN; the `users` row is re-read by the state's user id; the UPN must equal its `email`
   (case-insensitive). Then `saveConnection` upserts the sealed row, and the browser goes to
   `WEB_APP_URL/settings?connected=1`, or `?connect_error=` one of `state_invalid`, `denied`,
   `exchange_failed`, `account_mismatch`, `failed`. The response carries `Cache-Control:
no-store` and `Referrer-Policy: no-referrer`.
4. **State.** `GET /integrations` reads `provider, account, status, connected_at` through the
   user's own client (RLS plus the column grant) and says whether the connection is available
   at all (`available.microsoft`, false without the MS_ variables).
5. **Disconnect.** `DELETE /integrations/microsoft` revokes the row and deletes our copy of both
   tokens (204, idempotent, works without the MS_ variables). Microsoft keeps its own sessions
   until the user or the admin revokes the app in My Apps (`myapps.microsoft.com`); Settings
   says so.

## Tokens at rest

`seal(keys, plaintext, aad)` is AES-256-GCM with a random 12-byte IV and a 16-byte tag, written
as `"<key id>:<base64url iv | tag | ciphertext>"`. The additional data is
`user_integrations:<user id>:<provider>:<column>`, so a value copied to another row or column
does not open. `INTEGRATIONS_KEY` is `"<id>:<base64 of 32 bytes>"`, older keys after commas; the
first seals, every listed key opens; a key that is not canonical base64 or not 32 bytes is
refused at startup. Errors name the problem and the position, never a value.

## `tokenFor(service, userId, { signal, forceRefresh })`

- No row, or a revoked one → `not_connected`; `reauth_required` → that.
- An access token with five minutes or more left (`REFRESH_MARGIN_MS`) is returned as stored.
- Otherwise one refresh per user per process; concurrent callers join it, and a caller's abort
  only ends its own wait, so a rotated refresh token is always stored. Every Microsoft request
  has a 10 s ceiling and every PostgREST call its own.
- The refresh writes are compare-and-set on the refresh token they used: a disconnect, a
  reconnect or the other process's refresh in the meantime wins, and the stale grant's tokens
  are neither stored nor handed out (the stored token is returned if fresh, else
  `refresh_failed`).
- Microsoft's `invalid_grant` (also `interaction_required`, `consent_required`) marks the row
  `reauth_required` with the AADSTS code; `invalid_client` is `misconfigured` (the secret
  expired or was replaced: an error line); 5xx, 429, network and timeouts are `refresh_failed`
  and leave the row as it was.
- `forceRefresh` is for a Graph 401 with a token that still looked valid (13b).

The API and the worker each keep their own single-flight; two processes refreshing one user at
the same moment is harmless on Entra (both refresh tokens stay valid until they expire), and the
compare-and-set keeps the row consistent.

## The Graph client

`createGraphClient({ token, fetch? })` → `get`, `post`, `patch` against v1.0 with `$select`,
query parameters and `Prefer` headers (`outlook.timezone="Central European Standard Time"`,
`outlook.body-content-type="text"`). A 429 waits its Retry-After (at most `MAX_RETRY_AFTER_MS`,
3 s, abortable) and retries once with a fresh token; a longer Retry-After or a second 429 is
`GraphError('throttled')`. Other failures are typed (`unauthorized`, `forbidden`, `not_found`,
`bad_request`, `unavailable`) with Graph's code and request id. Paths must be relative to
v1.0, so the token only ever goes to Graph.

## Environment

| Variable                                           | api | voice                |
| -------------------------------------------------- | --- | -------------------- |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | yes | yes                  |
| `INTEGRATIONS_KEY`                                 | yes | yes (the same value) |
| `MS_REDIRECT_URI`                                  | yes | no                   |
| `WEB_APP_URL`                                      | yes | no                   |

All or none per app; the matrix with sources is `docs/OPS.md` → The matrix.

## Logs

`[integrations]` and `[api]` lines carry `user_id`, `provider`, the grant, the HTTP status,
Microsoft's AADSTS code or Graph's error code, Graph's `request_id`, the refusal reason
(`state_invalid` …) and timings; `[mail]` lines carry the method, status, code and request id.
Never a token, a code, a state, a verifier, the client secret, a UPN, an email address, a path
or a body; the field names are on the denylist of `packages/core/src/log-fields.test.ts`.

## Operations

- **Key:** `printf 'k1:%s\n' "$(openssl rand -base64 32)"`, the same value on the api and the
  voice host. **Rotate:** put the new key first (`k2:…,k1:…`) on both hosts and restart; rows
  re-seal under `k2` as their tokens refresh; drop `k1` once no row starts with `k1:` (a refresh
  token unused for 90 days expires at Microsoft anyway). Losing every key disconnects everyone.
- **Secret expiry:** 24 months. The owner of the app registration adds a new secret before
  expiry, sets `MS_CLIENT_SECRET` on both hosts and restarts. An expired secret shows as
  `microsoft refused the client` error lines.
- **Production redirect:** the owner adds `https://API_HOST/integrations/microsoft/callback` to
  the app registration (Authentication → Web → Redirect URIs) and sets `MS_REDIRECT_URI` and
  `WEB_APP_URL` on the api host (`REL-13`).

## Tests

| Ids     | Where                                                    | What                                                                              |
| ------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| J01–J06 | `packages/integrations/src/crypto.test.ts`               | sealing, binding, tampering, rotation, key parsing                                |
| O01–O10 | `packages/integrations/src/microsoft/oauth.test.ts`      | the authorize URL, tenant pinning, PKCE, exchange, refresh, error mapping         |
| U01–U18 | `packages/integrations/src/microsoft/tokens.test.ts`     | the token store against the fake PostgREST and Microsoft, races, aborts, timeouts |
| Q01–Q07 | `packages/tools-mail/src/graph.test.ts`                  | the Graph client                                                                  |
| B01–B16 | `apps/api/test/integrations.test.ts`                     | the connect routes and the env group                                              |
| W40     | `apps/voice/test/env.test.ts`                            | the worker's env group                                                            |
| Y01–Y06 | `apps/web/src/components/Settings/SettingsPage.test.tsx` | Settings → Outlook                                                                |
| pgTAP   | `supabase/tests/database/user_integrations.test.sql`     | the grants, the policy, the constraints                                           |

The fakes answer the services over `fetch` (`FakeMicrosoft`, `FakeGraph`); the API harness also
fails any request to a Microsoft host that reaches the global `fetch`, so no test can call
Microsoft. `FakeMicrosoft` invalidates a refresh token once used, stricter than Entra.
