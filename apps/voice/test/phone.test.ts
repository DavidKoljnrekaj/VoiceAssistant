// Part 11a: who is calling (W20–W23), the caller's session through the magic-link flow (W24),
// and the keypad PIN (W25–W27). Against the @va/core fakes: GoTrue's generate_link / verify /
// logout and PostgREST, no LiveKit.
import { describe, expect, it } from 'vitest'

import { authenticateToken } from '@va/core'
import { createAnonClient, createServiceClient } from '@va/db'

import { normalizeE164 } from '../src/phone/e164.js'
import { numberHash, type PinPolicy, resolveCaller } from '../src/phone/caller.js'
import { checkPin, hashPin, PinCollector, verifyPin } from '../src/phone/pin.js'
import { createCallerSession, revokeCallerSession } from '../src/phone/session.js'
import { db, logs, NOW, scenario, USERS, uuid } from './harness.js'

const NUMBER = '+385911234567'
const IDENTITY = uuid(801)
const POLICY: PinPolicy = { roles: ['admin', 'member'], maxFailures: 3, lockMs: 15 * 60_000 }
const service = () => createServiceClient()
const now = () => NOW

function seedIdentity(row: Record<string, unknown> = {}): void {
  db.seed('voice_caller_identities', [
    {
      id: IDENTITY,
      user_id: USERS.member.id,
      phone_e164: NUMBER,
      label: 'mobitel',
      pin_hash: 'scrypt$x',
      ...row,
    },
  ])
}

describe('E.164', () => {
  it('W20: the trunk’s caller ID normalises to E.164 or is withheld', () => {
    const cases: Array<[string | null | undefined, string | null]> = [
      ['+385911234567', NUMBER],
      ['00385911234567', NUMBER],
      ['0911234567', NUMBER],
      ['385911234567', NUMBER],
      ['+385 91 123 4567', NUMBER],
      ['+385-91-123-4567', NUMBER],
      ['(091) 123-4567', NUMBER],
      ['tel:+385911234567', NUMBER],
      ['sip:+385911234567@sip.twilio.com', NUMBER],
      ['SIP:0911234567@trunk', NUMBER],
      ['+4915112345678', '+4915112345678'],
      ['anonymous', null],
      ['Restricted', null],
      ['sip:anonymous@anonymous.invalid', null],
      ['', null],
      ['   ', null],
      [null, null],
      [undefined, null],
      ['+0911234567', null],
      ['+38591', null],
      ['+3859112345678901', null],
      ['abc', null],
      ['+385 91 abc', null],
    ]
    for (const [raw, expected] of cases) expect(normalizeE164(raw), String(raw)).toBe(expected)
  })
})

