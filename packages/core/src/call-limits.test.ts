// L01–L03: the spoken channels' call budget, counted from rows.
import { describe, expect } from 'vitest'

import { createServiceClient } from '@va/db'

import { checkCallLimits } from './call-limits.js'
import { db, logs, scenario, USERS, uuid } from './test/index.js'

const NOW = new Date('2026-10-28T10:00:00.000Z')
const service = () => createServiceClient()

function seedSessions(channel: string, n: number, agoMs = 60_000): void {
  db.seed(
    'ai_sessions',
    Array.from({ length: n }, (_, i) => ({
      id: uuid(900 + i + (channel === 'phone' ? 50 : 0)),
      user_id: USERS.member.id,
      channel,
      external_id: `${channel}-${i}`,
      created_at: new Date(NOW.getTime() - agoMs).toISOString(),
    })),
  )
}

describe('call limits', () => {
  scenario(
    'L01 voice and phone calls share the daily budget of 20; older sessions do not count',
    async () => {
      seedSessions('voice', 12)
      seedSessions('phone', 7)
      expect(await checkCallLimits(service(), USERS.member.id, NOW, 'r1', '[test]')).toEqual({ ok: true })
      seedSessions('phone', 1, 23 * 60 * 60_000)
      expect(await checkCallLimits(service(), USERS.member.id, NOW, 'r2', '[test]')).toEqual({
        ok: false,
        reason: 'calls_per_day',
        count: 20,
        limit: 20,
      })
      // The count is the member's own spoken sessions: the request filters by user and channel.
      const req = db.requestsTo('ai_sessions', 'HEAD').at(-1)!
      expect(req.params.get('user_id')).toBe(`eq.${USERS.member.id}`)
      expect(req.params.get('channel')).toBe('in.(voice,phone)')
      // Another user is not affected.
      expect(await checkCallLimits(service(), USERS.admin.id, NOW, 'r3', '[test]')).toEqual({ ok: true })
    },
  )

  scenario(
    'L02 three live calls of other users refuse a fourth; the caller’s own row, expired and idle rows do not count',
    async () => {
      const live = (userId: string, over: Partial<Record<string, string>> = {}) => ({
        session_id: uuid(1),
        user_id: userId,
        call_token_hash: `h-${Math.random()}`,
        access_token: 't',
        expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
        last_seen_at: NOW.toISOString(),
        ...over,
      })
      db.seed('voice_calls', [
        live(uuid(11)),
        live(uuid(12)),
        live(USERS.member.id),
        live(uuid(13), { expires_at: new Date(NOW.getTime() - 1).toISOString() }),
        live(uuid(14), { last_seen_at: new Date(NOW.getTime() - 3 * 60_000 - 1).toISOString() }),
      ])
      expect(await checkCallLimits(service(), USERS.member.id, NOW, 'r1', '[test]')).toEqual({ ok: true })
      db.seed('voice_calls', [live(uuid(15))])
      expect(await checkCallLimits(service(), USERS.member.id, NOW, 'r2', '[test]')).toEqual({
        ok: false,
        reason: 'concurrent_calls',
        count: 3,
        limit: 3,
      })
    },
  )

  scenario('L03 a failed count allows the call and logs an error', async () => {
    db.fault((r) => r.table === 'voice_calls', { status: 500 })
    expect(await checkCallLimits(service(), USERS.member.id, NOW, 'r1', '[test]')).toEqual({ ok: true })
    const line = logs.find((l) => l.line.includes('voice rate limit count failed'))
    expect(line?.level).toBe('error')
  })
})
