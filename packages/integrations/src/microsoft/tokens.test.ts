// U scenarios: the token store against the fake PostgREST and the fake Microsoft token endpoint.
// They assert the rows (never a token in the clear), the requests sent to Microsoft and what
// `tokenFor` hands out.
import { randomBytes } from 'node:crypto'

import { beforeEach, describe, expect } from 'vitest'

import { createServiceClient, createUserClient } from '@va/db'
import { db, logs, scenario, TOKENS, USERS } from '@va/core/test'

import { listConnections } from '../connections.js'
import { open, parseIntegrationsKey, seal, tokenAad } from '../crypto.js'
import { IntegrationError } from '../errors.js'
import {
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_REDIRECT_URI,
  FAKE_TENANT_ID,
  FakeMicrosoft,
} from '../test/fake-microsoft.js'
import { createMicrosoftOAuth } from './oauth.js'
import { createTokenStore } from './tokens.js'

const ms = new FakeMicrosoft()
const keys = parseIntegrationsKey(`k1:${randomBytes(32).toString('base64')}`)
let now = new Date('2026-11-04T10:00:00Z')
const clock = () => now
const store = (timeoutMs?: number) =>
  createTokenStore({
    keys,
    clock,
    oauth: createMicrosoftOAuth({
      tenantId: FAKE_TENANT_ID,
      clientId: FAKE_CLIENT_ID,
      clientSecret: FAKE_CLIENT_SECRET,
      redirectUri: FAKE_REDIRECT_URI,
      fetch: ms.fetch,
      clock,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    }),
  })
const M = USERS.member
const aad = (column: string) => tokenAad(M.id, 'microsoft', column)
const minutes = (n: number) => new Date(now.getTime() + n * 60_000).toISOString()

/** A connected member whose access token has `left` minutes to live. */
function seedConnection(left: number, extra: Record<string, unknown> = {}) {
  const granted = ms.grant({ upn: M.email })
  db.seed('user_integrations', [
    {
      user_id: M.id,
      provider: 'microsoft',
      account: M.email,
      scopes: ['Mail.ReadWrite'],
      refresh_token_enc: seal(keys, granted.refreshToken, aad('refresh_token_enc')),
      access_token_enc: seal(keys, granted.accessToken, aad('access_token_enc')),
      access_expires_at: minutes(left),
      ...extra,
    },
  ])
  return granted
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof IntegrationError) return e.code
    throw e
  }
  return 'resolved'
}

const service = () => createServiceClient()
const row = () => db.rows('user_integrations')[0]!