describe('caller resolution', () => {
  scenario('W21 a withheld or unknown number is refused with a hashed log line, no number', async () => {
    seedIdentity()
    expect(await resolveCaller(service(), 'anonymous', POLICY, now)).toEqual({
      kind: 'refused',
      reason: 'withheld',
    })
    expect(db.requestsTo('voice_caller_identities')).toHaveLength(0)
    const other = '+385917654321'
    expect(await resolveCaller(service(), other, POLICY, now)).toEqual({ kind: 'refused', reason: 'unknown' })
    const refused = logs.filter((l) => l.line.includes('phone refused'))
    expect(refused).toHaveLength(2)
    expect(refused[1]!.line).toContain(numberHash(other))
    expect(logs.some((l) => l.line.includes(other) || l.line.includes('917654321'))).toBe(false)
  })

  scenario(
    'W21b an inactive identity does not resolve; the lookup filters by number and active',
    async () => {
      seedIdentity({ active: false })
      expect(await resolveCaller(service(), NUMBER, POLICY, now)).toEqual({
        kind: 'refused',
        reason: 'unknown',
      })
      const [req] = db.requestsTo('voice_caller_identities', 'GET')
      expect(req!.params.get('phone_e164')).toBe(`eq.${NUMBER}`)
      expect(req!.params.get('active')).toBe('eq.true')
    },
  )

  scenario('W22 a known number resolves to its identity and user; the policy decides the PIN', async () => {
    seedIdentity()
    const known = await resolveCaller(service(), '0911234567', POLICY, now)
    expect(known).toMatchObject({
      kind: 'known',
      identity: { id: IDENTITY, user_id: USERS.member.id, pin_hash: 'scrypt$x', pin_failed_attempts: 0 },
      user: {
        id: USERS.member.id,
        authUserId: USERS.member.authId,
        email: USERS.member.email,
        role: 'member',
      },
      pinRequired: true,
    })
    expect(await resolveCaller(service(), NUMBER, { ...POLICY, roles: ['admin'] }, now)).toMatchObject({
      kind: 'known',
      pinRequired: false,
    })
    expect(logs.some((l) => l.line.includes('phone refused'))).toBe(false)
  })

  scenario('W22b a role that needs a PIN with none enrolled is refused, never let in', async () => {
    seedIdentity({ pin_hash: null })
    expect(await resolveCaller(service(), NUMBER, POLICY, now)).toEqual({ kind: 'refused', reason: 'no_pin' })
    expect(await resolveCaller(service(), NUMBER, { ...POLICY, roles: ['admin'] }, now)).toMatchObject({
      kind: 'known',
      pinRequired: false,
    })
  })

  scenario('W23 a locked number is refused until the lock passes; a failed lookup throws', async () => {
    seedIdentity({ pin_failed_attempts: 3, pin_locked_until: new Date(NOW + 60_000).toISOString() })
    expect(await resolveCaller(service(), NUMBER, POLICY, now)).toMatchObject({
      kind: 'locked',
      lockedUntilMs: NOW + 60_000,
    })
    expect(await resolveCaller(service(), NUMBER, POLICY, () => NOW + 60_001)).toMatchObject({
      kind: 'known',
    })
    db.fault((r) => r.table === 'voice_caller_identities', { status: 500 })
    await expect(resolveCaller(service(), NUMBER, POLICY, now)).rejects.toThrow('lookup failed')
  })
})

describe('the caller’s session', () => {
  scenario('W24 a magic link becomes a JWT authenticateToken accepts; revoking it ends that', async () => {
    const session = await createCallerSession(service(), createAnonClient(), USERS.member.email)
    expect(session.expiresAtMs).toBeGreaterThan(Date.now())
    const link = db.requestsTo('admin/generate_link', 'POST')[0]!
    expect(link.body).toMatchObject({ type: 'magiclink', email: USERS.member.email })
    expect(db.requestsTo('verify', 'POST')[0]!.body).toMatchObject({
      type: 'magiclink',
      token_hash: 'hashed-1',
    })

    const ctx = await authenticateToken(session.accessToken)
    expect(ctx).toMatchObject({ userId: USERS.member.id, role: 'member' })
    // Single use: the hash is consumed.
    expect(db.magicLinks).toEqual({})
    expect(logs.some((l) => l.line.includes('hashed-1') || l.line.includes(session.accessToken))).toBe(false)

    await revokeCallerSession(service(), session.accessToken)
    expect(db.requestsTo('logout', 'POST')[0]!.params.get('scope')).toBe('local')
    expect(await authenticateToken(session.accessToken)).toMatchObject({ status: 401 })
    // Already revoked: a success.
    await revokeCallerSession(service(), session.accessToken)
  })

  scenario('W24b no user behind the email, or a verify failure, throws without the token', async () => {
    await expect(createCallerSession(service(), createAnonClient(), 'nobody@va.test')).rejects.toThrow(
      /generate_link failed: 404/,
    )
    db.fault((r) => r.table === 'verify', { status: 500 })
    await expect(createCallerSession(service(), createAnonClient(), USERS.member.email)).rejects.toThrow(
      /^verify failed: 500/,
    )
  })
})

