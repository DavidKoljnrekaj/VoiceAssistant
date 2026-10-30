// V scenarios: the voice call lifecycle. The JWT never reaches LiveKit metadata or the browser;
// the call token leaves the server only as its hash and through the dispatch metadata.
import { describe, expect } from 'vitest'

import { uuid } from '@va/core/test'

import { CALL_IDLE_MS } from '../src/rate-limit.js'
import { CALL_CAP_MS, sha256Hex } from '../src/voice/calls.js'
import {
  buildApp,
  call,
  db,
  flatError,
  livekit,
  logs,
  memberJwt,
  scenario,
  TOKENS,
  USERS,
} from './harness.js'

const M = USERS.member
const calls = () => db.rows('voice_calls')
const voiceSessions = (userId = M.id) =>
  db.rows('ai_sessions').filter((s) => s.user_id === userId && s.channel === 'voice')
/** A live `voice_calls` row of another user, `expiresInMs` from now (negative: already expired). */
const liveRow = (userId: string, expiresInMs = 60_000) => ({
  session_id: uuid(Math.floor(Math.random() * 1e6)),
  user_id: userId,
  call_token_hash: crypto.randomUUID(),
  access_token: 'x',
  expires_at: new Date(Date.now() + expiresInMs).toISOString(),
})

