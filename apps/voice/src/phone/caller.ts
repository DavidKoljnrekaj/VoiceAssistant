// Who is calling: the trunk's caller ID, normalised, resolved against the enrolled numbers.
// A withheld, unknown, inactive or locked number is refused before the model sees anything,
// with one log line that carries a hash of the number, never the number
// (docs/plan/11-phone-channel.md §3). A failed lookup throws (invariant 10).
import { createHash } from 'node:crypto'

import type { DbClient } from '@va/db'

import { log, type Role } from '@va/core'

import { LOG_TAG } from '../config.js'
import type { CallerIdentityRow } from './db.js'
import { normalizeE164 } from './e164.js'

export interface KnownCaller {
  kind: 'known'
  identity: CallerIdentityRow
  user: { id: string; authUserId: string; email: string | null; role: Role }
  /** The policy's answer for this role; `identity.pin_hash` is null when nobody set one. */
  pinRequired: boolean
}

export type CallerResolution =
  | KnownCaller
  | { kind: 'locked'; identity: CallerIdentityRow; lockedUntilMs: number }
  /** `withheld`: no usable caller ID; `unknown`: no active identity; `no_pin`: the role needs a
   * PIN and the identity has none (enrolment incomplete). */
  | { kind: 'refused'; reason: 'withheld' | 'unknown' | 'no_pin' }

export interface PinPolicy {
  /** Roles that must enter a PIN (decision 0013: every role during the pilot). */
  roles: readonly Role[]
  maxFailures: number
  lockMs: number
}

const ROLES: readonly Role[] = ['admin', 'member']

/** A short, stable pseudonym for a number in logs (the first 12 hex chars of its SHA-256). */
export function numberHash(e164: string): string {
  return createHash('sha256').update(e164).digest('hex').slice(0, 12)
}

export async function resolveCaller(
  service: DbClient,
  rawCallerId: string | null | undefined,
  policy: PinPolicy,
  now: () => number = Date.now,
): Promise<CallerResolution> {
  const e164 = normalizeE164(rawCallerId)
  if (!e164) {
    log('warn', LOG_TAG, 'phone refused', { reason: 'withheld', caller_id_len: (rawCallerId ?? '').length })
    return { kind: 'refused', reason: 'withheld' }
  }
  const hash = numberHash(e164)
  const { data, error } = await service
    .from('voice_caller_identities')
    .select(
      'id, user_id, phone_e164, label, pin_hash, pin_failed_attempts, pin_locked_until, active, created_at, created_by, user:users!voice_caller_identities_user_id_fkey(id, auth_user_id, email, role)',
    )
    .eq('phone_e164', e164)
    .eq('active', true)
    .maybeSingle()
  if (error) throw new Error(`voice_caller_identities lookup failed: ${error.code}`)
  if (!data || !data.user) {
    log('warn', LOG_TAG, 'phone refused', { reason: 'unknown', number_hash: hash })
    return { kind: 'refused', reason: 'unknown' }
  }
  const { user, ...identity } = data
  const lockedUntilMs = identity.pin_locked_until ? Date.parse(identity.pin_locked_until) : null
  if (lockedUntilMs !== null && lockedUntilMs > now()) {
    log('warn', LOG_TAG, 'phone refused', {
      reason: 'locked',
      identity_id: identity.id,
      user_id: identity.user_id,
      locked_for_ms: lockedUntilMs - now(),
    })
    return { kind: 'locked', identity, lockedUntilMs }
  }
  const role = ROLES.includes(user.role as Role) ? (user.role as Role) : null
  if (role === null) throw new Error('voice_caller_identities user outside schema')
  const pinRequired = policy.roles.includes(role)
  if (pinRequired && !identity.pin_hash) {
    log('error', LOG_TAG, 'phone refused', {
      reason: 'no_pin',
      identity_id: identity.id,
      user_id: identity.user_id,
    })
    return { kind: 'refused', reason: 'no_pin' }
  }
  return {
    kind: 'known',
    identity,
    user: { id: user.id, authUserId: user.auth_user_id, email: user.email, role },
    pinRequired,
  }
}