describe('token store', () => {
  beforeEach(() => {
    ms.reset()
    now = new Date('2026-11-04T10:00:00Z')
  })

  scenario(
    'U01 a token with more than five minutes left is returned as stored, without a refresh',
    async () => {
      const granted = seedConnection(30)
      expect(await store().tokenFor(service(), M.id)).toBe(granted.accessToken)
      expect(ms.tokenCalls()).toHaveLength(0)
      const [lookup] = db.requestsTo('user_integrations', 'GET')
      expect(lookup!.params.get('user_id')).toBe(`eq.${M.id}`)
      expect(lookup!.params.get('provider')).toBe('eq.microsoft')
    },
  )

  scenario('U02 under five minutes left: one refresh, the rotated tokens stored sealed', async () => {
    const granted = seedConnection(4)
    const token = await store().tokenFor(service(), M.id)
    expect(token).not.toBe(granted.accessToken)
    expect(ms.tokenCalls('refresh_token')).toHaveLength(1)
    expect(ms.tokenCalls('refresh_token')[0]!.form!.get('refresh_token')).toBe(granted.refreshToken)
    const r = row()
    expect(open(keys, r.access_token_enc as string, aad('access_token_enc'))).toBe(token)
    const rotated = open(keys, r.refresh_token_enc as string, aad('refresh_token_enc'))
    expect(rotated).toMatch(/^rt-/)
    expect(rotated).not.toBe(granted.refreshToken)
    expect(r.access_expires_at).toBe(minutes(60))
    expect(JSON.stringify(db.rows('user_integrations'))).not.toMatch(/"(at|rt)-\d+"/)
    const [update] = db.requestsTo('user_integrations', 'PATCH')
    expect(update!.params.get('user_id')).toBe(`eq.${M.id}`)
    expect(update!.params.get('status')).toBe('eq.active')
  })

  scenario('U03 concurrent calls with an expired token share one refresh', async () => {
    seedConnection(-1)
    const s = store()
    const tokens = await Promise.all([
      s.tokenFor(service(), M.id),
      s.tokenFor(service(), M.id),
      s.tokenFor(service(), M.id),
    ])
    expect(new Set(tokens).size).toBe(1)
    expect(ms.tokenCalls('refresh_token')).toHaveLength(1)
  })

  scenario('U04 forceRefresh refreshes a token that still looks valid (Graph said 401)', async () => {
    const granted = seedConnection(30)
    const token = await store().tokenFor(service(), M.id, { forceRefresh: true })
    expect(token).not.toBe(granted.accessToken)
    expect(ms.tokenCalls('refresh_token')).toHaveLength(1)
  })

  scenario(
    'U05 Microsoft refuses the refresh: the row is reauth_required and later calls say so without asking again',
    async () => {
      seedConnection(1)
      ms.revokeAll()
      expect(await code(store().tokenFor(service(), M.id))).toBe('reauth_required')
      expect(row()).toMatchObject({
        status: 'reauth_required',
        last_error_code: 'AADSTS70000',
        access_token_enc: null,
        access_expires_at: null,
      })
      expect(await code(store().tokenFor(service(), M.id))).toBe('reauth_required')
      expect(ms.tokenCalls()).toHaveLength(1)
    },
  )

  scenario('U06 Microsoft unavailable: refresh_failed, the row untouched', async () => {
    seedConnection(1)
    const before = { ...row() }
    ms.fault('token', { status: 503, body: { error: 'temporarily_unavailable', error_codes: [50196] } })
    expect(await code(store().tokenFor(service(), M.id))).toBe('refresh_failed')
    expect(row()).toEqual(before)
    expect(db.requestsTo('user_integrations', 'PATCH')).toHaveLength(0)
  })

  scenario('U07 no row, a revoked row: not_connected, nothing sent to Microsoft', async () => {
    expect(await code(store().tokenFor(service(), M.id))).toBe('not_connected')
    db.seed('user_integrations', [
      {
        user_id: M.id,
        provider: 'microsoft',
        account: M.email,
        scopes: [],
        status: 'revoked',
        refresh_token_enc: null,
      },
    ])
    expect(await code(store().tokenFor(service(), M.id))).toBe('not_connected')
    expect(ms.calls).toHaveLength(0)
  })

  scenario(
    'U08 a ciphertext sealed for another user does not open: token_unreadable, logged without it',
    async () => {
      const granted = ms.grant({ upn: M.email })
      db.seed('user_integrations', [
        {
          user_id: M.id,
          provider: 'microsoft',
          account: M.email,
          scopes: [],
          refresh_token_enc: seal(
            keys,
            granted.refreshToken,
            tokenAad(USERS.admin.id, 'microsoft', 'refresh_token_enc'),
          ),
          access_token_enc: seal(
            keys,
            granted.accessToken,
            tokenAad(USERS.admin.id, 'microsoft', 'access_token_enc'),
          ),
          access_expires_at: minutes(30),
        },
      ])
      expect(await code(store().tokenFor(service(), M.id))).toBe('token_unreadable')
      const line = logs.find((l) => l.line.includes('token unreadable'))!.line
      expect(line).toContain(M.id)
      expect(line).not.toContain(granted.accessToken)
    },
  )

  scenario(
    'U09 saveConnection upserts one sealed, active row; a reconnect after reauth makes it active again',
    async () => {
      const s = store()
      const tokens = {
        accessToken: 'at-x',
        refreshToken: 'rt-x',
        expiresAt: new Date(minutes(60)),
        scopes: ['Mail.Read'],
      }
      await s.saveConnection(service(), M.id, { account: M.email, tokens })
      expect(db.rows('user_integrations')).toHaveLength(1)
      expect(row()).toMatchObject({
        user_id: M.id,
        provider: 'microsoft',
        account: M.email,
        status: 'active',
        scopes: ['Mail.Read'],
      })
      expect(open(keys, row().refresh_token_enc as string, aad('refresh_token_enc'))).toBe('rt-x')
      expect(JSON.stringify(db.requestsTo('user_integrations', 'POST')[0]!.body)).not.toContain('rt-x')
      row().status = 'reauth_required'
      await s.saveConnection(service(), M.id, {
        account: M.email,
        tokens: { ...tokens, refreshToken: 'rt-y' },
      })
      expect(db.rows('user_integrations')).toHaveLength(1)
      expect(row().status).toBe('active')
      expect(open(keys, row().refresh_token_enc as string, aad('refresh_token_enc'))).toBe('rt-y')
    },
  )

  scenario('U10 disconnect revokes the row and deletes both tokens, scoped to the user', async () => {
    seedConnection(30)
    await store().disconnect(service(), M.id)
    expect(row()).toMatchObject({
      status: 'revoked',
      refresh_token_enc: null,
      access_token_enc: null,
      access_expires_at: null,
    })
    const [update] = db.requestsTo('user_integrations', 'PATCH')
    expect(update!.params.get('user_id')).toBe(`eq.${M.id}`)
    expect(await code(store().tokenFor(service(), M.id))).toBe('not_connected')
  })

  scenario('U11 disconnected while a refresh was in flight: the fresh token is not handed out', async () => {
    seedConnection(1)
    // The user disconnects between Microsoft's answer and the refresh's update.
    db.onRequest((r) => {
      if (r.table === 'user_integrations' && r.method === 'PATCH') row().status = 'revoked'
    })
    expect(await code(store().tokenFor(service(), M.id))).toBe('not_connected')
    expect(ms.tokenCalls('refresh_token')).toHaveLength(1)
  })

  scenario('U12 a store failure is store_failed, not an empty answer', async () => {
    db.fault((r) => r.table === 'user_integrations', { status: 500 })
    expect(await code(store().tokenFor(service(), M.id))).toBe('store_failed')
  })

  /** The user reconnects between Microsoft's answer and our write: a new grant in the row. */
  function reconnectOnFirstPatch() {
    const fresh = ms.grant({ upn: M.email })
    let done = false
    db.onRequest((r) => {
      if (done || r.table !== 'user_integrations' || r.method !== 'PATCH') return
      done = true
      Object.assign(row(), {
        status: 'active',
        refresh_token_enc: seal(keys, fresh.refreshToken, aad('refresh_token_enc')),
        access_token_enc: seal(keys, fresh.accessToken, aad('access_token_enc')),
        access_expires_at: minutes(60),
      })
    })
    return fresh
  }

  scenario(
    "U13 a reconnect during a refresh wins: the stale grant's tokens are not written or handed out",
    async () => {
      seedConnection(1)
      const fresh = reconnectOnFirstPatch()
      expect(await store().tokenFor(service(), M.id)).toBe(fresh.accessToken)
      expect(open(keys, row().refresh_token_enc as string, aad('refresh_token_enc'))).toBe(fresh.refreshToken)
      const [patch] = db.requestsTo('user_integrations', 'PATCH')
      expect(patch!.params.get('refresh_token_enc')).toMatch(/^eq\.k1:/)
    },
  )

  scenario('U14 a refused refresh does not mark a connection the user made in the meantime', async () => {
    seedConnection(1)
    ms.revokeAll()
    const fresh = reconnectOnFirstPatch()
    expect(await store().tokenFor(service(), M.id)).toBe(fresh.accessToken)
    expect(row()).toMatchObject({ status: 'active', last_error_code: null })
  })

  scenario(
    'U15 a caller that aborts during the shared refresh gets the abort; the rotated token is still stored',
    async () => {
      const granted = seedConnection(1)
      let release!: () => void
      db.hold(
        (r) => r.table === 'user_integrations' && r.method === 'PATCH',
        new Promise<void>((r) => (release = r)),
      )
      const s = store()
      const controller = new AbortController()
      const pending = s.tokenFor(service(), M.id, { signal: controller.signal })
      await new Promise((r) => setTimeout(r, 10))
      controller.abort()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      release()
      await new Promise((r) => setTimeout(r, 20))
      const rotated = open(keys, row().refresh_token_enc as string, aad('refresh_token_enc'))
      expect(rotated).not.toBe(granted.refreshToken)
      const token = await s.tokenFor(service(), M.id)
      expect(token).toBe(open(keys, row().access_token_enc as string, aad('access_token_enc')))
      expect(ms.tokenCalls('refresh_token')).toHaveLength(1)
    },
  )

  scenario(
    'U16 the token endpoint hangs: refresh_failed after the timeout, and the next call tries again',
    async () => {
      seedConnection(1)
      ms.fault('token', { hang: true })
      const s = store(50)
      expect(await code(s.tokenFor(service(), M.id))).toBe('refresh_failed')
      expect(await s.tokenFor(service(), M.id)).toMatch(/^at-/)
      expect(ms.tokenCalls('refresh_token')).toHaveLength(2)
    },
  )

  scenario(
    'U17 Microsoft refuses our client (expired secret): misconfigured, logged as an error, the row untouched',
    async () => {
      seedConnection(1)
      const before = { ...row() }
      ms.clientSecret = 'the-new-secret'
      expect(await code(store().tokenFor(service(), M.id))).toBe('misconfigured')
      expect(row()).toEqual(before)
      const line = logs.find((l) => l.line.includes('microsoft refused the client'))!
      expect(line.level).toBe('error')
      expect(line.line).toContain('AADSTS7000215')
      expect(line.line).not.toContain(FAKE_CLIENT_SECRET)
    },
  )

  scenario("U18 listConnections reads the state columns only, through the user's own client", async () => {
    seedConnection(30)
    const out = await listConnections(createUserClient(TOKENS.member))
    expect(out).toEqual([
      { provider: 'microsoft', account: M.email, status: 'active', connected_at: expect.any(String) },
    ])
    const [get] = db.requestsTo('user_integrations', 'GET')
    expect(get!.params.get('select')).toBe('provider,account,status,connected_at')
    expect(get!.headers.get('Authorization')).toBe(`Bearer ${TOKENS.member}`)
  })
})
