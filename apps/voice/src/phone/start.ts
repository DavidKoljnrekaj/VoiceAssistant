// A phone call's rows, written by the worker once the caller is admitted: what `POST
// /voice/sessions` writes for an in-app call (`apps/api/src/voice/calls.ts`), here because the
// dispatch comes first on a trunk. The call limits are the shared ones (`@va/core`), the JWT is
// the caller's session from the magic-link flow, the `voice_calls` row is the same shape under
// the same cap, so `CallIdentity.resolve` and the rest of the lifecycle run unchanged. A failure
// after the session row undoes everything it wrote and revokes the session.
import { randomBytes } from 'node:crypto'

import { type DbClient, VOICE_CALL_CAP_MS } from '@va/db'

import { checkCallLimits, type ErrorCode, log } from '@va/core'

import { sha256Hex } from '../call.js'
import { LOG_TAG } from '../config.js'
import type { KnownCaller } from './caller.js'
import { phoneDb } from './db.js'
import { createCallerSession, revokeCallerSession } from './session.js'

/** <!-- needs native review --> */
export const PHONE_SESSION_TITLE = 'Telefonski poziv'

export interface StartPhoneCallInput {
  caller: KnownCaller
  /** The LiveKit room: `voice_calls.platform_call_id`. */
  room: string
  /** The SIP call id: `ai_sessions.external_id`. */
  sipCallId: string
  now: () => number
  requestId: string
}

export interface StartedPhoneCall {
  sessionId: string
  /** The opaque call token `CallIdentity.resolve` takes; never leaves the process. */
  callToken: string
  /** The caller's JWT, for `revokeCallerSession` at hang-up. */
  accessToken: string
}

export type StartResult =
  | { ok: true; value: StartedPhoneCall }
  | { ok: false; code: Extract<ErrorCode, 'rate_limited' | 'internal_error'> }

export async function startPhoneCall(
  service: DbClient,
  anon: DbClient,
  input: StartPhoneCallInput,
): Promise<StartResult> {
  const { caller, room, sipCallId, requestId } = input
  const userId = caller.user.id
  const ids = { request_id: requestId, user_id: userId, identity_id: caller.identity.id, room }
  const now = new Date(input.now())

  const verdict = await checkCallLimits(service, userId, now, requestId, LOG_TAG)
  if (!verdict.ok) {
    log('warn', LOG_TAG, 'phone rate limited', {
      ...ids,
      reason: verdict.reason,
      count: verdict.count,
      limit: verdict.limit,
    })
    return { ok: false, code: 'rate_limited' }
  }
  if (!caller.user.email) {
    log('error', LOG_TAG, 'phone start failed', { ...ids, reason: 'user has no email for the session' })
    return { ok: false, code: 'internal_error' }
  }

  let session
  try {
    session = await createCallerSession(service, anon, caller.user.email)
  } catch (err) {
    log('error', LOG_TAG, 'phone start failed', {
      ...ids,
      reason: err instanceof Error ? err.message : typeof err,
    })
    return { ok: false, code: 'internal_error' }
  }
  const revoke = async (): Promise<void> => {
    try {
      await revokeCallerSession(service, session.accessToken)
    } catch (err) {
      log('error', LOG_TAG, 'rollback failed', {
        ...ids,
        step: 'logout',
        reason: err instanceof Error ? err.message : typeof err,
      })
    }
  }

  // One live call per user, as the API keeps it: the previous credential goes once this call
  // is allowed.
  const { error: oldError } = await service.from('voice_calls').delete().eq('user_id', userId)
  if (oldError) {
    log('error', LOG_TAG, 'previous call cleanup failed', { ...ids, code: oldError.code })
    await revoke()
    return { ok: false, code: 'internal_error' }
  }

  const { data: row, error: sessionError } = await phoneDb(service)
    .from('ai_sessions')
    .insert({
      user_id: userId,
      channel: 'phone',
      external_id: sipCallId,
      title: PHONE_SESSION_TITLE,
      caller_identity_id: caller.identity.id,
    })
    .select('id')
    .single()
  if (sessionError || !row) {
    log('error', LOG_TAG, 'phone session insert failed', { ...ids, code: sessionError?.code ?? null })
    await revoke()
    return { ok: false, code: 'internal_error' }
  }
  const scoped = { ...ids, session_id: row.id }
  const rollback = async (): Promise<void> => {
    const calls = await service.from('voice_calls').delete().eq('session_id', row.id).eq('user_id', userId)
    if (calls.error)
      log('error', LOG_TAG, 'rollback failed', { ...scoped, table: 'voice_calls', code: calls.error.code })
    const sessions = await service.from('ai_sessions').delete().eq('id', row.id).eq('user_id', userId)
    if (sessions.error) {
      log('error', LOG_TAG, 'rollback failed', { ...scoped, table: 'ai_sessions', code: sessions.error.code })
    }
    await revoke()
  }

  const callToken = randomBytes(32).toString('base64url')
  // created_at from the same clock as expires_at: the CHECK compares the two (V-1).
  const { error: callError } = await service.from('voice_calls').insert({
    session_id: row.id,
    user_id: userId,
    call_token_hash: sha256Hex(callToken),
    platform_call_id: room,
    access_token: session.accessToken,
    created_at: now.toISOString(),
    expires_at: new Date(Math.min(session.expiresAtMs, now.getTime() + VOICE_CALL_CAP_MS)).toISOString(),
  })
  if (callError) {
    log('error', LOG_TAG, 'voice_calls insert failed', { ...scoped, code: callError.code })
    await rollback()
    return { ok: false, code: 'internal_error' }
  }
  log('info', LOG_TAG, 'phone call started', scoped)
  return { ok: true, value: { sessionId: row.id, callToken, accessToken: session.accessToken } }
}
