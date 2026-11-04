// O scenarios: the tenant-pinned authorization-code flow with PKCE against the fake Microsoft.
import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_REDIRECT_URI,
  FAKE_TENANT_ID,
  FakeMicrosoft,
} from '../test/fake-microsoft.js'
import { createMicrosoftOAuth, MICROSOFT_SCOPES, MicrosoftOAuthError, newPkce } from './oauth.js'

const ms = new FakeMicrosoft()
const NOW = new Date('2026-11-04T10:00:00Z')
const oauth = () =>
  createMicrosoftOAuth({
    tenantId: FAKE_TENANT_ID,
    clientId: FAKE_CLIENT_ID,
    clientSecret: FAKE_CLIENT_SECRET,
    redirectUri: FAKE_REDIRECT_URI,
    fetch: ms.fetch,
    clock: () => NOW,
  })
const ACCOUNT = { upn: 'member@va.test' }

async function failure(p: Promise<unknown>): Promise<MicrosoftOAuthError> {
  try {
    await p
  } catch (e) {
    if (e instanceof MicrosoftOAuthError) return e
    throw e
  }
  throw new Error('expected a MicrosoftOAuthError')
}

describe('microsoft oauth', () => {
  beforeEach(() => ms.reset())

  it('O01: the authorize URL is the pinned tenant with every scope, PKCE S256, state and select_account', () => {
    const url = new URL(oauth().authorizeUrl({ state: 'state-1', challenge: 'challenge-1' }))
    expect(url.origin + url.pathname).toBe(
      `https://login.microsoftonline.com/${FAKE_TENANT_ID}/oauth2/v2.0/authorize`,
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: FAKE_CLIENT_ID,
      response_type: 'code',
      redirect_uri: FAKE_REDIRECT_URI,
      response_mode: 'query',
      scope: MICROSOFT_SCOPES.join(' '),
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    })
    expect(MICROSOFT_SCOPES).toEqual([
      'openid',
      'profile',
      'email',
      'offline_access',
      'User.Read',
      'Mail.ReadWrite',
      'Mail.Send',
      'Calendars.Read',
      'People.Read',
    ])
  })

  it('O02: a tenant that is not a GUID (common, organizations) is refused at construction', () => {
    for (const tenantId of ['common', 'organizations', 'consumers', 'contoso.onmicrosoft.com']) {
      expect(() =>
        createMicrosoftOAuth({ tenantId, clientId: 'c', clientSecret: 's', redirectUri: FAKE_REDIRECT_URI }),
      ).toThrow('MS_TENANT_ID must be the tenant GUID')
    }
  })

  it('O03: newPkce gives a 43-character verifier and its S256 challenge', () => {
    const { verifier, challenge } = newPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(newPkce().verifier).not.toBe(verifier)
  })

  it('O04: the code exchange sends the verifier, the secret and the redirect URI, and returns the tokens', async () => {
    const pkce = newPkce()
    const code = ms.authorize(oauth().authorizeUrl({ state: 's', challenge: pkce.challenge }), ACCOUNT)
    const tokens = await oauth().exchangeCode(code, pkce.verifier)
    expect(tokens).toEqual({
      accessToken: expect.stringMatching(/^at-/),
      refreshToken: expect.stringMatching(/^rt-/),
      expiresAt: new Date(NOW.getTime() + 3600_000),
      scopes: expect.arrayContaining(['Mail.ReadWrite', 'openid']),
    })
    const [call] = ms.tokenCalls('authorization_code')
    expect(call!.url).toBe(`https://login.microsoftonline.com/${FAKE_TENANT_ID}/oauth2/v2.0/token`)
    expect(Object.fromEntries(call!.form!)).toEqual({
      client_id: FAKE_CLIENT_ID,
      client_secret: FAKE_CLIENT_SECRET,
      grant_type: 'authorization_code',
      scope: MICROSOFT_SCOPES.join(' '),
      code,
      code_verifier: pkce.verifier,
      redirect_uri: FAKE_REDIRECT_URI,
    })
  })

  it('O05: a wrong verifier or a reused code is invalid_grant with its AADSTS code', async () => {
    const pkce = newPkce()
    const code = ms.authorize(oauth().authorizeUrl({ state: 's', challenge: pkce.challenge }), ACCOUNT)
    const wrong = await failure(oauth().exchangeCode(code, newPkce().verifier))
    expect([wrong.kind, wrong.status, wrong.code]).toEqual(['invalid_grant', 400, 'AADSTS501481'])
    const reused = await failure(oauth().exchangeCode(code, pkce.verifier))
    expect([reused.kind, reused.code]).toEqual(['invalid_grant', 'AADSTS54005'])
  })

  it('O06: a refresh rotates the refresh token; a revoked one is invalid_grant', async () => {
    const { refreshToken } = ms.grant(ACCOUNT)
    const tokens = await oauth().refresh(refreshToken)
    expect(tokens.refreshToken).toMatch(/^rt-/)
    expect(tokens.refreshToken).not.toBe(refreshToken)
    expect(Object.fromEntries(ms.tokenCalls('refresh_token')[0]!.form!)).toEqual({
      client_id: FAKE_CLIENT_ID,
      client_secret: FAKE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      scope: MICROSOFT_SCOPES.join(' '),
      refresh_token: refreshToken,
    })
    ms.revokeAll()
    const revoked = await failure(oauth().refresh(tokens.refreshToken!))
    expect([revoked.kind, revoked.code]).toEqual(['invalid_grant', 'AADSTS70000'])
  })

  it('O07: a 503, a network failure and a wrong secret map to unavailable, unavailable and invalid_client', async () => {
    const { refreshToken } = ms.grant(ACCOUNT)
    ms.fault('token', { status: 503, body: { error: 'temporarily_unavailable', error_codes: [50196] } })
    expect((await failure(oauth().refresh(refreshToken))).kind).toBe('unavailable')
    ms.fault('token', { connectionError: true })
    expect((await failure(oauth().refresh(refreshToken))).kind).toBe('unavailable')
    ms.clientSecret = 'rotated-by-the-owner'
    const e = await failure(oauth().refresh(refreshToken))
    expect([e.kind, e.status, e.code]).toEqual(['invalid_client', 401, 'AADSTS7000215'])
  })

  it('O08: readAccount reads the UPN from /me with the access token; a bad token is a typed error', async () => {
    const { accessToken } = ms.grant({ upn: 'Member@VA.test', mail: 'member@va.test' })
    expect(await oauth().readAccount(accessToken)).toEqual({ upn: 'Member@VA.test', mail: 'member@va.test' })
    const me = ms.calls.find((c) => c.endpoint === 'me')!
    expect(me.url).toBe('https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail')
    expect(me.authorization).toBe(`Bearer ${accessToken}`)
    const e = await failure(oauth().readAccount('at-unknown'))
    expect([e.kind, e.status, e.code]).toEqual(['bad_response', 401, 'InvalidAuthenticationToken'])
    expect(ms.unexpectedCalls).toBe(0)
  })

  it('O09: a token response without a positive expires_in, or a code exchange without scope, is bad_response', async () => {
    for (const body of [
      { access_token: 'at', refresh_token: 'rt', scope: 'openid', expires_in: 0 },
      { access_token: 'at', refresh_token: 'rt', scope: 'openid', expires_in: null },
      { access_token: 'at', refresh_token: 'rt', expires_in: 3600 },
    ]) {
      ms.fault('token', { status: 200, body })
      const pkce = newPkce()
      const code = ms.authorize(oauth().authorizeUrl({ state: 's', challenge: pkce.challenge }), ACCOUNT)
      expect((await failure(oauth().exchangeCode(code, pkce.verifier))).kind).toBe('bad_response')
    }
  })

  it('O10: an error that is not an OAuth error name is not echoed as the code', async () => {
    const { refreshToken } = ms.grant(ACCOUNT)
    ms.fault('token', { status: 400, body: { error: 'Ime Prezime <ime@va.test> says no' } })
    const e = await failure(oauth().refresh(refreshToken))
    expect([e.kind, e.code]).toEqual(['bad_response', null])
  })

  it('O11: a refresh-only client (the worker) needs no redirect URI; its connect methods refuse', async () => {
    const worker = createMicrosoftOAuth({
      tenantId: FAKE_TENANT_ID,
      clientId: FAKE_CLIENT_ID,
      clientSecret: FAKE_CLIENT_SECRET,
      fetch: ms.fetch,
      clock: () => NOW,
    })
    const { refreshToken } = ms.grant(ACCOUNT)
    expect((await worker.refresh(refreshToken)).accessToken).toMatch(/^at-/)
    expect(ms.tokenCalls('refresh_token')[0]!.form!.has('redirect_uri')).toBe(false)
    expect(() => worker.authorizeUrl({ state: 's', challenge: 'c' })).toThrow(
      'the connect flow needs MS_REDIRECT_URI',
    )
    expect(() => worker.exchangeCode('code', 'verifier')).toThrow('the connect flow needs MS_REDIRECT_URI')
  })
})
