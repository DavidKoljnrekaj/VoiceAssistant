// Part 11b: the keypad queue (W28), the gate (W29–W31) and the call's rows (W32), against the
// @va/core fakes: no LiveKit.
import { describe, expect, it } from 'vitest'

import { createAnonClient, createServiceClient } from '@va/db'

import { CallIdentity, sha256Hex } from '../src/call.js'
import { type KnownCaller, type PinPolicy, resolveCaller } from '../src/phone/caller.js'
import { type GateIO, type GateSettings, phoneGate } from '../src/phone/gate.js'
import { KeyQueue } from '../src/phone/keys.js'
import { PHONE_LINES_HR as L } from '../src/phone/lines.js'
import { hashPin } from '../src/phone/pin.js'
import { sipCallOf } from '../src/phone/sip.js'
import { PHONE_SESSION_TITLE, startPhoneCall } from '../src/phone/start.js'
import { db, logs, NOW, scenario, USERS, uuid } from './harness.js'

const NUMBER = '+385911234567'
const IDENTITY = uuid(801)
const POLICY: PinPolicy = { roles: ['admin', 'member'], maxFailures: 3, lockMs: 15 * 60_000 }
const SETTINGS: GateSettings = { policy: POLICY, pinTimeoutMs: 10_000 }
const service = () => createServiceClient()

async function seedIdentity(row: Record<string, unknown> = {}): Promise<void> {
  db.seed('voice_caller_identities', [
    { id: IDENTITY, user_id: USERS.member.id, phone_e164: NUMBER, pin_hash: await hashPin('6183'), ...row },
  ])
}

/** A scripted keypad: each entry is the keys of one `nextKey` answer, `null` a silence. */
function io(keys: Array<string | null>): GateIO & { said: string[]; asked: number } {
  const rec = {
    said: [] as string[],
    asked: 0,
    async say(text: string) {
      rec.said.push(text)
    },
    async nextKey() {
      rec.asked++
      return keys.shift() ?? null
    },
    now: () => NOW,
  }
  return rec
}

describe('the keypad queue', () => {
  it('W28: keys pressed early are kept, a wait ends on the next key or the timeout, close ends every wait', async () => {
    const q = new KeyQueue()
    q.push('1')
    q.push('2')
    expect(await q.next(10)).toBe('1')
    expect(await q.next(10)).toBe('2')
    const waiting = q.next(50)
    q.push('3')
    expect(await waiting).toBe('3')
    expect(await q.next(5)).toBeNull()
    const superseded = q.next(1000)
    const current = q.next(1000)
    expect(await superseded).toBeNull()
    q.push('4')
    expect(await current).toBe('4')
    const open = q.next(1000)
    q.close()
    expect(await open).toBeNull()
    q.push('5')
    expect(await q.next(5)).toBeNull()
  })

  it('W28b: the SIP participant’s attributes name the caller and the call', () => {
    expect(
      sipCallOf(
        { 'sip.phoneNumber': '+385911234567', 'sip.callID': 'abc', 'sip.trunkPhoneNumber': '+3851' },
        'room-1',
      ),
    ).toEqual({
      callerId: '+385911234567',
      sipCallId: 'abc',
    })
    expect(sipCallOf({}, 'room-1')).toEqual({ callerId: null, sipCallId: 'room-1' })
    expect(sipCallOf({ 'sip.phoneNumber': '', 'sip.callID': '' }, 'room-1')).toEqual({
      callerId: null,
      sipCallId: 'room-1',
    })
  })
})

