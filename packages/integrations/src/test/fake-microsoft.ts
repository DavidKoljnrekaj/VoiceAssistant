// A stand-in for the Microsoft identity platform's token endpoint and Graph's `/me`, answered
// over `fetch` the way the real services answer: form-encoded token requests with PKCE, rotating
// refresh tokens, AADSTS error bodies. It fakes the service, not a client library: the code
// under test builds real requests and this class checks them (tenant path, client id and
// secret, redirect URI, the S256 verifier against the challenge the authorize URL carried).
//
// `authorize(url, account)` plays the user's browser at Microsoft: it reads the authorize URL the
// API built and returns the code Microsoft would put in the callback. Any other host or path is
// an error, never the network, so a test cannot reach Microsoft by accident.
import { createHash } from 'node:crypto'

export interface FakeAccount {
  upn: string
  mail?: string | null
}

export type FakeMicrosoftFault =
  { status: number; body?: unknown } | { hang: true } | { connectionError: true }

export interface FakeMicrosoftCall {
  endpoint: 'token' | 'me' | 'unknown'
  url: string
  /** The form of a token request, parsed. */
  form: URLSearchParams | null
  authorization: string | null
}

interface IssuedCode {
  account: FakeAccount
  challenge: string
  redirectUri: string
  scope: string
}

export const FAKE_TENANT_ID = '11111111-2222-4333-8444-555555555555'
export const FAKE_CLIENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
export const FAKE_CLIENT_SECRET = 'fake-client-secret'
export const FAKE_REDIRECT_URI = 'http://localhost:3000/integrations/microsoft/callback'

export class FakeMicrosoft {
  tenantId = FAKE_TENANT_ID
  clientId = FAKE_CLIENT_ID
  clientSecret = FAKE_CLIENT_SECRET
  redirectUri = FAKE_REDIRECT_URI
  /** Seconds an issued access token lives (`expires_in`). */
  expiresIn = 3600
  /** Whether a refresh returns a new refresh token (Microsoft usually does). */
  rotateRefreshTokens = true
  calls: FakeMicrosoftCall[] = []
  /** Requests to a host or path the fake does not serve. */
  unexpectedCalls = 0
  private codes = new Map<string, IssuedCode>()
  private refreshTokens = new Map<string, FakeAccount>()
  private accessTokens = new Map<string, FakeAccount>()
  private faults: Array<{ endpoint: 'token' | 'me'; response: FakeMicrosoftFault; remaining: number }> = []
  private issued = 0

  reset(): void {
    this.expiresIn = 3600
    this.rotateRefreshTokens = true
    this.calls = []
    this.unexpectedCalls = 0
    this.codes.clear()
    this.refreshTokens.clear()
    this.accessTokens.clear()
    this.faults = []
  }

  /** The `fetch` the code under test is given. */
  readonly fetch: typeof fetch = (input, init) =>
    this.handle(new Request(input, init), init?.signal ?? undefined)

  /** The user signs in at Microsoft as `account`: returns the code the callback receives. */
  authorize(authorizeUrl: string, account: FakeAccount): string {
    const url = new URL(authorizeUrl)
    if (url.origin !== 'https://login.microsoftonline.com') throw new Error(`fake-microsoft: not a login URL`)
    if (url.pathname !== `/${this.tenantId}/oauth2/v2.0/authorize`)
      throw new Error(`fake-microsoft: authorize path ${url.pathname}`)
    const q = url.searchParams
    if (q.get('client_id') !== this.clientId) throw new Error('fake-microsoft: unknown client_id')
    if (q.get('redirect_uri') !== this.redirectUri)
      throw new Error('fake-microsoft: redirect_uri not registered')
    if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256')
      throw new Error('fake-microsoft: only the code flow with S256')
    const code = `code-${++this.issued}`
    this.codes.set(code, {
      account,
      challenge: q.get('code_challenge') ?? '',
      redirectUri: q.get('redirect_uri') ?? '',
      scope: q.get('scope') ?? '',
    })
    return code
  }

  /** A refresh token as if a connection had been made earlier; with its access token. */
  grant(account: FakeAccount): { refreshToken: string; accessToken: string } {
    const n = ++this.issued
    this.refreshTokens.set(`rt-${n}`, account)
    this.accessTokens.set(`at-${n}`, account)
    return { refreshToken: `rt-${n}`, accessToken: `at-${n}` }
  }

