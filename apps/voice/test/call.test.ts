// W02–W03: the call token resolves only to its own live call, and the identity is cached for a
// minute per call, then re-read.
import { describe, expect } from 'vitest'

import { createServiceClient } from '@va/db'

import { CallIdentity } from '../src/call.js'
import { CALL_TOKEN, db, logs, NOW, openCall, ROOM, scenario, seedCall, USERS } from './harness.js'

const resolve = (token = CALL_TOKEN, room = ROOM, now = NOW) =>
  CallIdentity.resolve(createServiceClient(), token, room, { now: () => now })

describe('call identity', () => {
  scenario(
    'W02 an unknown, foreign-room, expired or idle token resolves to null; a live one resolves',
    async () => {
      seedCall()
      expect(await resolve('someone-elses-token')).toBeNull()
      expect(await resolve(CALL_TOKEN, 'voice-other-room')).toBeNull()
      const live = await resolve()
      expect(live).toMatchObject({ sessionId: expect.any(String), userId: USERS.member.id })
      expect(logs.filter((l) => l.line.includes('call token refused'))).toHaveLength(2)
      expect(logs.some((l) => l.line.includes(CALL_TOKEN))).toBe(false)

      db.reset()
      seedCall({ expiresInMs: -1000 })
      expect(await resolve()).toBeNull()
      db.reset()
      seedCall({ lastSeenAgoMs: 3 * 60_000 + 1 })
      expect(await resolve()).toBeNull()
      db.reset()
      seedCall({ lastSeenAgoMs: 2 * 60_000 })
      expect(await resolve()).not.toBeNull()
    },
  )

  scenario('W02b a failed lookup throws, never resolves to null', async () => {
    seedCall()
    db.fault((r) => r.table === 'voice_calls', { status: 500 })
    await expect(resolve()).rejects.toThrow('voice_calls lookup failed')
  })

  scenario(
    'W03 identity is cached for 60 s and re-read after: the second getUser only once the clock moves',
    async () => {
      const call = await openCall()
      const getUserCalls = () => db.requestsTo('user', 'GET').length
      const first = await call.identity.ctx()
      expect(first).toMatchObject({ userId: USERS.member.id, role: 'member' })
      expect(getUserCalls()).toBe(1)

      call.clock.ms += 59_999
      expect(await call.identity.ctx()).toBe(first)
      expect(getUserCalls()).toBe(1)

      // A role change lands in the profile; the re-read picks it up.
      db.rows('users').find((u) => u.id === USERS.member.id)!.role = 'admin'
      call.clock.ms += 1
      const second = await call.identity.ctx()
      expect(getUserCalls()).toBe(2)
      expect(second.role).toBe('admin')
      expect(second).not.toBe(first)
    },
  )

  scenario('W03b the re-read sees a rotated JWT, and a deleted row ends the call', async () => {
    const call = await openCall()
    await call.identity.ctx()
    // The refresh endpoint rotated the stored JWT to one that belongs to another auth user.
    db.rows('voice_calls')[0]!.access_token = 'tok-admin'
    call.clock.ms += 60_000
    await expect(call.identity.ctx()).rejects.toThrow('unauthorized')
    expect(logs.some((l) => l.line.includes('call user mismatch'))).toBe(true)

    db.rows('voice_calls')[0]!.access_token = 'tok-member'
    call.clock.ms += 60_000
    expect((await call.identity.ctx()).userId).toBe(USERS.member.id)

    await call.identity.end()
    expect(db.rows('voice_calls')).toHaveLength(0)
    await call.identity.end() // idempotent
    call.clock.ms += 60_000
    await expect(call.identity.ctx()).rejects.toThrow('call_ended')
  })

  scenario('W03c touch bumps last_seen_at with the service role and an explicit user filter', async () => {
    const call = await openCall()
    call.clock.ms += 30_000
    call.identity.touch()
    await new Promise((r) => setTimeout(r, 20))
    const patch = db.requestsTo('voice_calls', 'PATCH')[0]!
    expect(patch.params.get('user_id')).toBe(`eq.${USERS.member.id}`)
    expect(db.rows('voice_calls')[0]!.last_seen_at).toBe(new Date(NOW + 30_000).toISOString())
  })
})
