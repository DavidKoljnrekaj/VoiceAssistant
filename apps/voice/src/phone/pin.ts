// The keypad PIN: how it is hashed (scrypt from node:crypto, no native dependency; the real
// defence against a 4–6 digit space is the lockout), how the digits are collected, and how a
// check updates the identity's failure counter and lock. Digits never reach a log line.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

import type { DbClient } from '@va/db'

import { log } from '@va/core'

import { LOG_TAG } from '../config.js'
import type { PinPolicy } from './caller.js'
import { type CallerIdentityRow, phoneDb } from './db.js'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

const KEY_LEN = 32
const PARAMS = { N: 16384, r: 8, p: 1 }
export const PIN_MIN_DIGITS = 4
export const PIN_MAX_DIGITS = 6
export const PIN = new RegExp(`^[0-9]{${PIN_MIN_DIGITS},${PIN_MAX_DIGITS}}$`)

/** `scrypt$N$r$p$salt$key`, base64url. Throws on a PIN outside 4–6 digits. */
export async function hashPin(pin: string): Promise<string> {
  if (!PIN.test(pin)) throw new Error(`a PIN is ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits`)
  const salt = randomBytes(16)
  const key = await scryptAsync(pin, salt, KEY_LEN, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join(
    '$',
  )
}

/** False for a wrong PIN and for a hash this module did not write. */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const parts = hash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string]
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0)) return false
  const expected = Buffer.from(keyB64, 'base64url')
  if (expected.length !== KEY_LEN) return false
  const key = await scryptAsync(pin, Buffer.from(saltB64, 'base64url'), KEY_LEN, params)
  return timingSafeEqual(key, expected)
}

/** Collects keypad digits: `#` submits (once at least 4 digits are in), the sixth digit submits
 * by itself, anything else is ignored. Pure; the timeout between digits is the caller's. */
export class PinCollector {
  private digits = ''

  push(key: string): 'more' | 'complete' | 'ignored' {
    if (key === '#') return this.digits.length >= PIN_MIN_DIGITS ? 'complete' : 'ignored'
    if (!/^[0-9]$/.test(key) || this.digits.length >= PIN_MAX_DIGITS) return 'ignored'
    this.digits += key
    return this.digits.length === PIN_MAX_DIGITS ? 'complete' : 'more'
  }

  value(): string {
    return this.digits
  }

  reset(): void {
    this.digits = ''
  }
}

export type PinCheck =
  | { outcome: 'ok' }
  | { outcome: 'wrong'; attemptsLeft: number }
  | { outcome: 'locked'; lockedUntilMs: number }

/**
 * Verifies a PIN against the identity and records the result: a correct PIN resets the
 * counter and clears a past lock; a wrong one bumps the counter, and the one that reaches
 * `maxFailures` locks the number for `lockMs`. The update is filtered by the identity's id and
 * user id. A failed write throws: the caller is refused rather than let in on a stale counter.
 */
export async function checkPin(
  service: DbClient,
  identity: Pick<CallerIdentityRow, 'id' | 'user_id' | 'pin_hash' | 'pin_failed_attempts'>,
  pin: string,
  policy: Pick<PinPolicy, 'maxFailures' | 'lockMs'>,
  now: () => number = Date.now,
): Promise<PinCheck> {
  const ok = identity.pin_hash ? await verifyPin(pin, identity.pin_hash) : false
  const ids = { identity_id: identity.id, user_id: identity.user_id }
  if (ok) {
    await update(service, identity, { pin_failed_attempts: 0, pin_locked_until: null })
    return { outcome: 'ok' }
  }
  const failures = identity.pin_failed_attempts + 1
  if (failures >= policy.maxFailures) {
    const lockedUntilMs = now() + policy.lockMs
    await update(service, identity, {
      pin_failed_attempts: failures,
      pin_locked_until: new Date(lockedUntilMs).toISOString(),
    })
    log('warn', LOG_TAG, 'pin locked', { ...ids, failures, lock_ms: policy.lockMs })
    return { outcome: 'locked', lockedUntilMs }
  }
  await update(service, identity, { pin_failed_attempts: failures })
  log('warn', LOG_TAG, 'pin wrong', { ...ids, failures })
  return { outcome: 'wrong', attemptsLeft: policy.maxFailures - failures }
}

async function update(
  service: DbClient,
  identity: Pick<CallerIdentityRow, 'id' | 'user_id'>,
  patch: { pin_failed_attempts: number; pin_locked_until?: string | null },
): Promise<void> {
  const { error } = await phoneDb(service)
    .from('voice_caller_identities')
    .update(patch)
    .eq('id', identity.id)
    .eq('user_id', identity.user_id)
  if (error) throw new Error(`voice_caller_identities update failed: ${error.code}`)
}