  /** The admin or the user revoked the app's sessions: every refresh token stops working. */
  revokeAll(): void {
    this.refreshTokens.clear()
  }

  fault(endpoint: 'token' | 'me', response: FakeMicrosoftFault, times = 1): void {
    this.faults.push({ endpoint, response, remaining: times })
  }

  tokenCalls(grant?: string): FakeMicrosoftCall[] {
    return this.calls.filter((c) => c.endpoint === 'token' && (!grant || c.form?.get('grant_type') === grant))
  }

  private async handle(req: Request, signal: AbortSignal | undefined): Promise<Response> {
    const url = new URL(req.url)
    const endpoint =
      url.origin === 'https://login.microsoftonline.com' && url.pathname.endsWith('/oauth2/v2.0/token')
        ? 'token'
        : url.origin === 'https://graph.microsoft.com' && url.pathname === '/v1.0/me'
          ? 'me'
          : 'unknown'
    const form = endpoint === 'token' ? new URLSearchParams(await req.text()) : null
    this.calls.push({ endpoint, url: req.url, form, authorization: req.headers.get('Authorization') })
    if (endpoint === 'unknown') {
      this.unexpectedCalls++
      return json(404, { error: 'fake-microsoft: no route' })
    }
    const fault = this.faults.find((f) => f.remaining > 0 && f.endpoint === endpoint)
    if (fault) {
      fault.remaining--
      const r = fault.response
      if ('hang' in r)
        return await new Promise<Response>((_, reject) => {
          const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
          if (signal?.aborted) abort()
          signal?.addEventListener('abort', abort, { once: true })
        })
      if ('connectionError' in r) throw new TypeError('fetch failed')
      return json(r.status, r.body ?? {})
    }
    return endpoint === 'token' ? this.token(url, form!) : this.me(req)
  }

  private token(url: URL, form: URLSearchParams): Response {
    if (url.pathname !== `/${this.tenantId}/oauth2/v2.0/token`) return aadError(400, 'invalid_request', 90002)
    if (form.get('client_id') !== this.clientId) return aadError(400, 'unauthorized_client', 700016)
    if (form.get('client_secret') !== this.clientSecret) return aadError(401, 'invalid_client', 7000215)
    const grant = form.get('grant_type')
    let account: FakeAccount
    let scope: string
    if (grant === 'authorization_code') {
      const issued = this.codes.get(form.get('code') ?? '')
      if (!issued) return aadError(400, 'invalid_grant', 54005)
      this.codes.delete(form.get('code')!)
      if (form.get('redirect_uri') !== issued.redirectUri) return aadError(400, 'invalid_grant', 50148)
      const verifier = form.get('code_verifier') ?? ''
      if (createHash('sha256').update(verifier).digest('base64url') !== issued.challenge)
        return aadError(400, 'invalid_grant', 501481)
      account = issued.account
      scope = issued.scope
    } else if (grant === 'refresh_token') {
      const old = form.get('refresh_token') ?? ''
      const found = this.refreshTokens.get(old)
      if (!found) return aadError(400, 'invalid_grant', 70000)
      account = found
      scope = form.get('scope') ?? ''
      if (this.rotateRefreshTokens) this.refreshTokens.delete(old)
    } else {
      return aadError(400, 'unsupported_grant_type', 70003)
    }
    const n = ++this.issued
    const accessToken = `at-${n}`
    this.accessTokens.set(accessToken, account)
    const out: Record<string, unknown> = {
      token_type: 'Bearer',
      // Microsoft echoes the granted scopes without offline_access.
      scope: scope
        .split(' ')
        .filter((s) => s && s !== 'offline_access')
        .join(' '),
      expires_in: this.expiresIn,
      access_token: accessToken,
    }
    if (grant === 'authorization_code' || this.rotateRefreshTokens) {
      out.refresh_token = `rt-${n}`
      this.refreshTokens.set(`rt-${n}`, account)
    }
    return json(200, out)
  }

  private me(req: Request): Response {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    const account = this.accessTokens.get(token)
    if (!account)
      return json(401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } })
    return json(200, { userPrincipalName: account.upn, mail: account.mail ?? account.upn })
  }
}

function aadError(status: number, error: string, code: number): Response {
  return json(status, {
    error,
    error_description: `AADSTS${code}: fake-microsoft.`,
    error_codes: [code],
    timestamp: '2026-11-04 10:00:00Z',
    trace_id: 'fake-trace',
    correlation_id: 'fake-correlation',
  })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'fake-request-id' },
  })
}
