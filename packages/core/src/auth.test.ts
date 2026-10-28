// Identity through the real supabase-js against the fake GoTrue and PostgREST.
import { describe, expect, it } from 'vitest'

import { authenticateToken, isAuthError } from './auth.js'
import { MESSAGES_HR } from './errors.js'
import { TOKENS, USERS } from './test/fixtures.js'
import { clientOf, db, logs, reset } from './test/harness.js'

describe('authenticateToken', () => {
  it('A01: a valid token yields the profile, re-read through the service role', async () => {
    reset()
    const result = await authenticateToken(TOKENS.member)
    if (isAuthError(result)) throw new Error(result.error.code)
    expect(result).toMatchObject({
      userId: USERS.member.id,
      authUserId: USERS.member.authId,
      role: 'member',
      email: USERS.member.email,
      language: 'hr',
    })
    const auth = db.requests.find((r) => r.service === 'auth')!
    expect(clientOf(auth)).toBe('user')
    const profile = db.requestsTo('users', 'GET')[0]!
    expect(clientOf(profile)).toBe('service')
    expect(profile.params.get('auth_user_id')).toBe(`eq.${USERS.member.authId}`)
  })

  it('A02: the two clients act as the user and as the service role', async () => {
    reset()
    const ctx = await authenticateToken(TOKENS.admin)
    if (isAuthError(ctx)) throw new Error(ctx.error.code)
    await ctx.userClient.from('users').select('id')
    await ctx.serviceClient.from('users').select('id')
    const [asUser, asService] = db.requestsTo('users', 'GET').slice(-2)
    expect(clientOf(asUser!)).toBe('user')
    expect(asUser!.headers.get('Authorization')).toBe(`Bearer ${TOKENS.admin}`)
    expect(clientOf(asService!)).toBe('service')
  })

  it('A03: an unknown token is unauthorized (401) and the token is not logged', async () => {
    reset()
    const result = await authenticateToken('tok-nobody')
    expect(result).toEqual({
      error: { code: 'unauthorized', message: MESSAGES_HR.unauthorized },
      status: 401,
    })
    expect(logs.some((l) => l.line.includes('[core:auth]') && l.line.includes('unauthorized'))).toBe(true)
    expect(logs.some((l) => l.line.includes('tok-nobody'))).toBe(false)
  })

  it('A04: an auth user without a profile is no_profile (403)', async () => {
    reset()
    const result = await authenticateToken(TOKENS.orphan)
    expect(result).toMatchObject({ error: { code: 'no_profile' }, status: 403 })
  })

  it('A05: a failing profile lookup is internal_error (500), never an empty identity', async () => {
    reset()
    db.fault((r) => r.table === 'users', { status: 500 })
    const result = await authenticateToken(TOKENS.member)
    expect(result).toMatchObject({ error: { code: 'internal_error' }, status: 500 })
  })

  it('A07: a GoTrue outage is internal_error (500), not a sign-out', async () => {
    reset()
    db.fault((r) => r.service === 'auth', { status: 503, body: { code: 503, msg: 'unavailable' } })
    const result = await authenticateToken(TOKENS.member)
    expect(result).toMatchObject({ error: { code: 'internal_error' }, status: 500 })
  })

  it('A06: a profile outside the schema is refused', async () => {
    reset()
    db.rows('users').find((u) => u.id === USERS.member.id)!.role = 'superuser'
    const result = await authenticateToken(TOKENS.member)
    expect(result).toMatchObject({ error: { code: 'internal_error' }, status: 500 })
  })
})
