// The LiveKit-bound side of a phone call's start: wait for the SIP participant, run the gate
// over the room's DTMF events and the session's `say`, write the call's rows, and hand back the
// same `CallIdentity` an in-app call gets. Thin on purpose: everything with a decision in it is
// in `gate.ts`, `start.ts` and `caller.ts`, tested against the fakes; this file is exercised by
// the live checklist (Part 11c), like `agent.ts`.
import type { JobContext, voice } from '@livekit/agents'
import { RoomEvent } from '@livekit/rtc-node'

import { log, MESSAGES_HR } from '@va/core'
import { createAnonClient, type DbClient } from '@va/db'

import { CallIdentity } from '../call.js'
import { LOG_TAG } from '../config.js'
import type { VoiceEnv } from '../env.js'
import { phoneGate } from './gate.js'
import { KeyQueue } from './keys.js'
import { revokeCallerSession } from './session.js'
import { sipCallOf } from './sip.js'
import { startPhoneCall } from './start.js'

export interface AdmittedPhoneCall {
  identity: CallIdentity
  /** The SIP participant's identity: whose disconnect ends the call. */
  callerParticipantIdentity: string
  /** Revokes the call's session; run at hang-up after the credential row is gone. */
  revoke: () => Promise<void>
}

type PhoneEnv = Pick<
  VoiceEnv,
  | 'PHONE_PIN_ROLES'
  | 'PHONE_PIN_MAX_FAILURES'
  | 'PHONE_PIN_LOCK_MS'
  | 'PHONE_PIN_TIMEOUT_MS'
  | 'IDENTITY_CACHE_MS'
>

/**
 * Admits the caller or returns null after the refusal line was spoken. The session must be
 * started (with the `GateAgent`) and the room connected. Each line is spoken through the
 * session and awaited, so the caller hears a refusal before the room goes.
 */
export async function admitPhoneCaller(
  ctx: JobContext,
  session: voice.AgentSession,
  service: DbClient,
  env: PhoneEnv,
  ids: Record<string, unknown>,
): Promise<AdmittedPhoneCall | null> {
  const room = ctx.job.room?.name ?? ''
  const participant = await ctx.waitForParticipant()
  const keys = new KeyQueue()
  let gone = false
  const onDtmf = (_code: number, digit: string, from: { identity: string }): void => {
    if (from.identity === participant.identity) keys.push(digit)
  }
  const onLeft = (left: { identity: string }): void => {
    if (left.identity !== participant.identity) return
    gone = true
    keys.close()
  }
  ctx.room.on(RoomEvent.DtmfReceived, onDtmf)
  ctx.room.on(RoomEvent.ParticipantDisconnected, onLeft)
  try {
    const { callerId, sipCallId } = sipCallOf(participant.attributes, room)
    const outcome = await phoneGate(
      service,
      callerId,
      {
        policy: {
          roles: env.PHONE_PIN_ROLES,
          maxFailures: env.PHONE_PIN_MAX_FAILURES,
          lockMs: env.PHONE_PIN_LOCK_MS,
        },
        pinTimeoutMs: env.PHONE_PIN_TIMEOUT_MS,
      },
      {
        say: async (text) => {
          if (!gone) await session.say(text).waitForPlayout()
        },
        nextKey: (ms) => keys.next(ms),
        now: Date.now,
      },
    )
    if (outcome.kind === 'refused') return null
    if (gone) return null

    const started = await startPhoneCall(service, createAnonClient(), {
      caller: outcome.caller,
      room,
      sipCallId,
      now: Date.now,
      requestId: String(ctx.job.id),
    })
    if (!started.ok) {
      if (!gone) await session.say(MESSAGES_HR[started.code]).waitForPlayout()
      return null
    }
    const revoke = async (): Promise<void> => revokeCallerSession(service, started.value.accessToken)
    const identity = await CallIdentity.resolve(service, started.value.callToken, room, {
      cacheMs: env.IDENTITY_CACHE_MS,
    })
    if (!identity) {
      // The row was just written; only a clock or a database fault explains this.
      log('error', LOG_TAG, 'phone start failed', { ...ids, reason: 'the new call row did not resolve' })
      await revoke().catch(() => {})
      if (!gone) await session.say(MESSAGES_HR.internal_error).waitForPlayout()
      return null
    }
    return { identity, callerParticipantIdentity: participant.identity, revoke }
  } finally {
    ctx.room.off(RoomEvent.DtmfReceived, onDtmf)
    ctx.room.off(RoomEvent.ParticipantDisconnected, onLeft)
    keys.close()
  }
}
