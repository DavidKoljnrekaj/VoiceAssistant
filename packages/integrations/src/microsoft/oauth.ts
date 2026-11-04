// The Microsoft identity platform, pinned to the company tenant: the authorize URL (PKCE S256,
// state), the authorization-code exchange and the refresh, both as a confidential client, plus
// the one Graph read the connect flow needs (`/me`, for the mailbox's UPN). Over `fetch`, no SDK.
// The tenant is a GUID, never `common` or `organizations`: only the company's accounts sign in.
// Logs carry the grant, the HTTP status and Microsoft's error code; never a token, a code or a
// description (which can echo the user's name).
import { createHash, randomBytes } from 'node:crypto'

import { log } from '@va/core'

const LOGIN = 'https://login.microsoftonline.com'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const TAG = '[integrations]'
const REQUEST_TIMEOUT_MS = 10_000
/** OAuth error names are short snake_case words; anything else is not echoed. */
const OAUTH_ERROR = /^[a-z_]{1,64}$/
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Every delegated permission of the app registration (docs/requests/entra-admin-request.md),
 * asked at connect so the read tools (13b) and the confirmed writes (13c) need no reconnect.
 * The tenant's admin consented once, so the user sees no consent prompt.
 */
export const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'People.Read',
] as const

export interface MicrosoftOAuthConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  /** Exactly the redirect URI registered in Entra (`…/integrations/microsoft/callback`). */
  redirectUri: string
  fetch?: typeof fetch
  clock?: () => Date
  /** The ceiling of one request to Microsoft (10 s). */
  timeoutMs?: number
}

export interface TokenSet {
  accessToken: string
  /** Microsoft may omit it on a refresh; the stored one stays valid then. */
  refreshToken: string | undefined
  expiresAt: Date
  scopes: string[]
}

export interface MicrosoftAccount {
  /** The user principal name, compared with `users.email` at connect time. */
  upn: string
  mail: string | null
}

export type MicrosoftOAuthErrorKind =
  /** The code or refresh token is no longer good (expired, revoked, consent withdrawn): reconnect. */
  | 'invalid_grant'
  /** Our client id, secret or redirect URI is refused: configuration, not the user. */
  | 'invalid_client'
  /** 5xx, 429, network failure or timeout: try again later. */
  | 'unavailable'
  /** A 2xx without the fields we need, or another 4xx. */
  | 'bad_response'

export class MicrosoftOAuthError extends Error {
  constructor(
    readonly kind: MicrosoftOAuthErrorKind,
    readonly status: number,
    /** `AADSTS<n>` from `error_codes`, or Graph's `error.code`; null when there was none. */
    readonly code: string | null,
  ) {
    super(`microsoft ${kind} (${status}${code ? `, ${code}` : ''})`)
    this.name = 'MicrosoftOAuthError'
  }
}

export interface Pkce {
  verifier: string
  challenge: string
}

/** A 43-character verifier and its S256 challenge (RFC 7636). */
export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export interface MicrosoftOAuth {
  authorizeUrl(p: { state: string; challenge: string }): string
  exchangeCode(code: string, verifier: string, signal?: AbortSignal): Promise<TokenSet>
  refresh(refreshToken: string, signal?: AbortSignal): Promise<TokenSet>
  readAccount(accessToken: string, signal?: AbortSignal): Promise<MicrosoftAccount>
}