describe('the gate', () => {
  scenario(
    'W29 a withheld, unknown or locked number hears one line and is refused; no keypad is read',
    async () => {
      await seedIdentity()
      const withheld = io([])
      expect(await phoneGate(service(), 'anonymous', SETTINGS, withheld)).toEqual({
        kind: 'refused',
        reason: 'withheld',
      })
      expect(withheld.said).toEqual([L.refused])
      const unknown = io([])
      expect(await phoneGate(service(), '+385917654321', SETTINGS, unknown)).toEqual({
        kind: 'refused',
        reason: 'unknown',
      })
      expect(unknown.said).toEqual([L.refused])
      db.rows('voice_caller_identities')[0]!.pin_locked_until = new Date(NOW + 1000).toISOString()
      const locked = io(['6', '1', '8', '3'])
      expect(await phoneGate(service(), NUMBER, SETTINGS, locked)).toEqual({
        kind: 'refused',
        reason: 'locked',
      })
      expect(locked.said).toEqual([L.pinLocked])
      expect(locked.asked).toBe(0)
      expect(logs.filter((l) => l.line.includes('"phone gate"') && l.line.includes('refused'))).toHaveLength(
        3,
      )
    },
  )

  scenario(
    'W30 the right PIN admits the caller: the PIN greeting, the digits, the admitted line',
    async () => {
      await seedIdentity()
      const keypad = io(['6', '1', '8', '3', '#'])
      const outcome = await phoneGate(service(), '0911234567', SETTINGS, keypad)
      expect(outcome).toMatchObject({
        kind: 'admitted',
        pinUsed: true,
        caller: { identity: { id: IDENTITY }, user: { id: USERS.member.id } },
      })
      expect(keypad.said).toEqual([L.greetingPin, L.admitted])
      expect(keypad.asked).toBe(5)
      // A role the policy exempts hears the plain greeting and types nothing.
      const plain = io(['6'])
      expect(
        await phoneGate(service(), NUMBER, { ...SETTINGS, policy: { ...POLICY, roles: ['admin'] } }, plain),
      ).toMatchObject({
        kind: 'admitted',
        pinUsed: false,
      })
      expect(plain.said).toEqual([L.greeting])
      expect(plain.asked).toBe(0)
      for (const digits of ['6183']) expect(logs.some((l) => l.line.includes(digits))).toBe(false)
    },
  )

  scenario('W30b a wrong PIN is told so and gets another go; six digits submit without #', async () => {
    await seedIdentity({ pin_hash: await hashPin('471935') })
    const keypad = io(['4', '8', '2', '1', '#', '4', '7', '1', '9', '3', '5'])
    expect(await phoneGate(service(), NUMBER, SETTINGS, keypad)).toMatchObject({
      kind: 'admitted',
      pinUsed: true,
    })
    expect(keypad.said).toEqual([L.greetingPin, L.pinWrong, L.admitted])
    expect(db.rows('voice_caller_identities')[0]).toMatchObject({
      pin_failed_attempts: 0,
      pin_locked_until: null,
    })
  })

  scenario(
    'W31 a silent keypad is prompted once more, then refused; three wrong PINs lock the number',
    async () => {
      await seedIdentity()
      const silent = io([null, '6', null])
      expect(await phoneGate(service(), NUMBER, SETTINGS, silent)).toEqual({
        kind: 'refused',
        reason: 'pin_timeout',
      })
      expect(silent.said).toEqual([L.greetingPin, L.pinAgain, L.refused])
      expect(db.rows('voice_caller_identities')[0]).toMatchObject({ pin_failed_attempts: 0 })

      const wrong = io([
        '4',
        '8',
        '2',
        '1',
        '#',
        '7',
        '3',
        '9',
        '1',
        '#',
        '5',
        '2',
        '6',
        '7',
        '#',
        '6',
        '1',
        '8',
        '3',
        '#',
      ])
      expect(await phoneGate(service(), NUMBER, SETTINGS, wrong)).toEqual({
        kind: 'refused',
        reason: 'pin_locked',
      })
      expect(wrong.said).toEqual([L.greetingPin, L.pinWrong, L.pinWrong, L.pinLocked])
      expect(wrong.asked).toBe(15)
      expect(db.rows('voice_caller_identities')[0]).toMatchObject({
        pin_failed_attempts: 3,
        pin_locked_until: new Date(NOW + POLICY.lockMs).toISOString(),
      })
      const again = io(['6', '1', '8', '3', '#'])
      expect(await phoneGate(service(), NUMBER, SETTINGS, again)).toEqual({
        kind: 'refused',
        reason: 'locked',
      })
      expect(again.said).toEqual([L.pinLocked])
    },
  )
})