describe('voice call lifecycle', () => {
  scenario(
    'V01 start: session and voice_calls rows, the token hashed, expiry capped, one dispatch with the call token, no JWT anywhere but the row',
    async () => {
      const res = await call('/voice/sessions')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { url: string; token: string; room: string; session_id: string }
      expect(body).toEqual({
        url: 'wss://fake.livekit.test',
        token: `lk-token-for-${M.id}`,
        room: expect.stringMatching(/^voice-[0-9a-f-]{36}$/),
        session_id: expect.any(String),
      })
      const session = voiceSessions()[0]!
      expect(session).toMatchObject({ id: body.session_id, external_id: body.room, title: 'Glasovni poziv' })
      expect(livekit.dispatches).toHaveLength(1)
      const dispatch = livekit.dispatches[0]!
      expect(dispatch).toMatchObject({ room: body.room, agentName: 'va-voice-test' })
      const metadata = JSON.parse(dispatch.metadata) as { callToken: string; sessionId: string }
      expect(metadata.sessionId).toBe(body.session_id)
      expect(metadata.callToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(dispatch.metadata).not.toContain(TOKENS.member)
      const row = calls()[0]!
      expect(row).toMatchObject({
        session_id: body.session_id,
        user_id: M.id,
        platform_call_id: body.room,
        access_token: TOKENS.member,
        call_token_hash: sha256Hex(metadata.callToken),
      })
      const cap = Date.parse(row.created_at as string) + CALL_CAP_MS
      expect(Math.abs(Date.parse(row.expires_at as string) - cap)).toBeLessThan(2000)
      expect(livekit.tokens[0]).toMatchObject({ identity: M.id, room: body.room, ttlSeconds: 900 })
      expect(JSON.stringify(body)).not.toContain(metadata.callToken)
    },
  )

  scenario('V01b a JWT that expires before the cap bounds expires_at', async () => {
    const exp = Math.floor(Date.now() / 1000) + 120
    const jwt = memberJwt(exp)
    db.authUsers[jwt] = { id: M.authId, email: M.email }
    const res = await call('/voice/sessions', undefined, { token: jwt })
    expect(res.status).toBe(200)
    expect(calls()[0]!.expires_at).toBe(new Date(exp * 1000).toISOString())
    expect(calls()[0]!.access_token).toBe(jwt)
  })

  scenario('V02 a second start deletes the first call row: one live call per user', async () => {
    const first = (await (await call('/voice/sessions')).json()) as { session_id: string }
    const second = (await (await call('/voice/sessions')).json()) as { session_id: string }
    expect(calls().map((c) => c.session_id)).toEqual([second.session_id])
    expect(voiceSessions().map((s) => s.id)).toEqual([first.session_id, second.session_id])
  })

  scenario('V03 the 21st call of the day is 429 rate_limited and writes nothing', async () => {
    db.seed(
      'ai_sessions',
      Array.from({ length: 20 }, () => ({
        user_id: M.id,
        channel: 'voice',
        created_at: new Date(Date.now() - 3_600_000).toISOString(),
      })),
    )
    const res = await call('/voice/sessions')
    expect(await flatError(res)).toMatchObject({ status: 429, code: 'rate_limited' })
    expect(calls()).toHaveLength(0)
    expect(voiceSessions()).toHaveLength(20)
    expect(livekit.dispatches).toHaveLength(0)
  })

  scenario('V04 a fourth concurrent live call is 429; expired rows do not count', async () => {
    const live = (ageMs: number) => ({
      session_id: uuid(Math.floor(Math.random() * 1e6)),
      user_id: USERS.admin.id,
      call_token_hash: crypto.randomUUID(),
      access_token: 'x',
      expires_at: new Date(Date.now() + ageMs).toISOString(),
    })
    db.seed('voice_calls', [live(60_000), live(60_000), live(-60_000)])
    expect((await call('/voice/sessions')).status).toBe(200)
    db.seed('voice_calls', [live(60_000)])
    const res = await call('/voice/sessions')
    expect(await flatError(res)).toMatchObject({ status: 429, code: 'rate_limited' })
  })

  scenario(
    "V16 (API-8) a caller's own unexpired row does not count against the concurrent cap: with two others live, a re-start is 200",
    async () => {
      const first = (await (await call('/voice/sessions')).json()) as { session_id: string }
      db.seed('voice_calls', [liveRow(USERS.admin.id), liveRow(USERS.admin.id)])
      const res = await call('/voice/sessions')
      expect(res.status).toBe(200)
      const second = (await res.json()) as { session_id: string }
      expect(
        calls()
          .filter((c) => c.user_id === M.id)
          .map((c) => c.session_id),
      ).toEqual([second.session_id])
      expect(calls()).toHaveLength(3)
      expect(voiceSessions().map((s) => s.id)).toEqual([first.session_id, second.session_id])
    },
  )

  scenario(
    'V17 (API-8) unexpired rows idle for over three minutes do not count against the concurrent cap',
    async () => {
      const idle = { last_seen_at: new Date(Date.now() - CALL_IDLE_MS - 1000).toISOString() }
      db.seed('voice_calls', [
        { ...liveRow(USERS.admin.id), ...idle },
        { ...liveRow(USERS.admin.id), ...idle },
        { ...liveRow(USERS.admin.id), ...idle },
      ])
      expect((await call('/voice/sessions')).status).toBe(200)
      const count = db.requestsTo('voice_calls', 'HEAD')[0]!
      expect(count.params.get('expires_at')).toMatch(/^gt\./)
      expect(count.params.get('last_seen_at')).toMatch(/^gt\./)
    },
  )

  scenario('V05 a failed dispatch is 502 voice_dispatch_failed and both rows are removed', async () => {
    livekit.failNextDispatch = true
    const res = await call('/voice/sessions')
    expect(await flatError(res)).toMatchObject({ status: 502, code: 'voice_dispatch_failed' })
    expect(calls()).toHaveLength(0)
    expect(voiceSessions()).toHaveLength(0)
  })

  scenario(
    'V11 (API-4) a failed join token is 500 internal_error and both rows are removed; the dispatch stays and is logged',
    async () => {
      livekit.failNextJoinToken = true
      const res = await call('/voice/sessions')
      expect(await flatError(res)).toMatchObject({ status: 500, code: 'internal_error' })
      expect(calls()).toHaveLength(0)
      expect(voiceSessions()).toHaveLength(0)
      expect(livekit.dispatches).toHaveLength(1)
      const line = logs.find((l) => l.level === 'error' && l.line.includes('"event":"join token failed"'))
      expect(line?.line).toContain('"session_id"')
      expect(line?.line).not.toContain(TOKENS.member)
    },
  )

  scenario('V12 (API-4) a rollback whose delete fails logs the failure with the session id', async () => {
    livekit.failNextDispatch = true
    db.fault((r) => r.table === 'voice_calls' && r.method === 'DELETE' && r.params.has('session_id'), {
      status: 500,
    })
    const res = await call('/voice/sessions')
    expect(await flatError(res)).toMatchObject({ status: 502, code: 'voice_dispatch_failed' })
    const line = logs.find((l) => l.level === 'error' && l.line.includes('"event":"rollback failed"'))
    expect(line?.line).toContain('"table":"voice_calls"')
    expect(line?.line).toContain('"code":"XX000"')
    expect(line?.line).toContain('"session_id"')
    // The session delete still ran: a failed first delete does not skip the second.
    expect(voiceSessions()).toHaveLength(0)
  })

  scenario(
    'V13 (API-5) nothing that reaches LiveKit carries the email: identity is the user id, no name',
    async () => {
      const res = await call('/voice/sessions')
      expect(res.status).toBe(200)
      expect(livekit.tokens).toHaveLength(1)
      expect(livekit.tokens[0]).toEqual({
        identity: M.id,
        room: livekit.dispatches[0]!.room,
        ttlSeconds: 900,
      })
      expect(JSON.stringify(livekit.tokens)).not.toContain(M.email)
      expect(JSON.stringify(livekit.dispatches)).not.toContain(M.email)
    },
  )

  scenario('V06 refresh replaces the JWT; expires_at never moves past created_at + 15 min', async () => {
    const { session_id } = (await (await call('/voice/sessions')).json()) as { session_id: string }
    const row = calls()[0]!
    row.created_at = new Date(Date.now() - 14 * 60_000).toISOString()
    const cap = Date.parse(row.created_at as string) + CALL_CAP_MS
    const later = memberJwt(Math.floor(Date.now() / 1000) + 3600)
    db.authUsers[later] = { id: M.authId, email: M.email }
    expect((await call(`/voice/sessions/${session_id}/refresh`, undefined, { token: later })).status).toBe(
      200,
    )
    expect(calls()[0]).toMatchObject({ access_token: later, expires_at: new Date(cap).toISOString() })
    const soon = Math.floor(Date.now() / 1000) + 30
    const sooner = memberJwt(soon)
    db.authUsers[sooner] = { id: M.authId, email: M.email }
    expect((await call(`/voice/sessions/${session_id}/refresh`, undefined, { token: sooner })).status).toBe(
      200,
    )
    expect(calls()[0]!.expires_at).toBe(new Date(soon * 1000).toISOString())
  })

  scenario(
    'V14 (API-6) refresh on an expired, unswept row is 404 not_found and the row is untouched',
    async () => {
      const { session_id } = (await (await call('/voice/sessions')).json()) as { session_id: string }
      const row = calls()[0]!
      row.expires_at = new Date(Date.now() - 1000).toISOString()
      const later = memberJwt(Math.floor(Date.now() / 1000) + 3600)
      db.authUsers[later] = { id: M.authId, email: M.email }
      const res = await call(`/voice/sessions/${session_id}/refresh`, undefined, { token: later })
      expect(await flatError(res)).toMatchObject({ status: 404, code: 'not_found' })
      expect(calls()[0]).toMatchObject({ access_token: TOKENS.member, expires_at: row.expires_at })
      expect(db.requestsTo('voice_calls', 'PATCH')).toHaveLength(0)
    },
  )

  scenario(
    'V15 (API-6) a row deleted between the lookup and the update is 404 not_found, not 500',
    async () => {
      const { session_id } = (await (await call('/voice/sessions')).json()) as { session_id: string }
      db.onRequest((r) => {
        if (r.table === 'voice_calls' && r.method === 'PATCH') db.tables.voice_calls = []
      })
      const res = await call(`/voice/sessions/${session_id}/refresh`)
      expect(await flatError(res)).toMatchObject({ status: 404, code: 'not_found' })
      expect(logs.some((l) => l.level === 'error' && l.line.includes('voice_calls refresh failed'))).toBe(
        false,
      )
    },
  )

  scenario("V07 refresh and end for another user's session are 404 not_found", async () => {
    const { session_id } = (await (await call('/voice/sessions')).json()) as { session_id: string }
    expect(
      await flatError(
        await call(`/voice/sessions/${session_id}/refresh`, undefined, { token: TOKENS.admin }),
      ),
    ).toMatchObject({ status: 404, code: 'not_found' })
    expect(
      await flatError(await call(`/voice/sessions/${session_id}/end`, undefined, { token: TOKENS.admin })),
    ).toMatchObject({ status: 404, code: 'not_found' })
    expect(calls()).toHaveLength(1)
    expect(await flatError(await call(`/voice/sessions/${uuid(1)}/refresh`))).toMatchObject({
      status: 404,
      code: 'not_found',
    })
  })

  scenario('V08 end is idempotent: the row goes, a second end is still 200', async () => {
    const { session_id } = (await (await call('/voice/sessions')).json()) as { session_id: string }
    expect((await call(`/voice/sessions/${session_id}/end`)).status).toBe(200)
    expect(calls()).toHaveLength(0)
    expect(voiceSessions()).toHaveLength(1)
    expect((await call(`/voice/sessions/${session_id}/end`)).status).toBe(200)
  })

  scenario('V09 start without the LiveKit variables is 500 internal_error and writes nothing', async () => {
    const app = buildApp({ livekit: null })
    const res = await call('/voice/sessions', undefined, { app })
    expect(await flatError(res)).toMatchObject({ status: 500, code: 'internal_error' })
    expect(calls()).toHaveLength(0)
    expect(voiceSessions()).toHaveLength(0)
  })

  scenario(
    'V10 sessions: PATCH renames and DELETE removes with the user filter; zero rows affected is 404',
    async () => {
      const { session_id } = (await (await call('/voice/sessions')).json()) as { session_id: string }
      expect(
        (await call(`/sessions/${session_id}`, { title: 'Moj poziv' }, { method: 'PATCH' })).status,
      ).toBe(200)
      expect(db.rows('ai_sessions').find((s) => s.id === session_id)!.title).toBe('Moj poziv')
      expect(
        await flatError(
          await call(`/sessions/${session_id}`, { title: 'x' }, { method: 'PATCH', token: TOKENS.admin }),
        ),
      ).toMatchObject({ status: 404, code: 'session_not_found' })
      expect(
        await flatError(await call(`/sessions/${session_id}`, { title: '' }, { method: 'PATCH' })),
      ).toMatchObject({ status: 400, code: 'bad_request' })
      expect(
        await flatError(
          await call(`/sessions/${session_id}`, undefined, { method: 'DELETE', token: TOKENS.admin }),
        ),
      ).toMatchObject({ status: 404, code: 'session_not_found' })
      expect((await call(`/sessions/${session_id}`, undefined, { method: 'DELETE' })).status).toBe(200)
      expect(db.rows('ai_sessions').find((s) => s.id === session_id)).toBeUndefined()
      expect(
        await flatError(await call(`/sessions/${session_id}`, undefined, { method: 'DELETE' })),
      ).toMatchObject({ status: 404, code: 'session_not_found' })
      const writes = db.requestsTo('ai_sessions', 'PATCH').concat(db.requestsTo('ai_sessions', 'DELETE'))
      for (const w of writes) expect(w.params.get('user_id')).toMatch(/^eq\./)
    },
  )
})