export function createMicrosoftOAuth(config: MicrosoftOAuthConfig): MicrosoftOAuth {
  if (!TENANT_ID.test(config.tenantId)) throw new Error('MS_TENANT_ID must be the tenant GUID')
  const doFetch = config.fetch ?? fetch
  const clock = config.clock ?? (() => new Date())
  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS
  const withTimeout = (signal: AbortSignal | undefined): AbortSignal => {
    const timeout = AbortSignal.timeout(timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }
  const base = `${LOGIN}/${config.tenantId}/oauth2/v2.0`
  const scope = MICROSOFT_SCOPES.join(' ')

  async function tokenRequest(
    grant: 'authorization_code' | 'refresh_token',
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: grant,
      scope,
      ...params,
    })
    const started = Date.now()
    let res: Response
    try {
      res = await doFetch(`${base}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        signal: withTimeout(signal),
      })
    } catch (e) {
      log('warn', TAG, 'microsoft token request failed', { grant, status: 0, ms: Date.now() - started })
      if (signal?.aborted) throw e
      throw new MicrosoftOAuthError('unavailable', 0, null)
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      const code = aadstsCode(json)
      const kind = classify(res.status, json)
      log('warn', TAG, 'microsoft token request failed', {
        grant,
        status: res.status,
        code,
        kind,
        ms: Date.now() - started,
      })
      throw new MicrosoftOAuthError(kind, res.status, code)
    }
    const accessToken = json?.access_token
    const refreshToken = json?.refresh_token
    // Microsoft sends `expires_in` as a number (some versions as a string of digits).
    const expiresIn = Number(json?.expires_in)
    const granted = json?.scope
    if (
      typeof accessToken !== 'string' ||
      !Number.isInteger(expiresIn) ||
      expiresIn <= 0 ||
      (refreshToken !== undefined && typeof refreshToken !== 'string') ||
      (granted !== undefined && typeof granted !== 'string') ||
      // A connection is a refresh token and the scopes it was granted, or nothing.
      (grant === 'authorization_code' && (typeof refreshToken !== 'string' || typeof granted !== 'string'))
    ) {
      log('warn', TAG, 'microsoft token response unusable', { grant, status: res.status })
      throw new MicrosoftOAuthError('bad_response', res.status, null)
    }
    return {
      accessToken,
      refreshToken: refreshToken as string | undefined,
      expiresAt: new Date(clock().getTime() + expiresIn * 1000),
      scopes: typeof granted === 'string' ? granted.split(' ').filter(Boolean) : [],
    }
  }

  return {
    authorizeUrl({ state, challenge }) {
      const q = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: config.redirectUri,
        response_mode: 'query',
        scope,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      })
      return `${base}/authorize?${q.toString()}`
    },

    exchangeCode(code, verifier, signal) {
      return tokenRequest(
        'authorization_code',
        { code, code_verifier: verifier, redirect_uri: config.redirectUri },
        signal,
      )
    },

    refresh(refreshToken, signal) {
      return tokenRequest('refresh_token', { refresh_token: refreshToken }, signal)
    },

    async readAccount(accessToken, signal) {
      let res: Response
      try {
        res = await doFetch(`${GRAPH}/me?$select=userPrincipalName,mail`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          signal: withTimeout(signal),
        })
      } catch (e) {
        log('warn', TAG, 'graph me failed', { status: 0 })
        if (signal?.aborted) throw e
        throw new MicrosoftOAuthError('unavailable', 0, null)
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) {
        const error = json?.error as { code?: unknown } | undefined
        const code = typeof error?.code === 'string' ? error.code : null
        log('warn', TAG, 'graph me failed', {
          status: res.status,
          code,
          request_id: res.headers.get('request-id'),
        })
        throw new MicrosoftOAuthError(
          res.status >= 500 || res.status === 429 ? 'unavailable' : 'bad_response',
          res.status,
          code,
        )
      }
      if (typeof json?.userPrincipalName !== 'string')
        throw new MicrosoftOAuthError('bad_response', res.status, null)
      return { upn: json.userPrincipalName, mail: typeof json.mail === 'string' ? json.mail : null }
    },
  }
}

function aadstsCode(json: Record<string, unknown> | null): string | null {
  const codes = json?.error_codes
  if (Array.isArray(codes) && typeof codes[0] === 'number') return `AADSTS${codes[0]}`
  return typeof json?.error === 'string' && OAUTH_ERROR.test(json.error) ? json.error : null
}

function classify(status: number, json: Record<string, unknown> | null): MicrosoftOAuthErrorKind {
  if (status >= 500 || status === 429) return 'unavailable'
  const error = json?.error
  // `interaction_required` / `consent_required`: the user must sign in again (MFA, consent withdrawn).
  if (error === 'invalid_grant' || error === 'interaction_required' || error === 'consent_required')
    return 'invalid_grant'
  if (error === 'invalid_client' || error === 'unauthorized_client') return 'invalid_client'
  return 'bad_response'
}