describe('the keypad PIN', () => {
  it('W25: a PIN hashes with scrypt and verifies; a wrong PIN or a foreign hash does not', async () => {
    const hash = await hashPin('4821')
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
    expect(await verifyPin('4821', hash)).toBe(true)
    expect(await verifyPin('4822', hash)).toBe(false)
    expect(await verifyPin('4821', await hashPin('4821'))).toBe(true)
    expect(await hashPin('4821')).not.toBe(hash)
    expect(await verifyPin('4821', 'bcrypt$whatever')).toBe(false)
    expect(await verifyPin('4821', 'scrypt$16384$8$1$c2FsdA$short')).toBe(false)
    await expect(hashPin('123')).rejects.toThrow(/4 to 6 digits/)
    await expect(hashPin('1234567')).rejects.toThrow(/4 to 6 digits/)
    await expect(hashPin('12a4')).rejects.toThrow(/4 to 6 digits/)
  })

  it('W26: the collector takes 4–6 digits, # submits, the sixth digit submits, noise is ignored', () => {
    const c = new PinCollector()
    expect(c.push('#')).toBe('ignored')
    expect(c.push('*')).toBe('ignored')
    expect(c.push('4')).toBe('more')
    expect(c.push('8')).toBe('more')
    expect(c.push('2')).toBe('more')
    expect(c.push('1')).toBe('more')
    expect(c.push('#')).toBe('complete')
    expect(c.value()).toBe('4821')
    c.reset()
    for (const d of '12345') expect(c.push(d)).toBe('more')
    expect(c.push('6')).toBe('complete')
    expect(c.push('7')).toBe('ignored')
    expect(c.value()).toBe('123456')
  })

  scenario(
    'W27 three wrong PINs lock the number for 15 minutes; a correct one resets; digits never logged',
    async () => {
      // PINs whose digit runs appear in no id, timestamp or setting a log line carries.
      seedIdentity({ pin_hash: await hashPin('6183') })
      const identity = () => db.rows('voice_caller_identities')[0]!
      const current = () => identity() as unknown as Parameters<typeof checkPin>[1]

      expect(await checkPin(service(), current(), '4821', POLICY, now)).toEqual({
        outcome: 'wrong',
        attemptsLeft: 2,
      })
      expect(await checkPin(service(), current(), '7391', POLICY, now)).toEqual({
        outcome: 'wrong',
        attemptsLeft: 1,
      })
      expect(await checkPin(service(), current(), '5267', POLICY, now)).toEqual({
        outcome: 'locked',
        lockedUntilMs: NOW + POLICY.lockMs,
      })
      expect(identity()).toMatchObject({
        pin_failed_attempts: 3,
        pin_locked_until: new Date(NOW + POLICY.lockMs).toISOString(),
      })
      expect(await resolveCaller(service(), NUMBER, POLICY, now)).toMatchObject({ kind: 'locked' })
      expect(logs.filter((l) => l.line.includes('pin wrong'))).toHaveLength(2)
      expect(logs.filter((l) => l.line.includes('pin locked'))).toHaveLength(1)
      for (const digits of ['4821', '7391', '5267', '6183']) {
        expect(logs.some((l) => l.line.includes(digits))).toBe(false)
      }
      // Every update was filtered by the identity's id and user.
      for (const req of db.requestsTo('voice_caller_identities', 'PATCH')) {
        expect(req.params.get('id')).toBe(`eq.${IDENTITY}`)
        expect(req.params.get('user_id')).toBe(`eq.${USERS.member.id}`)
      }

      // The lock has passed: a correct PIN resets the counter and clears the lock.
      const later = () => NOW + POLICY.lockMs + 1
      expect(await resolveCaller(service(), NUMBER, POLICY, later)).toMatchObject({ kind: 'known' })
      expect(await checkPin(service(), current(), '6183', POLICY, later)).toEqual({ outcome: 'ok' })
      expect(identity()).toMatchObject({ pin_failed_attempts: 0, pin_locked_until: null })
    },
  )

  scenario('W27b a failed counter write refuses the caller rather than letting them in', async () => {
    seedIdentity({ pin_hash: await hashPin('4821') })
    db.fault((r) => r.table === 'voice_caller_identities' && r.method === 'PATCH', { status: 500 })
    const identity = db.rows('voice_caller_identities')[0] as unknown as Parameters<typeof checkPin>[1]
    await expect(checkPin(service(), identity, '4821', POLICY, now)).rejects.toThrow('update failed')
  })
})
