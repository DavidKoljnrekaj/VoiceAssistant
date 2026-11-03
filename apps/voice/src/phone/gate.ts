// The gate a phone caller passes before the model hears a word: resolve the number, refuse or
// greet, collect and check the keypad PIN. LiveKit-free: the lines go out through `io.say`,
// the digits come in through `io.nextKey`, so the whole flow is tested against the fakes
// (docs/plan/11-phone-channel.md §3, §5). No PIN digit and no number reaches a log line.
import type { DbClient } from '@va/db'

import { log } from '@va/core'

import { LOG_TAG } from '../config.js'
import { type KnownCaller, type PinPolicy, resolveCaller } from './caller.js'
import { PHONE_LINES_HR } from './lines.js'
import { checkPin, PinCollector } from './pin.js'

export interface GateIO {
  /** Speaks a fixed line; resolves once it has been played (or at once when nobody listens). */
  say(text: string): Promise<void>
  /** The next keypad key, or null after `timeoutMs` or once the caller is gone. */
  nextKey(timeoutMs: number): Promise<string | null>
  now(): number
}

export interface GateSettings {
  policy: PinPolicy
  /** The keypad wait before the one re-prompt. */
  pinTimeoutMs: number
}

export type GateRefusal = 'withheld' | 'unknown' | 'no_pin' | 'locked' | 'pin_timeout' | 'pin_locked'

export type GateOutcome =
  { kind: 'admitted'; caller: KnownCaller; pinUsed: boolean } | { kind: 'refused'; reason: GateRefusal }

/** How many times the keypad may stay silent: the first silence re-prompts, the second refuses. */
export const PIN_PROMPTS = 2

export async function phoneGate(
  service: DbClient,
  rawCallerId: string | null | undefined,
  settings: GateSettings,
  io: GateIO,
): Promise<GateOutcome> {
  const t0 = io.now()
  const resolved = await resolveCaller(service, rawCallerId, settings.policy, io.now)
  if (resolved.kind === 'refused') {
    await io.say(PHONE_LINES_HR.refused)
    return refused(resolved.reason, t0, io)
  }
  if (resolved.kind === 'locked') {
    await io.say(PHONE_LINES_HR.pinLocked)
    return refused('locked', t0, io, resolved.identity.id)
  }
  const ids = { identity_id: resolved.identity.id, user_id: resolved.user.id }
  if (!resolved.pinRequired) {
    await io.say(PHONE_LINES_HR.greeting)
    log('info', LOG_TAG, 'phone gate', { ...ids, outcome: 'admitted', pin_used: false, ms: io.now() - t0 })
    return { kind: 'admitted', caller: resolved, pinUsed: false }
  }

  await io.say(PHONE_LINES_HR.greetingPin)
  let identity = resolved.identity
  let silences = 0
  for (;;) {
    const pin = await collectPin(io, settings.pinTimeoutMs)
    if (pin === null) {
      if (++silences >= PIN_PROMPTS) {
        await io.say(PHONE_LINES_HR.refused)
        return refused('pin_timeout', t0, io, identity.id)
      }
      await io.say(PHONE_LINES_HR.pinAgain)
      continue
    }
    const check = await checkPin(service, identity, pin, settings.policy, io.now)
    if (check.outcome === 'ok') {
      await io.say(PHONE_LINES_HR.admitted)
      log('info', LOG_TAG, 'phone gate', { ...ids, outcome: 'admitted', pin_used: true, ms: io.now() - t0 })
      return {
        kind: 'admitted',
        caller: { ...resolved, identity: { ...identity, pin_failed_attempts: 0 } },
        pinUsed: true,
      }
    }
    if (check.outcome === 'locked') {
      await io.say(PHONE_LINES_HR.pinLocked)
      return refused('pin_locked', t0, io, identity.id)
    }
    identity = { ...identity, pin_failed_attempts: identity.pin_failed_attempts + 1 }
    await io.say(PHONE_LINES_HR.pinWrong)
  }
}

/** Keys until the collector says the PIN is complete; null when the keypad stays silent. */
async function collectPin(io: GateIO, timeoutMs: number): Promise<string | null> {
  const collector = new PinCollector()
  for (;;) {
    const key = await io.nextKey(timeoutMs)
    if (key === null) return null
    if (collector.push(key) === 'complete') return collector.value()
  }
}

function refused(reason: GateRefusal, t0: number, io: GateIO, identityId?: string): GateOutcome {
  log('info', LOG_TAG, 'phone gate', {
    outcome: 'refused',
    reason,
    ...(identityId ? { identity_id: identityId } : {}),
    ms: io.now() - t0,
  })
  return { kind: 'refused', reason }
}