describe('the call’s rows', () => {
  const ROOM = 'phone-room-1'
  async function admitted(): Promise<KnownCaller> {
    const r = await resolveCaller(service(), NUMBER, POLICY, () => NOW)
    if (r.kind !== 'known') throw new Error('harness: not known')
    return r
  }
  const start = (caller: KnownCaller, now = NOW) =>
    startPhoneCall(service(), createAnonClient(), {
      caller,
      room: ROOM,
      sipCallId: 'sip-1',
      now: () => now,
      requestId: 'req-1',
    })

  scenario(
    'W32 an admitted caller gets a phone session, a call row under the cap and a token the identity resolves',
    async () => {
      await seedIdentity()
      // The caller's previous in-app call still holds a credential: this call replaces it.
      db.seed('ai_sessions', [
        { id: uuid(610), user_id: USERS.member.id, channel: 'voice', external_id: 'old-room' },
      ])
      db.seed('voice_calls', [
        {
          session_id: uuid(610),
          user_id: USERS.member.id,
          call_token_hash: 'old',
          platform_call_id: 'old-room',
          access_token: 'tok-member',
          expires_at: new Date(NOW + 60_000).toISOString(),
        },
      ])
      const result = await start(await admitted())
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const session = db.rows('ai_sessions').find((s) => s.id === result.value.sessionId)!
      expect(session).toMatchObject({
        user_id: USERS.member.id,
        channel: 'phone',
        external_id: 'sip-1',
        title: PHONE_SESSION_TITLE,
        caller_identity_id: IDENTITY,
      })
      const calls = db.rows('voice_calls')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        session_id: result.value.sessionId,
        user_id: USERS.member.id,
        call_token_hash: sha256Hex(result.value.callToken),
        platform_call_id: ROOM,
        access_token: result.value.accessToken,
        created_at: new Date(NOW).toISOString(),
        expires_at: new Date(NOW + 15 * 60_000).toISOString(),
      })
      expect(result.value.accessToken).toMatch(/^sess-/)
      const identity = await CallIdentity.resolve(service(), result.value.callToken, ROOM, { now: () => NOW })
      expect(identity).not.toBeNull()
      expect(await identity!.ctx()).toMatchObject({ userId: USERS.member.id, role: 'member' })
      expect(
        logs.some(
          (l) => l.line.includes(result.value.callToken) || l.line.includes(result.value.accessToken),
        ),
      ).toBe(false)
    },
  )

  scenario(
    'W32b the daily budget refuses the twenty-first spoken call before any session is minted',
    async () => {
      await seedIdentity()
      db.seed(
        'ai_sessions',
        Array.from({ length: 20 }, (_, i) => ({
          id: uuid(620 + i),
          user_id: USERS.member.id,
          channel: i % 2 ? 'voice' : 'phone',
          created_at: new Date(NOW - 60_000).toISOString(),
        })),
      )
      expect(await start(await admitted())).toEqual({ ok: false, code: 'rate_limited' })
      expect(db.requestsTo('admin/generate_link')).toHaveLength(0)
      expect(db.rows('voice_calls')).toHaveLength(0)
      expect(db.rows('ai_sessions').filter((s) => s.channel === 'phone')).toHaveLength(10)
    },
  )

  scenario('W32c a failed call row undoes the session row and revokes the caller’s session', async () => {
    await seedIdentity()
    db.fault((r) => r.table === 'voice_calls' && r.method === 'POST', { status: 500 })
    expect(await start(await admitted())).toEqual({ ok: false, code: 'internal_error' })
    expect(db.rows('ai_sessions').filter((s) => s.channel === 'phone')).toHaveLength(0)
    expect(db.rows('voice_calls')).toHaveLength(0)
    expect(db.requestsTo('logout', 'POST')).toHaveLength(1)
    // The revoked session no longer authenticates.
    expect(Object.keys(db.authUsers).some((t) => t.startsWith('sess-'))).toBe(false)
  })

  scenario('W32d a user without an email cannot be given a session', async () => {
    await seedIdentity()
    db.rows('users').find((u) => u.id === USERS.member.id)!.email = null
    expect(await start(await admitted())).toEqual({ ok: false, code: 'internal_error' })
    expect(db.requestsTo('admin/generate_link')).toHaveLength(0)
  })
})
