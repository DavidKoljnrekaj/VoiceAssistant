// Rate limits, counted from the rows that already exist. Chat: user turns (`turn_kind = 'user'`)
// in the user's chat sessions, 20 per 5 minutes and 200 per day; tool_result rows do not count.
// Voice: 20 calls per user per day (voice sessions), 3 live calls globally (`voice_calls` rows
// neither expired nor idle, the worker's own definition of a live row). A failing count fails
// OPEN and logs loudly: a flaky query must not lock users out. Known race: N concurrent requests can all pass (docs/backlog/api.md API-1).
import { type AuthContext, log } from '@va/core'

export const CHAT_BURST_WINDOW_MS = 5 * 60_000
export const CHAT_BURST_LIMIT = 20
export const CHAT_DAILY_WINDOW_MS = 24 * 60 * 60_000
export const CHAT_DAILY_LIMIT = 200
export const VOICE_CALLS_PER_DAY = 20
export const VOICE_CONCURRENT_CALLS = 3
/** The worker's idle window (`apps/voice/src/call.ts` IDLE_MS, the sweep's 3 minutes): a quiet row counts as absent. */
export const CALL_IDLE_MS = 3 * 60_000

export type RateLimitVerdict =
  | { ok: true }
  | {
      ok: false
      reason: 'burst' | 'daily' | 'calls_per_day' | 'concurrent_calls'
      count: number
      limit: number
    }

export async function checkChatRateLimit(
  ctx: AuthContext,
  now: Date,
  requestId: string,
): Promise<RateLimitVerdict> {
  const since = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const count = (from: string) =>
    ctx.serviceClient
      .from('ai_messages')
      .select('id, ai_sessions!inner(user_id, channel)', { count: 'exact', head: true })
      .eq('turn_kind', 'user')
      .eq('ai_sessions.user_id', ctx.userId)
      .eq('ai_sessions.channel', 'chat')
      .gte('created_at', from)
  const [burst, daily] = await Promise.all([
    count(since(CHAT_BURST_WINDOW_MS)),
    count(since(CHAT_DAILY_WINDOW_MS)),
  ])
  if (burst.error || daily.error) {
    log('error', '[api]', 'rate limit count failed; allowing request', {
      request_id: requestId,
      user_id: ctx.userId,
      code: burst.error?.code ?? daily.error?.code ?? null,
    })
    return { ok: true }
  }
  if ((burst.count ?? 0) >= CHAT_BURST_LIMIT)
    return { ok: false, reason: 'burst', count: burst.count ?? 0, limit: CHAT_BURST_LIMIT }
  if ((daily.count ?? 0) >= CHAT_DAILY_LIMIT)
    return { ok: false, reason: 'daily', count: daily.count ?? 0, limit: CHAT_DAILY_LIMIT }
  return { ok: true }
}

export async function checkVoiceRateLimits(
  ctx: AuthContext,
  now: Date,
  requestId: string,
): Promise<RateLimitVerdict> {
  const dayAgo = new Date(now.getTime() - CHAT_DAILY_WINDOW_MS).toISOString()
  const [calls, live] = await Promise.all([
    ctx.serviceClient
      .from('ai_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('channel', 'voice')
      .gte('created_at', dayAgo),
    ctx.serviceClient
      .from('voice_calls')
      .select('id', { count: 'exact', head: true })
      .gt('expires_at', now.toISOString())
      .gt('last_seen_at', new Date(now.getTime() - CALL_IDLE_MS).toISOString()),
  ])
  if (calls.error || live.error) {
    log('error', '[api]', 'voice rate limit count failed; allowing request', {
      request_id: requestId,
      user_id: ctx.userId,
      code: calls.error?.code ?? live.error?.code ?? null,
    })
    return { ok: true }
  }
  if ((calls.count ?? 0) >= VOICE_CALLS_PER_DAY) {
    return { ok: false, reason: 'calls_per_day', count: calls.count ?? 0, limit: VOICE_CALLS_PER_DAY }
  }
  if ((live.count ?? 0) >= VOICE_CONCURRENT_CALLS) {
    return { ok: false, reason: 'concurrent_calls', count: live.count ?? 0, limit: VOICE_CONCURRENT_CALLS }
  }
  return { ok: true }
}
