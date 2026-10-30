// The voice call lifecycle (Landmark §4.4 ported): start mints an opaque call token whose hash
// sits in `voice_calls` next to the caller's JWT for at most 15 minutes, dispatches the agent
// with the token in the job metadata (never the JWT), and hands the browser only a LiveKit join
// token; refresh rotates the stored JWT under the cap that never moves; end deletes the row.
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { type AuthContext, type ErrorCode, log } from '@va/core'

import type { AppDeps } from '../deps.js'
import { checkVoiceRateLimits } from '../rate-limit.js'

export const CALL_CAP_MS = 15 * 60_000

/** <!-- needs native review --> */
export const VOICE_SESSION_TITLE = 'Glasovni poziv'

export type CallResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode }

export interface StartedCall {
  url: string
  token: string
  room: string
  session_id: string
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The JWT's `exp` in ms, or null when the token carries none (already verified by GoTrue; only read here). */
export function jwtExpiryMs(jwt: string): number | null {
  const payload = jwt.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

function cappedExpiry(jwt: string, capMs: number): string {
  const exp = jwtExpiryMs(jwt)
  return new Date(exp === null ? capMs : Math.min(exp, capMs)).toISOString()
}

export async function startCall(
  deps: AppDeps,
  ctx: AuthContext,
  jwt: string,
  requestId: string,
): Promise<CallResult<StartedCall>> {
  const ids = { request_id: requestId, user_id: ctx.userId }
  if (!deps.livekit) {
    log('error', '[api]', 'livekit not configured', ids)
    return { ok: false, code: 'internal_error' }
  }
  const now = deps.clock()
  const verdict = await checkVoiceRateLimits(ctx, now, requestId)
  if (!verdict.ok) {
    log('warn', '[api]', 'voice rate limited', {
      ...ids,
      reason: verdict.reason,
      count: verdict.count,
      limit: verdict.limit,
    })
    return { ok: false, code: 'rate_limited' }
  }
  const service = ctx.serviceClient

  // One live call per user: the previous call's credential goes.
  const { error: oldError } = await service.from('voice_calls').delete().eq('user_id', ctx.userId)
  if (oldError) {
    log('error', '[api]', 'previous call cleanup failed', { ...ids, code: oldError.code })
    return { ok: false, code: 'internal_error' }
  }

  const room = `voice-${randomUUID()}`
  const { data: session, error: sessionError } = await service
    .from('ai_sessions')
    .insert({ user_id: ctx.userId, channel: 'voice', external_id: room, title: VOICE_SESSION_TITLE })
    .select('id')
    .single()
  if (sessionError || !session) {
    log('error', '[api]', 'voice session insert failed', { ...ids, code: sessionError?.code ?? null })
    return { ok: false, code: 'internal_error' }
  }
  const scoped = { ...ids, session_id: session.id }
  // Undoes what this request created. Best-effort: a failed delete is logged with the table and
  // carried on, so a stuck credential row never goes unnoticed and the session delete still runs.
  const rollback = async () => {
    const calls = await service
      .from('voice_calls')
      .delete()
      .eq('session_id', session.id)
      .eq('user_id', ctx.userId)
    if (calls.error)
      log('error', '[api]', 'rollback failed', { ...scoped, table: 'voice_calls', code: calls.error.code })
    const sessions = await service.from('ai_sessions').delete().eq('id', session.id).eq('user_id', ctx.userId)
    if (sessions.error) {
      log('error', '[api]', 'rollback failed', { ...scoped, table: 'ai_sessions', code: sessions.error.code })
    }
  }

  const callToken = randomBytes(32).toString('base64url')
  const { error: callError } = await service.from('voice_calls').insert({
    session_id: session.id,
    user_id: ctx.userId,
    call_token_hash: sha256Hex(callToken),
    platform_call_id: room,
    access_token: jwt,
    expires_at: cappedExpiry(jwt, now.getTime() + CALL_CAP_MS),
  })
  if (callError) {
    log('error', '[api]', 'voice_calls insert failed', { ...scoped, code: callError.code })
    await rollback()
    return { ok: false, code: 'internal_error' }
  }

  try {
    await deps.livekit.createDispatch(
      room,
      deps.env.VOICE_AGENT_NAME,
      JSON.stringify({ callToken, sessionId: session.id }),
    )
  } catch (err) {
    log('error', '[api]', 'agent dispatch failed', {
      ...scoped,
      reason: err instanceof Error ? err.constructor.name : typeof err,
    })
    await rollback()
    return { ok: false, code: 'voice_dispatch_failed' }
  }

  // The dispatch cannot be undone; without a row the worker refuses the token at lookup (`apps/voice/src/call.ts`).
  let token: string
  try {
    token = await deps.livekit.joinToken({
      identity: ctx.userId,
      room,
      ttlSeconds: CALL_CAP_MS / 1000,
    })
  } catch (err) {
    log('error', '[api]', 'join token failed', {
      ...scoped,
      reason: err instanceof Error ? err.constructor.name : typeof err,
    })
    await rollback()
    return { ok: false, code: 'internal_error' }
  }
  log('info', '[api]', 'call started', { ...scoped, room })
  return { ok: true, value: { url: deps.livekit.url, token, room, session_id: session.id } }
}

/** 404 when there is no live call: no row, a row past `expires_at`, or a row gone between the lookup and the update. */
export async function refreshCall(
  ctx: AuthContext,
  sessionId: string,
  jwt: string,
  now: Date,
  requestId: string,
): Promise<CallResult<null>> {
  const ids = { request_id: requestId, user_id: ctx.userId, session_id: sessionId }
  const { data: call, error } = await ctx.serviceClient
    .from('voice_calls')
    .select('id, created_at')
    .eq('session_id', sessionId)
    .eq('user_id', ctx.userId)
    .gt('expires_at', now.toISOString())
    .maybeSingle()
  if (error) {
    log('error', '[api]', 'voice_calls lookup failed', { ...ids, code: error.code })
    return { ok: false, code: 'internal_error' }
  }
  if (!call) return { ok: false, code: 'not_found' }
  const cap = Date.parse(call.created_at) + CALL_CAP_MS
  const { data: updated, error: updateError } = await ctx.serviceClient
    .from('voice_calls')
    .update({ access_token: jwt, expires_at: cappedExpiry(jwt, cap) })
    .eq('id', call.id)
    .eq('user_id', ctx.userId)
    .select('id')
  if (updateError) {
    log('error', '[api]', 'voice_calls refresh failed', { ...ids, code: updateError.code })
    return { ok: false, code: 'internal_error' }
  }
  // Ended or swept between the two statements: the call is simply gone.
  if (!updated?.length) return { ok: false, code: 'not_found' }
  return { ok: true, value: null }
}

/** 404 for a session the caller does not own; otherwise idempotent (a call already gone is a success). */
export async function endCall(
  ctx: AuthContext,
  sessionId: string,
  requestId: string,
): Promise<CallResult<null>> {
  const ids = { request_id: requestId, user_id: ctx.userId, session_id: sessionId }
  const { data: session, error: lookupError } = await ctx.serviceClient
    .from('ai_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', ctx.userId)
    .maybeSingle()
  if (lookupError) {
    log('error', '[api]', 'session lookup failed', { ...ids, code: lookupError.code })
    return { ok: false, code: 'internal_error' }
  }
  if (!session) return { ok: false, code: 'not_found' }
  const { error } = await ctx.serviceClient
    .from('voice_calls')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', ctx.userId)
  if (error) {
    log('error', '[api]', 'voice_calls delete failed', { ...ids, code: error.code })
    return { ok: false, code: 'internal_error' }
  }
  log('info', '[api]', 'call ended', ids)
  return { ok: true, value: null }
}
